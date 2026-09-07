import assert from "node:assert/strict";
import test from "node:test";

import { detectStuckGoals } from "../../src/commands/supervisor-goal-liveness.ts";

test("detectStuckGoals flags goal with all features blocked/deferred", () => {
  const goals = [{ number: 335, title: "Goal: Inline Script Extraction" }];
  const features = [
    { number: 433, milestone: { title: "goal-335-deferred" }, labels: [{ name: "feature" }, { name: "deferred" }] },
    { number: 434, milestone: { title: "goal-335-deferred" }, labels: [{ name: "feature" }, { name: "deferred" }] },
  ];
  const milestones = [{ title: "goal-335-deferred" }];
  const items = detectStuckGoals({ goals, features, milestones });
  assert.equal(items.length, 1);
  assert.equal(items[0].issue, 335);
  assert.match(items[0].problem, /no actionable features/);
});

test("detectStuckGoals does not flag goal with accepted features", () => {
  const goals = [{ number: 100, title: "Goal: Something" }];
  const features = [
    { number: 50, milestone: { title: "goal-100-wave-1" }, labels: [{ name: "feature" }, { name: "triaged" }] },
  ];
  const milestones = [{ title: "goal-100-wave-1" }];
  const items = detectStuckGoals({ goals, features, milestones });
  assert.equal(items.length, 0);
});

test("detectStuckGoals does NOT flag backlog goal with zero features and zero milestones", () => {
  // A goal with no milestones is in the backlog — never decomposed, not stuck
  const goals = [{ number: 200, title: "Goal: Empty" }];
  const features = [];
  const milestones = [];
  const items = detectStuckGoals({ goals, features, milestones });
  assert.equal(items.length, 0, "backlog goals must not be flagged");
});

test("detectStuckGoals flags decomposed goal with milestones but zero features", () => {
  // A goal that WAS decomposed (milestones exist) but lost all features IS stuck
  const goals = [{ number: 200, title: "Goal: Decomposed But Empty" }];
  const features = [];
  const milestones = [{ title: "goal-200-wave-1", open_issues: 0, closed_issues: 0 }];
  const items = detectStuckGoals({ goals, features, milestones });
  assert.equal(items.length, 1);
  assert.equal(items[0].issue, 200);
});

test("detectStuckGoals does not flag goal with mix of quarantined and accepted", () => {
  const goals = [{ number: 300, title: "Goal: Mixed" }];
  const features = [
    { number: 60, milestone: { title: "goal-300-wave-1" }, labels: [{ name: "feature" }, { name: "quarantined" }] },
    { number: 61, milestone: { title: "goal-300-wave-1" }, labels: [{ name: "feature" }, { name: "triaged" }] },
  ];
  const milestones = [{ title: "goal-300-wave-1" }];
  const items = detectStuckGoals({ goals, features, milestones });
  assert.equal(items.length, 0);
});

test("detectStuckGoals flags goal where all features are quarantined", () => {
  const goals = [{ number: 400, title: "Goal: All Quarantined" }];
  const features = [
    { number: 70, milestone: { title: "goal-400-wave-1" }, labels: [{ name: "feature" }, { name: "quarantined" }] },
  ];
  const milestones = [{ title: "goal-400-wave-1" }];
  const items = detectStuckGoals({ goals, features, milestones });
  assert.equal(items.length, 1);
});

test("detectStuckGoals flags ready goal with all historical milestones closed and no open work", () => {
  const goals = [{ number: 542, title: "Goal: All Done", labels: [{ name: "goal" }, { name: "ready" }] }];
  const features = []; // no open features
  const milestones = [
    { title: "goal-542-wave-1", state: "closed" },
    { title: "goal-542-wave-2", state: "closed" },
  ];
  const items = detectStuckGoals({ goals, features, milestones });
  assert.equal(items.length, 1);
  assert.equal(items[0].issue, 542);
  assert.match(items[0].problem, /goal should be closed/);
});

test("detectStuckGoals does not flag ready goal with open milestones", () => {
  const goals = [{ number: 543, title: "Goal: In Progress", labels: [{ name: "goal" }, { name: "ready" }] }];
  const features = [
    { number: 80, milestone: { title: "goal-543-wave-2" }, labels: [{ name: "feature" }] },
  ];
  const milestones = [
    { title: "goal-543-wave-1", state: "closed" },
    { title: "goal-543-wave-2", state: "open" },
  ];
  const items = detectStuckGoals({ goals, features, milestones });
  assert.equal(items.length, 0);
});

test("detectStuckGoals does not flag ready goal with open features", () => {
  const goals = [{ number: 544, title: "Goal: Still Working", labels: [{ name: "goal" }, { name: "ready" }] }];
  const features = [
    { number: 81, milestone: { title: "goal-544-wave-1" }, labels: [{ name: "feature" }] },
  ];
  const milestones = [
    { title: "goal-544-wave-1", state: "closed" },
  ];
  const items = detectStuckGoals({ goals, features, milestones });
  // Has open features even though milestones are closed — don't flag
  assert.equal(items.length, 0);
});

test("detectStuckGoals does not flag ready goal with open sub-issues even if milestones are closed", () => {
  const goals = [{ number: 2015, title: "Goal: Brainstorm factory", labels: [{ name: "goal" }, { name: "ready" }] }];
  const features = [];
  const milestones = [
    { title: "goal-2015-wave-1", state: "closed" },
  ];
  const goalSubIssues = {
    2015: [
      { number: 2056, state: "open" },
      { number: 2057, state: "open" },
    ],
  };
  const items = detectStuckGoals({ goals, features, milestones, goalSubIssues });
  assert.equal(items.length, 0, "goal with open sub-issues should not be flagged for closing");
});

test("detectStuckGoals flags ready goal when all sub-issues are closed and milestones closed", () => {
  const goals = [{ number: 2015, title: "Goal: Done", labels: [{ name: "goal" }, { name: "ready" }] }];
  const features = [];
  const milestones = [
    { title: "goal-2015-wave-1", state: "closed" },
  ];
  const goalSubIssues = {
    2015: [
      { number: 2056, state: "closed" },
      { number: 2057, state: "closed" },
    ],
  };
  const items = detectStuckGoals({ goals, features, milestones, goalSubIssues });
  assert.equal(items.length, 1);
  assert.match(items[0].problem, /goal should be closed/);
});
