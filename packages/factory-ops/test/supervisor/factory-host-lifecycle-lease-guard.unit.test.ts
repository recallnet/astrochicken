import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { hostHealth, hostStart, resolveHostPaths } from "../../src/commands/factory-host-lifecycle.ts";

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
    instance_id: "mothership",
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

function makeTmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("hostStart fails closed when lease host owner differs", async () => {
  const root = makeTmpDir("factory-host-lease-guard-start-");
  try {
    const paths = resolveHostPaths({ factoryId: "mothership", baseDir: root });
    mkdirSync(join(paths.hostDir), { recursive: true });

    writeFileSync(paths.installationManifestPath, JSON.stringify({
      installation_id: "inst_mothership_host_a",
      instance_id: "mothership",
      host_id: "host_a",
      workspace_mode: "api_only",
      work_dir: null,
      log_dir: paths.logsDir,
      artifact_dir: paths.artifactDir,
      runtime_version: "1.0.0",
    }, null, 2));

    writeFileSync(join(paths.hostDir, "lease.json"), JSON.stringify({
      instance_id: "mothership",
      installation_id: "inst_mothership_host_a",
      host_id: "host_b",
      lease_owner: "host_b:999:mothership:managed_host_assignment",
      lease_acquired_at: "2026-03-10T00:00:00.000Z",
      lease_expires_at: "2026-03-10T00:10:00.000Z",
      lease_ttl_sec: 600,
      runtime_version: "1.0.0",
    }, null, 2));

    const out = await hostStart({
      factoryId: "mothership",
      daemonScript: join(root, "missing-daemon.sh"),
      env: { HATCH_HOST_ID: "host_a" },
      pidFile: paths.pidFile,
      paths,
    });

    assert.equal(out.ok, false);
    assert.equal(out.status, "lease_mismatch");
    assert.equal(out.errorCode, "ambiguous_host_assignment");
    assert.match(out.message, /lease_host_id=host_b:expected_host_id=host_a/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("hostStart fails closed when runtime is incompatible with registry policy", async () => {
  const root = makeTmpDir("factory-host-runtime-compat-start-");
  try {
    const paths = resolveHostPaths({ factoryId: "mothership", baseDir: root });
    mkdirSync(join(paths.hostDir), { recursive: true });

    writeFileSync(paths.installationManifestPath, JSON.stringify({
      installation_id: "inst_mothership_host_a",
      instance_id: "mothership",
      host_id: "host_a",
      workspace_mode: "api_only",
      work_dir: null,
      log_dir: paths.logsDir,
      artifact_dir: paths.artifactDir,
      runtime_version: "1.0.0",
    }, null, 2));

    const registryPath = writeRegistry(root, [
      baseRegistryRow({
        installation_manifest_path: paths.installationManifestPath,
        allowed_runtime_version: ">=9.9.9",
      }),
    ]);

    const out = await hostStart({
      factoryId: "mothership",
      daemonScript: join(root, "missing-daemon.sh"),
      env: {
        HATCH_HOST_ID: "host_a",
        HATCH_INSTANCE_ID: "mothership",
        HATCH_FACTORY_REGISTRY_PATH: registryPath,
      },
      pidFile: paths.pidFile,
      paths,
    });

    assert.equal(out.ok, false);
    assert.equal(out.status, "runtime_incompatible");
    assert.equal(out.errorCode, "runtime_incompatible");
    assert.match(out.message, /runtime_version_out_of_range:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("hostHealth fails closed when lease host owner differs", () => {
  const root = makeTmpDir("factory-host-lease-guard-health-");
  try {
    const paths = resolveHostPaths({ factoryId: "mothership", baseDir: root });
    mkdirSync(join(paths.hostDir), { recursive: true });

    writeFileSync(paths.installationManifestPath, JSON.stringify({
      installation_id: "inst_mothership_host_a",
      instance_id: "mothership",
      host_id: "host_a",
      workspace_mode: "api_only",
      work_dir: null,
      log_dir: paths.logsDir,
      artifact_dir: paths.artifactDir,
      runtime_version: "1.0.0",
    }, null, 2));

    writeFileSync(join(paths.hostDir, "lease.json"), JSON.stringify({
      instance_id: "mothership",
      installation_id: "inst_mothership_host_a",
      host_id: "host_b",
      lease_owner: "host_b:999:mothership:managed_host_assignment",
      lease_acquired_at: "2026-03-10T00:00:00.000Z",
      lease_expires_at: "2026-03-10T00:10:00.000Z",
      lease_ttl_sec: 600,
      runtime_version: "1.0.0",
    }, null, 2));

    const out = hostHealth({
      factoryId: "mothership",
      pidFile: paths.pidFile,
      runsDir: paths.runsDir,
      logsDir: paths.logsDir,
      paths,
      env: { HATCH_HOST_ID: "host_a" },
    });

    assert.equal(out.ok, false);
    assert.equal(out.status, "lease_mismatch");
    assert.equal(out.errorCode, "ambiguous_host_assignment");
    assert.match(out.message, /lease_host_id=host_b:expected_host_id=host_a/);
    assert.equal(out.running, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
