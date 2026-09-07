import assert from "node:assert/strict";
import test from "node:test";

import { accumulateMilestoneResult, accumulateMilestoneBatchResults } from "../../src/commands/milestone-accumulate.ts";

// ─── accumulateMilestoneResult ───────────────────────────────────────────────

test("accumulateMilestoneResult appends item and marks completed on success", () => {
  const out = accumulateMilestoneResult({
    implResultsRaw: "[]",
    completedRaw: "[]",
    processedRaw: "[]",
    itemRaw: JSON.stringify({ issue_number: "123", review_failed: "false" }),
  });
  assert.equal(out.impl_results.length, 1);
  assert.deepEqual(out.completed_issues, ["123"]);
  assert.deepEqual(out.processed_issues, ["123"]);
  assert.equal(out.last_review_failed, "false");
  assert.equal(out.last_issue_number, "123");
});

test("accumulateMilestoneResult does not mark completed on review failure", () => {
  const out = accumulateMilestoneResult({
    implResultsRaw: "[]",
    completedRaw: "[]",
    processedRaw: "[]",
    itemRaw: JSON.stringify({ issue_number: "123", review_failed: "true" }),
  });
  assert.equal(out.impl_results.length, 1);
  assert.deepEqual(out.completed_issues, []);
  assert.deepEqual(out.processed_issues, ["123"]);
  assert.equal(out.last_review_failed, "true");
});

test("accumulateMilestoneResult skips unattempted issue (no execution evidence) instead of marking failed", () => {
  const out = accumulateMilestoneResult({
    implResultsRaw: "[]",
    completedRaw: "[]",
    processedRaw: "[]",
    itemRaw: "{}",
    fallbackIssueNumber: "230",
    fallbackIssueTitle: "Scheduler",
  });
  // Issue was never executed (no branch, worktree, or evidence). It should NOT
  // appear in impl_results as a failure — that would trigger quarantine.
  assert.equal(out.impl_results.length, 0);
  assert.deepEqual(out.completed_issues, []);
  // Not added to processed either — it was never attempted
  assert.deepEqual(out.processed_issues, []);
});

test("accumulateMilestoneResult marks failed when execution evidence exists but review_failed missing", () => {
  const out = accumulateMilestoneResult({
    implResultsRaw: "[]",
    completedRaw: "[]",
    processedRaw: "[]",
    itemRaw: JSON.stringify({ branch: "goal/123", worktree_dir: "/tmp/goal-123" }),
    fallbackIssueNumber: "230",
    fallbackIssueTitle: "Scheduler",
  });
  // Has execution evidence (branch + worktree) but no review_failed — coder ran
  // but review was skipped. This IS a real failure.
  assert.equal(out.impl_results.length, 1);
  assert.equal(out.impl_results[0].review_failed, "true");
  assert.match(out.impl_results[0].review_notes, /Missing impl_result payload/);
});

test("accumulateMilestoneResult preserves shared branch/worktree context for subsequent issues", () => {
  const out = accumulateMilestoneResult({
    implResultsRaw: JSON.stringify([
      { issue_number: "525", branch: "wave/goal-321-wave-1", worktree_dir: "/tmp/wave-321", review_evidence_path: "/tmp/wave-321/.hatch/review/525.json" },
    ]),
    completedRaw: '["525"]',
    processedRaw: '["525"]',
    itemRaw: JSON.stringify({ issue_number: "526", review_failed: "false" }),
  });
  assert.equal(out.branch, "wave/goal-321-wave-1");
  assert.equal(out.worktree_dir, "/tmp/wave-321");
  assert.equal(out.last_review_evidence_path, "/tmp/wave-321/.hatch/review/525.json");
  assert.equal(out.last_branch, "");
  assert.deepEqual(out.completed_issues, ["525", "526"]);
});

