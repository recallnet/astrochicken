/**
 * Factory Supervisor Throttle Tests
 *
 * T1: No decomposition when factory health is locally_unhealthy (todo)
 *     - Currently the tick checks health only at the END (supervisor_health node),
 *       not before goal decomposition. Needs a real signal to gate on.
 *
 * T2: Executable-goal saturation blocks fresh goal intake (implemented)
 *     - evaluateGoalDecomposeBackpressure now counts ready goals with open
 *       sub-issues. If executable goals >= max_concurrent_waves, decomposition is blocked.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SimulatedRepo, buildMocks, seedGoalWithWave } from "./factory-simulation-helpers.ts";
import { evaluateGoalDecomposeBackpressure, limitKeptGoalsForTick } from "../../src/commands/goal-queue-ops.ts";

// ─── T1: No decomposition when locally_unhealthy ────────────────────────────

test.todo("T1: factory_supervisor_tick.dot must gate goal decomposition on factory health");
test.todo("T1b: locally_unhealthy factory still decomposes goals (proves missing gate)");

// ─── T2: Dispatched-goal saturation blocks fresh intake ─────────────────────

test("T2: executable-goal saturation blocks decomposition when active goals fill slots", () => {
  const repo = new SimulatedRepo();
  const mocks = buildMocks(repo);

  // Already-active work: 5 ready goals with open features and milestones.
  for (let i = 0; i < 5; i++) {
    seedGoalWithWave(repo, 1, 3);
  }

  // 1 wave marker (below capacity), but 5 milestones with open features.
  repo.createIssue({ title: "Wave Ready: goal-1-wave-1", labels: ["ready"], milestone: "goal-1-wave-1" });

  // Sanity checks.
  const readyGoals = repo.listIssues({ state: "open", label: "ready" }).filter((issue) =>
    issue.labels.some((label) => label.name === "goal")
  );
  const openFeatures = repo.listIssues({ state: "open", label: "feature" });
  assert.equal(readyGoals.length, 5, "sanity: 5 ready goals");
  assert.equal(openFeatures.length, 15, "sanity: 15 open features");

  // Backpressure should block: 5 executable goals >= max_concurrent_waves=3.
  const backpressure = evaluateGoalDecomposeBackpressure({
    repo: "recallnet/astrochicken",
    maxConcurrentWaves: "3",
    ghJsonFn: mocks.ghJsonFn,
    listSubIssuesFn: () => [{ state: "open" }],
  });

  assert.equal(backpressure.decompose_allowed, "false",
    "With 5 executable goals and max_concurrent_waves=3, decomposition must be blocked");
  assert.equal(backpressure.decompose_skip_reason, "goal_execution_backlog_at_or_above_capacity");
  assert.equal(backpressure.executable_goal_count, 5);
});

test("T2b: backpressure allows decomposition when executable goals below capacity", () => {
  const repo = new SimulatedRepo();
  const mocks = buildMocks(repo);

  // Only 2 ready goals with executable work.
  seedGoalWithWave(repo, 1, 3);
  seedGoalWithWave(repo, 1, 3);

  // 2 executable goals < max_concurrent_waves=3 → allowed.
  const backpressure = evaluateGoalDecomposeBackpressure({
    repo: "recallnet/astrochicken",
    maxConcurrentWaves: "3",
    ghJsonFn: mocks.ghJsonFn,
    listSubIssuesFn: () => [{ state: "open" }],
  });

  assert.equal(backpressure.decompose_allowed, "true");
  assert.equal(backpressure.executable_goal_count, 2);
});
