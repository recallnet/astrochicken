import test from "node:test";
import assert from "node:assert/strict";
import { collectActiveWaveLeases, planWaveOrphanStateRepair } from "../src/commands/wave-sanitize-state.ts";

function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x = (1664525 * x + 1013904223) >>> 0;
    return x / 0x100000000;
  };
}

function shuffle(items, random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

test("distributed host-simulated lease reconciliation stays deterministic under input permutations", () => {
  const nowEpochMs = Date.parse("2026-01-01T00:30:00.000Z");

  for (let seed = 1; seed <= 20; seed += 1) {
    const random = rng(seed);
    const openIssues = [];
    const runStates = [];

    for (let wave = 1; wave <= 15; wave += 1) {
      const milestone = `goal-${seed}-wave-${wave}`;
      const number = seed * 1000 + wave;
      openIssues.push({
        number,
        title: `Wave Ready: ${milestone}`,
        milestone: { title: milestone },
        state: "OPEN",
        labels: [{ name: "ready" }, { name: "wave-in-progress" }],
      });

      const hasLease = random() > 0.45;
      if (!hasLease) continue;

      const host = random() > 0.5 ? "host-a" : "host-b";
      const stale = random() > 0.8;
      const updatedAt = stale
        ? "2025-12-31T20:00:00.000Z"
        : "2026-01-01T00:25:00.000Z";

      runStates.push({
        runId: `${host}-${seed}-${wave}`,
        status: "running",
        pipelineFile: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
        updatedAt,
        context: { milestone_title: milestone, worktree_dir: `/tmp/${host}/${milestone}` },
      });
    }

    const leases = collectActiveWaveLeases(runStates, { nowEpochMs, staleRunMinutes: 20 });
    const expected = planWaveOrphanStateRepair({ openIssues, activeLeases: leases });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const shuffledIssues = shuffle(openIssues, random);
      const shuffledRuns = shuffle(runStates, random);
      const permutedLeases = collectActiveWaveLeases(shuffledRuns, { nowEpochMs, staleRunMinutes: 20 });
      const got = planWaveOrphanStateRepair({ openIssues: shuffledIssues, activeLeases: permutedLeases });
      assert.deepEqual(got, expected);
    }

    const activeMilestones = new Set(leases.active_milestones);
    const releases = expected.actions
      .filter((a) => a.type === "remove_label" && a.label === "wave-in-progress")
      .map((a) => a.milestone_title);

    for (const milestone of activeMilestones) {
      assert.equal(releases.includes(milestone), false);
    }
  }
});