test("accumulateMilestoneResult uses item branch/worktree when present", () => {
  const out = accumulateMilestoneResult({
    implResultsRaw: "[]",
    completedRaw: "[]",
    processedRaw: "[]",
    itemRaw: JSON.stringify({
      issue_number: "10",
      review_failed: "false",
      branch: "wave/goal-5-wave-1",
      worktree_dir: "/tmp/wave-5",
      review_evidence_path: "/tmp/wave-5/.hatch/review/10.json",
    }),
  });
  assert.equal(out.branch, "wave/goal-5-wave-1");
  assert.equal(out.worktree_dir, "/tmp/wave-5");
  assert.equal(out.last_branch, "wave/goal-5-wave-1");
  assert.equal(out.last_review_evidence_path, "/tmp/wave-5/.hatch/review/10.json");
});

test("accumulateMilestoneResult returns defaults with no arguments", () => {
  const out = accumulateMilestoneResult();
  assert.deepEqual(out.impl_results, []);
  assert.deepEqual(out.completed_issues, []);
  assert.deepEqual(out.processed_issues, []);
  assert.equal(out.last_review_failed, "false");
  assert.equal(out.last_review_notes, "");
  assert.equal(out.last_issue_number, "");
  assert.equal(out.last_branch, "");
  assert.equal(out.branch, "");
  assert.equal(out.worktree_dir, "");
  assert.equal(out.last_review_evidence_path, "");
});

test("accumulateMilestoneResult returns defaults with empty object", () => {
  const out = accumulateMilestoneResult({});
  assert.deepEqual(out.impl_results, []);
  assert.deepEqual(out.completed_issues, []);
  assert.deepEqual(out.processed_issues, []);
  assert.equal(out.last_review_failed, "false");
});

test("accumulateMilestoneResult handles empty itemRaw string", () => {
  const out = accumulateMilestoneResult({ itemRaw: "" });
  assert.deepEqual(out.impl_results, []);
  assert.equal(out.last_issue_number, "");
});

test("accumulateMilestoneResult handles null-ish raw inputs gracefully", () => {
  const out = accumulateMilestoneResult({
    implResultsRaw: null,
    completedRaw: null,
    processedRaw: null,
    itemRaw: null,
    fallbackIssueNumber: null,
    fallbackIssueTitle: null,
  });
  assert.deepEqual(out.impl_results, []);
  assert.deepEqual(out.completed_issues, []);
  assert.deepEqual(out.processed_issues, []);
  assert.equal(out.last_issue_number, "");
});

test("accumulateMilestoneResult does not duplicate processed/completed entries", () => {
  const out = accumulateMilestoneResult({
    implResultsRaw: "[]",
    completedRaw: '["100"]',
    processedRaw: '["100"]',
    itemRaw: JSON.stringify({ issue_number: "100", review_failed: "false" }),
  });
  assert.deepEqual(out.processed_issues, ["100"]);
  assert.deepEqual(out.completed_issues, ["100"]);
  assert.equal(out.impl_results.length, 1);
});

test("accumulateMilestoneResult handles double-encoded JSON itemRaw", () => {
  const inner = { issue_number: "42", review_failed: "false", branch: "wave/x" };
  const doubleEncoded = JSON.stringify(JSON.stringify(inner));
  const out = accumulateMilestoneResult({ itemRaw: doubleEncoded });
  assert.equal(out.impl_results.length, 1);
  assert.equal(out.impl_results[0].issue_number, "42");
  assert.equal(out.last_issue_number, "42");
  assert.equal(out.branch, "wave/x");
});

test("accumulateMilestoneResult uses fallbackIssueNumber when item has no issue_number", () => {
  const out = accumulateMilestoneResult({
    itemRaw: JSON.stringify({ review_failed: "false", branch: "wave/b" }),
    fallbackIssueNumber: "999",
    fallbackIssueTitle: "Fallback Title",
  });
  assert.equal(out.last_issue_number, "999");
  assert.equal(out.impl_results[0].issue_number, "999");
  assert.equal(out.impl_results[0].issue_title, "Fallback Title");
});

test("accumulateMilestoneResult rewrites stale impl_result issue identity to the current fallback issue", () => {
  const out = accumulateMilestoneResult({
    itemRaw: JSON.stringify({
      issue_number: "2381",
      issue_title: "Old Issue",
      review_failed: "false",
      review_notes: "approved elsewhere",
      branch: "goal/2235",
    }),
    fallbackIssueNumber: "2383",
    fallbackIssueTitle: "Current Issue",
  });
  assert.equal(out.last_issue_number, "2383");
  assert.equal(out.last_review_failed, "true");
  assert.equal(out.impl_results[0].issue_number, "2383");
  assert.equal(out.impl_results[0].issue_title, "Current Issue");
  assert.equal(out.impl_results[0].stale_impl_result_issue_number, "2381");
  assert.match(out.impl_results[0].review_notes, /Stale impl_result for issue 2381/);
  assert.deepEqual(out.completed_issues, []);
  assert.deepEqual(out.processed_issues, ["2383"]);
});

