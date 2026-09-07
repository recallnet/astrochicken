import { createHash } from "node:crypto";

import { createGhApiClient } from "../../../github-adapter/src/github-adapter.ts";
import { trim, parseJson, gh } from "../lib/cli-helpers.ts";

export const FACTORY_LEASE_SCHEMA_VERSION = "factory_lease/v1";
export const FACTORY_LEASE_BLOCK_START = "<!-- hatch:factory-lease -->";
export const FACTORY_LEASE_BLOCK_END = "<!-- /hatch:factory-lease -->";



function epochMs(iso) {
  const t = Date.parse(String(iso || "").trim());
  return Number.isFinite(t) ? t : Number.NaN;
}

function leaseExpiryIso(nowEpochMs, leaseSeconds = 300) {
  const seconds = Number(leaseSeconds);
  const sane = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 300;
  return new Date(Number(nowEpochMs) + sane * 1000).toISOString();
}

function normalizeOwnerRunScope({ ownerId = "", runId = "", factoryScope = "" } = {}) {
  const owner = trim(ownerId || runId);
  const run = trim(runId || owner);
  const scope = trim(factoryScope);
  return { owner, run, scope };
}

function sameOwnerRun(lease, ownerId, runId) {
  return trim(lease?.owner_id) === trim(ownerId) && trim(lease?.run_id) === trim(runId);
}

function sameToken(lease, leaseToken) {
  return trim(lease?.lease_token) === trim(leaseToken);
}

export function buildDeterministicFactoryLeaseToken({ factoryScope = "", ownerId = "", runId = "" } = {}) {
  const { owner, run, scope } = normalizeOwnerRunScope({ ownerId, runId, factoryScope });
  const seed = [scope, owner, run].join("|");
  const digest = createHash("sha256").update(seed).digest("hex").slice(0, 24);
  return `factory_lease_${digest}`;
}

export function normalizeFactoryLease(rawLease, { factoryScope = "" } = {}) {
  if (!rawLease || typeof rawLease !== "object") return null;

  const normalizedScope = trim(rawLease.factory_scope || factoryScope);
  const lease = {
    schema_version: FACTORY_LEASE_SCHEMA_VERSION,
    status: trim(rawLease.status) === "released" ? "released" : "active",
    lease_id: trim(rawLease.lease_id || rawLease.lease_token),
    lease_token: trim(rawLease.lease_token),
    factory_scope: normalizedScope,
    owner_id: trim(rawLease.owner_id),
    run_id: trim(rawLease.run_id),
    lease_started_at: trim(rawLease.lease_started_at),
    heartbeat_at: trim(rawLease.heartbeat_at || rawLease.updated_at),
    lease_expires_at: trim(rawLease.lease_expires_at),
    updated_at: trim(rawLease.updated_at || rawLease.heartbeat_at),
    reclaim_count: Number(rawLease.reclaim_count || 0) || 0,
    reclaimed_from_owner_id: trim(rawLease.reclaimed_from_owner_id),
    reclaimed_from_run_id: trim(rawLease.reclaimed_from_run_id),
    reclaimed_at: trim(rawLease.reclaimed_at),
    released_at: trim(rawLease.released_at),
    release_reason: trim(rawLease.release_reason),
  };

  if (!lease.factory_scope || !lease.lease_token) return null;
  if (!lease.lease_id) lease.lease_id = lease.lease_token;
  if (!lease.run_id) lease.run_id = lease.owner_id;
  return lease;
}

export function parseFactoryLeaseFromBody(body = "", fallback = null) {
  const text = String(body || "");
  const start = text.indexOf(FACTORY_LEASE_BLOCK_START);
  const end = text.indexOf(FACTORY_LEASE_BLOCK_END);
  if (start < 0 || end < 0 || end < start) return fallback;
  const inside = text.slice(start + FACTORY_LEASE_BLOCK_START.length, end).trim();
  if (!inside) return fallback;
  return parseJson(inside, fallback);
}

export function upsertFactoryLeaseInBody(body = "", lease = null) {
  const text = String(body || "");
  const leaseJson = lease && typeof lease === "object" ? JSON.stringify(lease, null, 2) : "";
  const block = leaseJson
    ? `${FACTORY_LEASE_BLOCK_START}\n${leaseJson}\n${FACTORY_LEASE_BLOCK_END}`
    : "";

  const start = text.indexOf(FACTORY_LEASE_BLOCK_START);
  const end = text.indexOf(FACTORY_LEASE_BLOCK_END);

  if (start >= 0 && end >= 0 && end >= start) {
    const before = text.slice(0, start).replace(/\s*$/, "");
    const after = text.slice(end + FACTORY_LEASE_BLOCK_END.length).replace(/^\s*/, "");
    if (!block) return [before, after].filter(Boolean).join("\n\n").trim();
    return [before, block, after].filter(Boolean).join("\n\n").trim();
  }

  if (!block) return text;
  return text.trim() ? `${text.trim()}\n\n${block}` : block;
}

