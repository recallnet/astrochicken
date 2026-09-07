import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { trim } from "./cli-helpers.ts";

export const EXTERNAL_FACTORY_CONTROL_STATE_SCHEMA = "external-factory-control-state/v1";
export const MANAGED_FACTORY_SNAPSHOT_SCHEMA = "managed-factory-snapshot/v1";

export const LIFECYCLE_STATES = Object.freeze([
  "waiting_for_release",
  "ready_to_resume",
  "rejected_upstream",
  "restart_failed",
]);

const ACTIONS = new Set(["pause", "quarantine", "retry", "unblock", "resume"]);

function parseJson(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function asBool(value) {
  return value === true;
}

function toVersion(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function toNotes(value = []) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const at = trim(entry.at);
      const actor = trim(entry.actor);
      const action = trim(entry.action);
      const reason = trim(entry.reason);
      const retryTarget = trim(entry.retry_target);
      if (!at && !actor && !action && !reason && !retryTarget) return null;
      return {
        at,
        actor,
        action,
        reason,
        retry_target: retryTarget,
      };
    })
    .filter(Boolean);
}

function normalizeLatestIncidents(value = []) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const incidentFingerprint = trim(entry.incident_fingerprint);
      const severity = trim(entry.severity);
      if (!incidentFingerprint || !severity) return null;
      return {
        incident_fingerprint: incidentFingerprint,
        severity,
      };
    })
    .filter(Boolean);
}

function normalizeManagedSnapshot(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    schema_version: MANAGED_FACTORY_SNAPSHOT_SCHEMA,
    lifecycle_state: trim(source.lifecycle_state),
    lifecycle_reason: trim(source.lifecycle_reason),
    lifecycle_failure_classification: trim(source.lifecycle_failure_classification),
    lifecycle_failure_reason: trim(source.lifecycle_failure_reason),
    lifecycle_updated_at: trim(source.lifecycle_updated_at),
    lifecycle_updated_by: trim(source.lifecycle_updated_by),
    blockers: {
      upstream: {
        has_open_upstream_bugs: source?.blockers?.upstream?.has_open_upstream_bugs === true,
        open_upstream_bug_count: toVersion(source?.blockers?.upstream?.open_upstream_bug_count, 0),
        open_upstream_bug_numbers: Array.isArray(source?.blockers?.upstream?.open_upstream_bug_numbers)
          ? source.blockers.upstream.open_upstream_bug_numbers
            .map((value) => Number.parseInt(String(value ?? "").trim(), 10))
            .filter((value) => Number.isFinite(value) && value > 0)
          : [],
      },
      action_items: {
        has_action_items: source?.blockers?.action_items?.has_action_items === true,
        action_item_count: toVersion(source?.blockers?.action_items?.action_item_count, 0),
      },
    },
    unresolved_actions: toVersion(source.unresolved_actions, 0),
    queue_depth: toVersion(source.queue_depth, 0),
    oldest_work_age_seconds: toVersion(source.oldest_work_age_seconds, 0),
    latest_incidents: normalizeLatestIncidents(source.latest_incidents),
  };
}