test("accumulateMilestoneResult does not overwrite existing issue_title with fallback", () => {
  const out = accumulateMilestoneResult({
    itemRaw: JSON.stringify({ issue_number: "10", issue_title: "Original", review_failed: "false" }),
    fallbackIssueTitle: "Should Not Override",
  });
  assert.equal(out.impl_results[0].issue_title, "Original");
});

test("accumulateMilestoneResult preserves existing review_failed and does not override with default", () => {
  const out = accumulateMilestoneResult({
    itemRaw: JSON.stringify({ issue_number: "50", review_failed: "false" }),
  });
  assert.equal(out.impl_results[0].review_failed, "false");
  assert.equal(out.last_review_failed, "false");
  assert.deepEqual(out.completed_issues, ["50"]);
});

test("accumulateMilestoneResult skips item with issue_number but no execution evidence", () => {
  const out = accumulateMilestoneResult({
    itemRaw: JSON.stringify({ issue_number: "77" }),
  });
  // No branch/worktree/evidence → not attempted, skip
  assert.equal(out.impl_results.length, 0);
  assert.deepEqual(out.completed_issues, []);
});

test("accumulateMilestoneResult handles invalid JSON in implResultsRaw", () => {
  const out = accumulateMilestoneResult({
    implResultsRaw: "not json",
    itemRaw: JSON.stringify({ issue_number: "1", review_failed: "false" }),
  });
  assert.equal(out.impl_results.length, 1);
  assert.deepEqual(out.completed_issues, ["1"]);
});

test("accumulateMilestoneResult handles invalid JSON in completedRaw/processedRaw", () => {
  const out = accumulateMilestoneResult({
    completedRaw: "{bad}",
    processedRaw: "{bad}",
    itemRaw: JSON.stringify({ issue_number: "2", review_failed: "false" }),
  });
  assert.equal(out.impl_results.length, 1);
  assert.deepEqual(out.completed_issues, ["2"]);
  assert.deepEqual(out.processed_issues, ["2"]);
});

test("accumulateMilestoneResult accumulates on top of existing implResults", () => {
  const existing = [{ issue_number: "10", review_failed: "false" }];
  const out = accumulateMilestoneResult({
    implResultsRaw: JSON.stringify(existing),
    completedRaw: '["10"]',
    processedRaw: '["10"]',
    itemRaw: JSON.stringify({ issue_number: "11", review_failed: "false" }),
  });
  assert.equal(out.impl_results.length, 2);
  assert.deepEqual(out.completed_issues, ["10", "11"]);
  assert.deepEqual(out.processed_issues, ["10", "11"]);
});

test("accumulateMilestoneResult trims whitespace from issue numbers", () => {
  const out = accumulateMilestoneResult({
    itemRaw: JSON.stringify({ issue_number: "  55  ", review_failed: "false" }),
  });
  assert.equal(out.last_issue_number, "55");
});

test("accumulateMilestoneResult trims whitespace from fallback issue number", () => {
  const out = accumulateMilestoneResult({
    itemRaw: "{}",
    fallbackIssueNumber: "  88  ",
  });
  assert.equal(out.last_issue_number, "88");
});

// ─── accumulateMilestoneBatchResults ─────────────────────────────────────────

