import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { seedGoalState } from "../../src/commands/goal-seed-state.ts";

function writeRunState(runsDir, runId, state) {
  const dir = join(runsDir, runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(state), "utf8");
}

test("seedGoalState returns empty arrays when no repo or goalNumber", () => {
  const out = seedGoalState();
  assert.deepEqual(out, { completed_issues: [], processed_issues: [], impl_results: "[]", plan_index: 0 });
});

test("seedGoalState returns empty arrays when repo missing", () => {
  const out = seedGoalState({ goalNumber: "1" });
  assert.deepEqual(out, { completed_issues: [], processed_issues: [], impl_results: "[]", plan_index: 0 });
});

test("seedGoalState seeds completed from closed sub-issues", () => {
  const mockListSubIssues = () => [
    { number: 100, title: "Feature A", state: "open" },
    { number: 101, title: "Feature B", state: "closed" },
    { number: 102, title: "Feature C", state: "closed" },
    { number: 103, title: "Feature D", state: "open" },
  ];
  const out = seedGoalState({
    repo: "o/r",
    goalNumber: "50",
    listSubIssuesFn: mockListSubIssues,
  });
  assert.deepEqual(out.completed_issues, ["101", "102"]);
  assert.deepEqual(out.processed_issues, []);
  assert.equal(out.plan_index, 0);
});

test("seedGoalState returns empty completed when all sub-issues open", () => {
  const mockListSubIssues = () => [
    { number: 200, title: "A", state: "open" },
    { number: 201, title: "B", state: "open" },
  ];
  const out = seedGoalState({
    repo: "o/r",
    goalNumber: "60",
    listSubIssuesFn: mockListSubIssues,
  });
  assert.deepEqual(out.completed_issues, []);
  assert.deepEqual(out.processed_issues, []);
  assert.equal(out.plan_index, 0);
});

test("seedGoalState returns empty completed when no sub-issues exist", () => {
  const out = seedGoalState({
    repo: "o/r",
    goalNumber: "70",
    listSubIssuesFn: () => [],
  });
  assert.deepEqual(out.completed_issues, []);
  assert.deepEqual(out.processed_issues, []);
  assert.equal(out.plan_index, 0);
});

// ── Resume from prior runs ────────────────────────────────────────

test("seedGoalState does not resume open issues from prior goal_execute runs", () => {
  const tmp = mkdtempSync(join(tmpdir(), "seed-resume-"));
  const runsDir = join(tmp, "runs");
  mkdirSync(runsDir, { recursive: true });

  // Prior completed goal_execute run that approved issues 100 and 101
  writeRunState(runsDir, "run-aaa", {
    status: "completed",
    pipeline: "goal_execute.dot",
    context: {
      goal_issue_number: "50",
      completed_issues: '["100","101"]',
    },
  });

  // All sub-issues still open (not yet merged)
  const mockListSubIssues = () => [
    { number: 100, title: "A", state: "open" },
    { number: 101, title: "B", state: "open" },
    { number: 102, title: "C", state: "open" },
  ];

  const out = seedGoalState({
    repo: "o/r",
    goalNumber: "50",
    runsDir,
    listSubIssuesFn: mockListSubIssues,
  });

  // Open issues must remain executable even if a prior run recorded them.
  assert.deepEqual(out.completed_issues, []);
  assert.deepEqual(out.processed_issues, []);
  assert.equal(out.plan_index, 0);
  rmSync(tmp, { recursive: true, force: true });
});

