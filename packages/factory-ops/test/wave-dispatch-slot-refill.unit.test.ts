import assert from "node:assert/strict";
import test from "node:test";

import { computeSelectedWaves } from "../src/commands/wave-dispatch-select.ts";
import { enumerateWaveSlots } from "../src/commands/wave-enumerate-slots.ts";

/**
 * Slot refill state machine tests.
 *
 * These test the dispatch pipeline's ability to fill empty slots across
 * multiple tick cycles. The state machine is:
 *
 *   empty → ready → in_progress → completed
 *                                → stale (cleanup failed)
 *
 * The core invariant: when a wave completes (marker closed) or stalls,
 * the freed slot MUST be refilled on the next tick if ready work exists.
 */

// ── helpers ────────────────────────────────────────────────────────────

function readyIssue(number, milestone, labels = ["ready"]) {
  return {
    number,
    title: `Wave Ready: ${milestone}`,
    labels: labels.map((name) => ({ name })),
    milestone: { title: milestone },
    state: "OPEN",
  };
}

function milestone(title) {
  return { title };
}

function noBlockedBy() {
  return () => [];
}

function noControlPlaneBlocker() {
  return () => ({ blocked: false });
}

/**
 * Simulate one tick of the dispatch pipeline: computeSelectedWaves → enumerateWaveSlots.
 * Returns the slot count that would be passed to spawn_wave_runs.
 */
function simulateTick({ milestones, readyIssues, maxConcurrent, milestoneIssues = {} }) {
  const selection = computeSelectedWaves({
    milestones,
    readyIssues,
    closedMarkers: [],
    prioritiesText: "",
    maxConcurrent,
    getMilestoneOpenIssues: (title) => milestoneIssues[title] || [],
    getBlockedBy: noBlockedBy(),
    getControlPlaneBlocker: noControlPlaneBlocker(),
  });

  const slots = JSON.parse(enumerateWaveSlots({
    maxConcurrent: String(maxConcurrent),
    readyCount: String(selection.ready_count),
    inFlightCount: String(selection.in_flight_count),
    selectedCount: String(selection.selected_count),
  }));

  return {
    ...selection,
    slot_count: slots.length,
    slots,
  };
}

/**
 * Simulate one tick with SPLIT maxConcurrent values — reproduces the graph
 * topology where decide_wave_dispatch and enumerate_wave_slots can receive
 * different max_concurrent_waves values.
 *
 * In the supervisor tick graph:
 *   - decide_wave_dispatch uses ${max_concurrent_waves} which may be UNSET
 *     when goal_count=0 (goal_decompose_backpressure is skipped)
 *   - set_max_concurrent_waves runs AFTER dispatch, setting the real value
 *   - enumerate_wave_slots then uses the real value
 *
 * This simulates that split by allowing different maxConcurrent for dispatch
 * vs slot enumeration.
 */
function simulateTickWithSplitConcurrency({
  milestones, readyIssues, dispatchMaxConcurrent, slotsMaxConcurrent, milestoneIssues = {},
}) {
  const selection = computeSelectedWaves({
    milestones,
    readyIssues,
    closedMarkers: [],
    prioritiesText: "",
    maxConcurrent: dispatchMaxConcurrent,
    getMilestoneOpenIssues: (title) => milestoneIssues[title] || [],
    getBlockedBy: noBlockedBy(),
    getControlPlaneBlocker: noControlPlaneBlocker(),
  });

  const slots = JSON.parse(enumerateWaveSlots({
    maxConcurrent: String(slotsMaxConcurrent),
    readyCount: String(selection.ready_count),
    inFlightCount: String(selection.in_flight_count),
    selectedCount: String(selection.selected_count),
  }));

  return {
    ...selection,
    slot_count: slots.length,
    slots,
  };
}

// ── state machine scenarios ────────────────────────────────────────────

