import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const AUDIT_V1_SCHEMA = "audit.v1";
export const AUDIT_V1_ACTIONS = Object.freeze([
  "issue_create",
  "issue_close",
  "issue_label",
  "comment_create",
]);

const AUDIT_ACTION_SET = new Set(AUDIT_V1_ACTIONS);

function trim(value = "") {
  return String(value || "").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value = "", field = "") {
  const normalized = trim(value);
  if (!normalized) {
    throw new Error(`audit_record_missing_required_field:${field}`);
  }
  return normalized;
}

function normalizeAuditRecord(record = {}) {
  return {
    schema: trim(record.schema),
    instance_id: trim(record.instance_id),
    installation_id: trim(record.installation_id),
    host_id: trim(record.host_id),
    run_id: trim(record.run_id),
    tick_id: trim(record.tick_id),
    action: trim(record.action).toLowerCase(),
    target_repo: trim(record.target_repo),
    target_ref: trim(record.target_ref),
    destination_name: trim(record.destination_name),
    capability_version: trim(record.capability_version),
    policy_profile: trim(record.policy_profile),
    runtime_version: trim(record.runtime_version),
    timestamp: trim(record.timestamp),
  };
}

function resolveHostBaseDir({ hostBaseDir = "", homeDir = homedir() } = {}) {
  const explicit = trim(hostBaseDir || process.env.HATCH_HOST_BASE_DIR || "");
  const fallback = path.join(homeDir, ".hatch-hosts");
  return path.resolve(explicit || fallback);
}

export function resolveAuditLogPath({ hostId = "", hostBaseDir = "", homeDir = homedir() } = {}) {
  const normalizedHostId = requireString(
    hostId || process.env.HATCH_HOST_ID || process.env.HOST_ID || "",
    "host_id",
  );
  return path.join(resolveHostBaseDir({ hostBaseDir, homeDir }), normalizedHostId, "audit", "audit.v1.log");
}

function parseActionFilter(actionFilter = "") {
  const entries = Array.isArray(actionFilter)
    ? actionFilter
    : String(actionFilter || "").split(",");
  const actions = entries
    .map((entry) => trim(entry).toLowerCase())
    .filter(Boolean);
  for (const action of actions) {
    if (!AUDIT_ACTION_SET.has(action)) {
      throw new Error(`audit_action_invalid:${action}`);
    }
  }
  return new Set(actions);
}

