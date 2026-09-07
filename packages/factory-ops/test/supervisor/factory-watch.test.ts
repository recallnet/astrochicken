import assert from "node:assert/strict";
import test from "node:test";

import { extractRunOutcome, formatWatchEvent, formatWatchSummary } from "../../src/commands/factory-watch.ts";

test("extractRunOutcome: wave_issue_execute with approve", () => {
  const state = {
    graph: "/path/to/wave_issue_execute.dot",
    context: {
      review_verdict: "approve",
      review_failed: "false",
      review_attempt: "2",
      snapshot_sha: "abc1234567890",
      review_notes: "Approved. QA contract satisfied.",
    },
  };
  const out = extractRunOutcome(state);
  assert.equal(out.review_verdict, "approve");
  assert.equal(out.review_failed, "false");
  assert.equal(out.review_attempt, "2");
  assert.equal(out.snapshot_sha, "abc1234");
  assert.match(out.review_notes_excerpt, /Approved/);
});

test("extractRunOutcome: wave_issue_execute with revise", () => {
  const state = {
    graph: "/path/to/wave_issue_execute.dot",
    context: {
      review_verdict: "revise",
      review_failed: "true",
      review_attempt: "3",
      snapshot_sha: "def5678901234",
      review_notes: "QA_EVIDENCE_REQUIRED: qa.status=fail",
    },
  };
  const out = extractRunOutcome(state);
  assert.equal(out.review_verdict, "revise");
  assert.equal(out.review_failed, "true");
  assert.match(out.review_notes_excerpt, /QA_EVIDENCE_REQUIRED/);
});

test("extractRunOutcome: wave_issue_execute with done_elsewhere precheck", () => {
  const state = {
    graph: "/path/to/wave_issue_execute.dot",
    context: {
      precheck_reason: "issue_scoped_zero_delta_with_passing_qa",
      review_evidence_path: "/tmp/.hatch/review/1172.json",
      impl_result: JSON.stringify({
        issue_number: "1172",
        review_failed: "false",
        disposition: "done_elsewhere",
        decision_confidence: "high",
        review_notes: "Zero-delta precheck short-circuited implementation.",
      }),
    },
  };
  const out = extractRunOutcome(state);
  assert.equal(out.review_verdict, "done_elsewhere");
  assert.equal(out.review_failed, "false");
  assert.equal(out.disposition, "done_elsewhere");
  assert.equal(out.decision_confidence, "high");
  assert.equal(out.precheck_reason, "issue_scoped_zero_delta_with_passing_qa");
});

test("extractRunOutcome: milestone_execute with mixed results", () => {
  const state = {
    graph: "/path/to/milestone_execute.dot",
    context: {
      completed_issues: '["420","419"]',
      processed_issues: '["420","419","409"]',
      impl_results: JSON.stringify([
        { issue_number: "420", review_failed: "false" },
        { issue_number: "419", review_failed: "false" },
        { issue_number: "409", review_failed: "true" },
      ]),
    },
  };
  const out = extractRunOutcome(state);
  assert.equal(out.completed_count, 2);
  assert.equal(out.processed_count, 3);
  assert.equal(out.impl_results_count, 3);
  assert.deepEqual(out.approved, ["#420", "#419"]);
  assert.deepEqual(out.failed, ["#409"]);
});

test("extractRunOutcome: uses pipeline field (real state.json format)", () => {
  const state = {
    pipeline: "/path/to/wave_issue_execute.dot",
    context: { review_verdict: "approve", review_failed: "false", review_attempt: "1" },
  };
  const out = extractRunOutcome(state);
  assert.equal(out.review_verdict, "approve");
});

test("extractRunOutcome: wave_execute with merge", () => {
  const state = {
    pipeline: "/path/to/wave_execute.dot",
    context: {
      has_merge_candidates: "true",
      merged_count: "2",
      failed_count: "0",
      merge_status: "merged",
      branch: "wave/goal-333-wave-3",
      claim_reason: "claim_acquired",
    },
  };
  const out = extractRunOutcome(state);
  assert.equal(out.has_merge_candidates, "true");
  assert.equal(out.merged_count, "2");
  assert.equal(out.merge_status, "merged");
  assert.equal(out.branch, "wave/goal-333-wave-3");
  assert.equal(out.claim_reason, "claim_acquired");
});

test("extractRunOutcome: returns empty for null state", () => {
  assert.deepEqual(extractRunOutcome(null), {});
  assert.deepEqual(extractRunOutcome(undefined), {});
});

test("formatWatchEvent: approved issue", () => {
  const evt = {
    event: "complete",
    runId: "abc12345",
    graph: "wave_issue_execute",
    issue: "409",
    milestone: "goal-333-wave-3",
    review_verdict: "approve",
    review_attempt: "1",
  };
  const out = formatWatchEvent(evt);
  assert.match(out, /OK/);
  assert.match(out, /#409/);
  assert.match(out, /APPROVED/);
  assert.match(out, /goal-333-wave-3/);
});

test("formatWatchEvent: failed issue", () => {
  const evt = {
    event: "complete",
    runId: "def56789",
    graph: "wave_issue_execute",
    issue: "410",
    milestone: "goal-333-wave-3",
    review_verdict: "revise",
    review_attempt: "3",
    review_notes_excerpt: "QA_EVIDENCE_REQUIRED: qa.status=fail",
  };
  const out = formatWatchEvent(evt);
  assert.match(out, /OK/);
  assert.match(out, /#410/);
  assert.match(out, /revise\(3\)/);
  assert.match(out, /QA_EVIDENCE_REQUIRED/);
});

test("formatWatchEvent: done_elsewhere issue includes disposition and confidence", () => {
  const evt = {
    event: "complete",
    runId: "ghi90123",
    graph: "wave_issue_execute",
    issue: "411",
    milestone: "goal-333-wave-3",
    review_verdict: "done_elsewhere",
    decision_confidence: "high",
    precheck_reason: "issue_scoped_zero_delta_with_passing_qa",
  };
  const out = formatWatchEvent(evt);
  assert.match(out, /done_elsewhere\/high/);
  assert.match(out, /precheck=issue_scoped_zero_delta_with_passing_qa/);
});

test("formatWatchEvent: wave no-op includes claim reason", () => {
  const evt = {
    event: "complete",
    runId: "nop12345",
    graph: "wave_execute.dot",
    claim_reason: "no_ready_wave",
  };
  const out = formatWatchEvent(evt);
  assert.match(out, /claim=no_ready_wave/);
});

test("formatWatchSummary: aggregates events", () => {
  const events = [
    { event: "complete", graph: "wave_issue_execute.dot", issue: "409", review_verdict: "approve" },
    { event: "complete", graph: "wave_issue_execute.dot", issue: "410", review_verdict: "revise", review_failed: "true" },
    { event: "complete", graph: "wave_issue_execute.dot", issue: "411", review_verdict: "done_elsewhere", review_failed: "false" },
    { event: "complete", graph: "wave_execute.dot", merge_status: "merged", merged_count: "1", failed_count: "1" },
  ];
  const out = formatWatchSummary(events, 300000);
  assert.match(out, /4 event\(s\) in 5m0s/);
  assert.match(out, /Issues: 1 approved, 1 failed\/revised, 1 bypassed-review/);
  assert.match(out, /Merge: merged/);
});

test("formatWatchSummary: empty events", () => {
  const out = formatWatchSummary([], 60000);
  assert.match(out, /No events in 1m0s/);
});
