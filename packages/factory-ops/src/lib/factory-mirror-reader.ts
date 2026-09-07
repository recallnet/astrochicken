import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parseJson, trim } from "./cli-helpers.ts";

const DEFAULT_EVENT_LIMIT = 20;
const EVENT_FILE_CANDIDATES = Object.freeze([
  "events.json",
  "events.jsonl",
  "recent-events.json",
]);

function mirrorError(code, message = "") {
  const error = new Error(trim(message) || trim(code) || "factory_mirror_error");
  error.code = trim(code) || "factory_mirror_error";
  return error;
}

function normalizeFactoryId(factoryId = "") {
  const normalized = trim(factoryId);
  if (!normalized) {
    throw mirrorError("missing_factory_id", "factory-id is required");
  }
  if (normalized.startsWith("/") || normalized.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(normalized)) {
    throw mirrorError("invalid_factory_id", "factory-id is invalid");
  }
  return normalized;
}

function normalizeNonNegativeInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function normalizeLimit(value = DEFAULT_EVENT_LIMIT) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_EVENT_LIMIT;
  return parsed;
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

function normalizeSnapshotBlockers(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const upstreamNumbers = Array.isArray(source?.upstream?.open_upstream_bug_numbers)
    ? source.upstream.open_upstream_bug_numbers
      .map((entry) => Number.parseInt(String(entry ?? "").trim(), 10))
      .filter((entry) => Number.isFinite(entry) && entry > 0)
    : [];

  return {
    upstream: {
      has_open_upstream_bugs: source?.upstream?.has_open_upstream_bugs === true,
      open_upstream_bug_count: normalizeNonNegativeInt(source?.upstream?.open_upstream_bug_count, 0),
      open_upstream_bug_numbers: upstreamNumbers,
    },
    action_items: {
      has_action_items: source?.action_items?.has_action_items === true,
      action_item_count: normalizeNonNegativeInt(source?.action_items?.action_item_count, 0),
    },
  };
}

function resolvePath(rootDir = process.cwd(), value = "") {
  const candidate = trim(value);
  if (!candidate) return "";
  if (candidate.startsWith("/")) return resolve(candidate);
  return resolve(rootDir || process.cwd(), candidate);
}

function readJsonObject(path = "") {
  const raw = readFileSync(path, "utf8");
  const parsed = parseJson(raw, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw mirrorError("mirror_invalid_json", `failed_to_parse_json path=${path}`);
  }
  return parsed;
}

function readJsonArray(path = "") {
  const raw = readFileSync(path, "utf8");
  const parsed = parseJson(raw, null);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.events)) {
    return parsed.events;
  }
  throw mirrorError("mirror_invalid_json", `failed_to_parse_json_array path=${path}`);
}

function readJsonLines(path = "") {
  const raw = String(readFileSync(path, "utf8") || "");
  const entries = [];
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const normalized = trim(line);
    if (!normalized) continue;
    const parsed = parseJson(normalized, null);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw mirrorError("mirror_invalid_json", `failed_to_parse_jsonl path=${path}`);
    }
    entries.push(parsed);
  }
  return entries;
}

function resolveEventsPath(mirrorRoot = "") {
  for (const candidate of EVENT_FILE_CANDIDATES) {
    const fullPath = join(mirrorRoot, candidate);
    if (existsSync(fullPath)) return fullPath;
  }
  return "";
}