export function describeFactoryLease(lease, { nowEpochMs = Date.now() } = {}) {
  const normalized = normalizeFactoryLease(lease);
  if (!normalized) {
    return { present: false, status: "none", active: false, stale: false, released: false, lease: null };
  }

  const expiresAtMs = epochMs(normalized.lease_expires_at);
  const released = normalized.status === "released";
  const active = !released && Number.isFinite(expiresAtMs) && expiresAtMs > nowEpochMs;
  const stale = !released && Number.isFinite(expiresAtMs) && expiresAtMs <= nowEpochMs;

  return {
    present: true,
    status: released ? "released" : (active ? "active" : (stale ? "stale" : "unknown")),
    active,
    stale,
    released,
    lease: normalized,
  };
}

export function parseFactoryLeaseSnapshot(issue = {}, { nowEpochMs = Date.now(), factoryScope = "" } = {}) {
  const raw = parseFactoryLeaseFromBody(String(issue?.body || ""), null);
  const normalized = normalizeFactoryLease(raw, { factoryScope });
  return describeFactoryLease(normalized, { nowEpochMs });
}

export function createFactoryLeaseGhClient({ spawn } = {}) {
  const customApiClient = createGhApiClient({ ghFn: (args, options = {}) => {
    const runner = spawn;
    if (typeof runner !== "function") {
      throw new Error("createFactoryLeaseGhClient requires spawn when custom transport is provided");
    }
    const result = runner("gh", args, { encoding: "utf8", ...options });
    return {
      ok: result.status === 0,
      status: result.status ?? 1,
      stdout: String(result.stdout || ""),
      stderr: String(result.stderr || ""),
    };
  } });
  const apiClient = typeof spawn === "function" ? customApiClient : createGhApiClient();

  function getIssue({ repo, issueNumber }) {
    const loaded = apiClient.apiReadJson({
      apiPath: `repos/${repo}/issues/${issueNumber}`,
      includeHeaders: true,
      fallback: null,
      errorFallback: "gh_issue_get_failed",
    });
    if (!loaded.ok) {
      return { ok: false, error: loaded.error };
    }
    const issue = loaded.json;
    if (!issue || typeof issue !== "object") {
      return { ok: false, error: "invalid_issue_payload" };
    }
    return {
      ok: true,
      etag: loaded.etag,
      issue,
    };
  }

  function updateIssueBody({ repo, issueNumber, body, etag = "" }) {
    const updated = apiClient.apiWriteJson({
      apiPath: `repos/${repo}/issues/${issueNumber}`,
      method: "PATCH",
      payload: { body: String(body || "") },
      payloadMode: "form",
      etag,
      errorFallback: "gh_issue_patch_failed",
    });
    return {
      ok: updated.ok,
      precondition_failed: updated.precondition_failed,
      error: updated.ok ? "" : updated.error,
    };
  }

  return { getIssue, updateIssueBody };
}

