import { spawnOpsCli } from "../helpers/ops-command-cli-fixture.ts";
import { readFixtureJson as readJson, makeHostRegistryRow as baseRegistryRow, writeInstallationManifest as writeManifest, writeHostRegistry as writeRegistry, makeOpsTempDir as makeTmpDir } from "../helpers/ops-command-fixtures.ts";
import assert from "node:assert/strict";

import { readFileSync, rmSync } from "node:fs";

import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assignHostToInstance, buildMigrationLeaseRecord, describeHostAssignment, drainHostAssignment, ensureSingleActiveHost, migrateHostAssignment } from "../../src/commands/factory-host-assignment.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");

const factoryRoot = join(repoRoot, "factories/mothership");

function manifestForHost(hostId, runtimeVersion = "9.9.9") {
  return {
    installation_id: `inst_mothership_${hostId}`,
    instance_id: "mothership",
    host_id: hostId,
    workspace_mode: "api_only",
    work_dir: null,
    log_dir: "/tmp/logs",
    artifact_dir: "/tmp/artifacts",
    runtime_version: runtimeVersion,
  };
}

function runCli(args, { expectStatus = 0, env = {} } = {}) {
  const runEnv = { ...process.env, ...env };
  delete runEnv.HATCH_FACTORY_MUTATION_CONTEXT_JSON;

  const run = spawnOpsCli([
      ...args
    ], {
      env: runEnv
    });
  assert.equal(run.status, expectStatus, `stderr=${run.stderr}\nstdout=${run.stdout}`);
  const stdout = String(run.stdout || "").trim();
  return {
    ...run,
    payload: stdout ? JSON.parse(stdout) : {},
  };
}

test("ensureSingleActiveHost rejects conflicting assigned host and manifest path", () => {
  assert.throws(
    () => ensureSingleActiveHost({
      registryRow: {
        assigned_host_id: "host_a",
        installation_manifest_path: "/tmp/host_a/installation.json",
      },
      expectedHostId: "host_b",
      expectedInstallationManifestPath: "/tmp/host_b/installation.json",
    }),
    /ambiguous_host_assignment:assigned_host_id=host_a:requested_host_id=host_b/,
  );
});

test("buildMigrationLeaseRecord preserves prior continuity fields", () => {
  const lease = buildMigrationLeaseRecord({
    installationManifest: manifestForHost("host_b", "2.0.0"),
    previousLease: {
      instance_id: "mothership",
      installation_id: "inst_mothership_host_a",
      runtime_version: "1.2.3",
      host_id: "host_a",
    },
    hostId: "host_b",
    leaseTtlSec: 15,
    now: Date.parse("2026-03-17T10:00:00.000Z"),
  });

  assert.equal(lease.instance_id, "mothership");
  assert.equal(lease.installation_id, "inst_mothership_host_a");
  assert.equal(lease.runtime_version, "1.2.3");
  assert.equal(lease.host_id, "host_b");
  assert.equal(lease.lease_ttl_sec, 15);
});

