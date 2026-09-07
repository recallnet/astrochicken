import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildDeterministicLeaseHolderId } from "./lease-holder.ts";
import { FACTORY_OPS_ERROR_CODES, createFactoryOpsError } from "../lib/error-catalog.ts";
import {
  findRegistryInstanceRow,
  loadFactoryRegistry,
  saveFactoryRegistry,
} from "../lib/factory-registry.ts";
import { readLeaseRecord, resolveLeaseRecordPath, writeLeaseRecord } from "../lib/host-lease-store.ts";

const DEFAULT_LEASE_TTL_SECONDS = 600;
const DEFAULT_DRAIN_TTL_SECONDS = 15;

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

function parseEpochMs(value) {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function normalizeLeaseTtlSeconds(value, fallback = DEFAULT_LEASE_TTL_SECONDS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.trunc(parsed));
}

function resolveRequestedInstanceId({ context = {}, paths = {}, instanceId = "" } = {}) {
  const requestedInstanceId = trim(instanceId || context.instance_id || paths.instanceId || context.factory_id);
  if (!requestedInstanceId) {
    throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.host_assignment_manifest_mismatch, "instance_id_required");
  }
  return requestedInstanceId;
}

function resolveCurrentAssignmentManifestPath({ registryRow = {}, requestedInstanceId = "" } = {}) {
  const assignmentPath = trim(registryRow.installation_manifest_path);
  if (!assignmentPath) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_manifest_missing,
      `assignment_manifest_path_missing:${requestedInstanceId}`,
    );
  }
  return resolve(assignmentPath);
}

function resolveInstallationManifestPath({ installationManifestPath = "", paths = {} } = {}) {
  const explicit = trim(installationManifestPath);
  if (explicit) return resolve(explicit);

  const fromPaths = trim(paths.installationManifestPath || paths.installation_manifest_path || "");
  if (fromPaths) return resolve(fromPaths);

  throw createFactoryOpsError(
    FACTORY_OPS_ERROR_CODES.host_assignment_manifest_missing,
    "installation_manifest_path_required",
  );
}

function readInstallationManifest(installationManifestPath = "") {
  const normalizedPath = resolve(trim(installationManifestPath));
  if (!existsSync(normalizedPath)) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_manifest_missing,
      `installation_manifest_not_found:${normalizedPath}`,
    );
  }

  const parsed = parseJson(readFileSync(normalizedPath, "utf8"), null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_manifest_invalid,
      `installation_manifest_invalid_json:${normalizedPath}`,
    );
  }

  const required = ["installation_id", "instance_id", "host_id", "runtime_version"];
  for (const key of required) {
    if (!trim(parsed[key])) {
      throw createFactoryOpsError(
        FACTORY_OPS_ERROR_CODES.host_assignment_manifest_invalid,
        `installation_manifest_missing_field:${key}`,
      );
    }
  }

  return {
    installationManifestPath: normalizedPath,
    installationManifest: parsed,
  };
}

function assertManifestMatchesRequest({
  installationManifest = {},
  requestedInstanceId = "",
  requestedHostId = "",
} = {}) {
  const manifestInstanceId = trim(installationManifest.instance_id);
  const manifestHostId = trim(installationManifest.host_id);
  const normalizedRequestedInstanceId = trim(requestedInstanceId);
  const normalizedRequestedHostId = trim(requestedHostId);

  if (normalizedRequestedInstanceId && normalizedRequestedInstanceId !== manifestInstanceId) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_manifest_mismatch,
      `instance_id_mismatch:requested=${normalizedRequestedInstanceId}:manifest=${manifestInstanceId}`,
    );
  }

  if (normalizedRequestedHostId && normalizedRequestedHostId !== manifestHostId) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_manifest_mismatch,
      `host_id_mismatch:requested=${normalizedRequestedHostId}:manifest=${manifestHostId}`,
    );
  }
}

