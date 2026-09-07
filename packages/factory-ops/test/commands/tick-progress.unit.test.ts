import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeTickProgress,
  computeStuckWarning,
  NODE_DURATION_THRESHOLDS_MS,
} from "../../src/lib/factory-tick-run-projection.ts";

describe("computeTickProgress", () => {
  it("returns made_progress=true when executable_goals is non-empty and spawns occurred", () => {
    const ctx = {
      executable_goals: [2320],
      __fan_out_detached_spawn_count: 1,
    };
    const result = computeTickProgress(ctx);
    assert.equal(result.made_progress, true);
    assert.match(result.summary, /dispatched 1 goal/);
    assert.match(result.summary, /spawned 1 execution/);
  });

  it("returns made_progress=false when executable_goals is empty and no spawn/merge counts", () => {
    const ctx = {
      executable_goals: [],
    };
    const result = computeTickProgress(ctx);
    assert.equal(result.made_progress, false);
    assert.equal(result.summary, "no progress");
  });

  it("includes merged_count in summary", () => {
    const ctx = { executable_goals: [], merged_count: 3 };
    const result = computeTickProgress(ctx);
    assert.equal(result.made_progress, true);
    assert.match(result.summary, /merged 3 issue/);
  });

  it("includes closed_count in summary", () => {
    const ctx = { executable_goals: [], closed_count: 2 };
    const result = computeTickProgress(ctx);
    assert.equal(result.made_progress, true);
    assert.match(result.summary, /closed 2 issue/);
  });

  it("handles multiple dispatched goals", () => {
    const ctx = { executable_goals: [100, 200, 300] };
    const result = computeTickProgress(ctx);
    assert.equal(result.made_progress, true);
    assert.match(result.summary, /dispatched 3 goal/);
  });

  it("handles missing context gracefully", () => {
    const result = computeTickProgress({});
    assert.equal(result.made_progress, false);
    assert.equal(result.summary, "no progress");
  });

  it("handles undefined context gracefully", () => {
    const result = computeTickProgress(undefined);
    assert.equal(result.made_progress, false);
    assert.equal(result.summary, "no progress");
  });

  it("treats fresh child activity as progress", () => {
    const result = computeTickProgress({}, { active_child_progress_count: 2 });
    assert.equal(result.made_progress, true);
    assert.match(result.summary, /active child progress in 2 runs/);
  });
});

describe("computeStuckWarning", () => {
  it("triggers when elapsed exceeds threshold for a known node", () => {
    const result = computeStuckWarning("clean_main", 15 * 60_000);
    assert.ok(result.length > 0, "expected non-empty stuck_warning");
    assert.match(result, /clean_main/);
    assert.match(result, /15m/);
    assert.match(result, /threshold: 10m/);
  });

  it("returns empty string when elapsed is within threshold", () => {
    const result = computeStuckWarning("clean_main", 5 * 60_000);
    assert.equal(result, "");
  });

  it("uses default threshold for unknown nodes", () => {
    const result = computeStuckWarning("some_unknown_node", 6 * 60_000);
    assert.ok(result.length > 0, "should trigger with default 5m threshold");
    assert.match(result, /some_unknown_node/);
  });

  it("does not trigger for unknown nodes within default threshold", () => {
    const result = computeStuckWarning("some_unknown_node", 3 * 60_000);
    assert.equal(result, "");
  });

  it("uses wave_execute threshold of 30 minutes", () => {
    assert.equal(NODE_DURATION_THRESHOLDS_MS["wave_execute"], 30 * 60_000);
    const result = computeStuckWarning("wave_execute", 25 * 60_000);
    assert.equal(result, "");

    const stuck = computeStuckWarning("wave_execute", 35 * 60_000);
    assert.ok(stuck.length > 0);
  });

  it("uses supervisor_review threshold of 15 minutes", () => {
    assert.equal(NODE_DURATION_THRESHOLDS_MS["supervisor_review"], 15 * 60_000);
  });

  it("suppresses stuck warning when fresh child progress exists", () => {
    const result = computeStuckWarning("run_domain_graph", 31 * 60_000, {
      has_fresh_child_progress: true,
    });
    assert.equal(result, "");
  });
});
