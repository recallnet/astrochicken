import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  resolveHostPaths,
  hostInstall,
  hostStart,
  hostStop,
  hostRestart,
  hostHealth,
} from "../../src/commands/factory-host-lifecycle.ts";

function writeDaemonStub(rootDir) {
  const scriptPath = join(rootDir, "daemon_stub.sh");
  writeFileSync(scriptPath, `#!/usr/bin/env bash
set -eu
mkdir -p "$(dirname "$FACTORY_DAEMON_PID_FILE")" "${"$"}{FACTORY_DAEMON_LOG_DIR:-/tmp}"
echo $$ > "$FACTORY_DAEMON_PID_FILE"
echo "factory=${"$"}{HATCH_FACTORY_ID:-unknown} runs=${"$"}{HATCH_RUNS_DIR:-missing}" >> "${"$"}{FACTORY_DAEMON_LOG_DIR:-/tmp}/daemon.log"
trap 'rm -f "$FACTORY_DAEMON_PID_FILE"; exit 0' TERM INT
while true; do sleep 1; done
`);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

async function waitForPidFile(pidFile, { maxMs = 1000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + maxMs;
  while (Date.now() <= deadline) {
    if (existsSync(pidFile)) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`pid_file_timeout:${pidFile}`);
}

test("same-machine host lifecycle isolates concurrent factory daemons", async () => {
  const baseDir = mkdtempSync(join(tmpdir(), "factory-host-same-machine-"));
  const daemonStubPath = writeDaemonStub(baseDir);
  const alphaPaths = resolveHostPaths({ factoryId: "alpha", baseDir });
  const betaPaths = resolveHostPaths({ factoryId: "beta", baseDir });

  try {
    hostInstall(alphaPaths);
    hostInstall(betaPaths);

    const [alphaStart, betaStart] = await Promise.all([
      hostStart({
        ...alphaPaths,
        daemonScript: daemonStubPath,
        env: { HATCH_FACTORY_ID: "alpha" },
      }),
      hostStart({
        ...betaPaths,
        daemonScript: daemonStubPath,
        env: { HATCH_FACTORY_ID: "beta" },
      }),
    ]);

    assert.equal(alphaStart.ok, true, alphaStart.message);
    assert.equal(betaStart.ok, true, betaStart.message);

    await waitForPidFile(alphaPaths.pidFile);
    await waitForPidFile(betaPaths.pidFile);

    assert.notEqual(alphaPaths.logsDir, betaPaths.logsDir);
    assert.notEqual(alphaPaths.runsDir, betaPaths.runsDir);
    assert.notEqual(alphaPaths.tmpDir, betaPaths.tmpDir);
    assert.notEqual(alphaPaths.socketDir, betaPaths.socketDir);
    assert.notEqual(alphaPaths.pidDir, betaPaths.pidDir);
    assert.notEqual(alphaPaths.pidFile, betaPaths.pidFile);

    const alphaHealth = hostHealth(alphaPaths);
    const betaHealth = hostHealth(betaPaths);
    assert.equal(alphaHealth.status, "running");
    assert.equal(betaHealth.status, "running");
    assert.ok(alphaHealth.pid > 0);
    assert.ok(betaHealth.pid > 0);
    assert.notEqual(alphaHealth.pid, betaHealth.pid);

    const betaPidBeforeRestart = betaHealth.pid;
    const alphaRestart = await hostRestart({
      ...alphaPaths,
      daemonScript: daemonStubPath,
      env: { HATCH_FACTORY_ID: "alpha" },
    });
    assert.equal(alphaRestart.ok, true, alphaRestart.message);

    await waitForPidFile(alphaPaths.pidFile);

    const alphaAfter = hostHealth(alphaPaths);
    const betaAfter = hostHealth(betaPaths);
    assert.equal(alphaAfter.status, "running");
    assert.equal(betaAfter.status, "running");
    assert.ok(alphaAfter.pid > 0);
    assert.ok(betaAfter.pid > 0);
    assert.notEqual(alphaAfter.pid, betaAfter.pid);
    assert.equal(betaAfter.pid, betaPidBeforeRestart);

    const [alphaStop, betaStop] = await Promise.all([
      hostStop(alphaPaths),
      hostStop(betaPaths),
    ]);
    assert.equal(alphaStop.ok, true, alphaStop.message);
    assert.equal(betaStop.ok, true, betaStop.message);

    assert.equal(hostHealth(alphaPaths).status, "stopped");
    assert.equal(hostHealth(betaPaths).status, "stopped");
    assert.equal(existsSync(alphaPaths.pidFile), false);
    assert.equal(existsSync(betaPaths.pidFile), false);
  } finally {
    await Promise.allSettled([hostStop(alphaPaths), hostStop(betaPaths)]);
    rmSync(baseDir, { recursive: true, force: true });
  }
});
