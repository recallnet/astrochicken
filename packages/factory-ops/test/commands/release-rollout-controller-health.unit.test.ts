import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateReleaseCanaryHealth,
  pollReleaseCanaryHealth,
} from "../../src/commands/release-rollout-controller-health.ts";

describe("evaluateReleaseCanaryHealth", () => {
  const CHECKED_AT = "2026-03-22T00:00:00.000Z";

  it("all defaults pass (zero thresholds satisfied by zero actuals)", () => {
    const result = evaluateReleaseCanaryHealth({ checkedAt: CHECKED_AT });
    assert.equal(result.passed, true);
    assert.equal(result.verdict, "passed");
    assert.equal(result.reason, "health_check_passed");
  });

  it("factory failures exceeding max_failed_runs -> failed", () => {
    const result = evaluateReleaseCanaryHealth({
      factoryStatusSnapshot: { active: [], completed: 5, failed: 3 },
      healthPolicy: { max_failed_runs: 2 },
      checkedAt: CHECKED_AT,
    });
    assert.equal(result.passed, false);
    assert.equal(result.verdict, "failed");
    assert.equal(result.reason, "factory_status_failed_runs");
  });

  it("tick failures exceeding max_failed_ticks -> failed", () => {
    const result = evaluateReleaseCanaryHealth({
      tickStatusSnapshot: {
        ticks: [
          { status: "failed", stage: "build", stageLabel: "Build" },
          { status: "guarded", stage: "test", stageLabel: "Test" },
        ],
      },
      healthPolicy: { max_failed_ticks: 1 },
      checkedAt: CHECKED_AT,
    });
    assert.equal(result.passed, false);
    assert.equal(result.verdict, "failed");
    assert.equal(result.reason, "factory_tick_status_failed_ticks");
  });

  it("factory failures checked before tick failures (priority order)", () => {
    const result = evaluateReleaseCanaryHealth({
      factoryStatusSnapshot: { active: [], completed: 0, failed: 2 },
      tickStatusSnapshot: {
        ticks: [{ status: "failed", stage: "x", stageLabel: "X" }],
      },
      healthPolicy: { max_failed_runs: 1, max_failed_ticks: 0 },
      checkedAt: CHECKED_AT,
    });
    // Factory check fires first even though tick also would fail
    assert.equal(result.reason, "factory_status_failed_runs");
  });

  it("outcomes below policy minimum -> pending with reason listing pending checks", () => {
    const result = evaluateReleaseCanaryHealth({
      outcomesSnapshot: { merged_prs: 0 },
      healthPolicy: { min_merged_prs: 1 },
      checkedAt: CHECKED_AT,
    });
    assert.equal(result.passed, false);
    assert.equal(result.verdict, "pending");
    assert.equal(result.reason, "health_outcomes_pending:merged_prs");
  });

  it("multiple pending checks listed in reason", () => {
    const result = evaluateReleaseCanaryHealth({
      outcomesSnapshot: {
        merged_prs: 0,
        closed_bugs: 0,
        closed_feature_bug_total: 0,
      },
      healthPolicy: {
        min_merged_prs: 2,
        min_closed_bugs: 1,
        min_closed_feature_bug_total: 3,
      },
      checkedAt: CHECKED_AT,
    });
    assert.equal(result.passed, false);
    assert.equal(result.verdict, "pending");
    assert.equal(
      result.reason,
      "health_outcomes_pending:merged_prs,closed_bugs,closed_feature_bug_total",
    );
  });

  it("all outcomes meet thresholds -> passed", () => {
    const result = evaluateReleaseCanaryHealth({
      outcomesSnapshot: {
        merged_prs: 5,
        merge_commits_main: 3,
        closed_features: 2,
        closed_bugs: 1,
        closed_feature_bug_total: 3,
      },
      healthPolicy: {
        min_merged_prs: 5,
        min_merge_commits_main: 3,
        min_closed_features: 2,
        min_closed_bugs: 1,
        min_closed_feature_bug_total: 3,
      },
      checkedAt: CHECKED_AT,
    });
    assert.equal(result.passed, true);
    assert.equal(result.verdict, "passed");
    assert.equal(result.reason, "health_check_passed");
  });

  it("checkedAt is preserved in snapshot", () => {
    const result = evaluateReleaseCanaryHealth({ checkedAt: CHECKED_AT });
    assert.equal(result.snapshot.checked_at, CHECKED_AT);
  });

  it("all failing tick statuses are recognized", () => {
    const statuses = ["failed", "guarded", "guarded_terminal", "blocked", "suspended", "terminal"];
    const ticks = statuses.map((s) => ({ status: s, stage: "", stageLabel: "" }));
    const result = evaluateReleaseCanaryHealth({
      tickStatusSnapshot: { ticks },
      healthPolicy: { max_failed_ticks: 5 },
      checkedAt: CHECKED_AT,
    });
    // 6 failing ticks > max 5
    assert.equal(result.passed, false);
    assert.equal(result.verdict, "failed");
    assert.equal(result.reason, "factory_tick_status_failed_ticks");
  });
});

