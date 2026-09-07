import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  hostVersion,
  hostLogs,
} from "../../src/commands/factory-host-lifecycle.ts";

function makeTmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeDaemonStub(rootDir) {
  const scriptPath = join(rootDir, "daemon_stub.sh");
  writeFileSync(scriptPath, `#!/usr/bin/env bash
set -eu
mkdir -p "$(dirname "$FACTORY_DAEMON_PID_FILE")" "${"$"}{FACTORY_DAEMON_LOG_DIR:-/tmp}"
echo $$ > "$FACTORY_DAEMON_PID_FILE"
echo "factory=${"$"}{HATCH_FACTORY_ID:-unknown} argv1=${"$"}{1:-missing} runs=${"$"}{HATCH_RUNS_DIR:-missing}" >> "${"$"}{FACTORY_DAEMON_LOG_DIR:-/tmp}/daemon.log"
trap 'rm -f "$FACTORY_DAEMON_PID_FILE"; exit 0' TERM INT
while true; do sleep 1; done
`);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function writeShortLivedDaemonStub(rootDir) {
  const scriptPath = join(rootDir, "daemon_short_lived_stub.sh");
  writeFileSync(scriptPath, `#!/usr/bin/env bash
set -eu
mkdir -p "$(dirname "$FACTORY_DAEMON_PID_FILE")" "${"$"}{FACTORY_DAEMON_LOG_DIR:-/tmp}"
echo $$ > "$FACTORY_DAEMON_PID_FILE"
echo "short_lived factory=${"$"}{HATCH_FACTORY_ID:-unknown} argv1=${"$"}{1:-missing}" >> "${"$"}{FACTORY_DAEMON_LOG_DIR:-/tmp}/daemon.log"
sleep 0.2
rm -f "$FACTORY_DAEMON_PID_FILE"
exit 0
`);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

async function waitForFile(path, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(path)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return existsSync(path);
}

test("resolveHostPaths isolates factories and rejects ambiguous factory-id substring overrides", () => {
  const baseDir = makeTmpDir("factory-host-paths-");
  try {
    const alpha = resolveHostPaths({ factoryId: "alpha", baseDir });
    const beta = resolveHostPaths({ factoryId: "beta", baseDir });

    assert.notEqual(alpha.logsDir, beta.logsDir);
    assert.notEqual(alpha.runsDir, beta.runsDir);
    assert.notEqual(alpha.pidFile, beta.pidFile);
    assert.match(alpha.logsDir, /alpha/);
    assert.match(beta.logsDir, /beta/);

    assert.throws(
      () => resolveHostPaths({ factoryId: "", baseDir }),
      /factory_id_required/,
    );

    assert.throws(
      () => resolveHostPaths({
        factoryId: "alpha",
        baseDir,
        runsDir: join(baseDir, "alpha-beta-runs"),
      }),
      /runs_dir_contains_ambiguous_factory_substring/,
    );

    const sharedRunsRoot = join(baseDir, "shared-runs-root");
    const alphaScoped = resolveHostPaths({ factoryId: "alpha", baseDir, runsDir: sharedRunsRoot });
    const betaScoped = resolveHostPaths({ factoryId: "beta", baseDir, runsDir: sharedRunsRoot });
    assert.notEqual(alphaScoped.runsDir, betaScoped.runsDir);
    assert.match(alphaScoped.runsDir, /shared-runs-root[\/\\]alpha$/);
    assert.match(betaScoped.runsDir, /shared-runs-root[\/\\]beta$/);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("resolveHostPaths defaults to host-scoped ~/.hatch-hosts when baseDir is omitted", () => {
  const originalHome = process.env.HOME;
  const originalHostBaseDir = process.env.HATCH_HOST_BASE_DIR;
  const homeDir = makeTmpDir("factory-host-home-");
  try {
    process.env.HOME = homeDir;
    delete process.env.HATCH_HOST_BASE_DIR;

    const paths = resolveHostPaths({ factoryId: "alpha" });
    assert.equal(paths.baseDir, join(homeDir, ".hatch-hosts"));
    assert.match(paths.pidFile, /[\\/]alpha[\\/]pid[\\/]factory-daemon\.pid$/);
    assert.match(paths.logsDir, /[\\/]alpha[\\/]logs$/);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalHostBaseDir === undefined) delete process.env.HATCH_HOST_BASE_DIR;
    else process.env.HATCH_HOST_BASE_DIR = originalHostBaseDir;
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("resolveHostPaths enforces factory-scoped fs policy when mutation context is provided", () => {
  const baseDir = makeTmpDir("factory-host-policy-");
  try {
    assert.throws(
      () => resolveHostPaths({
        factoryId: "fac_123",
        baseDir,
        mutationContext: {
          target_repo: "example-org/home",
          destinations: {},
          control_plane_repo: "example-org/control-plane",
          instance_id: "fac_123",
        },
      }),
      /outside_factory_scoped_paths:mutation_policy_local_filesystem_path_forbidden/,
    );
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("hostInstall/start/stop are idempotent and reject duplicate live start", async () => {
  const baseDir = makeTmpDir("factory-host-lifecycle-");
  const scriptPath = writeDaemonStub(baseDir);
  const paths = resolveHostPaths({ factoryId: "alpha", baseDir });
  const env = {
    HATCH_FACTORY_ID: "alpha",
    HATCH_RUNS_DIR: paths.runsDir,
    FACTORY_DAEMON_LOG_DIR: paths.logsDir,
    FACTORY_DAEMON_PID_DIR: paths.pidDir,
    FACTORY_DAEMON_PID_FILE: paths.pidFile,
    FACTORY_DAEMON_LOCK_DIR: paths.lockDir,
  };

  try {
    const installed = hostInstall(paths, { workspace_mode: "api_only" });
    assert.equal(installed.ok, true);
    assert.equal(existsSync(paths.logsDir), true);
    assert.equal(existsSync(paths.runsDir), true);
    assert.equal(existsSync(paths.pidDir), true);
    const installManifest = JSON.parse(readFileSync(paths.installationManifestPath, "utf8"));
    assert.equal(installManifest.workspace_mode, "api_only");

    const started = await hostStart({
      factoryId: "alpha",
      daemonScript: scriptPath,
      env,
      detach: true,
      pidFile: paths.pidFile,
      paths,
    });
    assert.equal(started.ok, true, started.message);
    assert.equal(started.status, "started");
    assert.ok(started.pid > 0);
    const daemonLogPath = join(paths.logsDir, "daemon.log");
    assert.equal(await waitForFile(daemonLogPath, 1500), true);
    const daemonLog = readFileSync(daemonLogPath, "utf8");
    assert.match(daemonLog, /factory=alpha argv1=alpha runs=/);

    const duplicateStart = await hostStart({
      factoryId: "alpha",
      daemonScript: scriptPath,
      env,
      detach: true,
      pidFile: paths.pidFile,
      paths,
    });
    assert.equal(duplicateStart.ok, false);
    assert.equal(duplicateStart.status, "already_running");

    const runningHealth = hostHealth({
      factoryId: "alpha",
      pidFile: paths.pidFile,
      runsDir: paths.runsDir,
      logsDir: paths.logsDir,
      paths,
    });
    assert.equal(runningHealth.status, "running");
    assert.equal(runningHealth.running, true);

    const stopped = await hostStop({
      factoryId: "alpha",
      pidFile: paths.pidFile,
      signal: "TERM",
      timeoutMs: 3000,
      paths,
    });
    assert.equal(stopped.ok, true, stopped.message);
    assert.match(stopped.status, /stopped|force_killed/);

    const stoppedAgain = await hostStop({
      factoryId: "alpha",
      pidFile: paths.pidFile,
      signal: "TERM",
      timeoutMs: 500,
      paths,
    });
    assert.equal(stoppedAgain.ok, true);
    assert.match(stoppedAgain.status, /already_stopped|stale_pid_cleared/);
  } finally {
    await hostStop({
      factoryId: "alpha",
      pidFile: paths.pidFile,
      signal: "TERM",
      timeoutMs: 500,
      paths,
    });
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("hostStart fails closed when launcher exits before daemon stabilizes", async () => {
  const baseDir = makeTmpDir("factory-host-short-lived-");
  const scriptPath = writeShortLivedDaemonStub(baseDir);
  const paths = resolveHostPaths({ factoryId: "gamma", baseDir });
  const env = {
    HATCH_FACTORY_ID: "gamma",
    HATCH_RUNS_DIR: paths.runsDir,
    FACTORY_DAEMON_LOG_DIR: paths.logsDir,
    FACTORY_DAEMON_PID_DIR: paths.pidDir,
    FACTORY_DAEMON_PID_FILE: paths.pidFile,
    FACTORY_DAEMON_LOCK_DIR: paths.lockDir,
  };

  try {
    hostInstall(paths, { workspace_mode: "api_only" });

    const started = await hostStart({
      factoryId: "gamma",
      daemonScript: scriptPath,
      env,
      detach: true,
      pidFile: paths.pidFile,
      paths,
    });

    assert.equal(started.ok, false);
    assert.equal(started.status, "start_failed");
    assert.equal(started.errorCode, "factory_host_start_failed");
    assert.equal(existsSync(paths.pidFile), false);
  } finally {
    await hostStop({
      factoryId: "gamma",
      pidFile: paths.pidFile,
      signal: "TERM",
      timeoutMs: 500,
      paths,
    });
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("hostRestart + hostLogs + hostVersion expose deterministic host metadata", async () => {
  const baseDir = makeTmpDir("factory-host-observe-");
  const scriptPath = writeDaemonStub(baseDir);
  const paths = resolveHostPaths({ factoryId: "beta", baseDir });
  hostInstall(paths);

  mkdirSync(paths.logsDir, { recursive: true });
  writeFileSync(join(paths.logsDir, "daemon.log"), "line-a\nline-b\nline-c\n");

  try {
    const restart = await hostRestart({
      factoryId: "beta",
      daemonScript: scriptPath,
      env: {
        HATCH_FACTORY_ID: "beta",
        HATCH_RUNS_DIR: paths.runsDir,
        FACTORY_DAEMON_LOG_DIR: paths.logsDir,
        FACTORY_DAEMON_PID_DIR: paths.pidDir,
        FACTORY_DAEMON_PID_FILE: paths.pidFile,
        FACTORY_DAEMON_LOCK_DIR: paths.lockDir,
      },
      detach: true,
      pidFile: paths.pidFile,
      signal: "TERM",
      timeoutMs: 3000,
      paths,
    });
    assert.equal(restart.ok, true, restart.message);
    assert.equal(restart.status, "restarted");

    const logs = hostLogs({
      factoryId: "beta",
      logsDir: paths.logsDir,
      tailLines: 2,
      sinceDuration: "1h",
      paths,
    });
    assert.equal(logs.ok, true);
    assert.equal(logs.lines.length, 2);
    assert.ok(logs.logsPolicyHint, "logsPolicyHint should be present");
    assert.equal(logs.logsPolicyHint.retention_policy, "no_automatic_rotation");
    assert.equal(logs.logsPolicyHint.recommended_max_age, "30d");
    assert.ok(
      typeof logs.logsPolicyHint.prune_command === "string" && logs.logsPolicyHint.prune_command.length > 0,
      "logsPolicyHint.prune_command should be a non-empty string",
    );

    const missingLogs = hostLogs({
      factoryId: "beta",
      logsDir: join(baseDir, "missing-logs-dir"),
      tailLines: 2,
      sinceDuration: "1h",
      paths,
    });
    assert.equal(missingLogs.ok, false);
    assert.equal(missingLogs.status, "logs_dir_missing");
    assert.ok(missingLogs.logsPolicyHint, "logsPolicyHint should be present on missing logs dir path");
    assert.equal(missingLogs.logsPolicyHint.retention_policy, "no_automatic_rotation");
    assert.equal(missingLogs.logsPolicyHint.recommended_max_age, "30d");
    assert.ok(
      typeof missingLogs.logsPolicyHint.prune_command === "string"
        && missingLogs.logsPolicyHint.prune_command.length > 0,
      "logsPolicyHint.prune_command should be a non-empty string on missing logs dir path",
    );

    const version = hostVersion({
      factoryRoot: process.cwd(),
      factoryId: "beta",
      paths,
    });
    assert.ok(version.version);
    assert.equal(version.status, "ok");
  } finally {
    await hostStop({
      factoryId: "beta",
      pidFile: paths.pidFile,
      signal: "TERM",
      timeoutMs: 1000,
      paths,
    });
    rmSync(baseDir, { recursive: true, force: true });
  }
});