export function validateManagedSnapshot(snapshot = {}) {
  if (!snapshot || typeof snapshot !== "object") {
    throw controlStateError("managed_snapshot_invalid", "managed snapshot must be an object");
  }

  const schemaVersion = trim(snapshot.schema_version);
  if (schemaVersion !== MANAGED_FACTORY_SNAPSHOT_SCHEMA) {
    throw controlStateError(
      "managed_snapshot_invalid_schema",
      `expected schema_version=${MANAGED_FACTORY_SNAPSHOT_SCHEMA} actual=${schemaVersion || "(missing)"}`,
    );
  }

  const requiredStringFields = [
    "lifecycle_state",
    "lifecycle_reason",
    "lifecycle_failure_classification",
    "lifecycle_failure_reason",
    "lifecycle_updated_at",
    "lifecycle_updated_by",
  ];

  for (const key of requiredStringFields) {
    const value = snapshot[key];
    if (typeof value !== "string") {
      throw controlStateError("managed_snapshot_invalid", `${key} must be a string`);
    }
  }

  const blockers = snapshot.blockers;
  if (!blockers || typeof blockers !== "object") {
    throw controlStateError("managed_snapshot_invalid", "blockers must be an object");
  }

  const upstream = blockers.upstream;
  if (!upstream || typeof upstream !== "object") {
    throw controlStateError("managed_snapshot_invalid", "blockers.upstream must be an object");
  }
  if (typeof upstream.has_open_upstream_bugs !== "boolean") {
    throw controlStateError("managed_snapshot_invalid", "blockers.upstream.has_open_upstream_bugs must be a boolean");
  }
  if (!Number.isInteger(upstream.open_upstream_bug_count) || upstream.open_upstream_bug_count < 0) {
    throw controlStateError("managed_snapshot_invalid", "blockers.upstream.open_upstream_bug_count must be a non-negative integer");
  }
  if (!Array.isArray(upstream.open_upstream_bug_numbers)) {
    throw controlStateError("managed_snapshot_invalid", "blockers.upstream.open_upstream_bug_numbers must be an array");
  }

  const actionItems = blockers.action_items;
  if (!actionItems || typeof actionItems !== "object") {
    throw controlStateError("managed_snapshot_invalid", "blockers.action_items must be an object");
  }
  if (typeof actionItems.has_action_items !== "boolean") {
    throw controlStateError("managed_snapshot_invalid", "blockers.action_items.has_action_items must be a boolean");
  }
  if (!Number.isInteger(actionItems.action_item_count) || actionItems.action_item_count < 0) {
    throw controlStateError("managed_snapshot_invalid", "blockers.action_items.action_item_count must be a non-negative integer");
  }

  const requiredNumberFields = [
    "unresolved_actions",
    "queue_depth",
    "oldest_work_age_seconds",
  ];
  for (const key of requiredNumberFields) {
    const value = snapshot[key];
    if (!Number.isInteger(value) || value < 0) {
      throw controlStateError("managed_snapshot_invalid", `${key} must be a non-negative integer`);
    }
  }

  if (!Array.isArray(snapshot.latest_incidents)) {
    throw controlStateError("managed_snapshot_invalid", "latest_incidents must be an array");
  }

  for (const [index, incident] of snapshot.latest_incidents.entries()) {
    if (!incident || typeof incident !== "object") {
      throw controlStateError("managed_snapshot_invalid", `latest_incidents[${index}] must be an object`);
    }
    if (typeof incident.incident_fingerprint !== "string" || !trim(incident.incident_fingerprint)) {
      throw controlStateError("managed_snapshot_invalid", `latest_incidents[${index}].incident_fingerprint is required`);
    }
    if (typeof incident.severity !== "string" || !trim(incident.severity)) {
      throw controlStateError("managed_snapshot_invalid", `latest_incidents[${index}].severity is required`);
    }
  }

  return snapshot;
}

export function normalizeManagedLifecycleSnapshot(raw = {}) {
  const snapshot = normalizeManagedSnapshot(raw);
  validateManagedSnapshot(snapshot);
  return snapshot;
}

function buildDefaultActionState() {
  return {
    pause: { active: false },
    quarantine: { active: false, count: 0, last_reason: "", last_at: "" },
    draining: { active: false, at: "" },
    retry: { active: false, count: 0, last_reason: "", last_at: "", last_target: "" },
    unblock: { active: false, note: "", at: "" },
    resume: { active: false, at: "" },
  };
}

function normalizeActionState(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const defaults = buildDefaultActionState();
  return {
    pause: {
      ...defaults.pause,
      active: asBool(source.pause?.active),
    },
    quarantine: {
      ...defaults.quarantine,
      active: asBool(source.quarantine?.active),
      count: toVersion(source.quarantine?.count, 0),
      last_reason: trim(source.quarantine?.last_reason),
      last_at: trim(source.quarantine?.last_at),
    },
    draining: {
      ...defaults.draining,
      active: asBool(source.draining?.active),
      at: trim(source.draining?.at),
    },
    retry: {
      ...defaults.retry,
      active: asBool(source.retry?.active),
      count: toVersion(source.retry?.count, 0),
      last_reason: trim(source.retry?.last_reason),
      last_at: trim(source.retry?.last_at),
      last_target: trim(source.retry?.last_target),
    },
    unblock: {
      ...defaults.unblock,
      active: asBool(source.unblock?.active),
      note: trim(source.unblock?.note),
      at: trim(source.unblock?.at),
    },
    resume: {
      ...defaults.resume,
      active: asBool(source.resume?.active),
      at: trim(source.resume?.at),
    },
  };
}

