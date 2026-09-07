import { hostname } from "node:os";

import { trim } from "../lib/cli-helpers.ts";

export const FACTORY_DISTRIBUTED_LEASE_SCHEMA_VERSION = "factory_distributed_lease/v1";
export const FACTORY_DISTRIBUTED_LEASE_BLOCK_START = "<!-- hatch:factory-distributed-lease -->";
export const FACTORY_DISTRIBUTED_LEASE_BLOCK_END = "<!-- /hatch:factory-distributed-lease -->";
export const DEFAULT_LEASE_SECONDS = 600;
export const DEFAULT_CLOCK_SKEW_TOLERANCE_MS = 5_000;
export const DEFAULT_RECLAIM_GRACE_MS = 15_000;
export const DEFAULT_RUNTIME_VERSION = "unknown_runtime";

export const MANAGED_INSTANCE_LEASE_REQUIRED_FIELDS = Object.freeze([
  "instance_id",
  "installation_id",
  "host_id",
  "lease_owner",
  "lease_acquired_at",
  "lease_expires_at",
  "lease_ttl_sec",
  "runtime_version",
]);

export const FACTORY_DISTRIBUTED_LEASE_VALIDATION_CODES = Object.freeze({
  MISSING_FIELD: "missing-field",
  INVALID_TTL: "invalid-ttl",
  STALE_CLOCK: "stale-clock",
  STALE_LEASE: "stale-lease",
});

function parseEpochMs(iso) {
  const t = Date.parse(String(iso || "").trim());
  return Number.isFinite(t) ? t : Number.NaN;
}

function parsePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return Number.NaN;
  return Math.max(1, Math.trunc(parsed));
}

function normalizeIsoUtc(value, fallbackEpochMs = Date.now()) {
  const parsed = parseEpochMs(value);
  return new Date(Number.isFinite(parsed) ? parsed : fallbackEpochMs).toISOString();
}

export function normalizeLeaseSeconds(value, fallback = DEFAULT_LEASE_SECONDS) {
  const fallbackSeconds = Number.isFinite(Number(fallback)) && Number(fallback) > 0
    ? Math.max(1, Math.trunc(Number(fallback)))
    : DEFAULT_LEASE_SECONDS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackSeconds;
  return Math.max(1, Math.trunc(parsed));
}

function resolveHostId(explicit = "") {
  const fromArg = trim(explicit);
  if (fromArg) return fromArg;
  const fromEnv = trim(process.env.FACTORY_LEASE_HOST_ID || process.env.TAXI_LEASE_HOST_ID || "");
  if (fromEnv) return fromEnv;
  return hostname();
}

