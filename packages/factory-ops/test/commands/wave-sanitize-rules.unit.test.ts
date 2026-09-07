import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  hasLabel,
  issueNumber,
  isWaveMarker,
  milestoneTitleFor,
  isOpenIssue,
  buildEmptyPlan,
  summarizePlan,
  planRollup,
  collectActiveWaveLeases,
  downgradeOrphanedLeases,
  planWaveReadyNormalization,
  planStaleWorktreeCleanupActions,
  planWaveOrphanStateRepair,
  WAVE_ORPHAN_REPAIR_SCHEMA_VERSION,
} from "../../src/commands/wave-sanitize-rules.ts";

// ---------------------------------------------------------------------------
// hasLabel
// ---------------------------------------------------------------------------
describe("hasLabel", () => {
  it("returns true when label is present", () => {
    assert.equal(hasLabel({ labels: [{ name: "ready" }] }, "ready"), true);
  });

  it("returns false when label is absent", () => {
    assert.equal(hasLabel({ labels: [{ name: "blocked" }] }, "ready"), false);
  });

  it("returns false for empty labels array", () => {
    assert.equal(hasLabel({ labels: [] }, "ready"), false);
  });

  it("returns false for null issue", () => {
    assert.equal(hasLabel(null, "ready"), false);
  });

  it("returns false for undefined issue", () => {
    assert.equal(hasLabel(undefined, "ready"), false);
  });

  it("returns false when labels is not an array", () => {
    assert.equal(hasLabel({ labels: "ready" }, "ready"), false);
  });

  it("handles label objects with missing name", () => {
    assert.equal(hasLabel({ labels: [{}] }, "ready"), false);
  });

  it("matches among multiple labels", () => {
    const issue = { labels: [{ name: "blocked" }, { name: "ready" }, { name: "wip" }] };
    assert.equal(hasLabel(issue, "ready"), true);
  });
});

// ---------------------------------------------------------------------------
// issueNumber
// ---------------------------------------------------------------------------
describe("issueNumber", () => {
  it("returns number from issue", () => {
    assert.equal(issueNumber({ number: 42 }), 42);
  });

  it("returns 0 for issue.number === 0", () => {
    assert.equal(issueNumber({ number: 0 }), 0);
  });

  it("returns 0 for null issue", () => {
    assert.equal(issueNumber(null), 0);
  });

  it("returns 0 for undefined issue", () => {
    assert.equal(issueNumber(undefined), 0);
  });

  it("returns 0 for negative number", () => {
    assert.equal(issueNumber({ number: -5 }), 0);
  });

  it("returns 0 for NaN number", () => {
    assert.equal(issueNumber({ number: NaN }), 0);
  });

  it("coerces string number", () => {
    assert.equal(issueNumber({ number: "99" }), 99);
  });
});

// ---------------------------------------------------------------------------
// isWaveMarker
// ---------------------------------------------------------------------------
describe("isWaveMarker", () => {
  it("returns true for Wave Ready title", () => {
    assert.equal(isWaveMarker({ title: "Wave Ready: Sprint-1" }), true);
  });

  it("returns false for normal title", () => {
    assert.equal(isWaveMarker({ title: "Fix bug #123" }), false);
  });

  it("returns false for null issue", () => {
    assert.equal(isWaveMarker(null), false);
  });

  it("returns false for empty title", () => {
    assert.equal(isWaveMarker({ title: "" }), false);
  });

  it("requires space after colon", () => {
    // The regex is /^Wave Ready:\s+/ so "Wave Ready:" with no trailing space fails
    assert.equal(isWaveMarker({ title: "Wave Ready:" }), false);
  });

  it("matches with multiple spaces after colon", () => {
    assert.equal(isWaveMarker({ title: "Wave Ready:  Sprint-2" }), true);
  });

  it("is case sensitive", () => {
    assert.equal(isWaveMarker({ title: "wave ready: Sprint-1" }), false);
  });
});

