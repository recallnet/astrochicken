import assert from "node:assert/strict";
import test from "node:test";

import { FactorySimulator, SimulatedRepo } from "./factory-simulation-helpers.ts";

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function setupRepo() {
  const repo = new SimulatedRepo();
  repo.createIssue({ title: "Goal: Wave chaos soak", labels: ["goal", "ready"] });
  for (let i = 1; i <= 3; i += 1) {
    const ms = `goal-999-wave-${i}`;
    repo.createIssue({ title: `Wave Ready: ${ms}`, labels: ["ready"], milestone: ms });
    for (let j = 1; j <= 3; j += 1) {
      repo.createIssue({ title: `Feature ${i}-${j}`, labels: ["feature"], milestone: ms });
    }
  }
  return repo;
}

test("chaos simulation: seeded wave execution never violates simulator invariants", () => {
  for (const seed of [7, 13, 29, 43, 101]) {
    const rand = mulberry32(seed);
    const repo = setupRepo();

    const waveOutcomes = {};
    for (const issue of repo.listIssues({ state: "open", label: "feature" })) {
      const r = rand();
      if (r < 0.15) waveOutcomes[issue.number] = "review_fail";
      else if (r < 0.25) waveOutcomes[issue.number] = "merge_fail";
      else waveOutcomes[issue.number] = "success";
    }

    const sim = new FactorySimulator(repo, {
      maxTicks: 12,
      maxConcurrentWaves: 2,
      maxIssuesPerWave: 3,
      waveOutcomes,
      quarantineThreshold: 2,
      cooldownHours: 1,
      tickAdvanceSec: 180,
      startMs: Date.parse("2026-03-01T00:00:00Z") + seed * 1000,
    });

    const result = sim.run();
    assert.deepEqual(result.violations, [], `seed=${seed} violations=${JSON.stringify(result.violations)}`);
  }
});
