import assert from "node:assert/strict";
import test from "node:test";

import { createTestAdapter } from "../../../github-adapter/src/test-adapter.ts";

import { buildOrderedCandidateIssues, computeNextMilestoneIssue, pickNextMilestoneIssue, pickNextMilestoneIssueFromArgs } from "../../src/commands/milestone-next-issue.ts";

// ─── computeNextMilestoneIssue ───────────────────────────────────────────────

test("computeNextMilestoneIssue picks first issue by number order", () => {
  const out = computeNextMilestoneIssue({
    milestoneTitle: "goal-1-wave-1",
    completed: [],
    processed: [],
    issues: [
      { number: 30, title: "Z" },
      { number: 10, title: "A" },
      { number: 20, title: "B" },
    ],
  });
  assert.equal(out.has_next, true);
  assert.equal(out.next_issue_number, "10");
  assert.equal(out.next_issue_title, "A");
  assert.equal(out.remaining_count, 3);
  assert.equal(out.blocked_count, 0);
  assert.equal(out.no_next_reason, "");
});

test("computeNextMilestoneIssue orders all unblocked issues by number", () => {
  const out = computeNextMilestoneIssue({
    milestoneTitle: "goal-1-wave-1",
    issues: [
      { number: 50, title: "E" },
      { number: 10, title: "A" },
      { number: 30, title: "C" },
    ],
  });
  assert.deepEqual(
    out.ordered_unblocked_issues.map((i) => i.issue_number),
    ["10", "30", "50"],
  );
});

test("computeNextMilestoneIssue skips already processed issues", () => {
  const out = computeNextMilestoneIssue({
    milestoneTitle: "goal-1-wave-1",
    completed: [],
    processed: ["10"],
    issues: [
      { number: 10, title: "A" },
      { number: 20, title: "B" },
    ],
  });
  assert.equal(out.has_next, true);
  assert.equal(out.next_issue_number, "20");
  assert.equal(out.remaining_count, 1);
});

test("computeNextMilestoneIssue returns no_next when all processed", () => {
  const out = computeNextMilestoneIssue({
    milestoneTitle: "goal-1-wave-1",
    completed: [],
    processed: ["10", "20"],
    issues: [
      { number: 10, title: "A" },
      { number: 20, title: "B" },
    ],
  });
  assert.equal(out.has_next, false);
  assert.equal(out.next_issue_number, "");
  assert.equal(out.next_issue_title, "");
  assert.equal(out.remaining_count, 0);
  assert.equal(out.no_next_reason, "none_pending");
  assert.deepEqual(out.ordered_unblocked_issues, []);
});

test("computeNextMilestoneIssue returns no_next with empty issues list", () => {
  const out = computeNextMilestoneIssue({
    milestoneTitle: "goal-1-wave-1",
    completed: [],
    processed: [],
    issues: [],
  });
  assert.equal(out.has_next, false);
  assert.equal(out.remaining_count, 0);
  assert.equal(out.no_next_reason, "none_pending");
});

test("computeNextMilestoneIssue returns defaults with no arguments", () => {
  const out = computeNextMilestoneIssue();
  assert.equal(out.has_next, false);
  assert.equal(out.remaining_count, 0);
  assert.equal(out.no_next_reason, "none_pending");
});

test("computeNextMilestoneIssue returns defaults with empty object", () => {
  const out = computeNextMilestoneIssue({});
  assert.equal(out.has_next, false);
  assert.equal(out.no_next_reason, "none_pending");
});

test("computeNextMilestoneIssue filters out Wave Ready: prefixed issues", () => {
  const out = computeNextMilestoneIssue({
    milestoneTitle: "goal-1-wave-1",
    issues: [
      { number: 1, title: "Wave Ready: goal-1-wave-1" },
      { number: 2, title: "Real feature" },
    ],
  });
  assert.equal(out.has_next, true);
  assert.equal(out.next_issue_number, "2");
  assert.equal(out.remaining_count, 1);
});

test("computeNextMilestoneIssue returns none_pending when only Wave Ready issues exist", () => {
  const out = computeNextMilestoneIssue({
    milestoneTitle: "goal-1-wave-1",
    issues: [
      { number: 1, title: "Wave Ready: goal-1-wave-1" },
    ],
  });
  assert.equal(out.has_next, false);
  assert.equal(out.no_next_reason, "none_pending");
});

test("computeNextMilestoneIssue handles non-array processed gracefully", () => {
  const out = computeNextMilestoneIssue({
    milestoneTitle: "m",
    processed: "not an array",
    issues: [{ number: 1, title: "A" }],
  });
  assert.equal(out.has_next, true);
  assert.equal(out.next_issue_number, "1");
});

