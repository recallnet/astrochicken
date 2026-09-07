#!/usr/bin/env bash
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HATCH_BIN="${HATCH_BIN:-$ROOT/node_modules/.bin/hatch}"
SLEEP_SECONDS="${SUPERVISOR_SLEEP_SECONDS:-30}"
MOTHERSHIP_REPO="${MOTHERSHIP_REPO:-recallnet/astrochicken}"
if [[ -z "${MOTHERSHIP_REPO:-}" ]]; then
  echo "MOTHERSHIP_REPO resolved to empty value" >&2
  exit 1
fi
MAX_TICKS="${SUPERVISOR_MAX_TICKS:-0}"
TRUSTED_FACTORY_IDS="${TRUSTED_FACTORY_IDS:-brainstorm/factory_supervisor}"

if [[ ! -x "$HATCH_BIN" ]]; then
  echo "hatch binary not found: $HATCH_BIN" >&2
  exit 1
fi

tick=0
while true; do
  tick=$((tick + 1))
  echo "[supervisor] tick=$tick start=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  tick_context="$ROOT/.hatch/brainstorm.supervisor.tick.context.json"
  mkdir -p "$ROOT/.hatch"
  cat > "$tick_context" <<JSON
{"gh_repo":"$MOTHERSHIP_REPO","factory_id":"brainstorm","trusted_factory_ids":"$TRUSTED_FACTORY_IDS"}
JSON

  "$HATCH_BIN" run --trace "$ROOT/factories/brainstorm/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs" --context "$tick_context" || true

  if [[ "$MAX_TICKS" != "0" && "$tick" -ge "$MAX_TICKS" ]]; then
    echo "[supervisor] reached SUPERVISOR_MAX_TICKS=$MAX_TICKS, exiting"
    break
  fi

  echo "[supervisor] tick_end=$(date -u +%Y-%m-%dT%H:%M:%SZ) sleep=${SLEEP_SECONDS}s"
  sleep "$SLEEP_SECONDS"
done
