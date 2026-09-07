// wave-handoff-between-nodes.contract.test.mjs
//
// Behavioral tests for wave-level handoffs between pipeline nodes.
// These test the actual function contracts when chained —
// not just that graph edges exist, but that outputs from one node
// feed correctly into the next and produce the right operational result.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildMergeReport } from "../src/commands/merge-item-ops.ts";
import { blockReadyWaveIssue } from "../src/commands/wave-block-ready.ts";
import { closeMergedIssues } from "../src/commands/wave-close-merged.ts";
import { buildWaveMergeResults, splitMergeResults } from "../src/commands/wave-merge-results.ts";
import { completeReadyWaveIssue } from "../src/lib/wave-ready-claim-ops.ts";

// ============================================================================
// A. Push success → closeMergedIssues handoff
// ============================================================================
// After a successful push, the wave_execute pipeline calls closeMergedIssues
// with the merge candidates. This tests the handoff from merge results
// to issue closure.

test("push success → closeMergedIssues closes all candidate issues and milestone issues", () => {
  const ghCalls = [];
  const candidates = JSON.stringify([
    { issue_number: "100", branch: "wave/goal-1-issue-100", merge_status: "merged" },
    { issue_number: "101", branch: "wave/goal-1-issue-101", merge_status: "merged" },
  ]);

  const out = closeMergedIssues({
    repo: "o/r",
    mergeCandidatesRaw: candidates,
    runId: "run-xyz",
    milestoneTitle: "goal-1-wave-1",
    execGh: (args) => {
      ghCalls.push(args);
      return { ok: true, stdout: "", stderr: "" };
    },
    listMilestoneOpenIssuesFn: () => [
      { number: 100, title: "Issue 100", labels: [] },
      { number: 101, title: "Issue 101", labels: [] },
      { number: 999, title: "Wave Ready: goal-1-wave-1", labels: [{ name: "ready" }] },
    ],
  });

  assert.equal(out.closed_count, 2, "should close both candidate issues");
  assert.equal(out.failed_count, 0, "no failures expected");
  assert.ok(out.closed.includes("100"), "issue 100 should be closed");
  assert.ok(out.closed.includes("101"), "issue 101 should be closed");
  // Wave marker should NOT be in closed list (filtered by isWaveMarker)
  assert.ok(!out.closed.includes("999"), "wave marker should not be closed by closeMergedIssues");
});

test("closeMergedIssues — partial close failure: comment succeeds but close fails", () => {
  const out = closeMergedIssues({
    repo: "o/r",
    mergeCandidatesRaw: JSON.stringify([
      { issue_number: "100", merge_status: "merged" },
      { issue_number: "101", merge_status: "merged" },
    ]),
    runId: "run-1",
    milestoneTitle: "goal-1-wave-1",
    execGh: (args) => {
      // Comment always succeeds, close fails for issue 101
      if (args.includes("close") && args.includes("101")) {
        return { ok: false, stdout: "", stderr: "close failed" };
      }
      return { ok: true, stdout: "", stderr: "" };
    },
    listMilestoneOpenIssuesFn: () => [],
  });

  assert.equal(out.closed_count, 1);
  assert.equal(out.failed_count, 1);
  assert.ok(out.closed.includes("100"));
  assert.ok(out.failed.includes("101"));
});

test("closeMergedIssues — milestone listing adds extra issues not in candidates", () => {
  const out = closeMergedIssues({
    repo: "o/r",
    mergeCandidatesRaw: JSON.stringify([{ issue_number: "100", merge_status: "merged" }]),
    runId: "run-1",
    milestoneTitle: "goal-1-wave-1",
    execGh: () => ({ ok: true, stdout: "", stderr: "" }),
    listMilestoneOpenIssuesFn: () => [
      { number: 100, title: "Issue 100", labels: [] },
      { number: 200, title: "Bonus issue from milestone", labels: [] },
    ],
  });

  // Both candidate (100) and milestone-only (200) issues should be closed
  assert.ok(out.closed.includes("100"));
  assert.ok(out.closed.includes("200"));
  assert.equal(out.closed_count, 2);
});

// ============================================================================
// B. buildMergeReport → buildWaveMergeResults → splitMergeResults chain
// ============================================================================
// Validates the data flow from per-issue merge reports through wave-level
// result aggregation.