// ---------------------------------------------------------------------------
// milestoneTitleFor
// ---------------------------------------------------------------------------
describe("milestoneTitleFor", () => {
  it("returns milestone.title when present", () => {
    const issue = { milestone: { title: "Sprint-1" }, title: "Wave Ready: Sprint-2" };
    assert.equal(milestoneTitleFor(issue), "Sprint-1");
  });

  it("falls back to Wave Ready title pattern", () => {
    const issue = { title: "Wave Ready: Sprint-3" };
    assert.equal(milestoneTitleFor(issue), "Sprint-3");
  });

  it('returns "" when neither milestone nor Wave Ready pattern', () => {
    assert.equal(milestoneTitleFor({ title: "Fix bug" }), "");
  });

  it('returns "" for null issue', () => {
    assert.equal(milestoneTitleFor(null), "");
  });

  it("trims milestone title", () => {
    assert.equal(milestoneTitleFor({ milestone: { title: "  Sprint-4  " } }), "Sprint-4");
  });

  it("trims extracted Wave Ready title", () => {
    assert.equal(milestoneTitleFor({ title: "Wave Ready:  Sprint-5 " }), "Sprint-5");
  });

  it("prefers milestone.title over Wave Ready pattern", () => {
    const issue = { milestone: { title: "Alpha" }, title: "Wave Ready: Beta" };
    assert.equal(milestoneTitleFor(issue), "Alpha");
  });
});

// ---------------------------------------------------------------------------
// isOpenIssue
// ---------------------------------------------------------------------------
describe("isOpenIssue", () => {
  it("returns true for OPEN state", () => {
    assert.equal(isOpenIssue({ state: "OPEN" }), true);
  });

  it("returns false for CLOSED state", () => {
    assert.equal(isOpenIssue({ state: "CLOSED" }), false);
  });

  it("defaults to true when no state", () => {
    assert.equal(isOpenIssue({}), true);
  });

  it("defaults to true for null issue", () => {
    assert.equal(isOpenIssue(null), true);
  });

  it("is case insensitive", () => {
    assert.equal(isOpenIssue({ state: "closed" }), false);
    assert.equal(isOpenIssue({ state: "Closed" }), false);
  });
});

// ---------------------------------------------------------------------------
// buildEmptyPlan
// ---------------------------------------------------------------------------
describe("buildEmptyPlan", () => {
  it("returns plan with correct schema_version", () => {
    const plan = buildEmptyPlan();
    assert.equal(plan.schema_version, WAVE_ORPHAN_REPAIR_SCHEMA_VERSION);
  });

  it("returns plan with action_count 0", () => {
    assert.equal(buildEmptyPlan().action_count, 0);
  });

  it("returns empty actions array", () => {
    assert.deepEqual(buildEmptyPlan().actions, []);
  });

  it("returns zero stats", () => {
    const { stats } = buildEmptyPlan();
    assert.equal(stats.close_issue_count, 0);
    assert.equal(stats.remove_label_count, 0);
    assert.equal(stats.add_label_count, 0);
    assert.equal(stats.duplicate_marker_count, 0);
    assert.equal(stats.stale_marker_count, 0);
    assert.equal(stats.stale_in_progress_release_count, 0);
    assert.equal(stats.stale_claim_release_count, 0);
    assert.equal(stats.invalid_label_count, 0);
    assert.equal(stats.restored_ready_count, 0);
    assert.equal(stats.restored_in_progress_count, 0);
  });
});

