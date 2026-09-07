import { trim, toEpochMs } from "./cli-helpers.ts";
const DEFAULT_LEASE_SECONDS = 7200;

export const WAVE_CLAIM_OWNER_CONTRACT_VERSION = "wave_claim_owner_contract/v1";

export const WAVE_CLAIM_TRANSITION_OWNERS = {
  acquire_claim: "wave.find-ready",
  refresh_claim: "wave.find-ready",
  reclaim_stale_claim: "wave.find-ready",
  lock_wave_marker: "wave.lock-ready",
  complete_wave_marker: "wave.complete-ready",
  release_terminal_claim: "wave.release-claim",
  release_orphaned_claim: "wave.sanitize-state",
};



function toIso(nowEpochMs = Date.now()) {
  const t = Number(nowEpochMs);
  return new Date(Number.isFinite(t) ? t : Date.now()).toISOString();
}

function withLeaseExpiry(nowEpochMs, leaseSeconds = DEFAULT_LEASE_SECONDS) {
  const seconds = Number(leaseSeconds);
  const saneSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_LEASE_SECONDS;
  return new Date((Number(nowEpochMs) || Date.now()) + saneSeconds * 1000).toISOString();
}

function sameOwnerRun(a, b) {
  return trim(a?.owner_id) && trim(a?.owner_id) === trim(b?.owner_id)
    && trim(a?.run_id) && trim(a?.run_id) === trim(b?.run_id);
}

export function listWaveClaimTransitionOwners() {
  const transitions = Object.entries(WAVE_CLAIM_TRANSITION_OWNERS)
    .map(([transition, owner]) => ({ transition, owner }))
    .sort((a, b) => a.transition.localeCompare(b.transition));

  return {
    schema_version: WAVE_CLAIM_OWNER_CONTRACT_VERSION,
    transitions,
  };
}

export function evaluateWaveClaimInvariants(claim, { nowEpochMs = Date.now() } = {}) {
  const violations = [];
  if (!claim || typeof claim !== "object") {
    violations.push("claim_missing");
    return { ok: false, violations };
  }

  if (!trim(claim.claim_token)) violations.push("claim_token_missing");
  if (!trim(claim.owner_id)) violations.push("owner_id_missing");
  if (!trim(claim.run_id)) violations.push("run_id_missing");
  if (!trim(claim.ready_issue_number)) violations.push("ready_issue_number_missing");
  if (!trim(claim.milestone_title)) violations.push("milestone_title_missing");

  const startedAtMs = toEpochMs(claim.lease_started_at);
  const expiresAtMs = toEpochMs(claim.lease_expires_at);
  const heartbeatAtMs = toEpochMs(claim.heartbeat_at || claim.updated_at);
  if (!Number.isFinite(startedAtMs)) violations.push("lease_started_at_invalid");
  if (!Number.isFinite(expiresAtMs)) violations.push("lease_expires_at_invalid");
  if (!Number.isFinite(heartbeatAtMs)) violations.push("heartbeat_at_invalid");

  if (Number.isFinite(startedAtMs) && Number.isFinite(expiresAtMs) && startedAtMs > expiresAtMs) {
    violations.push("lease_window_invalid");
  }
  if (Number.isFinite(heartbeatAtMs) && Number.isFinite(expiresAtMs) && heartbeatAtMs > expiresAtMs) {
    violations.push("heartbeat_after_expiry");
  }

  if (trim(claim.status) !== "released" && Number.isFinite(expiresAtMs) && expiresAtMs <= Number(nowEpochMs)) {
    violations.push("active_claim_expired");
  }

  return { ok: violations.length === 0, violations };
}

