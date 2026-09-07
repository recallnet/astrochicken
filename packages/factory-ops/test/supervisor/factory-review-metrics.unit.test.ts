import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  computeReviewMetrics,
  resolveReviewVerdictsLogPath,
} from "../../src/commands/factory-review-metrics.ts";

function fixturePath(name = "review-verdicts.jsonl") {
  const dir = mkdtempSync(join(tmpdir(), "factory-review-metrics-"));
  return join(dir, name);
}

function writeJsonl(path, rows = []) {
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  writeFileSync(path, body ? `${body}\n` : "", "utf8");
}

function record({ disposition, reasonCodes, retryAttempt, maxReviewAttempts, forceMerged, issueNumber, issueLabels, milestone, runId, timestamp }) {
  return {
    disposition,
    confidence: "high",
    recommended_transition: disposition === "approve" ? "approved" : "revise",
    reason_codes: reasonCodes,
    retry_attempt: retryAttempt,
    max_review_attempts: maxReviewAttempts,
    force_merged: forceMerged,
    issue_number: issueNumber,
    issue_labels: issueLabels,
    milestone,
    run_id: runId,
    timestamp,
  };
}

test("resolveReviewVerdictsLogPath scopes verdict log to factory runs dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-review-metrics-resolve-"));
  const runsDir = join(dir, ".hatch", "mothership", "runs");

  const resolved = resolveReviewVerdictsLogPath({
    factoryId: "mothership",
    runsDir,
  });

  assert.equal(resolved, join(dir, ".hatch", "mothership", "review-verdicts.jsonl"));
});

test("computeReviewMetrics handles missing log path with zeroed metrics", () => {
  const path = fixturePath("missing-review-verdicts.jsonl");
  const out = computeReviewMetrics({ verdictsLogPath: path, lookbackHours: 24 });

  assert.equal(out.total_issues, 0);
  assert.equal(out.first_pass_approval_rate, 0);
  assert.equal(out.force_merge_rate, 0);
  assert.deepEqual(out.retry_distribution, {
    attempt_1: 0,
    attempt_2: 0,
    attempt_3: 0,
    force_merged: 0,
  });
  assert.deepEqual(out.top_reason_codes, []);
  assert.deepEqual(out.approval_rate_by_label, []);
});

test("computeReviewMetrics computes all first-pass approvals", () => {
  const path = fixturePath();
  const baseTs = Date.parse("2026-03-10T00:00:00.000Z");
  writeJsonl(path, Array.from({ length: 5 }, (_, idx) => ({
    ...record({
    disposition: "approve",
    reasonCodes: [],
    retryAttempt: 1,
    maxReviewAttempts: 3,
    forceMerged: false,
    issueNumber: 100 + idx,
    issueLabels: ["feature"],
    milestone: "goal-1-wave-1",
    runId: `run-${idx + 1}`,
    timestamp: baseTs + (idx * 1000),
    }),
  })));

  const out = computeReviewMetrics({ verdictsLogPath: path });
  assert.equal(out.total_issues, 5);
  assert.equal(out.first_pass_approval_rate, 1);
  assert.equal(out.force_merge_rate, 0);
  assert.equal(out.retry_distribution.attempt_1, 5);
  assert.equal(out.retry_distribution.attempt_2, 0);
  assert.equal(out.retry_distribution.attempt_3, 0);
  assert.equal(out.retry_distribution.force_merged, 0);
});

test("computeReviewMetrics computes all force-merged issues", () => {
  const path = fixturePath();
  const baseTs = Date.parse("2026-03-10T01:00:00.000Z");
  writeJsonl(path, Array.from({ length: 3 }, (_, idx) => ({
    ...record({
    disposition: "reject",
    reasonCodes: ["missing_test_coverage"],
    retryAttempt: 3,
    maxReviewAttempts: 3,
    forceMerged: true,
    issueNumber: 200 + idx,
    issueLabels: ["bug"],
    milestone: "goal-2-wave-1",
    runId: `force-${idx + 1}`,
    timestamp: baseTs + (idx * 1000),
    }),
  })));

  const out = computeReviewMetrics({ verdictsLogPath: path });
  assert.equal(out.total_issues, 3);
  assert.equal(out.first_pass_approval_rate, 0);
  assert.equal(out.force_merge_rate, 1);
  assert.equal(out.retry_distribution.force_merged, 3);
  assert.equal(out.retry_distribution.attempt_1, 0);
  assert.equal(out.retry_distribution.attempt_2, 0);
  assert.equal(out.retry_distribution.attempt_3, 0);
});

