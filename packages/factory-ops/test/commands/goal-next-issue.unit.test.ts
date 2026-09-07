import assert from "node:assert/strict";
import test from "node:test";

import { createTestAdapter } from "@hatch/github-adapter/test";

import { computeNextGoalIssue, buildOrderedCandidateIssues, pickNextGoalIssue, pickNextGoalIssueFromArgs } from "../../src/commands/goal-next-issue.ts";


// ─── computeNextGoalIssue ───────────────────────────────────────────────────

test("computeNextGoalIssue picks first open sub-issue by number order", () => {
  const out = computeNextGoalIssue({
    goalNumber: "50",
    completed: [],
    processed: [],
    issues: [
      { number: 103, title: "C", state: "open" },
      { number: 101, title: "A", state: "open" },
      { number: 102, title: "B", state: "open" },
    ],
  });
  assert.equal(out.has_next, true);
  assert.equal(out.next_issue_number, "101");
  assert.equal(out.next_issue_title, "A");
  assert.equal(out.remaining_count, 3);
});

test("computeNextGoalIssue skips already processed issues", () => {
  const out = computeNextGoalIssue({
    goalNumber: "50",
    completed: [],
    processed: ["101"],
    issues: [
      { number: 101, title: "A", state: "open" },
      { number: 102, title: "B", state: "open" },
    ],
  });
  assert.equal(out.has_next, true);
  assert.equal(out.next_issue_number, "102");
});

test("computeNextGoalIssue returns none_pending when all processed", () => {
  const out = computeNextGoalIssue({
    goalNumber: "50",
    completed: [],
    processed: ["101", "102"],
    issues: [
      { number: 101, title: "A", state: "open" },
      { number: 102, title: "B", state: "open" },
    ],
  });
  assert.equal(out.has_next, false);
  assert.equal(out.no_next_reason, "none_pending");
});

test("computeNextGoalIssue skips closed sub-issues", () => {
  const out = computeNextGoalIssue({
    goalNumber: "50",
    completed: [],
    processed: [],
    issues: [
      { number: 101, title: "A", state: "closed" },
      { number: 102, title: "B", state: "open" },
    ],
  });
  assert.equal(out.has_next, true);
  assert.equal(out.next_issue_number, "102");
});

test("computeNextGoalIssue returns none_pending for empty issue list", () => {
  const out = computeNextGoalIssue({
    goalNumber: "50",
    issues: [],
  });
  assert.equal(out.has_next, false);
  assert.equal(out.no_next_reason, "none_pending");
});

test("computeNextGoalIssue processes all issues regardless of count", () => {
  const out = computeNextGoalIssue({
    goalNumber: "50",
    completed: [],
    processed: ["1", "2", "3", "4", "5"],
    issues: [
      { number: 1, title: "A", state: "open" },
      { number: 2, title: "B", state: "open" },
      { number: 3, title: "C", state: "open" },
      { number: 4, title: "D", state: "open" },
      { number: 5, title: "E", state: "open" },
      { number: 6, title: "F", state: "open" },
    ],
  });
  assert.equal(out.has_next, true);
  assert.equal(out.next_issue_number, "6");
});

test("computeNextGoalIssue deterministic title payload for downstream builders", () => {
  const out = computeNextGoalIssue({
    goalNumber: "50",
    completed: [],
    processed: [],
    issues: [
      { number: 301, title: "First", state: "open" },
      { number: 302, title: "Second", state: "open" },
    ],
  });
  assert.equal(out.has_next, true);
  assert.equal(out.next_issue_number, "301");
  assert.equal(out.next_issue_title, "First");
  assert.equal(typeof out.no_next_reason, "string");
});

// ─── buildOrderedCandidateIssues ────────────────────────────────────────────

test("buildOrderedCandidateIssues produces complexity metadata", () => {
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
  assert.deepEqual(out.map((i) => i.issue_number), ["301", "302", "303"]);
  assert.deepEqual(out.map((i) => i.complexity_class), ["low", "high", "low"]);
});

test("computeNextGoalIssue skips issues with blocked_by_count > 0 (GitHub relationship)", () => {
  const out = computeNextGoalIssue({
    goalNumber: "50",
    completed: [],
    processed: [],
    issues: [
      { number: 101, title: "Blocked by dep", state: "open", blocked_by_count: 1 },
      { number: 102, title: "Ready to go", state: "open", blocked_by_count: 0 },
    ],
  });
  assert.equal(out.has_next, true);
  assert.equal(out.next_issue_number, "102");
  assert.equal(out.blocked_count, 1);
});

test("computeNextGoalIssue skips issues with quarantined label", () => {
  const out = computeNextGoalIssue({
    goalNumber: "50",
    completed: [],
    processed: [],
    issues: [
      { number: 101, title: "Quarantined", state: "open", labels: [{ name: "quarantined" }] },
      { number: 102, title: "OK", state: "open", labels: [] },
    ],
  });
  assert.equal(out.has_next, true);
  assert.equal(out.next_issue_number, "102");
  assert.equal(out.blocked_count, 1);
});

