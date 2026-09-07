import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateWaveClaimInvariants,
  decideWaveClaimAcquisition,
  decideWaveClaimRelease,
  listWaveClaimTransitionOwners,
  nextRetryCircuitState,
  planWaveClaimOrphanSweep,
  applyWaveClaimOrphanSweep,
  WAVE_CLAIM_OWNER_CONTRACT_VERSION,
  WAVE_CLAIM_TRANSITION_OWNERS,
} from "../../src/lib/wave-claim-lifecycle.ts";

function makeClaim(overrides = {}) {
  const now = Date.now();
  return {
    schema_version: "wave_marker_claim/v1",
    status: "active",
    claim_id: "claim-1",
    claim_token: "claim-1",
    owner_id: "owner-1",
    run_id: "run-1",
    ready_issue_number: "42",
    milestone_title: "Wave-1",
    lease_started_at: new Date(now - 3600000).toISOString(),
    lease_expires_at: new Date(now + 3600000).toISOString(),
    heartbeat_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    reclaim_count: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
describe("constants", () => {
  it("exports WAVE_CLAIM_OWNER_CONTRACT_VERSION", () => {
    assert.equal(WAVE_CLAIM_OWNER_CONTRACT_VERSION, "wave_claim_owner_contract/v1");
  });

  it("exports WAVE_CLAIM_TRANSITION_OWNERS with expected keys", () => {
    const keys = Object.keys(WAVE_CLAIM_TRANSITION_OWNERS).sort();
    assert.deepEqual(keys, [
      "acquire_claim",
      "complete_wave_marker",
      "lock_wave_marker",
      "reclaim_stale_claim",
      "refresh_claim",
      "release_orphaned_claim",
      "release_terminal_claim",
    ]);
  });
});

// ---------------------------------------------------------------------------
// listWaveClaimTransitionOwners
// ---------------------------------------------------------------------------
describe("listWaveClaimTransitionOwners", () => {
  it("returns schema version and sorted transitions", () => {
    const result = listWaveClaimTransitionOwners();
    assert.equal(result.schema_version, WAVE_CLAIM_OWNER_CONTRACT_VERSION);
    assert.ok(Array.isArray(result.transitions));
    assert.ok(result.transitions.length > 0);
    // verify sorted
    const names = result.transitions.map((t) => t.transition);
    const sorted = [...names].sort();
    assert.deepEqual(names, sorted);
  });

  it("each transition has transition and owner fields", () => {
    const { transitions } = listWaveClaimTransitionOwners();
    for (const t of transitions) {
      assert.ok(typeof t.transition === "string" && t.transition.length > 0);
      assert.ok(typeof t.owner === "string" && t.owner.length > 0);
    }
  });
});

// ---------------------------------------------------------------------------
// evaluateWaveClaimInvariants
// ---------------------------------------------------------------------------
describe("evaluateWaveClaimInvariants", () => {
  it("null claim → claim_missing", () => {
    const r = evaluateWaveClaimInvariants(null);
    assert.equal(r.ok, false);
    assert.deepEqual(r.violations, ["claim_missing"]);
  });

  it("undefined claim → claim_missing", () => {
    const r = evaluateWaveClaimInvariants(undefined);
    assert.equal(r.ok, false);
    assert.deepEqual(r.violations, ["claim_missing"]);
  });

  it("non-object claim → claim_missing", () => {
    const r = evaluateWaveClaimInvariants("string");
    assert.equal(r.ok, false);
    assert.deepEqual(r.violations, ["claim_missing"]);
  });

  it("missing claim_token → claim_token_missing", () => {
    const r = evaluateWaveClaimInvariants(makeClaim({ claim_token: "" }));
    assert.ok(r.violations.includes("claim_token_missing"));
  });

  it("missing owner_id → owner_id_missing", () => {
    const r = evaluateWaveClaimInvariants(makeClaim({ owner_id: "" }));
    assert.ok(r.violations.includes("owner_id_missing"));
  });

  it("missing run_id → run_id_missing", () => {
    const r = evaluateWaveClaimInvariants(makeClaim({ run_id: "" }));
    assert.ok(r.violations.includes("run_id_missing"));
  });

  it("missing ready_issue_number → ready_issue_number_missing", () => {
    const r = evaluateWaveClaimInvariants(makeClaim({ ready_issue_number: "" }));
    assert.ok(r.violations.includes("ready_issue_number_missing"));
  });

  it("missing milestone_title → milestone_title_missing", () => {
    const r = evaluateWaveClaimInvariants(makeClaim({ milestone_title: "" }));
    assert.ok(r.violations.includes("milestone_title_missing"));
  });

  it("invalid lease_started_at → lease_started_at_invalid", () => {
    const r = evaluateWaveClaimInvariants(makeClaim({ lease_started_at: "not-a-date" }));
    assert.ok(r.violations.includes("lease_started_at_invalid"));
  });

  it("invalid lease_expires_at → lease_expires_at_invalid", () => {
    const r = evaluateWaveClaimInvariants(makeClaim({ lease_expires_at: "not-a-date" }));
    assert.ok(r.violations.includes("lease_expires_at_invalid"));
  });

  it("invalid heartbeat_at (and no updated_at) → heartbeat_at_invalid", () => {
    const r = evaluateWaveClaimInvariants(
      makeClaim({ heartbeat_at: "not-a-date", updated_at: "also-bad" }),
    );
    assert.ok(r.violations.includes("heartbeat_at_invalid"));
  });

  it("lease_started_at > lease_expires_at → lease_window_invalid", () => {
    const now = Date.now();
    const r = evaluateWaveClaimInvariants(
      makeClaim({
        lease_started_at: new Date(now + 7200000).toISOString(),
        lease_expires_at: new Date(now + 3600000).toISOString(),
      }),
    );
    assert.ok(r.violations.includes("lease_window_invalid"));
  });

  it("heartbeat_at > lease_expires_at → heartbeat_after_expiry", () => {
    const now = Date.now();
    const r = evaluateWaveClaimInvariants(
      makeClaim({
        heartbeat_at: new Date(now + 7200000).toISOString(),
        lease_expires_at: new Date(now + 3600000).toISOString(),
      }),
    );
    assert.ok(r.violations.includes("heartbeat_after_expiry"));
  });

  it("active claim past expiry → active_claim_expired", () => {
    const now = Date.now();
    const r = evaluateWaveClaimInvariants(
      makeClaim({
        status: "active",
        lease_expires_at: new Date(now - 1000).toISOString(),
        heartbeat_at: new Date(now - 2000).toISOString(),
      }),
      { nowEpochMs: now },
    );
    assert.ok(r.violations.includes("active_claim_expired"));
  });

  it("released claim past expiry does NOT get active_claim_expired", () => {
    const now = Date.now();
    const r = evaluateWaveClaimInvariants(
      makeClaim({
        status: "released",
        lease_expires_at: new Date(now - 1000).toISOString(),
        heartbeat_at: new Date(now - 2000).toISOString(),
      }),
      { nowEpochMs: now },
    );
    assert.ok(!r.violations.includes("active_claim_expired"));
  });

  it("valid claim → ok true, empty violations", () => {
    const r = evaluateWaveClaimInvariants(makeClaim());
    assert.equal(r.ok, true);
    assert.deepEqual(r.violations, []);
  });
});

// ---------------------------------------------------------------------------
// decideWaveClaimAcquisition
// ---------------------------------------------------------------------------
describe("decideWaveClaimAcquisition", () => {
  it("missing owner/run/issue → denied", () => {
    const r = decideWaveClaimAcquisition({ snapshot: null });
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "missing_owner_run_or_issue");
  });

  it("missing issueNumber only → denied", () => {
    const r = decideWaveClaimAcquisition({ ownerId: "o", runId: "r" });
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "missing_owner_run_or_issue");
  });

  it("no existing claim → acquire", () => {
    const r = decideWaveClaimAcquisition({
      snapshot: null,
      issueNumber: "42",
      ownerId: "owner-1",
      runId: "run-1",
      claimToken: "tok-1",
      milestoneTitle: "Wave-1",
    });
    assert.equal(r.allowed, true);
    assert.equal(r.action, "acquire");
    assert.equal(r.reason, "claim_acquired");
    assert.ok(r.claim);
    assert.equal(r.claim.owner_id, "owner-1");
    assert.equal(r.claim.run_id, "run-1");
  });

  it("active claim owned by another → denied", () => {
    const r = decideWaveClaimAcquisition({
      snapshot: {
        active: true,
        claim: makeClaim({ owner_id: "other-owner", run_id: "other-run" }),
      },
      issueNumber: "42",
      ownerId: "owner-1",
      runId: "run-1",
    });
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "active_claim_owned_by_other");
  });

  it("same owner refreshing active claim → refresh", () => {
    const r = decideWaveClaimAcquisition({
      snapshot: {
        active: true,
        claim: makeClaim({ owner_id: "owner-1", run_id: "run-1" }),
      },
      issueNumber: "42",
      ownerId: "owner-1",
      runId: "run-1",
    });
    assert.equal(r.allowed, true);
    assert.equal(r.action, "refresh");
    assert.equal(r.reason, "claim_refreshed");
  });

  it("stale claim from other owner → reclaim", () => {
    const r = decideWaveClaimAcquisition({
      snapshot: {
        stale: true,
        claim: makeClaim({ owner_id: "other-owner", run_id: "other-run" }),
      },
      issueNumber: "42",
      ownerId: "owner-1",
      runId: "run-1",
    });
    assert.equal(r.allowed, true);
    assert.equal(r.action, "reclaim");
    assert.equal(r.reason, "claim_reclaimed_stale");
    assert.equal(r.claim.reclaim_count, 1);
    assert.equal(r.claim.reclaimed_from_owner_id, "other-owner");
  });

  it("stale claim + wave_in_progress from other → blocked", () => {
    const r = decideWaveClaimAcquisition({
      snapshot: {
        stale: true,
        claim: makeClaim({ owner_id: "other-owner", run_id: "other-run" }),
      },
      issueNumber: "42",
      ownerId: "owner-1",
      runId: "run-1",
      hasWaveInProgressLabel: true,
    });
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "stale_claim_blocked_by_wave_in_progress");
  });

  it("stale claim + wave_in_progress from same owner → refresh/reclaim allowed", () => {
    const r = decideWaveClaimAcquisition({
      snapshot: {
        stale: true,
        active: false,
        claim: makeClaim({ owner_id: "owner-1", run_id: "run-1" }),
      },
      issueNumber: "42",
      ownerId: "owner-1",
      runId: "run-1",
      hasWaveInProgressLabel: true,
    });
    // Same owner so the stale+wip guard doesn't apply
    assert.equal(r.allowed, true);
  });

  it("acquire builds claim with correct fields", () => {
    const now = Date.now();
    const r = decideWaveClaimAcquisition({
      snapshot: null,
      issueNumber: "99",
      milestoneTitle: "Wave-X",
      ownerId: "o1",
      runId: "r1",
      claimToken: "tok-x",
      leaseSeconds: 3600,
      nowEpochMs: now,
    });
    assert.equal(r.claim.ready_issue_number, "99");
    assert.equal(r.claim.milestone_title, "Wave-X");
    assert.equal(r.claim.claim_token, "tok-x");
    assert.equal(r.claim.status, "active");
    assert.equal(r.claim.reclaim_count, 0);
    assert.ok(r.invariants);
  });

  it("reclaim increments reclaim_count", () => {
    const existing = makeClaim({ owner_id: "old", run_id: "old-run", reclaim_count: 2 });
    const r = decideWaveClaimAcquisition({
      snapshot: { stale: true, claim: existing },
      issueNumber: "42",
      ownerId: "new-owner",
      runId: "new-run",
    });
    assert.equal(r.claim.reclaim_count, 3);
  });
});