test("accumulateMilestoneBatchResults accumulates multiple items", () => {
  const out = accumulateMilestoneBatchResults({
    implResultsRaw: "[]",
    completedRaw: "[]",
    processedRaw: "[]",
    itemsRaw: JSON.stringify([
      { issue_number: "901", review_failed: "false", branch: "wave/goal-900-wave-1", worktree_dir: "/tmp/wave-900" },
      { issue_number: "902", review_failed: "true", review_notes: "needs revision", branch: "wave/goal-900-wave-1", worktree_dir: "/tmp/wave-900" },
      { issue_number: "903", review_failed: "false", branch: "wave/goal-900-wave-1", worktree_dir: "/tmp/wave-900" },
    ]),
  });
  assert.equal(out.impl_results.length, 3);
  assert.deepEqual(out.completed_issues, ["901", "903"]);
  assert.deepEqual(out.processed_issues, ["901", "902", "903"]);
  // firstFailed should sticky the first failure diagnostics
  assert.equal(out.last_review_failed, "true");
  assert.equal(out.last_issue_number, "902");
  assert.equal(out.last_review_notes, "needs revision");
});

test("accumulateMilestoneBatchResults returns defaults for empty items array", () => {
  const out = accumulateMilestoneBatchResults({
    implResultsRaw: "[]",
    completedRaw: "[]",
    processedRaw: "[]",
    itemsRaw: "[]",
  });
  assert.deepEqual(out.impl_results, []);
  assert.deepEqual(out.completed_issues, []);
  assert.deepEqual(out.processed_issues, []);
  assert.equal(out.last_review_failed, "false");
  assert.equal(out.last_review_notes, "");
  assert.equal(out.last_issue_number, "");
  assert.equal(out.branch, "");
  assert.equal(out.worktree_dir, "");
});

test("accumulateMilestoneBatchResults returns defaults with no arguments", () => {
  const out = accumulateMilestoneBatchResults();
  assert.deepEqual(out.impl_results, []);
  assert.deepEqual(out.completed_issues, []);
  assert.deepEqual(out.processed_issues, []);
  assert.equal(out.last_review_failed, "false");
});

test("accumulateMilestoneBatchResults returns defaults with empty object", () => {
  const out = accumulateMilestoneBatchResults({});
  assert.deepEqual(out.impl_results, []);
  assert.equal(out.last_review_failed, "false");
});

test("accumulateMilestoneBatchResults handles invalid JSON in itemsRaw", () => {
  const out = accumulateMilestoneBatchResults({
    itemsRaw: "not json",
  });
  assert.deepEqual(out.impl_results, []);
  assert.equal(out.last_review_failed, "false");
});

test("accumulateMilestoneBatchResults handles null itemsRaw", () => {
  const out = accumulateMilestoneBatchResults({
    itemsRaw: null,
  });
  assert.deepEqual(out.impl_results, []);
});

test("accumulateMilestoneBatchResults all items pass review", () => {
  const out = accumulateMilestoneBatchResults({
    itemsRaw: JSON.stringify([
      { issue_number: "1", review_failed: "false", branch: "wave/b" },
      { issue_number: "2", review_failed: "false", branch: "wave/b" },
    ]),
  });
  assert.equal(out.impl_results.length, 2);
  assert.deepEqual(out.completed_issues, ["1", "2"]);
  assert.deepEqual(out.processed_issues, ["1", "2"]);
  assert.equal(out.last_review_failed, "false");
  assert.equal(out.last_review_notes, "");
  assert.equal(out.branch, "wave/b");
});

test("accumulateMilestoneBatchResults sticky first-failure over subsequent failures", () => {
  const out = accumulateMilestoneBatchResults({
    itemsRaw: JSON.stringify([
      { issue_number: "10", review_failed: "true", review_notes: "first fail", branch: "wave/a" },
      { issue_number: "11", review_failed: "true", review_notes: "second fail", branch: "wave/a" },
    ]),
  });
  // firstFailed should be from issue 10
  assert.equal(out.last_issue_number, "10");
  assert.equal(out.last_review_notes, "first fail");
  assert.equal(out.last_review_failed, "true");
  assert.deepEqual(out.completed_issues, []);
  assert.deepEqual(out.processed_issues, ["10", "11"]);
});

test("accumulateMilestoneBatchResults preserves branch from first item for all subsequent", () => {
  const out = accumulateMilestoneBatchResults({
    itemsRaw: JSON.stringify([
      { issue_number: "1", review_failed: "false", branch: "wave/goal-1-wave-1", worktree_dir: "/tmp/w1" },
      { issue_number: "2", review_failed: "false" },
      { issue_number: "3", review_failed: "false" },
    ]),
  });
  assert.equal(out.branch, "wave/goal-1-wave-1");
  assert.equal(out.worktree_dir, "/tmp/w1");
});