test("computeNextMilestoneIssue handles non-array issues gracefully", () => {
  const out = computeNextMilestoneIssue({
    milestoneTitle: "m",
    issues: "not an array",
  });
  assert.equal(out.has_next, false);
  assert.equal(out.no_next_reason, "none_pending");
});

test("computeNextMilestoneIssue stringifies processed values for comparison", () => {
  const out = computeNextMilestoneIssue({
    milestoneTitle: "m",
    processed: [10],
    issues: [
      { number: 10, title: "A" },
      { number: 20, title: "B" },
    ],
  });
  assert.equal(out.has_next, true);
  assert.equal(out.next_issue_number, "20");
});

test("computeNextMilestoneIssue blocked_count is always 0 (wave execution ignores blockers)", () => {
  const out = computeNextMilestoneIssue({
    milestoneTitle: "m",
    issues: [
      { number: 1, title: "A" },
      { number: 2, title: "B" },
    ],
    getBlockedBy: () => [{ number: 99, state: "OPEN", milestone: { title: "m" } }],
  });
  assert.equal(out.blocked_count, 0);
  assert.equal(out.has_next, true);
  assert.deepEqual(
    out.ordered_unblocked_issues.map((i) => i.issue_number),
    ["1", "2"],
  );
});

test("computeNextMilestoneIssue includes issue title in ordered_unblocked_issues", () => {
  const out = computeNextMilestoneIssue({
    milestoneTitle: "m",
    issues: [{ number: 5, title: "My Feature" }],
  });
  assert.equal(out.ordered_unblocked_issues[0].issue_title, "My Feature");
});

test("computeNextMilestoneIssue handles issues with missing title", () => {
  const out = computeNextMilestoneIssue({
    milestoneTitle: "m",
    issues: [{ number: 5 }],
  });
  assert.equal(out.has_next, true);
  assert.equal(out.next_issue_title, "");
  assert.equal(out.ordered_unblocked_issues[0].issue_title, "");
});

test("computeNextMilestoneIssue many issues all pending", () => {
  const issues = Array.from({ length: 20 }, (_, i) => ({ number: i + 1, title: `Issue ${i + 1}` }));
  const out = computeNextMilestoneIssue({
    milestoneTitle: "m",
    issues,
  });
  assert.equal(out.has_next, true);
  assert.equal(out.next_issue_number, "1");
  assert.equal(out.remaining_count, 20);
  assert.equal(out.ordered_unblocked_issues.length, 20);
});

test("pickNextMilestoneIssue reads milestone issues through adapter when provided", () => {
  const adapter = createTestAdapter({
    repo: "r/r",
    stubs: {
      issueList: () => [
        { number: 30, title: "Wave Ready: goal-1-wave-1" },
        { number: 10, title: "Feature A" },
        { number: 20, title: "Feature B" },
      ],
    },
  });

  const out = pickNextMilestoneIssue({
    repo: "r/r",
    milestoneTitle: "goal-1-wave-1",
    adapter,
  });

  assert.equal(out.next_issue_number, "10");
  assert.equal(adapter.callsTo("issueList").length, 1);
});

// ─── buildOrderedCandidateIssues ─────────────────────────────────────────────

test("buildOrderedCandidateIssues returns empty for empty input", () => {
  const out = buildOrderedCandidateIssues({
    orderedUnblockedIssues: [],
  });
  assert.deepEqual(out, []);
});

test("buildOrderedCandidateIssues returns empty with no arguments", () => {
  const out = buildOrderedCandidateIssues();
  assert.deepEqual(out, []);
});

test("buildOrderedCandidateIssues limits to candidateLimit", () => {
  const out = buildOrderedCandidateIssues({
    nextIssueNumber: "1",
    orderedUnblockedIssues: [
      { issue_number: "1", issue_title: "A" },
      { issue_number: "2", issue_title: "B" },
      { issue_number: "3", issue_title: "C" },
      { issue_number: "4", issue_title: "D" },
      { issue_number: "5", issue_title: "E" },
    ],
    candidateLimit: 2,
    estimateComplexityClass: () => "low",
  });
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((i) => i.issue_number), ["1", "2"]);
});

test("buildOrderedCandidateIssues defaults candidateLimit to 3", () => {
  const out = buildOrderedCandidateIssues({
    nextIssueNumber: "1",
    orderedUnblockedIssues: [
      { issue_number: "1", issue_title: "A" },
      { issue_number: "2", issue_title: "B" },
      { issue_number: "3", issue_title: "C" },
      { issue_number: "4", issue_title: "D" },
    ],
    estimateComplexityClass: () => "low",
  });
  assert.equal(out.length, 3);
});

