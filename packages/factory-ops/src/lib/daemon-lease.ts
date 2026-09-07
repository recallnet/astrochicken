import { existsSync, readFileSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";

import { readLeaseRecord, writeLeaseRecord } from "./host-lease-store.ts";
import { DEFAULT_RUNTIME_VERSION, buildDeterministicLeaseHolderId } from "../commands/lease-holder.ts";

export const DEFAULT_DAEMON_LEASE_TTL_SEC = 60;

function trim(value = "") {
  return String(value || "").trim();
}

function normalizePid(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function isProcessAlive(pid) {
  const normalizedPid = normalizePid(pid);
  if (!normalizedPid) return false;
  try {
    process.kill(normalizedPid, 0);
    return true;
  } catch (error) {
    return String(error?.code || "") === "EPERM";
  }
}

function parseEpochMs(value = "") {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parsePositiveInt(value, fallback = DEFAULT_DAEMON_LEASE_TTL_SEC) {
  const fallbackNumber = Number(fallback);
  const normalizedFallback = Number.isFinite(fallbackNumber)
    ? Math.trunc(fallbackNumber)
    : DEFAULT_DAEMON_LEASE_TTL_SEC;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return normalizedFallback > 0
      ? Math.max(1, normalizedFallback)
      : 0;
  }
  return Math.max(1, Math.trunc(parsed));
}

function sanitizeInstallationToken(value = "") {
  return trim(value || "").replace(/[^A-Za-z0-9_.-]/g, "_");
}

function resolveDaemonLeaseRecordPath(paths = {}) {
  const explicit = trim(paths.leaseRecordPath || paths.lease_record_path || "");
  if (explicit) return path.resolve(explicit);

  const tmpDir = trim(paths.tmpDir || paths.tmp_dir || "");
  if (tmpDir) return path.resolve(tmpDir, "lease.json");

  const hostRoot = trim(paths.hostRoot || paths.host_root || "");
  if (hostRoot) return path.resolve(hostRoot, "tmp", "lease.json");

  return path.resolve(process.cwd(), "lease.json");
}

function resolveInstallationManifestPath(paths = {}, env = process.env) {
  const explicit = trim(env?.HATCH_INSTALLATION_MANIFEST_PATH || "");
  if (explicit) return path.resolve(explicit);

  const fromPaths = trim(paths.installationManifestPath || paths.installation_manifest_path || "");
  if (fromPaths) return path.resolve(fromPaths);

  const hostRoot = trim(paths.hostRoot || paths.host_root || "");
  if (hostRoot) return path.resolve(hostRoot, "installation.json");
  return "";
}

function readInstallationManifest(paths = {}, env = process.env) {
  const manifestPath = resolveInstallationManifestPath(paths, env);
  if (!manifestPath || !existsSync(manifestPath)) {
    return {
      manifestPath,
      installationManifest: null,
      exists: false,
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        manifestPath,
        installationManifest: parsed,
        exists: true,
      };
    }
  } catch {}

  return {
    manifestPath,
    installationManifest: null,
    exists: true,
  };
}

function resolveDaemonLeaseIdentity({ runtime = {}, paths = {}, env = process.env, nowMs = Date.now(), ttlSec = DEFAULT_DAEMON_LEASE_TTL_SEC } = {}) {
  const loadedManifest = readInstallationManifest(paths, env);
  const installationManifest = loadedManifest.installationManifest || {};

  const instanceId = trim(
    runtime.factoryId
    || runtime.instanceId
    || runtime.config?.instance_id
    || runtime.config?.factory_id
    || runtime.mutationContext?.instance_id
    || installationManifest.instance_id
    || env?.HATCH_FACTORY_INSTANCE_ID
    || env?.HATCH_FACTORY_ID,
  ) || "factory";

  const hostId = trim(env?.HATCH_HOST_ID || env?.HOST_ID || installationManifest.host_id || hostname()) || "unknown-host";
  const installationId = trim(
    env?.HATCH_INSTALLATION_ID
    || installationManifest.installation_id
    || `inst_${sanitizeInstallationToken(instanceId)}_${sanitizeInstallationToken(hostId)}`,
  ) || `inst_${sanitizeInstallationToken(instanceId)}_${sanitizeInstallationToken(hostId)}`;
  const runtimeVersion = trim(
    installationManifest.runtime_version
    || env?.HATCH_RUNTIME_VERSION
    || runtime.config?.runtime_version
    || DEFAULT_RUNTIME_VERSION,
  ) || DEFAULT_RUNTIME_VERSION;

  const leaseOwner = trim(env?.HATCH_LEASE_OWNER || "") || buildDeterministicLeaseHolderId({
    hostId,
    processId: process.pid,
    factoryId: instanceId,
    leaseName: "managed_daemon_lease",
  });

  const normalizedTtlSec = parsePositiveInt(ttlSec, DEFAULT_DAEMON_LEASE_TTL_SEC);
  const leaseAcquiredAt = new Date(nowMs).toISOString();
  const leaseExpiresAt = new Date(nowMs + normalizedTtlSec * 1000).toISOString();

  return {
    instance_id: instanceId,
    installation_id: installationId,
    host_id: hostId,
    pid: process.pid,
    lease_owner: leaseOwner,
    lease_acquired_at: leaseAcquiredAt,
    lease_expires_at: leaseExpiresAt,
    lease_ttl_sec: normalizedTtlSec,
    runtime_version: runtimeVersion,
  };
}

function hasIdentityMismatch(record = {}, expected = {}) {
  if (trim(record.instance_id) && trim(expected.instance_id) && trim(record.instance_id) !== trim(expected.instance_id)) return true;
  if (trim(record.installation_id) && trim(expected.installation_id) && trim(record.installation_id) !== trim(expected.installation_id)) return true;
  if (trim(record.host_id) && trim(expected.host_id) && trim(record.host_id) !== trim(expected.host_id)) return true;
  return false;
}

function readLeaseSnapshot(paths = {}) {
  const leaseRecordPath = resolveDaemonLeaseRecordPath(paths);
  try {
    const read = readLeaseRecord({ leaseRecordPath });
    return {
      ok: true,
      reason: read.exists ? "lease_found" : "lease_missing",
      exists: Boolean(read.exists),
      leaseRecordPath,
      lease: read.lease,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "lease_record_invalid",
      exists: false,
      leaseRecordPath,
      lease: null,
      error: String(error?.message || error || "lease_record_invalid"),
      errorCode: String(error?.code || "lease_record_invalid"),
    };
  }
}

export function readCurrentLease({ paths = {} } = {}) {
  return readLeaseSnapshot(paths);
}

export function acquireLease({
  runtime = {},
  paths = {},
  ttlSec = DEFAULT_DAEMON_LEASE_TTL_SEC,
  nowMs = Date.now(),
  env = process.env,
  isPidAliveFn = isProcessAlive,
} = {}) {
  const leaseRecordPath = resolveDaemonLeaseRecordPath(paths);
  const nextLease = resolveDaemonLeaseIdentity({ runtime, paths, env, nowMs, ttlSec });
  const loaded = readLeaseSnapshot(paths);

  if (!loaded.ok) {
    return {
      ok: false,
      reason: "split_brain",
      detail: loaded.reason,
      leaseRecordPath,
      lease: null,
      current: null,
    };
  }

  if (loaded.exists && loaded.lease) {
    const currentLease = loaded.lease;
    if (hasIdentityMismatch(currentLease, nextLease)) {
      return {
        ok: false,
        reason: "split_brain",
        detail: "identity_mismatch",
        leaseRecordPath,
        lease: null,
        current: currentLease,
      };
    }

    const currentExpiresMs = parseEpochMs(currentLease.lease_expires_at);
    const currentPid = normalizePid(currentLease.pid);
    const staleDeadPid = trim(currentLease.host_id) === trim(nextLease.host_id)
      && currentPid > 0
      && !isPidAliveFn(currentPid);
    if (Number.isFinite(currentExpiresMs) && currentExpiresMs > nowMs && !staleDeadPid) {
      return {
        ok: false,
        reason: "lease_active",
        detail: "lease_not_expired",
        leaseRecordPath,
        lease: null,
        current: currentLease,
      };
    }
  }

  const persisted = writeLeaseRecord(nextLease, { leaseRecordPath });
  return {
    ok: true,
    reason: "lease_acquired",
    leaseRecordPath,
    lease: persisted.lease,
    current: loaded.lease || null,
  };
}

export function renewLease({ runtime = {}, paths = {}, ttlSec = DEFAULT_DAEMON_LEASE_TTL_SEC, nowMs = Date.now(), env = process.env } = {}) {
  const leaseRecordPath = resolveDaemonLeaseRecordPath(paths);
  const expected = resolveDaemonLeaseIdentity({ runtime, paths, env, nowMs, ttlSec });
  const loaded = readLeaseSnapshot(paths);

  if (!loaded.ok) {
    return {
      ok: false,
      reason: "split_brain",
      detail: loaded.reason,
      leaseRecordPath,
      lease: null,
      current: null,
    };
  }

  if (!loaded.exists || !loaded.lease) {
    return {
      ok: false,
      reason: "lease_missing",
      detail: "lease_record_missing",
      leaseRecordPath,
      lease: null,
      current: null,
    };
  }

  const currentLease = loaded.lease;
  if (hasIdentityMismatch(currentLease, expected)) {
    return {
      ok: false,
      reason: "split_brain",
      detail: "identity_mismatch",
      leaseRecordPath,
      lease: null,
      current: currentLease,
    };
  }

  if (trim(currentLease.lease_owner) !== trim(expected.lease_owner)) {
    return {
      ok: false,
      reason: "split_brain",
      detail: "lease_owner_mismatch",
      leaseRecordPath,
      lease: null,
      current: currentLease,
    };
  }

  const currentExpiresMs = parseEpochMs(currentLease.lease_expires_at);
  if (!Number.isFinite(currentExpiresMs) || currentExpiresMs <= nowMs) {
    return {
      ok: false,
      reason: "lease_stale",
      detail: "lease_expired",
      leaseRecordPath,
      lease: null,
      current: currentLease,
    };
  }

  const normalizedTtlSec = parsePositiveInt(ttlSec, DEFAULT_DAEMON_LEASE_TTL_SEC);
  const renewed = {
    ...currentLease,
    lease_owner: expected.lease_owner,
    lease_ttl_sec: normalizedTtlSec,
    runtime_version: expected.runtime_version,
    lease_expires_at: new Date(nowMs + normalizedTtlSec * 1000).toISOString(),
  };

  const persisted = writeLeaseRecord(renewed, { leaseRecordPath });
  return {
    ok: true,
    reason: "lease_renewed",
    leaseRecordPath,
    lease: persisted.lease,
    current: currentLease,
  };
}

export function releaseLease({ runtime = {}, paths = {}, env = process.env } = {}) {
  const leaseRecordPath = resolveDaemonLeaseRecordPath(paths);
  if (!existsSync(leaseRecordPath)) {
    return {
      ok: true,
      released: false,
      reason: "lease_missing",
      leaseRecordPath,
    };
  }

  const loaded = readLeaseSnapshot(paths);
  if (!loaded.ok || !loaded.lease) {
    return {
      ok: false,
      released: false,
      reason: "split_brain",
      detail: loaded.reason || "lease_record_invalid",
      leaseRecordPath,
    };
  }

  const expected = resolveDaemonLeaseIdentity({
    runtime,
    paths,
    env,
    nowMs: Date.now(),
    ttlSec: loaded.lease.lease_ttl_sec,
  });

  if (hasIdentityMismatch(loaded.lease, expected)) {
    return {
      ok: false,
      released: false,
      reason: "split_brain",
      detail: "identity_mismatch",
      leaseRecordPath,
      current: loaded.lease,
    };
  }

  try {
    rmSync(leaseRecordPath, { force: true });
    return {
      ok: true,
      released: true,
      reason: "lease_released",
      leaseRecordPath,
      previous: loaded.lease,
    };
  } catch (error) {
    return {
      ok: false,
      released: false,
      reason: "lease_release_failed",
      detail: String(error?.message || error || "lease_release_failed"),
      leaseRecordPath,
      current: loaded.lease,
    };
  }
}

export function resolveDaemonLeaseTtl({
  config = {},
  env = process.env,
  defaultTtlSec = DEFAULT_DAEMON_LEASE_TTL_SEC,
} = {}) {
  const fromConfig = parsePositiveInt(config?.lease_ttl_sec, 0);
  if (fromConfig > 0) {
    return { ttlSec: fromConfig, source: "config" };
  }

  const fromEnv = parsePositiveInt(env?.HATCH_LEASE_TTL_SEC, 0);
  if (fromEnv > 0) {
    return { ttlSec: fromEnv, source: "env" };
  }

  return {
    ttlSec: parsePositiveInt(defaultTtlSec, DEFAULT_DAEMON_LEASE_TTL_SEC),
    source: "default",
  };
}

export function ensureStartupLease({
  runtime = {},
  paths = {},
  ttlSec = DEFAULT_DAEMON_LEASE_TTL_SEC,
  acquireLeaseFn = acquireLease,
  emitBugIssueFn = () => ({ ok: false, error: "emit_bug_issue_unavailable" }),
  appendLogLineFn = () => {},
  daemonLogPath = "",
} = {}) {
  const startupLease = acquireLeaseFn({
    runtime,
    paths,
    ttlSec,
  });

  if (startupLease.ok) {
    appendLogLineFn(
      daemonLogPath,
      `lease_acquire_ok owner=${trim(startupLease.lease?.lease_owner || "") || "unknown"} host_id=${trim(startupLease.lease?.host_id || "") || "unknown"} expires_at=${trim(startupLease.lease?.lease_expires_at || "") || "unknown"}`,
    );
    return { ok: true, startupLease };
  }

  appendLogLineFn(
    daemonLogPath,
    `lease_acquire_failed phase=startup reason=${startupLease.reason || "unknown"} detail=${startupLease.detail || ""} owner=${trim(startupLease.current?.lease_owner || "") || "none"}`,
  );

  const emitted = emitBugIssueFn({
    repo: runtime.controlPlaneRepo || runtime.targetRepo,
    bugType: "managed-daemon-lease-conflict",
    summary: `Daemon lease acquire failed for ${runtime.factoryId}`,
    evidence: {
      factory_id: runtime.factoryId,
      reason: startupLease.reason || "unknown",
      detail: startupLease.detail || "",
      lease_record_path: startupLease.leaseRecordPath || "",
      observed_owner: trim(startupLease.current?.lease_owner || ""),
      observed_host_id: trim(startupLease.current?.host_id || ""),
      observed_installation_id: trim(startupLease.current?.installation_id || ""),
    },
    labels: [`kind:${runtime.factoryId}`, "managed-factory-bug", "incident-fingerprint"],
    runId: "daemon-startup",
    pipeline: "daemon",
    factoryId: runtime.factoryId,
    sourceFactory: runtime.factoryId,
    sourceRepo: runtime.targetRepo,
  });

  if (emitted?.ok) {
    appendLogLineFn(daemonLogPath, `lease_acquire_incident_emitted issue=${trim(emitted.issue_url || "") || "none"}`);
  } else {
    appendLogLineFn(daemonLogPath, `lease_acquire_incident_emit_failed error=${trim(emitted?.error || "unknown")}`);
  }

  return {
    ok: false,
    startupLease,
    emitted,
    error: `daemon_lease_acquire_failed:${startupLease.reason || "unknown"}`,
  };
}

export function reacquireLeaseIfNeeded({
  leaseHeld = true,
  runtime = {},
  paths = {},
  ttlSec = DEFAULT_DAEMON_LEASE_TTL_SEC,
  acquireLeaseFn = acquireLease,
  appendLogLineFn = () => {},
  daemonLogPath = "",
} = {}) {
  if (leaseHeld) return { leaseHeld: true };

  const reacquired = acquireLeaseFn({
    runtime,
    paths,
    ttlSec,
  });

  if (reacquired.ok) {
    appendLogLineFn(
      daemonLogPath,
      `lease_reacquire_ok owner=${trim(reacquired.lease?.lease_owner || "") || "unknown"} host_id=${trim(reacquired.lease?.host_id || "") || "unknown"} expires_at=${trim(reacquired.lease?.lease_expires_at || "") || "unknown"}`,
    );
    return { leaseHeld: true, reacquired };
  }

  appendLogLineFn(
    daemonLogPath,
    `lease_reacquire_failed reason=${reacquired.reason || "unknown"} detail=${reacquired.detail || ""} owner=${trim(reacquired.current?.lease_owner || "") || "none"}`,
  );
  return { leaseHeld: false, reacquired };
}

export function renewLeaseOrPause({
  leaseHeld = true,
  nextLeaseRenewAtMs = 0,
  runtime = {},
  paths = {},
  ttlSec = DEFAULT_DAEMON_LEASE_TTL_SEC,
  leaseRenewLeadMs = 1_000,
  nowMs = Date.now(),
  controlState = {},
  repoRoot = process.cwd(),
  renewLeaseFn = renewLease,
  acquireLeaseFn = acquireLease,
  writeControlStateFn = () => ({ version: 0 }),
  buildClearedActionStateFn = () => ({}),
  appendLogLineFn = () => {},
  daemonLogPath = "",
} = {}) {
  if (!leaseHeld) {
    return {
      leaseHeld: false,
      nextLeaseRenewAtMs,
      paused: false,
    };
  }

  const renewLeadRemainingMs = Math.max(0, nextLeaseRenewAtMs - nowMs);
  const renewed = renewLeaseFn({
    runtime,
    paths,
    ttlSec,
    nowMs,
  });

  if (renewed.ok) {
    appendLogLineFn(
      daemonLogPath,
      `lease_renew_ok owner=${trim(renewed.lease?.lease_owner || "") || "unknown"} expires_at=${trim(renewed.lease?.lease_expires_at || "") || "unknown"} renew_margin_ms=${renewLeadRemainingMs}`,
    );
    return {
      leaseHeld: true,
      nextLeaseRenewAtMs: nowMs + leaseRenewLeadMs,
      renewed,
      paused: false,
    };
  }

  appendLogLineFn(
    daemonLogPath,
    `lease_renew_failed reason=${renewed.reason || "unknown"} detail=${renewed.detail || ""} owner=${trim(renewed.current?.lease_owner || "") || "none"}`,
  );

  // When the lease expired (lease_stale) but we are the owner, try to
  // reacquire instead of immediately pausing. This prevents the daemon from
  // entering a permanent 10-min sleep loop when a slow synchronous pre-tick
  // operation (e.g. recovery sweep) outlasts the lease TTL.
  if (renewed.reason === "lease_stale" || renewed.reason === "lease_missing") {
    const reacquired = acquireLeaseFn({ runtime, paths, ttlSec, nowMs });
    if (reacquired.ok) {
      appendLogLineFn(
        daemonLogPath,
        `lease_reacquire_ok owner=${trim(reacquired.lease?.lease_owner || "") || "unknown"} expires_at=${trim(reacquired.lease?.lease_expires_at || "") || "unknown"}`,
      );
      return {
        leaseHeld: true,
        nextLeaseRenewAtMs: nowMs + leaseRenewLeadMs,
        renewed: reacquired,
        paused: false,
      };
    }
    appendLogLineFn(
      daemonLogPath,
      `lease_reacquire_failed reason=${reacquired.reason || "unknown"} detail=${reacquired.detail || ""}`,
    );
  }

  const paused = writeControlStateFn({
    factoryId: runtime.factoryId,
    rootDir: repoRoot,
    actor: "daemon",
    reason: "lease_lost",
    nextState: {
      action_state: {
        ...buildClearedActionStateFn(controlState?.action_state || {}),
        pause: { active: true },
      },
      reason: "lease_lost",
    },
  });
  appendLogLineFn(
    daemonLogPath,
    `lease_pause_written version=${Number(paused?.version) || 0} reason=lease_lost`,
  );

  return {
    leaseHeld: false,
    nextLeaseRenewAtMs,
    renewed,
    paused: true,
    pausedState: paused,
  };
}