test("tick 1: initial dispatch fills all available slots", () => {
  const result = simulateTick({
    milestones: [
      milestone("goal-1-wave-1"),
      milestone("goal-2-wave-1"),
      milestone("goal-3-wave-1"),
    ],
    readyIssues: [], // no markers exist yet
    maxConcurrent: 8,
    milestoneIssues: {
      "goal-1-wave-1": [{ number: 10, title: "Feature A", labels: [] }],
      "goal-2-wave-1": [{ number: 20, title: "Feature B", labels: [] }],
      "goal-3-wave-1": [{ number: 30, title: "Feature C", labels: [] }],
    },
  });

  assert.equal(result.selected_count, 3, "should select all 3 candidates");
  assert.equal(result.in_flight_count, 0, "nothing in flight yet");
  assert.equal(result.slot_count, 3, "should spawn 3 wave processes");
});

test("tick 2: waves in flight, no changes → 0 new slots (idle)", () => {
  const result = simulateTick({
    milestones: [
      milestone("goal-1-wave-1"),
      milestone("goal-2-wave-1"),
      milestone("goal-3-wave-1"),
    ],
    readyIssues: [
      readyIssue(100, "goal-1-wave-1", ["ready", "wave-in-progress"]),
      readyIssue(200, "goal-2-wave-1", ["ready", "wave-in-progress"]),
      readyIssue(300, "goal-3-wave-1", ["ready", "wave-in-progress"]),
    ],
    maxConcurrent: 8,
    milestoneIssues: {
      "goal-1-wave-1": [{ number: 10, title: "Feature A", labels: [] }],
      "goal-2-wave-1": [{ number: 20, title: "Feature B", labels: [] }],
      "goal-3-wave-1": [{ number: 30, title: "Feature C", labels: [] }],
    },
  });

  assert.equal(result.in_flight_count, 3, "3 waves in flight");
  assert.equal(result.selected_count, 0, "no new selections");
  assert.equal(result.slot_count, 0, "no new processes needed");
});

test("tick N: wave completes (marker closed), existing ready marker fills freed slot", () => {
  // Wave 1 completed → marker closed (not in readyIssues).
  // Wave 2 still running.
  // Wave 3 was never claimed (ready but no wave-in-progress).
  // Expected: 1 slot for wave 3 to be picked up.
  const result = simulateTick({
    milestones: [
      milestone("goal-1-wave-1"),
      milestone("goal-2-wave-1"),
      milestone("goal-3-wave-1"),
    ],
    readyIssues: [
      // wave 1 marker closed — absent from list
      readyIssue(200, "goal-2-wave-1", ["ready", "wave-in-progress"]),
      readyIssue(300, "goal-3-wave-1", ["ready"]), // never claimed
    ],
    maxConcurrent: 8,
    milestoneIssues: {
      "goal-2-wave-1": [{ number: 20, title: "Feature B", labels: [] }],
      "goal-3-wave-1": [{ number: 30, title: "Feature C", labels: [] }],
    },
  });

  assert.equal(result.in_flight_count, 1, "1 wave in flight");
  assert.equal(result.ready_count, 2, "2 open markers total");
  // The unclaimed ready marker (wave 3) should produce a slot
  assert.equal(result.slot_count, 1, "should spawn 1 process to claim the idle ready marker");
});

test("tick N: multiple waves complete, new milestone available → fills multiple slots", () => {
  // Started with 7 waves. 5 completed. 2 still running.
  // 1 new milestone is now unblocked and has no marker.
  // Expected: slot for new milestone + any unclaimed markers.
  const result = simulateTick({
    milestones: [
      milestone("goal-A-wave-1"), // in-flight
      milestone("goal-B-wave-1"), // in-flight
      milestone("goal-NEW-wave-1"), // no marker yet — should be selected
    ],
    readyIssues: [
      readyIssue(100, "goal-A-wave-1", ["ready", "wave-in-progress"]),
      readyIssue(200, "goal-B-wave-1", ["ready", "wave-in-progress"]),
    ],
    maxConcurrent: 8,
    milestoneIssues: {
      "goal-A-wave-1": [{ number: 10, title: "Feature A", labels: [] }],
      "goal-B-wave-1": [{ number: 20, title: "Feature B", labels: [] }],
      "goal-NEW-wave-1": [{ number: 30, title: "Feature NEW", labels: [] }],
    },
  });

  assert.equal(result.in_flight_count, 2, "2 waves still in flight");
  assert.equal(result.selected_count, 1, "1 new wave selected");
  assert.equal(result.slot_count, 1, "should spawn 1 process for new wave");
});