function loadRegistryRowForInstance({ registryPath = "factory-registry.json", requestedInstanceId = "" } = {}) {
  const loadedRegistry = loadFactoryRegistry({ registryPath, cwd: process.cwd() });
  const registryRow = findRegistryInstanceRow(loadedRegistry.registry, requestedInstanceId);
  if (!registryRow) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_registry_row_missing,
      `instance_not_registered:${requestedInstanceId}`,
    );
  }
  return {
    loadedRegistry,
    registryRow,
  };
}

export function ensureSingleActiveHost({
  registryRow = {},
  expectedHostId = "",
  expectedInstallationManifestPath = "",
} = {}) {
  const assigned = trim(registryRow.assigned_host_id);
  const expected = trim(expectedHostId);
  if (assigned && assigned !== "unassigned" && expected && assigned !== expected) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.ambiguous_host_assignment,
      `ambiguous_host_assignment:assigned_host_id=${assigned}:requested_host_id=${expected}`,
    );
  }

  const currentManifestPath = trim(registryRow.installation_manifest_path);
  const requestedManifestPath = trim(expectedInstallationManifestPath);
  if (currentManifestPath && requestedManifestPath && resolve(currentManifestPath) !== resolve(requestedManifestPath)) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.ambiguous_host_assignment,
      `ambiguous_host_assignment:installation_manifest_path_conflict:${currentManifestPath}`,
    );
  }
}

function buildLeaseRecord({
  installationManifest = {},
  hostId = "",
  leaseTtlSec = DEFAULT_LEASE_TTL_SECONDS,
  now = Date.now(),
} = {}) {
  const instanceId = trim(installationManifest.instance_id);
  const installationId = trim(installationManifest.installation_id);
  const runtimeVersion = trim(installationManifest.runtime_version);
  const normalizedHostId = trim(hostId || installationManifest.host_id);

  const acquiredAtMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const ttlSec = normalizeLeaseTtlSeconds(leaseTtlSec, DEFAULT_LEASE_TTL_SECONDS);
  const expiresAtMs = acquiredAtMs + ttlSec * 1000;

  return {
    instance_id: instanceId,
    installation_id: installationId,
    host_id: normalizedHostId,
    lease_owner: buildDeterministicLeaseHolderId({
      hostId: normalizedHostId,
      processId: process.pid,
      factoryId: instanceId,
      leaseName: "managed_host_assignment",
    }),
    lease_acquired_at: new Date(acquiredAtMs).toISOString(),
    lease_expires_at: new Date(expiresAtMs).toISOString(),
    lease_ttl_sec: ttlSec,
    runtime_version: runtimeVersion,
  };
}

export function buildMigrationLeaseRecord({
  installationManifest = {},
  previousLease = null,
  hostId = "",
  leaseTtlSec = DEFAULT_LEASE_TTL_SECONDS,
  now = Date.now(),
} = {}) {
  const normalizedHostId = trim(hostId || previousLease?.host_id || installationManifest.host_id);
  const mergedManifest = {
    ...installationManifest,
    instance_id: trim(previousLease?.instance_id || installationManifest.instance_id),
    installation_id: trim(previousLease?.installation_id || installationManifest.installation_id),
    runtime_version: trim(previousLease?.runtime_version || installationManifest.runtime_version),
    host_id: normalizedHostId,
  };

  return buildLeaseRecord({
    installationManifest: mergedManifest,
    hostId: normalizedHostId,
    leaseTtlSec,
    now,
  });
}

function ensureLeaseHostConsistency({ lease = null, expectedHostId = "" } = {}) {
  if (!lease) return;
  const leaseHost = trim(lease.host_id);
  const expectedHost = trim(expectedHostId);
  if (!leaseHost || !expectedHost) return;
  if (leaseHost !== expectedHost) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.ambiguous_host_assignment,
      `ambiguous_host_assignment:lease_host_id=${leaseHost}:requested_host_id=${expectedHost}`,
    );
  }
}

function ensureLeaseInstanceConsistency({ lease = null, expectedInstanceId = "" } = {}) {
  if (!lease) return;
  const leaseInstanceId = trim(lease.instance_id);
  const normalizedExpected = trim(expectedInstanceId);
  if (!leaseInstanceId || !normalizedExpected) return;
  if (leaseInstanceId !== normalizedExpected) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.ambiguous_host_assignment,
      `ambiguous_host_assignment:lease_instance_id=${leaseInstanceId}:expected_instance_id=${normalizedExpected}`,
    );
  }
}

