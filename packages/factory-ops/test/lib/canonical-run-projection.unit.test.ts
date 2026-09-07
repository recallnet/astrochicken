import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { projectRunsFromCanonicalRows } from "../../src/lib/canonical-run-projection.ts";

test("projectRunsFromCanonicalRows excludes running ghost rows without readable local state", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "canonical-run-projection-ghost-"));

  const healthyRunDir = join(runsDir, "healthy-running");
  mkdirSync(healthyRunDir, { recursive: true });
  writeFileSync(join(healthyRunDir, "state.json"), JSON.stringify({
    runId: "healthy-running",
    status: "running",
    currentNode: "build",
    pipelineFile: "factories/example-trading/graphs/goal_run.dot",
    startedAt: "2026-03-25T19:55:00.000Z",
    updatedAt: "2026-03-25T19:59:00.000Z",
    context: {
      issue_number: "1541",
      milestone_title: "goal-1463-wave-1",
    },
  }, null, 2));

  const { runs } = projectRunsFromCanonicalRows([
    {
      event_family: "hatch.run.started",
      run_id: "ghost-running",
      emitted_at: "2026-03-25T19:58:00.000Z",
      payload: { run_id: "ghost-running", graph: "goal_run", node: "review", issue: "1536", milestone: "goal-1462-wave-1" },
    },
    {
      event_family: "hatch.run.node_entered",
      run_id: "ghost-running",
      emitted_at: "2026-03-25T19:59:00.000Z",
      payload: { run_id: "ghost-running", graph: "goal_run", node: "review", issue: "1536", milestone: "goal-1462-wave-1" },
    },
    {
      event_family: "hatch.run.started",
      run_id: "healthy-running",
      emitted_at: "2026-03-25T19:55:00.000Z",
      payload: { run_id: "healthy-running", graph: "goal_run", node: "build", issue: "1541", milestone: "goal-1463-wave-1" },
    },
    {
      event_family: "hatch.run.node_entered",
      run_id: "healthy-running",
      emitted_at: "2026-03-25T19:59:00.000Z",
      payload: { run_id: "healthy-running", graph: "goal_run", node: "build", issue: "1541", milestone: "goal-1463-wave-1" },
    },
  ], runsDir);

  assert.equal(runs.some((entry) => entry.run_id === "ghost-running"), false);
  assert.equal(runs.some((entry) => entry.run_id === "healthy-running"), true);
});

test("projectRunsFromCanonicalRows prefers terminal disk state over stale running canonical rows", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "canonical-run-projection-terminal-"));
  const runDir = join(runsDir, "completed-local");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "state.json"), JSON.stringify({
    runId: "completed-local",
    status: "completed",
    currentNode: "done",
    pipelineFile: "packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs",
    startedAt: "2026-03-28T14:49:07.119Z",
    updatedAt: "2026-03-28T14:50:10.886Z",
    context: {},
    activeChildren: {
      "run_domain_graph__ed82967c": {
        childRunId: "ed82967c",
        currentNode: "artifact_ingest",
        status: "failed",
      },
    },
  }, null, 2));

  const { runs } = projectRunsFromCanonicalRows([
    {
      event_family: "hatch.run.started",
      run_id: "completed-local",
      emitted_at: "2026-03-28T14:49:07.119Z",
      payload: { run_id: "completed-local", graph: "managed_supervisor", node: "run_domain_graph" },
    },
    {
      event_family: "hatch.run.node_entered",
      run_id: "completed-local",
      emitted_at: "2026-03-28T14:49:15.000Z",
      payload: { run_id: "completed-local", graph: "managed_supervisor", node: "run_domain_graph" },
    },
  ], runsDir);

  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.run_id, "completed-local");
  assert.equal(runs[0]?.status, "completed");
  assert.equal(runs[0]?.current_node, "done");
});
