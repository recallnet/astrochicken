import test from "node:test";
import assert from "node:assert/strict";
import { createTestAdapter } from "../../github-adapter/src/test-adapter.ts";
import { blockReadyWaveIssue } from "../src/commands/wave-block-ready.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockGh({ labelOk = true, commentOk = true, closeOk = true } = {}) {
  const calls = [];
  return {
    calls,
    fn: (args) => {
      calls.push(args);
      const [cmd, sub] = args;
      if (cmd === "issue" && sub === "edit") return { ok: labelOk, stdout: "", stderr: labelOk ? "" : "label_err" };
      if (cmd === "issue" && sub === "comment") return { ok: commentOk, stdout: "", stderr: commentOk ? "" : "comment_err" };
      if (cmd === "issue" && sub === "close") return { ok: closeOk, stdout: "", stderr: closeOk ? "" : "close_err" };
      return { ok: true, stdout: "", stderr: "" };
    },
  };
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

test("blockReadyWaveIssue returns error on missing repo", () => {
  const out = blockReadyWaveIssue({ repo: "", readyIssueNumber: 1 });
  assert.equal(out.ok, false);
  assert.deepEqual(out.failures, ["missing_repo_or_issue"]);
  assert.equal(out.reason, "missing_repo_or_issue");
  assert.equal(out.blocked_without_relationship, true);
});

test("blockReadyWaveIssue returns error on missing issue number", () => {
  const out = blockReadyWaveIssue({ repo: "r/r", readyIssueNumber: 0 });
  assert.equal(out.ok, false);
  assert.deepEqual(out.failures, ["missing_repo_or_issue"]);
});

test("blockReadyWaveIssue returns error on zero string issue number", () => {
  const out = blockReadyWaveIssue({ repo: "r/r", readyIssueNumber: "0" });
  assert.equal(out.ok, false);
  assert.deepEqual(out.failures, ["missing_repo_or_issue"]);
});

test("blockReadyWaveIssue returns error on non-finite issue number", () => {
  const out = blockReadyWaveIssue({ repo: "r/r", readyIssueNumber: "abc" });
  assert.equal(out.ok, false);
  assert.deepEqual(out.failures, ["missing_repo_or_issue"]);
});