test("seedGoalState ignores open issues recorded across multiple prior runs", () => {
  const tmp = mkdtempSync(join(tmpdir(), "seed-resume-"));
  const runsDir = join(tmp, "runs");
  mkdirSync(runsDir, { recursive: true });

  // Run 1 approved 100, 101
  writeRunState(runsDir, "run-aaa", {
    status: "failed",
    pipeline: "goal_execute.dot",
    context: {
      goal_issue_number: "50",
      completed_issues: '["100","101"]',
    },
  });

  // Run 2 approved 101, 102 (101 overlaps)
  writeRunState(runsDir, "run-bbb", {
    status: "completed",
    pipeline: "goal_execute.dot",
    context: {
      goal_issue_number: "50",
      completed_issues: '["101","102"]',
    },
  });

  const mockListSubIssues = () => [
    { number: 100, title: "A", state: "open" },
    { number: 101, title: "B", state: "open" },
    { number: 102, title: "C", state: "open" },
    { number: 103, title: "D", state: "open" },
  ];

  const out = seedGoalState({
    repo: "o/r",
    goalNumber: "50",
    runsDir,
    listSubIssuesFn: mockListSubIssues,
  });

  assert.deepEqual(out.completed_issues, []);
  assert.equal(out.plan_index, 0);
  rmSync(tmp, { recursive: true, force: true });
});

test("seedGoalState ignores runs for different goals", () => {
  const tmp = mkdtempSync(join(tmpdir(), "seed-resume-"));
  const runsDir = join(tmp, "runs");
  mkdirSync(runsDir, { recursive: true });

  writeRunState(runsDir, "run-other", {
    status: "completed",
    pipeline: "goal_execute.dot",
    context: {
      goal_issue_number: "99",
      completed_issues: '["200","201"]',
    },
  });

  const mockListSubIssues = () => [
    { number: 100, title: "A", state: "open" },
  ];

  const out = seedGoalState({
    repo: "o/r",
    goalNumber: "50",
    runsDir,
    listSubIssuesFn: mockListSubIssues,
  });

  assert.deepEqual(out.completed_issues, []);
  assert.equal(out.plan_index, 0);
  rmSync(tmp, { recursive: true, force: true });
});

test("seedGoalState ignores still-running runs", () => {
  const tmp = mkdtempSync(join(tmpdir(), "seed-resume-"));
  const runsDir = join(tmp, "runs");
  mkdirSync(runsDir, { recursive: true });

  writeRunState(runsDir, "run-active", {
    status: "running",
    pipeline: "goal_execute.dot",
    context: {
      goal_issue_number: "50",
      completed_issues: '["100"]',
    },
  });

  const mockListSubIssues = () => [
    { number: 100, title: "A", state: "open" },
  ];

  const out = seedGoalState({
    repo: "o/r",
    goalNumber: "50",
    runsDir,
    listSubIssuesFn: mockListSubIssues,
  });

  // Running runs should NOT be used for resume — their completed_issues are in-flux
  assert.deepEqual(out.completed_issues, []);
  assert.equal(out.plan_index, 0);
  rmSync(tmp, { recursive: true, force: true });
});

test("seedGoalState keeps only currently closed issues when prior runs include open ones", () => {
  const tmp = mkdtempSync(join(tmpdir(), "seed-resume-"));
  const runsDir = join(tmp, "runs");
  mkdirSync(runsDir, { recursive: true });

  writeRunState(runsDir, "run-aaa", {
    status: "completed",
    pipeline: "goal_execute.dot",
    context: {
      goal_issue_number: "50",
      completed_issues: '["100","101"]',
    },
  });

  // Issue 100 is now closed (merged), 101 still open
  const mockListSubIssues = () => [
    { number: 100, title: "A", state: "closed" },
    { number: 101, title: "B", state: "open" },
    { number: 102, title: "C", state: "open" },
  ];

  const out = seedGoalState({
    repo: "o/r",
    goalNumber: "50",
    runsDir,
    listSubIssuesFn: mockListSubIssues,
  });

  assert.deepEqual(out.completed_issues, ["100"]);
  assert.equal(out.plan_index, 0);
  rmSync(tmp, { recursive: true, force: true });
});