test("buildOrderedCandidateIssues clamps candidateLimit to max 3", () => {
  const out = buildOrderedCandidateIssues({
    nextIssueNumber: "1",
    orderedUnblockedIssues: [
      { issue_number: "1", issue_title: "A" },
      { issue_number: "2", issue_title: "B" },
      { issue_number: "3", issue_title: "C" },
      { issue_number: "4", issue_title: "D" },
    ],
    candidateLimit: 100,
    estimateComplexityClass: () => "low",
  });
  assert.equal(out.length, 3);
});

test("buildOrderedCandidateIssues clamps candidateLimit to min 1", () => {
  const out = buildOrderedCandidateIssues({
    nextIssueNumber: "1",
    orderedUnblockedIssues: [
      { issue_number: "1", issue_title: "A" },
      { issue_number: "2", issue_title: "B" },
    ],
    candidateLimit: 0,
    estimateComplexityClass: () => "low",
  });
  assert.equal(out.length, 1);
});

test("buildOrderedCandidateIssues handles non-numeric candidateLimit", () => {
  const out = buildOrderedCandidateIssues({
    nextIssueNumber: "1",
    orderedUnblockedIssues: [
      { issue_number: "1", issue_title: "A" },
      { issue_number: "2", issue_title: "B" },
      { issue_number: "3", issue_title: "C" },
      { issue_number: "4", issue_title: "D" },
    ],
    candidateLimit: "abc",
    estimateComplexityClass: () => "low",
  });
  // Non-numeric should fallback to 3
  assert.equal(out.length, 3);
});

test("buildOrderedCandidateIssues starts from nextIssueNumber position", () => {
  const out = buildOrderedCandidateIssues({
    nextIssueNumber: "3",
    orderedUnblockedIssues: [
      { issue_number: "1", issue_title: "A" },
      { issue_number: "2", issue_title: "B" },
      { issue_number: "3", issue_title: "C" },
      { issue_number: "4", issue_title: "D" },
    ],
    candidateLimit: 2,
    estimateComplexityClass: () => "low",
  });
  assert.deepEqual(out.map((i) => i.issue_number), ["3", "4"]);
});

test("buildOrderedCandidateIssues starts from 0 when nextIssueNumber not found", () => {
  const out = buildOrderedCandidateIssues({
    nextIssueNumber: "999",
    orderedUnblockedIssues: [
      { issue_number: "1", issue_title: "A" },
      { issue_number: "2", issue_title: "B" },
    ],
    candidateLimit: 2,
    estimateComplexityClass: () => "low",
  });
  assert.deepEqual(out.map((i) => i.issue_number), ["1", "2"]);
});

test("buildOrderedCandidateIssues starts from 0 when nextIssueNumber is empty", () => {
  const out = buildOrderedCandidateIssues({
    nextIssueNumber: "",
    orderedUnblockedIssues: [
      { issue_number: "10", issue_title: "A" },
      { issue_number: "20", issue_title: "B" },
    ],
    candidateLimit: 2,
    estimateComplexityClass: () => "low",
  });
  assert.deepEqual(out.map((i) => i.issue_number), ["10", "20"]);
});

test("buildOrderedCandidateIssues produces complexity metadata per issue", () => {
  const out = buildOrderedCandidateIssues({
    nextIssueNumber: "301",
    orderedUnblockedIssues: [
      { issue_number: "301", issue_title: "Small polish" },
      { issue_number: "302", issue_title: "Medium migration" },
      { issue_number: "303", issue_title: "Low risk follow-up" },
    ],
    candidateLimit: 3,
    estimateComplexityClass: ({ issueTitle }) =>
      issueTitle.includes("Small") || issueTitle.includes("Low") ? "low" : "high",
  });
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((i) => i.complexity_class), ["low", "high", "low"]);
});

test("buildOrderedCandidateIssues normalizes complexity classes", () => {
  const out = buildOrderedCandidateIssues({
    nextIssueNumber: "1",
    orderedUnblockedIssues: [
      { issue_number: "1", issue_title: "A" },
      { issue_number: "2", issue_title: "B" },
      { issue_number: "3", issue_title: "C" },
    ],
    candidateLimit: 3,
    estimateComplexityClass: ({ issueNumber }) => {
      if (issueNumber === "1") return "low";
      if (issueNumber === "2") return "medium";
      return "something_unexpected";
    },
  });
  assert.equal(out[0].complexity_class, "low");
  assert.equal(out[1].complexity_class, "high"); // medium normalizes to high
  assert.equal(out[2].complexity_class, "unknown"); // unrecognized normalizes to unknown
});

test("buildOrderedCandidateIssues accepts number as issue_number fallback", () => {
  const out = buildOrderedCandidateIssues({
    orderedUnblockedIssues: [
      { number: "42", title: "Feature" },
    ],
    estimateComplexityClass: () => "low",
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].issue_number, "42");
  assert.equal(out[0].issue_title, "Feature");
});

