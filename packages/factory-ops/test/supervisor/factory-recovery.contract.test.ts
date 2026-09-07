/**
 * Factory Recovery Test Suite
 *
 * Tests crash recovery and resume paths for the wave execution pipeline.
 * Covers: mid-tick crashes, control-plane blocker recovery, concurrent
 * recovery + dispatch, and failure modes that require supervisor healing.
 *
 * Depends on the same SimulatedRepo + FactorySimulator framework as
 * factory-simulation.test.mjs but exercises crash/recovery primitives
 * (crashAtPhase, partialWaveExecute) added to the helpers.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { SimulatedRepo, FactorySimulator, seedGoalWithWave, assertTerminal } from "./factory-simulation-helpers.ts";

// ─── Group R: Crash & Resume (happy paths) ──────────────────────────────────

test("R1: crash mid-wave after 1 feature, resume completes remaining features", () => {
  const repo = new SimulatedRepo();
  const { featureNums } = seedGoalWithWave(repo, 1, 3);

  const sim = new FactorySimulator(repo, { maxTicks: 20 });

  // Tick phases up through waveDispatch (creates marker), then do a partial wave execute
  sim.crashAtPhase("waveExecute");
  // Now manually run partial wave: process 1 feature, then "crash"
  sim.partialWaveExecute(1);

  // State after crash: 1 feature closed, 2 still open, marker has wave-in-progress
  const closedFeatures = featureNums.filter((n) => repo.issues.get(n).state === "CLOSED");
  assert.equal(closedFeatures.length, 1, "Exactly 1 feature should be closed after partial execute");

  const markers = repo.listIssues({ state: "open" }).filter((i) => i.title.startsWith("Wave Ready:"));
  assert.ok(markers.length > 0, "Wave marker should still be open");
  assert.ok(repo.hasLabel(markers[0].number, "wave-in-progress"), "Marker should have wave-in-progress label");

  // Recovery: run normal ticks — orphan repair should clean up, re-dispatch, complete remaining
  const result = sim.run();
  assertTerminal(result, "R1");
  for (const n of featureNums) {
    assert.equal(repo.issues.get(n).state, "CLOSED", `Feature #${n} should be closed`);
  }
});

test("R2: crash between ticks (clean state), resumes normally", () => {
  const repo = new SimulatedRepo();
  const { featureNums } = seedGoalWithWave(repo, 1, 2);

  const sim = new FactorySimulator(repo, { maxTicks: 20 });

  // Run 1 full tick — should complete wave execution
  sim.tick();

  // "Crash" between ticks — state is clean (marker closed, features closed)
  // Resume with remaining ticks
  const result = sim.run();
  assertTerminal(result, "R2");
  for (const n of featureNums) {
    assert.equal(repo.issues.get(n).state, "CLOSED");
  }
});

test("R3: crash after dispatch but before wave execute, recovery completes wave", () => {
  const repo = new SimulatedRepo();
  const { featureNums } = seedGoalWithWave(repo, 1, 2);

  const sim = new FactorySimulator(repo, { maxTicks: 20 });

  // Crash right before waveExecute — dispatch ran (marker created + ready), but no features processed
  sim.crashAtPhase("waveExecute");

  // Verify marker exists but no features closed yet
  const markers = repo.listIssues({ state: "open" }).filter((i) => i.title.startsWith("Wave Ready:"));
  assert.ok(markers.length > 0, "Marker should exist from dispatch");
  for (const n of featureNums) {
    assert.equal(repo.issues.get(n).state, "OPEN", `Feature #${n} should still be open`);
  }

  // Recovery ticks should complete everything
  const result = sim.run();
  assertTerminal(result, "R3");
  for (const n of featureNums) {
    assert.equal(repo.issues.get(n).state, "CLOSED");
  }
});

// ─── Group S: Wave execution ignores control-plane blockers ──────────────────
// Triage orders features into waves. Once a wave is executing, every feature
// in it is processable — control-plane blockers must NOT prevent wave completion.

test("S1: empty-blockerRef control-plane blocker does NOT block during wave execution", () => {
  const repo = new SimulatedRepo();
  const { featureNums } = seedGoalWithWave(repo, 1, 3);

  // Simulate provider error leaving a permanent blocker on feature #2
  repo.addControlPlaneBlocker(featureNums[1], {
    status: "blocked",
    kind: "upstream_bug",
    blockerRef: "",
  });

  const sim = new FactorySimulator(repo, { maxTicks: 20 });

  // All features should process — blocker ignored during wave execution
  const result = sim.run();
  assertTerminal(result, "S1");
  for (const n of featureNums) {
    assert.equal(repo.issues.get(n).state, "CLOSED", `Feature #${n} should be closed despite blocker`);
  }
});

test("S2: control-plane blocker with valid blockerRef + blocked-by does NOT block during wave execution", () => {
  const repo = new SimulatedRepo();
  const { featureNums } = seedGoalWithWave(repo, 1, 2);

  // Feature #2 has both a control-plane blocker and a blocked-by relationship
  // (blocked-by references an issue not in this milestone — cross-wave dependency)
  repo.setBlockedBy(featureNums[1], [{ number: 9999, state: "OPEN", milestone: { title: "other-wave" } }]);
  repo.addControlPlaneBlocker(featureNums[1], {
    status: "blocked",
    kind: "upstream_bug",
    blockerRef: "#9999",
  });

  const sim = new FactorySimulator(repo, { maxTicks: 20 });

  // Both features should process — blockers ignored during wave execution
  const result = sim.run();
  assertTerminal(result, "S2");
  for (const n of featureNums) {
    assert.equal(repo.issues.get(n).state, "CLOSED", `Feature #${n} should be closed despite blocker`);
  }
});

test("S3: all features have control-plane blockers — all process during wave execution", () => {
  const repo = new SimulatedRepo();
  const { featureNums } = seedGoalWithWave(repo, 1, 2);

  // Both features blocked with empty blockerRef
  for (const n of featureNums) {
    repo.addControlPlaneBlocker(n, { status: "blocked", kind: "upstream_bug", blockerRef: "" });
  }

  const sim = new FactorySimulator(repo, { maxTicks: 20 });

  // All features should process — blockers ignored during wave execution
  const result = sim.run();
  assertTerminal(result, "S3");
  for (const n of featureNums) {
    assert.equal(repo.issues.get(n).state, "CLOSED", `Feature #${n} should be closed despite blocker`);
  }
});

// ─── Group T: Concurrent recovery + new dispatch ─────────────────────────────

test("T1: stale wave-in-progress from crash + new goal dispatches in same recovery tick", () => {
  const repo = new SimulatedRepo();

  // Goal A: has a stale wave marker with wave-in-progress (simulating crashed tick)
  const goalA = seedGoalWithWave(repo, 1, 2);
  const markerA = repo.createIssue({
    title: `Wave Ready: ${goalA.milestoneTitle}`,
    labels: ["ready", "wave-in-progress"],
    milestone: goalA.milestoneTitle,
  });

  // Goal B: fresh goal, no marker yet
  const goalB = seedGoalWithWave(repo, 1, 2);

  const sim = new FactorySimulator(repo, { maxTicks: 20, maxConcurrentWaves: 2 });

  // Recovery tick: should repair Goal A's orphan state and dispatch Goal B
  const result = sim.run();
  assertTerminal(result, "T1");

  for (const n of goalA.featureNums) {
    assert.equal(repo.issues.get(n).state, "CLOSED", `Goal A feature #${n} should be closed`);
  }
  for (const n of goalB.featureNums) {
    assert.equal(repo.issues.get(n).state, "CLOSED", `Goal B feature #${n} should be closed`);
  }
});

test("T2: max_concurrent_waves respected during recovery with 3 goals", () => {
  const repo = new SimulatedRepo();

  const goalA = seedGoalWithWave(repo, 1, 1);
  const goalB = seedGoalWithWave(repo, 1, 1);
  const goalC = seedGoalWithWave(repo, 1, 1);

  // Goal A has a stale wave-in-progress marker
  repo.createIssue({
    title: `Wave Ready: ${goalA.milestoneTitle}`,
    labels: ["ready", "wave-in-progress"],
    milestone: goalA.milestoneTitle,
  });

  const sim = new FactorySimulator(repo, { maxTicks: 20, maxConcurrentWaves: 2 });

  // Track max concurrent markers per tick
  let maxConcurrent = 0;
  const origTick = sim.tick.bind(sim);
  sim.tick = function () {
    origTick();
    const openMarkers = repo.listIssues({ state: "open" }).filter((i) => i.title.startsWith("Wave Ready:"));
    if (openMarkers.length > maxConcurrent) maxConcurrent = openMarkers.length;
  };

  const result = sim.run();
  assertTerminal(result, "T2");
  assert.ok(maxConcurrent <= 2, `Max concurrent wave markers was ${maxConcurrent}, expected <= 2`);

  for (const n of [...goalA.featureNums, ...goalB.featureNums, ...goalC.featureNums]) {
    assert.equal(repo.issues.get(n).state, "CLOSED");
  }
});

test("T3: 2 waves fully complete (merged), crash before 3rd wave executes, recovery completes without re-processing", () => {
  const repo = new SimulatedRepo();

  // 3 goals, each with 1 wave and 2 features
  const goalA = seedGoalWithWave(repo, 1, 2);
  const goalB = seedGoalWithWave(repo, 1, 2);
  const goalC = seedGoalWithWave(repo, 1, 2);

  // maxConcurrentWaves=2 → tick 1 dispatches only A+B; C waits
  const sim = new FactorySimulator(repo, { maxTicks: 20, maxConcurrentWaves: 2 });

  // Tick 1: dispatch + execute waves A and B → fully complete
  sim.tick();

  // Goals A+B features should be CLOSED (merged)
  for (const n of goalA.featureNums) {
    assert.equal(repo.issues.get(n).state, "CLOSED", `Goal A feature #${n} should be closed after tick 1`);
  }
  for (const n of goalB.featureNums) {
    assert.equal(repo.issues.get(n).state, "CLOSED", `Goal B feature #${n} should be closed after tick 1`);
  }
  // Goal C features still open (wave not dispatched yet)
  for (const n of goalC.featureNums) {
    assert.equal(repo.issues.get(n).state, "OPEN", `Goal C feature #${n} should still be open`);
  }

  // Tick 2: crash BEFORE waveExecute — dispatch runs (creates wave C marker) but execute never fires
  sim.crashAtPhase("waveExecute");

  // Goal C features still open
  for (const n of goalC.featureNums) {
    assert.equal(repo.issues.get(n).state, "OPEN", `Goal C feature #${n} still open after crash`);
  }
  // Goals A+B features remain CLOSED — not re-opened or re-processed
  for (const n of [...goalA.featureNums, ...goalB.featureNums]) {
    assert.equal(repo.issues.get(n).state, "CLOSED", `Feature #${n} from completed goal should remain closed`);
  }

  // Recovery: run remaining ticks
  const result = sim.run();
  assertTerminal(result, "T3");
  for (const n of [...goalA.featureNums, ...goalB.featureNums, ...goalC.featureNums]) {
    assert.equal(repo.issues.get(n).state, "CLOSED", `Feature #${n} should be closed`);
  }
});

test("T4: 2 waves fully complete, crash mid-3rd wave after partial feature processing, recovery finishes remaining", () => {
  const repo = new SimulatedRepo();

  const goalA = seedGoalWithWave(repo, 1, 2);
  const goalB = seedGoalWithWave(repo, 1, 2);
  const goalC = seedGoalWithWave(repo, 1, 3);  // 3 features — crash after processing 1

  const sim = new FactorySimulator(repo, { maxTicks: 20, maxConcurrentWaves: 2 });

  // Tick 1: goals A+B fully complete
  sim.tick();
  for (const n of [...goalA.featureNums, ...goalB.featureNums]) {
    assert.equal(repo.issues.get(n).state, "CLOSED", `Feature #${n} should be closed after tick 1`);
  }

  // Tick 2: run phases through waveDispatch (creates goal C's marker), then partial execute + crash
  sim.crashAtPhase("waveExecute");
  sim.partialWaveExecute(1);  // process 1 of 3 features, leave wave-in-progress

  // 1 of goal C's features should be closed, 2 still open
  const closedC = goalC.featureNums.filter((n) => repo.issues.get(n).state === "CLOSED");
  const openC = goalC.featureNums.filter((n) => repo.issues.get(n).state === "OPEN");
  assert.equal(closedC.length, 1, "Exactly 1 of goal C's features should be closed after partial execute");
  assert.equal(openC.length, 2, "2 of goal C's features should still be open");

  // Wave marker should have wave-in-progress (from partial execute crash)
  const markers = repo.listIssues({ state: "open" }).filter((i) => i.title.startsWith("Wave Ready:") && i.milestone?.title === goalC.milestoneTitle);
  assert.ok(markers.length > 0, "Goal C wave marker should still be open");
  assert.ok(repo.hasLabel(markers[0].number, "wave-in-progress"), "Marker should have wave-in-progress label");

  // Goals A+B features still closed
  for (const n of [...goalA.featureNums, ...goalB.featureNums]) {
    assert.equal(repo.issues.get(n).state, "CLOSED", `Completed feature #${n} should remain closed`);
  }

  // Recovery: run remaining ticks
  const result = sim.run();
  assertTerminal(result, "T4");
  for (const n of [...goalA.featureNums, ...goalB.featureNums, ...goalC.featureNums]) {
    assert.equal(repo.issues.get(n).state, "CLOSED", `Feature #${n} should be closed after recovery`);
  }
});

test("T5: production scenario — crash mid-wave with control-plane blocker, recovery processes all features", () => {
  // Mirrors production incident on goal-1523: wave-3 crashes after processing
  // 1 of 2 features. Feature B has a control-plane blocker, but since wave
  // execution ignores blockers, recovery should process it normally.
  const repo = new SimulatedRepo();

  const goal = seedGoalWithWave(repo, 1, 2);

  // Feature B has an active control-plane blocker (the production case)
  repo.addControlPlaneBlocker(goal.featureNums[1], {
    status: "blocked",
    kind: "upstream_bug",
    blockerRef: "",
  });

  const sim = new FactorySimulator(repo, { maxTicks: 20 });

  // Crash mid-wave after processing 1 feature
  sim.crashAtPhase("waveExecute");
  sim.partialWaveExecute(1);

  // Feature A closed, Feature B still open (crash happened before processing it)
  assert.equal(repo.issues.get(goal.featureNums[0]).state, "CLOSED", "Feature A processed before crash");
  assert.equal(repo.issues.get(goal.featureNums[1]).state, "OPEN", "Feature B not yet processed");

  // Recovery should complete everything — blocker ignored during execution
  const result = sim.run();
  assertTerminal(result, "T5");
  for (const n of goal.featureNums) {
    assert.equal(repo.issues.get(n).state, "CLOSED", `Feature #${n} should be closed`);
  }
});

test("T6: feature with active control-plane blocker in wave still gets processed (triage already ordered)", () => {
  // This is the core design assertion: control-plane blockers are a triage/dispatch concern,
  // not an execution concern. Once a wave is executing, every feature in it is processable.
  const repo = new SimulatedRepo();

  const goal = seedGoalWithWave(repo, 1, 3);

  // Feature #2 has an ACTIVE control-plane blocker (never resumed) AND cross-wave blocked-by
  repo.addControlPlaneBlocker(goal.featureNums[1], {
    status: "blocked",
    kind: "upstream_bug",
    blockerRef: "",
  });

  const sim = new FactorySimulator(repo, { maxTicks: 20 });
  const result = sim.run();
  assertTerminal(result, "T6");

  // ALL features should be closed — the blocker must not prevent wave execution
  for (const n of goal.featureNums) {
    assert.equal(repo.issues.get(n).state, "CLOSED", `Feature #${n} should be closed despite blocker`);
  }
});

// ─── Group U: Supervisor healing prompts (no clean automated fix) ────────────

test("U1: former production incident — empty-blockerRef blockers no longer prevent wave completion", () => {
  // Production incident 2026-03-10: Provider errors left control-plane blockers with
  // empty blockerRef and status=blocked. Previously these features could never unblock.
  // Design fix: wave execution ignores ALL blockers. Blocking is a dispatch/triage
  // concern, not an execution concern. Features with active blockers now process normally.
  const repo = new SimulatedRepo();
  const { featureNums } = seedGoalWithWave(repo, 1, 2);

  for (const n of featureNums) {
    repo.addControlPlaneBlocker(n, { status: "blocked", kind: "upstream_bug", blockerRef: "" });
  }

  const sim = new FactorySimulator(repo, { maxTicks: 10 });
  const result = sim.run();
  assertTerminal(result, "U1");

  // Both features should be closed — blockers ignored during wave execution
  for (const n of featureNums) {
    assert.equal(repo.issues.get(n).state, "CLOSED", `Feature #${n} should be CLOSED (blockers ignored during execution)`);
  }
});

test("U2: repeated review failures — quarantine cycle stabilizes but never completes", () => {
  const repo = new SimulatedRepo();
  const { featureNums } = seedGoalWithWave(repo, 1, 1);

  // Feature permanently rejects — never approves
  const sim = new FactorySimulator(repo, {
    maxTicks: 30,
    tickAdvanceSec: 3600,
    waveOutcomes: { [featureNums[0]]: { verdict: "reject" } },
    quarantineThreshold: 3,
    cooldownHours: 2,
  });
  const result = sim.run();

  // No infinite loop — bounded retries + quarantine cooldown prevents it
  const loopViolations = result.violations.filter((v) => v.includes("Infinite loop"));
  assert.equal(loopViolations.length, 0, "Quarantine cooldown should prevent infinite loop");

  // Feature should be open and quarantined in steady state — supervisor must intervene
  assert.equal(repo.issues.get(featureNums[0]).state, "OPEN", "Feature should still be OPEN");
  assert.ok(repo.hasLabel(featureNums[0], "quarantined"), "Feature should be quarantined");
});

test("U3: wave marker closed externally with features still open — orphan recovery re-dispatches", () => {
  const repo = new SimulatedRepo();
  const { featureNums, milestoneTitle } = seedGoalWithWave(repo, 1, 3);

  // Create and then close the wave marker manually (simulating external interference)
  const marker = repo.createIssue({
    title: `Wave Ready: ${milestoneTitle}`,
    labels: ["ready"],
    milestone: milestoneTitle,
  });
  repo.closeIssue(marker.number);
  repo.removeLabel(marker.number, "ready");

  // Features still open, no active wave marker
  for (const n of featureNums) {
    assert.equal(repo.issues.get(n).state, "OPEN");
  }

  const sim = new FactorySimulator(repo, { maxTicks: 20 });
  const result = sim.run();
  assertTerminal(result, "U3");
  for (const n of featureNums) {
    assert.equal(repo.issues.get(n).state, "CLOSED", `Feature #${n} should be closed after orphan recovery`);
  }
});

test("U4: repeated crashes before sanitize-state repair do not prevent clean restart", () => {
  const repo = new SimulatedRepo();
  const goalA = seedGoalWithWave(repo, 1, 2);
  const goalB = seedGoalWithWave(repo, 1, 2);

  repo.createIssue({
    title: `Wave Ready: ${goalA.milestoneTitle}`,
    labels: ["ready", "wave-in-progress"],
    milestone: goalA.milestoneTitle,
  });
  repo.createIssue({
    title: `Wave Ready: ${goalB.milestoneTitle}`,
    labels: ["wave-in-progress"],
    milestone: goalB.milestoneTitle,
  });

  const sim = new FactorySimulator(repo, { maxTicks: 20, maxConcurrentWaves: 2 });

  sim.crashAtPhase("repairWaveOrphanState");
  sim.crashAtPhase("repairWaveOrphanState");
  sim.crashAtPhase("repairWaveOrphanState");

  const preRecoveryMarkers = repo.listIssues({ state: "open" }).filter((issue) => issue.title.startsWith("Wave Ready:"));
  assert.equal(preRecoveryMarkers.length, 2, "repeated sanitize crashes must not create extra markers");

  const result = sim.run();
  assertTerminal(result, "U4");

  for (const n of [...goalA.featureNums, ...goalB.featureNums]) {
    assert.equal(repo.issues.get(n).state, "CLOSED", `Feature #${n} should be closed after restart recovery`);
  }
});

test("U5: half-assigned wave fixture restarts into canonical parallel ready waves", () => {
  const repo = new SimulatedRepo();
  const goalA = seedGoalWithWave(repo, 1, 1);
  const goalB = seedGoalWithWave(repo, 1, 1);
  const goalC = seedGoalWithWave(repo, 1, 1);

  repo.createIssue({
    title: `Wave Ready: ${goalA.milestoneTitle}`,
    labels: ["ready", "wave-in-progress"],
    milestone: goalA.milestoneTitle,
  });
  repo.createIssue({
    title: `Wave Ready: ${goalA.milestoneTitle}`,
    labels: [],
    milestone: goalA.milestoneTitle,
  });
  repo.createIssue({
    title: `Wave Ready: ${goalB.milestoneTitle}`,
    labels: ["wave-in-progress"],
    milestone: goalB.milestoneTitle,
  });

  const sim = new FactorySimulator(repo, { maxTicks: 20, maxConcurrentWaves: 3 });

  sim.crashAtPhase("repairWaveOrphanState");
  sim.crashAtPhase("repairWaveOrphanState");

  sim.crashAtPhase("waveExecute");

  const openMarkers = repo.listIssues({ state: "open" }).filter((issue) => issue.title.startsWith("Wave Ready:"));
  assert.equal(openMarkers.length, 3, `expected canonicalized current wave plus 2 new ready waves, got ${JSON.stringify(openMarkers, null, 2)}`);

  const milestoneCounts = new Map();
  for (const marker of openMarkers) {
    const milestone = marker.milestone?.title || "";
    milestoneCounts.set(milestone, (milestoneCounts.get(milestone) || 0) + 1);
    assert.ok(repo.hasLabel(marker.number, "ready"), `marker ${marker.number} should have ready after restart`);
    assert.equal(repo.hasLabel(marker.number, "wave-in-progress"), false, `marker ${marker.number} should not retain stale wave-in-progress before execute`);
  }

  for (const count of milestoneCounts.values()) {
    assert.equal(count, 1, "restart must leave at most one open marker per milestone");
  }
  assert.equal(milestoneCounts.get(goalA.milestoneTitle), 1, "current partially-assigned wave should be canonicalized");
  assert.equal(milestoneCounts.get(goalB.milestoneTitle), 1, "restart should create the first new ready wave");
  assert.equal(milestoneCounts.get(goalC.milestoneTitle), 1, "restart should create the second new ready wave in parallel");

  const result = sim.run();
  assertTerminal(result, "U5");
  for (const n of [...goalA.featureNums, ...goalB.featureNums, ...goalC.featureNums]) {
    assert.equal(repo.issues.get(n).state, "CLOSED", `Feature #${n} should be closed after canonical restart`);
  }
});
