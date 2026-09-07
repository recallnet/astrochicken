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

import { createRuntimeSignatureFixture } from "./host-runtime-signature.fixture.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");
const hostRuntimePath = join(repoRoot, "packages/factory-ops/src/host-runtime.ts");
const factoryRoot = join(repoRoot, "factories/mothership");

function makeTmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function withSanitizedTestEnv(env = process.env) {
  const sanitized = { ...env };
  delete sanitized.HATCH_FACTORY_MUTATION_CONTEXT_JSON;
  return sanitized;
}

function runOpsCli(args, { env = process.env, expectOk = true } = {}) {
  const run = spawnSync("node", [opsCliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: withSanitizedTestEnv(env),
  });
  if (expectOk) {
    assert.equal(run.status, 0, `stderr=${run.stderr}\nstdout=${run.stdout}`);
  }
  const stdout = String(run.stdout || "").trim();
  return {
    ...run,
    payload: stdout ? JSON.parse(stdout) : {},
  };
}

function runHostCli(args, { env = process.env, expectOk = true } = {}) {
  const run = spawnSync("node", [hostRuntimePath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: withSanitizedTestEnv(env),
  });
  if (expectOk) {
    assert.equal(run.status, 0, `stderr=${run.stderr}\nstdout=${run.stdout}`);
  }
  const stdout = String(run.stdout || "").trim();
  return {
    ...run,
    payload: stdout ? JSON.parse(stdout) : {},
  };
}

function writeFakeHatch(repoDir) {
  const binDir = join(repoDir, "node_modules/.bin");
  mkdirSync(binDir, { recursive: true });
  const hatchPath = join(binDir, "hatch");
  writeFileSync(hatchPath, `#!/usr/bin/env bash
set -eu
run_id="\${HATCH_TEST_RUN_ID:-run_cli_01}"
exit_code="\${HATCH_TEST_TICK_EXIT_CODE:-0}"
mkdir -p "$HATCH_RUNS_DIR/$run_id"
printf '{"context":{"tick_idle":false}}\n' > "$HATCH_RUNS_DIR/$run_id/state.json"
echo "Run: $run_id"
exit "$exit_code"
`);
  chmodSync(hatchPath, 0o755);
}

function writeRuntimeRegistry({ hostBaseDir, installationManifestPath, instanceId = "brainstorm" } = {}) {
  const registryPath = join(hostBaseDir, "factory-registry.json");
  writeFileSync(registryPath, `${JSON.stringify({
    schema: "hatch.factory.registry.v1",
    instances: [
      {
        instance_id: instanceId,
        kind_id: "brainstorm",
        target_repo: "example-org/example-notes",
        status: "active",
        assigned_host_id: "unassigned",
        installation_manifest_path: installationManifestPath,
        graphs: [
          {
            id: "factory_supervisor_tick",
            path: "graphs/factory_supervisor_tick.dot",
          },
        ],
        daemonStatus: { status: "stopped" },
        service_tier: "standard",
        scheduler_weight: 1,
        reserved_capacity: 0,
        upgrade_channel: "stable",
        allowed_runtime_version: "*",
        support_owner: "ops",
        feature_flags: {},
      },
    ],
  }, null, 2)}\n`);
  return registryPath;
}