function parseTimeBound(value = "", errorPrefix = "audit_since_invalid") {
  const normalized = trim(value);
  if (!normalized) return 0;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${errorPrefix}:${normalized}`);
  }
  return parsed;
}

function parseSince(since = "") {
  return parseTimeBound(since, "audit_since_invalid");
}

function parseUntil(until = "") {
  return parseTimeBound(until, "audit_to_invalid");
}

function resolveAuditLogPaths({
  hostId = "",
  hostBaseDir = "",
  logPath = "",
  homeDir = homedir(),
  existsSyncFn = existsSync,
  readdirSyncFn = readdirSync,
} = {}) {
  const explicitLogPath = trim(logPath);
  if (explicitLogPath) return [path.resolve(explicitLogPath)];

  const normalizedHostId = trim(hostId || process.env.HATCH_HOST_ID || process.env.HOST_ID || "");
  if (normalizedHostId) {
    return [resolveAuditLogPath({ hostId: normalizedHostId, hostBaseDir, homeDir })];
  }

  const baseDir = resolveHostBaseDir({ hostBaseDir, homeDir });
  if (!existsSyncFn(baseDir)) return [];

  const paths = [];
  for (const entry of readdirSyncFn(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(baseDir, entry.name, "audit", "audit.v1.log");
    if (existsSyncFn(candidate)) paths.push(candidate);
  }

  return paths.sort((left, right) => left.localeCompare(right));
}

export function validateAuditRecord(record = {}) {
  if (!isPlainObject(record)) {
    throw new Error("audit_record_invalid_shape");
  }

  const normalized = normalizeAuditRecord(record);

  requireString(normalized.schema, "schema");
  requireString(normalized.instance_id, "instance_id");
  requireString(normalized.installation_id, "installation_id");
  requireString(normalized.host_id, "host_id");
  requireString(normalized.run_id, "run_id");
  requireString(normalized.tick_id, "tick_id");
  requireString(normalized.action, "action");
  requireString(normalized.target_repo, "target_repo");
  requireString(normalized.target_ref, "target_ref");
  requireString(normalized.destination_name, "destination_name");
  requireString(normalized.capability_version, "capability_version");
  requireString(normalized.policy_profile, "policy_profile");
  requireString(normalized.runtime_version, "runtime_version");
  requireString(normalized.timestamp, "timestamp");

  if (normalized.schema !== AUDIT_V1_SCHEMA) {
    throw new Error(`audit_record_schema_unsupported:${normalized.schema}`);
  }
  if (!AUDIT_ACTION_SET.has(normalized.action)) {
    throw new Error(`audit_record_invalid_action:${normalized.action}`);
  }

  const timestampMs = Date.parse(normalized.timestamp);
  if (!Number.isFinite(timestampMs)) {
    throw new Error(`audit_record_invalid_timestamp:${normalized.timestamp}`);
  }

  return {
    ...normalized,
    timestamp: new Date(timestampMs).toISOString(),
  };
}

export function appendAuditRecord(record = {}, {
  hostBaseDir = "",
  logPath = "",
  homeDir = homedir(),
  mkdirSyncFn = mkdirSync,
  appendFileSyncFn = appendFileSync,
} = {}) {
  const normalizedRecord = validateAuditRecord(record);
  const resolvedLogPath = trim(logPath)
    || resolveAuditLogPath({
      hostId: normalizedRecord.host_id,
      hostBaseDir,
      homeDir,
    });

  mkdirSyncFn(path.dirname(resolvedLogPath), { recursive: true });
  appendFileSyncFn(resolvedLogPath, `${JSON.stringify(normalizedRecord)}\n`, "utf8");

  return {
    ok: true,
    log_path: resolvedLogPath,
    record: normalizedRecord,
  };
}

export function readAuditRecords({
  instanceId = "",
  since = "",
  until = "",
  actionFilter = "",
  hostId = "",
  hostBaseDir = "",
  logPath = "",
  homeDir = homedir(),
  readFileSyncFn = readFileSync,
  existsSyncFn = existsSync,
  readdirSyncFn = readdirSync,
} = {}) {
  const sinceEpochMs = parseSince(since);
  const untilEpochMs = parseUntil(until);
  if (sinceEpochMs > 0 && untilEpochMs > 0 && untilEpochMs < sinceEpochMs) {
    throw new Error(`audit_time_range_invalid:${trim(since)}..${trim(until)}`);
  }

  const actionSet = parseActionFilter(actionFilter);
  const normalizedInstanceId = trim(instanceId);
  const normalizedHostId = trim(hostId);
  const logPaths = resolveAuditLogPaths({
    hostId,
    hostBaseDir,
    logPath,
    homeDir,
    existsSyncFn,
    readdirSyncFn,
  });

  const records = [];

  for (const currentLogPath of logPaths) {
    if (!existsSyncFn(currentLogPath)) continue;

    const lines = String(readFileSyncFn(currentLogPath, "utf8") || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      let record;
      try {
        record = validateAuditRecord(parsed);
      } catch {
        continue;
      }

      if (normalizedInstanceId && record.instance_id !== normalizedInstanceId) continue;
      if (normalizedHostId && record.host_id !== normalizedHostId) continue;
      if (actionSet.size > 0 && !actionSet.has(record.action)) continue;

      const timestampMs = Date.parse(record.timestamp);
      if (sinceEpochMs > 0 && timestampMs < sinceEpochMs) continue;
      if (untilEpochMs > 0 && timestampMs > untilEpochMs) continue;

      records.push(record);
    }
  }

  records.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));

  return {
    records,
    log_paths: logPaths,
  };
}