function ensureLeaseIsFresh({ lease = null, now = Date.now() } = {}) {
  if (!lease) return;
  const expiresAtMs = parseEpochMs(lease.lease_expires_at);
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.lease_stale,
      `lease_stale:lease_expires_at=${trim(lease.lease_expires_at) || "(missing)"}`,
    );
  }
}

function updateRegistryAssignment({ loadedRegistry = {}, requestedInstanceId = "", hostId = "", manifestPath = "" } = {}) {
  return {
    ...loadedRegistry.registry,
    instances: loadedRegistry.registry.instances.map((entry) => {
      if (trim(entry?.instance_id) !== requestedInstanceId) return entry;
      return {
        ...entry,
        assigned_host_id: trim(hostId),
        installation_manifest_path: resolve(trim(manifestPath)),
      };
    }),
  };
}

export function assignHostToInstance({
  context = {},
  paths = {},
  hostId = "",
  instanceId = "",
  installationManifestPath = "",
  registryPath = "factory-registry.json",
  leaseTtlSec = DEFAULT_LEASE_TTL_SECONDS,
  now = Date.now(),
  processId = process.pid,
} = {}) {
  void processId;
  const requestedInstanceId = resolveRequestedInstanceId({ context, paths, instanceId });

  const manifestPath = resolveInstallationManifestPath({ installationManifestPath, paths });
  const manifestLoaded = readInstallationManifest(manifestPath);
  const installationManifest = manifestLoaded.installationManifest;
  const requestedHostId = trim(hostId || context.host_id || installationManifest.host_id);
  if (!requestedHostId) {
    throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.host_assignment_manifest_mismatch, "host_id_required");
  }

  assertManifestMatchesRequest({
    installationManifest,
    requestedInstanceId,
    requestedHostId,
  });

  const { loadedRegistry, registryRow } = loadRegistryRowForInstance({ registryPath, requestedInstanceId });
  ensureSingleActiveHost({
    registryRow,
    expectedHostId: requestedHostId,
    expectedInstallationManifestPath: manifestPath,
  });

  const leaseRecordPath = resolveLeaseRecordPath({ installationManifestPath: manifestPath });
  const existingLease = readLeaseRecord({ leaseRecordPath });
  ensureLeaseHostConsistency({ lease: existingLease.lease, expectedHostId: requestedHostId });
  ensureLeaseInstanceConsistency({ lease: existingLease.lease, expectedInstanceId: requestedInstanceId });

  const leaseRecord = buildLeaseRecord({
    installationManifest,
    hostId: requestedHostId,
    leaseTtlSec,
    now,
  });

  const updatedRegistry = updateRegistryAssignment({
    loadedRegistry,
    requestedInstanceId,
    hostId: requestedHostId,
    manifestPath,
  });

  saveFactoryRegistry({
    registryPath: loadedRegistry.registryPath,
    registry: updatedRegistry,
  });

  const persistedLease = writeLeaseRecord(leaseRecord, { leaseRecordPath });

  return {
    ok: true,
    status: "assigned",
    assigned_host_id: requestedHostId,
    instance_id: requestedInstanceId,
    installation_manifest_path: manifestPath,
    registry_path: loadedRegistry.registryPath,
    lease_record_path: persistedLease.leaseRecordPath,
    lease: persistedLease.lease,
  };
}

