import assert from "node:assert/strict";
import test from "node:test";

test("goal-issue-init re-exports initWaveIssueWorktree (regression: initGoalIssueWorktree rename)", async () => {
  const mod = await import("../../src/commands/goal-issue-init.ts");
  assert.equal(typeof mod.initWaveIssueWorktree, "function",
    "initWaveIssueWorktree must be exported from goal-issue-init.mjs — CLI command depends on it");
});

test("goal-issue-state re-exports all wave-issue functions used by CLI (regression: Goal→Wave rename)", async () => {
  const mod = await import("../../src/commands/goal-issue-state.ts");
  const required = [
    "setupWaveIssueWorktree",
    "cleanupWaveIssueWorktree",
    "estimateWaveIssueComplexity",
    "buildWaveIssueImplResult",
  ];
  for (const name of required) {
    assert.equal(typeof mod[name], "function",
      `${name} must be exported from goal-issue-state.mjs — CLI command depends on it`);
  }
});