test("tick N: stale wave-in-progress labels block slot refill (reproduces the bug)", () => {
  // Reality: 2 waves actually running, 2 stale wave-in-progress labels.
  // 1 unclaimed ready marker exists.
  // Max concurrent = 8, so there should be plenty of room.
  //
  // The system should still produce a slot for the unclaimed marker.
  const result = simulateTick({
    milestones: [
      milestone("goal-A-wave-1"), // stale wave-in-progress (process dead)
      milestone("goal-B-wave-1"), // stale wave-in-progress (process dead)
      milestone("goal-C-wave-1"), // actively running
      milestone("goal-D-wave-1"), // actively running
      milestone("goal-E-wave-1"), // ready, never claimed
    ],
    readyIssues: [
      readyIssue(100, "goal-A-wave-1", ["ready", "wave-in-progress"]), // stale
      readyIssue(200, "goal-B-wave-1", ["ready", "wave-in-progress"]), // stale
      readyIssue(300, "goal-C-wave-1", ["ready", "wave-in-progress"]), // real
      readyIssue(400, "goal-D-wave-1", ["ready", "wave-in-progress"]), // real
      readyIssue(500, "goal-E-wave-1", ["ready"]), // unclaimed
    ],
    maxConcurrent: 8,
    milestoneIssues: {
      "goal-C-wave-1": [{ number: 30, title: "Feature C", labels: [] }],
      "goal-D-wave-1": [{ number: 40, title: "Feature D", labels: [] }],
      "goal-E-wave-1": [{ number: 50, title: "Feature E", labels: [] }],
    },
  });

  assert.equal(result.in_flight_count, 4, "4 markers have wave-in-progress (2 stale)");
  assert.equal(result.ready_count, 5, "5 total open markers");
  // Key assertion: despite 4 wave-in-progress, the unclaimed marker should get a slot
  assert.ok(result.slot_count >= 1, `should have at least 1 slot for unclaimed marker, got ${result.slot_count}`);
});

test("tick N: all waves complete, new ready milestones refill from scratch", () => {
  // All original waves completed (markers closed).
  // 3 new milestones are now ready with no markers.
  const result = simulateTick({
    milestones: [
      milestone("goal-X-wave-1"),
      milestone("goal-Y-wave-1"),
      milestone("goal-Z-wave-1"),
    ],
    readyIssues: [], // all old markers closed
    maxConcurrent: 8,
    milestoneIssues: {
      "goal-X-wave-1": [{ number: 10, title: "Feature X", labels: [] }],
      "goal-Y-wave-1": [{ number: 20, title: "Feature Y", labels: [] }],
      "goal-Z-wave-1": [{ number: 30, title: "Feature Z", labels: [] }],
    },
  });

  assert.equal(result.in_flight_count, 0, "nothing in flight");
  assert.equal(result.selected_count, 3, "3 new waves selected");
  assert.equal(result.slot_count, 3, "should spawn 3 processes");
});

test("slot count never exceeds max_concurrent_waves", () => {
  const result = simulateTick({
    milestones: Array.from({ length: 20 }, (_, i) => milestone(`goal-${i}-wave-1`)),
    readyIssues: [],
    maxConcurrent: 3,
    milestoneIssues: Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`goal-${i}-wave-1`, [{ number: i * 10, title: `F${i}`, labels: [] }]]),
    ),
  });

  assert.equal(result.slot_count, 3, "capped at max_concurrent_waves");
});

// ── PRODUCTION BUG: max_concurrent_waves unset on goal_count=0 path ────