test("seedGoalState does not seed open sub-issues as completed from prior runs", () => {
  const tmp = mkdtempSync(join(tmpdir(), "seed-open-prior-"));
  const runsDir = join(tmp, "runs");
  mkdirSync(runsDir, { recursive: true });

  writeRunState(runsDir, "run-prior", {
    status: "completed",
    pipeline: "goal_execute.dot",
    context: {
      goal_issue_number: "50",
      completed_issues: '["100","101","102"]',
      processed_issues: '["100","101","102"]',
    },
  });

  const out = seedGoalState({
    repo: "o/r",
    goalNumber: "50",
    runsDir,
    listSubIssuesFn: () => [
      { number: 100, title: "Closed feature", state: "closed" },
      { number: 101, title: "Still open feature", state: "open" },
      { number: 102, title: "Still open feature", state: "open" },
    ],
  });

  assert.deepEqual(out.completed_issues, ["100"]);
  assert.deepEqual(out.processed_issues, ["100"]);
  assert.equal(out.plan_index, 0);
  rmSync(tmp, { recursive: true, force: true });
});

test("seedGoalState handles missing/corrupt run state files gracefully", () => {
  const tmp = mkdtempSync(join(tmpdir(), "seed-resume-"));
  const runsDir = join(tmp, "runs");
  mkdirSync(runsDir, { recursive: true });

  // Create a directory with no state.json
  mkdirSync(join(runsDir, "run-empty"), { recursive: true });

  // Create a corrupt state.json
  const corruptDir = join(runsDir, "run-corrupt");
  mkdirSync(corruptDir, { recursive: true });
  writeFileSync(join(corruptDir, "state.json"), "not json", "utf8");

  // Valid run
  writeRunState(runsDir, "run-good", {
    status: "completed",
    pipeline: "goal_execute.dot",
    context: {
      goal_issue_number: "50",
      completed_issues: '["100"]',
    },
  });

  const mockListSubIssues = () => [
    { number: 100, title: "A", state: "open" },
  ];

  const out = seedGoalState({
    repo: "o/r",
    goalNumber: "50",
    runsDir,
    listSubIssuesFn: mockListSubIssues,
  });

  assert.deepEqual(out.completed_issues, []);
  assert.equal(out.plan_index, 0);
  rmSync(tmp, { recursive: true, force: true });
});

test("seedGoalState does not seed impl_results or completion from open prior-run issues", () => {
  const tmp = mkdtempSync(join(tmpdir(), "seed-impl-"));
  const runsDir = join(tmp, "runs");
  mkdirSync(runsDir, { recursive: true });

  // Prior failed run that had impl_results with approved issues
  writeRunState(runsDir, "run-aaa", {
    status: "failed",
    pipeline: "goal_execute.dot",
    context: {
      goal_issue_number: "50",
      completed_issues: '["100","101"]',
      impl_results: JSON.stringify([
        { issue_number: "100", branch: "goal/50", worktree_dir: "/tmp/wt", review_failed: "false" },
        { issue_number: "101", branch: "goal/50", worktree_dir: "/tmp/wt", review_failed: "false" },
      ]),
    },
  });

  // All sub-issues still open (not yet merged to main)
  const mockListSubIssues = () => [
    { number: 100, title: "A", state: "open" },
    { number: 101, title: "B", state: "open" },
  ];

  const out = seedGoalState({
    repo: "o/r",
    goalNumber: "50",
    runsDir,
    listSubIssuesFn: mockListSubIssues,
  });

  assert.deepEqual(out.completed_issues, []);
  assert.equal(out.impl_results, "[]");
  assert.equal(out.plan_index, 0);
  rmSync(tmp, { recursive: true, force: true });
});

