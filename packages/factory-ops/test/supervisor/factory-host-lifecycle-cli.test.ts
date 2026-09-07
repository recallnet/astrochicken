import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");
const factoryRoot = join(repoRoot, "factories/mothership");
const brainstormFactoryRoot = join(repoRoot, "factories/brainstorm");
const exampleScannerFactoryRoot = join(repoRoot, "factories/example-scanner");

function makeTmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeDaemonStub(rootDir) {
  const scriptPath = join(rootDir, "daemon_stub.sh");
  writeFileSync(scriptPath, `#!/usr/bin/env bash
set -eu
mkdir -p "$(dirname "$FACTORY_DAEMON_PID_FILE")" "${"$"}{FACTORY_DAEMON_LOG_DIR:-/tmp}"
echo $$ > "$FACTORY_DAEMON_PID_FILE"
echo "started factory=${"$"}{HATCH_FACTORY_ID:-unknown} argv1=${"$"}{1:-missing}" >> "${"$"}{FACTORY_DAEMON_LOG_DIR:-/tmp}/daemon.log"
trap 'rm -f "$FACTORY_DAEMON_PID_FILE"; exit 0' TERM INT
while true; do sleep 1; done
`);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function writeLeaseMismatch(installationManifestPath, hostId = "other-host") {
  const manifest = JSON.parse(readFileSync(installationManifestPath, "utf8"));
  const leasePath = join(dirname(installationManifestPath), "lease.json");
  const acquiredAt = new Date(Date.now() - 5_000).toISOString();
  const expiresAt = new Date(Date.now() + 600_000).toISOString();
  writeFileSync(leasePath, `${JSON.stringify({
    instance_id: manifest.instance_id,
    installation_id: manifest.installation_id,
    host_id: hostId,
    lease_owner: "test_lease_owner",
    lease_acquired_at: acquiredAt,
    lease_expires_at: expiresAt,
    lease_ttl_sec: 600,
    runtime_version: manifest.runtime_version || "0.0.0",
  }, null, 2)}\n`);
  return leasePath;
}

function writeRegistry(root, rows = []) {
  const registryPath = join(root, "factory-registry.json");
  writeFileSync(registryPath, `${JSON.stringify({
    schema: "hatch.factory.registry.v1",
    instances: rows,
  }, null, 2)}\n`);
  return registryPath;
}

function baseRegistryRow(instanceId = "alpha", allowedRuntimeVersion = "*") {
  return {
    instance_id: instanceId,
    kind_id: instanceId,
    target_repo: "recallnet/astrochicken",
    status: "active",
    assigned_host_id: "unassigned",
    installation_manifest_path: "",
    graphs: [],
    daemonStatus: { status: "stopped" },
    service_tier: "standard",
    scheduler_weight: 1,
    reserved_capacity: 0,
    upgrade_channel: "stable",
    allowed_runtime_version: allowedRuntimeVersion,
    support_owner: "ops",
    feature_flags: {},
  };
}

function withSanitizedTestEnv(env = process.env) {
  const sanitized = { ...env };
  delete sanitized.HATCH_FACTORY_MUTATION_CONTEXT_JSON;
  return sanitized;
}

function runCli(args, { expectOk = true, env = {} } = {}) {
  const run = spawnSync("node", [opsCliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: withSanitizedTestEnv({
      ...process.env,
      ...env,
    }),
  });
  if (expectOk) {
    assert.equal(run.status, 0, `stderr=${run.stderr}\nstdout=${run.stdout}`);
  }
  const stdout = String(run.stdout || "").trim();
  const payload = stdout ? JSON.parse(stdout) : {};
  return { ...run, payload };
}

test("factory host-install returns stable JSON and isolates alpha/beta host paths", () => {
  const hostBaseDir = makeTmpDir("factory-host-cli-install-");
  const sharedRunsRoot = join(hostBaseDir, "shared-runs-root");
  try {
    const alpha = runCli([
      "factory", "host-install",
      "--factory-root", factoryRoot,
      "--factory-id", "alpha",
      "--host-base-dir", hostBaseDir,
      "--runs-dir", sharedRunsRoot,
    ]).payload;

    const beta = runCli([
      "factory", "host-install",
      "--factory-root", factoryRoot,
      "--factory-id", "beta",
      "--host-base-dir", hostBaseDir,
      "--runs-dir", sharedRunsRoot,
    ]).payload;

    for (const out of [alpha, beta]) {
      assert.equal(typeof out.ok, "boolean");
      assert.equal(typeof out.factory_id, "string");
      assert.equal(typeof out.status, "string");
      assert.equal(Object.prototype.hasOwnProperty.call(out, "error_code"), true);
      assert.equal(typeof out.log_dir, "string");
      assert.equal(typeof out.runs_dir, "string");
      assert.equal(typeof out.pid_file, "string");
      assert.equal(typeof out.instance_id, "string");
      assert.equal(typeof out.installation_manifest_path, "string");
      assert.equal(Object.prototype.hasOwnProperty.call(out, "version"), true);
      assert.equal(existsSync(out.log_dir), true);
      assert.equal(existsSync(out.runs_dir), true);
      assert.equal(existsSync(out.installation_manifest_path), true);
      const manifest = JSON.parse(readFileSync(out.installation_manifest_path, "utf8"));
      assert.equal(manifest.instance_id, out.instance_id);
      assert.equal(manifest.workspace_mode, "api_only");
      assert.equal(manifest.log_dir, out.log_dir);
    }

    assert.notEqual(alpha.log_dir, beta.log_dir);
    assert.notEqual(alpha.runs_dir, beta.runs_dir);
    assert.notEqual(alpha.pid_file, beta.pid_file);
    assert.match(alpha.log_dir, /alpha/);
    assert.match(beta.log_dir, /beta/);
    assert.match(alpha.runs_dir, /shared-runs-root[\/\\]alpha$/);
    assert.match(beta.runs_dir, /shared-runs-root[\/\\]beta$/);
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});

test("factory host-install preserves checkout install contract for Example Scanner", () => {
  const hostBaseDir = makeTmpDir("factory-host-cli-example-scanner-install-");
  try {
    const out = runCli([
      "factory", "host-install",
      "--factory-root", exampleScannerFactoryRoot,
      "--factory-id", "example-scanner",
      "--host-base-dir", hostBaseDir,
    ]).payload;

    assert.equal(out.ok, true);
    const manifest = JSON.parse(readFileSync(out.installation_manifest_path, "utf8"));
    assert.equal(manifest.instance_id, "example-scanner");
    assert.equal(manifest.workspace_mode, "checkout");
    assert.equal(manifest.work_dir, "/path/to/example-scanner");
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});

test("factory host-install rejects ambiguous factory-id substring path overrides", () => {
  const hostBaseDir = makeTmpDir("factory-host-cli-ambiguous-");
  try {
    const ambiguousRunsRoot = join(hostBaseDir, "alpha-beta-runs");
    const run = runCli([
      "factory", "host-install",
      "--factory-root", factoryRoot,
      "--factory-id", "alpha",
      "--host-base-dir", hostBaseDir,
      "--runs-dir", ambiguousRunsRoot,
    ], { expectOk: false });

    assert.equal(run.status, 2);
    assert.equal(run.payload.ok, false);
    assert.equal(run.payload.error_code, "runs_dir_contains_ambiguous_factory_substring");
    assert.equal(run.payload.status, "invalid_host_configuration");
    assert.match(String(run.stderr || ""), /runs_dir_contains_ambiguous_factory_substring/);
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});

test("factory host-start exits 1 with runtime_incompatible when runtime policy blocks start", () => {
  const hostBaseDir = makeTmpDir("factory-host-cli-runtime-incompatible-");
  const daemonRoot = makeTmpDir("factory-host-cli-runtime-incompatible-daemon-");
  const daemonScript = writeDaemonStub(daemonRoot);

  try {
    const install = runCli([
      "factory", "host-install",
      "--factory-root", factoryRoot,
      "--factory-id", "alpha",
      "--host-base-dir", hostBaseDir,
    ]).payload;

    const registryPath = writeRegistry(hostBaseDir, [
      baseRegistryRow("alpha", ">=9.9.9"),
      baseRegistryRow("mothership", ">=9.9.9"),
    ]);

    const start = runCli([
      "factory", "host-start",
      "--factory-root", factoryRoot,
      "--factory-id", "alpha",
      "--host-base-dir", hostBaseDir,
      "--daemon-script", daemonScript,
    ], {
      expectOk: false,
      env: {
        HATCH_FACTORY_REGISTRY_PATH: registryPath,
        HATCH_INSTANCE_ID: install.instance_id,
      },
    });

    assert.equal(start.status, 1);
    assert.equal(start.payload.ok, false);
    assert.equal(start.payload.status, "runtime_incompatible");
    assert.equal(start.payload.error_code, "runtime_incompatible");
  } finally {
    runCli([
      "factory", "host-stop",
      "--factory-root", factoryRoot,
      "--factory-id", "alpha",
      "--host-base-dir", hostBaseDir,
    ], { expectOk: false });
    rmSync(hostBaseDir, { recursive: true, force: true });
    rmSync(daemonRoot, { recursive: true, force: true });
  }
});

test("factory host-start/health/logs/version/stop are scoped to requested factory id", () => {
  const hostBaseDir = makeTmpDir("factory-host-cli-start-");
  const daemonRoot = makeTmpDir("factory-host-cli-daemon-");
  const daemonScript = writeDaemonStub(daemonRoot);

  try {
    runCli([
      "factory", "host-install",
      "--factory-root", factoryRoot,
      "--factory-id", "alpha",
      "--host-base-dir", hostBaseDir,
    ]);

    runCli([
      "factory", "host-install",
      "--factory-root", factoryRoot,
      "--factory-id", "beta",
      "--host-base-dir", hostBaseDir,
    ]);

    const startedAlpha = runCli([
      "factory", "host-start",
      "--factory-root", factoryRoot,
      "--factory-id", "alpha",
      "--host-base-dir", hostBaseDir,
      "--daemon-script", daemonScript,
    ]).payload;
    assert.equal(startedAlpha.ok, true);
    assert.equal(startedAlpha.status, "started");
    assert.equal(startedAlpha.error_code, "");

    const duplicate = runCli([
      "factory", "host-start",
      "--factory-root", factoryRoot,
      "--factory-id", "alpha",
      "--host-base-dir", hostBaseDir,
      "--daemon-script", daemonScript,
    ], { expectOk: false });
    assert.equal(duplicate.status, 1);
    assert.equal(duplicate.payload.ok, false);
    assert.equal(duplicate.payload.status, "already_running");
    assert.equal(duplicate.payload.error_code, "factory_host_already_running");

    const alphaHealth = runCli([
      "factory", "host-health",
      "--factory-root", factoryRoot,
      "--factory-id", "alpha",
      "--host-base-dir", hostBaseDir,
    ]).payload;
    assert.equal(alphaHealth.ok, true);
    assert.equal(alphaHealth.status, "running");
    assert.equal(alphaHealth.running, true);

    const betaHealth = runCli([
      "factory", "host-health",
      "--factory-root", factoryRoot,
      "--factory-id", "beta",
      "--host-base-dir", hostBaseDir,
    ]).payload;
    assert.equal(betaHealth.status, "stopped");

    const alphaLogs = runCli([
      "factory", "host-logs",
      "--factory-root", factoryRoot,
      "--factory-id", "alpha",
      "--host-base-dir", hostBaseDir,
      "--tail", "5",
      "--since-duration", "1h",
    ]).payload;
    assert.equal(alphaLogs.ok, true);
    assert.ok(Array.isArray(alphaLogs.lines));
    assert.ok(alphaLogs.lines.some((line) => line.includes("started factory=alpha argv1=alpha")));

    const alphaVersion = runCli([
      "factory", "host-version",
      "--factory-root", factoryRoot,
      "--factory-id", "alpha",
      "--host-base-dir", hostBaseDir,
    ]).payload;
    assert.equal(alphaVersion.ok, true);
    assert.equal(typeof alphaVersion.version, "string");
    assert.ok(alphaVersion.version.length > 0);

    const stoppedAlpha = runCli([
      "factory", "host-stop",
      "--factory-root", factoryRoot,
      "--factory-id", "alpha",
      "--host-base-dir", hostBaseDir,
    ]).payload;
    assert.equal(stoppedAlpha.ok, true);
    assert.match(stoppedAlpha.status, /stopped|force_killed/);

    const stoppedHealth = runCli([
      "factory", "host-health",
      "--factory-root", factoryRoot,
      "--factory-id", "alpha",
      "--host-base-dir", hostBaseDir,
    ]).payload;
    assert.equal(stoppedHealth.status, "stopped");

    const alphaPidFile = startedAlpha.pid_file;
    const betaPidFile = betaHealth.pid_file;
    assert.notEqual(alphaPidFile, betaPidFile);
  } finally {
    runCli([
      "factory", "host-stop",
      "--factory-root", factoryRoot,
      "--factory-id", "alpha",
      "--host-base-dir", hostBaseDir,
    ], { expectOk: false });
    runCli([
      "factory", "host-stop",
      "--factory-root", factoryRoot,
      "--factory-id", "beta",
      "--host-base-dir", hostBaseDir,
    ], { expectOk: false });

    rmSync(hostBaseDir, { recursive: true, force: true });
    rmSync(daemonRoot, { recursive: true, force: true });
  }
});

test("brainstorm host recovery covers pause/resume and blocker cleanup", () => {
  const hostBaseDir = makeTmpDir("factory-host-cli-brainstorm-recovery-");
  const daemonRoot = makeTmpDir("factory-host-cli-brainstorm-daemon-");
  const daemonScript = writeDaemonStub(daemonRoot);

  try {
    const install = runCli([
      "factory", "host-install",
      "--factory-root", brainstormFactoryRoot,
      "--factory-id", "brainstorm",
      "--host-base-dir", hostBaseDir,
    ]).payload;
    assert.equal(install.ok, true);
    assert.equal(install.status, "installed");
    assert.equal(install.instance_id, "brainstorm");

    const started = runCli([
      "factory", "host-start",
      "--factory-root", brainstormFactoryRoot,
      "--factory-id", "brainstorm",
      "--host-base-dir", hostBaseDir,
      "--daemon-script", daemonScript,
    ]).payload;
    assert.equal(started.ok, true);
    assert.equal(started.status, "started");
    assert.equal(started.message, "factory_host_started");

    const stopped = runCli([
      "factory", "host-stop",
      "--factory-root", brainstormFactoryRoot,
      "--factory-id", "brainstorm",
      "--host-base-dir", hostBaseDir,
    ]).payload;
    assert.equal(stopped.ok, true);
    assert.match(stopped.status, /stopped|force_killed/);

    const staleRunDir = join(install.runs_dir, "stale-run");
    mkdirSync(staleRunDir, { recursive: true });
    writeFileSync(join(staleRunDir, "state.json"), "{}\n");
    writeFileSync(install.pid_file, "999999\n");

    const recoverySweep = runCli([
      "factory", "recovery-sweep",
      "--runs-dir", install.runs_dir,
      "--stale-minutes", "20",
      "--apply", "true",
    ]).payload;
    assert.equal(recoverySweep.ok, true);
    assert.equal(recoverySweep.schema_version, "runtime_recovery_sweep/v1");
    assert.equal(recoverySweep.apply, true);
    assert.ok(recoverySweep.applied);

    const resumed = runCli([
      "factory", "host-start",
      "--factory-root", brainstormFactoryRoot,
      "--factory-id", "brainstorm",
      "--host-base-dir", hostBaseDir,
      "--daemon-script", daemonScript,
    ]).payload;
    assert.equal(resumed.ok, true);
    assert.equal(resumed.status, "started");
    assert.equal(resumed.message, "factory_host_started");

    const runningHealth = runCli([
      "factory", "host-health",
      "--factory-root", brainstormFactoryRoot,
      "--factory-id", "brainstorm",
      "--host-base-dir", hostBaseDir,
    ]).payload;
    assert.equal(runningHealth.ok, true);
    assert.equal(runningHealth.status, "running");
    assert.equal(runningHealth.running, true);

    runCli([
      "factory", "host-stop",
      "--factory-root", brainstormFactoryRoot,
      "--factory-id", "brainstorm",
      "--host-base-dir", hostBaseDir,
    ]);

    const leasePath = writeLeaseMismatch(install.installation_manifest_path, "host-other");

    const blockedStart = runCli([
      "factory", "host-start",
      "--factory-root", brainstormFactoryRoot,
      "--factory-id", "brainstorm",
      "--host-base-dir", hostBaseDir,
      "--daemon-script", daemonScript,
    ], { expectOk: false });
    assert.equal(blockedStart.status, 1);
    assert.equal(blockedStart.payload.ok, false);
    assert.equal(blockedStart.payload.status, "lease_mismatch");
    assert.equal(blockedStart.payload.error_code, "ambiguous_host_assignment");

    const blockedHealth = runCli([
      "factory", "host-health",
      "--factory-root", brainstormFactoryRoot,
      "--factory-id", "brainstorm",
      "--host-base-dir", hostBaseDir,
    ], { expectOk: false });
    assert.equal(blockedHealth.status, 1);
    assert.equal(blockedHealth.payload.status, "lease_mismatch");

    rmSync(leasePath, { force: true });

    const restarted = runCli([
      "factory", "host-start",
      "--factory-root", brainstormFactoryRoot,
      "--factory-id", "brainstorm",
      "--host-base-dir", hostBaseDir,
      "--daemon-script", daemonScript,
    ]).payload;
    assert.equal(restarted.ok, true);
    assert.equal(restarted.status, "started");

    const healedHealth = runCli([
      "factory", "host-health",
      "--factory-root", brainstormFactoryRoot,
      "--factory-id", "brainstorm",
      "--host-base-dir", hostBaseDir,
    ]).payload;
    assert.equal(healedHealth.ok, true);
    assert.equal(healedHealth.status, "running");
    assert.equal(healedHealth.running, true);

    const logs = runCli([
      "factory", "host-logs",
      "--factory-root", brainstormFactoryRoot,
      "--factory-id", "brainstorm",
      "--host-base-dir", hostBaseDir,
      "--tail", "20",
      "--since-duration", "1h",
    ]).payload;
    assert.equal(logs.ok, true);
    assert.ok(logs.lines.some((line) => line.includes("started factory=brainstorm argv1=brainstorm")));
  } finally {
    runCli([
      "factory", "host-stop",
      "--factory-root", brainstormFactoryRoot,
      "--factory-id", "brainstorm",
      "--host-base-dir", hostBaseDir,
    ], { expectOk: false });

    rmSync(hostBaseDir, { recursive: true, force: true });
    rmSync(daemonRoot, { recursive: true, force: true });
  }
});
