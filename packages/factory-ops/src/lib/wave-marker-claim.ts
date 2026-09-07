import { createHash } from "node:crypto";

import {
  decideWaveClaimAcquisition,
  decideWaveClaimRelease,
  evaluateWaveClaimInvariants,
  listWaveClaimTransitionOwners,
} from "./wave-claim-lifecycle.ts";
import { createGhApiClient } from "../../../github-adapter/src/github-adapter.ts";

export const WAVE_MARKER_CLAIM_SCHEMA_VERSION = "wave_marker_claim/v1";
export const WAVE_MARKER_CLAIM_BLOCK_START = "<!-- taxi:wave-marker-claim -->";
export const WAVE_MARKER_CLAIM_BLOCK_END = "<!-- /taxi:wave-marker-claim -->";
export const WAVE_MARKER_CLAIM_TRANSITION_OWNERS = listWaveClaimTransitionOwners();

/**
 * Persistent wave marker claim contract.
 *
 * {
 *   schema_version: "wave_marker_claim/v1",
 *   status: "active" | "released",
 *   claim_id: string,
 *   claim_token: string,
 *   owner_id: string,
 *   run_id: string,
 *   ready_issue_number: string,
 *   milestone_title: string,
 *   lease_started_at: ISO8601,
 *   lease_expires_at: ISO8601,
 *   heartbeat_at: ISO8601,
 *   updated_at: ISO8601,
 *   reclaim_count: number,
 *   reclaimed_from_owner_id?: string,
 *   reclaimed_from_run_id?: string,
 *   reclaimed_at?: ISO8601,
 *   released_at?: ISO8601,
 *   release_reason?: string
 * }
 */