test("seedGoalState ignores prior impl_results when all recorded issues are still open", () => {
  const tmp = mkdtempSync(join(tmpdir(), "seed-impl-latest-"));
  const runsDir = join(tmp, "runs");
  mkdirSync(runsDir, { recursive: true });

  // Older run with fewer issues
  writeRunState(runsDir, "run-old", {
    status: "completed",
    pipeline: "goal_execute.dot",
    context: {
      goal_issue_number: "50",
      completed_issues: '["100"]',
      impl_results: JSON.stringify([
        { issue_number: "100", branch: "goal/50", review_failed: "false" },
      ]),
    },
  });

  // Newer run with more issues
  writeRunState(runsDir, "run-new", {
    status: "failed",
    pipeline: "goal_execute.dot",
    context: {
      goal_issue_number: "50",
      completed_issues: '["100","101","102"]',
      impl_results: JSON.stringify([
        { issue_number: "100", branch: "goal/50", review_failed: "false" },
        { issue_number: "101", branch: "goal/50", review_failed: "false" },
        { issue_number: "102", branch: "goal/50", review_failed: "false" },
      ]),
    },
  });

  const mockListSubIssues = () => [
    { number: 100, title: "A", state: "open" },
    { number: 101, title: "B", state: "open" },
    { number: 102, title: "C", state: "open" },
  ];

  const out = seedGoalState({
    repo: "o/r",
    goalNumber: "50",
    runsDir,
    listSubIssuesFn: mockListSubIssues,
  });

  assert.equal(out.impl_results, "[]");
  assert.equal(out.plan_index, 0);
  rmSync(tmp, { recursive: true, force: true });
});

test("seedGoalState returns empty impl_results when no prior runs have it", () => {
  const tmp = mkdtempSync(join(tmpdir(), "seed-no-impl-"));
  const runsDir = join(tmp, "runs");
  mkdirSync(runsDir, { recursive: true });

  writeRunState(runsDir, "run-aaa", {
    status: "completed",
    pipeline: "goal_execute.dot",
    context: {
      goal_issue_number: "50",
      completed_issues: '["100"]',
    },
  });

  const mockListSubIssues = () => [
    { number: 100, title: "A", state: "open" },
  ];

  const out = seedGoalState({
    repo: "o/r",
    goalNumber: "50",
    runsDir,
    listSubIssuesFn: mockListSubIssues,
  });

  assert.equal(out.impl_results, "[]");
  assert.equal(out.plan_index, 0);
  rmSync(tmp, { recursive: true, force: true });
});

test("seedGoalState works without runsDir (backward compatible)", () => {
  const mockListSubIssues = () => [
    { number: 100, title: "A", state: "closed" },
    { number: 101, title: "B", state: "open" },
  ];

  const out = seedGoalState({
    repo: "o/r",
    goalNumber: "50",
    listSubIssuesFn: mockListSubIssues,
  });

  // Without runsDir, only closed issues are seeded (existing behavior)
  assert.deepEqual(out.completed_issues, ["100"]);
  assert.deepEqual(out.processed_issues, []);
  assert.equal(out.impl_results, "[]");
  assert.equal(out.plan_index, 0);
});

test("seedGoalState seeds processed issues only for currently closed issues", () => {
  const tmp = mkdtempSync(join(tmpdir(), "seed-progress-"));
  const runsDir = join(tmp, "runs");
  mkdirSync(runsDir, { recursive: true });

  writeRunState(runsDir, "run-earlier", {
    status: "failed",
    pipeline: "goal_execute.dot",
    context: {
      goal_issue_number: "50",
      completed_issues: '["100"]',
      processed_issues: '["100"]',
      impl_results: JSON.stringify([
        { issue_number: "100", review_failed: "true", review_notes: "revise" },
      ]),
    },
  });

  writeRunState(runsDir, "run-furthest", {
    status: "guarded",
    pipeline: "goal_execute.dot",
    context: {
      goal_issue_number: "50",
      completed_issues: '["100","101"]',
      processed_issues: '["100","101","102"]',
      impl_results: JSON.stringify([
        { issue_number: "100", review_failed: "false" },
        { issue_number: "101", review_failed: "false" },
        { issue_number: "102", review_failed: "true", review_notes: "timed out" },
      ]),
    },
  });

  const out = seedGoalState({
    repo: "o/r",
    goalNumber: "50",
    runsDir,
    listSubIssuesFn: () => [
      { number: 100, title: "A", state: "open" },
      { number: 101, title: "B", state: "open" },
      { number: 102, title: "C", state: "open" },
      { number: 103, title: "D", state: "open" },
    ],
  });

  assert.deepEqual(out.completed_issues, []);
  assert.deepEqual(out.processed_issues, []);
  assert.equal(out.plan_index, 0);
  assert.equal(out.impl_results, "[]");
  rmSync(tmp, { recursive: true, force: true });
});

