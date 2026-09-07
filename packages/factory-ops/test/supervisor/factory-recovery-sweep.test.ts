import assert from "node:assert/strict";
import test from "node:test";

import { reconcileRuntimeRecoverySweep } from "../../src/commands/factory-recovery-sweep.ts";

test("reconcileRuntimeRecoverySweep runs the recovery sweep engine in-process with deterministic args", () => {
  const scanCalls = [];
  const applyCalls = [];
  const out = reconcileRuntimeRecoverySweep({
    runsDir: ".hatch/runs",
    staleMinutes: 20,
    apply: true,
    runId: "dead-run-1",
    worktree: "/tmp/wt-1",
    branch: "wave/1",
    now: new Date("2026-01-01T00:31:00.000Z"),
    scanRuntimeRecoverySweepFn: (options) => {
      scanCalls.push(options);
      return {
        schemaVersion: "runtime_recovery_sweep/v1",
        staleRuns: [{ run_id: "dead-run-1" }],
        orphanedWorktrees: [{ path: "/tmp/wt-1" }],
        orphanedBranches: [{ branch: "wave/1" }],
        unresolvedActiveChildRefs: [],
        safeActions: [{ type: "terminalize_run", run_id: "dead-run-1" }],
      };
    },
    applyRuntimeRecoverySweepFn: ({ report, runsDir, now }) => {
      applyCalls.push({ report, runsDir, now });
      return {
        ok: true,
        appliedCount: 1,
        failedCount: 0,
      };
    },
  });

  assert.equal(out.ok, true);
  assert.equal(scanCalls.length, 1);
  assert.equal(applyCalls.length, 1);
  assert.equal(scanCalls[0].runsDir, ".hatch/runs");
  assert.equal(scanCalls[0].staleSeconds, 1200);
  assert.equal(scanCalls[0].runId, "dead-run-1");
  assert.equal(scanCalls[0].worktree, "/tmp/wt-1");
  assert.equal(scanCalls[0].branch, "wave/1");
  assert.equal(applyCalls[0].runsDir, ".hatch/runs");
});

test("reconcileRuntimeRecoverySweep supports camelCase report payload and optional routing args", () => {
  const scanCalls = [];
  const out = reconcileRuntimeRecoverySweep({
    runsDir: ".hatch/runs",
    staleMinutes: 20,
    repoPath: "/tmp/repo",
    lockDir: "/tmp/locks",
    apply: "on",
    scanRuntimeRecoverySweepFn: (options) => {
      scanCalls.push(options);
      return {
        schemaVersion: "runtime_recovery_sweep/v1",
        staleRuns: [{ run_id: "r1" }],
        unresolvedActiveChildRefs: [{ run_id: "r2" }],
        orphanedWorktrees: [{ path: "/tmp/wt" }],
        orphanedBranches: [{ branch: "wave/2" }],
        safeActions: [{ type: "gc" }],
      };
    },
    applyRuntimeRecoverySweepFn: () => ({ ok: true, appliedCount: 0, failedCount: 0 }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.apply, true);
  assert.equal(out.stale_runs.length, 1);
  assert.equal(out.unresolved_active_child_refs.length, 1);
  assert.equal(out.orphaned_worktrees.length, 1);
  assert.equal(out.orphaned_branches.length, 1);
  assert.equal(out.safe_actions.length, 1);

  assert.equal(scanCalls[0].repoPath, "/tmp/repo");
  assert.equal(scanCalls[0].lockDir, "/tmp/locks");
});

test("reconcileRuntimeRecoverySweep tolerates non-plain report values and preserves apply flag parsing", () => {
  const out = reconcileRuntimeRecoverySweep({
    apply: "yes",
    scanRuntimeRecoverySweepFn: () => undefined,
    applyRuntimeRecoverySweepFn: () => ({ ok: true, appliedCount: 0, failedCount: 0 }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.apply, true);
  assert.deepEqual(out.stale_runs, []);
  assert.equal(out.command.engine, "in_process_runtime_recovery_sweep");
});

test("reconcileRuntimeRecoverySweep forwards protectedPaths to the in-process engine", () => {
  const scanCalls = [];
  const out = reconcileRuntimeRecoverySweep({
    runsDir: ".hatch/runs",
    staleMinutes: 20,
    apply: true,
    protectedPaths: ["/Users/dev/canonical-checkout", "/Users/dev/repo-root"],
    scanRuntimeRecoverySweepFn: (options) => {
      scanCalls.push(options);
      return { ok: true, report: {}, applied: null };
    },
    applyRuntimeRecoverySweepFn: () => ({ ok: true, appliedCount: 0, failedCount: 0 }),
  });

  assert.equal(out.ok, true);
  assert.equal(scanCalls.length, 1);
  assert.deepEqual(scanCalls[0].protectedPaths, ["/Users/dev/canonical-checkout", "/Users/dev/repo-root"]);
});

test("reconcileRuntimeRecoverySweep forwards skipWorktreeScan to the in-process engine", () => {
  const scanCalls = [];
  const out = reconcileRuntimeRecoverySweep({
    runsDir: ".hatch/brainstorm/runs",
    staleMinutes: 20,
    skipWorktreeScan: true,
    scanRuntimeRecoverySweepFn: (options) => {
      scanCalls.push(options);
      return { ok: true, report: {}, applied: null };
    },
  });

  assert.equal(out.ok, true);
  assert.equal(scanCalls.length, 1);
  assert.equal(scanCalls[0].skipWorktreeScan, true);
});

test("reconcileRuntimeRecoverySweep surfaces engine failures", () => {
  const out = reconcileRuntimeRecoverySweep({
    scanRuntimeRecoverySweepFn: () => {
      throw new Error("scan failed");
    },
  });

  assert.equal(out.ok, false);
  assert.equal(out.error, "runtime_recovery_sweep_failed");
});