function parseJson(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function trim(v) {
  return String(v || "").trim();
}


function epochMs(iso) {
  const t = Date.parse(String(iso || "").trim());
  return Number.isFinite(t) ? t : Number.NaN;
}


export function milestoneTitleForWaveMarker(issue = {}) {
  const fromMilestone = trim(issue?.milestone?.title);
  if (fromMilestone) return fromMilestone;
  const m = trim(issue?.title).match(/^Wave Ready:\s*(.+)$/);
  return m ? trim(m[1]) : "";
}

export function buildDeterministicClaimToken({ ownerId = "", runId = "", issueNumber = "", milestoneTitle = "" } = {}) {
  const seed = [trim(ownerId), trim(runId), trim(issueNumber), trim(milestoneTitle)].join("|");
  const digest = createHash("sha256").update(seed).digest("hex").slice(0, 24);
  return `wave_claim_${digest}`;
}

export function normalizeWaveMarkerClaim(rawClaim, {
  issueNumber = "",
  milestoneTitle = "",
} = {}) {
  if (!rawClaim || typeof rawClaim !== "object") return null;
  const claim = {
    schema_version: WAVE_MARKER_CLAIM_SCHEMA_VERSION,
    status: trim(rawClaim.status) === "released" ? "released" : "active",
    claim_id: trim(rawClaim.claim_id || rawClaim.claim_token),
    claim_token: trim(rawClaim.claim_token),
    owner_id: trim(rawClaim.owner_id),
    run_id: trim(rawClaim.run_id),
    ready_issue_number: trim(rawClaim.ready_issue_number || issueNumber),
    milestone_title: trim(rawClaim.milestone_title || milestoneTitle),
    lease_started_at: trim(rawClaim.lease_started_at),
    lease_expires_at: trim(rawClaim.lease_expires_at),
    heartbeat_at: trim(rawClaim.heartbeat_at || rawClaim.updated_at),
    updated_at: trim(rawClaim.updated_at || rawClaim.heartbeat_at),
    reclaim_count: Number(rawClaim.reclaim_count || 0) || 0,
    reclaimed_from_owner_id: trim(rawClaim.reclaimed_from_owner_id),
    reclaimed_from_run_id: trim(rawClaim.reclaimed_from_run_id),
    reclaimed_at: trim(rawClaim.reclaimed_at),
    released_at: trim(rawClaim.released_at),
    release_reason: trim(rawClaim.release_reason),
  };

  if (!claim.claim_token || !claim.owner_id || !claim.ready_issue_number) return null;
  if (!claim.claim_id) claim.claim_id = claim.claim_token;
  if (!claim.run_id) claim.run_id = claim.owner_id;
  return claim;
}

export function parseWaveMarkerClaimFromBody(body = "", fallback = null) {
  const text = String(body || "");
  const start = text.indexOf(WAVE_MARKER_CLAIM_BLOCK_START);
  const end = text.indexOf(WAVE_MARKER_CLAIM_BLOCK_END);
  if (start < 0 || end < 0 || end < start) return fallback;
  const inside = text.slice(start + WAVE_MARKER_CLAIM_BLOCK_START.length, end).trim();
  if (!inside) return fallback;
  return parseJson(inside, fallback);
}

export function upsertWaveMarkerClaimInBody(body = "", claim = null) {
  const text = String(body || "");
  const claimJson = claim && typeof claim === "object" ? JSON.stringify(claim, null, 2) : "";
  const block = claimJson
    ? `${WAVE_MARKER_CLAIM_BLOCK_START}\n${claimJson}\n${WAVE_MARKER_CLAIM_BLOCK_END}`
    : "";

  const start = text.indexOf(WAVE_MARKER_CLAIM_BLOCK_START);
  const end = text.indexOf(WAVE_MARKER_CLAIM_BLOCK_END);

  if (start >= 0 && end >= 0 && end >= start) {
    const before = text.slice(0, start).replace(/\s*$/, "");
    const after = text.slice(end + WAVE_MARKER_CLAIM_BLOCK_END.length).replace(/^\s*/, "");
    if (!block) return [before, after].filter(Boolean).join("\n\n").trim();
    return [before, block, after].filter(Boolean).join("\n\n").trim();
  }

  if (!block) return text;
  return text.trim() ? `${text.trim()}\n\n${block}` : block;
}

export function describeWaveMarkerClaim(claim, { nowEpochMs = Date.now() } = {}) {
  const normalized = normalizeWaveMarkerClaim(claim);
  if (!normalized) {
    return { present: false, status: "none", active: false, stale: false, released: false, claim: null };
  }

  const expiresAtMs = epochMs(normalized.lease_expires_at);
  const isReleased = normalized.status === "released";
  const isActive = !isReleased && Number.isFinite(expiresAtMs) && expiresAtMs > nowEpochMs;
  const isStale = !isReleased && Number.isFinite(expiresAtMs) && expiresAtMs <= nowEpochMs;

  return {
    present: true,
    status: isReleased ? "released" : (isActive ? "active" : (isStale ? "stale" : "unknown")),
    active: isActive,
    stale: isStale,
    released: isReleased,
    claim: normalized,
  };
}

export function parseWaveMarkerClaimSnapshot(issue = {}, { nowEpochMs = Date.now() } = {}) {
  const raw = parseWaveMarkerClaimFromBody(String(issue?.body || ""), null);
  const normalized = normalizeWaveMarkerClaim(raw, {
    issueNumber: String(issue?.number || ""),
    milestoneTitle: milestoneTitleForWaveMarker(issue),
  });
  return describeWaveMarkerClaim(normalized, { nowEpochMs });
}

export function createWaveClaimGhClient({ spawn } = {}) {
  const apiClient = createGhApiClient({ ghFn: (args, options = {}) => {
    const runner = spawn;
    if (typeof runner !== "function") {
      throw new Error("createWaveClaimGhClient requires spawn when custom transport is provided");
    }
    const result = runner("gh", args, { encoding: "utf8", ...options });
    return {
      ok: result.status === 0,
      status: result.status ?? 1,
      stdout: String(result.stdout || ""),
      stderr: String(result.stderr || ""),
    };
  } });

  const defaultApiClient = typeof spawn === "function" ? apiClient : createGhApiClient();

  function getIssue({ repo, issueNumber }) {
    const loaded = defaultApiClient.apiReadJson({
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
    // Note: GitHub Issues API does not support If-Match conditional headers.
    // CAS safety relies on claim-block content checks, not HTTP-level ETags.
    const updated = defaultApiClient.apiWriteJson({
      apiPath: `repos/${repo}/issues/${issueNumber}`,
      method: "PATCH",
      payload: { body: String(body || "") },
      payloadMode: "input",
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

function normalizeOwnerAndRun({ ownerId = "", runId = "" } = {}) {
  const owner = trim(ownerId || runId);
  const run = trim(runId || owner);
  return { owner, run };
}

function sameOwner(a, b) {
  return trim(a?.owner_id) && trim(a?.owner_id) === trim(b?.owner_id)
    && trim(a?.run_id) && trim(a?.run_id) === trim(b?.run_id);
}

function hasIssueLabel(issue, labelName) {
  const wanted = trim(labelName);
  if (!wanted) return false;
  const labels = Array.isArray(issue?.labels) ? issue.labels : [];
  return labels.some((label) => trim(label?.name) === wanted);
}

export function acquireWaveMarkerClaim({
  repo,
  issueNumber,
  milestoneTitle = "",
  ownerId = "",
  runId = "",
  claimToken = "",
  leaseSeconds = 1200,
  nowEpochMs = Date.now(),
  client = createWaveClaimGhClient(),
  maxAttempts = 5,
} = {}) {
  const issueNum = Number(issueNumber || 0);
  const { owner, run } = normalizeOwnerAndRun({ ownerId, runId });
  if (!repo || !issueNum || !owner || !run) {
    return { ok: false, acquired: false, reason: "missing_repo_issue_or_owner", claim: null };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const loaded = client.getIssue({ repo, issueNumber: issueNum });
    if (!loaded?.ok) {
      return { ok: false, acquired: false, reason: "issue_load_failed", error: loaded?.error || "" };
    }

    const issue = loaded.issue || {};
    const state = String(issue?.state || "open").toLowerCase();
    if (state === "closed") {
      return { ok: true, acquired: false, reason: "issue_closed", claim: null };
    }

    const markerMilestone = milestoneTitleForWaveMarker(issue);
    const effectiveMilestone = trim(milestoneTitle || markerMilestone);
    const snapshot = parseWaveMarkerClaimSnapshot(issue, { nowEpochMs });
    const defaultToken = trim(claimToken || buildDeterministicClaimToken({
      ownerId: owner,
      runId: run,
      issueNumber: issueNum,
      milestoneTitle: effectiveMilestone,
    }));

    const decision = decideWaveClaimAcquisition({
      snapshot,
      issueNumber: String(issueNum),
      milestoneTitle: effectiveMilestone,
      ownerId: owner,
      runId: run,
      claimToken: defaultToken,
      leaseSeconds,
      nowEpochMs,
      hasWaveInProgressLabel: hasIssueLabel(issue, "wave-in-progress"),
    });

    if (!decision?.allowed || !decision?.claim) {
      return {
        ok: true,
        acquired: false,
        reason: String(decision?.reason || "claim_not_acquired"),
        claim: snapshot.claim,
      };
    }

    const nextClaim = normalizeWaveMarkerClaim({
      ...decision.claim,
      schema_version: WAVE_MARKER_CLAIM_SCHEMA_VERSION,
    }, { issueNumber: String(issueNum), milestoneTitle: effectiveMilestone });

    const invariants = evaluateWaveClaimInvariants(nextClaim, { nowEpochMs: nowEpochMs - 1 });
    if (!invariants.ok) {
      return {
        ok: false,
        acquired: false,
        reason: "claim_invariant_failed",
        error: invariants.violations.join(","),
      };
    }

    const nextBody = upsertWaveMarkerClaimInBody(String(issue?.body || ""), nextClaim);
    const patched = client.updateIssueBody({
      repo,
      issueNumber: issueNum,
      body: nextBody,
      etag: trim(loaded.etag),
    });

    if (patched?.ok) {
      const verified = client.getIssue({ repo, issueNumber: issueNum });
      if (!verified?.ok) {
        return {
          ok: false,
          acquired: false,
          reason: "claim_verify_load_failed",
          error: verified?.error || "",
        };
      }

      const verifiedSnapshot = parseWaveMarkerClaimSnapshot(verified.issue, { nowEpochMs });
      const verifiedClaim = verifiedSnapshot?.claim || null;
      const ownsVerifiedClaim = Boolean(
        verifiedSnapshot?.active
          && verifiedClaim
          && sameOwner(verifiedClaim, { owner_id: owner, run_id: run })
          && trim(verifiedClaim.claim_token) === trim(nextClaim.claim_token),
      );

      if (ownsVerifiedClaim) {
        return {
          ok: true,
          acquired: true,
          reason: String(decision.reason || "claim_acquired"),
          transition_owner: String(decision.transition_owner || ""),
          claim: verifiedClaim,
          attempt,
        };
      }

      if (verifiedSnapshot?.active && verifiedClaim) {
        return {
          ok: true,
          acquired: false,
          reason: "active_claim_owned_by_other",
          claim: verifiedClaim,
        };
      }

      continue;
    }

    if (patched?.precondition_failed) continue;

    return {
      ok: false,
      acquired: false,
      reason: "claim_patch_failed",
      error: patched?.error || "",
    };
  }

  return {
    ok: true,
    acquired: false,
    reason: "cas_conflict_retry_exhausted",
    claim: null,
  };
}

export function validateWaveMarkerClaimOwnership({
  repo,
  issueNumber,
  ownerId = "",
  runId = "",
  claimToken = "",
  nowEpochMs = Date.now(),
  client = createWaveClaimGhClient(),
} = {}) {
  const issueNum = Number(issueNumber || 0);
  const { owner, run } = normalizeOwnerAndRun({ ownerId, runId });
  const wantedToken = trim(claimToken);

  if (!repo || !issueNum || !owner || !run || !wantedToken) {
    return {
      ok: false,
      valid: false,
      reason: "missing_repo_issue_owner_or_token",
      claim: null,
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
      claim: null,
      issue: null,
    };
  }

  const snapshot = parseWaveMarkerClaimSnapshot(loaded.issue, { nowEpochMs });
  if (!snapshot.present || !snapshot.claim) {
    return { ok: true, valid: false, reason: "claim_missing", claim: null, issue: loaded.issue };
  }
  if (!snapshot.active) {
    return { ok: true, valid: false, reason: snapshot.stale ? "claim_stale" : "claim_not_active", claim: snapshot.claim, issue: loaded.issue };
  }
  if (!sameOwner(snapshot.claim, { owner_id: owner, run_id: run })) {
    return { ok: true, valid: false, reason: "claim_owned_by_other", claim: snapshot.claim, issue: loaded.issue };
  }
  if (trim(snapshot.claim.claim_token) !== wantedToken) {
    return { ok: true, valid: false, reason: "claim_token_mismatch", claim: snapshot.claim, issue: loaded.issue };
  }
  return { ok: true, valid: true, reason: "claim_valid", claim: snapshot.claim, issue: loaded.issue };
}

export function releaseWaveMarkerClaim({
  repo,
  issueNumber,
  ownerId = "",
  runId = "",
  claimToken = "",
  reason = "",
  force = false,
  nowEpochMs = Date.now(),
  client = createWaveClaimGhClient(),
  maxAttempts = 5,
} = {}) {
  const issueNum = Number(issueNumber || 0);
  const { owner, run } = normalizeOwnerAndRun({ ownerId, runId });
  const wantedToken = trim(claimToken);

  if (!repo || !issueNum) {
    return { ok: false, released: false, reason: "missing_repo_or_issue", claim: null };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const loaded = client.getIssue({ repo, issueNumber: issueNum });
    if (!loaded?.ok) {
      return { ok: false, released: false, reason: "issue_load_failed", error: loaded?.error || "" };
    }

    const snapshot = parseWaveMarkerClaimSnapshot(loaded.issue, { nowEpochMs });
    if (!snapshot.present || !snapshot.claim) {
      return { ok: true, released: false, reason: "claim_missing", claim: null };
    }

    const releaseDecision = decideWaveClaimRelease({
      snapshot,
      ownerId: owner,
      runId: run,
      claimToken: wantedToken,
      force,
      nowEpochMs,
      reason,
      issueNumber: String(issueNum),
      milestoneTitle: snapshot.claim?.milestone_title || milestoneTitleForWaveMarker(loaded.issue),
    });

    if (!releaseDecision.allowed || !releaseDecision.released || !releaseDecision.claim) {
      return {
        ok: true,
        released: false,
        reason: String(releaseDecision.reason || "claim_not_released"),
        transition_owner: String(releaseDecision.transition_owner || ""),
        claim: snapshot.claim,
      };
    }

    const releasedClaim = normalizeWaveMarkerClaim(releaseDecision.claim, {
      issueNumber: String(issueNum),
      milestoneTitle: snapshot.claim?.milestone_title || milestoneTitleForWaveMarker(loaded.issue),
    });

    // Clear the embedded claim block entirely on release (not just mark status:"released").
    // Leaving stale claim JSON in the body causes subsequent ticks to see "already claimed".
    const nextBody = upsertWaveMarkerClaimInBody(String(loaded.issue?.body || ""), null);
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
        reason: String(releaseDecision.reason || "claim_released"),
        transition_owner: String(releaseDecision.transition_owner || ""),
        claim: releasedClaim,
        attempt,
      };
    }

    if (patched?.precondition_failed) continue;

    return {
      ok: false,
      released: false,
      reason: "claim_patch_failed",
      error: patched?.error || "",
      claim: snapshot.claim,
    };
  }

  return {
    ok: true,
    released: false,
    reason: "cas_conflict_retry_exhausted",
    claim: null,
  };
}