// ---------------------------------------------------------------------------
// summarizePlan
// ---------------------------------------------------------------------------
describe("summarizePlan", () => {
  it('returns "already clean" when zero actions', () => {
    const plan = buildEmptyPlan();
    const msg = summarizePlan(plan);
    assert.ok(msg.includes("already clean"), `expected 'already clean' in: ${msg}`);
  });

  it('returns "dry-run plan" with counts when dryRun=true', () => {
    const plan = {
      action_count: 3,
      stats: { close_issue_count: 1, remove_label_count: 1, add_label_count: 1, cleanup_worktree_count: 0 },
    };
    const msg = summarizePlan(plan, { dryRun: true });
    assert.ok(msg.includes("dry-run plan"), `expected 'dry-run plan' in: ${msg}`);
    assert.ok(msg.includes("actions=3"), `expected 'actions=3' in: ${msg}`);
    assert.ok(msg.includes("close=1"), `expected 'close=1' in: ${msg}`);
  });

  it('returns "apply complete" when dryRun=false', () => {
    const plan = {
      action_count: 5,
      stats: { close_issue_count: 2, remove_label_count: 1, add_label_count: 2, cleanup_worktree_count: 0 },
    };
    const msg = summarizePlan(plan, { dryRun: false, appliedCount: 4, failedCount: 1 });
    assert.ok(msg.includes("apply complete"), `expected 'apply complete' in: ${msg}`);
    assert.ok(msg.includes("applied=4"), `expected 'applied=4' in: ${msg}`);
    assert.ok(msg.includes("failed=1"), `expected 'failed=1' in: ${msg}`);
  });

  it("includes active lease count when > 0", () => {
    const plan = buildEmptyPlan();
    const msg = summarizePlan(plan, { activeLeaseCount: 2, activeMilestones: ["Sprint-1", "Sprint-2"] });
    assert.ok(msg.includes("2 active lease(s)"), `expected '2 active lease(s)' in: ${msg}`);
    assert.ok(msg.includes("Sprint-1, Sprint-2"), `expected milestones in: ${msg}`);
  });

  it("shows no active leases when count is 0", () => {
    const plan = buildEmptyPlan();
    const msg = summarizePlan(plan, { activeLeaseCount: 0 });
    assert.ok(msg.includes("no active leases detected"), `expected no leases in: ${msg}`);
  });
});

// ---------------------------------------------------------------------------
// planRollup
// ---------------------------------------------------------------------------
describe("planRollup", () => {
  it("groups actions by type", () => {
    const plan = {
      actions: [
        { type: "close_issue", issue_number: "10" },
        { type: "add_label", issue_number: "20", label: "ready" },
        { type: "remove_label", issue_number: "30", label: "wave-in-progress" },
        { type: "release_claim", issue_number: "40" },
      ],
    };
    const rollup = planRollup(plan);
    assert.deepEqual(rollup.closeIssueNumbers, ["10"]);
    assert.deepEqual(rollup.addReadyIssueNumbers, ["20"]);
    assert.deepEqual(rollup.releaseIssueNumbers, ["30"]);
    assert.deepEqual(rollup.releaseClaimIssueNumbers, ["40"]);
  });

  it("returns detail objects with issue info", () => {
    const plan = {
      actions: [{ type: "close_issue", issue_number: "10" }],
    };
    const openIssues = [{ number: 10, title: "Test Issue", url: "https://example.com/10" }];
    const rollup = planRollup(plan, { openIssues });
    assert.equal(rollup.closeIssueDetails.length, 1);
    assert.equal(rollup.closeIssueDetails[0].title, "Test Issue");
    assert.equal(rollup.closeIssueDetails[0].url, "https://example.com/10");
  });

  it("handles empty plan gracefully", () => {
    const rollup = planRollup({ actions: [] });
    assert.deepEqual(rollup.closeIssueNumbers, []);
    assert.deepEqual(rollup.addReadyIssueNumbers, []);
    assert.deepEqual(rollup.releaseIssueNumbers, []);
    assert.deepEqual(rollup.releaseClaimIssueNumbers, []);
  });

  it("handles null plan", () => {
    const rollup = planRollup(null);
    assert.deepEqual(rollup.closeIssueNumbers, []);
  });

  it("only counts add_label with label=ready for addReadyIssueNumbers", () => {
    const plan = {
      actions: [
        { type: "add_label", issue_number: "1", label: "ready" },
        { type: "add_label", issue_number: "2", label: "wave-in-progress" },
      ],
    };
    const rollup = planRollup(plan);
    assert.deepEqual(rollup.addReadyIssueNumbers, ["1"]);
  });
});

