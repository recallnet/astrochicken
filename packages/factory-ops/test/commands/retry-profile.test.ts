import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildRetryProfile, compareRetryProfiles } from "../../src/commands/retry-profile.ts";

test("buildRetryProfile aggregates attempts and failures", () => {
  const root = mkdtempSync(join(tmpdir(), "retry-profile-"));
  const run = join(root, "abc123");
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, "state.json"), JSON.stringify({
    runId: "abc123",
    status: "completed",
    currentNode: "done",
    pipelineFile: "x.dot",
    records: [
      { nodeId: "build", outcome: { status: "failed", error: "timeout", durationMs: 10 } },
      { nodeId: "build", outcome: { status: "completed", durationMs: 20 } },
      { nodeId: "merge", outcome: { status: "completed", durationMs: 5 } }
    ]
  }));

  const p = buildRetryProfile({ runsDir: root, last: 10 });
  assert.equal(p.scannedRuns, 1);
  assert.equal(p.aggregate.totalAttempts, 3);
  assert.equal(p.aggregate.failedAttempts, 1);
  const build = p.aggregate.topRetryNodes.find((n) => n.nodeId === "build");
  assert.ok(build);
  assert.equal(build.attempts, 2);
  assert.equal(build.failed, 1);
});

test("buildRetryProfile filters by pipeline substring", () => {
  const root = mkdtempSync(join(tmpdir(), "retry-profile-"));

  const runA = join(root, "1000-a");
  mkdirSync(runA, { recursive: true });
  writeFileSync(join(runA, "state.json"), JSON.stringify({
    runId: "1000-a",
    pipelineFile: "/x/factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
    records: [{ nodeId: "build", outcome: { status: "failed", error: "timeout", durationMs: 10 } }],
  }));

  const runB = join(root, "2000-b");
  mkdirSync(runB, { recursive: true });
  writeFileSync(join(runB, "state.json"), JSON.stringify({
    runId: "2000-b",
    pipelineFile: "/x/packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
    records: [{ nodeId: "scenarios", outcome: { status: "completed", durationMs: 5 } }],
  }));

  const p = buildRetryProfile({ runsDir: root, last: 5, pipeline: "wave_execute" });
  assert.equal(p.scannedRuns, 1);
  assert.equal(p.aggregate.totalAttempts, 1);
  assert.equal(p.pipelineFilter, "wave_execute");
});

test("compareRetryProfiles computes deltas between windows", () => {
  const root = mkdtempSync(join(tmpdir(), "retry-profile-"));

  const oldRun = join(root, "1000-old");
  mkdirSync(oldRun, { recursive: true });
  writeFileSync(join(oldRun, "state.json"), JSON.stringify({
    runId: "1000-old",
    records: [
      { nodeId: "build", outcome: { status: "failed", error: "timeout", durationMs: 10 } },
      { nodeId: "build", outcome: { status: "completed", durationMs: 10 } },
    ],
  }));

  const newRun = join(root, "2000-new");
  mkdirSync(newRun, { recursive: true });
  writeFileSync(join(newRun, "state.json"), JSON.stringify({
    runId: "2000-new",
    records: [
      { nodeId: "build", outcome: { status: "completed", durationMs: 20 } },
      { nodeId: "merge", outcome: { status: "completed", durationMs: 5 } },
    ],
  }));

  const current = buildRetryProfile({ runsDir: root, last: 1, offset: 0 });
  const baseline = buildRetryProfile({ runsDir: root, last: 1, offset: 1 });
  const c = compareRetryProfiles(current, baseline);

  assert.equal(c.current.scannedRuns, 1);
  assert.equal(c.baseline.scannedRuns, 1);
  assert.equal(c.deltas.failedAttemptsDelta, -1);
  const build = c.byNode.find((n) => n.nodeId === "build");
  assert.ok(build);
  assert.equal(build.failedDelta, -1);
});
