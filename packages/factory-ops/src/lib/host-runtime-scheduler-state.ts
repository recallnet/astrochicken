import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const HOST_RUNTIME_SCHEDULER_STATE_SCHEMA = "hatch.host.runtime.scheduler_state.v1";

const DEFAULT_INSTANCE_STATE = Object.freeze({
  installation_id: "",
  instance_id: "",
  service_profile_id: "",
  scheduler_weight: 1,
  reserved_capacity: 0,
  assigned_host_id: "",
  base_priority: 1000,
  effective_priority: 1000,
  selection_reason: "",
  selection_score: 1000,
  capacity_reject_reason: "",
  wait_cycles: 0,
  last_scheduled_at: "",
  next_eligible_at: "",
  defer_reason: "",
  active_state: "idle",
  age_bonus_counter: 0,
  decision: "",
  decision_at: "",
});

function trim(value = "") {
  return String(value || "").trim();
}

function parseJson(text = "", fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseEpochMs(value = "") {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function normalizeIsoTimestamp(value = "") {
  if (value instanceof Date) return value.toISOString();

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(Math.trunc(numeric)).toISOString();
  }

  const text = trim(value);
  if (!text) return "";
  const parsed = parseEpochMs(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function normalizeInteger(value, fallback = 0, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.min(max, Math.max(min, Math.trunc(fallback)));
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function normalizeActiveState(value = "") {
  return trim(value) === "running" ? "running" : "idle";
}

function normalizeDecision(value = "") {
  const normalized = trim(value);
  if (normalized === "scheduled") return "scheduled";
  if (normalized === "deferred") return "deferred";
  return "";
}

export function normalizeHostRuntimeSchedulerEntry(entry = {}, fallback = {}) {
  const merged = {
    ...DEFAULT_INSTANCE_STATE,
    ...(isObject(fallback) ? fallback : {}),
    ...(isObject(entry) ? entry : {}),
  };

  const basePriority = normalizeInteger(merged.base_priority, 1000, { min: 0, max: 10_000 });
  const ageBonusCounter = normalizeInteger(merged.age_bonus_counter, 0, { min: 0, max: 1000 });

  return {
    installation_id: trim(merged.installation_id),
    instance_id: trim(merged.instance_id),
    service_profile_id: trim(merged.service_profile_id),
    scheduler_weight: normalizeInteger(merged.scheduler_weight, 1, { min: 0 }),
    reserved_capacity: normalizeInteger(merged.reserved_capacity, 0, { min: 0 }),
    assigned_host_id: trim(merged.assigned_host_id),
    base_priority: basePriority,
    effective_priority: normalizeInteger(merged.effective_priority, basePriority - ageBonusCounter, { min: -10_000, max: 10_000 }),
    selection_reason: trim(merged.selection_reason),
    selection_score: normalizeInteger(merged.selection_score, basePriority - ageBonusCounter, { min: -10_000, max: 10_000 }),
    capacity_reject_reason: trim(merged.capacity_reject_reason),
    wait_cycles: normalizeInteger(merged.wait_cycles, 0, { min: 0, max: 100_000 }),
    last_scheduled_at: normalizeIsoTimestamp(merged.last_scheduled_at),
    next_eligible_at: normalizeIsoTimestamp(merged.next_eligible_at),
    defer_reason: trim(merged.defer_reason),
    active_state: normalizeActiveState(merged.active_state),
    age_bonus_counter: ageBonusCounter,
    decision: normalizeDecision(merged.decision),
    decision_at: normalizeIsoTimestamp(merged.decision_at),
  };
}

function normalizeInstances(raw = {}) {
  const entries = isObject(raw) ? Object.entries(raw) : [];
  const normalized = {};
  for (const [key, value] of entries) {
    const fallbackInstallationId = trim(key);
    const normalizedEntry = normalizeHostRuntimeSchedulerEntry(value, {
      installation_id: fallbackInstallationId,
    });
    const installationId = trim(normalizedEntry.installation_id || fallbackInstallationId);
    if (!installationId) continue;
    normalized[installationId] = normalizedEntry;
  }
  return normalized;
}

export function normalizeHostRuntimeSchedulerState(state = {}, { hostId = "" } = {}) {
  const normalizedHostId = trim(state.host_id || hostId);
  const updatedAt = normalizeIsoTimestamp(state.updated_at) || new Date().toISOString();

  return {
    schema: HOST_RUNTIME_SCHEDULER_STATE_SCHEMA,
    host_id: normalizedHostId,
    updated_at: updatedAt,
    last_cycle: isObject(state.last_cycle) ? state.last_cycle : {},
    instances: normalizeInstances(state.instances),
  };
}

export function resolveHostRuntimeSchedulerStatePath({ paths = {} } = {}) {
  const explicit = trim(paths.schedulerStatePath || paths.scheduler_state_path || "");
  if (explicit) return path.resolve(explicit);

  const runtimeDir = trim(paths.runtimeDir || paths.runtime_dir || "");
  if (runtimeDir) return path.resolve(runtimeDir, "scheduler-state.json");

  const baseDir = trim(paths.baseDir || paths.base_dir || "");
  if (baseDir) return path.resolve(baseDir, "runtime", "scheduler-state.json");

  return path.resolve("scheduler-state.json");
}

export function loadHostRuntimeSchedulerState({ paths = {}, hostId = "" } = {}) {
  const schedulerStatePath = resolveHostRuntimeSchedulerStatePath({ paths });
  if (!existsSync(schedulerStatePath)) {
    return {
      exists: false,
      schedulerStatePath,
      state: normalizeHostRuntimeSchedulerState({}, { hostId }),
    };
  }

  const parsed = parseJson(readFileSync(schedulerStatePath, "utf8"), {});
  return {
    exists: true,
    schedulerStatePath,
    state: normalizeHostRuntimeSchedulerState(parsed, { hostId }),
  };
}

function writeAtomicJson(targetPath = "", payload = {}) {
  const normalizedPath = path.resolve(targetPath);
  mkdirSync(path.dirname(normalizedPath), { recursive: true });
  const tmpPath = `${normalizedPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(tmpPath, normalizedPath);
}

export function writeHostRuntimeSchedulerState({ paths = {}, state = {} } = {}) {
  const schedulerStatePath = resolveHostRuntimeSchedulerStatePath({ paths });
  const normalizedState = normalizeHostRuntimeSchedulerState(state, {
    hostId: trim(state.host_id),
  });
  writeAtomicJson(schedulerStatePath, normalizedState);
  return {
    schedulerStatePath,
    state: normalizedState,
  };
}