// ---------------------------------------------------------------------------
// collectActiveWaveLeases
// ---------------------------------------------------------------------------
describe("collectActiveWaveLeases", () => {
  const NOW = Date.parse("2026-03-23T12:00:00Z");

  it("only processes wave_execute pipeline runs", () => {
    const runs = [
      { pipelineFile: "wave_execute.dot", status: "running", context: { milestone_title: "S1" }, updatedAt: "2026-03-23T11:55:00Z" },
      { pipelineFile: "goal_run.dot", status: "running", context: { milestone_title: "S2" }, updatedAt: "2026-03-23T11:55:00Z" },
    ];
    const result = collectActiveWaveLeases(runs, { nowEpochMs: NOW, staleRunMinutes: 20 });
    assert.equal(result.active_lease_count, 1);
    assert.equal(result.active_leases[0].milestone_title, "S1");
  });

  it("only processes running/queued/suspended runs", () => {
    const runs = [
      { pipelineFile: "wave_execute.dot", status: "running", context: { milestone_title: "S1" }, updatedAt: "2026-03-23T11:55:00Z" },
      { pipelineFile: "wave_execute.dot", status: "completed", context: { milestone_title: "S2" }, updatedAt: "2026-03-23T11:55:00Z" },
      { pipelineFile: "wave_execute.dot", status: "failed", context: { milestone_title: "S3" }, updatedAt: "2026-03-23T11:55:00Z" },
    ];
    const result = collectActiveWaveLeases(runs, { nowEpochMs: NOW, staleRunMinutes: 20 });
    assert.equal(result.active_lease_count, 1);
    assert.equal(result.active_leases[0].milestone_title, "S1");
  });

  it("marks stale runs based on threshold", () => {
    const runs = [
      { pipelineFile: "wave_execute.dot", status: "running", context: { milestone_title: "S1" }, updatedAt: "2026-03-23T11:00:00Z" }, // 60 min old
    ];
    const result = collectActiveWaveLeases(runs, { nowEpochMs: NOW, staleRunMinutes: 20 });
    assert.equal(result.active_lease_count, 0);
    assert.equal(result.stale_candidate_count, 1);
    assert.equal(result.stale_candidates[0].milestone_title, "S1");
  });

  it("skips runs without milestone_title", () => {
    const runs = [
      { pipelineFile: "wave_execute.dot", status: "running", context: {}, updatedAt: "2026-03-23T11:55:00Z" },
    ];
    const result = collectActiveWaveLeases(runs, { nowEpochMs: NOW });
    assert.equal(result.active_lease_count, 0);
    assert.equal(result.stale_candidate_count, 0);
  });

  it("returns empty for empty input", () => {
    const result = collectActiveWaveLeases([], {});
    assert.equal(result.active_lease_count, 0);
    assert.equal(result.stale_candidate_count, 0);
    assert.deepEqual(result.active_leases, []);
    assert.deepEqual(result.stale_candidates, []);
  });

  it("populates active_milestones from active leases only", () => {
    const runs = [
      { pipelineFile: "wave_execute.dot", status: "running", context: { milestone_title: "Active" }, updatedAt: "2026-03-23T11:55:00Z" },
      { pipelineFile: "wave_execute.dot", status: "running", context: { milestone_title: "Stale" }, updatedAt: "2026-03-23T10:00:00Z" },
    ];
    const result = collectActiveWaveLeases(runs, { nowEpochMs: NOW, staleRunMinutes: 20 });
    assert.deepEqual(result.active_milestones, ["Active"]);
  });

  it("extracts ready_issue_number from context", () => {
    const runs = [
      { pipelineFile: "wave_execute.dot", status: "running", context: { milestone_title: "S1", ready_issue_number: 42 }, updatedAt: "2026-03-23T11:55:00Z" },
    ];
    const result = collectActiveWaveLeases(runs, { nowEpochMs: NOW });
    assert.equal(result.active_leases[0].ready_issue_number, "42");
  });

  it("uses _mtime as fallback for updated timestamp", () => {
    const runs = [
      { pipelineFile: "wave_execute.dot", status: "running", context: { milestone_title: "S1" }, _mtime: NOW - 5 * 60 * 1000 },
    ];
    const result = collectActiveWaveLeases(runs, { nowEpochMs: NOW, staleRunMinutes: 20 });
    assert.equal(result.active_lease_count, 1);
  });

  it("recognizes pipeline name ending with wave_execute", () => {
    const runs = [
      { pipeline: "wave_execute", status: "queued", context: { milestone_title: "S1" }, updatedAt: "2026-03-23T11:55:00Z" },
    ];
    const result = collectActiveWaveLeases(runs, { nowEpochMs: NOW });
    assert.equal(result.active_lease_count, 1);
  });

  it("recognizes suspended status", () => {
    const runs = [
      { pipelineFile: "wave_execute.dot", status: "suspended", context: { milestone_title: "S1" }, updatedAt: "2026-03-23T11:55:00Z" },
    ];
    const result = collectActiveWaveLeases(runs, { nowEpochMs: NOW });
    assert.equal(result.active_lease_count, 1);
  });
});