test("accumulateMilestoneBatchResults accumulates onto existing state", () => {
  const out = accumulateMilestoneBatchResults({
    implResultsRaw: JSON.stringify([{ issue_number: "100", review_failed: "false" }]),
    completedRaw: '["100"]',
    processedRaw: '["100"]',
    itemsRaw: JSON.stringify([
      { issue_number: "101", review_failed: "false" },
    ]),
  });
  assert.equal(out.impl_results.length, 2);
  assert.deepEqual(out.completed_issues, ["100", "101"]);
  assert.deepEqual(out.processed_issues, ["100", "101"]);
});

test("accumulateMilestoneBatchResults uses number as fallback for issue_number", () => {
  const out = accumulateMilestoneBatchResults({
    itemsRaw: JSON.stringify([
      { number: "77", title: "My Title", review_failed: "false" },
    ]),
  });
  assert.equal(out.impl_results.length, 1);
  assert.equal(out.impl_results[0].issue_number, "77");
  assert.deepEqual(out.processed_issues, ["77"]);
});

test("accumulateMilestoneBatchResults uses title as fallback for issue_title (with execution evidence)", () => {
  const out = accumulateMilestoneBatchResults({
    itemsRaw: JSON.stringify([
      { number: "88", title: "Fallback Title", branch: "wave/goal-88", review_failed: "false" },
    ]),
  });
  assert.equal(out.impl_results[0].issue_title, "Fallback Title");
});

test("accumulateMilestoneBatchResults single item batch", () => {
  const out = accumulateMilestoneBatchResults({
    itemsRaw: JSON.stringify([
      { issue_number: "5", review_failed: "false", branch: "wave/x", worktree_dir: "/tmp/x" },
    ]),
  });
  assert.equal(out.impl_results.length, 1);
  assert.deepEqual(out.completed_issues, ["5"]);
  assert.deepEqual(out.processed_issues, ["5"]);
  assert.equal(out.branch, "wave/x");
  assert.equal(out.worktree_dir, "/tmp/x");
  assert.equal(out.last_review_failed, "false");
});

test("accumulateMilestoneBatchResults skips items with no execution evidence", () => {
  const out = accumulateMilestoneBatchResults({
    itemsRaw: JSON.stringify([
      { issue_number: "60" },
    ]),
  });
  // No branch/worktree → not attempted, skip
  assert.equal(out.impl_results.length, 0);
  assert.deepEqual(out.completed_issues, []);
});

test("accumulateMilestoneBatchResults non-array itemsRaw parsed object is treated as empty queue", () => {
  const out = accumulateMilestoneBatchResults({
    itemsRaw: JSON.stringify({ not: "an array" }),
  });
  assert.deepEqual(out.impl_results, []);
  assert.equal(out.last_review_failed, "false");
});

// ─── consecutive_fail_count ─────────────────────────────────────────────────

test("accumulateMilestoneResult tracks consecutive_fail_count on failure", () => {
  const out = accumulateMilestoneResult({
    implResultsRaw: "[]",
    completedRaw: "[]",
    processedRaw: "[]",
    itemRaw: JSON.stringify({ issue_number: "1", review_failed: "true" }),
    consecutiveFailCountRaw: "0",
  });
  assert.equal(out.consecutive_fail_count, 1);
});

test("accumulateMilestoneResult increments consecutive_fail_count across failures", () => {
  const out = accumulateMilestoneResult({
    implResultsRaw: "[]",
    completedRaw: "[]",
    processedRaw: "[]",
    itemRaw: JSON.stringify({ issue_number: "2", review_failed: "true" }),
    consecutiveFailCountRaw: "2",
  });
  assert.equal(out.consecutive_fail_count, 3);
});

test("accumulateMilestoneResult resets consecutive_fail_count on success", () => {
  const out = accumulateMilestoneResult({
    implResultsRaw: "[]",
    completedRaw: "[]",
    processedRaw: "[]",
    itemRaw: JSON.stringify({ issue_number: "3", review_failed: "false" }),
    consecutiveFailCountRaw: "5",
  });
  assert.equal(out.consecutive_fail_count, 0);
});

