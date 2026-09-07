import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { screenGoalForHumanBlockers } from "../../src/commands/goal-human-blocker-screen.ts";

describe("screenGoalForHumanBlockers", () => {
  test("returns needs_human false for normal goal body", () => {
    const result = screenGoalForHumanBlockers({
      goalBody: "Implement a new feature for the dashboard that shows factory health",
    });
    assert.equal(result.needs_human, false);
  });

  test("detects missing credentials signal", () => {
    const result = screenGoalForHumanBlockers({
      goalBody: "Integrate with Slack API. Requires a Slack API key that we don't have yet.",
    });
    assert.equal(result.needs_human, true);
    assert.equal(result.blocker_kind, "missing_credentials");
    assert.ok(result.exact_request.length > 0);
    assert.ok(result.why_blocked.length > 0);
    assert.ok(result.unblock_condition.length > 0);
  });

  test("detects AWS secret requirement", () => {
    const result = screenGoalForHumanBlockers({
      goalBody: "Deploy to production. Need AWS access key and secret key provisioned for CI.",
    });
    assert.equal(result.needs_human, true);
    assert.equal(result.blocker_kind, "missing_credentials");
  });

  test("detects pending owner approval", () => {
    const result = screenGoalForHumanBlockers({
      goalBody: "This change needs owner approval before we can proceed with the migration.",
    });
    assert.equal(result.needs_human, true);
    assert.equal(result.blocker_kind, "owner_decision");
  });

  test("detects awaiting external input", () => {
    const result = screenGoalForHumanBlockers({
      goalBody: "Blocked: waiting for the vendor to provide their webhook endpoint URL.",
    });
    assert.equal(result.needs_human, true);
    assert.equal(result.blocker_kind, "external_input");
  });

  test("does not false-positive on mention of keys in code context", () => {
    const result = screenGoalForHumanBlockers({
      goalBody: "Refactor the object keys in the config parser to use camelCase.",
    });
    assert.equal(result.needs_human, false);
  });

  test("does not false-positive on general dependency mentions", () => {
    const result = screenGoalForHumanBlockers({
      goalBody: "Update the npm dependencies to latest versions and fix breaking changes.",
    });
    assert.equal(result.needs_human, false);
  });

  test("returns needs_human false for empty body", () => {
    const result = screenGoalForHumanBlockers({ goalBody: "" });
    assert.equal(result.needs_human, false);
  });

  test("returns needs_human false for undefined input", () => {
    const result = screenGoalForHumanBlockers({});
    assert.equal(result.needs_human, false);
  });

  test("detects GitHub token requirement", () => {
    const result = screenGoalForHumanBlockers({
      goalBody: "Set up cross-repo sync. Requires a GitHub personal access token with repo scope.",
    });
    assert.equal(result.needs_human, true);
    assert.equal(result.blocker_kind, "missing_credentials");
  });

  test("detects explicit human blocker marker", () => {
    const result = screenGoalForHumanBlockers({
      goalBody: "<!-- human-blocker: missing_credentials -->\\nNeed database credentials for staging.",
    });
    assert.equal(result.needs_human, true);
    assert.equal(result.blocker_kind, "missing_credentials");
  });

  test("case insensitive detection", () => {
    const result = screenGoalForHumanBlockers({
      goalBody: "REQUIRES OWNER APPROVAL before deploying this change.",
    });
    assert.equal(result.needs_human, true);
    assert.equal(result.blocker_kind, "owner_decision");
  });
});