// ---------------------------------------------------------------------------
// downgradeOrphanedLeases
// ---------------------------------------------------------------------------
describe("downgradeOrphanedLeases", () => {
  it("downgrades leases with no matching run (missing)", () => {
    const activeLeases = {
      active_leases: [{ run_id: "run-1", milestone_title: "S1" }],
      stale_candidates: [],
      active_milestones: ["S1"],
      active_lease_count: 1,
      stale_candidate_count: 0,
    };
    const result = downgradeOrphanedLeases({ activeLeases, runStatuses: new Map() });
    assert.equal(result.active_lease_count, 0);
    assert.equal(result.stale_candidate_count, 1);
    assert.equal(result.stale_candidates[0].status, "orphaned_missing_run");
  });

  it("downgrades leases with completed run", () => {
    const activeLeases = {
      active_leases: [{ run_id: "run-1", milestone_title: "S1" }],
      stale_candidates: [],
      active_milestones: ["S1"],
      active_lease_count: 1,
      stale_candidate_count: 0,
    };
    const statuses = new Map([["run-1", "completed"]]);
    const result = downgradeOrphanedLeases({ activeLeases, runStatuses: statuses });
    assert.equal(result.active_lease_count, 0);
    assert.equal(result.stale_candidates[0].status, "orphaned_run_completed");
  });

  it("downgrades leases with failed run", () => {
    const activeLeases = {
      active_leases: [{ run_id: "run-1", milestone_title: "S1" }],
      stale_candidates: [],
      active_milestones: ["S1"],
      active_lease_count: 1,
      stale_candidate_count: 0,
    };
    const statuses = new Map([["run-1", "failed"]]);
    const result = downgradeOrphanedLeases({ activeLeases, runStatuses: statuses });
    assert.equal(result.stale_candidates[0].status, "orphaned_run_failed");
  });

  it("keeps leases with active run status", () => {
    const activeLeases = {
      active_leases: [{ run_id: "run-1", milestone_title: "S1" }],
      stale_candidates: [],
      active_milestones: ["S1"],
      active_lease_count: 1,
      stale_candidate_count: 0,
    };
    const statuses = new Map([["run-1", "running"]]);
    const result = downgradeOrphanedLeases({ activeLeases, runStatuses: statuses });
    assert.equal(result.active_lease_count, 1);
    assert.equal(result.stale_candidate_count, 0);
  });

  it("downgrades leases with stale heartbeat (zombie detection)", () => {
    const NOW = Date.parse("2026-03-23T12:00:00Z");
    const activeLeases = {
      active_leases: [{ run_id: "run-1", milestone_title: "S1" }],
      stale_candidates: [],
      active_milestones: ["S1"],
      active_lease_count: 1,
      stale_candidate_count: 0,
    };
    const statuses = new Map([["run-1", "running"]]);
    const metadata = new Map([["run-1", { status: "running", heartbeatAt: "2026-03-23T11:00:00Z" }]]);
    const result = downgradeOrphanedLeases({
      activeLeases,
      runStatuses: statuses,
      runMetadata: metadata,
      staleHeartbeatMinutes: 10,
      nowEpochMs: NOW,
    });
    assert.equal(result.active_lease_count, 0);
    assert.equal(result.stale_candidates[0].status, "orphaned_zombie_stale_heartbeat");
  });

  it("keeps lease if heartbeat is fresh", () => {
    const NOW = Date.parse("2026-03-23T12:00:00Z");
    const activeLeases = {
      active_leases: [{ run_id: "run-1", milestone_title: "S1" }],
      stale_candidates: [],
      active_milestones: ["S1"],
      active_lease_count: 1,
      stale_candidate_count: 0,
    };
    const statuses = new Map([["run-1", "running"]]);
    const metadata = new Map([["run-1", { status: "running", heartbeatAt: "2026-03-23T11:55:00Z" }]]);
    const result = downgradeOrphanedLeases({
      activeLeases,
      runStatuses: statuses,
      runMetadata: metadata,
      staleHeartbeatMinutes: 10,
      nowEpochMs: NOW,
    });
    assert.equal(result.active_lease_count, 1);
  });

  it("preserves existing stale_candidates", () => {
    const activeLeases = {
      active_leases: [{ run_id: "run-2", milestone_title: "S2" }],
      stale_candidates: [{ run_id: "run-1", milestone_title: "S1", status: "already_stale" }],
      active_milestones: ["S2"],
      active_lease_count: 1,
      stale_candidate_count: 1,
    };
    const statuses = new Map([["run-2", "completed"]]);
    const result = downgradeOrphanedLeases({ activeLeases, runStatuses: statuses });
    assert.equal(result.stale_candidate_count, 2);
  });

  it("updates active_milestones after downgrade", () => {
    const activeLeases = {
      active_leases: [
        { run_id: "run-1", milestone_title: "S1" },
        { run_id: "run-2", milestone_title: "S2" },
      ],
      stale_candidates: [],
      active_milestones: ["S1", "S2"],
      active_lease_count: 2,
      stale_candidate_count: 0,
    };
    const statuses = new Map([["run-1", "completed"], ["run-2", "running"]]);
    const result = downgradeOrphanedLeases({ activeLeases, runStatuses: statuses });
    assert.deepEqual(result.active_milestones, ["S2"]);
  });

  it("handles guarded_terminal status", () => {
    const activeLeases = {
      active_leases: [{ run_id: "run-1", milestone_title: "S1" }],
      stale_candidates: [],
      active_milestones: ["S1"],
      active_lease_count: 1,
      stale_candidate_count: 0,
    };
    const statuses = new Map([["run-1", "guarded_terminal"]]);
    const result = downgradeOrphanedLeases({ activeLeases, runStatuses: statuses });
    assert.equal(result.stale_candidates[0].status, "orphaned_run_guarded_terminal");
  });
});

