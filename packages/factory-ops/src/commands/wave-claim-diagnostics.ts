import {
  acquireWaveMarkerClaim,
  buildDeterministicClaimToken,
  parseWaveMarkerClaimFromBody,
  releaseWaveMarkerClaim,
  upsertWaveMarkerClaimInBody,
  validateWaveMarkerClaimOwnership,
  WAVE_MARKER_CLAIM_SCHEMA_VERSION,
} from "./wave-claim.ts";
import {
  completeReadyWaveIssue,
  lockReadyWaveIssue,
} from "./wave-claim.ts";
import {
  applyWaveClaimOrphanSweep,
  listWaveClaimTransitionOwners,
  nextRetryCircuitState,
  planWaveClaimOrphanSweep,
} from "../lib/wave-claim-lifecycle.ts";

function assertion(name, ok, expected, actual) {
  return {
    name,
    ok: Boolean(ok),
    expected,
    actual,
  };
}

function gateResult(gate, assertions = [], details = {}) {
  const failed_assertions = assertions.filter((item) => !item.ok).map((item) => item.name);
  return {
    gate,
    ok: failed_assertions.length === 0,
    failed_assertions,
    assertions,
    details,
  };
}

function issue({ number = 1, milestone = "goal-1-wave-1", body = "", state = "open", labels = ["ready"] } = {}) {
  return {
    number,
    title: `Wave Ready: ${milestone}`,
    milestone: { title: milestone },
    labels: (Array.isArray(labels) ? labels : []).map((name) => ({ name })),
    body,
    state,
  };
}

function createCasIssueClient(initialIssue) {
  const state = {
    etag: 1,
    issue: structuredClone(initialIssue),
  };

  return {
    getIssue() {
      return {
        ok: true,
        etag: `"${state.etag}"`,
        issue: structuredClone(state.issue),
      };
    },
    updateIssueBody({ body, etag }) {
      if (String(etag || "") && String(etag) !== `"${state.etag}"`) {
        return { ok: false, precondition_failed: true, error: "etag_mismatch" };
      }
      state.issue.body = String(body || "");
      state.etag += 1;
      return { ok: true };
    },
    snapshot() {
      return structuredClone(state.issue);
    },
    applyIssueMutation(mutator) {
      if (typeof mutator === "function") mutator(state.issue);
    },
  };
}

function createRaceIssueClients(initialIssue) {
  const shared = {
    etag: 1,
    issue: structuredClone(initialIssue),
    staleIssue: structuredClone(initialIssue),
  };

  function makeClient({ staleFirstRead = false } = {}) {
    let servedStale = false;
    return {
      getIssue() {
        if (staleFirstRead && !servedStale) {
          servedStale = true;
          return {
            ok: true,
            etag: '"1"',
            issue: structuredClone(shared.staleIssue),
          };
        }

        return {
          ok: true,
          etag: `"${shared.etag}"`,
          issue: structuredClone(shared.issue),
        };
      },
      updateIssueBody({ body, etag }) {
        if (String(etag || "") && String(etag) !== `"${shared.etag}"`) {
          return { ok: false, precondition_failed: true, error: "etag_mismatch" };
        }
        shared.issue.body = String(body || "");
        shared.etag += 1;
        return { ok: true };
      },
    };
  }

  return {
    makeClient,
    snapshot() {
      return structuredClone(shared.issue);
    },
  };
}

function hasArg(args, value) {
  return Array.isArray(args) && args.some((entry) => String(entry) === value);
}

function argValue(args, flag) {
  if (!Array.isArray(args)) return "";
  const index = args.indexOf(flag);
  if (index < 0) return "";
  return String(args[index + 1] || "");
}

function applyEditIssue(issueState, args) {
  if (hasArg(args, "--add-label")) {
    const name = argValue(args, "--add-label");
    if (name && !(Array.isArray(issueState.labels) ? issueState.labels : []).some((entry) => String(entry?.name || "") === name)) {
      issueState.labels = [...(Array.isArray(issueState.labels) ? issueState.labels : []), { name }];
    }
  }

  if (hasArg(args, "--remove-label")) {
    const removed = new Set();
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === "--remove-label") removed.add(String(args[i + 1] || ""));
    }
    issueState.labels = (Array.isArray(issueState.labels) ? issueState.labels : [])
      .filter((entry) => !removed.has(String(entry?.name || "")));
  }
}

