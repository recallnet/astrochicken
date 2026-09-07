#!/usr/bin/env bash
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HATCH_BIN="${HATCH_BIN:-$ROOT/node_modules/.bin/hatch}"
SLEEP_SECONDS="${SUPERVISOR_SLEEP_SECONDS:-30}"
# Legacy repo env aliases are intentionally unsupported.
MOTHERSHIP_REPO="${MOTHERSHIP_REPO:-recallnet/astrochicken}"
if [[ -z "${MOTHERSHIP_REPO:-}" ]]; then
  echo "MOTHERSHIP_REPO resolved to empty value" >&2
  exit 1
fi
SOURCE_REPOS="${SOURCE_REPOS:-$MOTHERSHIP_REPO}"
MAX_ARTIFACTS="${MAX_ARTIFACTS:-20}"
MAX_TICKS="${SUPERVISOR_MAX_TICKS:-0}"
TRUSTED_FACTORY_IDS="${TRUSTED_FACTORY_IDS:-mothership/factory_supervisor}"
TICK_TIMEOUT_SECONDS="${SUPERVISOR_TICK_TIMEOUT_SECONDS:-1200}"
STALLED_WAVE_MINUTES="${SUPERVISOR_STALLED_WAVE_MINUTES:-20}"
MONITOR_INTERVAL_SECONDS="${SUPERVISOR_MONITOR_INTERVAL_SECONDS:-60}"
RECOVERABLE_ABANDON_SECONDS="${SUPERVISOR_RECOVERABLE_ABANDON_SECONDS:-600}"
FACTORY_LEASE_ISSUE_NUMBER="${FACTORY_LEASE_ISSUE_NUMBER:-}"
FACTORY_TRACKING_ISSUE_NUMBER="${FACTORY_TRACKING_ISSUE_NUMBER:-${FACTORY_LEASE_ISSUE_NUMBER:-407}}"
FACTORY_LEASE_SCOPE="${FACTORY_LEASE_SCOPE:-factory_supervisor}"
FACTORY_LEASE_SECONDS="${FACTORY_LEASE_SECONDS:-300}"
FACTORY_LEASE_HEARTBEAT_SECONDS="${FACTORY_LEASE_HEARTBEAT_SECONDS:-30}"
HOST_ID="${HOST_ID:-$(hostname 2>/dev/null || echo unknown-host)}"
FACTORY_LEASE_OWNER_ID="${FACTORY_LEASE_OWNER_ID:-factory-supervisor:${HOST_ID}:$$}"
FACTORY_LEASE_RUN_ID="${FACTORY_LEASE_RUN_ID:-factory-supervisor-loop:$$}"
CURRENT_FACTORY_LEASE_TOKEN=""

# OTEL telemetry transport for supervisor events:
# - stdout (default): writes OTEL_EVENT JSON lines to stdout
# - otlp: sends OTLP HTTP logs to OTEL_EXPORTER_OTLP_ENDPOINT
# - both: stdout + OTLP
OTEL_MODE="${OTEL_MODE:-stdout}"
# Example: https://otel-gateway.example.com/v1/logs
OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT:-}"
OTEL_SERVICE_NAME="${OTEL_SERVICE_NAME:-factory-supervisor}"
OTEL_EXPORTER_OTLP_TIMEOUT_MS="${OTEL_EXPORTER_OTLP_TIMEOUT_MS:-2000}"

export OTEL_MODE
export OTEL_EXPORTER_OTLP_ENDPOINT
export OTEL_SERVICE_NAME
export OTEL_EXPORTER_OTLP_TIMEOUT_MS
export MOTHERSHIP_REPO

if [[ ! -x "$HATCH_BIN" ]]; then
  echo "hatch binary not found: $HATCH_BIN" >&2
  exit 1
fi

echo "[supervisor] otel_mode=$OTEL_MODE service=$OTEL_SERVICE_NAME endpoint_set=$([[ -n "$OTEL_EXPORTER_OTLP_ENDPOINT" ]] && echo true || echo false) trusted_factory_ids=$TRUSTED_FACTORY_IDS tick_timeout_seconds=$TICK_TIMEOUT_SECONDS stalled_wave_minutes=$STALLED_WAVE_MINUTES monitor_interval_seconds=$MONITOR_INTERVAL_SECONDS recoverable_abandon_seconds=$RECOVERABLE_ABANDON_SECONDS factory_lease_enabled=$([[ -n "$FACTORY_LEASE_ISSUE_NUMBER" ]] && echo true || echo false) distributed_tracking_issue=$FACTORY_TRACKING_ISSUE_NUMBER"

run_step() {
  local name="$1"
  shift
  echo "[supervisor] step=$name"
  "$@"
  local code=$?
  if [[ $code -ne 0 ]]; then
    echo "[supervisor] step_failed=$name code=$code (continuing)" >&2
  fi
  return $code
}

