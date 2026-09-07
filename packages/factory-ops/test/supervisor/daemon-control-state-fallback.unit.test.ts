import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { afterEach, mock } from "node:test";

import { IDLE_SLEEP_BASE_MS, runDaemon } from "../../src/lib/daemon.ts";

const tempDirs = [];

function makeTmpDir(prefix = "daemon-control-state-fallback-") {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  mock.restoreAll();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runDaemon falls back to mirrored control state when canonical read hits lock timeout", async () => {
  const repoRoot = makeTmpDir();
  const hostBaseDir = makeTmpDir();
  const controlStatePath = path.join(repoRoot, ".hatch", "factories", "example-scanner", "control-state.json");
  const sleepCalls = [];
  let tickCalls = 0;

  mkdirSync(path.dirname(controlStatePath), { recursive: true });
  writeFileSync(controlStatePath, `${JSON.stringify({
    schema: "external-factory-control-state/v1",
    factory_id: "example-scanner",
    version: 3,
    updated_at: "2026-03-28T14:00:00.000Z",
    updated_by: "operator",
    action_state: {
      pause: { active: true },
      quarantine: { active: false, count: 0, last_reason: "", last_at: "" },
      draining: { active: false, at: "" },
      retry: { active: false, count: 0, last_reason: "", last_at: "", last_target: "" },
      unblock: { active: false, note: "", at: "" },
      resume: { active: false, at: "" },
    },
    reason: "operator_pause",
    retry_target: "",
    notes: [],
    lifecycle_state_snapshot: {
      schema_version: "managed-factory-snapshot/v1",
      lifecycle_state: "",
      lifecycle_reason: "",
      lifecycle_failure_classification: "",
      lifecycle_failure_reason: "",
      lifecycle_updated_at: "",
      lifecycle_updated_by: "",
      blockers: {
        upstream: {
          has_open_upstream_bugs: false,
          open_upstream_bug_count: 0,
          open_upstream_bug_numbers: [],
        },
        action_items: {
          has_action_items: false,
          action_item_count: 0,
        },
      },
      unresolved_actions: 0,
      queue_depth: 0,
      oldest_work_age_seconds: 0,
      latest_incidents: [],
    },
  }, null, 2)}\n`);

  const runtime = {
    factoryId: "example-scanner",
    factoryRoot: repoRoot,
    factoryConfigPath: path.join(repoRoot, "factory-config.json"),
    config: { managed: true },
    canonicalCheckoutPath: path.join(repoRoot, "canonical"),
    targetRepo: "example-org/example-scanner",
    controlPlaneRepo: "recallnet/astrochicken",
    runsDir: path.join(repoRoot, ".hatch", "runs"),
    contextRepoPath: repoRoot,
    supervisorGraph: path.join(repoRoot, "graphs/supervisor.dot"),
    repoRoleContext: {
      targetRepo: "example-org/example-scanner",
      controlPlaneRepo: "recallnet/astrochicken",
      destinationRepos: [],
    },
  };

  const out = await runDaemon("example-scanner", {
    repoRoot,
    hostBaseDir,
    maxTicks: 2,
    resolveTickRuntimeFn: () => runtime,
    evaluateStartupInvariantFn: () => ({ ok: true }),
    readHostFactoryIntentFn: () => ({ enabled: true }),
    readControlStateFn: () => {
      const error = new Error("canceling statement due to lock timeout");
      error.code = "55P03";
      throw error;
    },
    getControlStateActionFn: (state) => (state?.action_state?.pause?.active ? "pause" : "none"),
    runGitPullFn: () => { throw new Error("git pull must not run while fallback pause is active"); },
    runRecoverySweepFn: () => { throw new Error("recovery sweep must not run while fallback pause is active"); },
    runInstallAndBuildFn: () => { throw new Error("install must not run while fallback pause is active"); },
    runTickFn: async () => {
      tickCalls++;
      return { exitCode: 0, tickIdle: false, runId: "run-1", tickLogPath: path.join(repoRoot, "tick.log") };
    },
    sleepFn: async (ms) => { sleepCalls.push(ms); },
  });

  assert.equal(out.ticks, 0, "pause from mirrored control state must suppress ticks");
  assert.equal(out.loops, 2, "loop count should reflect paused iterations");
  assert.equal(tickCalls, 0, "daemon must not run a tick while mirrored pause is active");
  assert.deepEqual(sleepCalls, [IDLE_SLEEP_BASE_MS], "daemon should sleep idle while paused");
});