function runContentionGate(nowEpochMs) {
  const milestone = "goal-205-wave-5";
  const repo = "recallnet/astrochicken";
  const readyIssueNumber = 920;
  const client = createCasIssueClient(issue({ number: readyIssueNumber, milestone }));
  const sideEffects = [];
  const releaseCalls = [];

  const execGh = (args) => {
    sideEffects.push(args.map((entry) => String(entry)));
    const command = String(args?.[1] || "");
    if (command === "edit") {
      client.applyIssueMutation((draft) => applyEditIssue(draft, args));
      return { ok: true };
    }
    if (command === "close") {
      client.applyIssueMutation((draft) => {
        draft.state = "closed";
      });
      return { ok: true };
    }
    return { ok: true };
  };

  const claimAcquire = (payload) => acquireWaveMarkerClaim({ ...payload, client, nowEpochMs });
  const claimValidator = (payload) => validateWaveMarkerClaimOwnership({ ...payload, client, nowEpochMs });
  const claimReleaser = (payload) => {
    releaseCalls.push(payload);
    return releaseWaveMarkerClaim({ ...payload, client, nowEpochMs: nowEpochMs + 60_000 });
  };

  const workerA = {
    ownerId: "worker-a",
    runId: "run-a",
    claimToken: buildDeterministicClaimToken({ ownerId: "worker-a", runId: "run-a", issueNumber: readyIssueNumber, milestoneTitle: milestone }),
  };

  const workerB = {
    ownerId: "worker-b",
    runId: "run-b",
    claimToken: buildDeterministicClaimToken({ ownerId: "worker-b", runId: "run-b", issueNumber: readyIssueNumber, milestoneTitle: milestone }),
  };

  const lockWinner = lockReadyWaveIssue({
    repo,
    readyIssueNumber,
    milestoneTitle: milestone,
    claimToken: workerA.claimToken,
    claimOwnerId: workerA.ownerId,
    claimRunId: workerA.runId,
    nowEpochMs,
    claimAcquire,
    claimReleaser,
    execGh,
  });

  const lockLoser = lockReadyWaveIssue({
    repo,
    readyIssueNumber,
    milestoneTitle: milestone,
    claimToken: workerB.claimToken,
    claimOwnerId: workerB.ownerId,
    claimRunId: workerB.runId,
    nowEpochMs,
    claimAcquire,
    claimReleaser,
    execGh,
  });

  const completeWinner = completeReadyWaveIssue({
    repo,
    readyIssueNumber,
    claimToken: workerA.claimToken,
    claimOwnerId: workerA.ownerId,
    claimRunId: workerA.runId,
    claimValidator,
    claimReleaser,
    execGh,
  });

  const sideEffectsBeforeLoserRetry = sideEffects.length;
  const completeLoser = completeReadyWaveIssue({
    repo,
    readyIssueNumber,
    claimToken: workerB.claimToken,
    claimOwnerId: workerB.ownerId,
    claimRunId: workerB.runId,
    claimValidator,
    claimReleaser,
    execGh,
  });
  const completeLoserRetry = completeReadyWaveIssue({
    repo,
    readyIssueNumber,
    claimToken: workerB.claimToken,
    claimOwnerId: workerB.ownerId,
    claimRunId: workerB.runId,
    claimValidator,
    claimReleaser,
    execGh,
  });

  const closeCount = sideEffects.filter((args) => args[0] === "issue" && args[1] === "close").length;
  const lockLabelMutations = sideEffects.filter((args) => args[0] === "issue" && args[1] === "edit" && hasArg(args, "--add-label")).length;

  const assertions = [
    assertion("single_worker_lock_granted", lockWinner.lock_granted === "true" && lockLoser.lock_granted !== "true", "winner=true loser=false", `${lockWinner.lock_granted}/${lockLoser.lock_granted}`),
    assertion("loser_park_reason", lockLoser.reason === "active_claim_owned_by_other", "active_claim_owned_by_other", lockLoser.reason),
    assertion("single_lock_label_mutation", lockLabelMutations === 1, 1, lockLabelMutations),
    assertion("single_terminal_close_side_effect", closeCount === 1, 1, closeCount),
    assertion("loser_completion_short_circuited", completeLoser.short_circuited === true && completeLoserRetry.short_circuited === true, true, `${completeLoser.short_circuited}/${completeLoserRetry.short_circuited}`),
    assertion("loser_retry_idempotent_no_extra_mutation", sideEffects.length === sideEffectsBeforeLoserRetry, sideEffectsBeforeLoserRetry, sideEffects.length),
    assertion("single_claim_release", releaseCalls.length === 1, 1, releaseCalls.length),
    assertion("winner_completed", completeWinner.completed === true, true, completeWinner.completed),
  ];

  return gateResult("contention", assertions, {
    winner: { lock: lockWinner, complete: completeWinner },
    loser: { lock: lockLoser, complete: completeLoser, complete_retry: completeLoserRetry },
    side_effect_count: sideEffects.length,
  });
}

