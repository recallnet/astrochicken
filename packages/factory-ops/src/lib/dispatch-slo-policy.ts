import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const DISPATCH_LATENCY_SLO_SCHEMA = "dispatch-latency-slo/v1";
export const DEFAULT_DISPATCH_LATENCY_SLO_SECONDS = 15;
export const MAX_DISPATCH_LATENCY_SLO_SECONDS = 30;
export const DEFAULT_MAINTENANCE_INTERVAL_SECONDS = 300;

function trim(value = "") {
  return String(value || "").trim();
}

function normalizePositiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

export function normalizeDispatchLatencySloSeconds(value, fallback = DEFAULT_DISPATCH_LATENCY_SLO_SECONDS) {
  const normalizedFallback = normalizePositiveInteger(fallback, DEFAULT_DISPATCH_LATENCY_SLO_SECONDS);
  const candidate = normalizePositiveInteger(value, normalizedFallback);
  return Math.min(candidate, MAX_DISPATCH_LATENCY_SLO_SECONDS);
}

export function normalizeMaintenanceIntervalSeconds(value, fallback = DEFAULT_MAINTENANCE_INTERVAL_SECONDS) {
  return normalizePositiveInteger(value, normalizePositiveInteger(fallback, DEFAULT_MAINTENANCE_INTERVAL_SECONDS));
}

export function evaluateDispatchLatencySlo({
  dispatchDurationMs = 0,
  dispatchLatencySloSeconds = DEFAULT_DISPATCH_LATENCY_SLO_SECONDS,
} = {}) {
  const durationMs = Math.max(0, Math.trunc(Number(dispatchDurationMs) || 0));
  const sloSeconds = normalizeDispatchLatencySloSeconds(dispatchLatencySloSeconds);
  const sloMs = sloSeconds * 1000;
  const overageMs = Math.max(0, durationMs - sloMs);
  return {
    schema: DISPATCH_LATENCY_SLO_SCHEMA,
    duration_ms: durationMs,
    slo_seconds: sloSeconds,
    slo_ms: sloMs,
    ok: durationMs <= sloMs,
    overage_ms: overageMs,
  };
}

export function resolveMaintenanceTickStatePath({ factoryId = "", rootDir = "." } = {}) {
  const normalizedFactoryId = trim(factoryId);
  if (!normalizedFactoryId) throw new Error("factory_id_required");
  return join(String(rootDir || "."), ".hatch", "factories", normalizedFactoryId, "maintenance-tick-state.json");
}

export function readMaintenanceTickState({ factoryId = "", rootDir = "." } = {}) {
  const statePath = resolveMaintenanceTickStatePath({ factoryId, rootDir });
  if (!existsSync(statePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(statePath, "utf8"));
    if (trim(raw?.schema) !== DISPATCH_LATENCY_SLO_SCHEMA) return null;
    return {
      schema: DISPATCH_LATENCY_SLO_SCHEMA,
      last_completed_at: trim(raw?.last_completed_at),
      last_run_id: trim(raw?.last_run_id),
      last_tick_id: trim(raw?.last_tick_id),
    };
  } catch {
    return null;
  }
}

export function writeMaintenanceTickState({
  factoryId = "",
  rootDir = ".",
  completedAt = "",
  runId = "",
  tickId = "",
} = {}) {
  const statePath = resolveMaintenanceTickStatePath({ factoryId, rootDir });
  const payload = {
    schema: DISPATCH_LATENCY_SLO_SCHEMA,
    last_completed_at: trim(completedAt),
    last_run_id: trim(runId),
    last_tick_id: trim(tickId),
  };
  mkdirSync(dirname(statePath), { recursive: true });
  const tmpPath = `${statePath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(tmpPath, statePath);
  return {
    path: statePath,
    state: payload,
  };
}

export function evaluateMaintenanceTickDue({
  factoryId = "",
  rootDir = ".",
  nowMs = Date.now(),
  maintenanceIntervalSeconds = DEFAULT_MAINTENANCE_INTERVAL_SECONDS,
  state = undefined,
} = {}) {
  const intervalSeconds = normalizeMaintenanceIntervalSeconds(maintenanceIntervalSeconds);
  const intervalMs = intervalSeconds * 1000;
  const persisted = state === undefined ? readMaintenanceTickState({ factoryId, rootDir }) : state;
  const lastCompletedAt = trim(persisted?.last_completed_at);
  if (!lastCompletedAt) {
    return {
      due: true,
      reason: "no_prior_maintenance_tick",
      remaining_ms: 0,
      interval_seconds: intervalSeconds,
      last_completed_at: "",
    };
  }

  const lastCompletedMs = Date.parse(lastCompletedAt);
  if (!Number.isFinite(lastCompletedMs) || lastCompletedMs <= 0) {
    return {
      due: true,
      reason: "invalid_prior_maintenance_tick",
      remaining_ms: 0,
      interval_seconds: intervalSeconds,
      last_completed_at: lastCompletedAt,
    };
  }

  const elapsedMs = Math.max(0, Math.trunc(Number(nowMs) - lastCompletedMs));
  if (elapsedMs >= intervalMs) {
    return {
      due: true,
      reason: "maintenance_interval_elapsed",
      remaining_ms: 0,
      interval_seconds: intervalSeconds,
      last_completed_at: lastCompletedAt,
    };
  }

  return {
    due: false,
    reason: "maintenance_interval_not_elapsed",
    remaining_ms: intervalMs - elapsedMs,
    interval_seconds: intervalSeconds,
    last_completed_at: lastCompletedAt,
  };
}
