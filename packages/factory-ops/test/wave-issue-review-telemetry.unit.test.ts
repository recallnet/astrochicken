import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { emitReviewVerdictTelemetry } from "../src/commands/wave-issue-review-telemetry.ts";

function verdict({ disposition, transition, reasonCodes, notes = "" }) {
  return JSON.stringify({
    schema: "verdict/v1",
    verdict_kind: "code_review",
    disposition,
    confidence: "high",
    recommended_transition: transition,
    observation: { summary: "fixture" },
    recommendation: { action: transition },
    reason_codes: reasonCodes,
    notes,
  });
}

test("emitReviewVerdictTelemetry appends telemetry records to factory-scoped jsonl log", async () => {
  const root = mkdtempSync(join(tmpdir(), "wave-issue-review-telemetry-unit-"));
  const runsDir = join(root, ".hatch", "unit-factory", "runs");

  const first = await emitReviewVerdictTelemetry({
    factoryId: "unit-factory",
    runId: "run-1",
    issueNumber: 101,
    milestone: "goal-101-wave-1",
    verdictRaw: verdict({ disposition: "reject", transition: "revise", reasonCodes: ["LOGIC_INCORRECT"], notes: "needs work" }),
    retryAttempt: 3,
    maxReviewAttempts: 3,
    issueLabels: ["feature"],
    runsDir,
  });

  const second = await emitReviewVerdictTelemetry({
    factoryId: "unit-factory",
    runId: "run-2",
    issueNumber: 102,
    milestone: "goal-101-wave-1",
    verdictRaw: verdict({ disposition: "approve", transition: "approved", reasonCodes: ["APPROVED"] }),
    retryAttempt: 1,
    maxReviewAttempts: 3,
    issueLabels: ["bug"],
    runsDir,
  });

  assert.equal(existsSync(first.log_path), true);
  assert.equal(first.log_path, second.log_path);

  const lines = readFileSync(first.log_path, "utf8").trim().split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 2);

  const firstRecord = JSON.parse(lines[0]);
  const secondRecord = JSON.parse(lines[1]);
  assert.equal(firstRecord.run_id, "run-1");
  assert.equal(firstRecord.force_merged, true);
  assert.equal(firstRecord.disposition, "reject");
  assert.deepEqual(firstRecord.reason_codes, ["LOGIC_INCORRECT"]);

  assert.equal(secondRecord.run_id, "run-2");
  assert.equal(secondRecord.force_merged, false);
  assert.equal(secondRecord.disposition, "approve");
  assert.deepEqual(secondRecord.reason_codes, ["APPROVED"]);
});