// ---------------------------------------------------------------------------
// decideWaveClaimRelease
// ---------------------------------------------------------------------------
describe("decideWaveClaimRelease", () => {
  it("no current claim → not released, claim_missing", () => {
    const r = decideWaveClaimRelease({ snapshot: null });
    assert.equal(r.released, false);
    assert.equal(r.reason, "claim_missing");
  });

  it("already released → not released, claim_already_released", () => {
    const r = decideWaveClaimRelease({
      snapshot: { claim: makeClaim({ status: "released" }) },
      ownerId: "owner-1",
      runId: "run-1",
      claimToken: "claim-1",
    });
    assert.equal(r.released, false);
    assert.equal(r.reason, "claim_already_released");
  });

  it("owned by caller → released", () => {
    const r = decideWaveClaimRelease({
      snapshot: { claim: makeClaim() },
      ownerId: "owner-1",
      runId: "run-1",
      claimToken: "claim-1",
    });
    assert.equal(r.released, true);
    assert.equal(r.reason, "claim_released");
    assert.equal(r.claim.status, "released");
  });

  it("not owned by caller, not forced → not released", () => {
    const r = decideWaveClaimRelease({
      snapshot: { claim: makeClaim({ owner_id: "other", run_id: "other-run", claim_token: "other-tok" }) },
      ownerId: "owner-1",
      runId: "run-1",
      claimToken: "claim-1",
      force: false,
    });
    assert.equal(r.released, false);
    assert.equal(r.reason, "claim_owned_by_other");
  });

  it("not owned but forced → released", () => {
    const r = decideWaveClaimRelease({
      snapshot: { claim: makeClaim({ owner_id: "other", run_id: "other-run" }) },
      ownerId: "owner-1",
      runId: "run-1",
      force: true,
    });
    assert.equal(r.released, true);
    assert.equal(r.reason, "claim_released");
    assert.equal(
      r.transition_owner,
      WAVE_CLAIM_TRANSITION_OWNERS.release_orphaned_claim,
    );
  });

  it("non-forced release uses release_terminal_claim transition", () => {
    const r = decideWaveClaimRelease({
      snapshot: { claim: makeClaim() },
      ownerId: "owner-1",
      runId: "run-1",
      claimToken: "claim-1",
    });
    assert.equal(r.transition_owner, WAVE_CLAIM_TRANSITION_OWNERS.release_terminal_claim);
  });

  it("missing owner/token without force → missing_owner_or_token", () => {
    const r = decideWaveClaimRelease({
      snapshot: { claim: makeClaim() },
      force: false,
    });
    assert.equal(r.released, false);
    assert.equal(r.reason, "missing_owner_or_token");
  });

  it("released claim includes release_reason", () => {
    const r = decideWaveClaimRelease({
      snapshot: { claim: makeClaim() },
      ownerId: "owner-1",
      runId: "run-1",
      claimToken: "claim-1",
      reason: "wave_completed",
    });
    assert.equal(r.claim.release_reason, "wave_completed");
  });
});

