import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeCapacitySnapshot,
  measureRefillLatency,
  classifyDuplicateClaims,
} from "../../src/commands/wave-throughput-invariants.ts";

// ---------------------------------------------------------------------------
// computeCapacitySnapshot
// ---------------------------------------------------------------------------

describe("computeCapacitySnapshot", () => {
  it("1 - defaults to idle_slot_count=1, no backlog", () => {
    const result = computeCapacitySnapshot();
    assert.equal(result.idle_slot_count, 1);
    assert.equal(result.ready_backlog_count, 0);
    assert.equal(result.active_wave_count, 0);
    assert.equal(result.max_concurrent_waves, 1);
    assert.equal(result.idle_with_runnable_backlog, false);
  });

  it("2 - 2 active, 3 max -> idle_slot_count=1", () => {
    const result = computeCapacitySnapshot({
      activeWaveCount: 2,
      maxConcurrentWaves: 3,
    });
    assert.equal(result.idle_slot_count, 1);
    assert.equal(result.active_wave_count, 2);
    assert.equal(result.max_concurrent_waves, 3);
  });

  it("3 - 3 active, 3 max -> idle_slot_count=0", () => {
    const result = computeCapacitySnapshot({
      activeWaveCount: 3,
      maxConcurrentWaves: 3,
    });
    assert.equal(result.idle_slot_count, 0);
  });

  it("4 - readyWaveCount > 0 && idle_slot_count > 0 -> idle_with_runnable_backlog true", () => {
    const result = computeCapacitySnapshot({
      readyWaveCount: 2,
      activeWaveCount: 1,
      maxConcurrentWaves: 3,
    });
    assert.equal(result.idle_with_runnable_backlog, true);
    assert.equal(result.idle_slot_count, 2);
    assert.equal(result.ready_backlog_count, 2);
  });

  it("5 - readyWaveCount > 0 && idle_slot_count = 0 -> idle_with_runnable_backlog false", () => {
    const result = computeCapacitySnapshot({
      readyWaveCount: 5,
      activeWaveCount: 3,
      maxConcurrentWaves: 3,
    });
    assert.equal(result.idle_with_runnable_backlog, false);
    assert.equal(result.idle_slot_count, 0);
    assert.equal(result.ready_backlog_count, 5);
  });

  it("6 - non-numeric inputs treated as 0/fallback", () => {
    const result = computeCapacitySnapshot({
      readyWaveCount: "banana",
      activeWaveCount: undefined,
      maxConcurrentWaves: NaN,
    });
    assert.equal(result.ready_backlog_count, 0);
    assert.equal(result.active_wave_count, 0);
    // maxConcurrentWaves fallback is 1
    assert.equal(result.max_concurrent_waves, 1);
    assert.equal(result.idle_slot_count, 1);
  });
});

// ---------------------------------------------------------------------------
// measureRefillLatency
// ---------------------------------------------------------------------------

