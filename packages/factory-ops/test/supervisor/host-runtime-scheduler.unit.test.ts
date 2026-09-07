import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  getHostRuntimeStatus,
  installHostRuntime,
  resolveHostRuntimePaths,
  runHostRuntime,
} from "../../src/commands/host-runtime-lifecycle.ts";
import { createRuntimeSignatureFixture } from "./host-runtime-signature.fixture.ts";

function makeTmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeRegistry(root, rows = []) {
  const registryPath = join(root, "factory-registry.json");
  writeFileSync(registryPath, `${JSON.stringify({
    schema: "hatch.factory.registry.v1",
    instances: rows,
  }, null, 2)}\n`);
  return registryPath;
}

function registryRow({
  instanceId,
  installationManifestPath,
  schedulerWeight,
  reservedCapacity,
  assignedHostId = "unassigned",
  targetRepo = "recallnet/astrochicken",
  kindId = "mothership",
} = {}) {
  return {
    instance_id: instanceId,
    kind_id: kindId,
    target_repo: targetRepo,
    status: "active",
    assigned_host_id: assignedHostId,
    installation_manifest_path: installationManifestPath,
    graphs: [{ id: "factory_supervisor_tick", path: "docs/contracts/workflow-ir/brainstorm/factory_supervisor_tick.dot" }],
    daemonStatus: { status: "stopped" },
    service_tier: "standard",
    scheduler_weight: schedulerWeight,
    reserved_capacity: reservedCapacity,
    upgrade_channel: "stable",
    allowed_runtime_version: "*",
    support_owner: "ops",
    feature_flags: {},
  };
}

function writeInstallation({
  hostBaseDir,
  slug,
  installationId,
  instanceId,
  hostId,
  runtimeVersion,
} = {}) {
  const installationDir = join(hostBaseDir, slug);
  mkdirSync(installationDir, { recursive: true });
  const installationManifestPath = join(installationDir, "installation.json");
  writeFileSync(installationManifestPath, `${JSON.stringify({
    installation_id: installationId,
    instance_id: instanceId,
    host_id: hostId,
    workspace_mode: "api_only",
    work_dir: "",
    log_dir: join(installationDir, "logs"),
    artifact_dir: join(installationDir, "artifacts"),
    runtime_version: runtimeVersion,
  }, null, 2)}\n`);
  return {
    installationDir,
    installationManifestPath,
  };
}

function writeLease({
  installationDir,
  installationId,
  instanceId,
  hostId,
  runtimeVersion,
  leaseExpiresAt,
} = {}) {
  writeFileSync(join(installationDir, "lease.json"), `${JSON.stringify({
    instance_id: instanceId,
    installation_id: installationId,
    host_id: hostId,
    lease_owner: `${hostId}:123:${instanceId}:managed_host_assignment`,
    lease_acquired_at: "2026-03-16T00:00:00.000Z",
    lease_expires_at: leaseExpiresAt,
    lease_ttl_sec: 600,
    runtime_version: runtimeVersion,
  }, null, 2)}\n`);
}