test("BUG REPRO: maxConcurrent unset (empty string) blocks new wave selection when in-flight > 0", () => {
  // This reproduces the production bug: on the goal_count=0 tick path,
  // max_concurrent_waves is never set before decide_wave_dispatch.
  // The empty string falls through to maxConcurrent=1 via Number("")||1.
  // With any in-flight waves, slots = max(0, 1 - inFlight) = 0.
  // New milestones are NEVER selected.
  const result = simulateTickWithSplitConcurrency({
    milestones: [
      milestone("goal-A-wave-1"), // in-flight
      milestone("goal-B-wave-1"), // in-flight
      milestone("goal-NEW-wave-1"), // new, unblocked, should be selected
    ],
    readyIssues: [
      readyIssue(100, "goal-A-wave-1", ["ready", "wave-in-progress"]),
      readyIssue(200, "goal-B-wave-1", ["ready", "wave-in-progress"]),
    ],
    dispatchMaxConcurrent: "",  // ← BUG: unset in graph context
    slotsMaxConcurrent: 8,      // ← set correctly by set_max_concurrent_waves
    milestoneIssues: {
      "goal-NEW-wave-1": [{ number: 30, title: "Feature NEW", labels: [] }],
    },
  });

  // With the bug: selected_count=0 because maxConcurrent defaults to 1
  // and 1 - 2 (in_flight) = 0 available slots for selection.
  // Correct behavior: should select the new milestone.
  assert.equal(result.selected_count, 1, "new milestone should be selected despite in-flight waves");
  assert.equal(result.slot_count, 1, "should produce a slot for the new milestone");
});

test("BUG REPRO: 7 initial waves, new milestones appear but maxConcurrent='' blocks all refill", () => {
  // Exact production scenario:
  // - Tick 1: 7 milestones dispatched (maxConcurrent was set by goal_decompose_backpressure)
  // - Subsequent ticks: goal_count=0, max_concurrent_waves unset
  // - 5 waves complete (markers closed), 2 still in-flight
  // - 3 new milestones appear (goals completed, new waves unblocked)
  // - EXPECTED: 3 new milestones selected, 3 slots
  // - ACTUAL: 0 selected (maxConcurrent="" → 1, 1-2 = 0 slots for selection)
  const result = simulateTickWithSplitConcurrency({
    milestones: [
      milestone("goal-1-wave-1"), // in-flight
      milestone("goal-2-wave-1"), // in-flight
      milestone("goal-8-wave-1"), // new
      milestone("goal-9-wave-1"), // new
      milestone("goal-10-wave-1"), // new
    ],
    readyIssues: [
      readyIssue(100, "goal-1-wave-1", ["ready", "wave-in-progress"]),
      readyIssue(200, "goal-2-wave-1", ["ready", "wave-in-progress"]),
    ],
    dispatchMaxConcurrent: "",  // ← BUG
    slotsMaxConcurrent: 8,
    milestoneIssues: {
      "goal-8-wave-1": [{ number: 80, title: "Feature 8", labels: [] }],
      "goal-9-wave-1": [{ number: 90, title: "Feature 9", labels: [] }],
      "goal-10-wave-1": [{ number: 100, title: "Feature 10", labels: [] }],
    },
  });

  assert.equal(result.in_flight_count, 2, "2 waves still in flight");
  assert.equal(result.selected_count, 3, "all 3 new milestones should be selected");
  assert.equal(result.slot_count, 3, "3 slots for new milestones");
});

test("falsy maxConcurrent does not block selection (defensive fallback)", () => {
  // When maxConcurrent is falsy (unset graph variable → empty string, null, 0),
  // computeSelectedWaves must NOT silently cap to 1 and block selection.
  // Instead it falls back to uncapped (MAX_SAFE_INTEGER) — the real cap
  // is provided by enumerateWaveSlots which always receives the config value.
  //
  // Note: undefined is excluded because JS destructuring default (= 1) catches it
  // before the function body runs. The graph fix handles that case.
  for (const bad of ["", null, 0, "0"]) {
    const result = computeSelectedWaves({
      milestones: [milestone("w1")],
      readyIssues: [
        readyIssue(100, "w0", ["ready", "wave-in-progress"]), // 1 in-flight
      ],
      closedMarkers: [],
      prioritiesText: "",
      maxConcurrent: bad,
      getMilestoneOpenIssues: () => [{ number: 10, title: "Task", labels: [] }],
      getBlockedBy: noBlockedBy(),
      getControlPlaneBlocker: noControlPlaneBlocker(),
    });

    assert.equal(
      result.selected_count, 1,
      `maxConcurrent=${JSON.stringify(bad)}: should still select w1 (uncapped fallback)`,
    );
  }
});

