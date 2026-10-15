import { before, after } from "node:test";
import { createCanonicalEventStoreFixture } from "../supervisor/factory-status-postgres-fixture.ts";

// Canonical lifecycle reads use a disposable database, never a host service.
const eventStoreFixture = createCanonicalEventStoreFixture();
const previousEventStoreUrl = process.env.HATCH_CANONICAL_EVENT_STORE_URL;
before(async () => {
  await eventStoreFixture.setup();
  process.env.HATCH_CANONICAL_EVENT_STORE_URL = eventStoreFixture.connectionString;
});
after(() => {
  if (previousEventStoreUrl === undefined) delete process.env.HATCH_CANONICAL_EVENT_STORE_URL;
  else process.env.HATCH_CANONICAL_EVENT_STORE_URL = previousEventStoreUrl;
  eventStoreFixture.teardown();
});

import assert from "node:assert/strict";
import test from "node:test";

import { sweepCompletedGoals } from "../../src/commands/goal-sweep-completed.ts";

test("sweepCompletedGoals returns empty result with no repo", async () => {
  const out = await sweepCompletedGoals({ repo: "" });
  assert.equal(out.swept, 0);
  assert.deepEqual(out.closed, []);
  assert.deepEqual(out.skipped, []);
  assert.deepEqual(out.errors, []);
});

test("sweepCompletedGoals closes goals when reconcile reports closure", async () => {
  const fakeGoals = [
    { number: 324, title: "Goal A" },
    { number: 542, title: "Goal B" },
  ];
  const githubAdapter = { issueList: () => fakeGoals };
  const reconcileFn = ({ goalNumber }) => {
    if (goalNumber === 324) return { closedGoal: true, goalNumber: "324", skippedGoalClosureReason: "", hasSubIssues: true, anyOpenSubIssues: false };
    return { closedGoal: false, goalNumber: "542", skippedGoalClosureReason: "", hasSubIssues: true, anyOpenSubIssues: true };
  };

  const out = await sweepCompletedGoals({ repo: "test/repo", githubAdapter, reconcileFn });
  assert.equal(out.swept, 2);
  assert.equal(out.closed.length, 1);
  assert.equal(out.closed[0].number, 324);
  assert.equal(out.skipped.length, 1);
  assert.equal(out.skipped[0].number, 542);
  assert.equal(out.skipped[0].reason, "not_all_work_done");
});

test("sweepCompletedGoals captures reconcile errors without crashing", async () => {
  const fakeGoals = [{ number: 999, title: "Goal Broken" }];
  const githubAdapter = { issueList: () => fakeGoals };
  const reconcileFn = () => { throw new Error("gh command failed"); };

  const out = await sweepCompletedGoals({ repo: "test/repo", githubAdapter, reconcileFn });
  assert.equal(out.swept, 1);
  assert.equal(out.closed.length, 0);
  assert.equal(out.skipped.length, 0);
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].number, 999);
  assert.match(out.errors[0].error, /gh command failed/);
});

test("sweepCompletedGoals handles empty goal list", async () => {
  const githubAdapter = { issueList: () => [] };
  const out = await sweepCompletedGoals({ repo: "test/repo", githubAdapter });
  assert.equal(out.swept, 0);
  assert.deepEqual(out.closed, []);
});

test("sweepCompletedGoals closes a decomposed goal with all sub-issues done", async () => {
  const fakeGoals = [
    {
      number: 1592,
      title: "Goal Closed But Stranded",
      labels: [{ name: "goal" }],
    },
  ];
  const githubAdapter = { issueList: () => fakeGoals };
  const reconcileFn = () => ({
    closedGoal: true,
    goalNumber: "1592",
    skippedGoalClosureReason: "",
    hasSubIssues: true,
    anyOpenSubIssues: false,
  });

  const out = await sweepCompletedGoals({ repo: "test/repo", githubAdapter, reconcileFn });
  assert.equal(out.swept, 1);
  assert.deepEqual(out.closed, [{ number: 1592, title: "Goal Closed But Stranded" }]);
});

test("sweepCompletedGoals leaves active goals untouched when sub-issues remain open", async () => {
  const fakeGoals = [{ number: 1581, title: "Goal Active But Drifted", labels: [{ name: "goal" }] }];
  const githubAdapter = { issueList: () => fakeGoals };
  const reconcileFn = () => ({
    closedGoal: false,
    goalNumber: "1581",
    skippedGoalClosureReason: "not_all_work_done",
    hasSubIssues: true,
    anyOpenSubIssues: true,
  });

  const out = await sweepCompletedGoals({ repo: "test/repo", githubAdapter, reconcileFn });
  assert.equal(out.swept, 1);
  assert.deepEqual(out.closed, []);
  assert.deepEqual(out.skipped, [{ number: 1581, title: "Goal Active But Drifted", reason: "not_all_work_done" }]);
});
