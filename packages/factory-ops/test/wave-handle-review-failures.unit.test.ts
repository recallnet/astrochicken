import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFailureComments,
  buildIssueExecutionStyleComment,
  commentReviewFailures,
  computeFailureCount,
} from "../src/commands/wave-handle-review-failures.ts";

test("buildFailureComments only includes actionable failures", () => {
  const out = buildFailureComments([
    { issue_number: 10, review_notes: "Fix tests" },
    { issue_number: 11, review_notes: "" },
    { review_notes: "Missing issue" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].issue_number, "10");
  assert.equal(out[0].notes, "Fix tests");
  assert.equal(out[0].issue_number, "10");
});

test("buildIssueExecutionStyleComment mirrors issue_execution comment layout", () => {
  assert.equal(
    buildIssueExecutionStyleComment("QA infrastructure block cleared:", "attempt 2 passed"),
    "QA infrastructure block cleared:\n\nattempt 2 passed",
  );
  assert.equal(
    buildIssueExecutionStyleComment("QA infrastructure block cleared:", ""),
    "QA infrastructure block cleared:",
  );
});

test("commentReviewFailures issue_execution mode posts only expected issue comments", () => {
  const comments = [];
  let ghCalls = 0;
  let ghJsonCalls = 0;
  let artifactCalls = 0;

  const out = commentReviewFailures({
    repo: "recallnet/astrochicken",
    mode: "issue_execution",
    reviewFailuresRaw: JSON.stringify([
      { issue_number: 88, review_notes: "Don't skip lint" },
      { issue_number: 89, review_notes: "" },
      { review_notes: "Missing issue" },
    ]),
  }, {
    issueComment: ({ issueNumber, body }) => {
      comments.push({ issueNumber, body });
      return { ok: true };
    },
    gh: () => { ghCalls += 1; return { ok: true }; },
    ghJson: () => { ghJsonCalls += 1; return {}; },
    emitArtifact: () => { artifactCalls += 1; return { ok: true, issue_url: "x", error: "" }; },
  });

  assert.equal(out.mode, "issue_execution");
  assert.equal(out.posted_count, 1);
  assert.deepEqual(out.posted_issues, ["88"]);
  assert.equal(out.quarantined_count, 0);
  assert.deepEqual(out.quarantined, []);
  assert.equal(out.supervisor_artifact_url, "");
  assert.equal(out.supervisor_artifact_error, "");

  assert.deepEqual(comments, [{
    issueNumber: "88",
    body: "Review failed after 3 attempts:\n\nDon't skip lint",
  }]);
  assert.equal(ghCalls, 0, "issue_execution mode must not edit labels or post non-comment ops");
  assert.equal(ghJsonCalls, 0, "issue_execution mode must not query snapshots/quarantine state");
  assert.equal(artifactCalls, 0, "issue_execution mode must not emit supervisor artifacts");
});

test("commentReviewFailures emits a bug issue when quarantine threshold is reached", () => {
  const bugCalls = [];
  const ghCalls = [];

  const out = commentReviewFailures({
    repo: "recallnet/astrochicken",
    mode: "wave_execute",
    quarantineThreshold: 3,
    reviewFailuresRaw: JSON.stringify([
      { issue_number: 42, review_notes: "Missing impl_result payload" },
    ]),
    runId: "run-123",
    pipeline: "wave_execute",
  }, {
    gh: (args) => {
      ghCalls.push(args);
      return { ok: true, stdout: "", stderr: "" };
    },
    ghJson: (args) => {
      // issue view returns snapshot with 2 prior failures (same hash), so count becomes 3
      if (args[0] === "issue" && args[1] === "view") {
        return {
          number: 42,
          title: "Test issue",
          labels: [],
          comments: [
            { body: "WAVE-REVIEW-FAILURE: count=1 note_hash=322f4db116bd2ec3" },
            { body: "WAVE-REVIEW-FAILURE: count=2 note_hash=322f4db116bd2ec3" },
          ],
        };
      }
      return [];
    },
    emitArtifact: () => ({ ok: true, issue_url: "", error: "" }),
    emitBugIssue: (params) => {
      bugCalls.push(params);
      return { ok: true, issue_url: "https://github.com/recallnet/astrochicken/issues/999", error: "" };
    },
  });

  assert.equal(out.quarantined_count, 1, "should quarantine the issue");
  assert.equal(bugCalls.length, 1, "should emit exactly one bug issue for quarantined issues");

  const bug = bugCalls[0];
  assert.equal(bug.repo, "recallnet/astrochicken");
  assert.equal(bug.bugType, "repeat-review-failure-quarantine");
  assert.ok(bug.summary.includes("42"), "summary should reference the quarantined issue number");
  assert.equal(bug.runId, "run-123");
  assert.equal(bug.pipeline, "wave_execute");

  // The bug issue URL should be returned in the result
  assert.equal(out.supervisor_bug_url, "https://github.com/recallnet/astrochicken/issues/999");
});

test("commentReviewFailures does NOT emit bug issue when failures are below quarantine threshold", () => {
  const bugCalls = [];

  const out = commentReviewFailures({
    repo: "recallnet/astrochicken",
    mode: "wave_execute",
    quarantineThreshold: 3,
    reviewFailuresRaw: JSON.stringify([
      { issue_number: 50, review_notes: "Flaky test" },
    ]),
  }, {
    gh: () => ({ ok: true, stdout: "", stderr: "" }),
    ghJson: (args) => {
      if (args[0] === "issue" && args[1] === "view") {
        return { number: 50, title: "Test", labels: [], comments: [] };
      }
      return [];
    },
    emitArtifact: () => ({ ok: true, issue_url: "", error: "" }),
    emitBugIssue: (params) => {
      bugCalls.push(params);
      return { ok: true, issue_url: "", error: "" };
    },
  });

  assert.equal(out.quarantined_count, 0, "should not quarantine");
  assert.equal(bugCalls.length, 0, "should NOT emit a bug issue when below threshold");
});

test("commentReviewFailures bug issue includes all quarantined issues when multiple hit threshold", () => {
  const bugCalls = [];

  commentReviewFailures({
    repo: "recallnet/astrochicken",
    mode: "wave_execute",
    quarantineThreshold: 1,
    reviewFailuresRaw: JSON.stringify([
      { issue_number: 60, review_notes: "Crash A" },
      { issue_number: 61, review_notes: "Crash B" },
    ]),
  }, {
    gh: () => ({ ok: true, stdout: "", stderr: "" }),
    ghJson: (args) => {
      if (args[0] === "issue" && args[1] === "view") {
        return { number: 0, title: "", labels: [], comments: [] };
      }
      return [];
    },
    emitArtifact: () => ({ ok: true, issue_url: "", error: "" }),
    emitBugIssue: (params) => {
      bugCalls.push(params);
      return { ok: true, issue_url: "", error: "" };
    },
  });

  assert.equal(bugCalls.length, 1, "should emit exactly one bug issue for all quarantined issues");
  const evidence = typeof bugCalls[0].evidence === "string" ? JSON.parse(bugCalls[0].evidence) : bugCalls[0].evidence;
  assert.equal(evidence.quarantined.length, 2, "evidence should include both quarantined issues");
});

// ── Quarantine cycle regression tests ────────────────────────────────

test("computeFailureCount uses highest prior count when hash changes (no reset to 1)", () => {
  // Bug: computeFailureCount returned 1 when the latest marker had a different hash,
  // which caused commentReviewFailures to remove the quarantine label.
  const snapshot = {
    comments: [
      { body: "WAVE-REVIEW-FAILURE: count=5 note_hash=aaaa000000000000" },
      { body: "WAVE-REVIEW-FAILURE: count=6 note_hash=aaaa000000000000" },
    ],
  };
  // New failure with a DIFFERENT hash — must NOT reset to 1
  const count = computeFailureCount(snapshot, "bbbb111111111111");
  assert.ok(count >= 7, `expected count >= 7, got ${count} — hash change must not reset failure count`);
});

test("computeFailureCount increments from highest count regardless of hash", () => {
  const snapshot = {
    comments: [
      { body: "WAVE-REVIEW-FAILURE: count=3 note_hash=aaaa000000000000" },
      { body: "WAVE-REVIEW-FAILURE: count=10 note_hash=bbbb111111111111" },
      { body: "WAVE-REVIEW-FAILURE: count=11 note_hash=bbbb111111111111" },
    ],
  };
  // Same hash as latest marker
  const sameHash = computeFailureCount(snapshot, "bbbb111111111111");
  assert.equal(sameHash, 12);

  // Different hash — should still be >= 12
  const diffHash = computeFailureCount(snapshot, "cccc222222222222");
  assert.ok(diffHash >= 12, `expected count >= 12, got ${diffHash}`);
});

test("commentReviewFailures does NOT remove quarantine label when hash changes", () => {
  const ghCalls = [];

  commentReviewFailures({
    repo: "example-org/example-trading",
    mode: "wave_execute",
    quarantineThreshold: 3,
    reviewFailuresRaw: JSON.stringify([
      { issue_number: 1358, review_notes: "Different failure mode" },
    ]),
  }, {
    gh: (args) => {
      ghCalls.push(args);
      return { ok: true, stdout: "", stderr: "" };
    },
    ghJson: (args) => {
      if (args[0] === "issue" && args[1] === "view") {
        return {
          number: 1358,
          title: "Test issue",
          labels: [{ name: "quarantined" }],
          comments: [
            // Prior quarantine with different hash — 5 failures already
            { body: "WAVE-REVIEW-FAILURE: count=4 note_hash=aaaa000000000000" },
            { body: "WAVE-REVIEW-FAILURE: count=5 note_hash=aaaa000000000000" },
            { body: "Applied deterministic cooldown. WAVE-QUARANTINE: until=9999999999 reason=repeat_review_failure count=5" },
          ],
        };
      }
      return [];
    },
    emitArtifact: () => ({ ok: true, issue_url: "", error: "" }),
    emitBugIssue: () => ({ ok: true, issue_url: "", error: "" }),
  });

  // The quarantine label must NOT be removed — issue was already quarantined
  const removeQuarantineCalls = ghCalls.filter((args) =>
    args.some((a) => typeof a === "string" && a.includes("--remove-label"))
    || (Array.isArray(args) && args.includes("--remove-label"))
  );
  // Check if any label edit removed quarantined
  const removedQuarantine = ghCalls.some((args) => {
    const joined = args.join(" ");
    return joined.includes("remove") && joined.includes("quarantin");
  });
  assert.equal(removedQuarantine, false,
    "must NOT remove quarantine label when issue is already quarantined — this causes infinite quarantine cycling");
});
