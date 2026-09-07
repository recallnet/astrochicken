import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateStalledWaves } from "../../src/commands/supervisor-diagnose-stalled-waves.ts";

const NOW = Date.parse("2026-03-23T12:00:00Z");

function minutesAgo(n) {
  return new Date(NOW - n * 60000).toISOString();
}

function makeWave(overrides = {}) {
  return {
    number: 1,
    title: "Wave Ready: v1",
    updatedAt: minutesAgo(30),
    labels: [],
    features: [],
    active_run_ids: [],
    ...overrides,
  };
}

describe("evaluateStalledWaves", () => {
  // 1. Empty waves
  it("returns [] for empty inProgressWaves", () => {
    const result = evaluateStalledWaves({ inProgressWaves: [], nowMs: NOW });
    assert.deepStrictEqual(result, []);
  });

  // 2. No args
  it("returns [] when called with no arguments", () => {
    const result = evaluateStalledWaves();
    assert.deepStrictEqual(result, []);
  });

  // 3. Wave updated 30 min ago, threshold 20 → stale (wave_marker_stale)
  it("detects wave_marker_stale when wave is older than threshold with no features", () => {
    const wave = makeWave({ updatedAt: minutesAgo(30) });
    const result = evaluateStalledWaves({ inProgressWaves: [wave], staleMinutes: 20, nowMs: NOW });
    assert.equal(result.length, 1);
    assert.equal(result[0].reason, "wave_marker_stale");
  });

  // 4. Wave updated 10 min ago, threshold 20 → not stale
  it("does not flag a fresh wave", () => {
    const wave = makeWave({ updatedAt: minutesAgo(10) });
    const result = evaluateStalledWaves({ inProgressWaves: [wave], staleMinutes: 20, nowMs: NOW });
    assert.deepStrictEqual(result, []);
  });

  // 5. Wave updated 30 min ago with stale features → wave_and_feature_stale
  it("detects wave_and_feature_stale when both wave and all features are stale", () => {
    const wave = makeWave({
      updatedAt: minutesAgo(30),
      features: [
        { number: 10, title: "feat A", updatedAt: minutesAgo(25) },
        { number: 11, title: "feat B", updatedAt: minutesAgo(40) },
      ],
    });
    const result = evaluateStalledWaves({ inProgressWaves: [wave], staleMinutes: 20, nowMs: NOW });
    assert.equal(result.length, 1);
    assert.equal(result[0].reason, "wave_and_feature_stale");
  });

  // 6. Wave fresh but all features stale → feature_inactivity_stale
  it("detects feature_inactivity_stale when wave is fresh but all features are stale", () => {
    const wave = makeWave({
      updatedAt: minutesAgo(10),
      features: [
        { number: 10, title: "feat A", updatedAt: minutesAgo(25) },
        { number: 11, title: "feat B", updatedAt: minutesAgo(30) },
      ],
    });
    const result = evaluateStalledWaves({ inProgressWaves: [wave], staleMinutes: 20, nowMs: NOW });
    assert.equal(result.length, 1);
    assert.equal(result[0].reason, "feature_inactivity_stale");
  });

  // 7. Wave in activeMilestones → skipped
  it("skips waves whose milestone is in activeMilestones", () => {
    const wave = makeWave({ updatedAt: minutesAgo(30), milestone: { title: "v1" } });
    const result = evaluateStalledWaves({
      inProgressWaves: [wave],
      activeMilestones: new Set(["v1"]),
      staleMinutes: 20,
      nowMs: NOW,
    });
    assert.deepStrictEqual(result, []);
  });

  // 8. Wave NOT in activeMilestones → evaluated
  it("evaluates waves not in activeMilestones", () => {
    const wave = makeWave({ updatedAt: minutesAgo(30), milestone: { title: "v1" } });
    const result = evaluateStalledWaves({
      inProgressWaves: [wave],
      activeMilestones: new Set(["v2"]),
      staleMinutes: 20,
      nowMs: NOW,
    });
    assert.equal(result.length, 1);
  });

  // 9. Wave stale but one feature has recent activity → not stale
  it("skips wave when at least one feature has recent activity", () => {
    const wave = makeWave({
      updatedAt: minutesAgo(30),
      features: [
        { number: 10, title: "feat A", updatedAt: minutesAgo(5) },
        { number: 11, title: "feat B", updatedAt: minutesAgo(40) },
      ],
    });
    const result = evaluateStalledWaves({ inProgressWaves: [wave], staleMinutes: 20, nowMs: NOW });
    assert.deepStrictEqual(result, []);
  });

  // 10. No features, wave stale → wave_marker_stale
  it("flags wave_marker_stale when no features and wave is stale", () => {
    const wave = makeWave({ updatedAt: minutesAgo(25), features: [] });
    const result = evaluateStalledWaves({ inProgressWaves: [wave], staleMinutes: 20, nowMs: NOW });
    assert.equal(result.length, 1);
    assert.equal(result[0].reason, "wave_marker_stale");
  });

  // 11. Milestone from milestone.title
  it("resolves milestone from milestone.title when present", () => {
    const wave = makeWave({
      updatedAt: minutesAgo(30),
      title: "Wave Ready: fallback-title",
      milestone: { title: "real-milestone" },
    });
    const result = evaluateStalledWaves({ inProgressWaves: [wave], staleMinutes: 20, nowMs: NOW });
    assert.equal(result[0].milestone, "real-milestone");
  });

  // 12. Milestone from "Wave Ready: X" title when no milestone
  it("resolves milestone from title by stripping 'Wave Ready:' prefix", () => {
    const wave = makeWave({
      updatedAt: minutesAgo(30),
      title: "Wave Ready: extracted-milestone",
      milestone: null,
    });
    const result = evaluateStalledWaves({ inProgressWaves: [wave], staleMinutes: 20, nowMs: NOW });
    assert.equal(result[0].milestone, "extracted-milestone");
  });

  // 13. Output shape has all expected fields
  it("stale entry has all expected fields", () => {
    const wave = makeWave({
      number: 42,
      title: "Wave Ready: shape-test",
      updatedAt: minutesAgo(30),
      labels: [{ name: "ready" }],
      active_run_ids: ["run-1"],
      features: [{ number: 7, title: "feat", updatedAt: minutesAgo(25) }],
    });
    const result = evaluateStalledWaves({ inProgressWaves: [wave], staleMinutes: 20, nowMs: NOW });
    assert.equal(result.length, 1);
    const entry = result[0];
    assert.equal(entry.reason, "wave_and_feature_stale");
    assert.equal(entry.wave_issue_number, 42);
    assert.equal(entry.wave_title, "Wave Ready: shape-test");
    assert.equal(entry.milestone, "shape-test");
    assert.equal(entry.wave_stale_minutes, 30);
    assert.equal(entry.threshold_minutes, 20);
    assert.equal(entry.open_feature_count, 1);
    assert.deepStrictEqual(entry.open_features, [{ number: 7, title: "feat", stale_minutes: 25 }]);
    assert.deepStrictEqual(entry.wave_labels, ["ready"]);
    assert.deepStrictEqual(entry.active_run_ids, ["run-1"]);
  });

  // 14. Mix of stale and non-stale → only stale returned
  it("returns only stale waves from a mixed set", () => {
    const staleWave = makeWave({ number: 1, updatedAt: minutesAgo(30) });
    const freshWave = makeWave({ number: 2, updatedAt: minutesAgo(5) });
    const activeWave = makeWave({ number: 3, updatedAt: minutesAgo(30), milestone: { title: "active-ms" } });
    const result = evaluateStalledWaves({
      inProgressWaves: [staleWave, freshWave, activeWave],
      activeMilestones: new Set(["active-ms"]),
      staleMinutes: 20,
      nowMs: NOW,
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].wave_issue_number, 1);
  });

  // 15. Custom threshold
  it("respects custom staleMinutes threshold", () => {
    const wave = makeWave({ updatedAt: minutesAgo(45) });
    const notStale = evaluateStalledWaves({ inProgressWaves: [wave], staleMinutes: 60, nowMs: NOW });
    assert.deepStrictEqual(notStale, []);

    const stale = evaluateStalledWaves({ inProgressWaves: [wave], staleMinutes: 30, nowMs: NOW });
    assert.equal(stale.length, 1);
  });
});