test("computeNextGoalIssue returns none_pending when all blocked or quarantined", () => {
  const out = computeNextGoalIssue({
    goalNumber: "50",
    completed: [],
    processed: [],
    issues: [
      { number: 101, title: "A", state: "open", blocked_by_count: 2 },
      { number: 102, title: "B", state: "open", labels: [{ name: "quarantined" }] },
    ],
  });
  assert.equal(out.has_next, false);
  assert.equal(out.blocked_count, 2);
});

test("computeNextGoalIssue handles issues without labels or blocked_by_count", () => {
  const out = computeNextGoalIssue({
    goalNumber: "50",
    completed: [],
    processed: [],
    issues: [
      { number: 101, title: "A", state: "open" },
      { number: 102, title: "B", state: "open", labels: null },
    ],
  });
  assert.equal(out.has_next, true);
  assert.equal(out.next_issue_number, "101");
  assert.equal(out.blocked_count, 0);
});

// ─── pickNextGoalIssue ──────────────────────────────────────────────────────

test("pickNextGoalIssue returns missing_repo_or_goal when args empty", () => {
  const out = pickNextGoalIssue();
  assert.equal(out.has_next, false);
  assert.equal(out.no_next_reason, "missing_repo_or_goal");
});

test("pickNextGoalIssue queries sub-issues and returns next", () => {
  const mockListSubIssues = () => [
    { number: 200, title: "A", state: "open" },
    { number: 201, title: "B", state: "open" },
  ];
  const out = pickNextGoalIssue({
    repo: "o/r",
    goalNumber: "50",
    completed: [],
    processed: [],
    listSubIssuesFn: mockListSubIssues,
    estimateComplexityClass: () => "low",
  });
  assert.equal(out.has_next, true);
  assert.equal(out.next_issue_number, "200");
  assert.ok(out.ordered_candidate_issues.length > 0);
  assert.ok(out.ordered_candidate_issues_b64);
});

test("pickNextGoalIssue returns empty candidates when no sub-issues", () => {
  const out = pickNextGoalIssue({
    repo: "o/r",
    goalNumber: "50",
    listSubIssuesFn: () => [],
  });
  assert.equal(out.has_next, false);
  assert.deepEqual(out.ordered_candidate_issues, []);
});

test("pickNextGoalIssue skips blocked_by and quarantined sub-issues", () => {
  const mockListSubIssues = () => [
    { number: 200, title: "Blocked by dep", state: "open", blocked_by_count: 1, labels: [] },
    { number: 201, title: "Quarantined", state: "open", blocked_by_count: 0, labels: [{ name: "quarantined" }] },
    { number: 202, title: "Ready", state: "open", blocked_by_count: 0, labels: [{ name: "feature" }] },
  ];
  const out = pickNextGoalIssue({
    repo: "o/r",
    goalNumber: "50",
    completed: [],
    processed: [],
    listSubIssuesFn: mockListSubIssues,
  });
  assert.equal(out.has_next, true);
  assert.equal(out.next_issue_number, "202");
  assert.equal(out.blocked_count, 2);
});

// ─── pickNextGoalIssueFromArgs ──────────────────────────────────────────────

test("pickNextGoalIssueFromArgs returns missing_repo_or_goal for empty args", () => {
  const out = pickNextGoalIssueFromArgs({});
  assert.equal(out.has_next, false);
  assert.equal(out.no_next_reason, "missing_repo_or_goal");
});

// ─── adapter-based tests ─────────────────────────────────────────────────────

test("pickNextGoalIssue works with adapter instead of listSubIssuesFn", () => {
  const adapter = createTestAdapter({
    repo: "o/r",
    stubs: {
      listSubIssues: () => [
        { number: 200, title: "A", state: "open" },
        { number: 201, title: "B", state: "open" },
      ],
    },
  });
  const out = pickNextGoalIssue({
    goalNumber: "50",
    completed: [],
    processed: [],
    adapter,
    estimateComplexityClass: () => "low",
  });
  assert.equal(out.has_next, true);
  assert.equal(out.next_issue_number, "200");
  assert.ok(out.ordered_candidate_issues.length > 0);
});

test("pickNextGoalIssue with adapter skips blocked and quarantined", () => {
  const adapter = createTestAdapter({
    repo: "o/r",
    stubs: {
      listSubIssues: () => [
        { number: 200, title: "Blocked", state: "open", issue_dependencies_summary: { blocked_by: 1 }, labels: [] },
        { number: 201, title: "Quarantined", state: "open", labels: [{ name: "quarantined" }] },
        { number: 202, title: "Ready", state: "open", labels: [{ name: "feature" }] },
      ],
    },
  });
  const out = pickNextGoalIssue({
    goalNumber: "50",
    completed: [],
    processed: [],
    adapter,
  });
  assert.equal(out.has_next, true);
  assert.equal(out.next_issue_number, "202");
  assert.equal(out.blocked_count, 2);
});