export function migrateHostAssignment({
  context = {},
  paths = {},
  instanceId = "",
  fromHostId = "",
  toHostId = "",
  installationManifestPath = "",
  registryPath = "factory-registry.json",
  leaseTtlSec = DEFAULT_LEASE_TTL_SECONDS,
  drainLeaseTtlSec = DEFAULT_DRAIN_TTL_SECONDS,
  now = Date.now(),
} = {}) {
  const requestedInstanceId = resolveRequestedInstanceId({ context, paths, instanceId });
  const normalizedFromHostId = trim(fromHostId || context.from_host_id);
  if (!normalizedFromHostId) {
    throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.host_assignment_manifest_mismatch, "from_host_id_required");
  }

  const targetManifestPath = resolveInstallationManifestPath({ installationManifestPath, paths });
  const targetManifestLoaded = readInstallationManifest(targetManifestPath);
  const targetManifest = targetManifestLoaded.installationManifest;
  const normalizedToHostId = trim(toHostId || context.host_id || targetManifest.host_id);
  if (!normalizedToHostId) {
    throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.host_assignment_manifest_mismatch, "to_host_id_required");
  }

  assertManifestMatchesRequest({
    installationManifest: targetManifest,
    requestedInstanceId,
    requestedHostId: normalizedToHostId,
  });

  const { loadedRegistry, registryRow } = loadRegistryRowForInstance({ registryPath, requestedInstanceId });
  ensureSingleActiveHost({
    registryRow,
    expectedHostId: normalizedFromHostId,
    expectedInstallationManifestPath: trim(registryRow.installation_manifest_path),
  });

  const currentManifestPath = resolveCurrentAssignmentManifestPath({
    registryRow,
    requestedInstanceId,
  });
  const currentManifestLoaded = readInstallationManifest(currentManifestPath);
  assertManifestMatchesRequest({
    installationManifest: currentManifestLoaded.installationManifest,
    requestedInstanceId,
    requestedHostId: normalizedFromHostId,
  });

  const currentLeaseRead = readLeaseRecord({ installationManifestPath: currentManifestPath });
  if (!currentLeaseRead.exists || !currentLeaseRead.lease) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.lease_missing,
      `lease_missing:installation_manifest_path=${currentManifestPath}`,
    );
  }
  ensureLeaseHostConsistency({ lease: currentLeaseRead.lease, expectedHostId: normalizedFromHostId });
  ensureLeaseInstanceConsistency({ lease: currentLeaseRead.lease, expectedInstanceId: requestedInstanceId });
  ensureLeaseIsFresh({ lease: currentLeaseRead.lease, now });

  const targetLeaseRead = readLeaseRecord({ installationManifestPath: targetManifestPath });
  ensureLeaseHostConsistency({ lease: targetLeaseRead.lease, expectedHostId: normalizedToHostId });
  ensureLeaseInstanceConsistency({ lease: targetLeaseRead.lease, expectedInstanceId: requestedInstanceId });

  const previousLease = buildMigrationLeaseRecord({
    installationManifest: currentManifestLoaded.installationManifest,
    previousLease: currentLeaseRead.lease,
    hostId: normalizedFromHostId,
    leaseTtlSec: normalizeLeaseTtlSeconds(drainLeaseTtlSec, DEFAULT_DRAIN_TTL_SECONDS),
    now,
  });
  const nextLease = buildMigrationLeaseRecord({
    installationManifest: targetManifest,
    hostId: normalizedToHostId,
    leaseTtlSec,
    now,
  });

  const persistedPreviousLease = writeLeaseRecord(previousLease, { installationManifestPath: currentManifestPath });

  const updatedRegistry = updateRegistryAssignment({
    loadedRegistry,
    requestedInstanceId,
    hostId: normalizedToHostId,
    manifestPath: targetManifestPath,
  });
  saveFactoryRegistry({
    registryPath: loadedRegistry.registryPath,
    registry: updatedRegistry,
  });

  const persistedNextLease = writeLeaseRecord(nextLease, { installationManifestPath: targetManifestPath });

  return {
    ok: true,
    status: "migrated",
    instance_id: requestedInstanceId,
    from_host_id: normalizedFromHostId,
    to_host_id: normalizedToHostId,
    registry_path: loadedRegistry.registryPath,
    previous_installation_manifest_path: currentManifestPath,
    installation_manifest_path: targetManifestPath,
    previous_lease_record_path: persistedPreviousLease.leaseRecordPath,
    lease_record_path: persistedNextLease.leaseRecordPath,
    previous_lease: persistedPreviousLease.lease,
    lease: persistedNextLease.lease,
  };
}

