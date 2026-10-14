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

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sweepCompletedGoals } from "../../src/commands/goal-sweep-completed.ts";

function makeGithubAdapter(goals = []) {
  const calls = [];
  const issueViews = [];
  return {
    issueList: (args) => {
      calls.push(args);
      return goals;
    },
    issueView: ({ number }) => {
      issueViews.push({ number });
      return goals.find((goal) => Number(goal?.number) === Number(number)) || {};
    },
    calls,
    issueViews,
  };
}

function makeReconcileFn(results = {}) {
  const calls = [];
  return {
    fn: ({ repo, repoRoot, goalNumber, runsDir }) => {
      calls.push({ repo, repoRoot, goalNumber, runsDir });
      if (results[goalNumber]?.throw) throw new Error(results[goalNumber].throw);
      return results[goalNumber] || { closedGoal: false };
    },
    calls,
  };
}

function makeCanonicalGoalCandidates(candidates = []) {
  const calls = [];
  return {
    fn: ({ factoryId, repo }) => {
      calls.push({ factoryId, repo });
      return candidates;
    },
    calls,
  };
}

describe("sweepCompletedGoals", () => {
  it("returns empty result when repo is missing", async () => {
    const result = await sweepCompletedGoals();
    assert.deepStrictEqual(result, { swept: 0, closed: [], skipped: [], errors: [] });
  });

  it("returns empty result when repo is undefined", async () => {
    const result = await sweepCompletedGoals({ repo: undefined });
    assert.deepStrictEqual(result, { swept: 0, closed: [], skipped: [], errors: [] });
  });

  it("returns swept 0 when no open goals exist", async () => {
    const githubAdapter = makeGithubAdapter([]);
    const reconcile = makeReconcileFn();
    const result = await sweepCompletedGoals({ repo: "org/repo", githubAdapter, reconcileFn: reconcile.fn });
    assert.equal(result.swept, 0);
    assert.deepStrictEqual(result.closed, []);
    assert.deepStrictEqual(result.skipped, []);
    assert.deepStrictEqual(result.errors, []);
    assert.equal(reconcile.calls.length, 0);
  });

  it("sweeps canonically known goals even when GitHub open-goal listing is empty", async () => {
    const githubAdapter = makeGithubAdapter([]);
    const reconcile = makeReconcileFn({ 1789: { closedGoal: true } });
    const canonicalCandidates = makeCanonicalGoalCandidates([{ goal_number: "1789" }]);

    const result = await sweepCompletedGoals({
      repo: "org/repo",
      factoryId: "example-trading",
      githubAdapter,
      reconcileFn: reconcile.fn,
      listCanonicalGoalCandidatesFn: canonicalCandidates.fn,
    });

    assert.equal(result.swept, 1);
    assert.deepStrictEqual(result.closed, [{ number: 1789, title: "#1789" }]);
    assert.equal(githubAdapter.calls.length, 0, "canonical sweep must not depend on GitHub open-goal listing");
    assert.deepStrictEqual(githubAdapter.issueViews, [{ number: 1789 }]);
    assert.deepStrictEqual(canonicalCandidates.calls, [{ factoryId: "example-trading", repo: "org/repo" }]);
  });

  it("deduplicates canonical and GitHub goal candidates by goal number", async () => {
    const githubAdapter = makeGithubAdapter([{ number: 1789, title: "Goal A", labels: [] }]);
    const reconcile = makeReconcileFn({ 1789: { closedGoal: false } });
    const canonicalCandidates = makeCanonicalGoalCandidates([{ goal_number: "1789" }]);

    const result = await sweepCompletedGoals({
      repo: "org/repo",
      factoryId: "example-trading",
      githubAdapter,
      reconcileFn: reconcile.fn,
      listCanonicalGoalCandidatesFn: canonicalCandidates.fn,
    });

    assert.equal(result.swept, 1);
    assert.equal(reconcile.calls.length, 1);
    assert.deepStrictEqual(result.skipped, [{ number: 1789, title: "Goal A", reason: "not_all_work_done" }]);
  });

  it("puts goal in closed array when reconcile closes it", async () => {
    const githubAdapter = makeGithubAdapter([{ number: 10, title: "Goal A", labels: [] }]);
    const reconcile = makeReconcileFn({ 10: { closedGoal: true } });
    const result = await sweepCompletedGoals({ repo: "org/repo", githubAdapter, reconcileFn: reconcile.fn });
    assert.equal(result.swept, 1);
    assert.deepStrictEqual(result.closed, [{ number: 10, title: "Goal A" }]);
    assert.deepStrictEqual(result.skipped, []);
  });

  it("puts goal in skipped array with default reason when reconcile does not close it", async () => {
    const githubAdapter = makeGithubAdapter([{ number: 20, title: "Goal B", labels: [] }]);
    const reconcile = makeReconcileFn({ 20: { closedGoal: false } });
    const result = await sweepCompletedGoals({ repo: "org/repo", githubAdapter, reconcileFn: reconcile.fn });
    assert.equal(result.swept, 1);
    assert.deepStrictEqual(result.closed, []);
    assert.deepStrictEqual(result.skipped, [{ number: 20, title: "Goal B", reason: "not_all_work_done" }]);
  });

  it("preserves skippedGoalClosureReason when provided", async () => {
    const githubAdapter = makeGithubAdapter([{ number: 30, title: "Goal C", labels: [] }]);
    const reconcile = makeReconcileFn({ 30: { closedGoal: false, skippedGoalClosureReason: "sub_issues_still_open" } });
    const result = await sweepCompletedGoals({ repo: "org/repo", githubAdapter, reconcileFn: reconcile.fn });
    assert.deepStrictEqual(result.skipped, [{ number: 30, title: "Goal C", reason: "sub_issues_still_open" }]);
  });

  it("handles multiple goals with mixed results", async () => {
    const goals = [
      { number: 1, title: "Closed Goal", labels: [] },
      { number: 2, title: "Skipped Goal", labels: [] },
      { number: 3, title: "Another Closed", labels: [] },
    ];
    const githubAdapter = makeGithubAdapter(goals);
    const reconcile = makeReconcileFn({
      1: { closedGoal: true },
      2: { closedGoal: false },
      3: { closedGoal: true },
    });
    const result = await sweepCompletedGoals({ repo: "org/repo", githubAdapter, reconcileFn: reconcile.fn });
    assert.equal(result.swept, 3);
    assert.equal(result.closed.length, 2);
    assert.equal(result.skipped.length, 1);
    assert.deepStrictEqual(result.closed[0], { number: 1, title: "Closed Goal" });
    assert.deepStrictEqual(result.closed[1], { number: 3, title: "Another Closed" });
    assert.deepStrictEqual(result.skipped[0], { number: 2, title: "Skipped Goal", reason: "not_all_work_done" });
  });

  it("captures errors without stopping the sweep", async () => {
    const goals = [
      { number: 5, title: "Exploding Goal", labels: [] },
      { number: 6, title: "Good Goal", labels: [] },
    ];
    const githubAdapter = makeGithubAdapter(goals);
    const reconcile = makeReconcileFn({
      5: { throw: "boom" },
      6: { closedGoal: true },
    });
    const result = await sweepCompletedGoals({ repo: "org/repo", githubAdapter, reconcileFn: reconcile.fn });
    assert.equal(result.swept, 2);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].number, 5);
    assert.equal(result.errors[0].error, "boom");
    assert.equal(result.closed.length, 1);
    assert.deepStrictEqual(result.closed[0], { number: 6, title: "Good Goal" });
  });

  it("swept equals total open goals even when some error", async () => {
    const goals = [
      { number: 7, title: "G1", labels: [] },
      { number: 8, title: "G2", labels: [] },
      { number: 9, title: "G3", labels: [] },
    ];
    const githubAdapter = makeGithubAdapter(goals);
    const reconcile = makeReconcileFn({
      7: { closedGoal: true },
      8: { throw: "fail" },
      9: { closedGoal: false },
    });
    const result = await sweepCompletedGoals({ repo: "org/repo", githubAdapter, reconcileFn: reconcile.fn });
    assert.equal(result.swept, 3);
    assert.equal(result.closed.length + result.skipped.length + result.errors.length, 3);
  });

  it("passes repo and goalNumber to reconcileFn", async () => {
    const githubAdapter = makeGithubAdapter([{ number: 42, title: "T", labels: [] }]);
    const reconcile = makeReconcileFn({ 42: { closedGoal: false } });
    await sweepCompletedGoals({
      repo: "org/my-repo",
      repoRoot: "/srv/astrochicken",
      runsDir: "/tmp/runs",
      githubAdapter,
      reconcileFn: reconcile.fn,
    });
    assert.equal(reconcile.calls.length, 1);
    assert.deepStrictEqual(reconcile.calls[0], {
      repo: "org/my-repo",
      repoRoot: "/srv/astrochicken",
      goalNumber: 42,
      runsDir: "/tmp/runs",
    });
  });

  it("lists open goals through the GitHub adapter boundary", async () => {
    const githubAdapter = makeGithubAdapter([]);
    const reconcile = makeReconcileFn();
    await sweepCompletedGoals({ repo: "org/target", githubAdapter, reconcileFn: reconcile.fn });
    assert.equal(githubAdapter.calls.length, 1);
    assert.deepStrictEqual(githubAdapter.calls[0], {
      state: "open",
      labels: ["goal"],
      limit: 100,
      fields: "number,title,labels",
    });
  });

  // @context:regression !critical reconcileGoalFinalState is async. If the sweep
  // does not await it, result.closedGoal is undefined (Promise property access)
  // and the sweep always reports "not_all_work_done" even when the goal is closable.
  // This caused example-trading #1942 to stay open despite all 6 sub-issues being closed.
  it("correctly handles async reconcileFn that returns a Promise", async () => {
    const githubAdapter = makeGithubAdapter([{ number: 50, title: "Async Goal", labels: [] }]);
    const asyncReconcileFn = async ({ goalNumber }) => {
      return { closedGoal: true, skippedGoalClosureReason: "" };
    };
    const result = await sweepCompletedGoals({ repo: "org/repo", githubAdapter, reconcileFn: asyncReconcileFn });
    assert.equal(result.swept, 1);
    assert.deepStrictEqual(result.closed, [{ number: 50, title: "Async Goal" }]);
    assert.deepStrictEqual(result.skipped, []);
  });

  it("correctly skips async reconcileFn that resolves to not-closed", async () => {
    const githubAdapter = makeGithubAdapter([{ number: 60, title: "Not Done", labels: [] }]);
    const asyncReconcileFn = async ({ goalNumber }) => {
      return { closedGoal: false, skippedGoalClosureReason: "sub_issues_still_open" };
    };
    const result = await sweepCompletedGoals({ repo: "org/repo", githubAdapter, reconcileFn: asyncReconcileFn });
    assert.equal(result.swept, 1);
    assert.deepStrictEqual(result.closed, []);
    assert.deepStrictEqual(result.skipped, [{ number: 60, title: "Not Done", reason: "sub_issues_still_open" }]);
  });

  it("captures rejected async reconcileFn as errors", async () => {
    const githubAdapter = makeGithubAdapter([{ number: 70, title: "Exploding Async", labels: [] }]);
    const asyncReconcileFn = async () => { throw new Error("async boom"); };
    const result = await sweepCompletedGoals({ repo: "org/repo", githubAdapter, reconcileFn: asyncReconcileFn });
    assert.equal(result.swept, 1);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].error, "async boom");
  });

  // Regression: sweep must NOT set allSubIssueExecutionsCompleted=true.
  // Doing so causes the sweep to close sub-issues of freshly-decomposed
  // goals that haven't been executed yet (example-trading #1748-#1758 incident).
  it("does NOT pass allSubIssueExecutionsCompleted to reconcileFn", async () => {
    const githubAdapter = makeGithubAdapter([{ number: 99, title: "Fresh goal", labels: [] }]);
    const calls = [];
    const reconcileFn = (opts) => {
      calls.push(opts);
      return { closedGoal: false };
    };
    await sweepCompletedGoals({ repo: "org/repo", runsDir: "/tmp/runs", githubAdapter, reconcileFn });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].allSubIssueExecutionsCompleted,
      undefined,
      "sweep must not set allSubIssueExecutionsCompleted — it has no knowledge of execution state",
    );
  });
});