// ---------------------------------------------------------------------------
// planStaleWorktreeCleanupActions
// ---------------------------------------------------------------------------
describe("planStaleWorktreeCleanupActions", () => {
  it("generates cleanup_worktree actions from stale candidates", () => {
    const candidates = [
      { worktree_dir: "/tmp/wt-1", milestone_title: "S1", run_id: "run-1" },
    ];
    const actions = planStaleWorktreeCleanupActions(candidates);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, "cleanup_worktree");
    assert.equal(actions[0].worktree_dir, "/tmp/wt-1");
    assert.equal(actions[0].reason, "orphaned_wave_worktree");
  });

  it("deduplicates by worktree_dir", () => {
    const candidates = [
      { worktree_dir: "/tmp/wt-1", milestone_title: "S1", run_id: "run-1" },
      { worktree_dir: "/tmp/wt-1", milestone_title: "S1", run_id: "run-2" },
    ];
    const actions = planStaleWorktreeCleanupActions(candidates);
    assert.equal(actions.length, 1);
  });

  it("returns empty for empty input", () => {
    assert.deepEqual(planStaleWorktreeCleanupActions([]), []);
  });

  it("skips candidates without worktree_dir", () => {
    const candidates = [
      { worktree_dir: "", milestone_title: "S1", run_id: "run-1" },
      { milestone_title: "S2", run_id: "run-2" },
    ];
    const actions = planStaleWorktreeCleanupActions(candidates);
    assert.equal(actions.length, 0);
  });

  it("handles non-array input gracefully", () => {
    assert.deepEqual(planStaleWorktreeCleanupActions(null), []);
    assert.deepEqual(planStaleWorktreeCleanupActions(undefined), []);
  });
});