export function decideWaveClaimAcquisition({
  snapshot,
  issueNumber = "",
  milestoneTitle = "",
  ownerId = "",
  runId = "",
  claimToken = "",
  leaseSeconds = DEFAULT_LEASE_SECONDS,
  nowEpochMs = Date.now(),
  hasWaveInProgressLabel = false,
} = {}) {
  const owner = trim(ownerId || runId);
  const run = trim(runId || ownerId);
  const issueNum = trim(issueNumber);
  const milestone = trim(milestoneTitle);

  if (!owner || !run || !issueNum) {
    return {
      allowed: false,
      action: "deny",
      reason: "missing_owner_run_or_issue",
      transition_owner: "",
      claim: null,
    };
  }

  const current = snapshot?.claim || null;
  const currentIsActive = Boolean(snapshot?.active);
  const currentIsStale = Boolean(snapshot?.stale);

  if (currentIsActive && !sameOwnerRun(current, { owner_id: owner, run_id: run })) {
    return {
      allowed: false,
      action: "deny",
      reason: "active_claim_owned_by_other",
      transition_owner: WAVE_CLAIM_TRANSITION_OWNERS.acquire_claim,
      claim: current,
    };
  }

  if (currentIsStale && hasWaveInProgressLabel && !sameOwnerRun(current, { owner_id: owner, run_id: run })) {
    return {
      allowed: false,
      action: "deny",
      reason: "stale_claim_blocked_by_wave_in_progress",
      transition_owner: WAVE_CLAIM_TRANSITION_OWNERS.reclaim_stale_claim,
      claim: current,
    };
  }

  const nowIso = toIso(nowEpochMs);
  const resolvedToken = trim(claimToken || current?.claim_token || current?.claim_id);
  const reclaiming = Boolean(currentIsStale && current && !sameOwnerRun(current, { owner_id: owner, run_id: run }));
  const refreshing = Boolean(currentIsActive && sameOwnerRun(current, { owner_id: owner, run_id: run }));

  const nextClaim = {
    schema_version: trim(current?.schema_version) || "wave_marker_claim/v1",
    status: "active",
    claim_id: resolvedToken,
    claim_token: resolvedToken,
    owner_id: owner,
    run_id: run,
    ready_issue_number: issueNum,
    milestone_title: milestone || trim(current?.milestone_title),
    lease_started_at: refreshing ? trim(current?.lease_started_at || nowIso) : nowIso,
    lease_expires_at: withLeaseExpiry(nowEpochMs, leaseSeconds),
    heartbeat_at: nowIso,
    updated_at: nowIso,
    reclaim_count: Number(current?.reclaim_count || 0) + (reclaiming ? 1 : 0),
    reclaimed_from_owner_id: reclaiming ? trim(current?.owner_id) : "",
    reclaimed_from_run_id: reclaiming ? trim(current?.run_id) : "",
    reclaimed_at: reclaiming ? nowIso : "",
    released_at: "",
    release_reason: "",
  };

  const invariants = evaluateWaveClaimInvariants(nextClaim, { nowEpochMs: nowEpochMs - 1 });

  return {
    allowed: true,
    action: reclaiming ? "reclaim" : (refreshing ? "refresh" : "acquire"),
    reason: reclaiming ? "claim_reclaimed_stale" : (refreshing ? "claim_refreshed" : "claim_acquired"),
    transition_owner: reclaiming
      ? WAVE_CLAIM_TRANSITION_OWNERS.reclaim_stale_claim
      : (refreshing ? WAVE_CLAIM_TRANSITION_OWNERS.refresh_claim : WAVE_CLAIM_TRANSITION_OWNERS.acquire_claim),
    claim: nextClaim,
    invariants,
  };
}