function runReclaimGate(nowEpochMs) {
  const milestone = "goal-205-wave-6";
  const issueNumber = 930;
  const staleClaim = {
    schema_version: WAVE_MARKER_CLAIM_SCHEMA_VERSION,
    status: "active",
    claim_id: "wave_claim_old",
    claim_token: "wave_claim_old",
    owner_id: "worker-dead",
    run_id: "run-dead",
    ready_issue_number: String(issueNumber),
    milestone_title: milestone,
    lease_started_at: "2026-01-01T00:00:00.000Z",
    lease_expires_at: "2026-01-01T00:05:00.000Z",
    heartbeat_at: "2026-01-01T00:04:59.000Z",
    updated_at: "2026-01-01T00:04:59.000Z",
    reclaim_count: 0,
  };

  const race = createRaceIssueClients(issue({
    number: issueNumber,
    milestone,
    labels: ["ready"],
    body: upsertWaveMarkerClaimInBody("Wave marker", staleClaim),
  }));

  const workerA = acquireWaveMarkerClaim({
    repo: "recallnet/astrochicken",
    issueNumber,
    milestoneTitle: milestone,
    ownerId: "worker-a",
    runId: "run-a",
    claimToken: "wave_claim_new_a",
    leaseSeconds: 1200,
    nowEpochMs,
    client: race.makeClient({ staleFirstRead: true }),
  });

  const workerB = acquireWaveMarkerClaim({
    repo: "recallnet/astrochicken",
    issueNumber,
    milestoneTitle: milestone,
    ownerId: "worker-b",
    runId: "run-b",
    claimToken: "wave_claim_new_b",
    leaseSeconds: 1200,
    nowEpochMs,
    client: race.makeClient({ staleFirstRead: true }),
  });

  const results = [workerA, workerB];
  const reclaimedCount = results.filter((result) => result.acquired && result.reason === "claim_reclaimed_stale").length;
  const reacquiredCount = results.filter((result) => result.acquired).length;
  const deniedCount = results.filter((result) => !result.acquired && result.reason === "active_claim_owned_by_other").length;
  const finalClaim = parseWaveMarkerClaimFromBody(race.snapshot().body, null) || {};

  const assertions = [
    assertion("single_reclaim_path", reclaimedCount === 1, 1, reclaimedCount),
    assertion("single_reacquired_claim", reacquiredCount === 1, 1, reacquiredCount),
    assertion("race_loser_observes_active_owner", deniedCount === 1, 1, deniedCount),
    assertion("metadata_reclaim_count_recorded", Number(finalClaim.reclaim_count || 0) === 1, 1, Number(finalClaim.reclaim_count || 0)),
    assertion("metadata_previous_owner_recorded", finalClaim.reclaimed_from_owner_id === "worker-dead", "worker-dead", finalClaim.reclaimed_from_owner_id),
    assertion("metadata_previous_run_recorded", finalClaim.reclaimed_from_run_id === "run-dead", "run-dead", finalClaim.reclaimed_from_run_id),
    assertion("metadata_heartbeat_present", Boolean(finalClaim.heartbeat_at), true, Boolean(finalClaim.heartbeat_at)),
  ];

  return gateResult("reclaim", assertions, {
    worker_a: workerA,
    worker_b: workerB,
    final_claim: finalClaim,
  });
}

function simulateLegacyUnboundedRetry({ maxAttempts = 3, guardRailIterations = 32 } = {}) {
  let attempt = 0;
  for (let i = 0; i < guardRailIterations; i += 1) {
    attempt += 1;
  }
  return {
    attempt_count: attempt,
    max_attempts: maxAttempts,
    runaway_detected: attempt > maxAttempts,
  };
}

function runCircuitGate(nowEpochMs) {
  const maxAttempts = 3;
  const baseBackoffMs = 1000;
  const capBackoffMs = 8000;
  const terminalOverflowCount = 3;

  let state = {
    attempt_count: 0,
    overflow_count: 0,
    circuit_state: "closed",
    next_attempt_at: 0,
  };

  const history = [];
  const timeline = [0, 1, 2, 3, 3, 1004, 1004, 3008];
  for (const offset of timeline) {
    state = nextRetryCircuitState({
      state,
      nowEpochMs: nowEpochMs + offset,
      maxAttempts,
      baseBackoffMs,
      capBackoffMs,
      terminalOverflowCount,
    });
    history.push(state);
  }

  const openTransitions = history.filter((entry) => entry.decision === "open");
  const throttles = history.filter((entry) => entry.decision === "throttle");
  const terminal = history.find((entry) => entry.circuit_state === "terminal");
  const legacy = simulateLegacyUnboundedRetry({ maxAttempts, guardRailIterations: 16 });

  const assertions = [
    assertion("legacy_baseline_detects_unbounded_retry", legacy.runaway_detected === true, true, legacy.runaway_detected),
    assertion("hard_retry_cap_enforced", openTransitions.length >= 1, ">=1", openTransitions.length),
    assertion(
      "deterministic_exponential_backoff",
      openTransitions.map((entry) => entry.backoff_ms).slice(0, 2).join(",") === "1000,2000",
      "1000,2000",
      openTransitions.map((entry) => entry.backoff_ms).slice(0, 2).join(","),
    ),
    assertion("circuit_open_throttle_observable", throttles.length >= 1, ">=1", throttles.length),
    assertion("circuit_terminal_stop_after_overflow", Boolean(terminal), true, Boolean(terminal)),
  ];

  return gateResult("circuit", assertions, {
    history,
    legacy,
  });
}

