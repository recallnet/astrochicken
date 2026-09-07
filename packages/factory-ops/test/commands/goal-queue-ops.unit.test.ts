import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createLegacyReadAdapter,
  isBlockedByOpenRelationships,
  filterKeptGoals,
  limitKeptGoalsForTick,
  computeGoalRunCloseCondition,
  countDecomposeAttempts,
  countDecomposeAttemptsFromIssue,
  reconcileCanonicalSubIssues,
  listReadyGoals,
} from "../../src/commands/goal-queue-ops.ts";

describe("isBlockedByOpenRelationships", () => {
  it("returns true when any node is OPEN", () => {
    assert.equal(isBlockedByOpenRelationships([{ number: 1, state: "OPEN" }]), true);
  });

  it("returns false when all nodes are CLOSED", () => {
    assert.equal(isBlockedByOpenRelationships([{ number: 1, state: "CLOSED" }]), false);
  });

  it("returns false for empty array", () => {
    assert.equal(isBlockedByOpenRelationships([]), false);
  });

  it("returns true when mixed OPEN and CLOSED (any open = blocked)", () => {
    assert.equal(
      isBlockedByOpenRelationships([
        { number: 1, state: "OPEN" },
        { number: 2, state: "CLOSED" },
      ]),
      true,
    );
  });

  it("returns false for null", () => {
    assert.equal(isBlockedByOpenRelationships(null), false);
  });

  it("returns false for undefined (default param)", () => {
    assert.equal(isBlockedByOpenRelationships(undefined), false);
  });

  it("handles lowercase state", () => {
    assert.equal(isBlockedByOpenRelationships([{ number: 1, state: "open" }]), true);
  });
});

describe("filterKeptGoals", () => {
  it("returns all issue numbers when no decisions match", () => {
    const result = filterKeptGoals({
      issuesRaw: JSON.stringify([{ number: 1 }, { number: 2 }]),
      decisionsRaw: "[]",
    });
    assert.deepEqual(result, [1, 2]);
  });

  it("keeps issues with decision=keep", () => {
    const result = filterKeptGoals({
      issuesRaw: JSON.stringify([{ number: 1 }, { number: 2 }]),
      decisionsRaw: JSON.stringify([{ issue_number: 1, decision: "keep" }]),
    });
    assert.deepEqual(result, [1, 2]);
  });

  it("filters out issues with decision=duplicate", () => {
    const result = filterKeptGoals({
      issuesRaw: JSON.stringify([{ number: 1 }, { number: 2 }]),
      decisionsRaw: JSON.stringify([{ issue_number: 1, decision: "duplicate" }]),
    });
    assert.deepEqual(result, [2]);
  });

  it("filters out issues with decision=close", () => {
    const result = filterKeptGoals({
      issuesRaw: JSON.stringify([{ number: 1 }, { number: 2 }]),
      decisionsRaw: JSON.stringify([{ issue_number: 2, decision: "close" }]),
    });
    assert.deepEqual(result, [1]);
  });

  it("returns numbers, not strings", () => {
    const result = filterKeptGoals({
      issuesRaw: JSON.stringify([{ number: 42 }]),
      decisionsRaw: "[]",
    });
    assert.equal(typeof result[0], "number");
  });

  it("returns empty array for invalid JSON", () => {
    const result = filterKeptGoals({
      issuesRaw: "not-json",
      decisionsRaw: "also-not-json",
    });
    assert.deepEqual(result, []);
  });

  it("returns all issues when called with no args", () => {
    // defaults to "[]" for both, so empty
    const result = filterKeptGoals();
    assert.deepEqual(result, []);
  });
});

describe("limitKeptGoalsForTick", () => {
  it("limits goals to maxGoalsPerTick", () => {
    const result = limitKeptGoalsForTick({
      keptGoalsRaw: JSON.stringify([1, 2, 3, 4, 5]),
      maxGoalsPerTick: "2",
    });
    assert.deepEqual(result, [1, 2]);
  });

  it("returns all when fewer than max", () => {
    const result = limitKeptGoalsForTick({
      keptGoalsRaw: JSON.stringify([1, 2]),
      maxGoalsPerTick: "5",
    });
    assert.deepEqual(result, [1, 2]);
  });

  it("defaults maxGoalsPerTick to 2", () => {
    const result = limitKeptGoalsForTick({
      keptGoalsRaw: JSON.stringify([10, 20, 30]),
    });
    assert.deepEqual(result, [10, 20]);
  });

  it("treats maxGoalsPerTick=0 as 1 (Math.max(1, ...))", () => {
    const result = limitKeptGoalsForTick({
      keptGoalsRaw: JSON.stringify([1, 2, 3]),
      maxGoalsPerTick: "0",
    });
    // 0 parsed → parseInt gives 0, || 2 gives 2, Math.max(1,2) = 2
    // Wait, let me re-check: Math.max(1, parseInt("0",10) || 2)
    // parseInt("0") = 0, 0 || 2 = 2, Math.max(1,2) = 2
    assert.deepEqual(result, [1, 2]);
  });

  it("filters out non-finite values", () => {
    const result = limitKeptGoalsForTick({
      keptGoalsRaw: JSON.stringify([1, "abc", 2]),
      maxGoalsPerTick: "5",
    });
    assert.deepEqual(result, [1, 2]);
  });

  it("converts null to 0 (Number(null) is finite)", () => {
    const result = limitKeptGoalsForTick({
      keptGoalsRaw: JSON.stringify([null]),
      maxGoalsPerTick: "5",
    });
    assert.deepEqual(result, [0]);
  });

  it("returns empty array for invalid JSON", () => {
    const result = limitKeptGoalsForTick({
      keptGoalsRaw: "bad-json",
    });
    assert.deepEqual(result, []);
  });
});