test("scheduler enforces bounded concurrency and eventually schedules lower-weight installation", async () => {
  const hostBaseDir = makeTmpDir("host-runtime-scheduler-fairness-");
  const hostId = "host_scheduler_test_01";
  const paths = resolveHostRuntimePaths({ hostBaseDir, repoRoot: process.cwd() });

  const previousRegistryPath = process.env.HATCH_FACTORY_REGISTRY_PATH;
  const previousRegistryCwd = process.env.HATCH_FACTORY_REGISTRY_CWD;
  const previousHostMaxActive = process.env.HATCH_HOST_MAX_ACTIVE;
  const previousStarvationThreshold = process.env.HATCH_HOST_STARVATION_THRESHOLD;
  const previousMaxAgeBonusCycles = process.env.HATCH_HOST_MAX_AGE_BONUS_CYCLES;
  const signatureFixture = createRuntimeSignatureFixture({
    workspaceDir: hostBaseDir,
    payloadRelativePath: "runtime/host-runtime.mjs",
  });

  try {
    const install = installHostRuntime({
      paths,
      hostId,
      repoRoot: process.cwd(),
      runtimeSignature: signatureFixture.runtimeSignature,
      runtimeSignatureKeyId: signatureFixture.runtimeSignatureKeyId,
      trustPublicKeyPath: signatureFixture.publicKeyPath,
      signedPayloadPath: signatureFixture.payloadPath,
    });

    const high = writeInstallation({
      hostBaseDir,
      slug: "high-priority",
      installationId: "inst_high",
      instanceId: "fac_high",
      hostId,
      runtimeVersion: install.runtimeVersion,
    });
    const low = writeInstallation({
      hostBaseDir,
      slug: "low-priority",
      installationId: "inst_low",
      instanceId: "fac_low",
      hostId,
      runtimeVersion: install.runtimeVersion,
    });

    writeLease({
      installationDir: high.installationDir,
      installationId: "inst_high",
      instanceId: "fac_high",
      hostId,
      runtimeVersion: install.runtimeVersion,
      leaseExpiresAt: "2099-03-16T00:10:00.000Z",
    });
    writeLease({
      installationDir: low.installationDir,
      installationId: "inst_low",
      instanceId: "fac_low",
      hostId,
      runtimeVersion: install.runtimeVersion,
      leaseExpiresAt: "2099-03-16T00:10:00.000Z",
    });

    const registryPath = writeRegistry(hostBaseDir, [
      registryRow({
        instanceId: "fac_high",
        installationManifestPath: high.installationManifestPath,
        schedulerWeight: 10,
        reservedCapacity: 1,
        kindId: "brainstorm",
        targetRepo: "example-org/example-notes",
      }),
      registryRow({
        instanceId: "fac_low",
        installationManifestPath: low.installationManifestPath,
        schedulerWeight: 1,
        reservedCapacity: 0,
        kindId: "brainstorm",
        targetRepo: "example-org/example-notes",
      }),
    ]);
    const tickResults = [
      { runId: "run_high_1", tickId: "tick_high_1", exitCode: 0, tickIdle: false, durationMs: 30, tickLogPath: join(hostBaseDir, "tick-high-1.log") },
      { runId: "run_high_2", tickId: "tick_high_2", exitCode: 0, tickIdle: false, durationMs: 30, tickLogPath: join(hostBaseDir, "tick-high-2.log") },
      { runId: "run_low_1", tickId: "tick_low_1", exitCode: 0, tickIdle: false, durationMs: 30, tickLogPath: join(hostBaseDir, "tick-low-1.log") },
      { runId: "run_high_3", tickId: "tick_high_3", exitCode: 0, tickIdle: false, durationMs: 30, tickLogPath: join(hostBaseDir, "tick-high-3.log") },
      { runId: "run_low_2", tickId: "tick_low_2", exitCode: 0, tickIdle: false, durationMs: 30, tickLogPath: join(hostBaseDir, "tick-low-2.log") },
      { runId: "run_high_4", tickId: "tick_high_4", exitCode: 0, tickIdle: false, durationMs: 30, tickLogPath: join(hostBaseDir, "tick-high-4.log") },
      { runId: "run_low_3", tickId: "tick_low_3", exitCode: 0, tickIdle: false, durationMs: 30, tickLogPath: join(hostBaseDir, "tick-low-3.log") },
      { runId: "run_high_5", tickId: "tick_high_5", exitCode: 0, tickIdle: false, durationMs: 30, tickLogPath: join(hostBaseDir, "tick-high-5.log") },
      { runId: "run_low_4", tickId: "tick_low_4", exitCode: 0, tickIdle: false, durationMs: 30, tickLogPath: join(hostBaseDir, "tick-low-4.log") },
      { runId: "run_high_6", tickId: "tick_high_6", exitCode: 0, tickIdle: false, durationMs: 30, tickLogPath: join(hostBaseDir, "tick-high-6.log") },
      { runId: "run_low_5", tickId: "tick_low_5", exitCode: 0, tickIdle: false, durationMs: 30, tickLogPath: join(hostBaseDir, "tick-low-5.log") },
      { runId: "run_high_7", tickId: "tick_high_7", exitCode: 0, tickIdle: false, durationMs: 30, tickLogPath: join(hostBaseDir, "tick-high-7.log") },
    ];

    process.env.HATCH_FACTORY_REGISTRY_PATH = registryPath;
    process.env.HATCH_FACTORY_REGISTRY_CWD = hostBaseDir;
    process.env.HATCH_HOST_MAX_ACTIVE = "1";
    process.env.HATCH_HOST_STARVATION_THRESHOLD = "3";
    process.env.HATCH_HOST_MAX_AGE_BONUS_CYCLES = "6";

    const scheduledAcrossCycles = [];
    const lowAgeBonusHistory = [];

    for (let cycle = 0; cycle < 12; cycle += 1) {
      const out = await runHostRuntime({
        paths,
        once: true,
        runTickFn: async () => tickResults.shift() || {
          runId: `run_fallback_${cycle}`,
          tickId: `tick_fallback_${cycle}`,
          exitCode: 0,
          tickIdle: false,
          durationMs: 10,
          tickLogPath: join(hostBaseDir, `tick-fallback-${cycle}.log`),
        },
      });
      assert.equal(out.ok, true);
      assert.equal(Array.isArray(out.schedulerDecisions), true);
      const scheduled = out.schedulerDecisions.find((entry) => entry.decision === "scheduled");
      assert.ok(scheduled, "expected at least one scheduled installation per cycle");
      scheduledAcrossCycles.push(scheduled.installation_id);

      const lowDecision = out.schedulerDecisions.find((entry) => entry.installation_id === "inst_low");
      assert.ok(lowDecision, "expected low installation decision");
      lowAgeBonusHistory.push(lowDecision.age_bonus_counter);

      for (const decision of out.schedulerDecisions) {
        assert.equal(typeof decision.scheduler_weight, "number");
        assert.equal(typeof decision.reserved_capacity, "number");
        assert.equal(typeof decision.selection_reason, "string");
        assert.equal(typeof decision.effective_priority, "number");
        assert.equal(typeof decision.capacity_reject_reason, "string");
      }
    }

    assert.equal(scheduledAcrossCycles.includes("inst_low"), true, "lower-weight installation must eventually be scheduled");
    assert.equal(lowAgeBonusHistory.some((value) => Number(value) > 0), true, "age bonus should increase for deferred installation");
    assert.equal(lowAgeBonusHistory.at(-1) <= 6, true, "age bonus should respect configured cap");

    const schedulerStatePath = resolve(paths.runtimeDir, "scheduler-state.json");
    const schedulerState = JSON.parse(readFileSync(schedulerStatePath, "utf8"));
    assert.equal(typeof schedulerState.instances.inst_low, "object");
    assert.equal(typeof schedulerState.instances.inst_high, "object");

    const status = getHostRuntimeStatus({ paths });
    assert.equal(status.ok, true);
    assert.equal(Array.isArray(status.scheduler.active_instances), true);
    assert.equal(Array.isArray(status.scheduler.queued_instances), true);
    assert.equal(status.scheduler.active_instances.length, 1);
    assert.equal(typeof status.host_queue_depth, "number");
    assert.equal(typeof status.host_capacity_pressure, "number");
    assert.equal(Array.isArray(status.wake_sources), true);
    assert.equal(typeof status.installations[0].selection_reason, "string");
    assert.equal(typeof status.installations[0].effective_priority, "number");
    assert.equal(typeof status.installations[0].age_bonus, "number");
    assert.equal(typeof status.installations[0].capacity_reject_reason, "string");
  } finally {
    if (previousRegistryPath === undefined) {
      delete process.env.HATCH_FACTORY_REGISTRY_PATH;
    } else {
      process.env.HATCH_FACTORY_REGISTRY_PATH = previousRegistryPath;
    }

    if (previousRegistryCwd === undefined) {
      delete process.env.HATCH_FACTORY_REGISTRY_CWD;
    } else {
      process.env.HATCH_FACTORY_REGISTRY_CWD = previousRegistryCwd;
    }

    if (previousHostMaxActive === undefined) {
      delete process.env.HATCH_HOST_MAX_ACTIVE;
    } else {
      process.env.HATCH_HOST_MAX_ACTIVE = previousHostMaxActive;
    }

    if (previousStarvationThreshold === undefined) {
      delete process.env.HATCH_HOST_STARVATION_THRESHOLD;
    } else {
      process.env.HATCH_HOST_STARVATION_THRESHOLD = previousStarvationThreshold;
    }

    if (previousMaxAgeBonusCycles === undefined) {
      delete process.env.HATCH_HOST_MAX_AGE_BONUS_CYCLES;
    } else {
      process.env.HATCH_HOST_MAX_AGE_BONUS_CYCLES = previousMaxAgeBonusCycles;
    }

    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});

test("scheduler defers installation when lease is invalid and schedules after valid lease appears", async () => {
  const hostBaseDir = makeTmpDir("host-runtime-scheduler-lease-");
  const hostId = "host_scheduler_test_02";
  const paths = resolveHostRuntimePaths({ hostBaseDir, repoRoot: process.cwd() });

  const previousRegistryPath = process.env.HATCH_FACTORY_REGISTRY_PATH;
  const previousRegistryCwd = process.env.HATCH_FACTORY_REGISTRY_CWD;
  const previousHostMaxActive = process.env.HATCH_HOST_MAX_ACTIVE;
  const signatureFixture = createRuntimeSignatureFixture({
    workspaceDir: hostBaseDir,
    payloadRelativePath: "runtime/host-runtime.mjs",
  });

  try {
    const install = installHostRuntime({
      paths,
      hostId,
      repoRoot: process.cwd(),
      runtimeSignature: signatureFixture.runtimeSignature,
      runtimeSignatureKeyId: signatureFixture.runtimeSignatureKeyId,
      trustPublicKeyPath: signatureFixture.publicKeyPath,
      signedPayloadPath: signatureFixture.payloadPath,
    });

    const target = writeInstallation({
      hostBaseDir,
      slug: "lease-target",
      installationId: "inst_lease",
      instanceId: "fac_lease",
      hostId,
      runtimeVersion: install.runtimeVersion,
    });

    const registryPath = writeRegistry(hostBaseDir, [
      registryRow({
        instanceId: "fac_lease",
        installationManifestPath: target.installationManifestPath,
        schedulerWeight: 2,
        reservedCapacity: 0,
        assignedHostId: hostId,
        kindId: "brainstorm",
        targetRepo: "example-org/example-notes",
      }),
    ]);

    process.env.HATCH_FACTORY_REGISTRY_PATH = registryPath;
    process.env.HATCH_FACTORY_REGISTRY_CWD = hostBaseDir;
    process.env.HATCH_HOST_MAX_ACTIVE = "1";

    const invalidRun = await runHostRuntime({
      paths,
      once: true,
      runTickFn: async () => ({
        runId: "run_invalid",
        tickId: "tick_invalid",
        exitCode: 0,
        tickIdle: false,
        durationMs: 12,
        tickLogPath: join(hostBaseDir, "tick-invalid.log"),
      }),
    });
    assert.equal(invalidRun.ok, true);
    assert.equal(invalidRun.schedulerDecisions.length, 1);
    assert.equal(invalidRun.schedulerDecisions[0].decision, "deferred");
    assert.equal(invalidRun.schedulerDecisions[0].defer_reason, "lease_invalid");
    assert.equal(invalidRun.schedulerDecisions[0].active_state, "idle");
    assert.equal(typeof invalidRun.host_queue_depth, "number");
    assert.equal(typeof invalidRun.host_capacity_pressure, "number");
    assert.equal(Array.isArray(invalidRun.wakeSources), true);

    const invalidStatus = getHostRuntimeStatus({ paths });
    assert.equal(invalidStatus.scheduler.active_instances.length, 0);
    assert.equal(invalidStatus.scheduler.queued_instances.length, 1);
    assert.equal(invalidStatus.scheduler.queued_instances[0].defer_reason, "lease_invalid");

    writeLease({
      installationDir: target.installationDir,
      installationId: "inst_lease",
      instanceId: "fac_lease",
      hostId,
      runtimeVersion: install.runtimeVersion,
      leaseExpiresAt: "2099-03-16T00:10:00.000Z",
    });

    const validRun = await runHostRuntime({
      paths,
      once: true,
      runTickFn: async () => ({
        runId: "run_valid",
        tickId: "tick_valid",
        exitCode: 0,
        tickIdle: false,
        durationMs: 12,
        tickLogPath: join(hostBaseDir, "tick-valid.log"),
      }),
    });
    assert.equal(validRun.ok, true);
    assert.equal(validRun.schedulerDecisions.length, 1);
    assert.equal(validRun.schedulerDecisions[0].decision, "scheduled");
    assert.equal(validRun.schedulerDecisions[0].defer_reason, "");
    assert.equal(validRun.schedulerDecisions[0].active_state, "running");

    const validStatus = getHostRuntimeStatus({ paths });
    assert.equal(validStatus.scheduler.active_instances.length, 1);
    assert.equal(validStatus.scheduler.active_instances[0].installation_id, "inst_lease");
    assert.equal(validStatus.scheduler.queued_instances.length, 0);
  } finally {
    if (previousRegistryPath === undefined) {
      delete process.env.HATCH_FACTORY_REGISTRY_PATH;
    } else {
      process.env.HATCH_FACTORY_REGISTRY_PATH = previousRegistryPath;
    }

    if (previousRegistryCwd === undefined) {
      delete process.env.HATCH_FACTORY_REGISTRY_CWD;
    } else {
      process.env.HATCH_FACTORY_REGISTRY_CWD = previousRegistryCwd;
    }

    if (previousHostMaxActive === undefined) {
      delete process.env.HATCH_HOST_MAX_ACTIVE;
    } else {
      process.env.HATCH_HOST_MAX_ACTIVE = previousHostMaxActive;
    }

    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});
