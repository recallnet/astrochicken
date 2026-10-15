import test from "node:test";
import assert from "node:assert/strict";
import { planWaveReadyNormalization, downgradeOrphanedLeases, readRunMetadata, planStaleWorktreeCleanupActions, planWaveOrphanStateRepair, applyWaveOrphanStateRepair, collectActiveWaveLeases, requeueAfterJudgeFailure } from "../src/commands/wave-sanitize-state.ts";
import { mergeLocalActiveMilestones } from "../src/commands/wave-active-run-guard.ts";
import { planStaleWorktreeCleanupActions as planStaleWorktreeCleanupActionsDirect } from "../src/commands/wave-sanitize-rules.ts";

function leaseCollectionFixture(overrides) {
  return { active_lease_count: 1, stale_candidate_count: 0, stale_candidates: [], ...overrides };
}

test("planWaveReadyNormalization closes duplicate ready markers and relabels canonical", () => {
  const out = planWaveReadyNormalization([
    { number: 236, title: "Wave Ready: goal-202-wave-1", labels: [], milestone: { title: "goal-202-wave-1" } },
    { number: 237, title: "Wave Ready: goal-202-wave-1", labels: [{ name: "ready" }], milestone: { title: "goal-202-wave-1" } },
    { number: 238, title: "Wave Ready: goal-202-wave-1", labels: [{ name: "wave-in-progress" }], milestone: { title: "goal-202-wave-1" } },
  ]);

  assert.deepEqual(out.close_issue_numbers.sort(), ["236", "237"]);
  assert.deepEqual(out.add_ready_issue_numbers, ["238"]);
});

test("planWaveReadyNormalization leaves single healthy marker unchanged", () => {
  const out = planWaveReadyNormalization([
    { number: 300, title: "Wave Ready: goal-1-wave-1", labels: [{ name: "ready" }], milestone: { title: "goal-1-wave-1" } },
  ]);

  assert.deepEqual(out.close_issue_numbers, []);
  assert.deepEqual(out.add_ready_issue_numbers, []);
});

// --- downgradeOrphanedLeases tests ---

test("downgradeOrphanedLeases moves completed-run leases from active to stale", () => {
  const activeLeases = leaseCollectionFixture({
active_milestones: ["goal-188-wave-2"],
active_leases: [
      { run_id: "dead-run-1", milestone_title: "goal-188-wave-2", status: "claimed", ready_issue_number: "452", source: "github_claim" },
    ]
});
  const runStatuses = new Map([["dead-run-1", "completed"]]);

  const result = downgradeOrphanedLeases({ activeLeases, runStatuses });

  assert.equal(result.active_lease_count, 0);
  assert.equal(result.active_leases.length, 0);
  assert.equal(result.stale_candidates.length, 1);
  assert.equal(result.stale_candidates[0].run_id, "dead-run-1");
  assert.ok(result.stale_candidates[0].status.includes("orphaned"));
  assert.deepEqual(result.active_milestones, []);
});

test("downgradeOrphanedLeases keeps running-run leases active", () => {
  const activeLeases = leaseCollectionFixture({
active_milestones: ["goal-1-wave-1"],
active_leases: [
      { run_id: "live-run", milestone_title: "goal-1-wave-1", status: "claimed", ready_issue_number: "100", source: "github_claim" },
    ]
});
  const runStatuses = new Map([["live-run", "running"]]);

  const result = downgradeOrphanedLeases({ activeLeases, runStatuses });

  assert.equal(result.active_lease_count, 1);
  assert.equal(result.active_leases.length, 1);
  assert.equal(result.stale_candidates.length, 0);
  assert.deepEqual(result.active_milestones, ["goal-1-wave-1"]);
});

test("downgradeOrphanedLeases treats missing run_id (no state file) as orphaned", () => {
  const activeLeases = leaseCollectionFixture({
active_milestones: ["goal-2-wave-1"],
active_leases: [
      { run_id: "ghost-run", milestone_title: "goal-2-wave-1", status: "claimed", ready_issue_number: "200", source: "github_claim" },
    ]
});
  // Empty map means run state doesn't exist
  const runStatuses = new Map();

  const result = downgradeOrphanedLeases({ activeLeases, runStatuses });

  assert.equal(result.active_lease_count, 0);
  assert.equal(result.stale_candidates.length, 1);
  assert.ok(result.stale_candidates[0].status.includes("orphaned"));
});

