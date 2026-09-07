import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectReviewHarnessDegradation } from "../../src/commands/supervisor-review-harness-degradation.ts";

function makeStubs({ logPath = "/path/to/log", metrics = {} } = {}) {
  return {
    resolveReviewVerdictsLogPathFn: ({ factoryId, runsDir }) => logPath,
    computeReviewMetricsFn: ({ verdictsLogPath, window }) => metrics,
  };
}

describe("detectReviewHarnessDegradation", () => {
  // --- Return null (no degradation) ---

  it("returns null when computeReviewMetricsFn throws", () => {
    const result = detectReviewHarnessDegradation({
      resolveReviewVerdictsLogPathFn: () => "/some/path",
      computeReviewMetricsFn: () => { throw new Error("boom"); },
    });
    assert.equal(result, null);
  });

  it("returns null when resolveReviewVerdictsLogPathFn throws", () => {
    const result = detectReviewHarnessDegradation({
      resolveReviewVerdictsLogPathFn: () => { throw new Error("boom"); },
      computeReviewMetricsFn: () => ({ total_issues: 20, force_merge_rate: 0.5 }),
    });
    assert.equal(result, null);
  });

  it("returns null when metrics is null", () => {
    const result = detectReviewHarnessDegradation({
      ...makeStubs({ metrics: null }),
    });
    assert.equal(result, null);
  });

  it("returns null when total_issues < 10 (insufficient sample)", () => {
    const result = detectReviewHarnessDegradation({
      ...makeStubs({ metrics: { total_issues: 9, force_merge_rate: 0.5 } }),
    });
    assert.equal(result, null);
  });

  it("returns null when force_merge_rate <= 0.30", () => {
    const result = detectReviewHarnessDegradation({
      ...makeStubs({ metrics: { total_issues: 20, force_merge_rate: 0.25 } }),
    });
    assert.equal(result, null);
  });

  it("returns null when force_merge_rate is exactly 0.30 (boundary)", () => {
    const result = detectReviewHarnessDegradation({
      ...makeStubs({ metrics: { total_issues: 20, force_merge_rate: 0.30 } }),
    });
    assert.equal(result, null);
  });

  // --- Return degradation object ---

  it("returns degradation when force_merge_rate > 0.30 and total_issues >= 10", () => {
    const result = detectReviewHarnessDegradation({
      ...makeStubs({ metrics: { total_issues: 15, force_merge_rate: 0.50 } }),
    });
    assert.notEqual(result, null);
    assert.equal(result.problem, "REVIEW_HARNESS_DEGRADATION");
  });

  it("returns correct problem and ownership_decision", () => {
    const result = detectReviewHarnessDegradation({
      ...makeStubs({ metrics: { total_issues: 10, force_merge_rate: 0.31 } }),
    });
    assert.equal(result.problem, "REVIEW_HARNESS_DEGRADATION");
    assert.equal(result.ownership_decision, "local_fix");
  });

  it("evidence.force_merge_rate matches input", () => {
    const result = detectReviewHarnessDegradation({
      ...makeStubs({ metrics: { total_issues: 10, force_merge_rate: 0.45 } }),
    });
    assert.equal(result.evidence.force_merge_rate, 0.45);
  });

  it("evidence.total_reviewed matches input total_issues", () => {
    const result = detectReviewHarnessDegradation({
      ...makeStubs({ metrics: { total_issues: 42, force_merge_rate: 0.50 } }),
    });
    assert.equal(result.evidence.total_reviewed, 42);
  });

  it("evidence.top_reason_codes from metrics", () => {
    const codes = ["stale_review", "timeout"];
    const result = detectReviewHarnessDegradation({
      ...makeStubs({ metrics: { total_issues: 10, force_merge_rate: 0.50, top_reason_codes: codes } }),
    });
    assert.deepEqual(result.evidence.top_reason_codes, codes);
  });

  it("evidence.top_reason_codes defaults to [] when missing", () => {
    const result = detectReviewHarnessDegradation({
      ...makeStubs({ metrics: { total_issues: 10, force_merge_rate: 0.50 } }),
    });
    assert.deepEqual(result.evidence.top_reason_codes, []);
  });

  it("evidence.top_reason_codes defaults to [] when non-array", () => {
    const result = detectReviewHarnessDegradation({
      ...makeStubs({ metrics: { total_issues: 10, force_merge_rate: 0.50, top_reason_codes: "not-array" } }),
    });
    assert.deepEqual(result.evidence.top_reason_codes, []);
  });

  it("suggested_action is present", () => {
    const result = detectReviewHarnessDegradation({
      ...makeStubs({ metrics: { total_issues: 10, force_merge_rate: 0.50 } }),
    });
    assert.equal(result.suggested_action, "hatch-ops factory review-metrics --lookback-hours 24 --json");
  });

  // --- DI verification ---

  it("resolveReviewVerdictsLogPathFn receives factoryId and runsDir", () => {
    let captured;
    detectReviewHarnessDegradation({
      factoryId: "  my-factory  ",
      runsDir: "  custom/runs  ",
      resolveReviewVerdictsLogPathFn: (args) => { captured = args; return "/p"; },
      computeReviewMetricsFn: () => ({ total_issues: 10, force_merge_rate: 0.50 }),
    });
    assert.equal(captured.factoryId, "my-factory");
    assert.equal(captured.runsDir, "custom/runs");
  });

  it("computeReviewMetricsFn receives verdictsLogPath and window=10", () => {
    let captured;
    detectReviewHarnessDegradation({
      resolveReviewVerdictsLogPathFn: () => "/resolved/path",
      computeReviewMetricsFn: (args) => { captured = args; return { total_issues: 10, force_merge_rate: 0.50 }; },
    });
    assert.equal(captured.verdictsLogPath, "/resolved/path");
    assert.equal(captured.window, 10);
  });
});