function normalizeFactoryId(value = "") {
  const id = trim(value);
  if (!id) throw new Error("factory_id_required");
  if (id.startsWith("/") || id.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(id)) {
    throw new Error("invalid_factory_id");
  }
  return id;
}

export function resolveExternalFactoryControlStatePath({ factoryId = "", rootDir = process.cwd() } = {}) {
  const normalizedFactoryId = normalizeFactoryId(factoryId);
  const base = resolve(rootDir || process.cwd());
  return join(base, ".hatch", "factories", normalizedFactoryId, "control-state.json");
}

function normalizeState(raw = {}, { factoryId = "" } = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const normalizedFactoryId = normalizeFactoryId(factoryId || source.factory_id);
  const actionState = normalizeActionState(source.action_state);
  const lifecycleSnapshotRaw = source.lifecycle_state_snapshot;
  const lifecycleSnapshot = lifecycleSnapshotRaw === undefined
    ? normalizeManagedLifecycleSnapshot({})
    : validateManagedSnapshot(normalizeManagedLifecycleSnapshot(lifecycleSnapshotRaw));

  return {
    schema: EXTERNAL_FACTORY_CONTROL_STATE_SCHEMA,
    factory_id: normalizedFactoryId,
    version: toVersion(source.version, 0),
    updated_at: trim(source.updated_at),
    updated_by: trim(source.updated_by),
    action_state: actionState,
    reason: trim(source.reason),
    retry_target: trim(source.retry_target),
    notes: toNotes(source.notes),
    lifecycle_state_snapshot: lifecycleSnapshot,
  };
}

function writeAtomicJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  renameSync(tmpPath, path);
}

function activeActionFromState(actionState = {}) {
  const state = normalizeActionState(actionState);
  if (state.pause.active) return "pause";
  if (state.quarantine.active) return "quarantine";
  if (state.draining.active) return "draining";
  if (state.retry.active) return "retry";
  if (state.unblock.active) return "unblock";
  if (state.resume.active) return "resume";
  return "none";
}

export function getExternalFactoryControlActiveAction(state = {}) {
  return activeActionFromState(state?.action_state || {});
}

export function readExternalFactoryControlState({ factoryId = "", rootDir = process.cwd() } = {}) {
  const statePath = resolveExternalFactoryControlStatePath({ factoryId, rootDir });
  if (!existsSync(statePath)) {
    return {
      ...normalizeState({}, { factoryId }),
      state_path: statePath,
    };
  }

  const parsed = parseJson(readFileSync(statePath, "utf8"), {});
  return {
    ...normalizeState(parsed, { factoryId }),
    state_path: statePath,
  };
}

function controlStateError(code, message = "") {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function requireNonNegativeIntegerField(value, fieldName = "value") {
  if (value === undefined || value === null || value === "") {
    throw controlStateError("managed_snapshot_invalid", `${fieldName} is required`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw controlStateError("managed_snapshot_invalid", `${fieldName} must be a non-negative integer`);
  }
  return parsed;
}

function requireLatestIncidents(value) {
  if (!Array.isArray(value)) {
    throw controlStateError("managed_snapshot_invalid", "latest_incidents must be an array");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw controlStateError("managed_snapshot_invalid", `latest_incidents[${index}] must be an object`);
    }
    const incidentFingerprint = trim(entry.incident_fingerprint);
    const severity = trim(entry.severity);
    if (!incidentFingerprint) {
      throw controlStateError("managed_snapshot_invalid", `latest_incidents[${index}].incident_fingerprint is required`);
    }
    if (!severity) {
      throw controlStateError("managed_snapshot_invalid", `latest_incidents[${index}].severity is required`);
    }
    return {
      incident_fingerprint: incidentFingerprint,
      severity,
    };
  });
}