function toEpochMs(value = "") {
  const parsed = Date.parse(trim(value));
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function normalizeSnapshotRecord(record = {}, { factoryId = "", instanceId = "", snapshotPath = "" } = {}) {
  const source = record && typeof record === "object" && !Array.isArray(record) ? record : {};
  const blockers = normalizeSnapshotBlockers(source.blockers);

  return {
    schema_version: trim(source.schema_version),
    factory_id: trim(source.factory_id || factoryId),
    instance_id: trim(source.instance_id || instanceId),
    mirror_path: trim(source.mirror_path || snapshotPath),
    mirror_version: normalizeNonNegativeInt(source.mirror_version, normalizeNonNegativeInt(source.state_version, 0)),
    mirror_updated_at: trim(source.mirror_updated_at),
    state_version: normalizeNonNegativeInt(source.state_version, 0),
    lifecycle_state: trim(source.lifecycle_state),
    lifecycle_reason: trim(source.lifecycle_reason),
    lifecycle_failure_classification: trim(source.lifecycle_failure_classification),
    lifecycle_failure_reason: trim(source.lifecycle_failure_reason),
    lifecycle_updated_at: trim(source.lifecycle_updated_at),
    lifecycle_updated_by: trim(source.lifecycle_updated_by),
    action_item_count: normalizeNonNegativeInt(source.action_item_count, blockers.action_items.action_item_count),
    blockers,
    unresolved_actions: normalizeNonNegativeInt(source.unresolved_actions, 0),
    queue_depth: normalizeNonNegativeInt(source.queue_depth, 0),
    oldest_work_age_seconds: normalizeNonNegativeInt(source.oldest_work_age_seconds, 0),
    latest_incidents: normalizeLatestIncidents(source.latest_incidents),
  };
}

function normalizeEventRecord(record = {}, { factoryId = "", index = 0 } = {}) {
  const source = record && typeof record === "object" && !Array.isArray(record) ? record : {};
  const startedAt = trim(source.started_at);
  const endedAt = trim(source.ended_at);
  const sortKey = toEpochMs(endedAt) || toEpochMs(startedAt) || index;

  return {
    schema_version: trim(source.schema_version),
    factory_id: trim(source.factory_id || factoryId),
    instance_id: trim(source.instance_id),
    installation_id: trim(source.installation_id),
    host_id: trim(source.host_id),
    kind_id: trim(source.kind_id),
    run_id: trim(source.run_id),
    tick_id: trim(source.tick_id),
    event_type: trim(source.event_type),
    status: trim(source.status),
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: normalizeNonNegativeInt(source.duration_ms, 0),
    incident_fingerprint: trim(source.incident_fingerprint),
    runtime_version: trim(source.runtime_version),
    kind_version: trim(source.kind_version),
    policy_profile: trim(source.policy_profile),
    _sort_key: sortKey,
  };
}

export function resolveFactoryMirrorRoot({
  factoryId = "",
  mirrorDir = "",
  context = {},
  rootDir = process.cwd(),
} = {}) {
  const normalizedFactoryId = normalizeFactoryId(factoryId);
  const explicitMirrorRoot = trim(mirrorDir)
    || trim(context?.mirror_dir)
    || trim(context?.mirrorDir)
    || trim(context?.mirrorPath)
    || trim(process.env.FACTORY_MIRROR_DIR)
    || trim(process.env.HATCH_FACTORY_MIRROR_DIR);

  if (explicitMirrorRoot) {
    return resolvePath(rootDir, explicitMirrorRoot);
  }

  const repoRoot = resolve(rootDir || process.cwd());
  const fleetMirrorRoot = join(repoRoot, ".hatch", "fleet", "mirrors", normalizedFactoryId);
  if (existsSync(fleetMirrorRoot)) {
    return fleetMirrorRoot;
  }

  return join(repoRoot, ".hatch", "managed-mirror", normalizedFactoryId);
}

export function readMirroredSnapshot(factoryId = "", {
  mirrorDir = "",
  context = {},
  rootDir = process.cwd(),
} = {}) {
  const normalizedFactoryId = normalizeFactoryId(factoryId);
  const mirrorRoot = resolveFactoryMirrorRoot({
    factoryId: normalizedFactoryId,
    mirrorDir,
    context,
    rootDir,
  });

  if (!existsSync(mirrorRoot)) {
    throw mirrorError("mirror_missing", `mirror_root_missing path=${mirrorRoot}`);
  }

  const snapshots = [];
  const entries = readdirSync(mirrorRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const instanceId = trim(entry.name);
    if (!instanceId) continue;
    const snapshotPath = join(mirrorRoot, instanceId, "snapshot.json");
    if (!existsSync(snapshotPath)) continue;

    const parsed = readJsonObject(snapshotPath);
    snapshots.push(normalizeSnapshotRecord(parsed, {
      factoryId: normalizedFactoryId,
      instanceId,
      snapshotPath,
    }));
  }

  if (snapshots.length === 0) {
    throw mirrorError("mirror_missing", `snapshot_missing path=${mirrorRoot}`);
  }

  snapshots.sort((left, right) => {
    const leftTime = toEpochMs(left.mirror_updated_at);
    const rightTime = toEpochMs(right.mirror_updated_at);
    if (rightTime !== leftTime) return rightTime - leftTime;
    return String(left.instance_id).localeCompare(String(right.instance_id));
  });

  return {
    factory_id: normalizedFactoryId,
    mirror_root: mirrorRoot,
    snapshot_count: snapshots.length,
    snapshots,
  };
}

export function readRecentEvents(factoryId = "", {
  limit = DEFAULT_EVENT_LIMIT,
  mirrorDir = "",
  context = {},
  rootDir = process.cwd(),
} = {}) {
  const normalizedFactoryId = normalizeFactoryId(factoryId);
  const mirrorRoot = resolveFactoryMirrorRoot({
    factoryId: normalizedFactoryId,
    mirrorDir,
    context,
    rootDir,
  });

  if (!existsSync(mirrorRoot)) {
    throw mirrorError("mirror_missing", `mirror_root_missing path=${mirrorRoot}`);
  }

  const eventsPath = resolveEventsPath(mirrorRoot);
  if (!eventsPath) {
    throw mirrorError("mirror_missing", `events_missing path=${mirrorRoot}`);
  }

  const eventRows = eventsPath.endsWith(".jsonl")
    ? readJsonLines(eventsPath)
    : readJsonArray(eventsPath);

  const normalizedEvents = eventRows
    .map((entry, index) => normalizeEventRecord(entry, { factoryId: normalizedFactoryId, index }))
    .sort((left, right) => right._sort_key - left._sort_key);

  const normalizedLimit = normalizeLimit(limit);
  const events = normalizedEvents
    .slice(0, normalizedLimit)
    .map(({ _sort_key: _sortKey, ...event }) => event);

  return {
    factory_id: normalizedFactoryId,
    mirror_root: mirrorRoot,
    events_path: eventsPath,
    total_events: normalizedEvents.length,
    limit: normalizedLimit,
    events,
  };
}