json_field() {
  local raw="$1"
  local key="$2"
  node -e 'const raw=process.argv[1]||"{}"; const key=process.argv[2]||""; let parsed={}; try { parsed = JSON.parse(raw); } catch {} const value = parsed && Object.prototype.hasOwnProperty.call(parsed, key) ? parsed[key] : ""; process.stdout.write(value === undefined || value === null ? "" : String(value));' "$raw" "$key"
}

factory_lease_enabled() {
  [[ -n "$FACTORY_LEASE_ISSUE_NUMBER" ]]
}

factory_lease_acquire() {
  if ! factory_lease_enabled; then
    CURRENT_FACTORY_LEASE_TOKEN=""
    return 0
  fi

  local out
  out=$(node "$ROOT/packages/factory-ops/src/cli.mjs" factory lease-acquire \
    --repo "$MOTHERSHIP_REPO" \
    --issue "$FACTORY_LEASE_ISSUE_NUMBER" \
    --factory-scope "$FACTORY_LEASE_SCOPE" \
    --owner-id "$FACTORY_LEASE_OWNER_ID" \
    --run-id "$FACTORY_LEASE_RUN_ID" \
    --lease-seconds "$FACTORY_LEASE_SECONDS")
  local code=$?
  if [[ $code -ne 0 ]]; then
    echo "[supervisor] lease_acquire_failed code=$code output=$out" >&2
    return 1
  fi

  local ok acquired reason token expires
  ok=$(json_field "$out" "ok")
  acquired=$(json_field "$out" "acquired")
  reason=$(json_field "$out" "reason")
  token=$(json_field "$out" "lease_token")
  expires=$(node -e 'const raw=process.argv[1]||"{}"; let parsed={}; try { parsed = JSON.parse(raw); } catch {} process.stdout.write(String(parsed?.lease?.lease_expires_at || ""));' "$out")

  if [[ "$ok" != "true" ]]; then
    echo "[supervisor] lease_acquire_failed reason=$reason output=$out" >&2
    return 1
  fi

  if [[ "$acquired" != "true" ]]; then
    CURRENT_FACTORY_LEASE_TOKEN=""
    echo "[supervisor] lease_not_acquired reason=$reason"
    return 2
  fi

  CURRENT_FACTORY_LEASE_TOKEN="$token"
  echo "[supervisor] lease_acquired token=${CURRENT_FACTORY_LEASE_TOKEN} expires_at=${expires}"
  return 0
}

factory_lease_heartbeat() {
  if ! factory_lease_enabled; then
    return 0
  fi

  if [[ -z "$CURRENT_FACTORY_LEASE_TOKEN" ]]; then
    echo "[supervisor] lease_heartbeat_skipped reason=missing_token" >&2
    return 1
  fi

  local out
  out=$(node "$ROOT/packages/factory-ops/src/cli.mjs" factory lease-heartbeat \
    --repo "$MOTHERSHIP_REPO" \
    --issue "$FACTORY_LEASE_ISSUE_NUMBER" \
    --factory-scope "$FACTORY_LEASE_SCOPE" \
    --owner-id "$FACTORY_LEASE_OWNER_ID" \
    --run-id "$FACTORY_LEASE_RUN_ID" \
    --lease-token "$CURRENT_FACTORY_LEASE_TOKEN" \
    --lease-seconds "$FACTORY_LEASE_SECONDS")
  local code=$?
  if [[ $code -ne 0 ]]; then
    echo "[supervisor] lease_heartbeat_failed code=$code output=$out" >&2
    return 1
  fi

  local ok refreshed reason
  ok=$(json_field "$out" "ok")
  refreshed=$(json_field "$out" "refreshed")
  reason=$(json_field "$out" "reason")

  if [[ "$ok" != "true" || "$refreshed" != "true" ]]; then
    echo "[supervisor] lease_heartbeat_failed reason=$reason output=$out" >&2
    return 1
  fi

  return 0
}

factory_lease_release() {
  if ! factory_lease_enabled; then
    return 0
  fi

  if [[ -z "$CURRENT_FACTORY_LEASE_TOKEN" ]]; then
    return 0
  fi

  local reason="${1:-tick_complete}"
  local out
  out=$(node "$ROOT/packages/factory-ops/src/cli.mjs" factory lease-release \
    --repo "$MOTHERSHIP_REPO" \
    --issue "$FACTORY_LEASE_ISSUE_NUMBER" \
    --factory-scope "$FACTORY_LEASE_SCOPE" \
    --owner-id "$FACTORY_LEASE_OWNER_ID" \
    --run-id "$FACTORY_LEASE_RUN_ID" \
    --lease-token "$CURRENT_FACTORY_LEASE_TOKEN" \
    --reason "$reason")
  local code=$?
  CURRENT_FACTORY_LEASE_TOKEN=""

  if [[ $code -ne 0 ]]; then
    echo "[supervisor] lease_release_failed code=$code output=$out" >&2
    return 1
  fi

  local ok released leaseReason
  ok=$(json_field "$out" "ok")
  released=$(json_field "$out" "released")
  leaseReason=$(json_field "$out" "reason")
  echo "[supervisor] lease_release ok=$ok released=$released reason=$leaseReason"
  return 0
}