// ---------------------------------------------------------------------------
// nextRetryCircuitState
// ---------------------------------------------------------------------------
describe("nextRetryCircuitState", () => {
  it("default (no state) → first retry allowed", () => {
    const r = nextRetryCircuitState();
    assert.equal(r.decision, "retry");
    assert.equal(r.attempt_count, 1);
    assert.equal(r.throttled, false);
  });

  it("under maxAttempts → retry", () => {
    const r = nextRetryCircuitState({
      state: { attempt_count: 1, overflow_count: 0, circuit_state: "closed" },
      maxAttempts: 3,
    });
    assert.equal(r.decision, "retry");
    assert.equal(r.attempt_count, 2);
  });

  it("at maxAttempts → opens circuit", () => {
    const r = nextRetryCircuitState({
      state: { attempt_count: 3, overflow_count: 0, circuit_state: "closed" },
      maxAttempts: 3,
    });
    assert.equal(r.decision, "open");
    assert.equal(r.circuit_state, "open");
    assert.equal(r.overflow_count, 1);
    assert.ok(r.backoff_ms > 0);
  });

  it("terminal state → stop", () => {
    const r = nextRetryCircuitState({
      state: { circuit_state: "terminal" },
    });
    assert.equal(r.decision, "stop");
    assert.equal(r.reason, "terminal_circuit_open");
    assert.equal(r.throttled, true);
  });

  it("open circuit within backoff → throttle", () => {
    const now = Date.now();
    const r = nextRetryCircuitState({
      state: {
        circuit_state: "open",
        next_attempt_at: now + 10000,
        attempt_count: 4,
        overflow_count: 1,
      },
      nowEpochMs: now,
    });
    assert.equal(r.decision, "throttle");
    assert.equal(r.reason, "circuit_open_backoff");
    assert.ok(r.backoff_ms > 0);
  });

  it("overflow reaches terminal count → terminal stop", () => {
    const r = nextRetryCircuitState({
      state: { attempt_count: 3, overflow_count: 2, circuit_state: "closed" },
      maxAttempts: 3,
      terminalOverflowCount: 3,
    });
    assert.equal(r.decision, "stop");
    assert.equal(r.circuit_state, "terminal");
    assert.equal(r.reason, "retry_cap_terminal");
  });

  it("backoff doubles with overflow", () => {
    const now = Date.now();
    const r1 = nextRetryCircuitState({
      state: { attempt_count: 3, overflow_count: 0, circuit_state: "closed" },
      maxAttempts: 3,
      baseBackoffMs: 1000,
      nowEpochMs: now,
    });
    const r2 = nextRetryCircuitState({
      state: { attempt_count: 3, overflow_count: 1, circuit_state: "closed" },
      maxAttempts: 3,
      baseBackoffMs: 1000,
      nowEpochMs: now,
    });
    // overflow 1 → base * 2^0 = 1000, overflow 2 → base * 2^1 = 2000
    assert.equal(r1.backoff_ms, 1000);
    assert.equal(r2.backoff_ms, 2000);
  });

  it("backoff is capped at capBackoffMs", () => {
    const now = Date.now();
    const r = nextRetryCircuitState({
      state: { attempt_count: 3, overflow_count: 10, circuit_state: "closed" },
      maxAttempts: 3,
      baseBackoffMs: 1000,
      capBackoffMs: 5000,
      terminalOverflowCount: 999,
      nowEpochMs: now,
    });
    assert.ok(r.backoff_ms <= 5000);
  });
});

