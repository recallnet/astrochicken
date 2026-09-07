import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FactoryStateReader } from "../../src/lib/factory-state-reader.ts";

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

function createRun(root, runId, { state, metadata } = {}) {
  const dir = join(root, runId);
  mkdirSync(dir, { recursive: true });
  if (state !== undefined) writeJson(join(dir, "state.json"), state);
  if (metadata !== undefined) writeJson(join(dir, "metadata.json"), metadata);
  return dir;
}

test("FactoryStateReader caches repeat reads for unchanged files", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-state-reader-cache-hit-"));
  const runDir = createRun(runsDir, "run-1", {
    state: { status: "running", updatedAt: "2026-03-12T04:00:00.000Z" },
  });

  const reader = new FactoryStateReader(runsDir);
  const first = reader.readRunState(runDir);
  const second = reader.readRunState(runDir);

  assert.equal(first?.status, "running");
  assert.equal(second?.status, "running");
  assert.deepEqual(reader._cacheStats(), { hits: 1, misses: 1 });
});

test("FactoryStateReader cache misses after file mutation (mtime change)", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-state-reader-cache-miss-"));
  const runDir = createRun(runsDir, "run-1", {
    state: { status: "running", updatedAt: "2026-03-12T04:00:00.000Z" },
  });
  const statePath = join(runDir, "state.json");

  const reader = new FactoryStateReader(runsDir);
  const first = reader.readRunState(runDir);
  assert.equal(first?.status, "running");

  writeJson(statePath, { status: "completed", updatedAt: "2026-03-12T04:01:00.000Z" });
  const bump = new Date(Date.now() + 2000);
  utimesSync(statePath, bump, bump);

  const second = reader.readRunState(runDir);
  assert.equal(second?.status, "completed");
  assert.equal(reader._cacheStats().misses, 2);
});

test("FactoryStateReader keeps cache bounded to 200 entries", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-state-reader-lru-"));
  const reader = new FactoryStateReader(runsDir);

  for (let i = 0; i < 201; i += 1) {
    const runDir = createRun(runsDir, `run-${String(i).padStart(3, "0")}`, {
      state: {
        status: "running",
        updatedAt: `2026-03-12T04:${String(i % 60).padStart(2, "0")}:00.000Z`,
      },
    });
    reader.readRunState(runDir);
    assert.ok(reader._cache.size <= 200);
  }

  assert.ok(reader._cache.size <= 200);
});

test("FactoryStateReader listRuns returns canonical run rows", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-state-reader-list-"));
  createRun(runsDir, "run-a", {
    state: { status: "running", updatedAt: "2026-03-12T04:01:00.000Z", currentNode: "a" },
    metadata: { heartbeatAt: "2026-03-12T04:01:10.000Z", pid: 101 },
  });
  createRun(runsDir, "run-b", {
    state: { status: "complete", updatedAt: "2026-03-12T04:03:00.000Z", currentNode: "b" },
    metadata: { heartbeatAt: "2026-03-12T04:03:10.000Z", pid: 102 },
  });
  createRun(runsDir, "run-c", {
    state: { status: "fail", updatedAt: "2026-03-12T04:02:00.000Z", currentNode: "c" },
    metadata: { heartbeatAt: "2026-03-12T04:02:10.000Z", pid: 103 },
  });

  const reader = new FactoryStateReader(runsDir);
  const runs = reader.listRuns();

  assert.equal(runs.length, 3);
  assert.deepEqual(runs.map((row) => row.runId), ["run-b", "run-c", "run-a"]);
  for (const row of runs) {
    assert.equal(typeof row.runId, "string");
    assert.equal(typeof row.dir, "string");
    assert.ok(row.state);
    assert.ok("status" in row.state);
    assert.ok("metadata" in row);
  }
});

test("FactoryStateReader readRunState returns null when state.json is missing", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-state-reader-missing-"));
  const runDir = createRun(runsDir, "run-1", {
    metadata: { heartbeatAt: "2026-03-12T04:00:00.000Z" },
  });

  const reader = new FactoryStateReader(runsDir);
  assert.equal(reader.readRunState(runDir), null);
});

test("FactoryStateReader normalizes defaults for minimal state payload", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-state-reader-defaults-"));
  const runDir = createRun(runsDir, "run-1", {
    state: { status: "running" },
  });

  const reader = new FactoryStateReader(runsDir);
  const state = reader.readRunState(runDir);

  assert.deepEqual(state, {
    runId: null,
    status: "running",
    currentNode: null,
    pipelineFile: null,
    startedAt: null,
    updatedAt: null,
    createdAt: null,
    context: {},
    activeChildren: {},
    pid: null,
  });
});

test("FactoryStateReader readTickState returns only supervisor tick runs", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-state-reader-tick-"));
  createRun(runsDir, "tick-run", {
    state: {
      status: "running",
      pipeline: "/tmp/factory_supervisor_tick.dot",
      updatedAt: "2026-03-12T04:04:00.000Z",
    },
  });
  createRun(runsDir, "wave-run", {
    state: {
      status: "running",
      pipelineFile: "/tmp/wave_execute.dot",
      updatedAt: "2026-03-12T04:03:00.000Z",
    },
  });
  createRun(runsDir, "goal-run", {
    state: {
      status: "running",
      pipelineFile: "/tmp/goal_run.dot",
      updatedAt: "2026-03-12T04:02:00.000Z",
    },
  });

  const reader = new FactoryStateReader(runsDir);
  const ticks = reader.readTickState();

  assert.deepEqual(ticks.map((row) => row.runId), ["tick-run"]);
  assert.equal(ticks[0]?.state?.pipelineFile, "/tmp/factory_supervisor_tick.dot");
});
