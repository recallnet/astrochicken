import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMilestoneIssueItem,
  emptyMilestoneBranchContext,
  buildMilestoneParallelIssueContext,
} from "../src/commands/milestone-build-item.ts";

test("buildMilestoneIssueItem returns trimmed issue_number and issue_title", () => {
  const item = buildMilestoneIssueItem({ issueNumber: " 42 ", issueTitle: " Fix bug " });
  assert.equal(item.issue_number, "42");
  assert.equal(item.issue_title, "Fix bug");
});

test("buildMilestoneIssueItem handles missing fields", () => {
  const item = buildMilestoneIssueItem({});
  assert.equal(item.issue_number, "");
  assert.equal(item.issue_title, "");
});

test("emptyMilestoneBranchContext sanitizes milestone title", () => {
  const ctx = emptyMilestoneBranchContext({ milestoneTitle: "goal-542-wave-1" });
  assert.equal(ctx.branch, "wave/goal-542-wave-1");
  assert.equal(ctx.agent_session_id, "milestone-goal-542-wave-1");
  assert.equal(ctx.wave_sessions_dir, ".hatch/wave-sessions/goal-542-wave-1");
  assert.equal(ctx.worktree_dir, "");
});

test("emptyMilestoneBranchContext handles special characters", () => {
  const ctx = emptyMilestoneBranchContext({ milestoneTitle: "goal with spaces & symbols!" });
  assert.equal(ctx.branch, "wave/goal-with-spaces-symbols-");
});

test("emptyMilestoneBranchContext defaults to wave when no title", () => {
  const ctx = emptyMilestoneBranchContext({});
  assert.equal(ctx.branch, "wave/wave");
});

test("buildMilestoneParallelIssueContext creates isolated branch/session per issue", () => {
  const ctx = buildMilestoneParallelIssueContext({
    milestoneTitle: "goal-542-wave-1",
    issueNumber: "1294",
  });

  assert.equal(ctx.branch, "wave/goal-542-wave-1-issue-1294");
  assert.equal(ctx.agent_session_id, "milestone-goal-542-wave-1-issue-1294");
  assert.equal(ctx.worktree_dir, "");
});

test("buildMilestoneParallelIssueContext sanitizes issue suffix and handles missing issue", () => {
  const special = buildMilestoneParallelIssueContext({
    milestoneTitle: "goal with spaces",
    issueNumber: "12/94*bad",
  });
  assert.equal(special.branch, "wave/goal-with-spaces-issue-12-94-bad");

  const missing = buildMilestoneParallelIssueContext({ milestoneTitle: "goal-1-wave-1" });
  assert.equal(missing.branch, "wave/goal-1-wave-1-issue-unknown");
});
