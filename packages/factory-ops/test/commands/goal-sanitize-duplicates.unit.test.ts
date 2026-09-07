import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeGoalDuplicates } from "../../src/commands/goal-sanitize-duplicates.ts";

test("sanitizeGoalDuplicates never auto-closes duplicate goal issues", () => {
  const ghCalls = [];
  const out = sanitizeGoalDuplicates({
    repo: "example-org/example-trading",
    ghJsonFn: (args) => {
      assert.deepEqual(args, [
        "issue", "list", "--repo", "example-org/example-trading", "--state", "all", "--label", "goal", "--limit", "200",
        "--json", "number,title,body,state,labels",
      ]);
      return [
        {
          number: 1212,
          title: "Goal: Upgrade Example Trading shared packages",
          body: "canonical body",
          state: "CLOSED",
          labels: [{ name: "goal" }, { name: "ready" }],
        },
        {
          number: 1393,
          title: "Goal: Upgrade Example Trading shared packages",
          body: "duplicate body",
          state: "OPEN",
          labels: [{ name: "goal" }, { name: "ready" }],
        },
      ];
    },
    ghFn: (args) => {
      ghCalls.push(args);
      return { ok: true };
    },
    emitSupervisorArtifactFn: () => ({ issue_url: "", error: "" }),
  });

  assert.equal(out.closed_count, 0);
  assert.deepEqual(out.closed, []);
  assert.equal(out.summary, "Goal duplicate clean.");
  assert.deepEqual(ghCalls, []);
});

test("sanitizeGoalDuplicates never auto-closes duplicate bug issues", () => {
  const ghCalls = [];
  const out = sanitizeGoalDuplicates({
    repo: "example-org/example-trading",
    ghJsonFn: () => ([
      {
        number: 800,
        title: "[bug] reward band drift",
        body: "canonical bug body",
        state: "CLOSED",
        labels: [{ name: "bug" }],
      },
      {
        number: 900,
        title: "[bug] reward band drift",
        body: "newly reissued bug body",
        state: "OPEN",
        labels: [{ name: "bug" }],
      },
    ]),
    ghFn: (args) => {
      ghCalls.push(args);
      return { ok: true };
    },
    emitSupervisorArtifactFn: () => ({ issue_url: "", error: "" }),
  });

  assert.equal(out.closed_count, 0);
  assert.deepEqual(out.closed, []);
  assert.equal(out.summary, "Goal duplicate clean.");
  assert.deepEqual(ghCalls, []);
});

test("sanitizeGoalDuplicates still ignores already-closed issues", () => {
  const ghCalls = [];
  const out = sanitizeGoalDuplicates({
    repo: "example-org/example-trading",
    ghJsonFn: () => ([
      {
        number: 1212,
        title: "Goal: Upgrade Example Trading shared packages",
        body: "",
        state: "CLOSED",
        labels: [{ name: "goal" }],
      },
      {
        number: 1393,
        title: "Goal: Upgrade Example Trading shared packages",
        body: "",
        state: "CLOSED",
        labels: [{ name: "goal" }],
      },
    ]),
    ghFn: (args) => {
      ghCalls.push(args);
      return { ok: true };
    },
    emitSupervisorArtifactFn: () => ({ issue_url: "", error: "" }),
  });

  assert.equal(out.closed_count, 0);
  assert.deepEqual(out.closed, []);
  assert.deepEqual(ghCalls, []);
});
