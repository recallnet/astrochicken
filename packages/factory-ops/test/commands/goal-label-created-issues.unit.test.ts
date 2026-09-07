import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { labelCreatedIssues } from "../../src/commands/goal-label-created-issues.ts";

describe("labelCreatedIssues", () => {
  test("adds triaged label to all issues from URL list", () => {
    const ghCalls = [];
    const result = labelCreatedIssues({
      repo: "recallnet/astrochicken",
      issueUrls: "https://github.com/recallnet/astrochicken/issues/101,https://github.com/recallnet/astrochicken/issues/102",
      runGhFn: (args) => {
        ghCalls.push(args);
        return { ok: true, stdout: "", stderr: "" };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.labeled_count, 2);
    assert.equal(ghCalls.length, 2);
    assert.ok(ghCalls[0].includes("101"));
    assert.ok(ghCalls[1].includes("102"));
  });

  test("returns ok with 0 count for empty issue list", () => {
    const result = labelCreatedIssues({
      repo: "recallnet/astrochicken",
      issueUrls: "",
      runGhFn: () => ({ ok: true, stdout: "", stderr: "" }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.labeled_count, 0);
  });

  test("continues on individual label failure", () => {
    let callCount = 0;
    const result = labelCreatedIssues({
      repo: "recallnet/astrochicken",
      issueUrls: "https://github.com/recallnet/astrochicken/issues/101,https://github.com/recallnet/astrochicken/issues/102",
      runGhFn: () => {
        callCount += 1;
        if (callCount === 1) return { ok: false, stdout: "", stderr: "label error" };
        return { ok: true, stdout: "", stderr: "" };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.labeled_count, 1);
    assert.equal(result.errors.length, 1);
  });

  test("returns error for missing repo", () => {
    const result = labelCreatedIssues({
      repo: "",
      issueUrls: "https://github.com/recallnet/astrochicken/issues/101",
      runGhFn: () => ({ ok: true, stdout: "", stderr: "" }),
    });

    assert.equal(result.ok, false);
  });
});