describe("pollReleaseCanaryHealth", () => {
  const NOW = "2026-03-22T00:00:00.000Z";
  const nowIsoFn = () => NOW;
  const noSleep = async () => {};

  function makeStubs({ factory = {}, tick = {}, outcomes = {} } = {}) {
    return {
      factoryStatusFn: () => factory,
      tickStatusFn: () => tick,
      outcomesFn: () => outcomes,
    };
  }

  it("single poll passes", async () => {
    const stubs = makeStubs();
    const result = await pollReleaseCanaryHealth({
      ...stubs,
      healthPolicy: { max_polls: 1 },
      sleepFn: noSleep,
      nowIsoFn,
    });
    assert.equal(result.ok, true);
    assert.equal(result.passed, true);
    assert.equal(result.verdict, "passed");
    assert.equal(result.poll_count, 1);
    assert.equal(result.snapshots.length, 1);
  });

  it("single poll fails on factory failures", async () => {
    const stubs = makeStubs({ factory: { active: [], completed: 0, failed: 2 } });
    const result = await pollReleaseCanaryHealth({
      ...stubs,
      healthPolicy: { max_polls: 1, max_failed_runs: 1 },
      sleepFn: noSleep,
      nowIsoFn,
    });
    assert.equal(result.ok, true);
    assert.equal(result.passed, false);
    assert.equal(result.verdict, "failed");
    assert.equal(result.reason, "factory_status_failed_runs");
    assert.equal(result.poll_count, 1);
  });

  it("polls until pass with correct poll_count", async () => {
    let callCount = 0;
    const result = await pollReleaseCanaryHealth({
      factoryStatusFn: () => ({}),
      tickStatusFn: () => ({}),
      outcomesFn: () => {
        callCount += 1;
        // First two calls: not enough merged_prs; third call: enough
        return { merged_prs: callCount >= 3 ? 2 : 0 };
      },
      healthPolicy: { max_polls: 5, min_merged_prs: 2, poll_interval_ms: 0 },
      sleepFn: noSleep,
      nowIsoFn,
    });
    assert.equal(result.ok, true);
    assert.equal(result.passed, true);
    assert.equal(result.verdict, "passed");
    assert.equal(result.poll_count, 3);
    assert.equal(result.snapshots.length, 3);
  });

  it("max polls reached without pass -> timeout", async () => {
    const result = await pollReleaseCanaryHealth({
      ...makeStubs({ outcomes: { merged_prs: 0 } }),
      healthPolicy: { max_polls: 3, min_merged_prs: 5, poll_interval_ms: 0 },
      sleepFn: noSleep,
      nowIsoFn,
    });
    assert.equal(result.ok, true);
    assert.equal(result.passed, false);
    assert.equal(result.verdict, "timeout");
    assert.equal(result.reason, "health_check_timeout");
    assert.equal(result.poll_count, 3);
    assert.equal(result.snapshots.length, 3);
  });

  it("signal read error -> health_signal_read_failed", async () => {
    const result = await pollReleaseCanaryHealth({
      factoryStatusFn: () => {
        throw new Error("disk on fire");
      },
      tickStatusFn: () => ({}),
      outcomesFn: () => ({}),
      healthPolicy: { max_polls: 3 },
      sleepFn: noSleep,
      nowIsoFn,
    });
    assert.equal(result.ok, false);
    assert.equal(result.passed, false);
    assert.equal(result.verdict, "failed");
    assert.equal(result.reason, "health_signal_read_failed");
    assert.equal(result.error, "disk on fire");
    assert.equal(result.poll_count, 1);
  });

  it("sleepFn is called between polls but not after the last", async () => {
    let sleepCalls = 0;
    const result = await pollReleaseCanaryHealth({
      ...makeStubs({ outcomes: { merged_prs: 0 } }),
      healthPolicy: { max_polls: 3, min_merged_prs: 5, poll_interval_ms: 100 },
      sleepFn: async () => { sleepCalls += 1; },
      nowIsoFn,
    });
    assert.equal(result.verdict, "timeout");
    // sleep called between poll 1->2 and 2->3, not after 3
    assert.equal(sleepCalls, 2);
  });
});