test("migrateHostAssignment rejects conflicting active assignment", () => {
  const root = makeTmpDir("factory-host-migrate-conflict-");
  try {
    const hostDirA = join(root, ".hatch", "hosts", "host_a");
    const hostDirB = join(root, ".hatch", "hosts", "host_b");
    const manifestA = writeManifest(hostDirA, manifestForHost("host_a"));
    const manifestB = writeManifest(hostDirB, manifestForHost("host_b"));
    const registryPath = writeRegistry(root, [{
      ...baseRegistryRow(),
      assigned_host_id: "host_z",
      installation_manifest_path: manifestA,
    }]);

    assert.throws(
      () => migrateHostAssignment({
        context: { instance_id: "mothership" },
        instanceId: "mothership",
        fromHostId: "host_a",
        toHostId: "host_b",
        installationManifestPath: manifestB,
        registryPath,
      }),
      /ambiguous_host_assignment:assigned_host_id=host_z:requested_host_id=host_a/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("describeHostAssignment passive inspection is read-only", () => {
  const root = makeTmpDir("factory-host-passive-readonly-");
  try {
    const hostDir = join(root, ".hatch", "hosts", "host_a");
    const manifestA = writeManifest(hostDir, manifestForHost("host_a"));
    const registryPath = writeRegistry(root, [baseRegistryRow()]);

    assignHostToInstance({
      context: { instance_id: "mothership", factory_id: "mothership" },
      instanceId: "mothership",
      hostId: "host_a",
      installationManifestPath: manifestA,
      registryPath,
      now: Date.parse("2026-03-17T10:00:00.000Z"),
    });

    const leasePath = join(hostDir, "lease.json");
    const beforeRegistry = readFileSync(registryPath, "utf8");
    const beforeLease = readFileSync(leasePath, "utf8");

    const out = describeHostAssignment({
      context: { instance_id: "mothership", factory_id: "mothership" },
      instanceId: "mothership",
      installationManifestPath: manifestA,
      registryPath,
      readOnly: true,
    });

    assert.equal(out.ok, true);
    assert.equal(out.read_only, true);
    assert.equal(out.assigned_host_id, "host_a");
    assert.equal(readFileSync(registryPath, "utf8"), beforeRegistry);
    assert.equal(readFileSync(leasePath, "utf8"), beforeLease);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("migrateHostAssignment preserves instance continuity and updates lease host", () => {
  const root = makeTmpDir("factory-host-migrate-success-");
  try {
    const hostDirA = join(root, ".hatch", "hosts", "host_a");
    const hostDirB = join(root, ".hatch", "hosts", "host_b");
    const manifestA = writeManifest(hostDirA, manifestForHost("host_a", "1.0.0"));
    const manifestB = writeManifest(hostDirB, manifestForHost("host_b", "1.0.0"));
    const registryPath = writeRegistry(root, [baseRegistryRow()]);

    assignHostToInstance({
      context: { instance_id: "mothership", factory_id: "mothership" },
      instanceId: "mothership",
      hostId: "host_a",
      installationManifestPath: manifestA,
      registryPath,
      now: Date.parse("2026-03-17T10:00:00.000Z"),
      leaseTtlSec: 600,
    });

    const migrated = migrateHostAssignment({
      context: { instance_id: "mothership", factory_id: "mothership" },
      instanceId: "mothership",
      fromHostId: "host_a",
      toHostId: "host_b",
      installationManifestPath: manifestB,
      registryPath,
      now: Date.parse("2026-03-17T10:01:00.000Z"),
      leaseTtlSec: 600,
      drainLeaseTtlSec: 15,
    });

    assert.equal(migrated.ok, true);
    assert.equal(migrated.status, "migrated");
    assert.equal(migrated.previous_lease.instance_id, "mothership");
    assert.equal(migrated.lease.instance_id, "mothership");
    assert.equal(migrated.previous_lease.host_id, "host_a");
    assert.equal(migrated.lease.host_id, "host_b");

    const registry = readJson(registryPath);
    assert.equal(registry.instances[0].assigned_host_id, "host_b");
    assert.equal(registry.instances[0].installation_manifest_path, resolve(manifestB));

    const oldLease = readJson(join(hostDirA, "lease.json"));
    const newLease = readJson(join(hostDirB, "lease.json"));
    assert.equal(oldLease.instance_id, "mothership");
    assert.equal(newLease.instance_id, "mothership");
    assert.equal(oldLease.host_id, "host_a");
    assert.equal(newLease.host_id, "host_b");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("migrateHostAssignment rejects stale source lease", () => {
  const root = makeTmpDir("factory-host-migrate-stale-");
  try {
    const hostDirA = join(root, ".hatch", "hosts", "host_a");
    const hostDirB = join(root, ".hatch", "hosts", "host_b");
    const manifestA = writeManifest(hostDirA, manifestForHost("host_a"));
    const manifestB = writeManifest(hostDirB, manifestForHost("host_b"));
    const registryPath = writeRegistry(root, [baseRegistryRow()]);

    assignHostToInstance({
      context: { instance_id: "mothership", factory_id: "mothership" },
      instanceId: "mothership",
      hostId: "host_a",
      installationManifestPath: manifestA,
      registryPath,
      now: Date.parse("2026-03-17T10:00:00.000Z"),
      leaseTtlSec: 30,
    });

    assert.throws(
      () => migrateHostAssignment({
        context: { instance_id: "mothership", factory_id: "mothership" },
        instanceId: "mothership",
        fromHostId: "host_a",
        toHostId: "host_b",
        installationManifestPath: manifestB,
        registryPath,
        now: Date.parse("2026-03-17T10:02:00.000Z"),
      }),
      /lease_stale:lease_expires_at=/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("drainHostAssignment keeps assignment and shortens lease ttl", () => {
  const root = makeTmpDir("factory-host-drain-");
  try {
    const hostDir = join(root, ".hatch", "hosts", "host_a");
    const manifestA = writeManifest(hostDir, manifestForHost("host_a"));
    const registryPath = writeRegistry(root, [baseRegistryRow()]);

    assignHostToInstance({
      context: { instance_id: "mothership", factory_id: "mothership" },
      instanceId: "mothership",
      hostId: "host_a",
      installationManifestPath: manifestA,
      registryPath,
      now: Date.parse("2026-03-17T10:00:00.000Z"),
      leaseTtlSec: 600,
    });

    const drained = drainHostAssignment({
      context: { instance_id: "mothership", factory_id: "mothership" },
      instanceId: "mothership",
      hostId: "host_a",
      installationManifestPath: manifestA,
      registryPath,
      now: Date.parse("2026-03-17T10:01:00.000Z"),
      leaseTtlSec: 15,
    });

    assert.equal(drained.ok, true);
    assert.equal(drained.status, "drained");
    assert.equal(drained.assigned_host_id, "host_a");
    assert.equal(drained.lease.lease_ttl_sec, 15);

    const registry = readJson(registryPath);
    assert.equal(registry.instances[0].assigned_host_id, "host_a");

    const lease = readJson(join(hostDir, "lease.json"));
    assert.equal(lease.host_id, "host_a");
    assert.equal(lease.lease_ttl_sec, 15);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("factory host migrate and host drain CLI paths return structured output", () => {
  const root = makeTmpDir("factory-host-migrate-cli-");
  try {
    const hostBaseDir = join(root, ".hatch", "hosts");
    const installationDirA = join(hostBaseDir, "host_a");
    const installationDirB = join(hostBaseDir, "host_b");
    const manifestA = writeManifest(installationDirA, manifestForHost("host_a", "3.4.5"));
    const manifestB = writeManifest(installationDirB, manifestForHost("host_b", "3.4.5"));
    const registryPath = writeRegistry(root, [baseRegistryRow()]);

    runCli([
      "factory", "host-assign",
      "--factory-root", factoryRoot,
      "--factory-id", "mothership",
      "--host-base-dir", hostBaseDir,
      "--host-id", "host_a",
      "--registry-path", registryPath,
      "--installation-manifest-path", manifestA,
      "--lease-ttl", "600",
    ]);

    const migrated = runCli([
      "factory", "host", "migrate",
      "--factory-root", factoryRoot,
      "--factory-id", "mothership",
      "--host-base-dir", hostBaseDir,
      "--from-host-id", "host_a",
      "--to-host-id", "host_b",
      "--registry-path", registryPath,
      "--installation-manifest-path", manifestB,
      "--lease-ttl", "600",
      "--drain-lease-ttl", "15",
    ]).payload;

    assert.equal(migrated.ok, true);
    assert.equal(migrated.status, "migrated");
    assert.equal(migrated.from_host_id, "host_a");
    assert.equal(migrated.to_host_id, "host_b");
    assert.equal(migrated.previous_lease.host_id, "host_a");
    assert.equal(migrated.lease.host_id, "host_b");

    const drained = runCli([
      "factory", "host", "drain",
      "--factory-root", factoryRoot,
      "--factory-id", "mothership",
      "--host-base-dir", hostBaseDir,
      "--host-id", "host_b",
      "--registry-path", registryPath,
      "--installation-manifest-path", manifestB,
      "--lease-ttl", "15",
    ]).payload;

    assert.equal(drained.ok, true);
    assert.equal(drained.status, "drained");
    assert.equal(drained.assigned_host_id, "host_b");
    assert.equal(drained.lease.lease_ttl_sec, 15);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