test("blockReadyWaveIssue treats negative issue number as truthy (passes guard but gh fails)", () => {
  const { fn } = mockGh();
  const out = blockReadyWaveIssue({
    repo: "r/r",
    readyIssueNumber: -5,
    execGh: fn,
    listMilestoneOpenIssuesFn: () => [],
    syncBlockedByFn: () => ({ ok: true }),
    releaseReadyWaveClaimFn: () => ({ ok: true }),
  });
  // -5 passes the truthiness guard (Number(-5) is truthy)
  assert.equal(out.issue_number, -5);
  assert.equal(out.ok, true);
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test("blockReadyWaveIssue succeeds with all operations ok", () => {
  const { fn, calls } = mockGh();
  const out = blockReadyWaveIssue({
    repo: "r/r",
    readyIssueNumber: 100,
    milestoneTitle: "goal-1-wave-1",
    reason: "no_merge_candidates",
    runId: "run-1",
    execGh: fn,
    listMilestoneOpenIssuesFn: () => [
      { number: 100, title: "Wave Ready: goal-1-wave-1" },
      { number: 101, title: "Feature A" },
    ],
    syncBlockedByFn: () => ({ ok: true }),
    releaseReadyWaveClaimFn: () => ({ ok: true }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.issue_number, 100);
  assert.equal(out.reason, "no_merge_candidates");
  assert.deepEqual(out.blocked_by, [101]);
  assert.equal(out.blocked_without_relationship, false);
  assert.deepEqual(out.failures, []);
  // Verify close call is in the sequence
  const closeCall = calls.find((c) => c[0] === "issue" && c[1] === "close");
  assert.ok(closeCall, "should close issue");
});

test("blockReadyWaveIssue filters out wave marker issues from blockers", () => {
  const { fn } = mockGh();
  const out = blockReadyWaveIssue({
    repo: "r/r",
    readyIssueNumber: 100,
    milestoneTitle: "goal-1-wave-1",
    execGh: fn,
    listMilestoneOpenIssuesFn: () => [
      { number: 100, title: "Wave Ready: goal-1-wave-1" },
      { number: 101, title: "Wave Ready: goal-1-wave-2" },
    ],
    syncBlockedByFn: () => ({ ok: true }),
    releaseReadyWaveClaimFn: () => ({ ok: true }),
  });

  assert.deepEqual(out.blocked_by, []);
  assert.equal(out.blocked_without_relationship, true);
});

test("blockReadyWaveIssue sets blocked_without_relationship when no blockers found", () => {
  const { fn } = mockGh();
  const out = blockReadyWaveIssue({
    repo: "r/r",
    readyIssueNumber: 100,
    milestoneTitle: "goal-1-wave-1",
    execGh: fn,
    listMilestoneOpenIssuesFn: () => [],
    syncBlockedByFn: () => ({ ok: true }),
    releaseReadyWaveClaimFn: () => ({ ok: true }),
  });

  assert.equal(out.blocked_without_relationship, true);
  assert.deepEqual(out.blocked_by, []);
});

test("blockReadyWaveIssue correctly collects multiple blockers from milestone issues", () => {
  const { fn } = mockGh();
  const syncCalls = [];
  const out = blockReadyWaveIssue({
    repo: "recallnet/astrochicken",
    readyIssueNumber: "506",
    milestoneTitle: "goal-205-wave-2",
    reason: "no_merge_candidates",
    runId: "run-a",
    pipeline: "wave_execute",
    listMilestoneOpenIssuesFn: () => [
      { number: 506, title: "Wave Ready: goal-205-wave-2" },
      { number: 601, title: "Feature A" },
      { number: 602, title: "Feature B" },
      { number: 603, title: "Wave Ready: goal-205-wave-2" },
    ],
    execGh: fn,
    syncBlockedByFn: (payload) => { syncCalls.push(payload); return { ok: true }; },
    releaseReadyWaveClaimFn: () => ({ ok: true }),
  });

  assert.equal(out.ok, true);
  assert.deepEqual(out.blocked_by, [601, 602]);
  assert.equal(syncCalls.length, 1);
  assert.equal(syncCalls[0].blockedByRaw, "[601,602]");
});

test("blockReadyWaveIssue reads milestone issues through adapter when provided", () => {
  const { fn } = mockGh();
  const adapter = createTestAdapter({
    repo: "r/r",
    stubs: {
      issueList: () => [
        { number: 100, title: "Wave Ready: goal-1-wave-1" },
        { number: 101, title: "Feature A" },
      ],
    },
  });

  const out = blockReadyWaveIssue({
    repo: "r/r",
    readyIssueNumber: 100,
    milestoneTitle: "goal-1-wave-1",
    adapter,
    execGh: fn,
    listMilestoneOpenIssuesFn: () => {
      throw new Error("listMilestoneOpenIssuesFn must not be called when adapter is provided");
    },
    syncBlockedByFn: () => ({ ok: true }),
    releaseReadyWaveClaimFn: () => ({ ok: true }),
  });

  assert.equal(out.ok, true);
  assert.deepEqual(out.blocked_by, [101]);
  assert.equal(adapter.callsTo("issueList").length, 1);
});

// ---------------------------------------------------------------------------
// Reason-specific comment text
// ---------------------------------------------------------------------------

test("blockReadyWaveIssue uses judge_failed reason text", () => {
  const { fn, calls } = mockGh();
  blockReadyWaveIssue({
    repo: "r/r",
    readyIssueNumber: 100,
    reason: "judge_failed",
    execGh: fn,
    listMilestoneOpenIssuesFn: () => [],
    syncBlockedByFn: () => ({ ok: true }),
    releaseReadyWaveClaimFn: () => ({ ok: true }),
  });

  const commentCall = calls.find((c) => c[0] === "issue" && c[1] === "comment");
  assert.ok(commentCall);
  const body = commentCall[commentCall.length - 1];
  assert.ok(body.includes("judge"), "comment should mention judge failure");
});

test("blockReadyWaveIssue uses no_merge_candidates reason text", () => {
  const { fn, calls } = mockGh();
  blockReadyWaveIssue({
    repo: "r/r",
    readyIssueNumber: 100,
    reason: "no_merge_candidates",
    execGh: fn,
    listMilestoneOpenIssuesFn: () => [],
    syncBlockedByFn: () => ({ ok: true }),
    releaseReadyWaveClaimFn: () => ({ ok: true }),
  });

  const commentCall = calls.find((c) => c[0] === "issue" && c[1] === "comment");
  const body = commentCall[commentCall.length - 1];
  assert.ok(body.includes("no merge candidates"), "comment should mention no merge candidates");
});

// ---------------------------------------------------------------------------
// Failure paths
// ---------------------------------------------------------------------------

test("blockReadyWaveIssue records label edit failure", () => {
  const { fn } = mockGh({ labelOk: false });
  const out = blockReadyWaveIssue({
    repo: "r/r",
    readyIssueNumber: 100,
    execGh: fn,
    listMilestoneOpenIssuesFn: () => [],
    syncBlockedByFn: () => ({ ok: true }),
    releaseReadyWaveClaimFn: () => ({ ok: true }),
  });

  assert.equal(out.ok, false);
  assert.ok(out.failures.includes("label_edit_failed"));
});

test("blockReadyWaveIssue records lease release failure", () => {
  const { fn } = mockGh();
  const out = blockReadyWaveIssue({
    repo: "r/r",
    readyIssueNumber: 100,
    execGh: fn,
    listMilestoneOpenIssuesFn: () => [],
    syncBlockedByFn: () => ({ ok: true }),
    releaseReadyWaveClaimFn: () => ({ ok: false }),
  });

  assert.equal(out.ok, false);
  assert.ok(out.failures.includes("lease_release_failed"));
});

test("blockReadyWaveIssue records comment failure", () => {
  const { fn } = mockGh({ commentOk: false });
  const out = blockReadyWaveIssue({
    repo: "r/r",
    readyIssueNumber: 100,
    execGh: fn,
    listMilestoneOpenIssuesFn: () => [],
    syncBlockedByFn: () => ({ ok: true }),
    releaseReadyWaveClaimFn: () => ({ ok: true }),
  });

  assert.equal(out.ok, false);
  assert.ok(out.failures.includes("comment_failed"));
});

test("blockReadyWaveIssue records all failures when everything fails", () => {
  const { fn } = mockGh({ labelOk: false, commentOk: false });
  const out = blockReadyWaveIssue({
    repo: "r/r",
    readyIssueNumber: 100,
    execGh: fn,
    listMilestoneOpenIssuesFn: () => [],
    syncBlockedByFn: () => ({ ok: true }),
    releaseReadyWaveClaimFn: () => ({ ok: false }),
  });

  assert.equal(out.ok, false);
  assert.equal(out.failures.length, 3);
  assert.ok(out.failures.includes("label_edit_failed"));
  assert.ok(out.failures.includes("lease_release_failed"));
  assert.ok(out.failures.includes("comment_failed"));
});

test("blockReadyWaveIssue handles empty milestone gracefully", () => {
  const { fn } = mockGh();
  const out = blockReadyWaveIssue({
    repo: "r/r",
    readyIssueNumber: 100,
    milestoneTitle: "",
    execGh: fn,
    listMilestoneOpenIssuesFn: () => [],
    syncBlockedByFn: () => ({ ok: true }),
    releaseReadyWaveClaimFn: () => ({ ok: true }),
  });

  assert.equal(out.ok, true);
  assert.deepEqual(out.blocked_by, []);
});

// ---------------------------------------------------------------------------
// Issue closure — the #452 infinite loop fix
// ---------------------------------------------------------------------------

test("blockReadyWaveIssue closes the issue after stripping labels", () => {
  const { fn, calls } = mockGh();
  const out = blockReadyWaveIssue({
    repo: "r/r",
    readyIssueNumber: 100,
    milestoneTitle: "goal-1-wave-1",
    reason: "no_merge_candidates",
    execGh: fn,
    listMilestoneOpenIssuesFn: () => [],
    syncBlockedByFn: () => ({ ok: true }),
    releaseReadyWaveClaimFn: () => ({ ok: true }),
  });

  assert.equal(out.ok, true);
  const closeCall = calls.find((c) => c[0] === "issue" && c[1] === "close");
  assert.ok(closeCall, "blockReadyWaveIssue must close the issue to prevent infinite loop");
  assert.ok(closeCall.includes("--reason"), "should close with reason");
});

test("blockReadyWaveIssue records close failure", () => {
  const { fn } = mockGh({ closeOk: false });
  const out = blockReadyWaveIssue({
    repo: "r/r",
    readyIssueNumber: 100,
    execGh: fn,
    listMilestoneOpenIssuesFn: () => [],
    syncBlockedByFn: () => ({ ok: true }),
    releaseReadyWaveClaimFn: () => ({ ok: true }),
  });

  assert.equal(out.ok, false);
  assert.ok(out.failures.includes("close_failed"));
});