function runOrphanSweepGate(nowEpochMs) {
  const orphanState = {
    claims: [
      {
        issue_number: "940",
        claim_token: "wave_claim_940",
        status: "active",
        milestone_title: "goal-205-wave-7",
        run_id: "run-dead",
        lease_expires_at: "2026-01-01T00:05:00.000Z",
      },
      {
        issue_number: "941",
        claim_token: "wave_claim_941",
        status: "active",
        milestone_title: "goal-205-wave-8",
        run_id: "run-live",
        lease_expires_at: "2099-01-01T00:05:00.000Z",
      },
    ],
    worktreeLocks: [
      {
        lock_path: "/tmp/wave-locks/goal-205-wave-7.lock",
        milestone_title: "goal-205-wave-7",
        run_id: "run-dead",
      },
      {
        lock_path: "/tmp/wave-locks/goal-205-wave-8.lock",
        milestone_title: "goal-205-wave-8",
        run_id: "run-live",
      },
    ],
    activeRunIds: ["run-live"],
  };

  const firstPlan = planWaveClaimOrphanSweep({
    claimSnapshots: orphanState.claims,
    worktreeLocks: orphanState.worktreeLocks,
    activeRunIds: orphanState.activeRunIds,
    nowEpochMs,
  });

  const firstApply = applyWaveClaimOrphanSweep({
    plan: firstPlan,
    releaseClaim: ({ issueNumber }) => {
      const target = orphanState.claims.find((entry) => String(entry.issue_number) === String(issueNumber));
      if (!target) return { ok: false, reason: "claim_not_found" };
      target.status = "released";
      return { ok: true, reason: "claim_released" };
    },
    removeWorktreeLock: ({ lockPath }) => {
      const before = orphanState.worktreeLocks.length;
      orphanState.worktreeLocks = orphanState.worktreeLocks.filter((entry) => String(entry.lock_path) !== String(lockPath));
      return { ok: orphanState.worktreeLocks.length < before, reason: "lock_removed" };
    },
  });

  const secondPlan = planWaveClaimOrphanSweep({
    claimSnapshots: orphanState.claims,
    worktreeLocks: orphanState.worktreeLocks,
    activeRunIds: orphanState.activeRunIds,
    nowEpochMs,
  });

  const assertions = [
    assertion("orphan_plan_contains_claim_and_lock_cleanup", firstPlan.action_count === 2, 2, firstPlan.action_count),
    assertion("orphan_apply_succeeds", firstApply.ok === true, true, firstApply.ok),
    assertion("orphan_cleanup_idempotent_on_rerun", secondPlan.action_count === 0, 0, secondPlan.action_count),
    assertion(
      "orphan_cleanup_contract_explicit",
      firstPlan.actions.map((action) => action.type).join(",") === "release_claim,cleanup_worktree_lock",
      "release_claim,cleanup_worktree_lock",
      firstPlan.actions.map((action) => action.type).join(","),
    ),
  ];

  return gateResult("orphan_sweep", assertions, {
    first_plan: firstPlan,
    first_apply: firstApply,
    second_plan: secondPlan,
  });
}

export function runWaveClaimDiagnostics({ nowEpochMs = Date.parse("2026-01-01T01:00:00.000Z") } = {}) {
  const checks = [
    runContentionGate(nowEpochMs),
    runReclaimGate(nowEpochMs),
    runCircuitGate(nowEpochMs),
    runOrphanSweepGate(nowEpochMs),
  ];

  const failed = checks.filter((check) => !check.ok);

  return {
    schema_version: "wave_claim_diagnostics/v1",
    generated_at: new Date(nowEpochMs).toISOString(),
    ok: failed.length === 0,
    ownership_contract: listWaveClaimTransitionOwners(),
    checks,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
      failed_gates: failed.map((entry) => entry.gate),
    },
  };
}
