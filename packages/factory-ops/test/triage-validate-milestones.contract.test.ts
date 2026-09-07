import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { findMissingMilestones } from "../src/commands/triage-validate-milestones.ts";

const TRIAGE_DOT_PATH = "packages/capability-triage/graphs/triage.dot";

test("findMissingMilestones returns empty when all have milestones", () => {
  const items = [
    { issue_number: 1, status: "accept", wave: "goal-1-wave-1" },
    { issue_number: 2, status: "blocked", wave: "goal-1-wave-2" },
  ];
  const states = [
    { number: 1, milestone_title: "goal-1-wave-1", issue_state: "OPEN" },
    { number: 2, milestone_title: "goal-1-wave-2", issue_state: "OPEN" },
  ];
  assert.deepEqual(findMissingMilestones(items, states), []);
});

test("findMissingMilestones detects items missing milestones", () => {
  const items = [
    { issue_number: 1, status: "accept", wave: "goal-1-wave-1" },
    { issue_number: 2, status: "accept", wave: "goal-1-wave-1" },
  ];
  const states = [
    { number: 1, milestone_title: "goal-1-wave-1", issue_state: "OPEN" },
    { number: 2, milestone_title: "", issue_state: "OPEN" },
  ];
  const out = findMissingMilestones(items, states);
  assert.equal(out.length, 1);
  assert.equal(out[0].issue_number, 2);
});

test("findMissingMilestones skips duplicates", () => {
  const items = [
    { issue_number: 1, status: "duplicate", wave: "" },
    { issue_number: 2, status: "accept", wave: "goal-1-wave-1" },
  ];
  const states = [
    { number: 1, milestone_title: "", issue_state: "OPEN" },
    { number: 2, milestone_title: "", issue_state: "OPEN" },
  ];
  const out = findMissingMilestones(items, states);
  assert.equal(out.length, 1);
  assert.equal(out[0].issue_number, 2);
});

test("findMissingMilestones handles missing issue state", () => {
  const items = [{ issue_number: 5, status: "accept", wave: "w" }];
  const out = findMissingMilestones(items, []);
  assert.equal(out.length, 1);
  assert.equal(out[0].issue_number, 5);
});

test("findMissingMilestones skips closed issues (completed prior waves)", () => {
  const items = [
    { issue_number: 1, status: "accept", wave: "goal-1-wave-1" },
    { issue_number: 2, status: "accept", wave: "goal-1-wave-2" },
    { issue_number: 3, status: "accept", wave: "goal-1-wave-3" },
  ];
  const states = [
    { number: 1, milestone_title: "", issue_state: "CLOSED" },  // completed work, no milestone
    { number: 2, milestone_title: "", issue_state: "CLOSED" },  // completed work, no milestone
    { number: 3, milestone_title: "goal-1-wave-3", issue_state: "OPEN" },
  ];
  const out = findMissingMilestones(items, states);
  assert.equal(out.length, 0, "closed issues should be skipped even without milestones");
});

test("findMissingMilestones still catches open issues missing milestones alongside closed ones", () => {
  const items = [
    { issue_number: 1, status: "accept", wave: "goal-1-wave-1" },
    { issue_number: 2, status: "accept", wave: "goal-1-wave-2" },
    { issue_number: 3, status: "accept", wave: "goal-1-wave-3" },
  ];
  const states = [
    { number: 1, milestone_title: "", issue_state: "CLOSED" },  // skip — closed
    { number: 2, milestone_title: "", issue_state: "OPEN" },    // missing — flag it
    { number: 3, milestone_title: "goal-1-wave-3", issue_state: "OPEN" },
  ];
  const out = findMissingMilestones(items, states);
  assert.equal(out.length, 1);
  assert.equal(out[0].issue_number, 2);
});

test("findMissingMilestones defaults issue_state to OPEN when not provided", () => {
  const items = [
    { issue_number: 1, status: "accept", wave: "goal-1-wave-1" },
  ];
  const states = [
    { number: 1, milestone_title: "" },  // no issue_state field
  ];
  const out = findMissingMilestones(items, states);
  assert.equal(out.length, 1, "should treat missing issue_state as OPEN");
});

// Triage keeps milestone handling in triage_item and validates/repairs planner output
// before fan-out.
test("triage graph keeps validate→repair→fallback chain without milestone hard-gates", () => {
  const src = readFileSync(TRIAGE_DOT_PATH, "utf8");
  assert.doesNotMatch(src, /gate_milestones/);
  assert.doesNotMatch(src, /validate-milestones/);
  assert.doesNotMatch(src, /apply-missing-milestones/);
  assert.doesNotMatch(src, /fail_triage/);
  assert.match(src, /validate_plan/);
  assert.match(src, /repair_plan/);
  assert.match(src, /validate_repaired_plan/);
  assert.match(src, /fallback_plan/);
  assert.match(src, /plan_gate -> load_triage_repair_task_prompt \[condition="ok!=true" label="repair"\]/);
  assert.match(src, /load_triage_repair_task_prompt -> repair_plan/);
  assert.match(src, /repaired_plan_gate -> fallback_plan \[condition="ok!=true" label="fallback"\]/);
});
