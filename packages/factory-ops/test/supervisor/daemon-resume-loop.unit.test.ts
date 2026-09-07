import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runDaemon } from "../../src/lib/daemon.ts";

function makeTmpDir(prefix = "daemon-resume-loop-") {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

test("runDaemon does not rewrite already-resumed control state before running tick", async () => {
  const repoRoot = makeTmpDir();
  const hostBaseDir = makeTmpDir();
  const writes = [];
  const tickCalls = [];

  const runtime = {
    factoryId: "example-trading",
    factoryRoot: repoRoot,
    factoryConfigPath: path.join(repoRoot, "factory-config.json"),
    config: { managed: true },
    canonicalCheckoutPath: path.join(repoRoot, "canonical"),
    targetRepo: "example-org/example-trading",
    controlPlaneRepo: "recallnet/astrochicken",
    runsDir: path.join(repoRoot, ".hatch", "runs"),
    contextRepoPath: repoRoot,
    supervisorGraph: path.join(repoRoot, "graphs/supervisor.dot"),
    repoRoleContext: {
      targetRepo: "example-org/example-trading",
      controlPlaneRepo: "recallnet/astrochicken",
      destinationRepos: [],
    },
  };

  const out = await runDaemon("example-trading", {
    repoRoot,
    hostBaseDir,
    maxTicks: 1,
    resolveTickRuntimeFn: () => runtime,
    evaluateStartupInvariantFn: () => ({ ok: true }),
    readControlStateFn: () => ({
      reason: "circuit_breaker_cooldown_auto_retry",
      retry_target: "",
      action_state: {
        pause: { active: false },
        quarantine: { active: false },
        draining: { active: false },
        retry: { active: false },
        unblock: { active: false },
        resume: { active: true, at: "2026-03-27T20:20:58.000Z" },
      },
      notes: [{ at: "2026-03-27T20:20:58.000Z", actor: "daemon", action: "resume", reason: "circuit_breaker_cooldown_auto_retry" }],
    }),
    getControlStateActionFn: () => "resume",
    writeControlStateFn: (input) => {
      writes.push(input);
      return { ok: true };
    },
    runGitPullFn: () => {},
    runRecoverySweepFn: () => {},
    runInstallAndBuildFn: () => {},
    runTickFn: async () => {
      tickCalls.push(true);
      return { exitCode: 0, tickIdle: false, runId: "run-1", tickLogPath: path.join(repoRoot, "tick.log") };
    },
    sleepFn: async () => {},
  });

  assert.equal(out.ticks, 1);
  assert.equal(tickCalls.length, 1);
  assert.equal(writes.length, 0);
});