function requireBlockers(value) {
  if (!value || typeof value !== "object") {
    throw controlStateError("managed_snapshot_invalid", "blockers is required");
  }

  const upstream = value.upstream;
  if (!upstream || typeof upstream !== "object") {
    throw controlStateError("managed_snapshot_invalid", "blockers.upstream is required");
  }
  if (typeof upstream.has_open_upstream_bugs !== "boolean") {
    throw controlStateError("managed_snapshot_invalid", "blockers.upstream.has_open_upstream_bugs must be a boolean");
  }
  if (!Number.isInteger(upstream.open_upstream_bug_count) || upstream.open_upstream_bug_count < 0) {
    throw controlStateError("managed_snapshot_invalid", "blockers.upstream.open_upstream_bug_count must be a non-negative integer");
  }
  if (!Array.isArray(upstream.open_upstream_bug_numbers)) {
    throw controlStateError("managed_snapshot_invalid", "blockers.upstream.open_upstream_bug_numbers must be an array");
  }

  const actionItems = value.action_items;
  if (!actionItems || typeof actionItems !== "object") {
    throw controlStateError("managed_snapshot_invalid", "blockers.action_items is required");
  }
  if (typeof actionItems.has_action_items !== "boolean") {
    throw controlStateError("managed_snapshot_invalid", "blockers.action_items.has_action_items must be a boolean");
  }
  if (!Number.isInteger(actionItems.action_item_count) || actionItems.action_item_count < 0) {
    throw controlStateError("managed_snapshot_invalid", "blockers.action_items.action_item_count must be a non-negative integer");
  }

  return value;
}

export function writeExternalFactoryControlState({
  factoryId = "",
  nextState = {},
  actor = "",
  reason = "",
  expectedVersion = undefined,
  rootDir = process.cwd(),
  writeAtomicJsonFn = writeAtomicJson,
} = {}) {
  const normalizedFactoryId = normalizeFactoryId(factoryId);
  const current = readExternalFactoryControlState({ factoryId: normalizedFactoryId, rootDir });
  const expected = expectedVersion === undefined || expectedVersion === null || expectedVersion === ""
    ? null
    : toVersion(expectedVersion, -1);

  if (expected !== null && expected !== current.version) {
    throw controlStateError(
      "version_mismatch",
      `expected_version=${expected} actual_version=${current.version}`,
    );
  }

  const nowIso = new Date().toISOString();
  const author = trim(actor) || "operator";
  const nextStateHasReason = Boolean(nextState && typeof nextState === "object" && Object.prototype.hasOwnProperty.call(nextState, "reason"));
  const nextReason = nextStateHasReason ? trim(nextState.reason) : null;
  const merged = normalizeState({
    ...current,
    ...(nextState && typeof nextState === "object" ? nextState : {}),
    factory_id: normalizedFactoryId,
    reason: trim(reason) || (nextStateHasReason ? nextReason : current.reason),
    version: current.version + 1,
    updated_at: nowIso,
    updated_by: author,
  }, { factoryId: normalizedFactoryId });

  writeAtomicJsonFn(current.state_path, merged);
  return {
    ...merged,
    state_path: current.state_path,
  };
}

function clearTransient(actionState = {}) {
  const cleared = normalizeActionState(actionState);
  cleared.pause.active = false;
  cleared.quarantine.active = false;
  cleared.draining.active = false;
  cleared.retry.active = false;
  cleared.unblock.active = false;
  cleared.resume.active = false;
  return cleared;
}

export function writeExternalFactoryLifecycleState({
  factoryId = "",
  rootDir = process.cwd(),
  lifecycleState = "",
  lifecycleReason = "",
  failureClassification = "",
  failureReason = "",
  actor = "",
  expectedVersion = undefined,
  blockers = {},
  unresolvedActions = 0,
  queueDepth = 0,
  oldestWorkAgeSeconds = 0,
  latestIncidents = [],
  writeControlStateFn = writeExternalFactoryControlState,
  nowIso = new Date().toISOString(),
} = {}) {
  const normalizedLifecycleState = trim(lifecycleState);
  if (!normalizedLifecycleState) {
    throw controlStateError("lifecycle_state_required", "lifecycle_state is required");
  }

  const normalizedSnapshot = normalizeManagedLifecycleSnapshot({
    lifecycle_state: normalizedLifecycleState,
    lifecycle_reason: trim(lifecycleReason),
    lifecycle_failure_classification: trim(failureClassification),
    lifecycle_failure_reason: trim(failureReason),
    lifecycle_updated_at: nowIso,
    lifecycle_updated_by: trim(actor) || "managed_supervisor",
    blockers: requireBlockers(blockers),
    unresolved_actions: requireNonNegativeIntegerField(unresolvedActions, "unresolved_actions"),
    queue_depth: requireNonNegativeIntegerField(queueDepth, "queue_depth"),
    oldest_work_age_seconds: requireNonNegativeIntegerField(oldestWorkAgeSeconds, "oldest_work_age_seconds"),
    latest_incidents: requireLatestIncidents(latestIncidents),
  });

  const persisted = writeControlStateFn({
    factoryId,
    rootDir,
    actor,
    reason: trim(lifecycleReason),
    expectedVersion,
    nextState: {
      reason: trim(lifecycleReason),
      lifecycle_state_snapshot: normalizedSnapshot,
    },
  });

  return {
    ...persisted,
    lifecycle_state_snapshot: normalizeManagedLifecycleSnapshot(persisted.lifecycle_state_snapshot),
  };
}