// ---------------------------------------------------------------------------
// planWaveClaimOrphanSweep
// ---------------------------------------------------------------------------
describe("planWaveClaimOrphanSweep", () => {
  it("empty inputs → no actions", () => {
    const r = planWaveClaimOrphanSweep();
    assert.equal(r.action_count, 0);
    assert.deepEqual(r.actions, []);
    assert.equal(r.schema_version, "wave_claim_orphan_sweep/v1");
  });

  it("stale claim not in activeRunIds → release_claim action", () => {
    const now = Date.now();
    const r = planWaveClaimOrphanSweep({
      claimSnapshots: [
        {
          status: "active",
          lease_expires_at: new Date(now - 1000).toISOString(),
          run_id: "stale-run",
          issue_number: "10",
          claim_token: "tok",
          milestone_title: "W1",
        },
      ],
      nowEpochMs: now,
    });
    assert.equal(r.action_count, 1);
    assert.equal(r.actions[0].type, "release_claim");
    assert.equal(r.actions[0].run_id, "stale-run");
    assert.equal(r.stats.release_claim_count, 1);
  });

  it("stale claim still in activeRunIds → skipped", () => {
    const now = Date.now();
    const r = planWaveClaimOrphanSweep({
      claimSnapshots: [
        {
          status: "active",
          lease_expires_at: new Date(now - 1000).toISOString(),
          run_id: "active-run",
        },
      ],
      activeRunIds: ["active-run"],
      nowEpochMs: now,
    });
    assert.equal(r.action_count, 0);
  });

  it("released claim → skipped (not stale)", () => {
    const now = Date.now();
    const r = planWaveClaimOrphanSweep({
      claimSnapshots: [
        {
          status: "released",
          lease_expires_at: new Date(now - 1000).toISOString(),
          run_id: "r1",
        },
      ],
      nowEpochMs: now,
    });
    assert.equal(r.action_count, 0);
  });

  it("non-expired claim → skipped", () => {
    const now = Date.now();
    const r = planWaveClaimOrphanSweep({
      claimSnapshots: [
        {
          status: "active",
          lease_expires_at: new Date(now + 60000).toISOString(),
          run_id: "r1",
        },
      ],
      nowEpochMs: now,
    });
    assert.equal(r.action_count, 0);
  });

  it("worktree lock not in activeRunIds → cleanup action", () => {
    const r = planWaveClaimOrphanSweep({
      worktreeLocks: [
        { lock_path: "/tmp/lock1", run_id: "dead-run", milestone_title: "W2" },
      ],
      activeRunIds: [],
    });
    assert.equal(r.action_count, 1);
    assert.equal(r.actions[0].type, "cleanup_worktree_lock");
    assert.equal(r.stats.cleanup_worktree_lock_count, 1);
  });

  it("worktree lock in activeRunIds → skipped", () => {
    const r = planWaveClaimOrphanSweep({
      worktreeLocks: [{ lock_path: "/tmp/lock1", run_id: "alive" }],
      activeRunIds: ["alive"],
    });
    assert.equal(r.action_count, 0);
  });

  it("worktree lock with no lock_path → skipped", () => {
    const r = planWaveClaimOrphanSweep({
      worktreeLocks: [{ run_id: "dead" }],
      activeRunIds: [],
    });
    assert.equal(r.action_count, 0);
  });

  it("actions are sorted: release_claim before cleanup_worktree_lock", () => {
    const now = Date.now();
    const r = planWaveClaimOrphanSweep({
      claimSnapshots: [
        {
          status: "active",
          lease_expires_at: new Date(now - 1000).toISOString(),
          run_id: "r1",
          issue_number: "10",
          claim_token: "t1",
          milestone_title: "W1",
        },
      ],
      worktreeLocks: [
        { lock_path: "/tmp/lock", run_id: "r2", milestone_title: "W0" },
      ],
      activeRunIds: [],
      nowEpochMs: now,
    });
    assert.equal(r.actions[0].type, "release_claim");
    assert.equal(r.actions[1].type, "cleanup_worktree_lock");
  });
});