test("accumulateMilestoneResult defaults consecutive_fail_count to 0", () => {
  const out = accumulateMilestoneResult({
    implResultsRaw: "[]",
    completedRaw: "[]",
    processedRaw: "[]",
    itemRaw: JSON.stringify({ issue_number: "4", review_failed: "false" }),
  });
  assert.equal(out.consecutive_fail_count, 0);
});

test("accumulateMilestoneResult detects stale impl_result leak when impl_result carries previous iteration issue number", () => {
  // Simulates the bug: issue 1327 completes successfully, producing impl_result with issue_number=1327.
  // On the next iteration (issue 1328), if impl_result is NOT cleared, the accumulator receives
  // impl_result from issue 1327 while fallbackIssueNumber is 1328.
  // The accumulator must detect this mismatch and mark it as a stale leak failure.
  const staleImplResult = {
    issue_number: "1327",
    issue_title: "Previous issue (already closed)",
    review_failed: "false",
    review_notes: "All tests pass",
    branch: "wave/goal-500-wave-1",
    worktree_dir: "/tmp/wave-500",
  };

  const out = accumulateMilestoneResult({
    implResultsRaw: JSON.stringify([
      { issue_number: "1327", review_failed: "false", branch: "wave/goal-500-wave-1", worktree_dir: "/tmp/wave-500" },
    ]),
    completedRaw: '["1327"]',
    processedRaw: '["1327"]',
    itemRaw: JSON.stringify(staleImplResult),
    fallbackIssueNumber: "1328",
    fallbackIssueTitle: "Current issue being processed",
  });

  // The accumulator must detect the mismatch and mark it failed
  assert.equal(out.last_review_failed, "true", "stale impl_result must be marked as failed");
  assert.equal(out.last_issue_number, "1328", "issue number must be corrected to the current iteration");
  assert.equal(out.impl_results[out.impl_results.length - 1].issue_number, "1328");
  assert.equal(out.impl_results[out.impl_results.length - 1].stale_impl_result_issue_number, "1327");
  assert.match(out.impl_results[out.impl_results.length - 1].review_notes, /Stale impl_result for issue 1327/);
  // The completed list must NOT include 1328 since it was marked failed
  assert.ok(!out.completed_issues.includes("1328"), "stale-leaked issue must not be in completed list");
});

test("accumulateMilestoneResult does NOT flag stale when impl_result issue matches current issue", () => {
  // When impl_result is properly cleared and re-set, the issue_number matches the fallback.
  // No stale detection should trigger.
  const freshImplResult = {
    issue_number: "1328",
    issue_title: "Current issue being processed",
    review_failed: "false",
    review_notes: "All tests pass",
    branch: "wave/goal-500-wave-1",
  };

  const out = accumulateMilestoneResult({
    implResultsRaw: JSON.stringify([
      { issue_number: "1327", review_failed: "false", branch: "wave/goal-500-wave-1" },
    ]),
    completedRaw: '["1327"]',
    processedRaw: '["1327"]',
    itemRaw: JSON.stringify(freshImplResult),
    fallbackIssueNumber: "1328",
    fallbackIssueTitle: "Current issue being processed",
  });

  assert.equal(out.last_review_failed, "false", "fresh impl_result must NOT be marked as failed");
  assert.equal(out.last_issue_number, "1328");
  assert.ok(out.completed_issues.includes("1328"), "properly matched issue should be completed");
  assert.ok(!out.impl_results[out.impl_results.length - 1].stale_impl_result_issue_number, "no stale marker on fresh result");
});

test("accumulateMilestoneBatchResults review_evidence_path from first failure is sticky", () => {
  const out = accumulateMilestoneBatchResults({
    itemsRaw: JSON.stringify([
      { issue_number: "1", review_failed: "true", review_notes: "bad", branch: "wave/a", review_evidence_path: "/tmp/evidence/1.json" },
      { issue_number: "2", review_failed: "false", branch: "wave/a" },
    ]),
  });
  assert.equal(out.last_review_evidence_path, "/tmp/evidence/1.json");
  assert.equal(out.last_issue_number, "1");
});
