import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  areAllWavesComplete,
  determineSupervisorGoalsToClose,
  extractOrphanFeatureSignature,
} from "../../src/commands/supervisor-sanitize-goals.ts";
import { orphanSignature } from "../../src/commands/supervisor-remediate-orphan-features.ts";

// Gate: sanitizeSupervisorGoals must close goals whose milestones are all complete.
// Without this, a completed goal blocks its entire downstream dependency chain,
// stalling the factory indefinitely.
test("sanitizeSupervisorGoals must include completed-goal closure logic", () => {
  const src = readFileSync("packages/factory-ops/src/commands/supervisor-sanitize-goals.ts", "utf8");

  assert.ok(
    src.includes("milestones") && src.includes("goal-"),
    "sanitizeSupervisorGoals must query milestones matching goal-{N}-wave-* pattern " +
    "to detect goals whose waves are all complete"
  );

  assert.ok(
    src.includes("completed")
      && (src.includes("all_milestones_closed")
        || src.includes("all_waves_complete")
        || src.includes("All wave milestones for this goal are closed")),
    "sanitizeSupervisorGoals must detect and close goals with all milestones in closed state",
  );
});

test("areAllWavesComplete returns true when all wave milestones are closed", () => {
  const milestones = [
    { title: "goal-319-wave-1", number: 10, state: "closed" },
    { title: "goal-319-wave-2", number: 11, state: "closed" },
    { title: "goal-319-wave-3", number: 12, state: "closed" },
    { title: "goal-320-wave-1", number: 13, state: "open" },
  ];
  assert.equal(areAllWavesComplete(319, milestones), true);
});

test("areAllWavesComplete returns false when some milestones are open", () => {
  const milestones = [
    { title: "goal-100-wave-1", number: 1, state: "closed" },
    { title: "goal-100-wave-2", number: 2, state: "open" },
  ];
  assert.equal(areAllWavesComplete(100, milestones), false);
});

test("areAllWavesComplete returns false when no milestones exist for goal", () => {
  const milestones = [
    { title: "goal-200-wave-1", number: 5, state: "closed" },
  ];
  assert.equal(areAllWavesComplete(999, milestones), false);
});

test("areAllWavesComplete returns false for empty milestones", () => {
  assert.equal(areAllWavesComplete(319, []), false);
});

test("extractOrphanFeatureSignature reads the remediation signature from goal body", () => {
  assert.equal(
    extractOrphanFeatureSignature("foo\nOrphan-Feature-Signature: sha256:abc123\nbar"),
    "sha256:abc123",
  );
  assert.equal(extractOrphanFeatureSignature("no signature here"), "");
});

test("determineSupervisorGoalsToClose closes superseded orphan remediation goals", () => {
  const currentOrphans = [{ number: 1859 }, { number: 1814 }];
  const currentSignature = orphanSignature(currentOrphans.map((feature) => feature.number));

  const staleGoal = {
    number: 1864,
    title: "Goal: Supervisor Remediation — Orphan Features (20)",
    body: "Orphan-Feature-Signature: sha256:deadbeef",
  };

  const currentGoal = {
    number: 1900,
    title: "Goal: Supervisor Remediation — Orphan Features (2)",
    body: `Orphan-Feature-Signature: ${currentSignature}`,
  };

  const out = determineSupervisorGoalsToClose({
    goals: [staleGoal, currentGoal],
    allMilestones: [],
    orphanFeatures: currentOrphans,
  });

  assert.deepEqual(out, [{
    issue_number: "1864",
    reason: "not planned",
    note: `Closing superseded remediation goal; current orphan feature signature is ${currentSignature}.`,
  }]);
});

test("determineSupervisorGoalsToClose closes orphan remediation goals when invariant is clean", () => {
  const out = determineSupervisorGoalsToClose({
    goals: [{
      number: 1864,
      title: "Goal: Supervisor Remediation — Orphan Features (20)",
      body: "Orphan-Feature-Signature: sha256:deadbeef",
    }],
    allMilestones: [],
    orphanFeatures: [],
  });

  assert.deepEqual(out, [{
    issue_number: "1864",
    reason: "completed",
    note: "Closing remediation goal; orphan feature invariant is clean.",
  }]);
});

test("determineSupervisorGoalsToClose does NOT close goal when milestones are closed but sub-issues are open", () => {
  const goals = [{ number: 500, title: "Goal with open sub-issues" }];
  const allMilestones = [
    { title: "goal-500-wave-1", number: 20, state: "closed" },
    { title: "goal-500-wave-2", number: 21, state: "closed" },
  ];
  const result = determineSupervisorGoalsToClose({
    goals,
    allMilestones,
    orphanFeatures: [],
    listGoalSubIssuesFn: () => [
      { number: 501, state: "CLOSED", title: "done sub" },
      { number: 502, state: "OPEN", title: "open sub" },
    ],
    repoForSubIssues: "test/repo",
  });
  assert.equal(result.length, 0, "Should not close goal with open sub-issues");
});

test("determineSupervisorGoalsToClose closes goal when milestones closed AND all sub-issues closed", () => {
  const goals = [{ number: 600, title: "Goal fully done" }];
  const allMilestones = [
    { title: "goal-600-wave-1", number: 30, state: "closed" },
  ];
  const result = determineSupervisorGoalsToClose({
    goals,
    allMilestones,
    orphanFeatures: [],
    listGoalSubIssuesFn: () => [
      { number: 601, state: "CLOSED", title: "done sub" },
      { number: 602, state: "CLOSED", title: "also done" },
    ],
    repoForSubIssues: "test/repo",
  });
  assert.equal(result.length, 1, "Should close goal with all sub-issues closed");
});