test("seedGoalState excludes failed issues from processed_issues so they are re-attempted", () => {
  const tmp = mkdtempSync(join(tmpdir(), "seed-failed-retry-"));
  const runsDir = join(tmp, "runs");
  mkdirSync(runsDir, { recursive: true });

  writeRunState(runsDir, "run-prior", {
    status: "completed",
    pipeline: "goal_execute.dot",
    context: {
      goal_issue_number: "2320",
      completed_issues: '["2417","2418"]',
      processed_issues: '["2416","2417","2418"]',
      impl_results: JSON.stringify([
        { issue_number: "2416", review_failed: "true", review_notes: "Missing impl_result payload" },
        { issue_number: "2417", review_failed: "false", review_notes: "Approved" },
        { issue_number: "2418", review_failed: "false", review_notes: "Approved" },
      ]),
    },
  });

  const out = seedGoalState({
    repo: "o/r",
    goalNumber: "2320",
    runsDir,
    listSubIssuesFn: () => [
      { number: 2416, title: "Run inspection", state: "open" },
      { number: 2417, title: "Dashboard", state: "closed" },
      { number: 2418, title: "Filters", state: "closed" },
    ],
  });

  assert.deepEqual(out.processed_issues, ["2417", "2418"]);
  assert.deepEqual(out.completed_issues, ["2417", "2418"]);
  assert.equal(out.plan_index, 0);
  rmSync(tmp, { recursive: true, force: true });
});

test("seedGoalState never seeds impl_results from prior runs", () => {
  const tmp = mkdtempSync(join(tmpdir(), "seed-strip-failures-"));
  const runsDir = join(tmp, "runs");
  mkdirSync(runsDir, { recursive: true });

  // Prior run had 3 approved issues and 2 failed issues.
  // The failed issues (#1355, #1357) will be re-attempted.
  // If their stale impl_results are carried forward, split_results will
  // re-extract them as review_failures and handle_review_failures will
  // post duplicate comments, inflating the quarantine counter every cycle.
  writeRunState(runsDir, "run-prior", {
    status: "completed",
    pipeline: "goal_execute.dot",
    context: {
      goal_issue_number: "1214",
      completed_issues: '["1356","1358","1360"]',
      processed_issues: '["1355","1356","1357","1358","1360"]',
      impl_results: JSON.stringify([
        { issue_number: "1355", review_failed: "true", review_notes: "Review failed after 0/3 attempts." },
        { issue_number: "1356", review_failed: "false", review_notes: "Approved (attempt 1/3)." },
        { issue_number: "1357", review_failed: "true", review_notes: "Review failed after 0/3 attempts." },
        { issue_number: "1358", review_failed: "false", review_notes: "Approved (attempt 1/3)." },
        { issue_number: "1360", review_failed: "false", review_notes: "Approved (attempt 1/3)." },
      ]),
    },
  });

  const out = seedGoalState({
    repo: "example-org/example-trading",
    goalNumber: "1214",
    runsDir,
    listSubIssuesFn: () => [
      { number: 1355, title: "Stand up executor", state: "open" },
      { number: 1356, title: "Feature A", state: "closed" },
      { number: 1357, title: "Implement orchestrator", state: "open" },
      { number: 1358, title: "Feature B", state: "closed" },
      { number: 1360, title: "Feature C", state: "closed" },
    ],
  });

  assert.equal(out.impl_results, "[]");

  rmSync(tmp, { recursive: true, force: true });
});
