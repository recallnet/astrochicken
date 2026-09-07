import assert from "node:assert/strict";
import test from "node:test";

import { collectActiveWaveMilestoneOwners, loadActiveWaveMilestoneOwners } from "../src/commands/wave-active-run-guard.ts";

test("collectActiveWaveMilestoneOwners counts active suspended parent and running child milestone ownership", () => {
  const nowMs = Date.parse("2026-03-11T02:25:00.000Z");
  const result = collectActiveWaveMilestoneOwners({
    nowEpochMs: nowMs,
    staleRunMinutes: 20,
    runStates: [
      {
        runId: "wave-parent",
        status: "suspended",
        pipelineFile: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
        updatedAt: "2026-03-11T02:24:17.202Z",
        context: {
          milestone_title: "goal-1677-wave-1",
          ready_issue_number: "1736",
        },
      },
      {
        runId: "wave-child",
        status: "running",
        pipelineFile: "factories/mothership/workflows/wave-execution/wave_issue_execute.workflow-source.mjs",
        updatedAt: "2026-03-11T02:24:03.227Z",
        context: {
          milestone_title: "goal-1677-wave-1",
          issue_number: "1734",
          worktree_dir: "/tmp/goal-1677-wave-1",
        },
      },
      {
        runId: "completed-wave",
        status: "completed",
        pipelineFile: "factories/mothership/workflows/wave-execution/wave_issue_execute.workflow-source.mjs",
        updatedAt: "2026-03-11T02:24:03.227Z",
        context: {
          milestone_title: "goal-1677-wave-1",
        },
      },
    ],
  });

  assert.deepEqual(result.active_milestones, ["goal-1677-wave-1"]);
  assert.equal(result.owner_count, 2);
  assert.deepEqual(result.owners.map((owner) => owner.run_id), ["wave-parent", "wave-child"]);
});

test("collectActiveWaveMilestoneOwners ignores stale wave owner runs past threshold", () => {
  const result = collectActiveWaveMilestoneOwners({
    nowEpochMs: Date.parse("2026-03-11T03:00:00.000Z"),
    staleRunMinutes: 20,
    runStates: [
      {
        runId: "stale-wave",
        status: "running",
        pipelineFile: "factories/mothership/workflows/wave-execution/wave_issue_execute.workflow-source.mjs",
        updatedAt: "2026-03-11T02:24:03.227Z",
        context: {
          milestone_title: "goal-1677-wave-1",
        },
      },
    ],
  });

  assert.deepEqual(result.active_milestones, []);
  assert.equal(result.owner_count, 0);
});

test("loadActiveWaveMilestoneOwners loads run-state snapshot through injected reader", () => {
  const out = loadActiveWaveMilestoneOwners({
    runsDir: "/tmp/factory-runs",
    nowEpochMs: Date.parse("2026-03-11T02:25:00.000Z"),
    staleRunMinutes: 20,
    readRunStates: ({ runsDir }) => {
      assert.equal(runsDir, "/tmp/factory-runs");
      return new Map([[
        "wave-parent",
        {
          runId: "wave-parent",
          status: "running",
          pipelineFile: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
          updatedAt: "2026-03-11T02:24:17.202Z",
          context: {
            milestone_title: "goal-1677-wave-1",
          },
        },
      ]]);
    },
  });

  assert.deepEqual(out.active_milestones, ["goal-1677-wave-1"]);
  assert.equal(out.owner_count, 1);
  assert.equal(out.owners[0].run_id, "wave-parent");
});
