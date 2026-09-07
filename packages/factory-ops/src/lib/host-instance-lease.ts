import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  readLeaseRecord as readPersistedLeaseRecord,
  resolveLeaseRecordPath,
  writeLeaseRecord as writePersistedLeaseRecord,
} from "./host-lease-store.ts";

export const HOST_INSTANCE_LEASE_SCHEMA_VERSION = "hatch.host.instance_lease.v1";

export const HOST_INSTANCE_LEASE_REQUIRED_FIELDS = Object.freeze([
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

function parseEpochMs(value = "") {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function normalizeIsoTimestamp(value, fallbackMs = Date.now()) {
  if (value instanceof Date) return value.toISOString();

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(Math.trunc(numeric)).toISOString();
  }

  const text = trim(value);
  if (!text) return new Date(fallbackMs).toISOString();

  const parsed = parseEpochMs(text);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toISOString();
}

function normalizeLeaseTtlSec(value, fallback = 600) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return Math.max(1, Math.trunc(fallback));
  return Math.max(1, Math.trunc(parsed));
}

function normalizeLeaseRecord(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const rawLeaseTtlSec = raw.lease_ttl_sec ?? raw.leaseTtlSec;
  const lease = {
    instance_id: trim(raw.instance_id || raw.instanceId),
    installation_id: trim(raw.installation_id || raw.installationId),
    host_id: trim(raw.host_id || raw.hostId),
    lease_owner: trim(raw.lease_owner || raw.leaseOwner),
    lease_acquired_at: normalizeIsoTimestamp(raw.lease_acquired_at ?? raw.leaseAcquiredAt),
    lease_expires_at: normalizeIsoTimestamp(raw.lease_expires_at ?? raw.leaseExpiresAt),
    lease_ttl_sec: normalizeLeaseTtlSec(rawLeaseTtlSec, Number(rawLeaseTtlSec || 600)),
    runtime_version: trim(raw.runtime_version || raw.runtimeVersion),
  };

  for (const key of HOST_INSTANCE_LEASE_REQUIRED_FIELDS) {
    if (!trim(lease[key])) return null;
  }

  const acquiredMs = parseEpochMs(lease.lease_acquired_at);
  const expiresMs = parseEpochMs(lease.lease_expires_at);
  if (!Number.isFinite(acquiredMs) || !Number.isFinite(expiresMs) || expiresMs <= acquiredMs) {
    return null;
  }

  return lease;
}

export function resolveLeasePath({ paths = {}, installationId = "", instanceId = "" } = {}) {
  const explicitPath = trim(paths.leaseRecordPath || paths.lease_record_path || paths.leasePath || paths.lease_path);
  if (explicitPath) return resolve(explicitPath);

  const installationManifestPath = trim(paths.installationManifestPath || paths.installation_manifest_path || "");
  if (installationManifestPath) {
    return resolveLeaseRecordPath({ installationManifestPath });
  }

  const runtimeDir = trim(paths.runtimeDir || paths.runtime_dir || "");
  const baseDir = trim(paths.baseDir || paths.base_dir || "");
  const leaseRoot = runtimeDir ? resolve(runtimeDir, "leases") : (baseDir ? resolve(baseDir, "runtime", "leases") : "");
  const recordName = trim(installationId || instanceId);

  if (!leaseRoot || !recordName) return "";
  return resolve(leaseRoot, `${recordName}.json`);
}

export function ensureLeaseDir({ paths = {}, installationId = "", instanceId = "" } = {}) {
  const leasePath = resolveLeasePath({ paths, installationId, instanceId });
  if (!leasePath) return "";
  const leaseDir = dirname(leasePath);
  mkdirSync(leaseDir, { recursive: true });
  return leaseDir;
}

export function buildLeaseRecord({ installation = {}, hostId = "", leaseOwner = "", ttlSec = 600, runtimeVersion = "", now = Date.now() } = {}) {
  const normalizedNowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const normalizedTtlSec = normalizeLeaseTtlSec(ttlSec, 600);
  const acquiredAtIso = normalizeIsoTimestamp(normalizedNowMs);
  const expiresAtIso = normalizeIsoTimestamp(normalizedNowMs + normalizedTtlSec * 1000);

  const lease = normalizeLeaseRecord({
    instance_id: trim(installation.instance_id),
    installation_id: trim(installation.installation_id),
    host_id: trim(hostId || installation.host_id),
    lease_owner: trim(leaseOwner),
    lease_acquired_at: acquiredAtIso,
    lease_expires_at: expiresAtIso,
    lease_ttl_sec: normalizedTtlSec,
    runtime_version: trim(runtimeVersion || installation.runtime_version),
  });

  if (!lease) {
    throw new Error("lease_record_invalid");
  }

  return lease;
}

export function readLeaseRecord({ paths = {}, installationId = "", instanceId = "" } = {}) {
  const leasePath = resolveLeasePath({ paths, installationId, instanceId });
  if (!leasePath || !existsSync(leasePath)) return null;

  try {
    const read = readPersistedLeaseRecord({ leaseRecordPath: leasePath });
    const normalized = normalizeLeaseRecord(read.lease);
    if (!normalized) return null;

    if (trim(installationId) && trim(normalized.installation_id) !== trim(installationId)) {
      return null;
    }
    if (trim(instanceId) && trim(normalized.instance_id) !== trim(instanceId)) {
      return null;
    }

    return normalized;
  } catch {
    return null;
  }
}

export function writeLeaseRecord({ paths = {}, installationId = "", instanceId = "", record = {} } = {}) {
  const leasePath = resolveLeasePath({ paths, installationId, instanceId });
  if (!leasePath) {
    throw new Error("lease_record_path_required");
  }

  ensureLeaseDir({ paths: { leaseRecordPath: leasePath } });
  const normalized = normalizeLeaseRecord(record);
  if (!normalized) {
    throw new Error("lease_record_invalid");
  }

  const persisted = writePersistedLeaseRecord(normalized, { leaseRecordPath: leasePath });
  return {
    leaseRecordPath: persisted.leaseRecordPath,
    lease: normalized,
  };
}
