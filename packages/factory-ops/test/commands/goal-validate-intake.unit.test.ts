import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { validateGoalIntakeEligibility } from "../../src/commands/goal-validate-intake.ts";

describe("validateGoalIntakeEligibility", () => {
  test("returns eligible for open issue with goal label", () => {
    const goalIssueJson = JSON.stringify({
      number: 1234,
      title: "Test Goal",
      state: "OPEN",
      labels: [{ name: "goal" }, { name: "ready" }],
    });
    assert.equal(validateGoalIntakeEligibility({ goalIssueJson }), "eligible");
  });

  test("returns ineligible:closed for closed issue", () => {
    const goalIssueJson = JSON.stringify({
      number: 1523,
      title: "Closed Goal",
      state: "CLOSED",
      labels: [{ name: "goal" }],
    });
    assert.equal(validateGoalIntakeEligibility({ goalIssueJson }), "ineligible:closed");
  });

  test("returns ineligible:closed for closed feature issue (bug #1714 scenario)", () => {
    const goalIssueJson = JSON.stringify({
      number: 1613,
      title: "Some Feature",
      state: "CLOSED",
      labels: [{ name: "feature" }, { name: "triaged" }],
    });
    assert.equal(validateGoalIntakeEligibility({ goalIssueJson }), "ineligible:closed");
  });

  test("returns ineligible:not_goal for open issue without goal label", () => {
    const goalIssueJson = JSON.stringify({
      number: 9999,
      title: "Some Issue",
      state: "OPEN",
      labels: [{ name: "bug" }],
    });
    assert.equal(validateGoalIntakeEligibility({ goalIssueJson }), "ineligible:not_goal");
  });

  test("returns ineligible:not_goal for open feature issue", () => {
    const goalIssueJson = JSON.stringify({
      number: 2000,
      title: "Feature issue",
      state: "OPEN",
      labels: [{ name: "feature" }, { name: "ready" }],
    });
    assert.equal(validateGoalIntakeEligibility({ goalIssueJson }), "ineligible:not_goal");
  });

  test("returns eligible when goal is among multiple labels", () => {
    const goalIssueJson = JSON.stringify({
      number: 5678,
      title: "Multi-label Goal",
      state: "OPEN",
      labels: [{ name: "goal" }, { name: "ready" }, { name: "triaged" }],
    });
    assert.equal(validateGoalIntakeEligibility({ goalIssueJson }), "eligible");
  });

  test("returns ineligible:not_goal for empty labels array", () => {
    const goalIssueJson = JSON.stringify({
      number: 1111,
      title: "Unlabeled",
      state: "OPEN",
      labels: [],
    });
    assert.equal(validateGoalIntakeEligibility({ goalIssueJson }), "ineligible:not_goal");
  });

  test("returns ineligible:not_goal for empty input", () => {
    assert.equal(validateGoalIntakeEligibility({ goalIssueJson: "" }), "ineligible:not_goal");
  });

  test("returns ineligible:not_goal for invalid JSON", () => {
    assert.equal(validateGoalIntakeEligibility({ goalIssueJson: "not-json{" }), "ineligible:not_goal");
  });
});