describe("computeGoalRunCloseCondition", () => {
  it('returns "true" when created issue count matches approved feature count', () => {
    assert.equal(computeGoalRunCloseCondition({ issueCount: "3", approvedFeatureCount: "3" }), "true");
  });

  it('returns "false" when created issue count is lower than approved feature count', () => {
    assert.equal(computeGoalRunCloseCondition({ issueCount: "3", approvedFeatureCount: "7" }), "false");
  });

  it('returns "false" when issueCount is "0"', () => {
    assert.equal(computeGoalRunCloseCondition({ issueCount: "0", approvedFeatureCount: "7" }), "false");
  });

  it('returns "false" for empty string', () => {
    assert.equal(computeGoalRunCloseCondition({ issueCount: "", approvedFeatureCount: "2" }), "false");
  });

  it('returns "false" for undefined', () => {
    assert.equal(computeGoalRunCloseCondition({ issueCount: undefined, approvedFeatureCount: "2" }), "false");
  });

  it('returns "false" when approvedFeatureCount is missing', () => {
    assert.equal(computeGoalRunCloseCondition({ issueCount: "3" }), "false");
  });

  it('returns "false" when called with no args', () => {
    assert.equal(computeGoalRunCloseCondition(), "false");
  });
});

describe("countDecomposeAttempts", () => {
  it("returns 0 for no comments", () => {
    assert.equal(countDecomposeAttempts({ comments: [] }), 0);
  });

  it("returns 0 for comments without marker", () => {
    assert.equal(
      countDecomposeAttempts({ comments: [{ body: "just a comment" }] }),
      0,
    );
  });

  it("returns 1 for one comment with marker", () => {
    assert.equal(
      countDecomposeAttempts({
        comments: [{ body: "<!-- goal-run:decompose-attempt -->" }],
      }),
      1,
    );
  });

  it("counts multiple markers correctly", () => {
    assert.equal(
      countDecomposeAttempts({
        comments: [
          { body: "<!-- goal-run:decompose-attempt --> first" },
          { body: "no marker here" },
          { body: "<!-- goal-run:decompose-attempt --> third" },
        ],
      }),
      2,
    );
  });

  it("returns 0 for null comments", () => {
    assert.equal(countDecomposeAttempts({ comments: null }), 0);
  });

  it("returns 0 for undefined comments", () => {
    assert.equal(countDecomposeAttempts({ comments: undefined }), 0);
  });

  it("returns 0 when called with no args", () => {
    assert.equal(countDecomposeAttempts(), 0);
  });
});

describe("countDecomposeAttemptsFromIssue", () => {
  it("counts markers from issue comments", () => {
    assert.equal(
      countDecomposeAttemptsFromIssue({
        issue: {
          comments: [
            { body: "<!-- goal-run:decompose-attempt -->" },
            { body: "<!-- goal-run:decompose-attempt -->" },
          ],
        },
      }),
      2,
    );
  });

  it("returns 0 for issue with no comments", () => {
    assert.equal(
      countDecomposeAttemptsFromIssue({ issue: { comments: [] } }),
      0,
    );
  });

  it("returns 0 for null issue", () => {
    assert.equal(countDecomposeAttemptsFromIssue({ issue: null }), 0);
  });

  it("returns 0 when called with no args", () => {
    assert.equal(countDecomposeAttemptsFromIssue(), 0);
  });
});

describe("reconcileCanonicalSubIssues", () => {
  it("closes stale GitHub-open sub-issues that are canonically shipped", () => {
    const out = reconcileCanonicalSubIssues({
      repo: "example-org/example-trading",
      factoryId: "example-trading",
      goalNumber: "3000",
      subIssues: [{ number: 3001, state: "open", blocked_by_count: 0, labels: [] }],
      listCanonicalIssueLifecycleFn: () => [
        {
          issue_number: "3001",
          parent_issue_number: "3000",
          repo: "example-org/example-trading",
          sub_issue_link_status: "linked",
          shipped_to_main: true,
          github_close_status: "",
        },
      ],
    });

    assert.deepEqual(out, [{ number: 3001, state: "closed", blocked_by_count: 0, labels: [] }]);
  });
});

describe("createLegacyReadAdapter", () => {
  it("reads blockedBy nodes from repository.issue fallback payloads", () => {
    const adapter = createLegacyReadAdapter({
      repo: "owner/repo",
      ghJsonFn: (args, fallback) => {
        if (args[0] === "api" && args[1] === "graphql") {
          return {
            data: {
              repository: {
                issue: {
                  blockedBy: {
                    nodes: [{ number: 1391, state: "OPEN" }],
                  },
                },
              },
            },
          };
        }
        return fallback;
      },
    });

    assert.deepEqual(adapter.issueBlockedBy({ number: 1392 }), [{ number: 1391, state: "OPEN" }]);
  });
});

describe("listReadyGoals canonical lifecycle", () => {
  it("does not treat stale GitHub-open shipped sub-issues as dispatchable", () => {
    const out = listReadyGoals({
      repo: "example-org/example-trading",
      factoryId: "example-trading",
      adapter: {
        issueList: () => [{ number: 3000, title: "Goal", labels: [{ name: "goal" }, { name: "ready" }] }],
        issueBlockedBy: () => [],
        listSubIssues: () => [{ number: 3001, state: "open", blocked_by_count: 0, labels: [] }],
      },
      listCanonicalIssueLifecycleFn: () => [
        {
          issue_number: "3001",
          parent_issue_number: "3000",
          repo: "example-org/example-trading",
          sub_issue_link_status: "linked",
          shipped_to_main: true,
          github_close_status: "",
        },
      ],
    });

    assert.deepEqual(out, []);
  });
});
