import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { trim } from "./cli-helpers.ts";

export const MANAGED_SNAPSHOT_MIRROR_SCHEMA = "managed-factory-snapshot-mirror/v1";

function mirrorError(code, message = "") {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function normalizeScopedId(value = "", field = "id") {
  const normalized = trim(value);
  if (!normalized) {
    throw mirrorError(`missing_${field}`, `${field.replaceAll("_", "-")} is required`);
  }
  if (normalized.startsWith("/") || normalized.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(normalized)) {
    throw mirrorError(`invalid_${field}`, `${field.replaceAll("_", "-")} is invalid`);
  }
  return normalized;
}

function toNonNegativeInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
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

function normalizeBlockers(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const upstreamNumbers = Array.isArray(source?.upstream?.open_upstream_bug_numbers)
    ? source.upstream.open_upstream_bug_numbers
      .map((entry) => Number.parseInt(String(entry ?? "").trim(), 10))
      .filter((entry) => Number.isFinite(entry) && entry > 0)
    : [];

  return {
    upstream: {
      has_open_upstream_bugs: source?.upstream?.has_open_upstream_bugs === true,
      open_upstream_bug_count: toNonNegativeInt(source?.upstream?.open_upstream_bug_count, 0),
      open_upstream_bug_numbers: upstreamNumbers,
    },
    action_items: {
      has_action_items: source?.action_items?.has_action_items === true,
      action_item_count: toNonNegativeInt(source?.action_items?.action_item_count, 0),
    },
  };
}

function normalizeMirrorRecord({
  factoryId = "",
  instanceId = "",
  mirrorPath = "",
  snapshot = {},
  mirrorUpdatedAt = "",
} = {}) {
  const normalizedFactoryId = normalizeScopedId(factoryId, "factory_id");
  const normalizedInstanceId = normalizeScopedId(instanceId, "instance_id");
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  const blockers = normalizeBlockers(source.blockers);
  const stateVersion = toNonNegativeInt(source.state_version, 0);

  return {
    schema_version: MANAGED_SNAPSHOT_MIRROR_SCHEMA,
    factory_id: normalizedFactoryId,
    instance_id: normalizedInstanceId,
    mirror_version: stateVersion,
    mirror_updated_at: trim(mirrorUpdatedAt),
    mirror_path: trim(mirrorPath),
    state_version: stateVersion,
    lifecycle_state: trim(source.lifecycle_state),
    lifecycle_reason: trim(source.lifecycle_reason),
    lifecycle_failure_classification: trim(source.lifecycle_failure_classification),
    lifecycle_failure_reason: trim(source.lifecycle_failure_reason),
    lifecycle_updated_at: trim(source.lifecycle_updated_at),
    lifecycle_updated_by: trim(source.lifecycle_updated_by),
    action_item_count: toNonNegativeInt(source.action_item_count, blockers.action_items.action_item_count),
    blockers,
    unresolved_actions: toNonNegativeInt(source.unresolved_actions, 0),
    queue_depth: toNonNegativeInt(source.queue_depth, 0),
    oldest_work_age_seconds: toNonNegativeInt(source.oldest_work_age_seconds, 0),
    latest_incidents: normalizeLatestIncidents(source.latest_incidents),
  };
}

function parseJson(raw = "") {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeAtomicJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  renameSync(tmpPath, path);
}

export function resolveManagedSnapshotMirrorPath({
  factoryId = "",
  instanceId = "",
  rootDir = process.cwd(),
} = {}) {
  const normalizedFactoryId = normalizeScopedId(factoryId, "factory_id");
  const normalizedInstanceId = normalizeScopedId(instanceId, "instance_id");
  const base = resolve(rootDir || process.cwd());
  return join(base, ".hatch", "fleet", "mirrors", normalizedFactoryId, normalizedInstanceId, "snapshot.json");
}

export function writeManagedSnapshotMirror({
  factoryId = "",
  instanceId = "",
  snapshot = {},
  rootDir = process.cwd(),
  nowIso = new Date().toISOString(),
  writeAtomicJsonFn = writeAtomicJson,
} = {}) {
  const mirrorPath = resolveManagedSnapshotMirrorPath({
    factoryId,
    instanceId,
    rootDir,
  });

  const record = normalizeMirrorRecord({
    factoryId,
    instanceId,
    mirrorPath,
    snapshot,
    mirrorUpdatedAt: nowIso,
  });

  writeAtomicJsonFn(mirrorPath, record);
  return record;
}

export function readManagedSnapshotMirror({
  factoryId = "",
  instanceId = "",
  rootDir = process.cwd(),
} = {}) {
  const mirrorPath = resolveManagedSnapshotMirrorPath({
    factoryId,
    instanceId,
    rootDir,
  });

  if (!existsSync(mirrorPath)) {
    return normalizeMirrorRecord({
      factoryId,
      instanceId,
      mirrorPath,
      snapshot: {},
      mirrorUpdatedAt: "",
    });
  }

  const raw = readFileSync(mirrorPath, "utf8");
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw mirrorError("managed_snapshot_mirror_invalid_json", `failed_to_parse_mirror path=${mirrorPath}`);
  }

  return normalizeMirrorRecord({
    factoryId,
    instanceId,
    mirrorPath,
    snapshot: parsed,
    mirrorUpdatedAt: parsed.mirror_updated_at,
  });
}