export function drainHostAssignment({
  context = {},
  paths = {},
  instanceId = "",
  hostId = "",
  installationManifestPath = "",
  registryPath = "factory-registry.json",
  leaseTtlSec = DEFAULT_DRAIN_TTL_SECONDS,
  now = Date.now(),
} = {}) {
  const requestedInstanceId = resolveRequestedInstanceId({ context, paths, instanceId });
  const manifestPath = resolveInstallationManifestPath({ installationManifestPath, paths });
  const manifestLoaded = readInstallationManifest(manifestPath);
  const installationManifest = manifestLoaded.installationManifest;
  const requestedHostId = trim(hostId || context.host_id || installationManifest.host_id);
  if (!requestedHostId) {
    throw createFactoryOpsError(FACTORY_OPS_ERROR_CODES.host_assignment_manifest_mismatch, "host_id_required");
  }

  assertManifestMatchesRequest({
    installationManifest,
    requestedInstanceId,
    requestedHostId,
  });

  const { loadedRegistry, registryRow } = loadRegistryRowForInstance({ registryPath, requestedInstanceId });
  ensureSingleActiveHost({
    registryRow,
    expectedHostId: requestedHostId,
    expectedInstallationManifestPath: manifestPath,
  });

  const currentLeaseRead = readLeaseRecord({ installationManifestPath: manifestPath });
  if (!currentLeaseRead.exists || !currentLeaseRead.lease) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.lease_missing,
      `lease_missing:installation_manifest_path=${manifestPath}`,
    );
  }
  ensureLeaseHostConsistency({ lease: currentLeaseRead.lease, expectedHostId: requestedHostId });
  ensureLeaseInstanceConsistency({ lease: currentLeaseRead.lease, expectedInstanceId: requestedInstanceId });
  ensureLeaseIsFresh({ lease: currentLeaseRead.lease, now });

  const drainedLease = buildMigrationLeaseRecord({
    installationManifest,
    previousLease: currentLeaseRead.lease,
    hostId: requestedHostId,
    leaseTtlSec,
    now,
  });

  const persistedLease = writeLeaseRecord(drainedLease, { installationManifestPath: manifestPath });

  return {
    ok: true,
    status: "drained",
    instance_id: requestedInstanceId,
    assigned_host_id: trim(registryRow.assigned_host_id),
    installation_manifest_path: manifestPath,
    registry_path: loadedRegistry.registryPath,
    lease_record_path: persistedLease.leaseRecordPath,
    previous_lease: currentLeaseRead.lease,
    lease: persistedLease.lease,
  };
}

export function describeHostAssignment({
  context = {},
  paths = {},
  instanceId = "",
  installationManifestPath = "",
  registryPath = "factory-registry.json",
  readOnly = true,
} = {}) {
  if (!readOnly) {
    throw createFactoryOpsError(
      FACTORY_OPS_ERROR_CODES.host_assignment_manifest_mismatch,
      "passive_inspection_is_read_only",
    );
  }

  const requestedInstanceId = resolveRequestedInstanceId({ context, paths, instanceId });
  const manifestPath = resolveInstallationManifestPath({ installationManifestPath, paths });
  const { loadedRegistry, registryRow } = loadRegistryRowForInstance({
    registryPath,
    requestedInstanceId,
  });

  const effectiveManifestPath = trim(registryRow.installation_manifest_path)
    ? resolve(trim(registryRow.installation_manifest_path))
    : manifestPath;

  const leaseRecordPath = resolveLeaseRecordPath({ installationManifestPath: effectiveManifestPath });
  const leaseRead = readLeaseRecord({ leaseRecordPath });

  return {
    ok: true,
    status: "ok",
    read_only: true,
    instance_id: requestedInstanceId,
    assigned_host_id: trim(registryRow.assigned_host_id),
    installation_manifest_path: effectiveManifestPath,
    registry_path: loadedRegistry.registryPath,
    lease_record_path: leaseRead.leaseRecordPath,
    lease: leaseRead.lease,
    lease_present: leaseRead.exists,
  };
}
