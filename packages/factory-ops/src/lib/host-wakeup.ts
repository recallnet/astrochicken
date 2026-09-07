import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { trim } from "./cli-helpers.ts";
import { readMirroredSnapshot, readRecentEvents } from "./factory-mirror-reader.ts";

export const HOST_RUNTIME_WAKEUP_STATE_SCHEMA = "hatch.host.runtime.wakeup_state.v1";

const DEFAULT_WAKEUP_STATE = Object.freeze({
  installation_id: "",
  instance_id: "",
  latest_event_cursor: "",
  latest_event_type: "",
  latest_snapshot_cursor: "",
  latest_incident_cursor: "",
  last_polled_at: "",
});

const WAKE_SOURCE_ORDER = Object.freeze([
  "intake_activity",
  "incident_blocker",
  "policy_registry_delta",
  "reconcile_timer",
]);

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

function toInteger(value, fallback = 0, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.min(max, Math.max(min, Math.trunc(fallback)));
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function parseEpochMs(value = "") {
  const parsed = Date.parse(trim(value));
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

function resolveReconcileIntervalMs(env = process.env) {
  const seconds = toInteger(env?.HATCH_HOST_RECONCILE_INTERVAL_SEC, 60, { min: 5, max: 86_400 });
  return seconds * 1000;
}

function resolveWakeupEventLimit(env = process.env) {
  return toInteger(env?.HATCH_HOST_WAKEUP_EVENT_LIMIT, 20, { min: 1, max: 500 });
}

function normalizeWakeSourceList(value = []) {
  const set = new Set();
  for (const entry of Array.isArray(value) ? value : []) {
    const normalized = trim(entry);
    if (!normalized) continue;
    if (!WAKE_SOURCE_ORDER.includes(normalized)) continue;
    set.add(normalized);
  }
  return [...set].sort((left, right) => WAKE_SOURCE_ORDER.indexOf(left) - WAKE_SOURCE_ORDER.indexOf(right));
}

function normalizeRegistryCursor(value = {}) {
  const source = isObject(value) ? value : {};
  return {
    path: trim(source.path),
    exists: source.exists === true,
    mtime_ms: toInteger(source.mtime_ms, 0, { min: 0, max: Number.MAX_SAFE_INTEGER }),
    size: toInteger(source.size, 0, { min: 0, max: Number.MAX_SAFE_INTEGER }),
  };
}

function normalizeInstallationWakeupEntry(entry = {}, fallback = {}) {
  const merged = {
    ...DEFAULT_WAKEUP_STATE,
    ...(isObject(fallback) ? fallback : {}),
    ...(isObject(entry) ? entry : {}),
  };

  return {
    installation_id: trim(merged.installation_id),
    instance_id: trim(merged.instance_id),
    latest_event_cursor: trim(merged.latest_event_cursor),
    latest_event_type: trim(merged.latest_event_type),
    latest_snapshot_cursor: trim(merged.latest_snapshot_cursor),
    latest_incident_cursor: trim(merged.latest_incident_cursor),
    last_polled_at: normalizeIsoTimestamp(merged.last_polled_at),
  };
}

function normalizeInstallations(value = {}) {
  const normalized = {};
  const entries = isObject(value) ? Object.entries(value) : [];
  for (const [key, raw] of entries) {
    const installationId = trim(key);
    if (!installationId) continue;
    normalized[installationId] = normalizeInstallationWakeupEntry(raw, {
      installation_id: installationId,
    });
  }
  return normalized;
}

export function normalizeHostWakeupState(state = {}, { hostId = "" } = {}) {
  const source = isObject(state) ? state : {};
  const normalizedHostId = trim(source.host_id || hostId);

  return {
    schema: HOST_RUNTIME_WAKEUP_STATE_SCHEMA,
    host_id: normalizedHostId,
    updated_at: normalizeIsoTimestamp(source.updated_at) || new Date().toISOString(),
    last_poll_at: normalizeIsoTimestamp(source.last_poll_at),
    last_reconcile_at: normalizeIsoTimestamp(source.last_reconcile_at),
    next_reconcile_at: normalizeIsoTimestamp(source.next_reconcile_at),
    last_wake_sources: normalizeWakeSourceList(source.last_wake_sources),
    registry_cursor: normalizeRegistryCursor(source.registry_cursor),
    poll_errors: Array.isArray(source.poll_errors)
      ? source.poll_errors.map((entry) => trim(entry)).filter(Boolean)
      : [],
    installations: normalizeInstallations(source.installations),
  };
}

export function resolveHostWakeupStatePath({ paths = {} } = {}) {
  const explicit = trim(paths.wakeupStatePath || paths.wakeup_state_path || "");
  if (explicit) return path.resolve(explicit);

  const runtimeDir = trim(paths.runtimeDir || paths.runtime_dir || "");
  if (runtimeDir) return path.resolve(runtimeDir, "wakeup-state.json");

  const baseDir = trim(paths.baseDir || paths.base_dir || "");
  if (baseDir) return path.resolve(baseDir, "runtime", "wakeup-state.json");

  return path.resolve("wakeup-state.json");
}

export function loadHostWakeupState({ paths = {}, hostId = "" } = {}) {
  const wakeupStatePath = resolveHostWakeupStatePath({ paths });
  if (!existsSync(wakeupStatePath)) {
    return {
      exists: false,
      wakeupStatePath,
      state: normalizeHostWakeupState({}, { hostId }),
    };
  }

  const parsed = parseJson(readFileSync(wakeupStatePath, "utf8"), {});
  return {
    exists: true,
    wakeupStatePath,
    state: normalizeHostWakeupState(parsed, { hostId }),
  };
}

function writeAtomicJson(targetPath = "", payload = {}) {
  const normalizedPath = path.resolve(targetPath);
  mkdirSync(path.dirname(normalizedPath), { recursive: true });
  const tmpPath = `${normalizedPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`);
  renameSync(tmpPath, normalizedPath);
}

export function writeHostWakeupState({ paths = {}, state = {} } = {}) {
  const wakeupStatePath = resolveHostWakeupStatePath({ paths });
  const normalizedState = normalizeHostWakeupState(state, {
    hostId: trim(state.host_id),
  });
  writeAtomicJson(wakeupStatePath, normalizedState);
  return {
    wakeupStatePath,
    state: normalizedState,
  };
}

function classifyEventWakeSource(event = {}) {
  const eventType = trim(event.event_type).toLowerCase();
  if (trim(event.incident_fingerprint)) return "incident_blocker";
  if (eventType.includes("incident") || eventType.includes("blocker")) return "incident_blocker";
  if (eventType.includes("intake") || eventType.includes("issue") || eventType.includes("queue")) return "intake_activity";
  return "";
}

function buildEventCursor(event = {}) {
  return [
    trim(event.event_type),
    trim(event.status),
    trim(event.run_id),
    trim(event.tick_id),
    trim(event.ended_at || event.started_at),
  ].join("|");
}

function buildSnapshotCursor(snapshot = {}) {
  const blockers = isObject(snapshot.blockers) ? snapshot.blockers : {};
  const upstream = isObject(blockers.upstream) ? blockers.upstream : {};
  const actionItems = isObject(blockers.action_items) ? blockers.action_items : {};
  const incidents = Array.isArray(snapshot.latest_incidents)
    ? snapshot.latest_incidents
      .map((entry) => ({
        incident_fingerprint: trim(entry?.incident_fingerprint),
        severity: trim(entry?.severity),
      }))
      .filter((entry) => entry.incident_fingerprint)
      .sort((left, right) => left.incident_fingerprint.localeCompare(right.incident_fingerprint, "en"))
    : [];

  return JSON.stringify({
    mirror_updated_at: trim(snapshot.mirror_updated_at),
    state_version: toInteger(snapshot.state_version, 0, { min: 0 }),
    action_item_count: toInteger(snapshot.action_item_count, 0, { min: 0 }),
    unresolved_actions: toInteger(snapshot.unresolved_actions, 0, { min: 0 }),
    upstream_count: toInteger(upstream.open_upstream_bug_count, 0, { min: 0 }),
    action_items_count: toInteger(actionItems.action_item_count, 0, { min: 0 }),
    incidents,
  });
}

function resolveRegistryCursor({ paths = {}, env = process.env } = {}) {
  const registryPath = trim(env?.HATCH_FACTORY_REGISTRY_PATH || "factory-registry.json");
  const registryCwd = trim(env?.HATCH_FACTORY_REGISTRY_CWD || paths.repoRoot || process.cwd());
  const absolutePath = path.resolve(registryCwd, registryPath);
  if (!existsSync(absolutePath)) {
    return {
      path: absolutePath,
      exists: false,
      mtime_ms: 0,
      size: 0,
    };
  }

  const stats = statSync(absolutePath);
  return {
    path: absolutePath,
    exists: true,
    mtime_ms: toInteger(Math.trunc(stats.mtimeMs), 0, { min: 0 }),
    size: toInteger(stats.size, 0, { min: 0 }),
  };
}

function registryCursorChanged(previous = {}, next = {}) {
  const left = normalizeRegistryCursor(previous);
  const right = normalizeRegistryCursor(next);
  return left.path !== right.path
    || left.exists !== right.exists
    || left.mtime_ms !== right.mtime_ms
    || left.size !== right.size;
}

function resolveMirrorDir(factoryId = "", { paths = {}, env = process.env } = {}) {
  const baseMirrorDir = trim(env?.HATCH_HOST_WAKEUP_MIRROR_DIR || paths.wakeupMirrorDir || paths.wakeup_mirror_dir || "");
  if (!baseMirrorDir) return "";

  const resolvedBase = path.resolve(baseMirrorDir);
  const nested = path.resolve(resolvedBase, factoryId);
  if (existsSync(nested)) return nested;
  return resolvedBase;
}

function toWakeSourceList(set = new Set()) {
  return [...set]
    .filter((entry) => WAKE_SOURCE_ORDER.includes(entry))
    .sort((left, right) => WAKE_SOURCE_ORDER.indexOf(left) - WAKE_SOURCE_ORDER.indexOf(right));
}

export function summarizeHostWakeupState({ state = {} } = {}) {
  const normalizedState = normalizeHostWakeupState(state, {
    hostId: trim(state?.host_id),
  });

  const installationEntries = Object.values(normalizedState.installations || {})
    .map((entry) => normalizeInstallationWakeupEntry(entry))
    .sort((left, right) => left.installation_id.localeCompare(right.installation_id, "en"));

  return {
    host_id: normalizedState.host_id,
    updated_at: normalizedState.updated_at,
    last_poll_at: normalizedState.last_poll_at,
    last_reconcile_at: normalizedState.last_reconcile_at,
    next_reconcile_at: normalizedState.next_reconcile_at,
    last_wake_sources: normalizedState.last_wake_sources,
    registry_cursor: normalizedState.registry_cursor,
    poll_errors: normalizedState.poll_errors,
    installation_count: installationEntries.length,
    installations: installationEntries,
  };
}

export function pollHostWakeups({
  hostId = "",
  installations = [],
  previousState = {},
  paths = {},
  env = process.env,
  nowEpochMs = Date.now(),
} = {}) {
  const nowIso = new Date(nowEpochMs).toISOString();
  const normalizedHostId = trim(hostId);
  const reconcileIntervalMs = resolveReconcileIntervalMs(env);
  const wakeupEventLimit = resolveWakeupEventLimit(env);
  const normalizedPreviousState = normalizeHostWakeupState(previousState, {
    hostId: normalizedHostId,
  });

  const wakeSources = new Set();
  const pollErrors = [];
  const nextInstallations = {};

  const registryCursor = resolveRegistryCursor({ paths, env });
  if (registryCursorChanged(normalizedPreviousState.registry_cursor, registryCursor)) {
    wakeSources.add("policy_registry_delta");
  }

  for (const installation of Array.isArray(installations) ? installations : []) {
    const installationId = trim(installation?.installation_id);
    if (!installationId) continue;

    const instanceId = trim(installation?.instance_id);
    const previousEntry = normalizeInstallationWakeupEntry(
      normalizedPreviousState.installations?.[installationId],
      {
        installation_id: installationId,
        instance_id: instanceId,
      },
    );

    const nextEntry = {
      ...previousEntry,
      installation_id: installationId,
      instance_id: instanceId,
      last_polled_at: nowIso,
    };

    const mirrorFactoryId = instanceId || installationId;
    const mirrorDir = resolveMirrorDir(mirrorFactoryId, { paths, env });
    const readerOptions = {
      mirrorDir,
      rootDir: trim(paths.repoRoot || process.cwd()),
    };

    try {
      const eventsPayload = readRecentEvents(mirrorFactoryId, {
        ...readerOptions,
        limit: wakeupEventLimit,
      });
      const latestEvent = Array.isArray(eventsPayload.events) ? eventsPayload.events[0] : null;
      if (latestEvent) {
        const nextEventCursor = buildEventCursor(latestEvent);
        if (nextEventCursor && nextEventCursor !== previousEntry.latest_event_cursor && previousEntry.latest_event_cursor) {
          const wakeSource = classifyEventWakeSource(latestEvent);
          if (wakeSource) wakeSources.add(wakeSource);
        }

        nextEntry.latest_event_cursor = nextEventCursor;
        nextEntry.latest_event_type = trim(latestEvent.event_type);
      }
    } catch (error) {
      const code = trim(error?.code);
      if (code !== "mirror_missing") {
        pollErrors.push(`events_read_failed:${installationId}:${code || "unknown"}`);
      }
    }

    try {
      const snapshotPayload = readMirroredSnapshot(mirrorFactoryId, readerOptions);
      const targetSnapshot = Array.isArray(snapshotPayload.snapshots)
        ? (
          snapshotPayload.snapshots.find((entry) => trim(entry.instance_id) === instanceId)
          || snapshotPayload.snapshots[0]
          || null
        )
        : null;

      if (targetSnapshot) {
        const nextSnapshotCursor = buildSnapshotCursor(targetSnapshot);
        if (
          nextSnapshotCursor
          && nextSnapshotCursor !== previousEntry.latest_snapshot_cursor
          && previousEntry.latest_snapshot_cursor
        ) {
          wakeSources.add("incident_blocker");
        }

        nextEntry.latest_snapshot_cursor = nextSnapshotCursor;
        nextEntry.latest_incident_cursor = Array.isArray(targetSnapshot.latest_incidents)
          ? targetSnapshot.latest_incidents
            .map((entry) => `${trim(entry?.incident_fingerprint)}:${trim(entry?.severity)}`)
            .filter(Boolean)
            .sort((left, right) => left.localeCompare(right, "en"))
            .join(",")
          : "";
      }
    } catch (error) {
      const code = trim(error?.code);
      if (code !== "mirror_missing") {
        pollErrors.push(`snapshot_read_failed:${installationId}:${code || "unknown"}`);
      }
    }

    nextInstallations[installationId] = normalizeInstallationWakeupEntry(nextEntry);
  }

  const previousNextReconcileMs = parseEpochMs(normalizedPreviousState.next_reconcile_at);
  const reconcileDue = !Number.isFinite(previousNextReconcileMs) || previousNextReconcileMs <= nowEpochMs;
  if (reconcileDue) {
    wakeSources.add("reconcile_timer");
  }

  const nextReconcileAtMs = reconcileDue
    ? nowEpochMs + reconcileIntervalMs
    : previousNextReconcileMs;

  const wakeSourceList = toWakeSourceList(wakeSources);
  const nextState = normalizeHostWakeupState({
    schema: normalizedPreviousState.schema,
    host_id: normalizedHostId,
    updated_at: nowIso,
    last_poll_at: nowIso,
    last_reconcile_at: reconcileDue ? nowIso : normalizedPreviousState.last_reconcile_at,
    next_reconcile_at: Number.isFinite(nextReconcileAtMs)
      ? new Date(nextReconcileAtMs).toISOString()
      : new Date(nowEpochMs + reconcileIntervalMs).toISOString(),
    last_wake_sources: wakeSourceList,
    registry_cursor: registryCursor,
    poll_errors: pollErrors,
    installations: nextInstallations,
  }, {
    hostId: normalizedHostId,
  });

  return {
    host_id: normalizedHostId,
    at: nowIso,
    triggered: wakeSourceList.length > 0,
    wake_sources: wakeSourceList,
    poll_errors: pollErrors,
    next_reconcile_at: nextState.next_reconcile_at,
    state: nextState,
    summary: summarizeHostWakeupState({ state: nextState }),
  };
}