export function decideFactoryLeaseAcquisition({
  snapshot,
  factoryScope = "",
  ownerId = "",
  runId = "",
  leaseToken = "",
  leaseSeconds = 300,
  nowEpochMs = Date.now(),
} = {}) {
  const { owner, run, scope } = normalizeOwnerRunScope({ ownerId, runId, factoryScope });
  const token = trim(leaseToken || buildDeterministicFactoryLeaseToken({ factoryScope: scope, ownerId: owner, runId: run }));
  if (!scope || !owner || !run || !token) {
    return { allowed: false, acquired: false, reason: "missing_scope_owner_or_token", lease: null };
  }

  const nowIso = new Date(nowEpochMs).toISOString();
  const current = snapshot?.lease || null;
  const reclaiming = Boolean(snapshot?.stale && current);
  const refreshing = Boolean(snapshot?.active && current && sameOwnerRun(current, owner, run) && sameToken(current, token));

  if (snapshot?.active && current && !refreshing) {
    return {
      allowed: false,
      acquired: false,
      reason: "active_lease_owned_by_other",
      lease: current,
    };
  }

  const next = normalizeFactoryLease({
    schema_version: FACTORY_LEASE_SCHEMA_VERSION,
    status: "active",
    lease_id: token,
    lease_token: token,
    factory_scope: scope,
    owner_id: owner,
    run_id: run,
    lease_started_at: refreshing ? trim(current?.lease_started_at || nowIso) : nowIso,
    heartbeat_at: nowIso,
    lease_expires_at: leaseExpiryIso(nowEpochMs, leaseSeconds),
    updated_at: nowIso,
    reclaim_count: reclaiming ? (Number(current?.reclaim_count || 0) + 1) : Number(current?.reclaim_count || 0) || 0,
    reclaimed_from_owner_id: reclaiming ? trim(current?.owner_id) : "",
    reclaimed_from_run_id: reclaiming ? trim(current?.run_id) : "",
    reclaimed_at: reclaiming ? nowIso : "",
    released_at: "",
    release_reason: "",
  }, { factoryScope: scope });

  const reason = refreshing
    ? "lease_refreshed"
    : reclaiming
      ? "stale_lease_reclaimed"
      : (snapshot?.released ? "released_lease_reacquired" : "lease_acquired");

  return {
    allowed: true,
    acquired: true,
    reason,
    lease: next,
  };
}

export function decideFactoryLeaseHeartbeat({
  snapshot,
  factoryScope = "",
  ownerId = "",
  runId = "",
  leaseToken = "",
  leaseSeconds = 300,
  nowEpochMs = Date.now(),
} = {}) {
  const { owner, run, scope } = normalizeOwnerRunScope({ ownerId, runId, factoryScope });
  const token = trim(leaseToken || buildDeterministicFactoryLeaseToken({ factoryScope: scope, ownerId: owner, runId: run }));
  if (!scope || !owner || !run || !token) {
    return { allowed: false, refreshed: false, reason: "missing_scope_owner_or_token", lease: null };
  }

  const current = snapshot?.lease || null;
  if (!snapshot?.present || !current) {
    return { allowed: false, refreshed: false, reason: "lease_missing", lease: null };
  }
  if (snapshot.released) {
    return { allowed: false, refreshed: false, reason: "lease_released", lease: current };
  }
  if (snapshot.stale) {
    return { allowed: false, refreshed: false, reason: "lease_stale", lease: current };
  }
  if (!sameOwnerRun(current, owner, run)) {
    return { allowed: false, refreshed: false, reason: "lease_owned_by_other", lease: current };
  }
  if (!sameToken(current, token)) {
    return { allowed: false, refreshed: false, reason: "lease_token_mismatch", lease: current };
  }

  const nowIso = new Date(nowEpochMs).toISOString();
  const next = normalizeFactoryLease({
    ...current,
    schema_version: FACTORY_LEASE_SCHEMA_VERSION,
    status: "active",
    heartbeat_at: nowIso,
    lease_expires_at: leaseExpiryIso(nowEpochMs, leaseSeconds),
    updated_at: nowIso,
    release_reason: "",
    released_at: "",
  }, { factoryScope: scope });

  return {
    allowed: true,
    refreshed: true,
    reason: "lease_heartbeat_refreshed",
    lease: next,
  };
}

export function decideFactoryLeaseRelease({
  snapshot,
  factoryScope = "",
  ownerId = "",
  runId = "",
  leaseToken = "",
  force = false,
  reason = "released",
  nowEpochMs = Date.now(),
} = {}) {
  const { owner, run, scope } = normalizeOwnerRunScope({ ownerId, runId, factoryScope });
  const token = trim(leaseToken || buildDeterministicFactoryLeaseToken({ factoryScope: scope, ownerId: owner, runId: run }));
  const current = snapshot?.lease || null;

  if (!scope) return { allowed: false, released: false, reason: "missing_scope", lease: null };
  if (!snapshot?.present || !current) return { allowed: true, released: false, reason: "lease_missing", lease: null };
  if (trim(current.status) === "released") return { allowed: true, released: false, reason: "lease_already_released", lease: current };

  if (!force) {
    if (!owner || !run || !token) return { allowed: false, released: false, reason: "missing_scope_owner_or_token", lease: current };
    if (!sameOwnerRun(current, owner, run)) return { allowed: true, released: false, reason: "lease_owned_by_other", lease: current };
    if (!sameToken(current, token)) return { allowed: true, released: false, reason: "lease_token_mismatch", lease: current };
  }

  const nowIso = new Date(nowEpochMs).toISOString();
  const next = normalizeFactoryLease({
    ...current,
    schema_version: FACTORY_LEASE_SCHEMA_VERSION,
    status: "released",
    heartbeat_at: nowIso,
    updated_at: nowIso,
    released_at: nowIso,
    release_reason: trim(reason || "released"),
  }, { factoryScope: scope });

  return {
    allowed: true,
    released: true,
    reason: "lease_released",
    lease: next,
  };
}

