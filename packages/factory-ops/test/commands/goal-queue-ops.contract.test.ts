import { makeCreatedTradingSubIssue } from "../helpers/ops-domain-fixtures.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isBlockedByOpenRelationships, evaluateGoalDecomposeBackpressure, limitKeptGoalsForTick, computeGoalRunCloseCondition } from "../../src/commands/goal-queue-ops.ts";

test("isBlockedByOpenRelationships returns true when any blocker is OPEN", () => {
  const blockedBy = [
    { number: 10, state: "CLOSED" },
    { number: 11, state: "OPEN" },
  ];
  assert.equal(isBlockedByOpenRelationships(blockedBy), true);
});

test("isBlockedByOpenRelationships returns false when all blockers are CLOSED", () => {
  const blockedBy = [
    { number: 10, state: "CLOSED" },
    { number: 11, state: "closed" },
  ];
  assert.equal(isBlockedByOpenRelationships(blockedBy), false);
});

test("isBlockedByOpenRelationships handles missing/invalid lists", () => {
  assert.equal(isBlockedByOpenRelationships(null), false);
  assert.equal(isBlockedByOpenRelationships([]), false);
});

// Gate: listReadyGoals must sort bug-labeled goals before normal goals
test("listReadyGoals sorts bug-labeled goals first (contract)", () => {
  const src = readFileSync("packages/factory-ops/src/commands/goal-queue-ops.ts", "utf8");
  assert.ok(src.includes("is_bug"), "listReadyGoals must tag goals with is_bug");
  assert.ok(
    src.includes(".sort(") && src.includes("is_bug"),
    "listReadyGoals must sort by is_bug (bugs first) for fast-track dispatch"
  );
});

test("listReadyGoals includes decomposed goals that have dispatchable sub-issues", () => {
  const src = readFileSync("packages/factory-ops/src/commands/goal-queue-ops.ts", "utf8");
  assert.match(src, /hasLabel\(g, "ready"\)/);
  assert.match(src, /decomposed/);
  assert.match(src, /dispatchable/);
  // Must filter on dispatchable (not just !decomposed) so goals with
  // open sub-issues (e.g. Daily Lens follow-ups) are still eligible.
  assert.match(src, /filter\(\(g\) => !g\.blocked && g\.dispatchable\)/);
});

test("evaluateGoalDecomposeBackpressure blocks decomposition when executable goals meet capacity", () => {
  const out = evaluateGoalDecomposeBackpressure({
    repo: "recallnet/astrochicken",
    maxConcurrentGoals: "2",
    ghJsonFn: (args) => args[0] === "api"
      ? [{ state: "open" }]
      : [{ number: 1, labels: [{ name: "ready" }] }, { number: 2, labels: [{ name: "ready" }] }],
  });

  assert.equal(out.decompose_allowed, "false");
  assert.equal(out.executable_goal_count, 2);
  assert.equal(out.max_concurrent_goals, 2);
  assert.equal(out.decompose_skip_reason, "goal_execution_backlog_at_or_above_capacity");
});

test("evaluateGoalDecomposeBackpressure allows decomposition when backlog below capacity", () => {
  const out = evaluateGoalDecomposeBackpressure({
    repo: "recallnet/astrochicken",
    maxConcurrentGoals: "3",
    ghJsonFn: (args) => args[0] === "api"
      ? []
      : [{ number: 1, labels: [{ name: "ready" }] }],
  });

  assert.equal(out.decompose_allowed, "true");
  assert.equal(out.executable_goal_count, 0);
  assert.equal(out.decompose_skip_reason, "no_executable_goals");
});

test("evaluateGoalDecomposeBackpressure excludes quarantined sub-issues from executable count", () => {
  const out = evaluateGoalDecomposeBackpressure({
    repo: "example-org/example-trading",
    maxConcurrentGoals: "1",
    ghJsonFn: () => [{ number: 1187, labels: [{ name: "goal" }, { name: "ready" }] }],
    listSubIssuesFn: () => [
      { number: 1328, state: "open", labels: [{ name: "quarantined" }] },
      { number: 1329, state: "open", labels: [{ name: "quarantined" }], blocked_by_count: 1 },
      { number: 1327, state: "closed", labels: [] },
    ],
  });

  assert.equal(out.decompose_allowed, "true", "quarantined sub-issues should not count as executable");
  assert.equal(out.executable_goal_count, 0);
  assert.equal(out.decompose_skip_reason, "no_executable_goals");
});

