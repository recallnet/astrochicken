import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBrainstormIntakeContext,
  listOpenBrainstormIssues,
  nextBrainstormIssue,
  selectNextBrainstormIssue,
} from "../../src/commands/brainstorm-next-issue.ts";

function makeGhJsonStub({ openBrainstorm = [], closedGoals = [], openBacklog = [] } = {}) {
  return (args) => {
    if (args.includes("--state") && args.includes("open") && args.includes("--label") && args.includes("brainstorm")) {
      return openBrainstorm;
    }
    if (args.includes("--state") && args.includes("closed") && args.includes("--label") && args.includes("goal")) {
      return closedGoals;
    }
    if (args.includes("--state") && args.includes("open") && !args.includes("--label")) {
      return openBacklog;
    }
    throw new Error(`unexpected_gh_json_call:${args.join(" ")}`);
  };
}

test("listOpenBrainstormIssues sorts by ascending issue number", () => {
  const ghJsonFn = makeGhJsonStub({
    openBrainstorm: [
      { number: 44, title: "later", body: "b" },
      { number: 12, title: "earlier", body: "a" },
    ],
  });

  const out = listOpenBrainstormIssues({
    repo: "recallnet/astrochicken",
    label: "brainstorm",
    ghJsonFn,
  });

  assert.deepEqual(out.map((item) => item.issue_number), ["12", "44"]);
});

test("selectNextBrainstormIssue deterministically picks lowest issue number", () => {
  const out = selectNextBrainstormIssue({
    issues: [
      { number: 19, title: "nineteen", body: "b" },
      { number: 7, title: "seven", body: "a" },
      { number: 18, title: "eighteen", body: "c" },
    ],
  });

  assert.equal(out.issue_number, "7");
  assert.equal(out.issue_body, "a");
});

test("nextBrainstormIssue returns has_issue=false with empty issue fields when none are open", () => {
  const ghJsonFn = makeGhJsonStub({
    openBrainstorm: [],
    closedGoals: [],
    openBacklog: [],
  });

  const out = nextBrainstormIssue({
    repo: "recallnet/astrochicken",
    label: "brainstorm",
    factoryId: "brainstorm",
    rootDir: ".",
    ghJsonFn,
    readCursorFn: () => null,
  });

  assert.equal(out.has_issue, false);
  assert.equal(out.brainstorm_issue_number, "");
  assert.equal(out.brainstorm_issue_body, "");
  assert.equal(out.shipped_goals_since_last, "[]");
  assert.equal(out.scenario_holdouts, "[]");
  assert.equal(out.open_backlog_summary, JSON.stringify({
    open_total: 0,
    open_goal_count: 0,
    open_ready_goal_count: 0,
    open_feature_count: 0,
    open_bug_count: 0,
    open_brainstorm_count: 0,
  }));
});

test("nextBrainstormIssue includes deterministic context payload fields", () => {
  const ghJsonFn = makeGhJsonStub({
    openBrainstorm: [
      { number: 19, title: "second", body: "seed B" },
      { number: 11, title: "first", body: "seed A" },
    ],
    closedGoals: [
      { number: 9, title: "old goal", url: "https://github.com/recallnet/astrochicken/issues/9", closedAt: "2026-03-01T00:00:00Z" },
      { number: 15, title: "new goal", url: "https://github.com/recallnet/astrochicken/issues/15", closedAt: "2026-03-02T00:00:00Z" },
    ],
    openBacklog: [
      { number: 11, state: "open", labels: [{ name: "brainstorm" }] },
      { number: 20, state: "open", labels: [{ name: "goal" }] },
      { number: 21, state: "open", labels: [{ name: "goal" }, { name: "ready" }] },
      { number: 22, state: "open", labels: [{ name: "feature" }] },
      { number: 23, state: "open", labels: [{ name: "bug" }] },
    ],
  });

  const out = nextBrainstormIssue({
    repo: "recallnet/astrochicken",
    label: "brainstorm",
    factoryId: "brainstorm",
    rootDir: ".",
    ghJsonFn,
    readCursorFn: () => ({
      schema: "brainstorm-cursor/v1",
      last_brainstorm_issue_number: "10",
      scenario_holdouts_snapshot: '["scenario-b","scenario-a"]',
    }),
  });

  assert.equal(out.has_issue, true);
  assert.equal(out.brainstorm_issue_number, "11");
  assert.equal(out.brainstorm_issue_body, "seed A");

  const shippedGoals = JSON.parse(out.shipped_goals_since_last);
  assert.deepEqual(shippedGoals, [{
    issue_number: "15",
    issue_title: "new goal",
    issue_url: "https://github.com/recallnet/astrochicken/issues/15",
    closed_at: "2026-03-02T00:00:00Z",
  }]);

  const backlogSummary = JSON.parse(out.open_backlog_summary);
  assert.deepEqual(backlogSummary, {
    open_total: 5,
    open_goal_count: 2,
    open_ready_goal_count: 1,
    open_feature_count: 1,
    open_bug_count: 1,
    open_brainstorm_count: 1,
  });

  const holdouts = JSON.parse(out.scenario_holdouts);
  assert.deepEqual(holdouts, ["scenario-a", "scenario-b"]);
});

test("buildBrainstormIntakeContext fails closed on malformed cursor scenario holdouts", () => {
  const ghJsonFn = makeGhJsonStub();
  assert.throws(() => buildBrainstormIntakeContext({
    repo: "recallnet/astrochicken",
    issue: null,
    ghJsonFn,
    readCursorFn: () => ({
      schema: "brainstorm-cursor/v1",
      scenario_holdouts_snapshot: "{not-json",
    }),
  }), /brainstorm_next_issue:malformed_cursor_scenario_holdouts/);
});

test("nextBrainstormIssue fails closed on malformed issue payload", () => {
  const ghJsonFn = makeGhJsonStub({
    openBrainstorm: [{ number: null, title: "bad", body: "bad" }],
  });

  assert.throws(() => nextBrainstormIssue({
    repo: "recallnet/astrochicken",
    ghJsonFn,
    readCursorFn: () => null,
  }), /brainstorm_next_issue:malformed_issue_number/);
});