export function acquireFactoryLease({
  repo,
  issueNumber,
  factoryScope = "",
  ownerId = "",
  runId = "",
  leaseToken = "",
  leaseSeconds = 300,
  nowEpochMs = Date.now(),
  client = createFactoryLeaseGhClient(),
  maxAttempts = 5,
} = {}) {
  const issueNum = Number(issueNumber || 0);
  if (!repo || !issueNum) {
    return { ok: false, acquired: false, reason: "missing_repo_or_issue", lease: null };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const loaded = client.getIssue({ repo, issueNumber: issueNum });
    if (!loaded?.ok) {
      return { ok: false, acquired: false, reason: "issue_load_failed", error: loaded?.error || "", lease: null };
    }

    const snapshot = parseFactoryLeaseSnapshot(loaded.issue, { nowEpochMs, factoryScope });
    const decision = decideFactoryLeaseAcquisition({
      snapshot,
      factoryScope,
      ownerId,
      runId,
      leaseToken,
      leaseSeconds,
      nowEpochMs,
    });

    if (!decision.allowed || !decision.acquired || !decision.lease) {
      return {
        ok: true,
        acquired: false,
        reason: String(decision.reason || "lease_not_acquired"),
        lease: snapshot.lease,
      };
    }

    const nextBody = upsertFactoryLeaseInBody(String(loaded.issue?.body || ""), decision.lease);
    const patched = client.updateIssueBody({
      repo,
      issueNumber: issueNum,
      body: nextBody,
      etag: trim(loaded.etag),
    });

    if (patched?.ok) {
      return {
        ok: true,
        acquired: true,
        reason: String(decision.reason || "lease_acquired"),
        lease_token: String(decision.lease.lease_token || ""),
        lease: decision.lease,
        attempt,
      };
    }

    if (patched?.precondition_failed) continue;
    return {
      ok: false,
      acquired: false,
      reason: "lease_patch_failed",
      error: patched?.error || "",
      lease: snapshot.lease,
    };
  }

  return {
    ok: true,
    acquired: false,
    reason: "cas_conflict_retry_exhausted",
    lease: null,
  };
}

export function heartbeatFactoryLease({
  repo,
  issueNumber,
  factoryScope = "",
  ownerId = "",
  runId = "",
  leaseToken = "",
  leaseSeconds = 300,
  nowEpochMs = Date.now(),
  client = createFactoryLeaseGhClient(),
  maxAttempts = 5,
} = {}) {
  const issueNum = Number(issueNumber || 0);
  if (!repo || !issueNum) {
    return { ok: false, refreshed: false, reason: "missing_repo_or_issue", lease: null };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const loaded = client.getIssue({ repo, issueNumber: issueNum });
    if (!loaded?.ok) {
      return { ok: false, refreshed: false, reason: "issue_load_failed", error: loaded?.error || "", lease: null };
    }

    const snapshot = parseFactoryLeaseSnapshot(loaded.issue, { nowEpochMs, factoryScope });
    const decision = decideFactoryLeaseHeartbeat({
      snapshot,
      factoryScope,
      ownerId,
      runId,
      leaseToken,
      leaseSeconds,
      nowEpochMs,
    });

    if (!decision.allowed || !decision.refreshed || !decision.lease) {
      return {
        ok: true,
        refreshed: false,
        reason: String(decision.reason || "lease_heartbeat_skipped"),
        lease: snapshot.lease,
      };
    }

    const nextBody = upsertFactoryLeaseInBody(String(loaded.issue?.body || ""), decision.lease);
    const patched = client.updateIssueBody({
      repo,
      issueNumber: issueNum,
      body: nextBody,
      etag: trim(loaded.etag),
    });

    if (patched?.ok) {
      return {
        ok: true,
        refreshed: true,
        reason: String(decision.reason || "lease_heartbeat_refreshed"),
        lease_token: String(decision.lease.lease_token || ""),
        lease: decision.lease,
        attempt,
      };
    }

    if (patched?.precondition_failed) continue;
    return {
      ok: false,
      refreshed: false,
      reason: "lease_patch_failed",
      error: patched?.error || "",
      lease: snapshot.lease,
    };
  }

  return {
    ok: true,
    refreshed: false,
    reason: "cas_conflict_retry_exhausted",
    lease: null,
  };
}