export function decideWaveClaimRelease({
  snapshot,
  ownerId = "",
  runId = "",
  claimToken = "",
  force = false,
  nowEpochMs = Date.now(),
  reason = "released",
  issueNumber = "",
  milestoneTitle = "",
} = {}) {
  const current = snapshot?.claim || null;
  if (!current) {
    return {
      allowed: true,
      released: false,
      reason: "claim_missing",
      transition_owner: WAVE_CLAIM_TRANSITION_OWNERS.release_terminal_claim,
      claim: null,
    };
  }

  if (trim(current.status) === "released") {
    return {
      allowed: true,
      released: false,
      reason: "claim_already_released",
      transition_owner: WAVE_CLAIM_TRANSITION_OWNERS.release_terminal_claim,
      claim: current,
    };
  }

  const owner = trim(ownerId || runId);
  const run = trim(runId || ownerId);
  const wantedToken = trim(claimToken);

  if (!force) {
    if (!owner || !run || !wantedToken) {
      return {
        allowed: false,
        released: false,
        reason: "missing_owner_or_token",
        transition_owner: WAVE_CLAIM_TRANSITION_OWNERS.release_terminal_claim,
        claim: current,
      };
    }

    if (!sameOwnerRun(current, { owner_id: owner, run_id: run }) || trim(current.claim_token) !== wantedToken) {
      return {
        allowed: false,
        released: false,
        reason: "claim_owned_by_other",
        transition_owner: WAVE_CLAIM_TRANSITION_OWNERS.release_terminal_claim,
        claim: current,
      };
    }
  }

  const nowIso = toIso(nowEpochMs);
  const nextClaim = {
    ...current,
    ready_issue_number: trim(current.ready_issue_number || issueNumber),
    milestone_title: trim(current.milestone_title || milestoneTitle),
    status: "released",
    updated_at: nowIso,
    heartbeat_at: nowIso,
    released_at: nowIso,
    release_reason: trim(reason || "released"),
  };

  return {
    allowed: true,
    released: true,
    reason: "claim_released",
    transition_owner: force
      ? WAVE_CLAIM_TRANSITION_OWNERS.release_orphaned_claim
      : WAVE_CLAIM_TRANSITION_OWNERS.release_terminal_claim,
    claim: nextClaim,
  };
}

export function nextRetryCircuitState({
  state,
  nowEpochMs = Date.now(),
  maxAttempts = 3,
  baseBackoffMs = 1000,
  capBackoffMs = 60_000,
  terminalOverflowCount = 3,
} = {}) {
  const safeState = {
    attempt_count: Number(state?.attempt_count || 0),
    overflow_count: Number(state?.overflow_count || 0),
    circuit_state: trim(state?.circuit_state || "closed") || "closed",
    next_attempt_at: Number(state?.next_attempt_at || 0),
  };

  if (safeState.circuit_state === "terminal") {
    return {
      ...safeState,
      decision: "stop",
      reason: "terminal_circuit_open",
      throttled: true,
      backoff_ms: 0,
    };
  }

  if (safeState.circuit_state === "open" && safeState.next_attempt_at > nowEpochMs) {
    return {
      ...safeState,
      decision: "throttle",
      reason: "circuit_open_backoff",
      throttled: true,
      backoff_ms: Math.max(0, safeState.next_attempt_at - nowEpochMs),
    };
  }

  const attemptCount = safeState.attempt_count + 1;
  if (attemptCount <= Number(maxAttempts)) {
    return {
      attempt_count: attemptCount,
      overflow_count: safeState.overflow_count,
      circuit_state: "closed",
      next_attempt_at: 0,
      decision: "retry",
      reason: "retry_allowed",
      throttled: false,
      backoff_ms: 0,
    };
  }

  const overflowCount = safeState.overflow_count + 1;
  if (overflowCount >= Number(terminalOverflowCount)) {
    return {
      attempt_count: attemptCount,
      overflow_count: overflowCount,
      circuit_state: "terminal",
      next_attempt_at: 0,
      decision: "stop",
      reason: "retry_cap_terminal",
      throttled: true,
      backoff_ms: 0,
    };
  }

  const base = Math.max(1, Number(baseBackoffMs) || 1);
  const cap = Math.max(base, Number(capBackoffMs) || base);
  const backoffMs = Math.min(cap, base * 2 ** (overflowCount - 1));

  return {
    attempt_count: attemptCount,
    overflow_count: overflowCount,
    circuit_state: "open",
    next_attempt_at: nowEpochMs + backoffMs,
    decision: "open",
    reason: "retry_cap_open",
    throttled: true,
    backoff_ms: backoffMs,
  };
}