test("computeReviewMetrics computes mixed retry/force/label aggregates", () => {
  const path = fixturePath();
  const baseTs = Date.parse("2026-03-10T02:00:00.000Z");
  writeJsonl(path, [
    {
      ...record({
      disposition: "approve",
      reasonCodes: [],
      retryAttempt: 1,
      maxReviewAttempts: 3,
      forceMerged: false,
      issueNumber: 301,
      issueLabels: ["feature"],
      milestone: "goal-3-wave-1",
      runId: "run-301-a1",
      timestamp: baseTs + 1_000,
      }),
    },
    {
      ...record({
      disposition: "reject",
      reasonCodes: ["missing_test_coverage", "lint_failure"],
      retryAttempt: 1,
      maxReviewAttempts: 3,
      forceMerged: false,
      issueNumber: 302,
      issueLabels: ["feature"],
      milestone: "goal-3-wave-1",
      runId: "run-302-a1",
      timestamp: baseTs + 2_000,
      }),
    },
    {
      ...record({
      disposition: "approve",
      reasonCodes: [],
      retryAttempt: 2,
      maxReviewAttempts: 3,
      forceMerged: false,
      issueNumber: 302,
      issueLabels: ["feature"],
      milestone: "goal-3-wave-1",
      runId: "run-302-a2",
      timestamp: baseTs + 3_000,
      }),
    },
    {
      ...record({
      disposition: "reject",
      reasonCodes: ["missing_test_coverage", "type_error"],
      retryAttempt: 1,
      maxReviewAttempts: 3,
      forceMerged: false,
      issueNumber: 303,
      issueLabels: ["bug"],
      milestone: "goal-3-wave-1",
      runId: "run-303-a1",
      timestamp: baseTs + 4_000,
      }),
    },
    {
      ...record({
      disposition: "reject",
      reasonCodes: ["missing_test_coverage", "type_error"],
      retryAttempt: 2,
      maxReviewAttempts: 3,
      forceMerged: false,
      issueNumber: 303,
      issueLabels: ["bug"],
      milestone: "goal-3-wave-1",
      runId: "run-303-a2",
      timestamp: baseTs + 5_000,
      }),
    },
    {
      ...record({
      disposition: "reject",
      reasonCodes: ["type_error"],
      retryAttempt: 3,
      maxReviewAttempts: 3,
      forceMerged: true,
      issueNumber: 303,
      issueLabels: ["bug"],
      milestone: "goal-3-wave-1",
      runId: "run-303-a3",
      timestamp: baseTs + 6_000,
      }),
    },
  ]);

  const out = computeReviewMetrics({ verdictsLogPath: path });

  assert.equal(out.total_issues, 3);
  assert.equal(out.first_pass_approval_rate, 1 / 3);
  assert.equal(out.force_merge_rate, 1 / 3);
  assert.deepEqual(out.retry_distribution, {
    attempt_1: 1,
    attempt_2: 1,
    attempt_3: 0,
    force_merged: 1,
  });

  assert.deepEqual(out.top_reason_codes, [
    { code: "missing_test_coverage", count: 3 },
    { code: "type_error", count: 3 },
    { code: "lint_failure", count: 1 },
  ]);

  assert.deepEqual(out.approval_rate_by_label, [
    { label: "bug", approved: 0, total: 3, rate: 0 },
    { label: "feature", approved: 2, total: 3, rate: 2 / 3 },
  ]);
});

test("computeReviewMetrics applies window after timestamp ordering", () => {
  const path = fixturePath();
  const baseTs = Date.parse("2026-03-10T03:00:00.000Z");
  writeJsonl(path, Array.from({ length: 10 }, (_, idx) => ({
    ...record({
    disposition: idx < 5 ? "reject" : "approve",
    reasonCodes: idx < 5 ? ["missing_test_coverage"] : [],
    retryAttempt: 1,
    maxReviewAttempts: 3,
    forceMerged: false,
    issueNumber: 400 + idx,
    issueLabels: ["feature"],
    milestone: "goal-4-wave-1",
    runId: `run-${idx + 1}`,
    timestamp: baseTs + (idx * 1000),
    }),
  })));

  const out = computeReviewMetrics({ verdictsLogPath: path, window: 5 });
  assert.equal(out.total_issues, 5);
  assert.equal(out.first_pass_approval_rate, 1);
  assert.equal(out.force_merge_rate, 0);
  assert.equal(out.retry_distribution.attempt_1, 5);
  assert.deepEqual(out.top_reason_codes, []);
});