// ── PRODUCTION BUG: markers created after last batch never fill open slots ──

test("BUG REPRO: markers created by tick N sit unclaimed; tick N+1 must still spawn workers for them", () => {
  // Production scenario (observed 2026-03-10):
  //
  // Tick N: dispatch-select selects 4 milestones, creates markers, spawns 4 workers.
  //         Workers crash before claiming (all 5 from tick ca414d10 failed with currentNode="").
  //
  // Tick N+1: those 4 markers still exist with `ready` label, NO `wave-in-progress`.
  //           dispatch-select sees them as `already_ready` (marker exists for each milestone).
  //           selected_count=0. But in_flight_count=0 (no wave-in-progress labels).
  //
  // Expected: enumerate-slots should still produce workers because:
  //   totalAvailable = ready_count + selected_count - in_flight_count
  //                  = 4 + 0 - 0 = 4
  //
  // The find-ready step in each worker will independently discover and claim a marker.

  const result = simulateTick({
    milestones: [
      milestone("goal-A-wave-2"),
      milestone("goal-B-wave-2"),
      milestone("goal-C-wave-3"),
      milestone("goal-D-wave-2"),
    ],
    readyIssues: [
      // All 4 markers exist from tick N's create_ready_markers, but workers crashed →
      // none have wave-in-progress. They are "ready" but unclaimed.
      readyIssue(1647, "goal-A-wave-2", ["ready"]),
      readyIssue(1648, "goal-B-wave-2", ["ready"]),
      readyIssue(1681, "goal-C-wave-3", ["ready"]),
      readyIssue(1682, "goal-D-wave-2", ["ready"]),
    ],
    maxConcurrent: 10,
    milestoneIssues: {
      "goal-A-wave-2": [{ number: 10, title: "Feature A", labels: [] }],
      "goal-B-wave-2": [{ number: 20, title: "Feature B", labels: [] }],
      "goal-C-wave-3": [{ number: 30, title: "Feature C", labels: [] }],
      "goal-D-wave-2": [{ number: 40, title: "Feature D", labels: [] }],
    },
  });

  // Dispatch-select correctly skips all 4 as already_ready (markers exist)
  assert.equal(result.selected_count, 0, "no new selections (all already_ready)");
  assert.equal(result.in_flight_count, 0, "no wave-in-progress labels (workers crashed)");
  assert.equal(result.ready_count, 4, "4 unclaimed markers");

  // THE KEY INVARIANT: even with selected=0, we MUST spawn workers for unclaimed markers
  assert.equal(result.slot_count, 4, "must spawn 4 workers to claim the 4 unclaimed markers");
});

