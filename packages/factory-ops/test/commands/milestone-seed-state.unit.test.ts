import { writeFixtureRunState as writeRunState } from "../helpers/ops-command-fixtures.ts";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { seedMilestoneState } from "../../src/commands/milestone-seed-state.ts";

test("seedMilestoneState returns empty arrays when milestone title missing", () => {
  assert.deepEqual(seedMilestoneState(), {
    completed_issues: [],
    processed_issues: [],
  });
});

test("seedMilestoneState seeds completed issues from terminal canonical milestone runs", () => {
  const tmp = mkdtempSync(join(tmpdir(), "milestone-seed-state-"));
  const runsDir = join(tmp, "runs");
  mkdirSync(runsDir, { recursive: true });

  writeRunState(runsDir, "run-a", {
    status: "failed",
    pipeline: "milestone_execute.dot",
    context: {
      milestone_title: "goal-12-wave-1",
      completed_issues: '["101","102"]',
    },
  });
  writeRunState(runsDir, "run-b", {
    status: "completed",
    pipeline: "milestone_execute.dot",
    context: {
      milestone_title: "goal-12-wave-1",
      completed_issues: ["102", "103"],
    },
  });

  const out = seedMilestoneState({
    milestoneTitle: "goal-12-wave-1",
    runsDir,
  });

  assert.deepEqual(out, {
    completed_issues: ["101", "102", "103"],
    processed_issues: [],
  });
  rmSync(tmp, { recursive: true, force: true });
});

test("seedMilestoneState accepts absolute runtime graph paths from real run state", () => {
  const tmp = mkdtempSync(join(tmpdir(), "milestone-seed-state-"));
  const runsDir = join(tmp, "runs");
  mkdirSync(runsDir, { recursive: true });

  writeRunState(runsDir, "run-absolute-path", {
    status: "completed",
    pipeline: "/path/to/astrochicken/.hatch/mothership/graphs/milestone_execute.dot",
    context: {
      milestone_title: "goal-15-wave-2",
      completed_issues: '["401"]',
    },
  });

  const out = seedMilestoneState({
    milestoneTitle: "goal-15-wave-2",
    runsDir,
  });

  assert.deepEqual(out, {
    completed_issues: ["401"],
    processed_issues: [],
  });
  rmSync(tmp, { recursive: true, force: true });
});

test("seedMilestoneState ignores active runs, other milestones, and malformed state", () => {
  const tmp = mkdtempSync(join(tmpdir(), "milestone-seed-state-"));
  const runsDir = join(tmp, "runs");
  mkdirSync(runsDir, { recursive: true });

  writeRunState(runsDir, "run-active", {
    status: "running",
    pipeline: "milestone_execute.dot",
    context: {
      milestone_title: "goal-12-wave-1",
      completed_issues: '["999"]',
    },
  });
  writeRunState(runsDir, "run-other", {
    status: "completed",
    pipeline: "milestone_execute.dot",
    context: {
      milestone_title: "goal-12-wave-2",
      completed_issues: '["998"]',
    },
  });
  writeRunState(runsDir, "run-malformed", {
    status: "completed",
    pipeline: "milestone_execute.dot",
    context: {
      milestone_title: "goal-12-wave-1",
      completed_issues: "{bad}",
    },
  });
  writeRunState(runsDir, "run-wrong-pipeline", {
    status: "completed",
    pipeline: "goal_execute.dot",
    context: {
      milestone_title: "goal-12-wave-1",
      completed_issues: '["997"]',
    },
  });

  const out = seedMilestoneState({
    milestoneTitle: "goal-12-wave-1",
    runsDir,
  });

  assert.deepEqual(out, {
    completed_issues: [],
    processed_issues: [],
  });
  rmSync(tmp, { recursive: true, force: true });
});
