import assert from "node:assert/strict";
import test from "node:test";

import { buildGoalIssueItem, emptyGoalBranchContext, buildGoalIssueContext } from "../../src/commands/goal-build-item.ts";

// ─── buildGoalIssueItem ─────────────────────────────────────────────────────

test("buildGoalIssueItem returns trimmed issue_number and issue_title", () => {
  const out = buildGoalIssueItem({ issueNumber: " 42 ", issueTitle: " Feature X " });
  assert.deepEqual(out, { issue_number: "42", issue_title: "Feature X" });
});

test("buildGoalIssueItem handles empty input", () => {
  const out = buildGoalIssueItem();
  assert.deepEqual(out, { issue_number: "", issue_title: "" });
});

// ─── emptyGoalBranchContext ─────────────────────────────────────────────────

test("emptyGoalBranchContext produces goal-scoped branch and session", () => {
  const out = emptyGoalBranchContext({ goalNumber: "1953" });
  assert.equal(out.branch, "goal/1953");
  assert.equal(out.agent_session_id, "goal-1953");
  assert.equal(out.reviewer_session_id, "reviewer-goal-1953");
  assert.equal(out.goal_sessions_dir, ".hatch/goal-sessions/1953");
  assert.equal(out.worktree_dir, "");
});

test("emptyGoalBranchContext sanitizes special characters", () => {
  const out = emptyGoalBranchContext({ goalNumber: "goal 42/wave" });
  assert.equal(out.branch, "goal/goal-42-wave");
});

test("emptyGoalBranchContext handles empty goalNumber", () => {
  const out = emptyGoalBranchContext();
  assert.equal(out.branch, "goal/0");
});

// ─── buildGoalIssueContext ──────────────────────────────────────────────────

test("buildGoalIssueContext produces issue-isolated branch within goal", () => {
  const out = buildGoalIssueContext({ goalNumber: "1953", issueNumber: "2001" });
  assert.equal(out.branch, "goal/1953-issue-2001");
  assert.equal(out.agent_session_id, "goal-1953-issue-2001");
  assert.equal(out.worktree_dir, "");
});

test("buildGoalIssueContext handles missing issueNumber", () => {
  const out = buildGoalIssueContext({ goalNumber: "1953" });
  assert.equal(out.branch, "goal/1953-issue-unknown");
});
