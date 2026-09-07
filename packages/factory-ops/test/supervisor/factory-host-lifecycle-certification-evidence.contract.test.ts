import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  resolveHostPaths,
} from "../../src/commands/factory-host-lifecycle.ts";
import {
  loadCertificationContract,
} from "../../src/lib/external-factory-certification-contract.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");
const factoryRoot = join(repoRoot, "factories/mothership");

function makeTmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeDaemonStub(rootDir) {
  const scriptPath = join(rootDir, "daemon_stub.sh");
  writeFileSync(scriptPath, `#!/usr/bin/env bash
set -eu
mkdir -p "$(dirname "$FACTORY_DAEMON_PID_FILE")" "${"$"}{FACTORY_DAEMON_LOG_DIR:-/tmp}"
echo $$ > "$FACTORY_DAEMON_PID_FILE"
echo "started factory=${"$"}{HATCH_FACTORY_ID:-unknown}" >> "${"$"}{FACTORY_DAEMON_LOG_DIR:-/tmp}/daemon.log"
trap 'rm -f "$FACTORY_DAEMON_PID_FILE"; exit 0' TERM INT
while true; do sleep 1; done
`);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function runCli(args, { expectOk = true } = {}) {
  // Clear mutation-context env vars so the CLI does not inherit the live factory's
  // path policy, which would reject isolated test temp-dir paths.
  const env = { ...process.env };
  delete env["HATCH_FACTORY_MUTATION_CONTEXT_JSON"];
  const run = spawnSync("node", [opsCliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
  const stdout = String(run.stdout || "").trim();
  const payload = stdout ? JSON.parse(stdout) : {};

  if (expectOk) {
    assert.equal(run.status, 0, `stderr=${run.stderr}\nstdout=${run.stdout}`);
    assert.equal(payload.ok, true, `stderr=${run.stderr}\nstdout=${run.stdout}`);
  }

  return { ...run, payload };
}

function assertHostStartEvidence(payload) {
  assert.equal(payload.ok, true);
  assert.match(payload.status, /started|already_running/);
  assert.ok(Number(payload.pid) > 0, "host-start must return pid > 0");
  assert.equal(typeof payload.log_dir, "string");
  assert.ok(payload.log_dir.length > 0, "host-start must return log_dir");
  assert.equal(typeof payload.runs_dir, "string");
  assert.ok(payload.runs_dir.length > 0, "host-start must return runs_dir");
}

function assertHostHealthEvidence(payload) {
  assert.equal(payload.ok, true);
  assert.equal(typeof payload.status, "string");
  assert.ok(payload.status.length > 0, "host-health must return non-empty status");
  assert.ok(
    payload.status === "running" || payload.status === "stopped" || payload.status === "stale_pid_cleared",
    `unexpected host-health status: ${payload.status}`,
  );
  if (payload.status === "running") {
    assert.ok(Number(payload.pid) > 0, "running host-health must return pid > 0");
  }
}

function assertHostRestartEvidence(payload) {
  assert.equal(payload.ok, true);
  assert.equal(payload.status, "restarted");
  assert.ok(Number(payload.pid) > 0, "host-restart must return pid > 0");
}

test("host_lifecycle_same_machine certification surface has executable evidence from CLI outputs", async () => {
  const contract = await loadCertificationContract({});
  const surface = (contract.surfaces || []).find((entry) => entry.id === "host_lifecycle_same_machine");

  assert.ok(surface, "host_lifecycle_same_machine surface must exist in certification contract");
  assert.equal(surface.severity, "required");

  const hostBaseDir = makeTmpDir("factory-host-cert-evidence-");
  const daemonRoot = makeTmpDir("factory-host-cert-daemon-");
  const daemonScript = writeDaemonStub(daemonRoot);
  const factoryId = "cert-test";
  // Pass mutationContext: false to prevent ambient HATCH_FACTORY_MUTATION_CONTEXT_JSON
  // (set in live factory environments) from blocking the isolated test temp-dir paths.
  const paths = resolveHostPaths({ factoryId, baseDir: hostBaseDir, mutationContext: false });
  const evidence = [];

  try {
    const install = runCli([
      "factory", "host-install",
      "--factory-root", factoryRoot,
      "--factory-id", factoryId,
      "--host-base-dir", hostBaseDir,
    ]).payload;
    assert.equal(install.ok, true);

    const start = runCli([
      "factory", "host-start",
      "--factory-root", factoryRoot,
      "--factory-id", factoryId,
      "--host-base-dir", hostBaseDir,
      "--daemon-script", daemonScript,
    ]).payload;
    assertHostStartEvidence(start);
    evidence.push({ name: "host_start", payload: start });

    const health = runCli([
      "factory", "host-health",
      "--factory-root", factoryRoot,
      "--factory-id", factoryId,
      "--host-base-dir", hostBaseDir,
    ]).payload;
    assertHostHealthEvidence(health);
    evidence.push({ name: "host_health", payload: health });

    const restart = runCli([
      "factory", "host-restart",
      "--factory-root", factoryRoot,
      "--factory-id", factoryId,
      "--host-base-dir", hostBaseDir,
      "--daemon-script", daemonScript,
    ]).payload;
    assertHostRestartEvidence(restart);
    evidence.push({ name: "host_restart", payload: restart });

    const stopAfterRestart = runCli([
      "factory", "host-stop",
      "--factory-root", factoryRoot,
      "--factory-id", factoryId,
      "--host-base-dir", hostBaseDir,
    ]).payload;
    assert.equal(stopAfterRestart.ok, true);

    writeFileSync(paths.pidFile, "99999999\n");

    const staleHealth = runCli([
      "factory", "host-health",
      "--factory-root", factoryRoot,
      "--factory-id", factoryId,
      "--host-base-dir", hostBaseDir,
    ]).payload;
    assert.ok(
      staleHealth.status === "stale_pid_cleared" || staleHealth.status === "stopped",
      `expected stale host-health status to be stale_pid_cleared or stopped, got ${staleHealth.status}`,
    );
    evidence.push({ name: "stale_health", payload: staleHealth });

    const staleStop = runCli([
      "factory", "host-stop",
      "--factory-root", factoryRoot,
      "--factory-id", factoryId,
      "--host-base-dir", hostBaseDir,
    ]).payload;
    assert.equal(staleStop.ok, true);
    assert.ok(
      staleStop.status === "stale_pid_cleared" || staleStop.status === "already_stopped",
      `expected stale host-stop status to be stale_pid_cleared or already_stopped, got ${staleStop.status}`,
    );
    evidence.push({ name: "stale_stop", payload: staleStop });

    assert.equal(existsSync(paths.pidFile), false, "stale pid file should be removed after cleanup evidence path");

    // Map prose evidence requirements -> structural assertions over collected CLI evidence.
    const requirementChecks = {
      "host lifecycle command evidence for start/restart/health paths": () => {
        const startEvidence = evidence.find((entry) => entry.name === "host_start")?.payload;
        const healthEvidence = evidence.find((entry) => entry.name === "host_health")?.payload;
        const restartEvidence = evidence.find((entry) => entry.name === "host_restart")?.payload;

        return Boolean(
          startEvidence
          && healthEvidence
          && restartEvidence
          && startEvidence.ok === true
          && /started|already_running/.test(String(startEvidence.status || ""))
          && Number(startEvidence.pid) > 0
          && String(startEvidence.log_dir || "").length > 0
          && String(startEvidence.runs_dir || "").length > 0
          && healthEvidence.ok === true
          && String(healthEvidence.status || "").length > 0
          && Number(healthEvidence.pid) > 0
          && restartEvidence.ok === true
          && restartEvidence.status === "restarted"
          && Number(restartEvidence.pid) > 0,
        );
      },
      "recovery sweep evidence proving stale ownership and dead-process cleanup": () => {
        const staleHealthEvidence = evidence.find((entry) => entry.name === "stale_health")?.payload;
        const staleStopEvidence = evidence.find((entry) => entry.name === "stale_stop")?.payload;

        return Boolean(
          staleHealthEvidence
          && staleStopEvidence
          && (staleHealthEvidence.status === "stopped" || staleHealthEvidence.status === "stale_pid_cleared")
          && (staleStopEvidence.status === "stale_pid_cleared" || staleStopEvidence.status === "already_stopped"),
        );
      },
    };

    for (const requirement of surface.evidence_requirements || []) {
      const matcher = requirementChecks[requirement];
      assert.equal(typeof matcher, "function", `No evidence matcher defined for requirement: ${requirement}`);
      assert.equal(
        matcher(),
        true,
        `Evidence mismatch for requirement '${requirement}'. Collected evidence: ${JSON.stringify(evidence, null, 2)}`,
      );
    }
  } finally {
    runCli([
      "factory", "host-stop",
      "--factory-root", factoryRoot,
      "--factory-id", factoryId,
      "--host-base-dir", hostBaseDir,
    ], { expectOk: false });

    rmSync(hostBaseDir, { recursive: true, force: true });
    rmSync(daemonRoot, { recursive: true, force: true });
  }
});