test("host install-runtime/status/doctor create and validate a runtime manifest", () => {
  const hostBaseDir = makeTmpDir("host-runtime-cli-");
  const signatureFixture = createRuntimeSignatureFixture({
    workspaceDir: hostBaseDir,
    payloadRelativePath: "runtime/host-runtime.mjs",
  });
  try {
    const installed = runOpsCli([
      "host", "install-runtime",
      "--host-base-dir", hostBaseDir,
      "--host-id", "host_devrel_test_01",
      "--repo-root", repoRoot,
      "--runtime-public-key-path", signatureFixture.publicKeyPath,
      "--runtime-signature", signatureFixture.runtimeSignature,
      "--runtime-signature-key-id", signatureFixture.runtimeSignatureKeyId,
      "--runtime-signed-payload-path", signatureFixture.payloadPath,
    ]).payload;

    assert.equal(installed.ok, true);
    assert.equal(installed.status, "installed");
    assert.equal(installed.host_id, "host_devrel_test_01");
    assert.equal(typeof installed.runtime_version, "string");
    assert.ok(installed.runtime_version.length > 0);
    assert.equal(existsSync(installed.host_manifest_path), true);

    const manifest = JSON.parse(readFileSync(installed.host_manifest_path, "utf8"));
    assert.equal(manifest.host_id, "host_devrel_test_01");
    assert.equal(manifest.runtime_entrypoint.endsWith("packages/factory-ops/src/host-runtime.ts"), true);
    assert.equal(manifest.runtime_signature_status, "verified");
    assert.equal(manifest.runtime_signature_error, "");
    assert.equal(manifest.runtime_signature_key_id, signatureFixture.runtimeSignatureKeyId);

    const status = runOpsCli([
      "host", "status",
      "--host-base-dir", hostBaseDir,
    ]).payload;
    assert.equal(status.ok, true);
    assert.equal(status.status, "installed");
    assert.equal(status.host_id, "host_devrel_test_01");
    assert.equal(status.installation_count, 0);
    assert.equal(status.lease_summary.assigned_host_id, "");
    assert.equal(status.lease_summary.lease_owner, "");
    assert.equal(typeof status.host_queue_depth, "number");
    assert.equal(typeof status.host_capacity_pressure, "number");
    assert.equal(Array.isArray(status.wake_sources), true);
    assert.equal(status.runtime_signature_status, "verified");
    assert.equal(status.runtime_signature_error, "");

    const doctor = runOpsCli([
      "host", "doctor",
      "--host-base-dir", hostBaseDir,
      "--required-env", "HOST_RUNTIME_TEST_TOKEN",
    ], {
      env: {
        ...process.env,
        HOST_RUNTIME_TEST_TOKEN: "present",
      },
    }).payload;
    assert.equal(doctor.ok, true);
    assert.equal(doctor.status, "healthy");
    assert.equal(Array.isArray(doctor.checks), true);
    assert.equal(doctor.checks.some((entry) => entry.id === "required_env" && entry.ok === true), true);
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});

test("hatch-host run --once emits execution evidence and fails on non-zero tick exit", () => {
  const hostBaseDir = makeTmpDir("hatch-host-run-");
  const fakeRepoRoot = makeTmpDir("hatch-host-fake-repo-");
  const signatureFixture = createRuntimeSignatureFixture({
    workspaceDir: hostBaseDir,
    payloadRelativePath: "runtime/host-runtime.mjs",
  });
  try {
    mkdirSync(join(fakeRepoRoot, "graphs"), { recursive: true });
    writeFileSync(join(fakeRepoRoot, "graphs/factory_supervisor_tick.dot"), "digraph G { start -> done }\n");
    writeFakeHatch(fakeRepoRoot);

    runOpsCli([
      "host", "install-runtime",
      "--host-base-dir", hostBaseDir,
      "--host-id", "host_devrel_test_02",
      "--repo-root", fakeRepoRoot,
      "--runtime-public-key-path", signatureFixture.publicKeyPath,
      "--runtime-signature", signatureFixture.runtimeSignature,
      "--runtime-signature-key-id", signatureFixture.runtimeSignatureKeyId,
      "--runtime-signed-payload-path", signatureFixture.payloadPath,
    ]);

    const installation = runOpsCli([
      "factory", "host-install",
      "--factory-root", factoryRoot,
      "--factory-id", "example-notes",
      "--host-base-dir", hostBaseDir,
    ]).payload;
    assert.equal(existsSync(installation.installation_manifest_path), true);
    const installationManifest = JSON.parse(readFileSync(installation.installation_manifest_path, "utf8"));

    const installationDir = dirname(installation.installation_manifest_path);
    mkdirSync(installationDir, { recursive: true });
    writeFileSync(join(installationDir, "lease.json"), `${JSON.stringify({
      instance_id: installationManifest.instance_id,
      installation_id: installationManifest.installation_id,
      host_id: "host_devrel_test_02",
      lease_owner: "host_devrel_test_02:999:example-notes:managed_host_assignment",
      lease_acquired_at: "2026-03-13T00:00:00.000Z",
      lease_expires_at: "2099-03-13T00:10:00.000Z",
      lease_ttl_sec: 600,
      runtime_version: installationManifest.runtime_version,
    }, null, 2)}\n`);

    const registryPath = writeRuntimeRegistry({
      hostBaseDir,
      installationManifestPath: installation.installation_manifest_path,
      instanceId: installationManifest.instance_id,
    });

    const onceEnv = {
      ...process.env,
      HATCH_HOST_RECONCILE_INTERVAL_SEC: "1",
      HATCH_FACTORY_REGISTRY_PATH: registryPath,
      HATCH_FACTORY_REGISTRY_CWD: hostBaseDir,
      HATCH_TEST_RUN_ID: "run_cli_01",
    };

    const once = runHostCli([
      "run",
      "--host-base-dir", hostBaseDir,
      "--repo-root", fakeRepoRoot,
      "--once",
      "--runtime-public-key-path", signatureFixture.publicKeyPath,
      "--runtime-signature", signatureFixture.runtimeSignature,
      "--runtime-signature-key-id", signatureFixture.runtimeSignatureKeyId,
      "--runtime-signed-payload-path", signatureFixture.payloadPath,
    ], {
      env: onceEnv,
    }).payload;
    assert.equal(once.ok, true);
    assert.equal(once.status, "ok");
    assert.equal(once.mode, "once");
    assert.equal(once.installation_count, 1);
    assert.equal(Array.isArray(once.execution_results), true);
    assert.equal(once.execution_results.length, 1);
    assert.equal(once.execution_results[0].run_id, "run_cli_01");
    assert.equal(typeof once.execution_results[0].tick_id, "string");
    assert.equal(once.execution_results[0].tick_id.length > 0, true);
    assert.equal(once.execution_results[0].exit_code, 0);

    const failedRun = runHostCli([
      "run",
      "--host-base-dir", hostBaseDir,
      "--repo-root", fakeRepoRoot,
      "--once",
      "--runtime-public-key-path", signatureFixture.publicKeyPath,
      "--runtime-signature", signatureFixture.runtimeSignature,
      "--runtime-signature-key-id", signatureFixture.runtimeSignatureKeyId,
      "--runtime-signed-payload-path", signatureFixture.payloadPath,
    ], {
      env: {
        ...onceEnv,
        HATCH_TEST_TICK_EXIT_CODE: "7",
        HATCH_TEST_RUN_ID: "run_cli_02",
      },
      expectOk: false,
    });
    assert.equal(failedRun.status, 1);
    assert.equal(failedRun.payload.ok, false);
    assert.equal(failedRun.payload.status, "host_runtime_once_failed");
    assert.equal(Array.isArray(failedRun.payload.execution_results), true);
    assert.equal(failedRun.payload.execution_results.length, 1);
    assert.equal(failedRun.payload.execution_results[0].run_id, "run_cli_02");
    assert.equal(failedRun.payload.execution_results[0].exit_code, 7);
  } finally {
    runOpsCli([
      "factory", "host-stop",
      "--factory-root", factoryRoot,
      "--factory-id", "example-notes",
      "--host-base-dir", hostBaseDir,
    ], { expectOk: false });
    rmSync(hostBaseDir, { recursive: true, force: true });
    rmSync(fakeRepoRoot, { recursive: true, force: true });
  }
});

test("host install-runtime rejects invalid runtime signature payload and hatch-host run rejects tampered manifest evidence", () => {
  const hostBaseDir = makeTmpDir("host-runtime-cli-signature-invalid-");
  const signatureFixture = createRuntimeSignatureFixture({
    workspaceDir: hostBaseDir,
    payloadRelativePath: "runtime/signed-entrypoint.mjs",
  });

  try {
    writeFileSync(signatureFixture.payloadPath, "export const runtime = 'tampered';\n", "utf8");

    const invalidInstall = runOpsCli([
      "host", "install-runtime",
      "--host-base-dir", hostBaseDir,
      "--host-id", "host_devrel_test_03",
      "--repo-root", repoRoot,
      "--runtime-public-key-path", signatureFixture.publicKeyPath,
      "--runtime-signature", signatureFixture.runtimeSignature,
      "--runtime-signature-key-id", signatureFixture.runtimeSignatureKeyId,
      "--runtime-signed-payload-path", signatureFixture.payloadPath,
    ], { expectOk: false });

    assert.equal(invalidInstall.status, 1);
    assert.equal(invalidInstall.payload.ok, false);
    assert.equal(invalidInstall.payload.error_code, "host_runtime_signature_invalid");

    const validFixture = createRuntimeSignatureFixture({
      workspaceDir: hostBaseDir,
      payloadRelativePath: "runtime/verified-entrypoint.mjs",
    });

    const installed = runOpsCli([
      "host", "install-runtime",
      "--host-base-dir", hostBaseDir,
      "--host-id", "host_devrel_test_03",
      "--repo-root", repoRoot,
      "--runtime-public-key-path", validFixture.publicKeyPath,
      "--runtime-signature", validFixture.runtimeSignature,
      "--runtime-signature-key-id", validFixture.runtimeSignatureKeyId,
      "--runtime-signed-payload-path", validFixture.payloadPath,
    ]).payload;

    assert.equal(installed.ok, true);

    const manifest = JSON.parse(readFileSync(installed.host_manifest_path, "utf8"));
    manifest.runtime_signature_status = "invalid";
    manifest.runtime_signature_error = "host_runtime_signature_invalid";
    writeFileSync(installed.host_manifest_path, `${JSON.stringify(manifest, null, 2)}\n`);

    const run = runHostCli([
      "run",
      "--host-base-dir", hostBaseDir,
      "--repo-root", repoRoot,
      "--once",
    ], { expectOk: false });
    assert.equal(run.status, 1);
    assert.equal(run.payload.ok, false);
    assert.equal(run.payload.error_code, "host_runtime_signature_invalid");
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});
