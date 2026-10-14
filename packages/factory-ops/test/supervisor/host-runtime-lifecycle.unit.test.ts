import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  doctorHostRuntime,
  getHostRuntimeStatus,
  installHostRuntime,
  listHostInstallations,
  removeHostRuntime,
  resolveHostRuntimePaths,
  resolveHostRuntimeVersion,
  runHostRuntime,
} from "../../src/commands/host-runtime-lifecycle.ts";
import { createRuntimeSignatureFixture } from "./host-runtime-signature.fixture.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");

function makeTmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeApiOnlyInstallation(installationDir, { work_dir = "", ...identity }) {
  writeFileSync(join(installationDir, "installation.json"), `${JSON.stringify({
    ...identity,
    workspace_mode: "api_only",
    work_dir,
    log_dir: join(installationDir, "logs"),
    artifact_dir: join(installationDir, "artifacts"),
  }, null, 2)}\n`);
}

function signatureInstallOptions(fixture) {
  return {
    runtimeSignature: fixture.runtimeSignature,
    runtimeSignatureKeyId: fixture.runtimeSignatureKeyId,
    trustPublicKeyPath: fixture.publicKeyPath,
    signedPayloadPath: fixture.payloadPath,
  };
}

function useRegistryEnv(registryPath, hostBaseDir) {
  const previous = {
    HATCH_FACTORY_REGISTRY_PATH: process.env.HATCH_FACTORY_REGISTRY_PATH,
    HATCH_FACTORY_REGISTRY_CWD: process.env.HATCH_FACTORY_REGISTRY_CWD,
  };
  process.env.HATCH_FACTORY_REGISTRY_PATH = registryPath;
  process.env.HATCH_FACTORY_REGISTRY_CWD = hostBaseDir;
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function writeRegistry(root, rows = []) {
  const registryPath = join(root, "factory-registry.json");
  writeFileSync(registryPath, `${JSON.stringify({
    schema: "hatch.factory.registry.v1",
    instances: rows,
  }, null, 2)}\n`);
  return registryPath;
}

function baseRegistryRow(overrides = {}) {
  return {
    instance_id: "fac_unit_01",
    kind_id: "mothership",
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
    allowed_runtime_version: "*",
    support_owner: "ops",
    feature_flags: {},
    ...overrides,
  };
}

test("runHostRuntime blocks incompatible runtime before writing daemon logs", async () => {
  const hostBaseDir = makeTmpDir("host-runtime-lifecycle-incompatible-");
  const paths = resolveHostRuntimePaths({ hostBaseDir, repoRoot });
  const signatureFixture = createRuntimeSignatureFixture({
    workspaceDir: hostBaseDir,
    payloadRelativePath: "runtime/host-runtime.mjs",
  });

  try {
    installHostRuntime({
      paths,
      hostId: "host_unit_test_01",
      repoRoot,
      ...signatureInstallOptions(signatureFixture),
    });

    const installationDir = join(hostBaseDir, "example-notes");
    mkdirSync(installationDir, { recursive: true });
    writeApiOnlyInstallation(installationDir, {
      installation_id: "inst_unit_01",
      instance_id: "fac_unit_01",
      host_id: "host_unit_test_01",
      runtime_version: "1.0.0",
    });

    const registryPath = writeRegistry(hostBaseDir, [
      baseRegistryRow({
        installation_manifest_path: join(installationDir, "installation.json"),
        allowed_runtime_version: ">=9.9.9",
      }),
    ]);

    const restoreRegistryEnv = useRegistryEnv(registryPath, hostBaseDir);

    try {
      const out = await runHostRuntime({ paths, once: true });
      assert.equal(out.ok, false);
      assert.equal(out.status, "runtime_incompatible");
      assert.equal(out.errorCode, "runtime_incompatible");
      assert.equal(existsSync(join(paths.runtimeLogDir, "hatch-host.log")), false);
    } finally {
      restoreRegistryEnv();
    }
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});

test("host runtime lifecycle exports create, inspect, and remove runtime state", async () => {
  const hostBaseDir = makeTmpDir("host-runtime-lifecycle-");
  const paths = resolveHostRuntimePaths({ hostBaseDir, repoRoot });
  const signatureFixture = createRuntimeSignatureFixture({
    workspaceDir: hostBaseDir,
    payloadRelativePath: "runtime/host-runtime.mjs",
  });
  assert.equal(paths.baseDir, hostBaseDir);
  assert.ok(resolveHostRuntimeVersion().length > 0);

  try {
    const install = installHostRuntime({
      paths,
      hostId: "host_unit_test_01",
      repoRoot,
      ...signatureInstallOptions(signatureFixture),
    });
    assert.equal(install.ok, true);
    assert.equal(install.status, "installed");
    assert.equal(existsSync(paths.hostManifestPath), true);

    const runtimeManifest = JSON.parse(readFileSync(paths.hostManifestPath, "utf8"));
    assert.equal(runtimeManifest.host_id, "host_unit_test_01");
    assert.equal(runtimeManifest.runtime_entrypoint.endsWith("packages/factory-ops/src/host-runtime.ts"), true);
    assert.equal(runtimeManifest.runtime_signature_status, "verified");
    assert.equal(runtimeManifest.runtime_signature_error, "");
    assert.equal(typeof runtimeManifest.runtime_signature_hash, "string");
    assert.equal(runtimeManifest.runtime_signature_key_id, signatureFixture.runtimeSignatureKeyId);

    const installationDir = join(hostBaseDir, "example-notes");
    mkdirSync(installationDir, { recursive: true });
    writeApiOnlyInstallation(installationDir, {
      installation_id: "inst_unit_01",
      instance_id: "fac_unit_01",
      host_id: "host_unit_test_01",
      runtime_version: runtimeManifest.runtime_version,
    });

    const listed = listHostInstallations({ paths });
    assert.equal(listed.installations.length, 1);
    assert.equal(listed.installations[0].instance_id, "fac_unit_01");
    assert.equal(listed.installations[0].lease, undefined);
    assert.equal(listed.diagnostics.some((entry) => entry.includes("missing_lease_record:")), true);

    const status = getHostRuntimeStatus({ paths });
    assert.equal(status.ok, true);
    assert.equal(status.installationCount, 1);
    assert.equal(status.installations[0].installation_id, "inst_unit_01");
    assert.equal(status.installations[0].lease, undefined);
    assert.equal(status.installations[0].selection_reason, "");
    assert.equal(typeof status.installations[0].effective_priority, "number");
    assert.equal(typeof status.installations[0].age_bonus, "number");
    assert.equal(status.installations[0].capacity_reject_reason, "");
    assert.equal(status.leaseSummary.assigned_host_id, "");
    assert.equal(typeof status.host_queue_depth, "number");
    assert.equal(typeof status.host_capacity_pressure, "number");
    assert.equal(Array.isArray(status.wake_sources), true);
    assert.equal(status.runtime_signature_status, "verified");
    assert.equal(status.runtime_signature_error, "");

    const leasePath = join(installationDir, "lease.json");
    writeFileSync(leasePath, `${JSON.stringify({
      instance_id: "fac_unit_01",
      installation_id: "inst_unit_01",
      host_id: "host_unit_test_01",
      lease_owner: "host_unit_test_01:123:fac_unit_01:managed_host_assignment",
      lease_acquired_at: "2026-03-12T00:00:00.000Z",
      lease_expires_at: "2099-03-12T00:10:00.000Z",
      lease_ttl_sec: 600,
      runtime_version: runtimeManifest.runtime_version,
    }, null, 2)}\n`);

    const listedWithLease = listHostInstallations({ paths });
    assert.equal(listedWithLease.installations[0].lease.instance_id, "fac_unit_01");
    assert.equal(listedWithLease.installations[0].lease.installation_id, "inst_unit_01");
    assert.equal(listedWithLease.installations[0].lease.host_id, "host_unit_test_01");
    assert.equal(listedWithLease.installations[0].lease.lease_ttl_sec, 600);

    const statusWithLease = getHostRuntimeStatus({ paths });
    assert.equal(statusWithLease.installations[0].lease.lease_owner, "host_unit_test_01:123:fac_unit_01:managed_host_assignment");
    assert.equal(statusWithLease.leaseSummary.assigned_host_id, "host_unit_test_01");
    assert.equal(statusWithLease.leaseSummary.lease_owner, "host_unit_test_01:123:fac_unit_01:managed_host_assignment");
    assert.equal(statusWithLease.leaseSummary.lease_ttl_sec, 600);

    const doctor = doctorHostRuntime({
      paths,
      requiredEnv: ["HOST_RUNTIME_UNIT_TOKEN"],
    });
    assert.equal(doctor.ok, false);
    assert.equal(doctor.status, "unhealthy");
    assert.equal(doctor.checks.some((check) => check.id === "required_env" && check.ok === false), true);

    const healthyDoctor = doctorHostRuntime({
      paths,
      requiredEnv: [],
    });
    assert.equal(healthyDoctor.ok, true);

    const registryPath = writeRegistry(hostBaseDir, [
      baseRegistryRow({
        installation_manifest_path: join(installationDir, "installation.json"),
        kind_id: "brainstorm",
        target_repo: "example-org/example-notes",
        graphs: [{ id: "factory_supervisor_tick", path: "docs/contracts/workflow-ir/brainstorm/factory_supervisor_tick.dot" }],
      }),
    ]);

    const restoreRegistryEnv = useRegistryEnv(registryPath, hostBaseDir);

    const run = await runHostRuntime({
      paths,
      once: true,
      runTickFn: async () => ({
        runId: "run_unit_01",
        tickId: "tick_unit_01",
        exitCode: 0,
        tickIdle: false,
        durationMs: 22,
        tickLogPath: join(hostBaseDir, "tick-unit.log"),
      }),
    });

    restoreRegistryEnv();

    assert.equal(run.ok, true);
    assert.equal(run.mode, "once");
    assert.equal(run.installationCount, 1);
    assert.equal(existsSync(run.logFile), true);
    assert.equal(Array.isArray(run.executionResults), true);
    assert.equal(run.executionResults.length, 1);
    assert.equal(run.executionResults[0].run_id, "run_unit_01");
    assert.equal(run.executionResults[0].tick_id, "tick_unit_01");
    assert.equal(run.executionResults[0].exit_code, 0);
    assert.equal(run.executionResults[0].tick_idle, false);
    assert.equal(run.installations[0].last_run_id, "run_unit_01");
    assert.equal(run.installations[0].last_tick_id, "tick_unit_01");
    assert.equal(run.installations[0].last_exit_code, 0);
    assert.equal(run.installations[0].last_tick_idle, false);

    const removed = removeHostRuntime({ paths, force: true });
    assert.equal(removed.ok, true);
    assert.equal(removed.installationCount, 1);
    assert.equal(existsSync(paths.hostManifestPath), false);
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});

test("runHostRuntime repairs expired host leases and refreshes host registry rows from canonical registry before scheduling", async () => {
  const hostBaseDir = makeTmpDir("host-runtime-repair-");
  const repoRootOverride = makeTmpDir("host-runtime-repair-repo-");
  const paths = resolveHostRuntimePaths({ hostBaseDir, repoRoot: repoRootOverride });
  const signatureFixture = createRuntimeSignatureFixture({
    workspaceDir: hostBaseDir,
    payloadRelativePath: "runtime/host-runtime.mjs",
  });

  try {
    const install = installHostRuntime({
      paths,
      hostId: "host_unit_test_repair",
      repoRoot: repoRootOverride,
      ...signatureInstallOptions(signatureFixture),
    });

    const installationDir = join(hostBaseDir, "example-trading");
    mkdirSync(installationDir, { recursive: true });
    const installationManifestPath = join(installationDir, "installation.json");
    writeApiOnlyInstallation(installationDir, {
      installation_id: "inst_example_trading_devrel",
      instance_id: "example-trading",
      host_id: "host_unit_test_repair",
      work_dir: null,
      runtime_version: install.runtimeVersion,
    });
    writeFileSync(join(installationDir, "lease.json"), `${JSON.stringify({
      instance_id: "example-trading",
      installation_id: "inst_example_trading_devrel",
      host_id: "host_unit_test_repair",
      lease_owner: "host_unit_test_repair:123:example-trading:managed_host_assignment",
      lease_acquired_at: "2026-03-16T00:00:00.000Z",
      lease_expires_at: "2026-03-16T00:10:00.000Z",
      lease_ttl_sec: 600,
      runtime_version: install.runtimeVersion,
    }, null, 2)}\n`);

    const canonicalRegistryPath = join(repoRootOverride, "factory-registry.json");
    writeFileSync(canonicalRegistryPath, `${JSON.stringify({
      schema: "hatch.factory.registry.v1",
      instances: [
        baseRegistryRow({
          instance_id: "example-trading",
          kind_id: "example-trading",
          target_repo: "example-org/example-trading",
          control_plane_repo: "recallnet/astrochicken",
          installation_manifest_path: ".hatch/hosts/example-trading/installation.json",
          graphs: [
            { id: "factory_supervisor_tick", path: "docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot" },
            { id: "managed_software_delivery_domain", path: "docs/contracts/workflow-ir/factory-runtime/managed_software_delivery_domain.dot" },
          ],
        }),
      ],
    }, null, 2)}\n`);

    const hostRegistryPath = writeRegistry(hostBaseDir, [
      baseRegistryRow({
        instance_id: "example-trading",
        kind_id: "example-trading",
        target_repo: "example-org/example-trading",
        assigned_host_id: "unassigned",
        installation_manifest_path: installationManifestPath,
        graphs: [{ id: "factory_supervisor_tick", path: "factories/example-trading/graphs/factory_supervisor_tick.dot" }],
      }),
    ]);

    const previousHostMaxActive = process.env.HATCH_HOST_MAX_ACTIVE;
    const restoreRegistryEnv = useRegistryEnv(hostRegistryPath, hostBaseDir);
    process.env.HATCH_HOST_MAX_ACTIVE = "1";

    try {
      const out = await runHostRuntime({
        paths,
        once: true,
        runTickFn: async () => ({
          runId: "run_repaired_01",
          tickId: "tick_repaired_01",
          exitCode: 0,
          tickIdle: false,
          durationMs: 12,
          tickLogPath: join(hostBaseDir, "tick-repaired.log"),
        }),
      });

      assert.equal(out.ok, true);
      assert.equal(out.schedulerDecisions.length, 1);
      assert.equal(out.schedulerDecisions[0].decision, "scheduled");
      assert.equal(out.executionResults.length, 1);
      assert.equal(out.executionResults[0].run_id, "run_repaired_01");

      const repairedRegistry = JSON.parse(readFileSync(hostRegistryPath, "utf8"));
      const repairedRow = repairedRegistry.instances.find((entry) => entry.instance_id === "example-trading");
      assert.equal(repairedRow.assigned_host_id, "host_unit_test_repair");
      assert.equal(repairedRow.graphs[0].path, "docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot");

      const repairedLease = JSON.parse(readFileSync(join(installationDir, "lease.json"), "utf8"));
      assert.equal(repairedLease.host_id, "host_unit_test_repair");
      assert.equal(Date.parse(repairedLease.lease_expires_at) > Date.now(), true);
    } finally {
      restoreRegistryEnv();

      if (previousHostMaxActive === undefined) {
        delete process.env.HATCH_HOST_MAX_ACTIVE;
      } else {
        process.env.HATCH_HOST_MAX_ACTIVE = previousHostMaxActive;
      }
    }
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
    rmSync(repoRootOverride, { recursive: true, force: true });
  }
});

test("runHostRuntime loop mode executes scheduled installations", async () => {
  const hostBaseDir = makeTmpDir("host-runtime-lifecycle-loop-exec-");
  const paths = resolveHostRuntimePaths({ hostBaseDir, repoRoot });
  const signatureFixture = createRuntimeSignatureFixture({
    workspaceDir: hostBaseDir,
    payloadRelativePath: "runtime/host-runtime.mjs",
  });

  try {
    const install = installHostRuntime({
      paths,
      hostId: "host_unit_test_loop_01",
      repoRoot,
      ...signatureInstallOptions(signatureFixture),
    });

    const installationDir = join(hostBaseDir, "example-notes");
    mkdirSync(installationDir, { recursive: true });
    writeApiOnlyInstallation(installationDir, {
      installation_id: "inst_unit_loop_01",
      instance_id: "fac_unit_loop_01",
      host_id: "host_unit_test_loop_01",
      work_dir: null,
      runtime_version: install.runtimeVersion,
    });
    writeFileSync(join(installationDir, "lease.json"), `${JSON.stringify({
      instance_id: "fac_unit_loop_01",
      installation_id: "inst_unit_loop_01",
      host_id: "host_unit_test_loop_01",
      lease_owner: "host_unit_test_loop_01:123:fac_unit_loop_01:managed_host_assignment",
      lease_acquired_at: "2026-03-16T00:00:00.000Z",
      lease_expires_at: "2099-03-16T00:10:00.000Z",
      lease_ttl_sec: 600,
      runtime_version: install.runtimeVersion,
    }, null, 2)}\n`);

    const registryPath = writeRegistry(hostBaseDir, [
      baseRegistryRow({
        instance_id: "fac_unit_loop_01",
        installation_manifest_path: join(installationDir, "installation.json"),
        kind_id: "brainstorm",
        target_repo: "example-org/example-notes",
        graphs: [{ id: "factory_supervisor_tick", path: "docs/contracts/workflow-ir/brainstorm/factory_supervisor_tick.dot" }],
      }),
    ]);

    const previousHostMaxActive = process.env.HATCH_HOST_MAX_ACTIVE;
    const restoreRegistryEnv = useRegistryEnv(registryPath, hostBaseDir);
    process.env.HATCH_HOST_MAX_ACTIVE = "1";

    try {
      const out = await runHostRuntime({
        paths,
        once: false,
        runTickFn: async () => ({
          runId: "run_loop_01",
          tickId: "tick_loop_01",
          exitCode: 0,
          tickIdle: false,
          durationMs: 11,
          tickLogPath: join(hostBaseDir, "tick-loop.log"),
        }),
      });

      assert.equal(out.ok, true);
      assert.equal(out.mode, "loop");
      assert.equal(out.schedulerDecisions.length, 1);
      assert.equal(out.schedulerDecisions[0].decision, "scheduled");
      assert.equal(out.executionResults.length, 1);
      assert.equal(out.executionResults[0].run_id, "run_loop_01");
      assert.equal(out.executionResults[0].tick_id, "tick_loop_01");
    } finally {
      restoreRegistryEnv();

      if (previousHostMaxActive === undefined) {
        delete process.env.HATCH_HOST_MAX_ACTIVE;
      } else {
        process.env.HATCH_HOST_MAX_ACTIVE = previousHostMaxActive;
      }
    }
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});

test("runHostRuntime once fails closed when scheduled execution exits non-zero", async () => {
  const hostBaseDir = makeTmpDir("host-runtime-lifecycle-once-failed-");
  const paths = resolveHostRuntimePaths({ hostBaseDir, repoRoot });
  const signatureFixture = createRuntimeSignatureFixture({
    workspaceDir: hostBaseDir,
    payloadRelativePath: "runtime/host-runtime.mjs",
  });

  try {
    const install = installHostRuntime({
      paths,
      hostId: "host_unit_test_03",
      repoRoot,
      ...signatureInstallOptions(signatureFixture),
    });

    const installationDir = join(hostBaseDir, "example-notes");
    mkdirSync(installationDir, { recursive: true });
    writeApiOnlyInstallation(installationDir, {
      installation_id: "inst_unit_01",
      instance_id: "fac_unit_01",
      host_id: "host_unit_test_03",
      work_dir: null,
      runtime_version: install.runtimeVersion,
    });
    writeFileSync(join(installationDir, "lease.json"), `${JSON.stringify({
      instance_id: "fac_unit_01",
      installation_id: "inst_unit_01",
      host_id: "host_unit_test_03",
      lease_owner: "host_unit_test_03:123:fac_unit_01:managed_host_assignment",
      lease_acquired_at: "2026-03-16T00:00:00.000Z",
      lease_expires_at: "2099-03-16T00:10:00.000Z",
      lease_ttl_sec: 600,
      runtime_version: install.runtimeVersion,
    }, null, 2)}\n`);

    const registryPath = writeRegistry(hostBaseDir, [
      baseRegistryRow({
        installation_manifest_path: join(installationDir, "installation.json"),
        kind_id: "brainstorm",
        target_repo: "example-org/example-notes",
        graphs: [{ id: "factory_supervisor_tick", path: "docs/contracts/workflow-ir/brainstorm/factory_supervisor_tick.dot" }],
      }),
    ]);

    const previousHostMaxActive = process.env.HATCH_HOST_MAX_ACTIVE;
    const restoreRegistryEnv = useRegistryEnv(registryPath, hostBaseDir);
    process.env.HATCH_HOST_MAX_ACTIVE = "1";

    try {
      const out = await runHostRuntime({
        paths,
        once: true,
        runTickFn: async () => ({
          runId: "run_failed_01",
          tickId: "tick_failed_01",
          exitCode: 2,
          tickIdle: false,
          durationMs: 17,
          tickLogPath: join(hostBaseDir, "tick-failed.log"),
        }),
      });

      assert.equal(out.ok, false);
      assert.equal(out.status, "host_runtime_once_failed");
      assert.equal(out.errorCode, "host_runtime_once_failed");
      assert.equal(out.executionFailure.reason, "non_zero_exit_code");
      assert.equal(out.executionResults.length, 1);
      assert.equal(out.executionResults[0].run_id, "run_failed_01");
      assert.equal(out.executionResults[0].tick_id, "tick_failed_01");
      assert.equal(out.executionResults[0].exit_code, 2);
      assert.equal(out.installations[0].last_exit_code, 2);
    } finally {
      restoreRegistryEnv();

      if (previousHostMaxActive === undefined) {
        delete process.env.HATCH_HOST_MAX_ACTIVE;
      } else {
        process.env.HATCH_HOST_MAX_ACTIVE = previousHostMaxActive;
      }
    }
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});

test("installHostRuntime rejects missing signature inputs and writes no manifest", () => {
  const hostBaseDir = makeTmpDir("host-runtime-signature-missing-");
  const paths = resolveHostRuntimePaths({ hostBaseDir, repoRoot });

  try {
    const out = installHostRuntime({
      paths,
      hostId: "host_signature_missing_01",
      repoRoot,
    });

    assert.equal(out.ok, false);
    assert.equal(out.errorCode, "host_runtime_signature_missing");
    assert.equal(existsSync(paths.hostManifestPath), false);
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});

test("installHostRuntime rejects wrong public key for a valid signature", () => {
  const hostBaseDir = makeTmpDir("host-runtime-signature-wrong-key-");
  const paths = resolveHostRuntimePaths({ hostBaseDir, repoRoot });
  const signedFixture = createRuntimeSignatureFixture({
    workspaceDir: hostBaseDir,
    payloadRelativePath: "runtime/signed-entrypoint.mjs",
  });
  const wrongKeyFixture = createRuntimeSignatureFixture({
    workspaceDir: hostBaseDir,
    payloadRelativePath: "runtime/wrong-key-entrypoint.mjs",
  });

  try {
    const out = installHostRuntime({
      paths,
      hostId: "host_signature_wrong_key_01",
      repoRoot,
      runtimeSignature: signedFixture.runtimeSignature,
      runtimeSignatureKeyId: signedFixture.runtimeSignatureKeyId,
      trustPublicKeyPath: wrongKeyFixture.publicKeyPath,
      signedPayloadPath: signedFixture.payloadPath,
    });

    assert.equal(out.ok, false);
    assert.equal(out.errorCode, "host_runtime_signature_invalid");
    assert.equal(existsSync(paths.hostManifestPath), false);
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});

test("installHostRuntime rejects tampered payload and runHostRuntime fails closed when manifest signature evidence is invalid", async () => {
  const hostBaseDir = makeTmpDir("host-runtime-signature-invalid-");
  const paths = resolveHostRuntimePaths({ hostBaseDir, repoRoot });
  const signatureFixture = createRuntimeSignatureFixture({
    workspaceDir: hostBaseDir,
    payloadRelativePath: "runtime/signed-entrypoint.mjs",
  });

  try {
    writeFileSync(signatureFixture.payloadPath, "export const runtime = 'tampered';\n", "utf8");

    const invalidInstall = installHostRuntime({
      paths,
      hostId: "host_signature_invalid_01",
      repoRoot,
      ...signatureInstallOptions(signatureFixture),
    });

    assert.equal(invalidInstall.ok, false);
    assert.equal(invalidInstall.errorCode, "host_runtime_signature_invalid");
    assert.equal(existsSync(paths.hostManifestPath), false);

    const validFixture = createRuntimeSignatureFixture({
      workspaceDir: hostBaseDir,
      payloadRelativePath: "runtime/verified-entrypoint.mjs",
    });

    const validInstall = installHostRuntime({
      paths,
      hostId: "host_signature_invalid_01",
      repoRoot,
      runtimeSignature: validFixture.runtimeSignature,
      runtimeSignatureKeyId: validFixture.runtimeSignatureKeyId,
      trustPublicKeyPath: validFixture.publicKeyPath,
      signedPayloadPath: validFixture.payloadPath,
    });

    assert.equal(validInstall.ok, true);
    const manifest = JSON.parse(readFileSync(paths.hostManifestPath, "utf8"));
    manifest.runtime_signature_status = "invalid";
    manifest.runtime_signature_error = "host_runtime_signature_invalid";
    writeFileSync(paths.hostManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const doctor = doctorHostRuntime({ paths });
    assert.equal(doctor.ok, false);
    assert.equal(doctor.errorCode, "host_runtime_signature_invalid");

    const run = await runHostRuntime({ paths, once: true });
    assert.equal(run.ok, false);
    assert.equal(run.errorCode, "host_runtime_signature_invalid");
    assert.equal(existsSync(join(paths.runtimeLogDir, "hatch-host.log")), false);
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});

test("doctor rejects failed live signature verification despite stored verified evidence", () => {
  const hostBaseDir = makeTmpDir("host-runtime-live-signature-");
  const paths = resolveHostRuntimePaths({ hostBaseDir, repoRoot });
  const fixture = createRuntimeSignatureFixture({ workspaceDir: hostBaseDir, payloadRelativePath: "runtime/payload.mjs" });
  try {
    const installed = installHostRuntime({ paths, hostId: "fixture", repoRoot, runtimeSignature: fixture.runtimeSignature, runtimeSignatureKeyId: fixture.runtimeSignatureKeyId, trustPublicKeyPath: fixture.publicKeyPath, signedPayloadPath: fixture.payloadPath });
    assert.equal(installed.ok, true);
    const result = doctorHostRuntime({ paths, runtimeSignature: "invalid-signature", runtimeSignatureKeyId: fixture.runtimeSignatureKeyId, trustPublicKeyPath: fixture.publicKeyPath, signedPayloadPath: fixture.payloadPath });
    assert.equal(result.ok, false);
    assert.equal(result.checks.find((check) => check.id === "runtime_signature")?.ok, false);
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});