// ---------------------------------------------------------------------------
// planWaveReadyNormalization
// ---------------------------------------------------------------------------
describe("planWaveReadyNormalization", () => {
  it("returns zero counts for no wave markers", () => {
    const issues = [{ number: 1, title: "Regular issue", state: "OPEN", labels: [] }];
    const result = planWaveReadyNormalization(issues);
    assert.equal(result.duplicate_count, 0);
    assert.equal(result.relabeled_count, 0);
  });

  it("detects duplicate wave markers for same milestone", () => {
    const issues = [
      { number: 1, title: "Wave Ready: Sprint-1", state: "OPEN", labels: [{ name: "ready" }] },
      { number: 2, title: "Wave Ready: Sprint-1", state: "OPEN", labels: [{ name: "ready" }] },
    ];
    const result = planWaveReadyNormalization(issues);
    assert.equal(result.duplicate_count, 1);
    assert.equal(result.close_issue_numbers.length, 1);
  });

  it("restores ready label when missing from keeper", () => {
    const issues = [
      { number: 1, title: "Wave Ready: Sprint-1", state: "OPEN", labels: [{ name: "wave-in-progress" }] },
    ];
    // No active leases, so wave-in-progress without a lease -> release in-progress, restore ready
    const result = planWaveReadyNormalization(issues);
    assert.ok(result.relabeled_count > 0 || result.add_ready_issue_numbers.length > 0,
      "expected ready label to be added");
  });

  it("handles empty input", () => {
    const result = planWaveReadyNormalization([]);
    assert.equal(result.duplicate_count, 0);
    assert.equal(result.relabeled_count, 0);
  });
});

