import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectReviewVerdictFromRunState } from "../src/commands/wave-issue-review-verdict-inspect.ts";

function writeRunState(runsDir, runId, state) {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

test("inspectReviewVerdictFromRunState returns review verdict, route reason, and raw reviewer output", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "wave-issue-review-inspect-"));
  writeRunState(runsDir, "run-1", {
    runId: "run-1",
    status: "completed",
    currentNode: "done",
    context: {
      review_attempt: "3",
      max_review_attempts: "3",
      retry_review: "false",
    },
    records: [
      {
        nodeId: "review",
        outcome: {
          output: JSON.stringify({
            review_verdict: "revise",
            review_reason_codes: ["SCOPE_MISMATCH"],
            review_notes: "Narrow scope to issue changed files",
          }),
        },
      },
      {
        nodeId: "resolve_review_route",
        outcome: {
          output: JSON.stringify({
            review_verdict: "revise",
            review_route_reason: "non_approve_verdict",
          }),
        },
      },
    ],
  });

  const out = inspectReviewVerdictFromRunState({ runId: "run-1", runsDir });
  assert.equal(out.ok, true);
  assert.equal(out.run_id, "run-1");
  assert.equal(out.review_verdict, "revise");
  assert.equal(out.review_route_reason, "non_approve_verdict");
  assert.match(String(out.raw_reviewer_output || ""), /SCOPE_MISMATCH/);
  assert.equal(out.trigger_reason, "retry_exhausted");
});

test("inspectReviewVerdictFromRunState returns run_not_found for missing run", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "wave-issue-review-inspect-missing-"));
  const out = inspectReviewVerdictFromRunState({ runId: "missing", runsDir });
  assert.equal(out.ok, false);
  assert.equal(out.error, "run_not_found");
  assert.equal(out.run_id, "missing");
});