test("buildMergeReport output feeds correctly into buildWaveMergeResults", () => {
  const report1 = buildMergeReport({
    issueNumber: "100",
    branch: "wave/goal-1-issue-100",
    mergeStatus: "merged",
    notes: "clean merge",
    mergeResolver: "deterministic",
    pathTaken: "merge",
  });
  const report2 = buildMergeReport({
    issueNumber: "101",
    branch: "wave/goal-1-issue-101",
    mergeStatus: "failed",
    notes: "conflict in src/main.ts",
    mergeResolver: "deterministic",
    pathTaken: "merge",
  });

  const candidates = JSON.stringify([report1, report2]);
  const results = buildWaveMergeResults({
    mergeCandidatesRaw: candidates,
    mergeStatus: "merged",
    mergeNotes: "",
    mergeResolver: "deterministic",
    pathTaken: "merge",
  });

  assert.equal(results.merged_count + results.failed_count, 2, "all candidates accounted for");

  // splitMergeResults should produce the same shape
  const split = splitMergeResults(candidates);
  assert.equal(split.merged_count + split.failed_count, 2);
  assert.ok(Array.isArray(split.merged_results));
  assert.ok(Array.isArray(split.merge_failures));
});

test("buildMergeReport preserves telemetry dimensions through chain", () => {
  const report = buildMergeReport({
    issueNumber: "100",
    branch: "wave/goal-1-issue-100",
    mergeStatus: "merged",
    mergeResolver: "llm",
    pathTaken: "rebase_conflict_resolve",
  });

  assert.equal(report["hatch.merge.resolver"], "llm");
  assert.equal(report.path_taken, "rebase_conflict_resolve");
  assert.equal(report.merge_status, "merged");
});

// ============================================================================
// C. No-merge path: zero candidates → blockReadyWaveIssue
// ============================================================================
// When merge_candidates_gate detects merged_count=0, wave_execute routes
// to unlock_no_merge → blockReadyWaveIssue with reason "no_merge_candidates".

test("no-merge path — blockReadyWaveIssue blocks marker with correct reason", () => {
  const ghCalls = [];

  const out = blockReadyWaveIssue({
    repo: "o/r",
    readyIssueNumber: "500",
    milestoneTitle: "goal-1-wave-1",
    reason: "no_merge_candidates",
    runId: "run-xyz",
    pipeline: "wave_execute",
    execGh: (args) => {
      ghCalls.push(args);
      return { ok: true, stdout: "", stderr: "" };
    },
    listMilestoneOpenIssuesFn: () => [
      { number: 500, title: "Wave Ready: goal-1-wave-1", labels: [{ name: "ready" }] },
      { number: 100, title: "Feature issue", labels: [] },
    ],
    syncBlockedByFn: (opts) => ({ synced: true, added: 1, removed: 0 }),
    releaseReadyWaveClaimFn: () => ({ ok: true }),
  });

  assert.equal(out.ok, true, "block should succeed");
  assert.equal(out.reason, "no_merge_candidates");
  assert.equal(out.issue_number, 500);
  // Blockers should be the feature issues (not the wave marker itself)
  assert.ok(out.blocked_by.includes(100), "feature issue should be in blocked_by list");
  assert.ok(!out.blocked_by.includes(500), "wave marker should not block itself");
  // Should close the marker
  const closeCall = ghCalls.find((c) => c.includes("close"));
  assert.ok(closeCall, "marker must be closed");
  assert.ok(closeCall.includes("not planned"), "close reason must be 'not planned'");
});

test("no-merge path — blockReadyWaveIssue with no feature issues sets blocked_without_relationship", () => {
  const out = blockReadyWaveIssue({
    repo: "o/r",
    readyIssueNumber: "500",
    milestoneTitle: "goal-1-wave-1",
    reason: "no_merge_candidates",
    execGh: () => ({ ok: true, stdout: "", stderr: "" }),
    listMilestoneOpenIssuesFn: () => [
      { number: 500, title: "Wave Ready: goal-1-wave-1", labels: [] },
    ],
    syncBlockedByFn: () => ({ synced: true, added: 0, removed: 0 }),
    releaseReadyWaveClaimFn: () => ({ ok: true }),
  });

  assert.equal(out.blocked_without_relationship, true, "should flag no blocker relationship");
  assert.deepEqual(out.blocked_by, []);
});