// ---------------------------------------------------------------------------
// planWaveOrphanStateRepair (integration-level unit tests)
// ---------------------------------------------------------------------------
describe("planWaveOrphanStateRepair", () => {
  it("returns empty plan when no wave markers and no in-progress labels", () => {
    const issues = [{ number: 1, title: "Regular", state: "OPEN", labels: [] }];
    const plan = planWaveOrphanStateRepair({ openIssues: issues });
    assert.equal(plan.action_count, 0);
  });

  it("closes wave markers with missing milestone", () => {
    // title has "Wave Ready:" but milestone extraction fails (no content after colon trimming)
    // Actually "Wave Ready: " with space satisfies regex but trim yields ""
    const issues = [
      { number: 1, title: "Wave Ready:  ", state: "OPEN", labels: [{ name: "ready" }], milestone: null },
    ];
    const plan = planWaveOrphanStateRepair({ openIssues: issues });
    // milestoneTitleFor: milestone is null, title match: "Wave Ready:  " -> m[1].trim() = ""
    // So addClose with "invalid_wave_marker_missing_milestone"
    const closeActions = plan.actions.filter((a) => a.type === "close_issue");
    assert.equal(closeActions.length, 1);
    assert.equal(closeActions[0].reason, "invalid_wave_marker_missing_milestone");
  });

  it("closes duplicate markers for the same milestone", () => {
    const issues = [
      { number: 1, title: "Wave Ready: Sprint-1", state: "OPEN", labels: [{ name: "ready" }] },
      { number: 2, title: "Wave Ready: Sprint-1", state: "OPEN", labels: [{ name: "ready" }] },
    ];
    const plan = planWaveOrphanStateRepair({ openIssues: issues });
    const closeDuplicates = plan.actions.filter((a) => a.reason === "duplicate_wave_marker");
    assert.equal(closeDuplicates.length, 1);
  });

  it("removes wave-in-progress from non-marker issues", () => {
    const issues = [
      { number: 10, title: "Fix bug", state: "OPEN", labels: [{ name: "wave-in-progress" }] },
    ];
    const plan = planWaveOrphanStateRepair({ openIssues: issues });
    const removeActions = plan.actions.filter(
      (a) => a.type === "remove_label" && a.reason === "invalid_non_marker_wave_in_progress_label",
    );
    assert.equal(removeActions.length, 1);
    assert.equal(removeActions[0].issue_number, "10");
  });

  it("releases stale wave-in-progress when no active lease", () => {
    const issues = [
      { number: 1, title: "Wave Ready: Sprint-1", state: "OPEN", labels: [{ name: "wave-in-progress" }] },
    ];
    const plan = planWaveOrphanStateRepair({ openIssues: issues, activeLeases: { active_milestones: [], active_leases: [], stale_candidates: [] } });
    const removeInProgress = plan.actions.filter(
      (a) => a.type === "remove_label" && a.label === "wave-in-progress",
    );
    assert.ok(removeInProgress.length > 0, "expected wave-in-progress removal");
    const addReady = plan.actions.filter(
      (a) => a.type === "add_label" && a.label === "ready",
    );
    assert.ok(addReady.length > 0, "expected ready label to be restored");
  });

  it("closing supersedes label and claim edits for that issue", () => {
    // Two markers for same milestone, one will be closed as duplicate
    // The closed one should not have separate label/claim actions
    const issues = [
      { number: 1, title: "Wave Ready: Sprint-1", state: "OPEN", labels: [{ name: "ready" }] },
      { number: 2, title: "Wave Ready: Sprint-1", state: "OPEN", labels: [{ name: "ready" }] },
    ];
    const plan = planWaveOrphanStateRepair({ openIssues: issues });
    const closedNumber = plan.actions.find((a) => a.type === "close_issue")?.issue_number;
    // No label or claim actions for the closed issue
    const otherActionsForClosed = plan.actions.filter(
      (a) => a.issue_number === closedNumber && a.type !== "close_issue",
    );
    assert.equal(otherActionsForClosed.length, 0, "closed issue should have no label/claim actions");
  });

  it("skips CLOSED issues", () => {
    const issues = [
      { number: 1, title: "Wave Ready: Sprint-1", state: "CLOSED", labels: [{ name: "ready" }] },
    ];
    const plan = planWaveOrphanStateRepair({ openIssues: issues });
    assert.equal(plan.action_count, 0);
  });

  it("handles externally blocked milestones", () => {
    const issues = [
      { number: 1, title: "Wave Ready: Sprint-1", state: "OPEN", labels: [{ name: "ready" }] },
    ];
    const plan = planWaveOrphanStateRepair({
      openIssues: issues,
      externallyBlockedMilestones: ["Sprint-1"],
      activeLeases: { active_milestones: [], active_leases: [], stale_candidates: [] },
    });
    const removeReady = plan.actions.filter(
      (a) => a.type === "remove_label" && a.label === "ready" && a.reason === "externally_blocked_milestone_not_runnable",
    );
    assert.ok(removeReady.length > 0, "expected ready label removal for externally blocked milestone");
  });

  it("restores in-progress from active lease", () => {
    const issues = [
      { number: 5, title: "Wave Ready: Sprint-1", state: "OPEN", labels: [{ name: "ready" }] },
    ];
    const activeLeases = {
      active_milestones: ["Sprint-1"],
      active_leases: [{ milestone_title: "Sprint-1", ready_issue_number: 5, run_id: "run-1" }],
      stale_candidates: [],
    };
    const plan = planWaveOrphanStateRepair({ openIssues: issues, activeLeases });
    const addInProgress = plan.actions.filter(
      (a) => a.type === "add_label" && a.label === "wave-in-progress",
    );
    assert.ok(addInProgress.length > 0, "expected wave-in-progress label to be added from active lease");
  });

  it("includes cleanup_worktree actions from stale candidates", () => {
    const issues = [
      { number: 1, title: "Wave Ready: Sprint-1", state: "OPEN", labels: [{ name: "ready" }] },
    ];
    const activeLeases = {
      active_milestones: [],
      active_leases: [],
      stale_candidates: [{ worktree_dir: "/tmp/wt-1", milestone_title: "Sprint-1", run_id: "run-1" }],
    };
    const plan = planWaveOrphanStateRepair({ openIssues: issues, activeLeases });
    const cleanupActions = plan.actions.filter((a) => a.type === "cleanup_worktree");
    assert.equal(cleanupActions.length, 1);
    assert.equal(cleanupActions[0].worktree_dir, "/tmp/wt-1");
  });
});