test("BUG REPRO: 2 waves in-flight + 4 unclaimed markers → 4 workers for unclaimed", () => {
  // Production scenario: 2 waves actively executing (wave-in-progress applied),
  // 4 markers created by a recent tick but workers either crashed or haven't claimed yet.
  // max_concurrent=10, so 8 slots theoretically available.
  // But we should only spawn workers for the 4 UNCLAIMED markers, not 8.

  const result = simulateTick({
    milestones: [
      milestone("goal-1-wave-1"),
      milestone("goal-2-wave-1"),
      milestone("goal-3-wave-2"),
      milestone("goal-4-wave-2"),
      milestone("goal-5-wave-3"),
      milestone("goal-6-wave-2"),
    ],
    readyIssues: [
      readyIssue(100, "goal-1-wave-1", ["ready", "wave-in-progress"]),
      readyIssue(200, "goal-2-wave-1", ["ready", "wave-in-progress"]),
      readyIssue(300, "goal-3-wave-2", ["ready"]),  // unclaimed
      readyIssue(400, "goal-4-wave-2", ["ready"]),  // unclaimed
      readyIssue(500, "goal-5-wave-3", ["ready"]),  // unclaimed
      readyIssue(600, "goal-6-wave-2", ["ready"]),  // unclaimed
    ],
    maxConcurrent: 10,
    milestoneIssues: {
      "goal-3-wave-2": [{ number: 30, title: "F3", labels: [] }],
      "goal-4-wave-2": [{ number: 40, title: "F4", labels: [] }],
      "goal-5-wave-3": [{ number: 50, title: "F5", labels: [] }],
      "goal-6-wave-2": [{ number: 60, title: "F6", labels: [] }],
    },
  });

  assert.equal(result.in_flight_count, 2, "2 waves in-flight");
  assert.equal(result.ready_count, 6, "6 total markers");
  assert.equal(result.selected_count, 0, "all already_ready");
  // ready_count(6) + selected(0) - in_flight(2) = 4 workers needed
  assert.equal(result.slot_count, 4, "must spawn exactly 4 workers for unclaimed markers");
});

test("BUG REPRO: detached workers not yet labeled → in_flight=0 → duplicate workers spawned", () => {
  // This is the over-spawning variant: tick N spawns 4 workers, but they haven't
  // applied wave-in-progress yet. Tick N+1 (60s later) sees in_flight=0 and
  // spawns 4 MORE workers for the same markers. This wastes resources.
  //
  // In the current design this is EXPECTED behavior — the claim system handles
  // the race (only one worker wins each marker). But it documents the inefficiency
  // and proves the system is safe even when over-spawning.

  // Tick N spawned workers, markers created, but labels not yet applied
  const tick_n_plus_1 = simulateTick({
    milestones: [
      milestone("goal-A-wave-1"),
      milestone("goal-B-wave-1"),
      milestone("goal-C-wave-1"),
      milestone("goal-D-wave-1"),
    ],
    readyIssues: [
      // All 4 markers exist but no wave-in-progress (workers still starting)
      readyIssue(100, "goal-A-wave-1", ["ready"]),
      readyIssue(200, "goal-B-wave-1", ["ready"]),
      readyIssue(300, "goal-C-wave-1", ["ready"]),
      readyIssue(400, "goal-D-wave-1", ["ready"]),
    ],
    maxConcurrent: 10,
    milestoneIssues: {
      "goal-A-wave-1": [{ number: 10, title: "FA", labels: [] }],
      "goal-B-wave-1": [{ number: 20, title: "FB", labels: [] }],
      "goal-C-wave-1": [{ number: 30, title: "FC", labels: [] }],
      "goal-D-wave-1": [{ number: 40, title: "FD", labels: [] }],
    },
  });

  // in_flight=0 because wave-in-progress not applied yet → spawns workers for all 4
  assert.equal(tick_n_plus_1.in_flight_count, 0, "labels not applied yet");
  assert.equal(tick_n_plus_1.selected_count, 0, "all already_ready");
  assert.equal(tick_n_plus_1.slot_count, 4, "spawns duplicate workers (claim system handles race)");
});