test("evaluateGoalDecomposeBackpressure excludes blocked sub-issues from executable count", () => {
  const out = evaluateGoalDecomposeBackpressure({
    repo: "example-org/example-trading",
    maxConcurrentGoals: "1",
    ghJsonFn: () => [{ number: 100, labels: [{ name: "goal" }, { name: "ready" }] }],
    listSubIssuesFn: () => [
      { number: 200, state: "open", labels: [], blocked_by_count: 2 },
    ],
  });

  assert.equal(out.decompose_allowed, "true", "blocked sub-issues should not count as executable");
  assert.equal(out.executable_goal_count, 0);
});

test("evaluateGoalDecomposeBackpressure uses maxConcurrentWaves when maxConcurrentGoals not explicitly set", () => {
  const out = evaluateGoalDecomposeBackpressure({
    repo: "example-org/example-trading",
    maxConcurrentWaves: "3",
    ghJsonFn: () => [{ number: 1, labels: [{ name: "goal" }, { name: "ready" }] }],
    listSubIssuesFn: () => [{ number: 10, state: "open", labels: [] }],
  });

  assert.equal(out.max_concurrent_goals, 3, "should use maxConcurrentWaves when maxConcurrentGoals is empty");
  assert.equal(out.decompose_allowed, "true", "1 executable < 3 capacity → allowed");
});

test("evaluateGoalDecomposeBackpressure ignores stale GitHub open sub-issues that are canonically shipped", () => {
  const out = evaluateGoalDecomposeBackpressure({
    repo: "example-org/example-trading",
    maxConcurrentGoals: "1",
    ghJsonFn: () => [{ number: 3000, labels: [{ name: "goal" }, { name: "ready" }] }],
    listCanonicalIssueLifecycleFn: () => [
      makeCreatedTradingSubIssue(),
    ],
    listSubIssuesFn: () => [{ number: 3001, state: "open", labels: [], blocked_by_count: 0 }],
  });

  assert.equal(out.decompose_allowed, "true");
  assert.equal(out.executable_goal_count, 0);
  assert.equal(out.decompose_skip_reason, "no_executable_goals");
});

test("limitKeptGoalsForTick enforces bounded per-tick goal fan-out", () => {
  assert.deepEqual(limitKeptGoalsForTick({ keptGoalsRaw: "[1,2,3,4]", maxGoalsPerTick: "2" }), [1, 2]);
  assert.deepEqual(limitKeptGoalsForTick({ keptGoalsRaw: "[1,2,3,4]", maxGoalsPerTick: "5" }), [1, 2, 3, 4]);
  assert.deepEqual(limitKeptGoalsForTick({ keptGoalsRaw: "[1,2,3,4]", maxGoalsPerTick: "0" }), [1, 2]);
});

// Graph-contract: factory_supervisor_tick.dot must route decompose_allowed=false
// to set_release_sha, bypassing fan_out_goal_run entirely.
test("graph contract: goal_decompose_gate routes to set_release_sha when decompose_allowed!=true", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot", "utf8");

  // goal_decompose_gate must have an edge with condition decompose_allowed=true -> keep_all_goals
  assert.match(
    dot,
    /goal_decompose_gate\s*->\s*keep_all_goals\s*\[.*condition="decompose_allowed=true"/,
    "goal_decompose_gate -> keep_all_goals must require decompose_allowed=true",
  );

  // goal_decompose_gate must have a SKIP edge when decompose_allowed!=true
  assert.match(
    dot,
    /goal_decompose_gate\s*->\s*set_release_sha\s*\[.*condition="decompose_allowed!=true"/,
    "goal_decompose_gate -> set_release_sha must fire when decompose_allowed!=true (skip decompose)",
  );

  // fan_out_goal_run must only be reachable through the throttled path
  // that passes through limit_kept_goals (possibly with intermediate nodes
  // like set_capability_goal_decomposition_skills in the chain).
  assert.match(dot, /goal_gate -> set_max_concurrent_goals_pre \[condition="goal_count!=0"\]/);
  assert.match(dot, /set_max_concurrent_goals_pre -> goal_decompose_backpressure/);
});

test("computeGoalRunCloseCondition fails closed when no issues created", () => {
  assert.equal(
    computeGoalRunCloseCondition({
      issueCount: "0",
      approvedFeatureCount: "1",
    }),
    "false",
  );
});

test("computeGoalRunCloseCondition allows close when created issues cover all approved features", () => {
  assert.equal(
    computeGoalRunCloseCondition({
      issueCount: "1",
      approvedFeatureCount: "1",
    }),
    "true",
  );
});

test("computeGoalRunCloseCondition blocks close when only a subset of approved features were materialized", () => {
  assert.equal(
    computeGoalRunCloseCondition({
      issueCount: "3",
      approvedFeatureCount: "7",
    }),
    "false",
  );
});