test("downgradeOrphanedLeases handles failed and guarded_terminal runs", () => {
  const activeLeases = leaseCollectionFixture({
active_lease_count: 3,
active_milestones: ["m-1", "m-2", "m-3"],
active_leases: [
      { run_id: "run-a", milestone_title: "m-1", status: "claimed", ready_issue_number: "10", source: "github_claim" },
      { run_id: "run-b", milestone_title: "m-2", status: "claimed", ready_issue_number: "20", source: "github_claim" },
      { run_id: "run-c", milestone_title: "m-3", status: "claimed", ready_issue_number: "30", source: "github_claim" },
    ]
});
  const runStatuses = new Map([
    ["run-a", "failed"],
    ["run-b", "guarded_terminal"],
    ["run-c", "running"],
  ]);

  const result = downgradeOrphanedLeases({ activeLeases, runStatuses });

  assert.equal(result.active_lease_count, 1);
  assert.equal(result.active_leases.length, 1);
  assert.equal(result.active_leases[0].run_id, "run-c");
  assert.equal(result.stale_candidates.length, 2);
  assert.deepEqual(result.active_milestones, ["m-3"]);
});

test("downgradeOrphanedLeases source file exports downgradeOrphanedLeases", () => {
  assert.equal(typeof downgradeOrphanedLeases, "function");
});

test("downgradeOrphanedLeases detects zombie run with stale heartbeat", () => {
  const now = Date.now();
  const staleHeartbeat = new Date(now - 25 * 60 * 1000).toISOString(); // 25 min ago
  const activeLeases = leaseCollectionFixture({
active_milestones: ["goal-zombie-wave-1"],
active_leases: [
      { run_id: "zombie-run", milestone_title: "goal-zombie-wave-1", status: "claimed", ready_issue_number: "999", source: "github_claim" },
    ]
});
  const runStatuses = new Map([["zombie-run", "running"]]);
  const runMetadata = new Map([["zombie-run", { status: "running", heartbeatAt: staleHeartbeat }]]);

  const result = downgradeOrphanedLeases({ activeLeases, runStatuses, runMetadata, staleHeartbeatMinutes: 20, nowEpochMs: now });

  assert.equal(result.active_lease_count, 0, "zombie run should not be active");
  assert.equal(result.stale_candidates.length, 1, "zombie run should be stale");
  assert.equal(result.stale_candidates[0].status, "orphaned_zombie_stale_heartbeat");
  assert.deepEqual(result.active_milestones, []);
});

test("downgradeOrphanedLeases keeps running-run with fresh heartbeat active", () => {
  const now = Date.now();
  const freshHeartbeat = new Date(now - 5 * 60 * 1000).toISOString(); // 5 min ago
  const activeLeases = leaseCollectionFixture({
active_milestones: ["goal-active-wave-1"],
active_leases: [
      { run_id: "active-run", milestone_title: "goal-active-wave-1", status: "claimed", ready_issue_number: "888", source: "github_claim" },
    ]
});
  const runStatuses = new Map([["active-run", "running"]]);
  const runMetadata = new Map([["active-run", { status: "running", heartbeatAt: freshHeartbeat }]]);

  const result = downgradeOrphanedLeases({ activeLeases, runStatuses, runMetadata, staleHeartbeatMinutes: 20, nowEpochMs: now });

  assert.equal(result.active_lease_count, 1, "fresh run should stay active");
  assert.equal(result.stale_candidates.length, 0);
  assert.deepEqual(result.active_milestones, ["goal-active-wave-1"]);
});

test("readRunMetadata returns empty map for non-existent directory", () => {
  const result = readRunMetadata("/tmp/nonexistent-dir-" + Date.now());
  assert.ok(result instanceof Map);
  assert.equal(result.size, 0);
});

// --- planWaveOrphanStateRepair tests ---

test("planWaveOrphanStateRepair returns empty plan for empty input", () => {
  const plan = planWaveOrphanStateRepair({ openIssues: [], activeLeases: {} });
  assert.equal(plan.action_count, 0);
  assert.deepEqual(plan.actions, []);
  assert.equal(plan.schema_version, "wave_orphan_repair/v1");
});

test("planWaveOrphanStateRepair closes invalid marker missing milestone", () => {
  const plan = planWaveOrphanStateRepair({
    openIssues: [
      { number: 100, title: "Wave Ready: ", labels: [{ name: "ready" }], milestone: {}, state: "OPEN" },
    ],
    activeLeases: {},
  });
  assert.equal(plan.action_count, 1);
  assert.equal(plan.actions[0].type, "close_issue");
  assert.equal(plan.actions[0].issue_number, "100");
  assert.equal(plan.actions[0].reason, "invalid_wave_marker_missing_milestone");
});

test("planWaveOrphanStateRepair closes orphaned marker with no labels and no lease", () => {
  const plan = planWaveOrphanStateRepair({
    openIssues: [
      { number: 200, title: "Wave Ready: goal-1-wave-1", labels: [], milestone: { title: "goal-1-wave-1" }, state: "OPEN" },
    ],
    activeLeases: { active_milestones: [], active_leases: [] },
  });
  assert.equal(plan.action_count, 1);
  assert.equal(plan.actions[0].type, "close_issue");
  assert.equal(plan.actions[0].issue_number, "200");
  assert.equal(plan.actions[0].reason, "stale_wave_marker_without_active_labels");
});

