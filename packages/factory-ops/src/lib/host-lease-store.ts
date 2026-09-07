import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { FACTORY_OPS_ERROR_CODES, createFactoryOpsError } from "./error-catalog.ts";

const REQUIRED_LEASE_KEYS = Object.freeze([
  "instance_id",
  "installation_id",
  "host_id",
  "lease_owner",
  "lease_acquired_at",
  "lease_expires_at",
  "lease_ttl_sec",
  "runtime_version",
]);

function trim(value = "") {
  return String(value || "").trim();
}

function parseEpochMs(value) {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function toIsoUtc(value, { field = "timestamp" } = {}) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.lease_record_invalid, `${field}:invalid_epoch_ms`);
    }
    return new Date(Math.trunc(value)).toISOString();
  }

  const text = trim(value);
  if (!text) {
    throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.lease_record_invalid, `${field}:required`);
  }
  const parsed = parseEpochMs(text);
  if (!Number.isFinite(parsed)) {
    throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.lease_record_invalid, `${field}:invalid_iso`);
  }
  return new Date(parsed).toISOString();
}

function normalizeLeaseTtlSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.lease_record_invalid, "lease_ttl_sec:must_be_positive_number");
  }

  // Allow callers to pass millisecond TTL values (e.g. 600000ms) and normalize.
  const normalized = parsed > 86_400 && parsed % 1000 === 0
    ? parsed / 1000
    : parsed;
  return Math.max(1, Math.trunc(normalized));
}

function normalizeOptionalPid(value) {
  const text = trim(value);
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.lease_record_invalid, "pid:must_be_positive_integer");
  }
  return parsed;
}

function normalizeLeaseRecord(raw = {}) {
  const record = {
    instance_id: trim(raw.instance_id || raw.instanceId),
    installation_id: trim(raw.installation_id || raw.installationId),
    host_id: trim(raw.host_id || raw.hostId),
    pid: normalizeOptionalPid(raw.pid),
    lease_owner: trim(raw.lease_owner || raw.leaseOwner),
    lease_acquired_at: toIsoUtc(raw.lease_acquired_at ?? raw.leaseAcquiredAt, { field: "lease_acquired_at" }),
    lease_expires_at: toIsoUtc(raw.lease_expires_at ?? raw.leaseExpiresAt, { field: "lease_expires_at" }),
    lease_ttl_sec: normalizeLeaseTtlSeconds(raw.lease_ttl_sec ?? raw.leaseTtlSec),
    runtime_version: trim(raw.runtime_version || raw.runtimeVersion),
  };

  for (const key of REQUIRED_LEASE_KEYS) {
    if (!trim(record[key])) {
      throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.lease_record_invalid, `missing_required_field:${key}`);
    }
  }

  const acquiredMs = parseEpochMs(record.lease_acquired_at);
  const expiresMs = parseEpochMs(record.lease_expires_at);
  if (!Number.isFinite(acquiredMs) || !Number.isFinite(expiresMs) || expiresMs <= acquiredMs) {
    throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.lease_record_invalid, "lease_window_invalid");
  }

  return record;
}

export function resolveLeaseRecordPath(paths = {}) {
  if (typeof paths === "string") return resolve(paths);

  const explicit = trim(paths.leaseRecordPath || paths.lease_record_path || "");
  if (explicit) return resolve(explicit);

  const installationManifestPath = trim(paths.installationManifestPath || paths.installation_manifest_path || "");
  if (!installationManifestPath) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.lease_record_path_required,
      "lease_record_path_requires_installation_manifest_path",
    );
  }

  return resolve(dirname(installationManifestPath), "lease.json");
}

function writeAtomicJson(filePath, payload = {}) {
  const target = resolve(filePath);
  const parentDir = dirname(target);
  mkdirSync(parentDir, { recursive: true });

  const tmpPath = resolve(parentDir, `.lease.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`);
    renameSync(tmpPath, target);
  } catch (error) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.lease_record_write_failed,
      `lease_record_write_failed:${String(error?.message || error || "unknown_error")}`,
    );
  }
}

export function writeLeaseRecord(raw = {}, paths = {}) {
  const leaseRecordPath = resolveLeaseRecordPath(paths || raw);
  const lease = normalizeLeaseRecord(raw);
  writeAtomicJson(leaseRecordPath, lease);
  return {
    leaseRecordPath,
    lease,
  };
}

export function readLeaseRecord(paths = {}) {
  const leaseRecordPath = resolveLeaseRecordPath(paths);
  if (!existsSync(leaseRecordPath)) {
    return {
      leaseRecordPath,
      lease: null,
      exists: false,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(leaseRecordPath, "utf8"));
  } catch (error) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.lease_record_invalid,
      `lease_record_malformed_json:${String(error?.message || error || "invalid_json")}`,
    );
  }

  const lease = normalizeLeaseRecord(parsed);
  return {
    leaseRecordPath,
    lease,
    exists: true,
  };
}