run_step_with_timeout() {
  local name="$1"
  local timeout_seconds="$2"
  shift 2
  echo "[supervisor] step=$name timeout=${timeout_seconds}s"

  "$@" &
  local pid=$!
  local start_epoch
  start_epoch=$(date +%s)
  local last_hb_epoch
  last_hb_epoch=$start_epoch

  local timed_out=0
  while kill -0 "$pid" >/dev/null 2>&1; do
    sleep 2
    local now
    now=$(date +%s)
    local elapsed=$((now - start_epoch))

    if [[ "$name" == "supervisor_tick" ]] && factory_lease_enabled; then
      local hb_elapsed=$((now - last_hb_epoch))
      if [[ $hb_elapsed -ge $FACTORY_LEASE_HEARTBEAT_SECONDS ]]; then
        if ! factory_lease_heartbeat; then
          timed_out=2
          echo "[supervisor] step_failed=$name reason=lease_heartbeat_lost pid=$pid" >&2
          kill -TERM "$pid" >/dev/null 2>&1 || true
          sleep 2
          kill -KILL "$pid" >/dev/null 2>&1 || true
          break
        fi
        last_hb_epoch=$now
      fi
    fi

    if [[ "$timeout_seconds" != "0" && $elapsed -ge $timeout_seconds ]]; then
      timed_out=1
      echo "[supervisor] step_timeout=$name after=${elapsed}s pid=$pid" >&2
      kill -TERM "$pid" >/dev/null 2>&1 || true
      sleep 2
      kill -KILL "$pid" >/dev/null 2>&1 || true
      break
    fi
  done

  wait "$pid"
  local code=$?
  if [[ $timed_out -eq 1 ]]; then
    echo "[supervisor] step_failed=$name code=124 (timeout, continuing)" >&2
    return 124
  fi
  if [[ $timed_out -eq 2 ]]; then
    echo "[supervisor] step_failed=$name code=125 (lease heartbeat lost, continuing)" >&2
    return 125
  fi
  if [[ $code -ne 0 ]]; then
    echo "[supervisor] step_failed=$name code=$code (continuing)" >&2
  fi
  return $code
}

cleanup_supervisor_lease() {
  factory_lease_release "supervisor_exit" || true
}
trap cleanup_supervisor_lease EXIT INT TERM

tick=0
while true; do
  tick=$((tick + 1))
  echo "[supervisor] tick=$tick tick_start=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  run_step runs_gc "$HATCH_BIN" runs gc
  run_step reconcile_recoverables "$HATCH_BIN" runs reconcile --abandon-seconds="$RECOVERABLE_ABANDON_SECONDS" --gc --json

  tick_context="$ROOT/.hatch/supervisor.tick.context.json"
  mkdir -p "$ROOT/.hatch"
  cat > "$tick_context" <<JSON
{"gh_repo":"$MOTHERSHIP_REPO","source_repos":"$SOURCE_REPOS","max_artifacts":"$MAX_ARTIFACTS","trusted_factory_ids":"$TRUSTED_FACTORY_IDS","factory_tracking_issue_number":"$FACTORY_TRACKING_ISSUE_NUMBER","dry_run":"false"}
JSON

  tick_code=0
  lease_acquire_code=0
  factory_lease_acquire
  lease_acquire_code=$?

  if [[ $lease_acquire_code -eq 0 ]]; then
    run_step_with_timeout supervisor_tick "$TICK_TIMEOUT_SECONDS" "$HATCH_BIN" run --trace "$ROOT/factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs" --context "$tick_context"
    tick_code=$?
    release_reason="tick_complete"
    if [[ $tick_code -eq 124 ]]; then
      release_reason="tick_timeout"
      run_step detect_stalled_wave node "$ROOT/packages/factory-ops/src/cli.mjs" supervisor detect-stalled-wave --repo "$MOTHERSHIP_REPO" --pipeline "factory_supervisor_tick" --stale-minutes "$STALLED_WAVE_MINUTES"
    elif [[ $tick_code -eq 125 ]]; then
      release_reason="lease_heartbeat_lost"
    fi
    factory_lease_release "$release_reason"
  elif [[ $lease_acquire_code -eq 2 ]]; then
    tick_code=0
    echo "[supervisor] tick_skipped reason=lease_unavailable"
  else
    tick_code=125
    echo "[supervisor] tick_skipped reason=lease_acquire_error"
  fi

  run_step supervisor_status node "$ROOT/packages/factory-ops/src/cli.mjs" supervisor status --repo "$MOTHERSHIP_REPO"

  if [[ "$MAX_TICKS" != "0" && "$tick" -ge "$MAX_TICKS" ]]; then
    echo "[supervisor] reached SUPERVISOR_MAX_TICKS=$MAX_TICKS, exiting"
    break
  fi

  echo "[supervisor] tick_end=$(date -u +%Y-%m-%dT%H:%M:%SZ) sleep=${SLEEP_SECONDS}s"
  sleep "$SLEEP_SECONDS"
done
