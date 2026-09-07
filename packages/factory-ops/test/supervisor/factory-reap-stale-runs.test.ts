import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { reapStaleRuns } from "../../src/commands/factory-reap-stale-runs.ts";

function makeTmpDir() {
  const dir = join(tmpdir(), `taxi-reap-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeRun(runsDir, runId, state) {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "state.json"), JSON.stringify(state, null, 2));
}

test("reapStaleRuns: returns empty when no runs exist", () => {
  const dir = makeTmpDir();
  try {
    const out = reapStaleRuns({ runsDir: dir, staleMinutes: 20 });
    assert.equal(out.count, 0);
    assert.deepEqual(out.reaped, []);
    assert.deepEqual(out.stalled, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reapStaleRuns: skips non-running statuses", () => {
  const dir = makeTmpDir();
  try {
    writeRun(dir, "aaa", { runId: "aaa", status: "completed", updatedAt: "2020-01-01T00:00:00Z" });
    writeRun(dir, "bbb", { runId: "bbb", status: "failed", updatedAt: "2020-01-01T00:00:00Z" });
    const out = reapStaleRuns({ runsDir: dir, staleMinutes: 20 });
    assert.equal(out.count, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reapStaleRuns: detects stale running runs", () => {
  const dir = makeTmpDir();
  try {
    const staleTime = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30m ago
    const freshTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();  // 5m ago
    writeRun(dir, "stale1", { runId: "stale1", status: "running", updatedAt: staleTime, pipelineFile: "wave.dot", currentNode: "build" });
    writeRun(dir, "fresh1", { runId: "fresh1", status: "running", updatedAt: freshTime, pipelineFile: "wave.dot", currentNode: "review" });

    const out = reapStaleRuns({ runsDir: dir, staleMinutes: 20 });
    assert.equal(out.count, 1);
    assert.equal(out.reaped[0].runId, "stale1");
    assert.equal(out.reaped[0].currentNode, "build");
    assert.ok(out.reaped[0].ageMinutes >= 29);
    assert.equal(out.stalled_count, 0);

    // Verify state was updated
    const state = JSON.parse(readFileSync(join(dir, "stale1", "state.json"), "utf8"));
    assert.equal(state.status, "failed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reapStaleRuns: dry-run does not modify state", () => {
  const dir = makeTmpDir();
  try {
    const staleTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    writeRun(dir, "stale2", { runId: "stale2", status: "running", updatedAt: staleTime });

    const out = reapStaleRuns({ runsDir: dir, staleMinutes: 20, dryRun: true });
    assert.equal(out.count, 1);
    assert.equal(out.dryRun, true);
    assert.equal(out.stalled_count, 0);

    // State NOT modified
    const state = JSON.parse(readFileSync(join(dir, "stale2", "state.json"), "utf8"));
    assert.equal(state.status, "running");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reapStaleRuns: handles missing runs dir gracefully", () => {
  const out = reapStaleRuns({ runsDir: "/tmp/nonexistent-reap-test-dir" });
  assert.equal(out.count, 0);
  assert.equal(out.stalled_count, 0);
  assert.equal(out.error, "runs_dir_not_found");
});

test("reapStaleRuns: reports stale nodeStartedAt with fresh heartbeat as stalled without failing the run", () => {
  const dir = makeTmpDir();
  try {
    const freshUpdate = new Date(Date.now() - 5 * 1000).toISOString();     // 5s ago (fresh heartbeat)
    const staleNodeStart = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30m ago (stuck on same node)
    writeRun(dir, "stuck1", {
      runId: "stuck1", status: "running",
      updatedAt: freshUpdate,
      nodeStartedAt: staleNodeStart,
      pipelineFile: "goal_intake_decompose.dot", currentNode: "analyze"
    });

    const out = reapStaleRuns({ runsDir: dir, staleMinutes: 20 });
    assert.equal(out.count, 0);
    assert.equal(out.stalled_count, 1);
    assert.equal(out.stalled[0].runId, "stuck1");
    assert.equal(out.stalled[0].currentNode, "analyze");

    // State stays running; this is a healthy-but-slow heartbeat, not stale ownership.
    const state = JSON.parse(readFileSync(join(dir, "stuck1", "state.json"), "utf8"));
    assert.equal(state.status, "running");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reapStaleRuns: falls back to startedAt when nodeStartedAt is missing and heartbeat is stale", () => {
  const dir = makeTmpDir();
  try {
    const staleUpdate = new Date(Date.now() - 90 * 60 * 1000).toISOString(); // 90m ago (stale heartbeat)
    const staleStart = new Date(Date.now() - 90 * 60 * 1000).toISOString(); // 90m ago
    writeRun(dir, "zombie1", {
      runId: "zombie1", status: "running",
      updatedAt: staleUpdate,
      // nodeStartedAt is MISSING — pre-fix run
      startedAt: staleStart,
      pipelineFile: "goal_issue_execute.dot", currentNode: "build"
    });

    const out = reapStaleRuns({ runsDir: dir, staleMinutes: 60 });
    assert.equal(out.count, 1, "should reap zombie run using startedAt fallback");
    assert.equal(out.reaped[0].runId, "zombie1");
    assert.equal(out.stalled_count, 0);

    const state = JSON.parse(readFileSync(join(dir, "zombie1", "state.json"), "utf8"));
    assert.equal(state.status, "failed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reapStaleRuns: reaps runs when heartbeat is missing and node age is stale", () => {
  const dir = makeTmpDir();
  try {
    const staleNodeStart = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    writeRun(dir, "missing-heartbeat-1", {
      runId: "missing-heartbeat-1",
      status: "running",
      nodeStartedAt: staleNodeStart,
      pipelineFile: "goal_issue_execute.dot",
      currentNode: "build"
    });

    const out = reapStaleRuns({ runsDir: dir, staleMinutes: 60 });
    assert.equal(out.count, 1);
    assert.equal(out.reaped[0].runId, "missing-heartbeat-1");
    assert.equal(out.stalled_count, 0);

    const state = JSON.parse(readFileSync(join(dir, "missing-heartbeat-1", "state.json"), "utf8"));
    assert.equal(state.status, "failed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reapStaleRuns: does not reap when nodeStartedAt is fresh", () => {
  const dir = makeTmpDir();
  try {
    const freshUpdate = new Date(Date.now() - 5 * 1000).toISOString();
    const freshNodeStart = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5m ago (not stale)
    writeRun(dir, "ok1", {
      runId: "ok1", status: "running",
      updatedAt: freshUpdate,
      nodeStartedAt: freshNodeStart,
      pipelineFile: "wave.dot", currentNode: "build"
    });

    const out = reapStaleRuns({ runsDir: dir, staleMinutes: 20 });
    assert.equal(out.count, 0);
    assert.equal(out.stalled_count, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