function resolveProcessId(explicit = "") {
  const n = Number(explicit || process.env.FACTORY_LEASE_PROCESS_ID || process.pid || 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : process.pid;
}

function inferHostIdFromOwner(owner = "") {
  const raw = trim(owner);
  if (!raw) return "";
  const [candidate] = raw.split(":");
  return trim(candidate);
}

export function resolveManagedLeaseHostId({ hostId = "", leaseOwner = "", holderId = "" } = {}) {
  const explicit = trim(hostId);
  if (explicit) return explicit;
  const inferred = inferHostIdFromOwner(leaseOwner) || inferHostIdFromOwner(holderId);
  if (inferred) return inferred;
  return resolveHostId("");
}

export function resolveManagedLeaseRuntimeVersion(explicit = "") {
  const direct = trim(explicit);
  if (direct) return direct;
  const fromEnv = trim(process.env.HATCH_RUNTIME_VERSION || process.env.FACTORY_RUNTIME_VERSION || "");
  return fromEnv || DEFAULT_RUNTIME_VERSION;
}

export function resolveManagedLeaseInstallationId({ installationId = "", instanceId = "", hostId = "" } = {}) {
  const explicit = trim(installationId);
  if (explicit) return explicit;
  const instance = trim(instanceId || "factory");
  const host = trim(hostId || "host");
  return `inst_${instance}_${host}`.replace(/[^A-Za-z0-9_.-]/g, "_");
}

export function buildDeterministicLeaseHolderId({
  hostId = "",
  processId = "",
  factoryId = "",
  leaseName = "",
} = {}) {
  const host = resolveHostId(hostId);
  const pid = resolveProcessId(processId);
  const factory = trim(factoryId || "factory");
  const lease = trim(leaseName || "default");
  return `${host}:${pid}:${factory}:${lease}`;
}

export function normalizeManagedInstanceLeaseRecord(raw, {
  factoryId = "",
  leaseName = "",
  trackingIssueNumber = "",
  holderId = "",
  runId = "",
  instanceId = "",
  installationId = "",
  hostId = "",
  leaseOwner = "",
  runtimeVersion = "",
  leaseSeconds = DEFAULT_LEASE_SECONDS,
  nowIso = "",
  nowEpochMs = Date.now(),
  requireRawManagedFields = false,
} = {}) {
  if (!raw || typeof raw !== "object") return null;
  if (requireRawManagedFields) {
    for (const field of MANAGED_INSTANCE_LEASE_REQUIRED_FIELDS) {
      if (!trim(raw[field])) return null;
    }
  }

  const factory = trim(raw.factory_id || factoryId);
  const lane = trim(raw.lease_name || leaseName);
  const holder = trim(raw.holder_id || holderId || raw.lease_owner || leaseOwner);
  const owner = trim(raw.lease_owner || leaseOwner || holder);
  const run = trim(raw.run_id || runId);
  const resolvedInstanceId = trim(raw.instance_id || instanceId || factory);
  const resolvedHostId = resolveManagedLeaseHostId({
    hostId: raw.host_id || hostId,
    leaseOwner: owner,
    holderId: holder,
  });
  const resolvedInstallationId = resolveManagedLeaseInstallationId({
    installationId: raw.installation_id || installationId,
    instanceId: resolvedInstanceId,
    hostId: resolvedHostId,
  });
  const resolvedRuntimeVersion = resolveManagedLeaseRuntimeVersion(raw.runtime_version || runtimeVersion);

  const normalizedNowIso = normalizeIsoUtc(nowIso, nowEpochMs);
  const acquiredAt = normalizeIsoUtc(raw.lease_acquired_at || raw.acquired_at || normalizedNowIso, nowEpochMs);
  const ttlValue = raw.lease_ttl_sec ?? leaseSeconds;
  const ttlSeconds = Number.isFinite(parsePositiveInt(ttlValue))
    ? parsePositiveInt(ttlValue)
    : normalizeLeaseSeconds(ttlValue, leaseSeconds);

  const defaultExpiryMs = parseEpochMs(acquiredAt) + ttlSeconds * 1000;
  const expiresAt = normalizeIsoUtc(
    raw.lease_expires_at || raw.expires_at,
    Number.isFinite(defaultExpiryMs) ? defaultExpiryMs : nowEpochMs,
  );

  const lease = {
    schema_version: FACTORY_DISTRIBUTED_LEASE_SCHEMA_VERSION,
    status: trim(raw.status) === "released" ? "released" : "active",
    factory_id: factory,
    lease_name: lane,
    holder_id: holder,
    run_id: run,
    acquired_at: acquiredAt,
    heartbeat_at: normalizeIsoUtc(raw.heartbeat_at || raw.updated_at || normalizedNowIso, nowEpochMs),
    expires_at: expiresAt,
    updated_at: normalizeIsoUtc(raw.updated_at || raw.heartbeat_at || normalizedNowIso, nowEpochMs),
    tracking_issue_number: trim(raw.tracking_issue_number || trackingIssueNumber),
    idempotency_key: trim(raw.idempotency_key),
    clock_skew_tolerance_ms: Math.max(0, Number(raw.clock_skew_tolerance_ms) || DEFAULT_CLOCK_SKEW_TOLERANCE_MS),
    reclaim_grace_ms: Math.max(0, Number(raw.reclaim_grace_ms) || DEFAULT_RECLAIM_GRACE_MS),
    version: Math.max(0, Math.trunc(Number(raw.version) || 0)),
    version_token: trim(raw.version_token),
    last_seen_comment_etag: trim(raw.last_seen_comment_etag),
    reclaim_count: Math.max(0, Math.trunc(Number(raw.reclaim_count) || 0)),
    reclaimed_from_holder_id: trim(raw.reclaimed_from_holder_id),
    reclaimed_from_run_id: trim(raw.reclaimed_from_run_id),
    reclaimed_at: trim(raw.reclaimed_at),
    released_at: trim(raw.released_at),
    release_reason: trim(raw.release_reason),
    instance_id: resolvedInstanceId,
    installation_id: resolvedInstallationId,
    host_id: resolvedHostId,
    lease_owner: owner,
    lease_acquired_at: acquiredAt,
    lease_expires_at: expiresAt,
    lease_ttl_sec: ttlSeconds,
    runtime_version: resolvedRuntimeVersion,
  };

  if (!lease.version_token) lease.version_token = String(lease.version || 0);
  if (!lease.tracking_issue_number) lease.tracking_issue_number = trim(trackingIssueNumber);
  return lease;
}

export function validateManagedInstanceLeaseRecord(record, {
  nowIso = "",
  clockSkewToleranceMs = DEFAULT_CLOCK_SKEW_TOLERANCE_MS,
} = {}) {
  if (!record || typeof record !== "object") {
    return {
      ok: false,
      reason_code: FACTORY_DISTRIBUTED_LEASE_VALIDATION_CODES.MISSING_FIELD,
      reason_detail: "missing-field:record",
    };
  }

  const requiredFields = [...MANAGED_INSTANCE_LEASE_REQUIRED_FIELDS, "factory_id", "lease_name", "holder_id", "run_id"];
  for (const field of requiredFields) {
    if (!trim(record[field])) {
      return {
        ok: false,
        reason_code: FACTORY_DISTRIBUTED_LEASE_VALIDATION_CODES.MISSING_FIELD,
        reason_detail: `missing-field:${field}`,
      };
    }
  }

  const ttlSeconds = parsePositiveInt(record.lease_ttl_sec);
  if (!Number.isFinite(ttlSeconds)) {
    return {
      ok: false,
      reason_code: FACTORY_DISTRIBUTED_LEASE_VALIDATION_CODES.INVALID_TTL,
      reason_detail: "invalid-ttl:lease_ttl_sec",
    };
  }

  const acquiredMs = parseEpochMs(record.lease_acquired_at || record.acquired_at);
  const expiresMs = parseEpochMs(record.lease_expires_at || record.expires_at);
  if (!Number.isFinite(acquiredMs) || !Number.isFinite(expiresMs)) {
    return {
      ok: false,
      reason_code: FACTORY_DISTRIBUTED_LEASE_VALIDATION_CODES.STALE_CLOCK,
      reason_detail: "stale-clock:invalid_timestamp",
    };
  }

  const ttlWindowMs = expiresMs - acquiredMs;
  if (!Number.isFinite(ttlWindowMs) || ttlWindowMs <= 0) {
    return {
      ok: false,
      reason_code: FACTORY_DISTRIBUTED_LEASE_VALIDATION_CODES.STALE_LEASE,
      reason_detail: "stale-lease:ttl_window_non_positive",
    };
  }

  const nowMs = parseEpochMs(nowIso);
  const toleranceMs = Math.max(0, Number(clockSkewToleranceMs) || 0);
  if (Number.isFinite(nowMs) && acquiredMs - nowMs > toleranceMs) {
    return {
      ok: false,
      reason_code: FACTORY_DISTRIBUTED_LEASE_VALIDATION_CODES.STALE_CLOCK,
      reason_detail: "stale-clock:acquired_at_in_future",
    };
  }

  const expectedTtlWindowMs = ttlSeconds * 1000;
  const ttlToleranceMs = Math.max(1_000, toleranceMs);
  if (ttlWindowMs + ttlToleranceMs < expectedTtlWindowMs) {
    return {
      ok: false,
      reason_code: FACTORY_DISTRIBUTED_LEASE_VALIDATION_CODES.STALE_LEASE,
      reason_detail: "stale-lease:ttl_window_short",
    };
  }

  return {
    ok: true,
    reason_code: "",
    reason_detail: "",
  };
}