export function releaseFactoryLease({
  repo,
  issueNumber,
  factoryScope = "",
  ownerId = "",
  runId = "",
  leaseToken = "",
  force = false,
  reason = "released",
  nowEpochMs = Date.now(),
  client = createFactoryLeaseGhClient(),
  maxAttempts = 5,
} = {}) {
  const issueNum = Number(issueNumber || 0);
  if (!repo || !issueNum) {
    return { ok: false, released: false, reason: "missing_repo_or_issue", lease: null };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const loaded = client.getIssue({ repo, issueNumber: issueNum });
    if (!loaded?.ok) {
      return { ok: false, released: false, reason: "issue_load_failed", error: loaded?.error || "", lease: null };
    }

    const snapshot = parseFactoryLeaseSnapshot(loaded.issue, { nowEpochMs, factoryScope });
    const decision = decideFactoryLeaseRelease({
      snapshot,
      factoryScope,
      ownerId,
      runId,
      leaseToken,
      force,
      reason,
      nowEpochMs,
    });

    if (!decision.allowed || !decision.released || !decision.lease) {
      return {
        ok: true,
        released: false,
        reason: String(decision.reason || "lease_not_released"),
        lease: snapshot.lease,
      };
    }

    const nextBody = upsertFactoryLeaseInBody(String(loaded.issue?.body || ""), decision.lease);
    const patched = client.updateIssueBody({
      repo,
      issueNumber: issueNum,
      body: nextBody,
      etag: trim(loaded.etag),
    });

    if (patched?.ok) {
      return {
        ok: true,
        released: true,
        reason: String(decision.reason || "lease_released"),
        lease_token: String(decision.lease.lease_token || ""),
        lease: decision.lease,
        attempt,
      };
    }

    if (patched?.precondition_failed) continue;
    return {
      ok: false,
      released: false,
      reason: "lease_patch_failed",
      error: patched?.error || "",
      lease: snapshot.lease,
    };
  }

  return {
    ok: true,
    released: false,
    reason: "cas_conflict_retry_exhausted",
    lease: null,
  };
}

export function validateFactoryLeaseOwnership({
  repo,
  issueNumber,
  factoryScope = "",
  ownerId = "",
  runId = "",
  leaseToken = "",
  nowEpochMs = Date.now(),
  client = createFactoryLeaseGhClient(),
} = {}) {
  const issueNum = Number(issueNumber || 0);
  const { owner, run, scope } = normalizeOwnerRunScope({ ownerId, runId, factoryScope });
  const token = trim(leaseToken || buildDeterministicFactoryLeaseToken({ factoryScope: scope, ownerId: owner, runId: run }));

  if (!repo || !issueNum || !scope || !owner || !run || !token) {
    return {
      ok: false,
      valid: false,
      reason: "missing_repo_issue_scope_owner_or_token",
      lease: null,
      issue: null,
    };
  }

  const loaded = client.getIssue({ repo, issueNumber: issueNum });
  if (!loaded?.ok) {
    return {
      ok: false,
      valid: false,
      reason: "issue_load_failed",
      error: loaded?.error || "",
      lease: null,
      issue: null,
    };
  }

  const snapshot = parseFactoryLeaseSnapshot(loaded.issue, { nowEpochMs, factoryScope: scope });
  if (!snapshot.present || !snapshot.lease) {
    return { ok: true, valid: false, reason: "lease_missing", lease: null, issue: loaded.issue };
  }
  if (!snapshot.active) {
    return {
      ok: true,
      valid: false,
      reason: snapshot.stale ? "lease_stale" : (snapshot.released ? "lease_released" : "lease_not_active"),
      lease: snapshot.lease,
      issue: loaded.issue,
    };
  }
  if (!sameOwnerRun(snapshot.lease, owner, run)) {
    return { ok: true, valid: false, reason: "lease_owned_by_other", lease: snapshot.lease, issue: loaded.issue };
  }
  if (!sameToken(snapshot.lease, token)) {
    return { ok: true, valid: false, reason: "lease_token_mismatch", lease: snapshot.lease, issue: loaded.issue };
  }

  return { ok: true, valid: true, reason: "lease_valid", lease: snapshot.lease, issue: loaded.issue };
}
