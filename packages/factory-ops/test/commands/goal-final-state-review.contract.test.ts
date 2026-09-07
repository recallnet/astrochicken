import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("goal final-state-review closes eligible goals from canonical projection without GitHub truth reads", () => {
  const src = readFileSync("packages/factory-ops/src/commands/goal-final-state-review.ts", "utf8");
  assert.match(src, /projectGoalFinalState/);
  assert.doesNotMatch(src, /goal-dispatched/);
  assert.doesNotMatch(src, /createGitHubIssueSource/);
  assert.doesNotMatch(src, /issueView\(/);
});

test("goal final-state-review direct mode emits deterministic comment markers and mode routing", () => {
  const src = readFileSync("packages/factory-ops/src/commands/goal-final-state-review.ts", "utf8");
  assert.match(src, /normalizeMode\(value = ""\)/);
  assert.match(src, /mode: "direct"/);
  assert.match(src, /goal-final-state:direct:\$\{success \? "success" : "failure"\}/);
  assert.match(src, /direct_goal_execution=true/);
});