test("planStaleWorktreeCleanupActions emits unique stale worktree cleanup actions", () => {
  assert.equal(typeof planStaleWorktreeCleanupActionsDirect, "function");
  const actions = planStaleWorktreeCleanupActions([
    { worktree_dir: "/tmp/wave-1", milestone_title: "goal-1-wave-1", run_id: "run-1" },
    { worktree_dir: "/tmp/wave-1", milestone_title: "goal-1-wave-1", run_id: "run-1" },
    { worktree_dir: "/tmp/wave-2", milestone_title: "goal-1-wave-2", run_id: "run-2" },
    { worktree_dir: "", milestone_title: "goal-1-wave-3", run_id: "run-3" },
  ]);

  assert.deepEqual(actions, [
    {
      type: "cleanup_worktree",
      worktree_dir: "/tmp/wave-1",
      milestone_title: "goal-1-wave-1",
      run_id: "run-1",
      reason: "orphaned_wave_worktree",
    },
    {
      type: "cleanup_worktree",
      worktree_dir: "/tmp/wave-2",
      milestone_title: "goal-1-wave-2",
      run_id: "run-2",
      reason: "orphaned_wave_worktree",
    },
  ]);
});

test("applyWaveOrphanStateRepair executes cleanup_worktree actions via cleanup handler", () => {
  const cleaned = [];
  const out = applyWaveOrphanStateRepair({
    repo: "recallnet/astrochicken",
    plan: {
      actions: [
        {
          type: "cleanup_worktree",
          worktree_dir: "/tmp/wave-1",
          milestone_title: "goal-1-wave-1",
          run_id: "run-1",
          reason: "orphaned_wave_worktree",
        },
      ],
    },
    cleanupWorktree: ({ worktreeDir }) => {
      cleaned.push(worktreeDir);
      return { ok: true };
    },
  });

  assert.equal(out.ok, true);
  assert.deepEqual(cleaned, ["/tmp/wave-1"]);
  assert.equal(out.applied_actions[0].type, "cleanup_worktree");
});

test("planWaveOrphanStateRepair restores labels for orphaned marker with active lease", () => {
  const plan = planWaveOrphanStateRepair({
    openIssues: [
      { number: 200, title: "Wave Ready: goal-1-wave-1", labels: [], milestone: { title: "goal-1-wave-1" }, state: "OPEN" },
    ],
    activeLeases: {
      active_milestones: ["goal-1-wave-1"],
      active_leases: [{ run_id: "r1", milestone_title: "goal-1-wave-1", ready_issue_number: "200" }],
    },
  });

  const addActions = plan.actions.filter((a) => a.type === "add_label");
  assert.equal(addActions.length, 2, `expected 2 add_label actions, got ${JSON.stringify(plan.actions, null, 2)}`);

  const readyAdd = addActions.find((a) => a.label === "ready");
  assert.ok(readyAdd, "should restore ready label");
  assert.equal(readyAdd.reason, "restore_ready_trigger_label");

  const inProgressAdd = addActions.find((a) => a.label === "wave-in-progress");
  assert.ok(inProgressAdd, "should restore wave-in-progress label");
  assert.equal(inProgressAdd.reason, "restore_in_progress_from_active_lease");

  // No close actions — lease ownership keeps marker alive
  const closeActions = plan.actions.filter((a) => a.type === "close_issue");
  assert.equal(closeActions.length, 0);
});

test("planWaveOrphanStateRepair removes ready from externally blocked marker without active lease", () => {
  const plan = planWaveOrphanStateRepair({
    openIssues: [
      {
        number: 610,
        title: "Wave Ready: goal-1-wave-2",
        labels: [{ name: "ready" }],
        milestone: { title: "goal-1-wave-2" },
        state: "OPEN",
      },
    ],
    activeLeases: { active_milestones: [], active_leases: [] },
    externallyBlockedMilestones: ["goal-1-wave-2"],
  });

  const removeReady = plan.actions.find((action) => action.type === "remove_label" && action.label === "ready");
  assert.ok(removeReady, `expected ready removal action, got ${JSON.stringify(plan.actions, null, 2)}`);
  assert.equal(removeReady.issue_number, "610");
  assert.equal(removeReady.reason, "externally_blocked_milestone_not_runnable");

  const releaseClaim = plan.actions.find((action) => action.type === "release_claim");
  assert.ok(releaseClaim, "expected claim cleanup for externally blocked marker");
  assert.equal(releaseClaim.reason, "externally_blocked_claim_body_cleanup");
});

