import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { checkGoalAlreadyDecomposed } from "../../src/commands/goal-check-decomposed.ts";

describe("checkGoalAlreadyDecomposed", () => {
  test("returns false when no sub-issues exist", () => {
    const result = checkGoalAlreadyDecomposed({ issueNumber: 188, subIssues: [] });
    assert.equal(result, "false");
  });

  test("returns true when open sub-issues exist", () => {
    const subIssues = [
      { state: "open" },
      { state: "closed" },
    ];
    const result = checkGoalAlreadyDecomposed({ issueNumber: 188, subIssues });
    assert.equal(result, "true");
  });

  test("returns true when all sub-issues are closed — prevents re-decomposition loop", () => {
    const subIssues = [
      { state: "closed" },
      { state: "closed" },
    ];
    const result = checkGoalAlreadyDecomposed({ issueNumber: 188, subIssues });
    assert.equal(result, "true",
      "goals with all-closed sub-issues must be treated as already decomposed");
  });

  test("returns false when subIssues is undefined", () => {
    const result = checkGoalAlreadyDecomposed({ issueNumber: 188 });
    assert.equal(result, "false");
  });

  test("handles string issue number", () => {
    const subIssues = [{ state: "open" }];
    const result = checkGoalAlreadyDecomposed({ issueNumber: "320", subIssues });
    assert.equal(result, "true");
  });
});
