import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { listExecutableGoals } from "../../src/commands/goal-list-executable.ts";

function makeGhJson(goals = []) {
  return (args, fallback = []) => {
    if (args[0] === "issue" && args[1] === "list") {
      return goals;
    }

    if (args[0] === "api" && args[1] === "graphql") {
      return {
        data: {
          repository: {
            issue: {
              blockedBy: {
                nodes: [],
              },
            },
          },
        },
      };
    }

    return fallback;
  };
}

function setupRunsDir(runs) {
  const runsDir = mkdtempSync(join(tmpdir(), "goal-dedup-"));
  for (const run of runs) {
    const runDir = join(runsDir, run.id);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "state.json"), JSON.stringify({ status: run.status, graph: run.graph || "goal_execute.dot" }));
    writeFileSync(join(runDir, "context.json"), JSON.stringify({ goal_issue_number: run.goal }));
  }
  return runsDir;
}

const fakeGh = () => [
  { number: 2005, title: "Goal A" },
  { number: 2036, title: "Goal B" },
  { number: 2050, title: "Goal C" },
];

const fakeSubIssues = () => [{ number: 100, state: "open" }];

test("excludes goals that already have active goal_execute runs", () => {
  const runsDir = setupRunsDir([
    { id: "run-aaa", status: "running", goal: 2005 },
    { id: "run-bbb", status: "running", goal: 2036 },
  ]);

  const result = listExecutableGoals({
    repo: "test/repo",
    runsDir,
    ghJsonFn: makeGhJson(fakeGh()),
    listSubIssuesFn: fakeSubIssues,
  });

  assert.deepStrictEqual(result.executable_goals, [2050]);
  assert.deepStrictEqual(result.goal_execution_paths, { "2050": "unknown" });
  assert.equal(result.count, 1);
});

test("excludes goals with suspended goal_execute runs", () => {
  const runsDir = setupRunsDir([
    { id: "run-ccc", status: "suspended", goal: 2005 },
  ]);

  const result = listExecutableGoals({
    repo: "test/repo",
    runsDir,
    ghJsonFn: makeGhJson(fakeGh()),
    listSubIssuesFn: fakeSubIssues,
  });

  assert.deepStrictEqual(result.executable_goals, [2036, 2050]);
  assert.deepStrictEqual(result.goal_execution_paths, { "2036": "unknown", "2050": "unknown" });
  assert.equal(result.count, 2);
});

test("does not exclude goals with completed or failed runs", () => {
  const runsDir = setupRunsDir([
    { id: "run-ddd", status: "completed", goal: 2005 },
    { id: "run-eee", status: "failed", goal: 2036 },
  ]);

  const result = listExecutableGoals({
    repo: "test/repo",
    runsDir,
    ghJsonFn: makeGhJson(fakeGh()),
    listSubIssuesFn: fakeSubIssues,
  });

  assert.deepStrictEqual(result.executable_goals, [2005, 2036, 2050]);
  assert.deepStrictEqual(result.goal_execution_paths, { "2005": "unknown", "2036": "unknown", "2050": "unknown" });
  assert.equal(result.count, 3);
});

test("works without runsDir (backwards compatible)", () => {
  const result = listExecutableGoals({
    repo: "test/repo",
    ghJsonFn: makeGhJson(fakeGh()),
    listSubIssuesFn: fakeSubIssues,
  });

  assert.deepStrictEqual(result.executable_goals, [2005, 2036, 2050]);
  assert.deepStrictEqual(result.goal_execution_paths, { "2005": "unknown", "2036": "unknown", "2050": "unknown" });
  assert.equal(result.count, 3);
});

test("reports skipped_active goals in output", () => {
  const runsDir = setupRunsDir([
    { id: "run-fff", status: "running", goal: 2005 },
    { id: "run-ggg", status: "running", goal: 2036 },
  ]);

  const result = listExecutableGoals({
    repo: "test/repo",
    runsDir,
    ghJsonFn: makeGhJson(fakeGh()),
    listSubIssuesFn: fakeSubIssues,
  });

  assert.deepStrictEqual(result.executable_goals, [2050]);
  assert.deepStrictEqual(result.goal_execution_paths, { "2050": "unknown" });
  assert.deepStrictEqual(result.skipped_active, [2005, 2036]);
});

test("uses free capacity after active goal runs are counted", () => {
  const runsDir = setupRunsDir([
    { id: "run-active-1", status: "running", goal: 2005 },
    { id: "run-active-2", status: "running", goal: 2036 },
  ]);

  const result = listExecutableGoals({
    repo: "test/repo",
    runsDir,
    maxConcurrent: 3,
    ghJsonFn: makeGhJson(fakeGh()),
    listSubIssuesFn: fakeSubIssues,
  });

  assert.equal(result.execution_capacity, 3);
  assert.equal(result.active_goal_count, 2);
  assert.equal(result.free_slots, 1);
  assert.equal(result.count, 1);
  assert.equal(result.capped, false);
  assert.deepStrictEqual(result.executable_goals, [2050]);
});

test("returns no executable goals when active runs already consume capacity", () => {
  const runsDir = setupRunsDir([
    { id: "run-active-1", status: "running", goal: 2005 },
    { id: "run-active-2", status: "running", goal: 2036 },
    { id: "run-active-3", status: "running", goal: 2050 },
  ]);

  const result = listExecutableGoals({
    repo: "test/repo",
    runsDir,
    maxConcurrent: 3,
    ghJsonFn: makeGhJson(fakeGh()),
    listSubIssuesFn: fakeSubIssues,
  });

  assert.equal(result.execution_capacity, 3);
  assert.equal(result.active_goal_count, 3);
  assert.equal(result.free_slots, 0);
  assert.equal(result.count, 0);
  assert.equal(result.capped, false);
  assert.deepStrictEqual(result.executable_goals, []);
});