test("buildOrderedCandidateIssues filters out items with empty issue_number", () => {
  const out = buildOrderedCandidateIssues({
    orderedUnblockedIssues: [
      { issue_number: "", issue_title: "No Number" },
      { issue_number: "1", issue_title: "Has Number" },
    ],
    estimateComplexityClass: () => "low",
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].issue_number, "1");
});

test("buildOrderedCandidateIssues handles non-array orderedUnblockedIssues", () => {
  const out = buildOrderedCandidateIssues({
    orderedUnblockedIssues: "not an array",
    estimateComplexityClass: () => "low",
  });
  assert.deepEqual(out, []);
});

test("buildOrderedCandidateIssues passes issueNumber and issueTitle to estimator", () => {
  const calls = [];
  buildOrderedCandidateIssues({
    orderedUnblockedIssues: [
      { issue_number: "77", issue_title: "Widget" },
    ],
    candidateLimit: 1,
    estimateComplexityClass: (args) => {
      calls.push(args);
      return "low";
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].issueNumber, "77");
  assert.equal(calls[0].issueTitle, "Widget");
});

// ─── pickNextMilestoneIssue ──────────────────────────────────────────────────

test("pickNextMilestoneIssue returns missing_repo_or_milestone when repo missing", () => {
  const out = pickNextMilestoneIssue({
    milestoneTitle: "goal-1-wave-1",
  });
  assert.equal(out.has_next, false);
  assert.equal(out.no_next_reason, "missing_repo_or_milestone");
  assert.deepEqual(out.ordered_candidate_issues, []);
  assert.equal(typeof out.ordered_candidate_issues_b64, "string");
});

test("pickNextMilestoneIssue returns missing_repo_or_milestone when milestoneTitle missing", () => {
  const out = pickNextMilestoneIssue({
    repo: "owner/repo",
  });
  assert.equal(out.has_next, false);
  assert.equal(out.no_next_reason, "missing_repo_or_milestone");
});

test("pickNextMilestoneIssue returns missing_repo_or_milestone with no args", () => {
  const out = pickNextMilestoneIssue();
  assert.equal(out.has_next, false);
  assert.equal(out.no_next_reason, "missing_repo_or_milestone");
  assert.deepEqual(out.ordered_candidate_issues, []);
});

test("pickNextMilestoneIssue returns missing_repo_or_milestone with empty strings", () => {
  const out = pickNextMilestoneIssue({ repo: "", milestoneTitle: "" });
  assert.equal(out.has_next, false);
  assert.equal(out.no_next_reason, "missing_repo_or_milestone");
});

test("pickNextMilestoneIssue ordered_candidate_issues_b64 is valid base64 JSON", () => {
  const out = pickNextMilestoneIssue({ repo: "", milestoneTitle: "" });
  const decoded = JSON.parse(Buffer.from(out.ordered_candidate_issues_b64, "base64").toString("utf8"));
  assert.deepEqual(decoded, []);
});

// ─── pickNextMilestoneIssueFromArgs ──────────────────────────────────────────

test("pickNextMilestoneIssueFromArgs returns missing_repo_or_milestone when repo missing", () => {
  const out = pickNextMilestoneIssueFromArgs({
    milestoneTitle: "goal-1-wave-1",
    completedRaw: "[]",
    processedRaw: "[]",
  });
  assert.equal(out.has_next, false);
  assert.equal(out.no_next_reason, "missing_repo_or_milestone");
});

test("pickNextMilestoneIssueFromArgs parses JSON completed/processed arrays", () => {
  const out = pickNextMilestoneIssueFromArgs({
    completedRaw: '["10","20"]',
    processedRaw: '["10","20"]',
  });
  // No repo or milestone, so returns missing
  assert.equal(out.no_next_reason, "missing_repo_or_milestone");
});

test("pickNextMilestoneIssueFromArgs handles invalid JSON in completedRaw", () => {
  const out = pickNextMilestoneIssueFromArgs({
    completedRaw: "not json",
    processedRaw: "[]",
  });
  assert.equal(out.no_next_reason, "missing_repo_or_milestone");
});

test("pickNextMilestoneIssueFromArgs handles null completedRaw/processedRaw", () => {
  const out = pickNextMilestoneIssueFromArgs({
    completedRaw: null,
    processedRaw: null,
  });
  assert.equal(out.no_next_reason, "missing_repo_or_milestone");
});

test("pickNextMilestoneIssueFromArgs returns defaults with no args", () => {
  const out = pickNextMilestoneIssueFromArgs();
  assert.equal(out.has_next, false);
  assert.equal(out.no_next_reason, "missing_repo_or_milestone");
});

test("pickNextMilestoneIssueFromArgs passes candidateLimit through", () => {
  const out = pickNextMilestoneIssueFromArgs({
    repo: "",
    milestoneTitle: "",
    candidateLimit: 1,
  });
  assert.equal(out.has_next, false);
});