export function applyExternalFactoryControlAction({
  action = "",
  factoryId = "",
  reason = "",
  actor = "",
  retryTarget = "",
  expectedVersion = undefined,
  rootDir = process.cwd(),
} = {}) {
  const normalizedAction = trim(action).toLowerCase();
  if (!ACTIONS.has(normalizedAction)) {
    throw controlStateError("invalid_action", `unsupported_action:${normalizedAction || "(empty)"}`);
  }

  const normalizedReason = trim(reason);
  if (!normalizedReason) throw controlStateError("reason_required", "reason is required");

  const current = readExternalFactoryControlState({ factoryId, rootDir });
  const nowIso = new Date().toISOString();
  const nextActionState = normalizeActionState(current.action_state);
  let nextRetryTarget = trim(current.retry_target);

  if (normalizedAction === "pause") {
    const nextValue = !nextActionState.pause.active;
    const cleared = clearTransient(nextActionState);
    cleared.pause.active = nextValue;
    Object.assign(nextActionState, cleared);
  }

  if (normalizedAction === "quarantine") {
    const count = toVersion(nextActionState.quarantine.count, 0) + 1;
    const cleared = clearTransient(nextActionState);
    cleared.quarantine.active = true;
    cleared.quarantine.count = count;
    cleared.quarantine.last_reason = normalizedReason;
    cleared.quarantine.last_at = nowIso;
    Object.assign(nextActionState, cleared);
  }

  if (normalizedAction === "retry") {
    const count = toVersion(nextActionState.retry.count, 0) + 1;
    const cleared = clearTransient(nextActionState);
    cleared.retry.active = true;
    cleared.retry.count = count;
    cleared.retry.last_reason = normalizedReason;
    cleared.retry.last_at = nowIso;
    cleared.retry.last_target = trim(retryTarget) || trim(nextRetryTarget);
    Object.assign(nextActionState, cleared);
    nextRetryTarget = trim(cleared.retry.last_target);
  }

  if (normalizedAction === "unblock") {
    nextActionState.unblock.active = true;
    nextActionState.unblock.note = normalizedReason;
    nextActionState.unblock.at = nowIso;
    nextActionState.resume.active = false;
  }

  if (normalizedAction === "resume") {
    const hasAnyManagedState = nextActionState.pause.active
      || nextActionState.quarantine.active
      || nextActionState.retry.active
      || nextActionState.unblock.active;
    if (!hasAnyManagedState) {
      throw controlStateError("invalid_transition", "resume_requires_active_managed_state");
    }
    if (nextActionState.quarantine.active && !nextActionState.unblock.active) {
      throw controlStateError("invalid_transition", "resume_requires_unblock_after_quarantine");
    }

    const cleared = clearTransient(nextActionState);
    cleared.resume.active = true;
    cleared.resume.at = nowIso;
    Object.assign(nextActionState, cleared);
    nextRetryTarget = "";
  }

  const nextNotes = [
    ...(Array.isArray(current.notes) ? current.notes : []),
    {
      at: nowIso,
      actor: trim(actor) || "operator",
      action: normalizedAction,
      reason: normalizedReason,
      retry_target: trim(retryTarget),
    },
  ];

  const persisted = writeExternalFactoryControlState({
    factoryId,
    nextState: {
      ...current,
      action_state: nextActionState,
      reason: normalizedReason,
      retry_target: nextRetryTarget,
      notes: nextNotes,
    },
    actor,
    reason: normalizedReason,
    expectedVersion,
    rootDir,
  });

  return {
    ok: true,
    action: normalizedAction,
    state_version: persisted.version,
    state_path: persisted.state_path,
    state: persisted,
    state_action: getExternalFactoryControlActiveAction(persisted),
  };
}
