import assert from "node:assert/strict";
import test from "node:test";

import { detectReviewHarnessDegradation } from "../../src/commands/supervisor-review-harness-degradation.ts";

test("detectReviewHarnessDegradation returns action item when force merge rate exceeds 30% over 10 issues", () => {
  const out = detectReviewHarnessDegradation({
    factoryId: "mothership",
    runsDir: ".hatch/mothership/runs",
    resolveReviewVerdictsLogPathFn: () => "/tmp/review-verdicts.ndjson",
    computeReviewMetricsFn: () => ({
      total_issues: 10,
      force_merge_rate: 0.31,
      top_reason_codes: [{ code: "SCOPE_MISMATCH", count: 4 }],
    }),
  });

  assert.ok(out, "expected degradation action item");
  assert.equal(out.problem, "REVIEW_HARNESS_DEGRADATION");
  assert.equal(out.ownership_decision, "local_fix");
  assert.equal(out.evidence.force_merge_rate, 0.31);
  assert.equal(out.evidence.total_reviewed, 10);
  assert.deepEqual(out.evidence.top_reason_codes, [{ code: "SCOPE_MISMATCH", count: 4 }]);
});

test("detectReviewHarnessDegradation returns null when force merge rate is 29%", () => {
  const out = detectReviewHarnessDegradation({
    factoryId: "mothership",
    runsDir: ".hatch/mothership/runs",
    resolveReviewVerdictsLogPathFn: () => "/tmp/review-verdicts.ndjson",
    computeReviewMetricsFn: () => ({
      total_issues: 10,
      force_merge_rate: 0.29,
      top_reason_codes: [{ code: "APPROVED", count: 7 }],
    }),
  });

  assert.equal(out, null);
});

test("detectReviewHarnessDegradation returns null when fewer than 10 reviewed issues", () => {
  const out = detectReviewHarnessDegradation({
    factoryId: "mothership",
    runsDir: ".hatch/mothership/runs",
    resolveReviewVerdictsLogPathFn: () => "/tmp/review-verdicts.ndjson",
    computeReviewMetricsFn: () => ({
      total_issues: 7,
      force_merge_rate: 0.57,
      top_reason_codes: [{ code: "TESTS_MISSING", count: 3 }],
    }),
  });

  assert.equal(out, null);
});