test("planWaveOrphanStateRepair preserves externally blocked marker when wave is already active", () => {
  const plan = planWaveOrphanStateRepair({
    openIssues: [
      {
        number: 611,
        title: "Wave Ready: goal-1-wave-2",
        labels: [{ name: "ready" }, { name: "wave-in-progress" }],
        milestone: { title: "goal-1-wave-2" },
        state: "OPEN",
      },
    ],
    activeLeases: {
      active_milestones: ["goal-1-wave-2"],
      active_leases: [{ run_id: "r-active", milestone_title: "goal-1-wave-2", ready_issue_number: "611" }],
    },
    externallyBlockedMilestones: ["goal-1-wave-2"],
  });

  const removeReady = plan.actions.find((action) => action.type === "remove_label" && action.label === "ready");
  assert.equal(removeReady, undefined);
});

test("planWaveOrphanStateRepair removes stale wave-in-progress when no active lease", () => {
  const plan = planWaveOrphanStateRepair({
    openIssues: [
      {
        number: 300,
        title: "Wave Ready: goal-1-wave-1",
        labels: [{ name: "ready" }, { name: "wave-in-progress" }],
        milestone: { title: "goal-1-wave-1" },
        state: "OPEN",
      },
    ],
    activeLeases: { active_milestones: [], active_leases: [] },
  });

  const removeActions = plan.actions.filter((a) => a.type === "remove_label");
  assert.equal(removeActions.length, 1);
  assert.equal(removeActions[0].label, "wave-in-progress");
  assert.equal(removeActions[0].reason, "stale_wave_in_progress_without_active_lease");

  // Should NOT add ready — already has it
  const addReady = plan.actions.filter((a) => a.type === "add_label" && a.label === "ready");
  assert.equal(addReady.length, 0, "should not add ready label when already present");
});

test("planWaveOrphanStateRepair removes stale in-progress and restores ready when ready label missing", () => {
  const plan = planWaveOrphanStateRepair({
    openIssues: [
      {
        number: 300,
        title: "Wave Ready: goal-1-wave-1",
        labels: [{ name: "wave-in-progress" }],
        milestone: { title: "goal-1-wave-1" },
        state: "OPEN",
      },
    ],
    activeLeases: { active_milestones: [], active_leases: [] },
  });

  const removeActions = plan.actions.filter((a) => a.type === "remove_label");
  assert.equal(removeActions.length, 1);
  assert.equal(removeActions[0].label, "wave-in-progress");
  assert.equal(removeActions[0].reason, "stale_wave_in_progress_without_active_lease");

  const addActions = plan.actions.filter((a) => a.type === "add_label");
  assert.equal(addActions.length, 1);
  assert.equal(addActions[0].label, "ready");
  assert.equal(addActions[0].reason, "restore_ready_trigger_label");
});

test("planWaveOrphanStateRepair restores ready when in-progress marker missing ready label", () => {
  const plan = planWaveOrphanStateRepair({
    openIssues: [
      {
        number: 512,
        title: "Wave Ready: goal-9-wave-1",
        labels: [{ name: "wave-in-progress" }],
        milestone: { title: "goal-9-wave-1" },
        state: "OPEN",
      },
    ],
    activeLeases: { active_milestones: ["goal-9-wave-1"], active_leases: [] },
  });

  const addReady = plan.actions.filter((a) => a.type === "add_label" && a.label === "ready");
  assert.equal(addReady.length, 1);
  assert.equal(addReady[0].issue_number, "512");
  assert.equal(addReady[0].reason, "restore_ready_trigger_label");
});

test("planWaveOrphanStateRepair removes wave-in-progress from non-marker issues", () => {
  const plan = planWaveOrphanStateRepair({
    openIssues: [
      {
        number: 400,
        title: "Feature A",
        labels: [{ name: "wave-in-progress" }, { name: "feature" }],
        milestone: { title: "goal-1-wave-1" },
        state: "OPEN",
      },
    ],
    activeLeases: {},
  });

  assert.equal(plan.action_count, 1);
  assert.equal(plan.actions[0].type, "remove_label");
  assert.equal(plan.actions[0].label, "wave-in-progress");
  assert.equal(plan.actions[0].issue_number, "400");
  assert.equal(plan.actions[0].reason, "invalid_non_marker_wave_in_progress_label");
});

test("planWaveOrphanStateRepair restores in-progress from active lease for lease-owned marker", () => {
  const plan = planWaveOrphanStateRepair({
    openIssues: [
      {
        number: 500,
        title: "Wave Ready: goal-1-wave-1",
        labels: [{ name: "ready" }],
        milestone: { title: "goal-1-wave-1" },
        state: "OPEN",
      },
    ],
    activeLeases: {
      active_milestones: ["goal-1-wave-1"],
      active_leases: [{ run_id: "r1", milestone_title: "goal-1-wave-1", ready_issue_number: "500" }],
    },
  });

  const addActions = plan.actions.filter((a) => a.type === "add_label");
  assert.equal(addActions.length, 1);
  assert.equal(addActions[0].label, "wave-in-progress");
  assert.equal(addActions[0].reason, "restore_in_progress_from_active_lease");
});