// ---------------------------------------------------------------------------
// applyWaveClaimOrphanSweep
// ---------------------------------------------------------------------------
describe("applyWaveClaimOrphanSweep", () => {
  it("no actions → ok true, counts zero", () => {
    const r = applyWaveClaimOrphanSweep({ plan: { actions: [] } });
    assert.equal(r.ok, true);
    assert.equal(r.applied_count, 0);
    assert.equal(r.failed_count, 0);
  });

  it("successful release_claim → applied", () => {
    const action = { type: "release_claim", issue_number: "10", claim_token: "tok", reason: "stale" };
    const r = applyWaveClaimOrphanSweep({
      plan: { actions: [action] },
      releaseClaim: () => ({ ok: true }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.applied_count, 1);
    assert.deepEqual(r.applied_actions, [action]);
  });

  it("failed release_claim → failed", () => {
    const action = { type: "release_claim", issue_number: "10", claim_token: "tok" };
    const r = applyWaveClaimOrphanSweep({
      plan: { actions: [action] },
      releaseClaim: () => ({ ok: false, reason: "boom" }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.failed_count, 1);
    assert.equal(r.failed_actions[0].error, "boom");
  });

  it("successful cleanup_worktree_lock → applied", () => {
    const action = { type: "cleanup_worktree_lock", lock_path: "/tmp/x" };
    const r = applyWaveClaimOrphanSweep({
      plan: { actions: [action] },
      removeWorktreeLock: () => ({ ok: true }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.applied_count, 1);
  });

  it("failed cleanup_worktree_lock → failed", () => {
    const action = { type: "cleanup_worktree_lock", lock_path: "/tmp/x" };
    const r = applyWaveClaimOrphanSweep({
      plan: { actions: [action] },
      removeWorktreeLock: () => ({ ok: false, reason: "no_such_lock" }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.failed_count, 1);
  });

  it("unknown action type → failed with unknown_action_type", () => {
    const action = { type: "unknown_thing" };
    const r = applyWaveClaimOrphanSweep({
      plan: { actions: [action] },
    });
    assert.equal(r.ok, false);
    assert.equal(r.failed_actions[0].error, "unknown_action_type");
  });

  it("mixed success and failure → ok false", () => {
    const a1 = { type: "release_claim", issue_number: "1", claim_token: "t1" };
    const a2 = { type: "release_claim", issue_number: "2", claim_token: "t2" };
    let callCount = 0;
    const r = applyWaveClaimOrphanSweep({
      plan: { actions: [a1, a2] },
      releaseClaim: () => {
        callCount++;
        return callCount === 1 ? { ok: true } : { ok: false, reason: "fail" };
      },
    });
    assert.equal(r.ok, false);
    assert.equal(r.applied_count, 1);
    assert.equal(r.failed_count, 1);
  });

  it("null plan → no crash, empty results", () => {
    const r = applyWaveClaimOrphanSweep({ plan: null });
    assert.equal(r.ok, true);
    assert.equal(r.applied_count, 0);
  });
});
