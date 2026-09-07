import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { applyFeatureBlockers } from "../../src/commands/goal-apply-feature-blockers.ts";

describe("applyFeatureBlockers", () => {
  test("calls ensureHumanBlocker for features with human_blocker", () => {
    const blocker_calls = [];
    const result = applyFeatureBlockers({
      repo: "recallnet/astrochicken",
      goalIssueNumber: 2300,
      featureIssueMap: JSON.stringify([
        {
          feature: {
            id: "F-1",
            name: "Normal feature",
          },
          issue_number: 101,
        },
        {
          feature: {
            id: "F-2",
            name: "Blocked feature",
            human_blocker: {
              kind: "missing_credentials",
              title_hint: "Provide Slack API key",
              exact_request: "Slack API key for workspace notifications",
              why_blocked: "No Slack API key available",
              unblock_condition: "Slack API key provisioned in GitHub Actions secrets",
            },
          },
          issue_number: 102,
        },
      ]),
      ensureHumanBlockerFn: (opts) => {
        blocker_calls.push(opts);
        return { ok: true, created: true, issue_number: 999, effective_blocked_by: "[999]" };
      },
      syncBlockedByFn: () => ({ ok: true }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.human_blockers_applied, 1);
    assert.equal(result.control_plane_blockers_applied, 0);
    assert.equal(blocker_calls.length, 1);
    assert.equal(blocker_calls[0].issueNumber, 102);
    assert.equal(blocker_calls[0].goalIssueNumber, 2300);
  });

  test("skips features without blockers", () => {
    const result = applyFeatureBlockers({
      repo: "recallnet/astrochicken",
      goalIssueNumber: 2300,
      featureIssueMap: JSON.stringify([
        { feature: { id: "F-1", name: "Clean" }, issue_number: 101 },
        { feature: { id: "F-2", name: "Also clean" }, issue_number: 102 },
      ]),
      ensureHumanBlockerFn: () => {
        throw new Error("should not be called");
      },
      syncBlockedByFn: () => ({ ok: true }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.human_blockers_applied, 0);
    assert.equal(result.control_plane_blockers_applied, 0);
  });

  test("applies control_plane_blocker by adding label and comment", () => {
    const gh_calls = [];
    const result = applyFeatureBlockers({
      repo: "recallnet/astrochicken",
      goalIssueNumber: 2300,
      featureIssueMap: JSON.stringify([
        {
          feature: {
            id: "F-1",
            name: "Blocked by upstream",
            control_plane_blocker: {
              kind: "upstream_bug",
              blockerRef: "#555",
              unblockCondition: "issue #555 is closed",
              status: "blocked",
            },
          },
          issue_number: 103,
        },
      ]),
      ensureHumanBlockerFn: () => ({ ok: true }),
      syncBlockedByFn: () => ({ ok: true }),
      runGhFn: (args) => {
        gh_calls.push(args);
        return { ok: true, stdout: "", stderr: "" };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.control_plane_blockers_applied, 1);
    assert.ok(gh_calls.length >= 1);
  });

  test("returns ok with empty feature map", () => {
    const result = applyFeatureBlockers({
      repo: "recallnet/astrochicken",
      goalIssueNumber: 2300,
      featureIssueMap: "[]",
      ensureHumanBlockerFn: () => ({ ok: true }),
      syncBlockedByFn: () => ({ ok: true }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.human_blockers_applied, 0);
  });

  test("returns error for missing repo", () => {
    const result = applyFeatureBlockers({
      repo: "",
      goalIssueNumber: 2300,
      featureIssueMap: "[]",
    });

    assert.equal(result.ok, false);
  });
});