describe("measureRefillLatency", () => {
  it("7 - empty events -> sample_count=0, all null", () => {
    const result = measureRefillLatency({ leaseEvents: [] });
    assert.equal(result.sample_count, 0);
    assert.equal(result.latest_ms, null);
    assert.equal(result.p50_ms, null);
    assert.equal(result.p95_ms, null);
    assert.deepEqual(result.samples, []);
  });

  it("8 - one release + one claim -> one sample with correct latency_ms", () => {
    const result = measureRefillLatency({
      leaseEvents: [
        { action: "release", at: "2026-03-22T10:00:00Z", milestone_title: "Wave-1", ready_issue_number: 42 },
        { action: "claim", at: "2026-03-22T10:05:00Z", milestone_title: "Wave-2", ready_issue_number: 43 },
      ],
    });
    assert.equal(result.sample_count, 1);
    assert.equal(result.samples[0].latency_ms, 5 * 60 * 1000);
    assert.equal(result.latest_ms, 5 * 60 * 1000);
    assert.equal(result.p50_ms, 5 * 60 * 1000);
    assert.equal(result.p95_ms, 5 * 60 * 1000);
  });

  it("9 - multiple release-claim pairs -> multiple samples", () => {
    const result = measureRefillLatency({
      leaseEvents: [
        { action: "release", at: "2026-03-22T10:00:00Z", milestone_title: "Wave-1", ready_issue_number: 1 },
        { action: "claim", at: "2026-03-22T10:01:00Z", milestone_title: "Wave-2", ready_issue_number: 2 },
        { action: "release", at: "2026-03-22T10:10:00Z", milestone_title: "Wave-2", ready_issue_number: 2 },
        { action: "claim", at: "2026-03-22T10:12:00Z", milestone_title: "Wave-3", ready_issue_number: 3 },
      ],
    });
    assert.equal(result.sample_count, 2);
    assert.equal(result.samples[0].latency_ms, 1 * 60 * 1000);
    assert.equal(result.samples[1].latency_ms, 2 * 60 * 1000);
  });

  it("10 - claims without prior release are ignored", () => {
    const result = measureRefillLatency({
      leaseEvents: [
        { action: "claim", at: "2026-03-22T10:00:00Z", milestone_title: "Wave-1", ready_issue_number: 1 },
        { action: "claim", at: "2026-03-22T10:05:00Z", milestone_title: "Wave-2", ready_issue_number: 2 },
      ],
    });
    assert.equal(result.sample_count, 0);
  });

  it("11 - releases without subsequent claim produce no sample", () => {
    const result = measureRefillLatency({
      leaseEvents: [
        { action: "release", at: "2026-03-22T10:00:00Z", milestone_title: "Wave-1", ready_issue_number: 1 },
        { action: "release", at: "2026-03-22T10:05:00Z", milestone_title: "Wave-2", ready_issue_number: 2 },
      ],
    });
    assert.equal(result.sample_count, 0);
  });

  it("12 - p50/p95 percentiles calculated from samples", () => {
    // Create 20 release-claim pairs with latencies 1..20 minutes
    const events = [];
    let baseTime = new Date("2026-03-22T10:00:00Z").getTime();
    for (let i = 1; i <= 20; i++) {
      const releaseAt = new Date(baseTime).toISOString();
      baseTime += i * 60 * 1000; // latency = i minutes
      const claimAt = new Date(baseTime).toISOString();
      events.push({ action: "release", at: releaseAt, milestone_title: `W-${i}`, ready_issue_number: i });
      events.push({ action: "claim", at: claimAt, milestone_title: `W-${i + 100}`, ready_issue_number: i + 100 });
      baseTime += 1000; // small gap before next release
    }

    const result = measureRefillLatency({ leaseEvents: events });
    assert.equal(result.sample_count, 20);

    // Latencies sorted: 1min..20min (in ms)
    // p50 = percentile(sorted, 0.5) -> rank = ceil(20*0.5) = 10 -> index 9 -> 10 min
    assert.equal(result.p50_ms, 10 * 60 * 1000);
    // p95 = percentile(sorted, 0.95) -> rank = ceil(20*0.95) = 19 -> index 18 -> 19 min
    assert.equal(result.p95_ms, 19 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// classifyDuplicateClaims
// ---------------------------------------------------------------------------

describe("classifyDuplicateClaims", () => {
  it("13 - no events -> all zeros", () => {
    const result = classifyDuplicateClaims({ leaseEvents: [] });
    assert.equal(result.total_duplicate_claims, 0);
    assert.equal(result.expected_contention_count, 0);
    assert.equal(result.unsafe_drift_count, 0);
    assert.deepEqual(result.expected_contention, []);
    assert.deepEqual(result.unsafe_drift, []);
    assert.deepEqual(result.markers, []);
  });

  it("14 - single claim per milestone -> no duplicates", () => {
    const result = classifyDuplicateClaims({
      leaseEvents: [
        { action: "claim", at: "2026-03-22T10:00:00Z", milestone_title: "Wave-1", ready_issue_number: 1 },
        { action: "claim", at: "2026-03-22T10:01:00Z", milestone_title: "Wave-2", ready_issue_number: 2 },
      ],
    });
    assert.equal(result.total_duplicate_claims, 0);
  });

  it("15 - two claims on same milestone without release -> one duplicate, unsafe_drift", () => {
    const result = classifyDuplicateClaims({
      leaseEvents: [
        { action: "claim", at: "2026-03-22T10:00:00Z", milestone_title: "Wave-1", ready_issue_number: 42 },
        { action: "claim", at: "2026-03-22T10:01:00Z", milestone_title: "Wave-1", ready_issue_number: 42 },
      ],
    });
    assert.equal(result.total_duplicate_claims, 1);
    assert.equal(result.unsafe_drift_count, 1);
    assert.equal(result.unsafe_drift[0].milestone_title, "Wave-1");
    assert.equal(result.unsafe_drift[0].classification, "unsafe_drift");
    assert.equal(result.unsafe_drift[0].reason, "concurrent_claim_without_matching_release");
    // marker: final_claim_depth=2, unresolved=1
    assert.equal(result.markers[0].final_claim_depth, 2);
    assert.equal(result.markers[0].unresolved_duplicate_count, 1);
  });

  it("16 - claim-release-claim -> no duplicate (proper lifecycle)", () => {
    const result = classifyDuplicateClaims({
      leaseEvents: [
        { action: "claim", at: "2026-03-22T10:00:00Z", milestone_title: "Wave-1", ready_issue_number: 42 },
        { action: "release", at: "2026-03-22T10:05:00Z", milestone_title: "Wave-1", ready_issue_number: 42 },
        { action: "claim", at: "2026-03-22T10:10:00Z", milestone_title: "Wave-1", ready_issue_number: 42 },
      ],
    });
    assert.equal(result.total_duplicate_claims, 0);
  });

  it("17 - claim-claim-release -> one duplicate, expected_contention", () => {
    const result = classifyDuplicateClaims({
      leaseEvents: [
        { action: "claim", at: "2026-03-22T10:00:00Z", milestone_title: "Wave-1", ready_issue_number: 42 },
        { action: "claim", at: "2026-03-22T10:01:00Z", milestone_title: "Wave-1", ready_issue_number: 42 },
        { action: "release", at: "2026-03-22T10:05:00Z", milestone_title: "Wave-1", ready_issue_number: 42 },
      ],
    });
    assert.equal(result.total_duplicate_claims, 1);
    assert.equal(result.expected_contention_count, 1);
    assert.equal(result.expected_contention[0].classification, "expected_contention");
    assert.equal(result.expected_contention[0].reason, "loser_after_winner_with_release");
    // depth goes 0->1->2->1, so final_claim_depth=1, unresolved=0
    assert.equal(result.markers[0].final_claim_depth, 1);
    assert.equal(result.markers[0].unresolved_duplicate_count, 0);
  });

  it("18 - multiple duplicates -> correct classification split", () => {
    // 3 claims, 1 release: claim, claim, claim, release
    // depth: 0->1->2->3->2
    // duplicateClaims: 2nd claim (depth was 1), 3rd claim (depth was 2)
    // final_claim_depth=2, unresolvedDuplicateCount = max(0, 2-1) = 1
    // expectedCount = max(0, 2-1) = 1
    // So first duplicate = expected_contention, second = unsafe_drift
    const result = classifyDuplicateClaims({
      leaseEvents: [
        { action: "claim", at: "2026-03-22T10:00:00Z", milestone_title: "Wave-1", ready_issue_number: 42 },
        { action: "claim", at: "2026-03-22T10:01:00Z", milestone_title: "Wave-1", ready_issue_number: 42 },
        { action: "claim", at: "2026-03-22T10:02:00Z", milestone_title: "Wave-1", ready_issue_number: 42 },
        { action: "release", at: "2026-03-22T10:05:00Z", milestone_title: "Wave-1", ready_issue_number: 42 },
      ],
    });
    assert.equal(result.total_duplicate_claims, 2);
    assert.equal(result.expected_contention_count, 1);
    assert.equal(result.unsafe_drift_count, 1);
    assert.equal(result.markers[0].duplicate_claim_count, 2);
    assert.equal(result.markers[0].unresolved_duplicate_count, 1);
    assert.equal(result.markers[0].final_claim_depth, 2);
  });
});
