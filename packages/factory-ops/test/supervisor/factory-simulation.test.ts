/**
 * Factory Simulation Test Suite
 *
 * Composes real pure functions from ops commands into a multi-tick factory
 * simulation with an in-memory GitHub mock. Verifies that ALL issue types
 * converge to terminal states with no dead ends or infinite loops.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { SimulatedRepo, FactorySimulator, buildMocks, seedGoalWithWave, assertTerminal, rng } from "./factory-simulation-helpers.ts";
import { evaluateGoalDecomposeBackpressure, limitKeptGoalsForTick } from "../../src/commands/goal-queue-ops.ts";

// ─── Group A: Happy paths ───────────────────────────────────────────────────

test("A1: single goal, single wave, all features approve", () => {
  const repo = new SimulatedRepo();
  const { featureNums } = seedGoalWithWave(repo, 1, 3);

  const sim = new FactorySimulator(repo, { maxTicks: 20 });
  const result = sim.run();
  assertTerminal(result, "A1");
  for (const n of featureNums) {
    assert.equal(repo.issues.get(n).state, "CLOSED");
  }
});

test("A2: two sequential waves (wave-2 blocked by wave-1)", () => {
  const repo = new SimulatedRepo();

  const goal = repo.createIssue({ title: "Goal: Test goal", labels: ["goal", "ready"] });
  const ms1 = `goal-${goal.number}-wave-1`;
  const ms2 = `goal-${goal.number}-wave-2`;

  const f1 = repo.createIssue({ title: "Feature: w1-a", labels: ["feature"], milestone: ms1 });
  const f2 = repo.createIssue({ title: "Feature: w1-b", labels: ["feature"], milestone: ms1 });
  const f3 = repo.createIssue({ title: "Feature: w2-a", labels: ["feature"], milestone: ms2 });
  const f4 = repo.createIssue({ title: "Feature: w2-b", labels: ["feature"], milestone: ms2 });

  repo.setBlockedBy(f3.number, [{ number: f1.number, state: "OPEN", milestone: { title: ms1 } }]);
  repo.setBlockedBy(f4.number, [{ number: f2.number, state: "OPEN", milestone: { title: ms1 } }]);

  const sim = new FactorySimulator(repo, { maxTicks: 30 });
  const result = sim.run();
  assertTerminal(result, "A2");
});

test("A3: two concurrent goals with maxConcurrent=2", () => {
  const repo = new SimulatedRepo();
  seedGoalWithWave(repo, 1, 2);
  seedGoalWithWave(repo, 1, 2);

  const sim = new FactorySimulator(repo, { maxTicks: 20, maxConcurrentWaves: 2 });
  const result = sim.run();
  assertTerminal(result, "A3");
});

// ─── Group B: Failure and quarantine ────────────────────────────────────────

test("B1: feature fails review once, then approves", () => {
  const repo = new SimulatedRepo();
  const { featureNums } = seedGoalWithWave(repo, 1, 2);

  const sim = new FactorySimulator(repo, {
    maxTicks: 30,
    waveOutcomes: { [featureNums[0]]: { verdict: "revise", approvesAfter: 1 } },
  });
  const result = sim.run();
  assertTerminal(result, "B1");
});

test("B2: feature fails 3x, quarantined, cooldown, retried, approves", () => {
  const repo = new SimulatedRepo();
  const { featureNums } = seedGoalWithWave(repo, 1, 1);

  const sim = new FactorySimulator(repo, {
    maxTicks: 40, tickAdvanceSec: 3600,
    waveOutcomes: { [featureNums[0]]: { verdict: "revise", approvesAfter: 3 } },
    quarantineThreshold: 3, cooldownHours: 2,
  });
  const result = sim.run();
  assertTerminal(result, "B2");
});

test("B3: all features quarantined, wave closes terminal, cooldown, re-dispatch", () => {
  const repo = new SimulatedRepo();
  const { featureNums } = seedGoalWithWave(repo, 1, 2);

  const sim = new FactorySimulator(repo, {
    maxTicks: 40, tickAdvanceSec: 3600,
    waveOutcomes: {
      [featureNums[0]]: { verdict: "revise", approvesAfter: 3 },
      [featureNums[1]]: { verdict: "revise", approvesAfter: 3 },
    },
    quarantineThreshold: 3, cooldownHours: 2,
  });
  const result = sim.run();
  assertTerminal(result, "B3");
});

// ─── Group C: Orphans and stragglers ────────────────────────────────────────

test("C1: issue with no labels gets closed by supervisor", () => {
  const repo = new SimulatedRepo();
  const unlabeled = repo.createIssue({ title: "Random human issue", labels: [] });
  seedGoalWithWave(repo, 1, 1);

  const sim = new FactorySimulator(repo, { maxTicks: 20 });
  const result = sim.run();
  assertTerminal(result, "C1");
  assert.equal(repo.issues.get(unlabeled.number).state, "CLOSED");
});

test("C2: feature with no milestone (orphan)", () => {
  const repo = new SimulatedRepo();
  seedGoalWithWave(repo, 1, 1);
  repo.createIssue({ title: "Feature: orphan", labels: ["feature"] });

  const sim = new FactorySimulator(repo, { maxTicks: 20 });
  const result = sim.run();
  assertTerminal(result, "C2");
});

test("C3: issue closed externally mid-wave", () => {
  const repo = new SimulatedRepo();
  const { featureNums } = seedGoalWithWave(repo, 1, 3);
  repo.closeIssue(featureNums[1]);

  const sim = new FactorySimulator(repo, { maxTicks: 20 });
  const result = sim.run();
  assertTerminal(result, "C3");
});

test("C4: circular blocked-by resolves — both features processable (triage handles ordering)", () => {
  // Wave execution ignores blocked-by relationships. Triage already ordered
  // features into waves, so circular dependencies within a wave are processable.
  const repo = new SimulatedRepo();
  const goal = repo.createIssue({ title: "Goal: cycle test", labels: ["goal", "ready"] });
  const ms = `goal-${goal.number}-wave-1`;

  const f1 = repo.createIssue({ title: "Feature: cycle-a", labels: ["feature"], milestone: ms });
  const f2 = repo.createIssue({ title: "Feature: cycle-b", labels: ["feature"], milestone: ms });

  repo.setBlockedBy(f1.number, [{ number: f2.number, state: "OPEN", milestone: { title: ms } }]);
  repo.setBlockedBy(f2.number, [{ number: f1.number, state: "OPEN", milestone: { title: ms } }]);

  const sim = new FactorySimulator(repo, { maxTicks: 15 });
  const result = sim.run();
  assertTerminal(result, "C4");
  assert.equal(repo.issues.get(f1.number).state, "CLOSED", "Circular blocked-by must not prevent wave execution");
  assert.equal(repo.issues.get(f2.number).state, "CLOSED", "Circular blocked-by must not prevent wave execution");
});

test("C5: wave marker closed externally, next dispatch creates new one", () => {
  const repo = new SimulatedRepo();
  const { milestoneTitle } = seedGoalWithWave(repo, 1, 2);

  const marker = repo.createIssue({ title: `Wave Ready: ${milestoneTitle}`, labels: ["ready"], milestone: milestoneTitle });
  repo.closeIssue(marker.number);

  const sim = new FactorySimulator(repo, { maxTicks: 20 });
  const result = sim.run();
  assertTerminal(result, "C5");
});

test("C6: stale merge follow-ups get auto-closed", () => {
  const repo = new SimulatedRepo();
  seedGoalWithWave(repo, 1, 1);

  const simStartMs = Date.parse("2026-03-01T00:00:00Z");
  const followup = repo.createIssue({ title: "Merge followup: stale", labels: ["merge-followup"] });
  followup.createdAt = new Date(simStartMs - 48 * 60 * 60 * 1000).toISOString();

  const sim = new FactorySimulator(repo, { maxTicks: 20 });
  const result = sim.run();
  assertTerminal(result, "C6");
  assert.equal(repo.issues.get(followup.number).state, "CLOSED");
});

// ─── Group D: Bug lifecycle ─────────────────────────────────────────────────

test("D1: bug in milestone, built, approved, merged, closed", () => {
  const repo = new SimulatedRepo();
  const goal = repo.createIssue({ title: "Goal: bug fix", labels: ["goal", "ready"] });
  const ms = `goal-${goal.number}-wave-1`;
  const bug = repo.createIssue({ title: "Bug: fix the thing", labels: ["bug"], milestone: ms });

  const sim = new FactorySimulator(repo, { maxTicks: 20 });
  const result = sim.run();
  assertTerminal(result, "D1");
  assert.equal(repo.issues.get(bug.number).state, "CLOSED");
});

// ─── Group E: Out-of-order ──────────────────────────────────────────────────

test("E1: goal closed externally before all waves done", () => {
  const repo = new SimulatedRepo();
  const { goalIssueNum, featureNums } = seedGoalWithWave(repo, 1, 2);
  repo.closeIssue(goalIssueNum);

  const sim = new FactorySimulator(repo, { maxTicks: 20 });
  const result = sim.run();
  assertTerminal(result, "E1");
  for (const n of featureNums) assert.equal(repo.issues.get(n).state, "CLOSED");
});

test("E2: terminal release cooldown blocks reopen within window", () => {
  const repo = new SimulatedRepo();
  const { milestoneTitle } = seedGoalWithWave(repo, 1, 1);

  const marker = repo.createIssue({ title: `Wave Ready: ${milestoneTitle}`, labels: [], milestone: milestoneTitle });
  repo.closeIssue(marker.number);
  const recentTime = new Date(Date.parse("2026-03-01T00:00:00Z") - 5 * 60 * 1000).toISOString();
  repo.addComment(marker.number, `WAVE_READY_LEASE_EVENT {"action":"release","reason":"judge_failed","at":"${recentTime}"}`, recentTime);

  const sim = new FactorySimulator(repo, { maxTicks: 30, tickAdvanceSec: 600 });
  const result = sim.run();
  assertTerminal(result, "E2");
});

test("E3: duplicate wave markers get repaired", () => {
  const repo = new SimulatedRepo();
  const { milestoneTitle } = seedGoalWithWave(repo, 1, 2);

  repo.createIssue({ title: `Wave Ready: ${milestoneTitle}`, labels: ["ready"], milestone: milestoneTitle });
  repo.createIssue({ title: `Wave Ready: ${milestoneTitle}`, labels: ["ready"], milestone: milestoneTitle });

  const sim = new FactorySimulator(repo, { maxTicks: 20 });
  const result = sim.run();
  assertTerminal(result, "E3");
});

// ─── Group G: Structural review failures (empty reviewer output) ────────────

test("G1: all features permanently fail review — quarantine stabilizes, no infinite loop", () => {
  const repo = new SimulatedRepo();
  const { featureNums } = seedGoalWithWave(repo, 1, 3);

  const outcomes = {};
  for (const n of featureNums) outcomes[n] = { verdict: "reject" };

  const sim = new FactorySimulator(repo, {
    maxTicks: 30, tickAdvanceSec: 3600, waveOutcomes: outcomes, quarantineThreshold: 3, cooldownHours: 2,
  });
  const result = sim.run();

  const loopViolations = result.violations.filter((v) => v.includes("Infinite loop"));
  assert.equal(loopViolations.length, 0, `Unexpected infinite loop: ${loopViolations}`);
  for (const n of featureNums) {
    assert.equal(repo.issues.get(n).state, "OPEN", `Feature ${n} should still be open`);
    assert.ok(repo.hasLabel(n, "quarantined"), `Feature ${n} should be quarantined`);
  }
});

test("G2: structural failure then fix — quarantine expires, features approve on retry", () => {
  const repo = new SimulatedRepo();
  const { featureNums } = seedGoalWithWave(repo, 1, 2);

  const outcomes = {};
  for (const n of featureNums) outcomes[n] = { verdict: "revise", approvesAfter: 4 };

  const sim = new FactorySimulator(repo, {
    maxTicks: 40, tickAdvanceSec: 3600, waveOutcomes: outcomes, quarantineThreshold: 3, cooldownHours: 2,
  });
  const result = sim.run();
  assertTerminal(result, "G2");
  for (const n of featureNums) assert.equal(repo.issues.get(n).state, "CLOSED");
});

test("G3: mixed — some features structurally fail, others succeed normally", () => {
  const repo = new SimulatedRepo();
  const { featureNums } = seedGoalWithWave(repo, 1, 4);

  const outcomes = {
    [featureNums[0]]: { verdict: "approve" },
    [featureNums[1]]: { verdict: "approve" },
    [featureNums[2]]: { verdict: "reject" },
    [featureNums[3]]: { verdict: "revise", approvesAfter: 4 },
  };

  const sim = new FactorySimulator(repo, {
    maxTicks: 40, tickAdvanceSec: 3600, waveOutcomes: outcomes, quarantineThreshold: 3, cooldownHours: 2,
  });
  const result = sim.run();

  assert.equal(repo.issues.get(featureNums[0]).state, "CLOSED");
  assert.equal(repo.issues.get(featureNums[1]).state, "CLOSED");
  assert.equal(repo.issues.get(featureNums[3]).state, "CLOSED");
  assert.equal(repo.issues.get(featureNums[2]).state, "OPEN");
  assert.ok(repo.hasLabel(featureNums[2], "quarantined"));
});

// ─── Group F: Stress (seeded PRNG) ──────────────────────────────────────────

test("F1: randomized factory converges to terminal state", () => {
  const iterations = Number(process.env.STRESS_ITERATIONS || "10");

  for (let seed = 1; seed <= iterations; seed++) {
    const random = rng(seed);
    const repo = new SimulatedRepo();

    const goalCount = 2 + Math.floor(random() * 4);
    const allFeatureNums = [];
    for (let g = 1; g <= goalCount; g++) {
      const waveCount = 1 + Math.floor(random() * 2);
      for (let w = 1; w <= waveCount; w++) {
        const featureCount = 1 + Math.floor(random() * 3);
        const { featureNums } = seedGoalWithWave(repo, w, featureCount);
        allFeatureNums.push(...featureNums);
      }
    }

    const outcomes = {};
    for (const num of allFeatureNums) {
      const r = random();
      if (r < 0.7) outcomes[num] = { verdict: "approve" };
      else if (r < 0.9) outcomes[num] = { verdict: "revise", approvesAfter: 1 + Math.floor(random() * 2) };
      else outcomes[num] = { verdict: "revise", approvesAfter: 3 };
    }

    if (random() < 0.3) repo.createIssue({ title: "Stray issue", labels: [] });
    if (random() < 0.3) repo.createIssue({ title: "Feature: orphan", labels: ["feature"] });
    if (random() < 0.2) {
      const f = repo.createIssue({ title: "Merge followup: test", labels: ["merge-followup"] });
      f.createdAt = new Date(Date.parse("2026-03-01T00:00:00Z") - 48 * 60 * 60 * 1000).toISOString();
    }

    const sim = new FactorySimulator(repo, {
      maxTicks: 60, tickAdvanceSec: 3600, waveOutcomes: outcomes,
      maxConcurrentWaves: 1 + Math.floor(random() * 2), quarantineThreshold: 3, cooldownHours: 2,
    });

    const result = sim.run();
    const loopViolations = result.violations.filter((v) => v.includes("Infinite loop"));
    assert.equal(loopViolations.length, 0, `[F1 seed=${seed}] Infinite loop: ${loopViolations}`);
    assert.equal(result.terminal, true, `[F1 seed=${seed}] Not terminal after ${result.tickCount} ticks. Open: ${JSON.stringify(result.openSummary)}`);
  }
});

// ─── Group H: Backpressure and WIP limits ────────────────────────────────

test("H1: max_goal_runs_per_tick=3 limits dispatch from 20-goal recovered backlog", () => {
  const repo = new SimulatedRepo();

  // Simulate a recovery burst: 20 open goal+ready issues (not yet dispatched).
  const goalNums = [];
  for (let i = 0; i < 20; i++) {
    const g = repo.createIssue({ title: `Goal: recovered goal ${i + 1}`, labels: ["goal", "ready"] });
    goalNums.push(g.number);
  }

  // Step 1: list_ready_goals — all 20 are ready.
  const readyGoals = repo.listIssues({ state: "open", label: "ready" })
    .filter((g) => g.labels.some((l) => l.name === "goal"));
  assert.equal(readyGoals.length, 20);

  // Step 2: limitKeptGoalsForTick with max=3.
  const limited = limitKeptGoalsForTick({
    keptGoalsRaw: JSON.stringify(readyGoals.map((g) => g.number)),
    maxGoalsPerTick: "3",
  });

  // Only 3 goals transition into dispatched/goal-run activity.
  assert.equal(limited.length, 3);
  assert.deepEqual(limited, goalNums.slice(0, 3));

  // The other 17 remain untouched and stay ready.
  for (const num of goalNums.slice(3)) {
    const issue = repo.issues.get(num);
    assert.ok(issue.labels.some((l) => l.name === "ready"), `Goal #${num} should still be ready`);
  }
});

test("H2: recovery-goal creation must not consume the same tick's decomposition budget", () => {
  const repo = new SimulatedRepo();
  const mocks = buildMocks(repo);

  // Pre-existing backlog: 5 ready goals from a previous tick.
  for (let i = 0; i < 5; i++) {
    repo.createIssue({ title: `Goal: existing backlog ${i + 1}`, labels: ["goal", "ready"] });
  }

  // Simulate recovery burst in the SAME tick: artifact_ingest + auto_ready_artifact_goals
  // creates 25 more goals labeled ready. These appear BEFORE list_ready_goals runs.
  for (let i = 0; i < 25; i++) {
    repo.createIssue({ title: `Goal: recovery goal ${i + 1}`, labels: ["goal", "ready"] });
  }

  // Now list_ready_goals runs — sees ALL 30 goals.
  const readyGoals = repo.listIssues({ state: "open", label: "ready" })
    .filter((g) => g.labels.some((l) => l.name === "goal"));
  assert.equal(readyGoals.length, 30);

  // Backpressure check: no wave markers or milestones exist, so decomposition is allowed.
  const backpressure = evaluateGoalDecomposeBackpressure({
    repo: "recallnet/astrochicken",
    maxConcurrentWaves: "3",
    ghJsonFn: mocks.ghJsonFn,
    listMilestonesFn: mocks.listMilestonesFn,
  });
  assert.equal(backpressure.decompose_allowed, "true");

  // limitKeptGoalsForTick enforces the budget: at most 3 decomposed per tick.
  const limited = limitKeptGoalsForTick({
    keptGoalsRaw: JSON.stringify(readyGoals.map((g) => g.number)),
    maxGoalsPerTick: "3",
  });

  assert.equal(limited.length, 3, "at most max_goal_runs_per_tick goals decomposed, even after recovery burst");
});

test("H3: repeated ticks converge wave markers — at most 1 open marker per milestone", () => {
  const repo = new SimulatedRepo();

  // Seed 5 dispatched goals with partial milestones (some features open, some closed).
  for (let i = 0; i < 5; i++) {
    const { milestoneTitle, featureNums } = seedGoalWithWave(repo, 1, 3);
    // Close 1 feature to make milestones partially done.
    repo.closeIssue(featureNums[0]);
  }

  const sim = new FactorySimulator(repo, { maxTicks: 5, maxConcurrentWaves: 2 });
  const markerCountsPerTick = [];

  for (let tick = 0; tick < 5; tick++) {
    sim.tick();

    // Count open Wave Ready markers per milestone after each tick.
    const markers = repo.listIssues({ state: "open" }).filter((i) => i.title.startsWith("Wave Ready:"));
    const byMilestone = new Map();
    for (const m of markers) {
      const ms = m.milestone?.title || m.title.replace("Wave Ready: ", "");
      byMilestone.set(ms, (byMilestone.get(ms) || 0) + 1);
    }

    for (const [ms, count] of byMilestone) {
      assert.ok(count <= 1, `Tick ${tick + 1}: milestone ${ms} has ${count} open Wave Ready markers (expected ≤1)`);
    }

    markerCountsPerTick.push(markers.length);
  }

  // Marker count must converge (not grow unboundedly).
  const maxMarkers = Math.max(...markerCountsPerTick);
  assert.ok(maxMarkers <= sim.maxConcurrentWaves, `Peak marker count ${maxMarkers} exceeds max_concurrent_waves ${sim.maxConcurrentWaves}`);
});

// ─── Group F: Stress (seeded PRNG) ──────────────────────────────────────────

test("F2: determinism - same seed produces same result", () => {
  function runSim(seed) {
    const random = rng(seed);
    const repo = new SimulatedRepo();
    const goalCount = 2 + Math.floor(random() * 3);
    const allFeatureNums = [];
    for (let g = 1; g <= goalCount; g++) {
      const { featureNums } = seedGoalWithWave(repo, 1, 1 + Math.floor(random() * 3));
      allFeatureNums.push(...featureNums);
    }
    const outcomes = {};
    for (const num of allFeatureNums) {
      outcomes[num] = random() < 0.8 ? { verdict: "approve" } : { verdict: "revise", approvesAfter: 1 };
    }
    return new FactorySimulator(repo, { maxTicks: 40, tickAdvanceSec: 600, waveOutcomes: outcomes }).run();
  }

  for (let seed = 1; seed <= 5; seed++) {
    const r1 = runSim(seed);
    const r2 = runSim(seed);
    assert.equal(r1.tickCount, r2.tickCount, `[F2 seed=${seed}] tick count mismatch`);
    assert.equal(r1.terminal, r2.terminal, `[F2 seed=${seed}] terminal mismatch`);
  }
});
