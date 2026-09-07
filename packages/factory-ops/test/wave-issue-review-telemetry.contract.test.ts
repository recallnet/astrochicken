import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  emitReviewVerdictTelemetry,
  resolveReviewVerdictsLogPath,
} from "../src/commands/wave-issue-review-telemetry.ts";

function readLastJsonlRecord(path) {
  const lines = readFileSync(path, "utf8").trim().split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length > 0, "review verdict log must contain at least one record");
  return JSON.parse(lines[lines.length - 1]);
}

test("resolveReviewVerdictsLogPath resolves to factory-scoped .hatch log", () => {
  const path = resolveReviewVerdictsLogPath({ factoryId: "test-factory" });
  assert.match(path, new RegExp(`\\.hatch[/\\\\]test-factory[/\\\\]review-verdicts\\.jsonl$`));
});

test("emitReviewVerdictTelemetry writes schema-complete JSONL record", async () => {
  const root = mkdtempSync(join(tmpdir(), "review-verdict-telemetry-"));
  const runsDir = join(root, ".hatch", "test-factory", "runs");

  const out = await emitReviewVerdictTelemetry({
    factoryId: "test-factory",
    runId: "run-001",
    issueNumber: 123,
    milestone: "goal-123-wave-1",
    reviewVerdict: "approve",
    reviewReasonCodes: ["APPROVED"],
    retryAttempt: 1,
    maxReviewAttempts: 3,
    issueLabels: ["feature"],
    runsDir,
  });

  assert.equal(out.ok, true);
  const record = readLastJsonlRecord(out.log_path);
  assert.equal(record.schema_version, "review-verdict/v1");
  assert.equal(record.run_id, "run-001");
  assert.equal(record.issue_number, 123);
  assert.equal(record.milestone, "goal-123-wave-1");
  assert.equal(record.review_verdict, "approve");
  assert.deepEqual(record.review_reason_codes, ["APPROVED"]);
  assert.equal(record.retry_attempt, 1);
  assert.equal(record.max_review_attempts, 3);
  assert.equal(record.force_merged, false);
  assert.deepEqual(record.issue_labels, ["feature"]);
  assert.equal(typeof record.emitted_at, "string");
  assert.equal(Number.isNaN(Date.parse(record.emitted_at)), false);

  assert.ok(["approve", "revise"].includes(record.review_verdict));
  assert.ok(Array.isArray(record.review_reason_codes));
  assert.ok(record.review_reason_codes.length > 0);
});

test("emitReviewVerdictTelemetry derives force_merged=true on revise at max attempts", async () => {
  const root = mkdtempSync(join(tmpdir(), "review-verdict-telemetry-force-"));
  const runsDir = join(root, ".hatch", "test-factory", "runs");

  const out = await emitReviewVerdictTelemetry({
    factoryId: "test-factory",
    runId: "run-002",
    issueNumber: 124,
    milestone: "goal-124-wave-1",
    reviewVerdict: "revise",
    reviewReasonCodes: ["LOGIC_INCORRECT"],
    retryAttempt: 3,
    maxReviewAttempts: 3,
    issueLabels: ["bug"],
    runsDir,
  });

  const record = readLastJsonlRecord(out.log_path);
  assert.equal(record.force_merged, true);
});

test("emitReviewVerdictTelemetry derives force_merged=false for approve at max attempts", async () => {
  const root = mkdtempSync(join(tmpdir(), "review-verdict-telemetry-approve-max-"));
  const runsDir = join(root, ".hatch", "test-factory", "runs");

  const out = await emitReviewVerdictTelemetry({
    factoryId: "test-factory",
    runId: "run-003",
    issueNumber: 125,
    milestone: "goal-125-wave-1",
    reviewVerdict: "approve",
    reviewReasonCodes: ["APPROVED"],
    retryAttempt: 3,
    maxReviewAttempts: 3,
    issueLabels: [],
    runsDir,
  });

  const record = readLastJsonlRecord(out.log_path);
  assert.equal(record.force_merged, false);
});

test("emitReviewVerdictTelemetry derives force_merged=false for revise below max attempts", async () => {
  const root = mkdtempSync(join(tmpdir(), "review-verdict-telemetry-revise-below-"));
  const runsDir = join(root, ".hatch", "test-factory", "runs");

  const out = await emitReviewVerdictTelemetry({
    factoryId: "test-factory",
    runId: "run-004",
    issueNumber: 126,
    milestone: "goal-126-wave-1",
    reviewVerdict: "revise",
    reviewReasonCodes: ["TESTS_MISSING"],
    retryAttempt: 2,
    maxReviewAttempts: 3,
    issueLabels: [],
    runsDir,
  });

  const record = readLastJsonlRecord(out.log_path);
  assert.equal(record.force_merged, false);
});