test("planWaveOrphanStateRepair restores in-progress from active milestone when not lease-owned", () => {
  const plan = planWaveOrphanStateRepair({
    openIssues: [
      {
        number: 500,
        title: "Wave Ready: goal-1-wave-1",
        labels: [{ name: "ready" }],
        milestone: { title: "goal-1-wave-1" },
        state: "OPEN",
      },
    ],
    activeLeases: {
      active_milestones: ["goal-1-wave-1"],
      active_leases: [{ run_id: "r1", milestone_title: "goal-1-wave-1", ready_issue_number: "999" }],
    },
  });

  const addActions = plan.actions.filter((a) => a.type === "add_label");
  assert.equal(addActions.length, 1);
  assert.equal(addActions[0].label, "wave-in-progress");
  assert.equal(addActions[0].reason, "restore_in_progress_from_active_milestone");
});

test("mergeLocalActiveMilestones preserves local active milestone ownership without GitHub lease", () => {
  const out = mergeLocalActiveMilestones({
    active_milestones: [],
    active_leases: [],
    stale_candidates: [],
  }, {
    active_milestones: ["goal-1677-wave-1"],
    owners: [
      {
        run_id: "child-1",
        status: "running",
        milestone_title: "goal-1677-wave-1",
        updated_at: "2026-03-11T02:24:03.227Z",
        worktree_dir: "/tmp/goal-1677-wave-1",
      },
    ],
  });

  assert.deepEqual(out.active_milestones, ["goal-1677-wave-1"]);
  assert.equal(out.active_lease_count, 1);
  assert.equal(out.active_leases[0].source, "local_run_guard");
});

test("planWaveOrphanStateRepair handles non-array openIssues gracefully", () => {
  const plan = planWaveOrphanStateRepair({ openIssues: "not_an_array", activeLeases: {} });
  assert.equal(plan.action_count, 0);
});

test("planWaveOrphanStateRepair filters non-OPEN issues", () => {
  const plan = planWaveOrphanStateRepair({
    openIssues: [
      { number: 100, title: "Wave Ready: goal-1-wave-1", labels: [{ name: "ready" }], milestone: { title: "goal-1-wave-1" }, state: "CLOSED" },
    ],
    activeLeases: {},
  });
  assert.equal(plan.action_count, 0);
});

test("planWaveOrphanStateRepair close supersedes label edits for duplicate markers", () => {
  // Both markers have wave-in-progress + ready labels; #200 wins by lower number.
  // #201 would get a remove_label action from the stale-in-progress loop,
  // but close_issue supersedes all label edits for that issue.
  const plan = planWaveOrphanStateRepair({
    openIssues: [
      {
        number: 200,
        title: "Wave Ready: goal-1-wave-1",
        labels: [{ name: "ready" }, { name: "wave-in-progress" }],
        milestone: { title: "goal-1-wave-1" },
        state: "OPEN",
      },
      {
        number: 201,
        title: "Wave Ready: goal-1-wave-1",
        labels: [{ name: "ready" }, { name: "wave-in-progress" }],
        milestone: { title: "goal-1-wave-1" },
        state: "OPEN",
      },
    ],
    activeLeases: { active_milestones: [], active_leases: [] },
  });

  // #201 should be closed as duplicate
  const closeActions = plan.actions.filter((a) => a.type === "close_issue");
  const closed201 = closeActions.find((a) => a.issue_number === "201");
  assert.ok(closed201, "issue 201 should be closed as duplicate");
  assert.equal(closed201.reason, "duplicate_wave_marker");

  // #201 should NOT have any label edits (close supersedes)
  const labelActionsFor201 = plan.actions.filter(
    (a) => (a.type === "add_label" || a.type === "remove_label") && a.issue_number === "201"
  );
  assert.equal(labelActionsFor201.length, 0, "closed issue 201 should not have label edits");

  // #200 (kept) should get stale in-progress removal (no active lease)
  const removeFor200 = plan.actions.filter((a) => a.type === "remove_label" && a.issue_number === "200");
  assert.equal(removeFor200.length, 1);
  assert.equal(removeFor200[0].label, "wave-in-progress");
  assert.equal(removeFor200[0].reason, "stale_wave_in_progress_without_active_lease");
});

// --- applyWaveOrphanStateRepair tests ---