test("BUG REPRO: completed wave (terminal_close marker) is re-dispatched when milestone stays open", () => {
  // Production bug: wave executes, merges, judge passes.
  // close_milestone fails silently (piped to /dev/null).
  // Milestone stays open. Next tick: dispatch sees open milestone, no open marker,
  // no terminal cooldown (wave_completed not checked) → re-dispatches.
  //
  // This test verifies that closedMarkers with wave_completed reason permanently
  // block re-dispatch, even when the milestone is still open.
  const result = computeSelectedWaves({
    milestones: [
      milestone("goal-1581-wave-2"), // merged but milestone stayed open
      milestone("goal-1565-wave-3"), // new, should be dispatched
    ],
    readyIssues: [], // wave-1581-wave-2 marker was closed after success
    closedMarkers: [
      { milestone: "goal-1581-wave-2", releaseReason: "wave_completed" },
    ],
    prioritiesText: "",
    maxConcurrent: 8,
    getMilestoneOpenIssues: (title) => {
      // goal-1581-wave-2 has open issues because close_merged_issues may have missed some
      if (title === "goal-1581-wave-2") return [{ number: 10, title: "Leftover issue", labels: [] }];
      if (title === "goal-1565-wave-3") return [{ number: 20, title: "Feature B", labels: [] }];
      return [];
    },
    getBlockedBy: noBlockedBy(),
    getControlPlaneBlocker: noControlPlaneBlocker(),
  });

  const eval1581 = result.evaluations.find((e) => e.milestone === "goal-1581-wave-2");
  assert.equal(eval1581.status, "skipped", "completed wave should be skipped");
  assert.equal(eval1581.skip_reason, "already_completed", "skip reason should be already_completed");
  assert.equal(result.selected_count, 1, "only the new milestone should be selected");
  assert.ok(result.selected_waves.includes("goal-1565-wave-3"), "new milestone should be dispatched");
  assert.ok(!result.selected_waves.includes("goal-1581-wave-2"), "completed milestone must NOT be re-dispatched");
});

test("ready_count + selected_count - in_flight_count identity holds across ticks", () => {
  // Tick 1: 0 ready, 3 selected, 0 in-flight → 3 slots
  const tick1 = simulateTick({
    milestones: [milestone("w1"), milestone("w2"), milestone("w3")],
    readyIssues: [],
    maxConcurrent: 8,
    milestoneIssues: {
      w1: [{ number: 1, title: "A", labels: [] }],
      w2: [{ number: 2, title: "B", labels: [] }],
      w3: [{ number: 3, title: "C", labels: [] }],
    },
  });
  assert.equal(tick1.slot_count, 3);

  // Tick 2: 3 ready (all in-progress), 0 selected, 3 in-flight → 0 slots
  const tick2 = simulateTick({
    milestones: [milestone("w1"), milestone("w2"), milestone("w3")],
    readyIssues: [
      readyIssue(100, "w1", ["ready", "wave-in-progress"]),
      readyIssue(200, "w2", ["ready", "wave-in-progress"]),
      readyIssue(300, "w3", ["ready", "wave-in-progress"]),
    ],
    maxConcurrent: 8,
    milestoneIssues: {},
  });
  assert.equal(tick2.slot_count, 0);

  // Tick 3: 1 completed (closed), 2 in-flight, new milestone ready → 1 slot for new
  const tick3 = simulateTick({
    milestones: [milestone("w2"), milestone("w3"), milestone("w4")],
    readyIssues: [
      readyIssue(200, "w2", ["ready", "wave-in-progress"]),
      readyIssue(300, "w3", ["ready", "wave-in-progress"]),
    ],
    maxConcurrent: 8,
    milestoneIssues: {
      w4: [{ number: 4, title: "D", labels: [] }],
    },
  });
  assert.equal(tick3.selected_count, 1, "w4 newly selected");
  assert.equal(tick3.in_flight_count, 2, "w2 and w3 in flight");
  assert.equal(tick3.slot_count, 1, "1 slot for newly selected w4");

  // Tick 4: w2 done, w3 done, w4 in-flight, w5+w6 milestones appear → 2 new slots
  const tick4 = simulateTick({
    milestones: [milestone("w4"), milestone("w5"), milestone("w6")],
    readyIssues: [
      readyIssue(400, "w4", ["ready", "wave-in-progress"]),
    ],
    maxConcurrent: 8,
    milestoneIssues: {
      w5: [{ number: 5, title: "E", labels: [] }],
      w6: [{ number: 6, title: "F", labels: [] }],
    },
  });
  assert.equal(tick4.selected_count, 2, "w5 and w6 newly selected");
  assert.equal(tick4.in_flight_count, 1, "w4 in flight");
  assert.equal(tick4.slot_count, 2, "2 slots for newly selected");
});
