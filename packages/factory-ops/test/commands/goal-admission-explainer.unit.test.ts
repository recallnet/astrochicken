import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { listExecutableGoals } from "../../src/commands/goal-list-executable.ts";

function makeGhJson({ goals = [], blockedByByGoal = {} } = {}) {
  return (args, fallback = []) => {
    if (args[0] === "issue" && args[1] === "list") {
      return goals;
    }
    if (args[0] === "api" && args[1] === "graphql") {
      const queryArg = args.find((entry) => String(entry).startsWith("query=")) || "";
      const matches = [...String(queryArg).matchAll(/i(\d+):\s*issue\(number:(\d+)\)/g)];
      const repository = {};
      for (const m of matches) {
        const issueNumber = Number(m[2]);
        repository[`i${issueNumber}`] = {
          blockedBy: { nodes: blockedByByGoal[issueNumber] || [] },
        };
      }
      return { data: { repository } };
    }
    return fallback;
  };
}

function makeRunsDir(activeGoalNumbers = []) {
  const tmp = mkdtempSync(join(tmpdir(), "goal-admission-"));
  for (const goalNum of activeGoalNumbers) {
    const runDir = join(tmp, `run-goal-${goalNum}`);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "state.json"), JSON.stringify({ status: "running" }));
    writeFileSync(join(runDir, "context.json"), JSON.stringify({ goal_issue_number: goalNum }));
  }
  return tmp;
}

describe("listExecutableGoals skipped_reasons", () => {
  it("returns active_run reason for goals with in-flight execution", () => {
    const runsDir = makeRunsDir([10]);
    const out = listExecutableGoals({
      repo: "o/r",
      runsDir,
      ghJsonFn: makeGhJson({
        goals: [
          { number: 10, title: "Active goal" },
          { number: 20, title: "Ready goal" },
        ],
      }),
      listSubIssuesFn: () => [{ state: "open" }],
    });

    assert.ok(Array.isArray(out.skipped_reasons), "skipped_reasons should be an array");
    const activeRun = out.skipped_reasons.find((r) => r.goal_number === 10);
    assert.ok(activeRun, "should have skipped reason for goal 10");
    assert.equal(activeRun.reason, "active_run");
  });

  it("returns blocked_by_open_issue reason for blocked goals", () => {
    const out = listExecutableGoals({
      repo: "o/r",
      ghJsonFn: makeGhJson({
        goals: [{ number: 30, title: "Blocked goal" }],
        blockedByByGoal: { 30: [{ number: 99, state: "OPEN" }] },
      }),
      listSubIssuesFn: () => [{ state: "open" }],
    });

    assert.ok(Array.isArray(out.skipped_reasons));
    const blocked = out.skipped_reasons.find((r) => r.goal_number === 30);
    assert.ok(blocked, "should have skipped reason for goal 30");
    assert.equal(blocked.reason, "blocked_by_open_issue");
  });

  it("returns quarantined_sub_issues reason when all open sub-issues are quarantined", () => {
    const out = listExecutableGoals({
      repo: "o/r",
      ghJsonFn: makeGhJson({
        goals: [{ number: 40, title: "Quarantined goal" }],
      }),
      listSubIssuesFn: () => [
        { state: "open", labels: [{ name: "quarantined" }] },
        { state: "open", labels: [{ name: "quarantined" }] },
      ],
    });

    assert.ok(Array.isArray(out.skipped_reasons));
    const quarantined = out.skipped_reasons.find((r) => r.goal_number === 40);
    assert.ok(quarantined, "should have skipped reason for goal 40");
    assert.equal(quarantined.reason, "quarantined_sub_issues");
  });

  it("returns no_dispatchable_sub_issues when all sub-issues are closed or blocked", () => {
    const out = listExecutableGoals({
      repo: "o/r",
      ghJsonFn: makeGhJson({
        goals: [{ number: 50, title: "No dispatch goal" }],
      }),
      listSubIssuesFn: () => [
        { state: "closed" },
        { state: "open", blocked_by_count: 1 },
      ],
    });

    assert.ok(Array.isArray(out.skipped_reasons));
    const noDispatch = out.skipped_reasons.find((r) => r.goal_number === 50);
    assert.ok(noDispatch, "should have skipped reason for goal 50");
    assert.equal(noDispatch.reason, "no_dispatchable_sub_issues");
  });

  it("does not return no_dispatchable_sub_issues for undecomposed ready goals with zero sub-issues", () => {
    const out = listExecutableGoals({
      repo: "o/r",
      ghJsonFn: makeGhJson({
        goals: [{ number: 55, title: "Fresh goal" }],
      }),
      listSubIssuesFn: () => [],
    });

    assert.deepEqual(out.executable_goals, [55]);
    const noDispatch = out.skipped_reasons.find((r) => r.goal_number === 55);
    assert.equal(noDispatch, undefined);
  });

  it("returns empty skipped_reasons when all goals are executable", () => {
    const out = listExecutableGoals({
      repo: "o/r",
      ghJsonFn: makeGhJson({
        goals: [{ number: 60, title: "Good goal" }],
      }),
      listSubIssuesFn: () => [{ state: "open" }],
    });

    assert.ok(Array.isArray(out.skipped_reasons));
    assert.equal(out.skipped_reasons.length, 0);
  });
});