test("applyWaveOrphanStateRepair returns error on missing repo", () => {
  const result = applyWaveOrphanStateRepair({
    repo: "",
    plan: { actions: [{ type: "close_issue", issue_number: "1" }] },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "missing_repo");
  assert.equal(result.failed_count, 1);
});

test("applyWaveOrphanStateRepair handles empty plan", () => {
  const result = applyWaveOrphanStateRepair({
    repo: "r/r",
    plan: { actions: [] },
    execGh: () => ({ ok: true }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.applied_count, 0);
  assert.equal(result.failed_count, 0);
});

test("applyWaveOrphanStateRepair handles non-array plan.actions", () => {
  const result = applyWaveOrphanStateRepair({
    repo: "r/r",
    plan: { actions: "not_array" },
    execGh: () => ({ ok: true }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.applied_count, 0);
});

test("applyWaveOrphanStateRepair fails action with missing issue_number", () => {
  const result = applyWaveOrphanStateRepair({
    repo: "r/r",
    plan: { actions: [{ type: "add_label", label: "ready" }] },
    execGh: () => ({ ok: true }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.failed_count, 1);
  assert.equal(result.failed_actions[0].error, "missing_issue_number");
});

test("applyWaveOrphanStateRepair fails unknown action type", () => {
  const result = applyWaveOrphanStateRepair({
    repo: "r/r",
    plan: { actions: [{ type: "explode", issue_number: "1" }] },
    execGh: () => ({ ok: true }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.failed_count, 1);
  assert.equal(result.failed_actions[0].error, "unknown_action_type");
});

test("applyWaveOrphanStateRepair records label add failure", () => {
  const result = applyWaveOrphanStateRepair({
    repo: "r/r",
    plan: { actions: [{ type: "add_label", issue_number: "1", label: "ready" }] },
    execGh: () => ({ ok: false, stderr: "api_error" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.failed_actions[0].error, "api_error");
});

test("applyWaveOrphanStateRepair records label remove failure", () => {
  const result = applyWaveOrphanStateRepair({
    repo: "r/r",
    plan: { actions: [{ type: "remove_label", issue_number: "1", label: "wave-in-progress" }] },
    execGh: () => ({ ok: false, stderr: "remove_err" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.failed_actions[0].error, "remove_err");
});

test("applyWaveOrphanStateRepair records close_issue failure", () => {
  const result = applyWaveOrphanStateRepair({
    repo: "r/r",
    plan: { actions: [{ type: "close_issue", issue_number: "1", reason: "stale" }] },
    execGh: () => ({ ok: false, stderr: "close_err" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.failed_actions[0].error, "close_err");
});

test("applyWaveOrphanStateRepair records release_claim failure", () => {
  const result = applyWaveOrphanStateRepair({
    repo: "r/r",
    plan: { actions: [{ type: "release_claim", issue_number: "1" }] },
    execGh: () => ({ ok: true }),
    releaseClaim: () => ({ ok: false, error: "no_claim" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.failed_actions[0].error, "no_claim");
});

test("applyWaveOrphanStateRepair applies mixed success and failure", () => {
  let callIdx = 0;
  const result = applyWaveOrphanStateRepair({
    repo: "r/r",
    plan: {
      actions: [
        { type: "add_label", issue_number: "1", label: "ready" },
        { type: "remove_label", issue_number: "2", label: "wave-in-progress" },
      ],
    },
    execGh: () => {
      callIdx++;
      if (callIdx === 1) return { ok: true, stderr: "" };
      return { ok: false, stderr: "fail_2" };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.applied_count, 1);
  assert.equal(result.failed_count, 1);
});

// --- collectActiveWaveLeases tests ---

test("collectActiveWaveLeases returns empty for non-array runStates", () => {
  const out = collectActiveWaveLeases("not_array");
  assert.equal(out.active_lease_count, 0);
  assert.deepEqual(out.active_leases, []);
});

test("collectActiveWaveLeases skips non-wave-execute pipelines", () => {
  const out = collectActiveWaveLeases([
    { pipeline: "goal_run", status: "running", milestoneTitle: "m", updatedAt: new Date().toISOString() },
  ]);
  assert.equal(out.active_lease_count, 0);
});

test("collectActiveWaveLeases skips runs missing milestone", () => {
  const out = collectActiveWaveLeases([
    { pipeline: "wave_execute", status: "running", milestoneTitle: "", updatedAt: new Date().toISOString() },
  ]);
  assert.equal(out.active_lease_count, 0);
});

test("downgradeOrphanedLeases handles empty inputs", () => {
  const result = downgradeOrphanedLeases({ activeLeases: {}, runStatuses: new Map() });
  assert.equal(result.active_lease_count, 0);
  assert.deepEqual(result.active_leases, []);
  assert.deepEqual(result.stale_candidates, []);
});

test("downgradeOrphanedLeases handles lease with empty run_id", () => {
  const result = downgradeOrphanedLeases({
    activeLeases: {
      active_leases: [{ run_id: "", milestone_title: "m", status: "claimed" }],
      stale_candidates: [],
    },
    runStatuses: new Map(),
  });
  // Empty run_id stays active (not downgraded)
  assert.equal(result.active_lease_count, 1);
});

// --- requeueAfterJudgeFailure tests ---

test("requeueAfterJudgeFailure creates exactly one ready marker, then reports already_ready on rerun", () => {
  const openIssues = [
    {
      number: 901,
      title: "Feature: keep shipping",
      milestone: { title: "goal-1-wave-7" },
      labels: [],
      state: "OPEN",
      url: "https://gh/901",
    },
  ];

  let createCalls = 0;
  const emitted = [];

  const createWaveReadyMarkerFn = () => {
    createCalls += 1;
    const marker = {
      number: 9901,
      title: "Wave Ready: goal-1-wave-7",
      milestone: { title: "goal-1-wave-7" },
      labels: [{ name: "ready" }],
      state: "OPEN",
      url: "https://gh/9901",
    };
    openIssues.push(marker);
    return {
      ok: true,
      decision: "created_ready_marker",
      markerIssueNumber: "9901",
      url: "https://gh/9901",
      cooldownReason: "",
    };
  };

  const emitSupervisorArtifactFn = ({ artifactType, evidence }) => {
    emitted.push({ artifactType, payload: JSON.parse(evidence) });
    return { ok: true, issue_url: "", error: "" };
  };

  const evaluateActionableIssuesFn = () => ({
    has_actionable_work: true,
    actionable_issue_numbers: ["901"],
    reason: "has_runnable_issue",
    eligibility: {
      has_runnable_issue: true,
      all_runnable_issues_externally_blocked: false,
      externally_blocked_issue_numbers: [],
      blocked_by: [],
    },
  });

  const first = requeueAfterJudgeFailure({
    repo: "recallnet/astrochicken",
    wave: "goal-1-wave-7",
    milestone: "goal-1-wave-7",
    judgeContext: { judge_context_scope_identity: "wave_execute" },
    listOpenIssuesFn: () => openIssues,
    evaluateActionableIssuesFn,
    createWaveReadyMarkerFn,
    emitSupervisorArtifactFn,
  });

  assert.equal(first.decision, "created_ready_marker");
  assert.equal(first.wave_ready_marker_action, "created_ready_marker");
  assert.equal(first.wave_ready_marker_issue, "9901");
  assert.equal(first.judge_context_scope_identity, "wave_execute");

  const second = requeueAfterJudgeFailure({
    repo: "recallnet/astrochicken",
    wave: "goal-1-wave-7",
    milestone: "goal-1-wave-7",
    judgeContext: { judge_context_scope_identity: "wave_execute" },
    listOpenIssuesFn: () => openIssues,
    evaluateActionableIssuesFn,
    createWaveReadyMarkerFn,
    emitSupervisorArtifactFn,
  });

  assert.equal(second.decision, "already_ready");
  assert.equal(second.wave_ready_marker_issue, "9901");
  assert.equal(createCalls, 1, "idempotent rerun must not create duplicate marker");

  const openMarkers = openIssues.filter((issue) => issue.title === "Wave Ready: goal-1-wave-7" && issue.state === "OPEN");
  assert.equal(openMarkers.length, 1, "must keep exactly one open wave marker after rerun");

  assert.equal(emitted.length, 2);
  assert.equal(emitted[0].artifactType, "wave-judge-requeue");
  assert.equal(emitted[0].payload.wave, "goal-1-wave-7");
  assert.equal(emitted[0].payload.milestone, "goal-1-wave-7");
  assert.equal(emitted[0].payload.decision, "created_ready_marker");
  assert.equal(emitted[0].payload.markerIssueNumber, 9901);
  assert.equal(emitted[0].payload.judgeContextScopeIdentity, "wave_execute");
  assert.equal(emitted[0].payload.judge_context_scope_identity, "wave_execute");
  assert.equal(emitted[1].payload.decision, "already_ready");
  assert.equal(emitted[1].payload.markerIssueNumber, 9901);
  assert.equal(emitted[1].payload.judgeContextScopeIdentity, "wave_execute");
  assert.equal(emitted[1].payload.judge_context_scope_identity, "wave_execute");
});

test("requeueAfterJudgeFailure restores ready label when open marker exists without ready label", () => {
  const openIssues = [
    {
      number: 903,
      title: "Feature: still actionable",
      milestone: { title: "goal-1-wave-9" },
      labels: [],
      state: "OPEN",
      url: "https://gh/903",
    },
    {
      number: 9903,
      title: "Wave Ready: goal-1-wave-9",
      milestone: { title: "goal-1-wave-9" },
      labels: [{ name: "wave-in-progress" }],
      state: "OPEN",
      url: "https://gh/9903",
    },
  ];

  let createCalls = 0;
  const emitted = [];

  const createWaveReadyMarkerFn = () => {
    createCalls += 1;
    const marker = openIssues.find((issue) => issue.number === 9903);
    if (marker && !marker.labels.some((label) => label.name === "ready")) {
      marker.labels.push({ name: "ready" });
    }
    return {
      ok: true,
      decision: "already_ready",
      markerIssueNumber: "9903",
      url: "https://gh/9903",
      cooldownReason: "",
    };
  };

  const evaluateActionableIssuesFn = () => ({
    has_actionable_work: true,
    actionable_issue_numbers: ["903"],
    reason: "has_runnable_issue",
    eligibility: {
      has_runnable_issue: true,
      all_runnable_issues_externally_blocked: false,
      externally_blocked_issue_numbers: [],
      blocked_by: [],
    },
  });

  const emitSupervisorArtifactFn = ({ evidence }) => {
    emitted.push(JSON.parse(evidence));
    return { ok: true, issue_url: "", error: "" };
  };

  const first = requeueAfterJudgeFailure({
    repo: "recallnet/astrochicken",
    wave: "goal-1-wave-9",
    milestone: "goal-1-wave-9",
    judgeContext: { judge_context_scope_identity: "wave_execute" },
    listOpenIssuesFn: () => openIssues,
    evaluateActionableIssuesFn,
    createWaveReadyMarkerFn,
    emitSupervisorArtifactFn,
  });

  assert.equal(first.decision, "already_ready");
  assert.equal(first.wave_ready_marker_issue, "9903");
  assert.equal(first.judge_context_scope_identity, "wave_execute");
  assert.equal(createCalls, 1, "first run should relabel via create helper");

  const markerAfterFirst = openIssues.find((issue) => issue.number === 9903);
  assert.ok(markerAfterFirst?.labels.some((label) => label.name === "ready"), "ready label should be restored");

  const second = requeueAfterJudgeFailure({
    repo: "recallnet/astrochicken",
    wave: "goal-1-wave-9",
    milestone: "goal-1-wave-9",
    judgeContext: { judge_context_scope_identity: "wave_execute" },
    listOpenIssuesFn: () => openIssues,
    evaluateActionableIssuesFn,
    createWaveReadyMarkerFn,
    emitSupervisorArtifactFn,
  });

  assert.equal(second.decision, "already_ready");
  assert.equal(second.wave_ready_marker_issue, "9903");
  assert.equal(createCalls, 1, "second run should short-circuit without duplicate marker work");

  const openMarkers = openIssues.filter((issue) => issue.title === "Wave Ready: goal-1-wave-9" && issue.state === "OPEN");
  assert.equal(openMarkers.length, 1, "must keep exactly one open marker");
  assert.equal(emitted.length, 2);
  assert.equal(emitted[0].judge_context_scope_identity, "wave_execute");
  assert.equal(emitted[1].judge_context_scope_identity, "wave_execute");
});

test("requeueAfterJudgeFailure honors cooldown policy and emits cooldown_reason payload", () => {
  const openIssues = [
    {
      number: 902,
      title: "Feature: blocked by quarantine",
      milestone: { title: "goal-1-wave-8" },
      labels: [],
      state: "OPEN",
      url: "https://gh/902",
    },
  ];

  let createCalls = 0;
  let artifactPayload = null;

  const out = requeueAfterJudgeFailure({
    repo: "recallnet/astrochicken",
    wave: "goal-1-wave-8",
    milestone: "goal-1-wave-8",
    cooldownPolicy: { blocked: true, cooldownReason: "review_quarantine_active" },
    judgeContext: { judge_context_scope_identity: "wave_execute" },
    listOpenIssuesFn: () => openIssues,
    evaluateActionableIssuesFn: () => ({
      has_actionable_work: true,
      actionable_issue_numbers: ["902"],
      reason: "has_runnable_issue",
      eligibility: {
        has_runnable_issue: true,
        all_runnable_issues_externally_blocked: false,
        externally_blocked_issue_numbers: [],
        blocked_by: [],
      },
    }),
    createWaveReadyMarkerFn: () => {
      createCalls += 1;
      return { ok: true, decision: "created_ready_marker", markerIssueNumber: "9999", url: "https://gh/9999" };
    },
    emitSupervisorArtifactFn: ({ evidence }) => {
      artifactPayload = JSON.parse(evidence);
      return { ok: true, issue_url: "", error: "" };
    },
  });

  assert.equal(out.decision, "cooldown_blocked");
  assert.equal(out.cooldownReason, "review_quarantine_active");
  assert.equal(out.wave_ready_marker_issue, "");
  assert.equal(createCalls, 0, "cooldown path must not create marker");
  assert.equal(artifactPayload?.decision, "cooldown_blocked");
  assert.equal(artifactPayload?.cooldownReason, "review_quarantine_active");
  assert.equal(artifactPayload?.judgeContextScopeIdentity, "wave_execute");
  assert.equal(artifactPayload?.judge_context_scope_identity, "wave_execute");
});