function sortSweepAction(a, b) {
  const rank = {
    release_claim: 0,
    cleanup_worktree_lock: 1,
  };
  const ar = rank[a?.type] ?? 99;
  const br = rank[b?.type] ?? 99;
  if (ar !== br) return ar - br;

  const am = trim(a?.milestone_title);
  const bm = trim(b?.milestone_title);
  if (am !== bm) return am.localeCompare(bm);

  const ai = trim(a?.issue_number || a?.lock_path);
  const bi = trim(b?.issue_number || b?.lock_path);
  return ai.localeCompare(bi);
}

export function planWaveClaimOrphanSweep({
  claimSnapshots = [],
  worktreeLocks = [],
  activeRunIds = [],
  nowEpochMs = Date.now(),
} = {}) {
  const activeRuns = new Set((Array.isArray(activeRunIds) ? activeRunIds : []).map((x) => trim(x)).filter(Boolean));
  const actions = [];

  for (const item of Array.isArray(claimSnapshots) ? claimSnapshots : []) {
    const status = trim(item?.status || "active");
    const expiresMs = toEpochMs(item?.lease_expires_at);
    const runId = trim(item?.run_id);
    const stale = status !== "released" && Number.isFinite(expiresMs) && expiresMs <= nowEpochMs;
    if (!stale) continue;
    if (runId && activeRuns.has(runId)) continue;

    actions.push({
      type: "release_claim",
      issue_number: trim(item?.issue_number),
      claim_token: trim(item?.claim_token),
      milestone_title: trim(item?.milestone_title),
      run_id: runId,
      reason: "stale_claim_artifact",
    });
  }

  for (const lock of Array.isArray(worktreeLocks) ? worktreeLocks : []) {
    const runId = trim(lock?.run_id);
    if (runId && activeRuns.has(runId)) continue;
    const lockPath = trim(lock?.lock_path);
    if (!lockPath) continue;
    actions.push({
      type: "cleanup_worktree_lock",
      lock_path: lockPath,
      milestone_title: trim(lock?.milestone_title),
      run_id: runId,
      reason: "stale_worktree_lock_residue",
    });
  }

  actions.sort(sortSweepAction);

  return {
    schema_version: "wave_claim_orphan_sweep/v1",
    action_count: actions.length,
    actions,
    stats: {
      release_claim_count: actions.filter((a) => a.type === "release_claim").length,
      cleanup_worktree_lock_count: actions.filter((a) => a.type === "cleanup_worktree_lock").length,
    },
  };
}

export function applyWaveClaimOrphanSweep({
  plan,
  releaseClaim = () => ({ ok: false, reason: "release_not_implemented" }),
  removeWorktreeLock = () => ({ ok: false, reason: "remove_not_implemented" }),
} = {}) {
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  const applied_actions = [];
  const failed_actions = [];

  for (const action of actions) {
    if (action.type === "release_claim") {
      const out = releaseClaim({
        issueNumber: trim(action.issue_number),
        claimToken: trim(action.claim_token),
        reason: trim(action.reason || "stale_claim_artifact"),
      });
      if (out?.ok) applied_actions.push(action);
      else failed_actions.push({ action, error: out?.reason || out?.error || "release_failed" });
      continue;
    }

    if (action.type === "cleanup_worktree_lock") {
      const out = removeWorktreeLock({
        lockPath: trim(action.lock_path),
        reason: trim(action.reason || "stale_worktree_lock_residue"),
      });
      if (out?.ok) applied_actions.push(action);
      else failed_actions.push({ action, error: out?.reason || out?.error || "cleanup_failed" });
      continue;
    }

    failed_actions.push({ action, error: "unknown_action_type" });
  }

  return {
    ok: failed_actions.length === 0,
    applied_count: applied_actions.length,
    failed_count: failed_actions.length,
    applied_actions,
    failed_actions,
  };
}