// ============================================================================
// D. Success path: completeReadyWaveIssue verifies claim → close marker
// ============================================================================
// After judge pass, wave_execute calls completeReadyWaveIssue which must
// validate ownership, check milestone emptiness, then close the marker.

test("success path — completeReadyWaveIssue closes marker when milestone is empty", () => {
  const ghCalls = [];

  const out = completeReadyWaveIssue({
    repo: "o/r",
    readyIssueNumber: "500",
    milestoneTitle: "goal-1-wave-1",
    claimToken: "tok-abc",
    claimOwnerId: "worker-1",
    claimRunId: "run-xyz",
    claimValidator: () => ({ ok: true, valid: true }),
    claimReleaser: () => ({ ok: true, released: true, reason: "wave_completed" }),
    execGh: (args) => {
      ghCalls.push(args);
      return { ok: true, stdout: "", stderr: "" };
    },
    listMilestoneOpenIssuesFn: () => [
      // Only wave marker remains — feature issues already closed
      { number: 500, title: "Wave Ready: goal-1-wave-1", labels: [{ name: "ready" }] },
    ],
  });

  assert.equal(out.ok, true);
  assert.equal(out.completed, true);
  assert.equal(out.ownership_valid, true);
  assert.equal(out.reason, "wave_completed");
  // Must post lease release event before close
  const commentCalls = ghCalls.filter((c) => c.includes("comment"));
  assert.ok(commentCalls.length >= 2, "must post lease event comment and completion comment");
  // Must close the marker
  const closeCall = ghCalls.find((c) => c.includes("close"));
  assert.ok(closeCall, "marker must be closed");
  assert.ok(closeCall.includes("completed"), "close reason must be 'completed'");
});

test("success path — completeReadyWaveIssue refuses when open feature issues remain", () => {
  const out = completeReadyWaveIssue({
    repo: "o/r",
    readyIssueNumber: "500",
    milestoneTitle: "goal-1-wave-1",
    claimValidator: () => ({ ok: true, valid: true }),
    claimReleaser: () => ({ ok: true, released: true }),
    execGh: () => ({ ok: true }),
    listMilestoneOpenIssuesFn: () => [
      { number: 500, title: "Wave Ready: goal-1-wave-1", labels: [] },
      { number: 100, title: "Unfinished feature", labels: [] },
    ],
  });

  assert.equal(out.completed, false);
  assert.equal(out.reason, "milestone_open_issues_remaining");
  assert.equal(out.short_circuited, true);
  assert.ok(out.remaining_open_issue_numbers.includes("100"));
});

test("success path — completeReadyWaveIssue refuses when claim validation fails", () => {
  const out = completeReadyWaveIssue({
    repo: "o/r",
    readyIssueNumber: "500",
    milestoneTitle: "goal-1-wave-1",
    claimValidator: () => ({ ok: true, valid: false, reason: "claim_expired" }),
    claimReleaser: () => ({ ok: true, released: true }),
    execGh: () => ({ ok: true }),
    listMilestoneOpenIssuesFn: () => [],
  });

  assert.equal(out.completed, false);
  assert.equal(out.ownership_valid, false);
  assert.equal(out.short_circuited, true);
});

// ============================================================================
// E. Graph: all terminal paths converge at release_merge_lock
// ============================================================================

test("wave_execute.dot — all terminal paths release merge lock before done", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/wave_execute.dot", "utf8");
  // success terminal
  assert.match(dot, /finalize_from_close[\s\S]*?release_merge_lock/, "close terminal must reach release_merge_lock");
  // no-merge terminal
  assert.match(dot, /finalize_from_no_merge[\s\S]*?release_merge_lock/, "no-merge terminal must reach release_merge_lock");
  // fail terminal
  assert.match(dot, /finalize_from_fail[\s\S]*?release_merge_lock/, "fail terminal must reach release_merge_lock");
  // release_merge_lock → done chain
  assert.match(dot, /release_merge_lock/, "release_merge_lock node must exist");
});

test("wave_execute.dot — push failure routes through packet → resolver → retry → push", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/wave_execute.dot", "utf8");
  assert.match(dot, /push_gate[\s\S]*?build_push_failure_packet/, "push failure must build packet");
  assert.match(dot, /build_push_failure_packet[\s\S]*?resolve_push_failure/, "packet must route to resolver");
  assert.match(dot, /resolve_push_failure[\s\S]*?retry_push_main/, "resolver must route to retry push");
});
