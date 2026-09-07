import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assignHostToInstance, describeHostAssignment } from "../../src/commands/factory-host-assignment.ts";

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

function writeManifest(root, payload = {}) {
  mkdirSync(root, { recursive: true });
  const path = join(root, "installation.json");
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
  return path;
}

function baseRegistryRow() {
  return {
    instance_id: "mothership",
    kind_id: "mothership",
    target_repo: "recallnet/astrochicken",
    status: "active",
    assigned_host_id: "unassigned",
    installation_manifest_path: "",
    graphs: [],
    daemonStatus: { status: "stopped" },
  };
}

function baseManifest(hostId = "host_alpha") {
  return {
    installation_id: `inst_mothership_${hostId}`,
    instance_id: "mothership",
    host_id: hostId,
    workspace_mode: "api_only",
    work_dir: null,
    log_dir: "/tmp/logs",
    artifact_dir: "/tmp/artifacts",
    runtime_version: "9.9.9",
  };
}

test("assignHostToInstance writes lease and updates registry", () => {
  const root = makeTmpDir("factory-host-assignment-success-");
  try {
    const installationDir = join(root, ".hatch", "hosts", "mothership");
    const installationManifestPath = writeManifest(installationDir, baseManifest("host_alpha"));
    const registryPath = writeRegistry(root, [baseRegistryRow()]);

    const out = assignHostToInstance({
      context: { factory_id: "mothership", instance_id: "mothership" },
      paths: { installationManifestPath },
      hostId: "host_alpha",
      instanceId: "mothership",
      installationManifestPath,
      registryPath,
      now: Date.parse("2026-03-10T00:00:00.000Z"),
      leaseTtlSec: 600,
    });

    assert.equal(out.ok, true);
    assert.equal(out.status, "assigned");
    assert.equal(out.assigned_host_id, "host_alpha");
    assert.equal(out.lease.instance_id, "mothership");
    assert.equal(out.lease.host_id, "host_alpha");
    assert.equal(out.lease.lease_ttl_sec, 600);

    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    assert.equal(registry.instances[0].assigned_host_id, "host_alpha");
    assert.equal(registry.instances[0].installation_manifest_path, installationManifestPath);

    const leasePath = join(installationDir, "lease.json");
    const lease = JSON.parse(readFileSync(leasePath, "utf8"));
    assert.equal(lease.host_id, "host_alpha");
    assert.equal(lease.runtime_version, "9.9.9");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("assignHostToInstance is idempotent for same host", () => {
  const root = makeTmpDir("factory-host-assignment-idempotent-");
  try {
    const installationDir = join(root, ".hatch", "hosts", "mothership");
    const installationManifestPath = writeManifest(installationDir, baseManifest("host_alpha"));
    const registryPath = writeRegistry(root, [{
      ...baseRegistryRow(),
      assigned_host_id: "host_alpha",
      installation_manifest_path: installationManifestPath,
    }]);

    const first = assignHostToInstance({
      context: { factory_id: "mothership", instance_id: "mothership" },
      paths: { installationManifestPath },
      hostId: "host_alpha",
      instanceId: "mothership",
      installationManifestPath,
      registryPath,
      now: Date.parse("2026-03-10T00:00:00.000Z"),
      leaseTtlSec: 600,
    });

    const second = assignHostToInstance({
      context: { factory_id: "mothership", instance_id: "mothership" },
      paths: { installationManifestPath },
      hostId: "host_alpha",
      instanceId: "mothership",
      installationManifestPath,
      registryPath,
      now: Date.parse("2026-03-10T00:01:00.000Z"),
      leaseTtlSec: 600,
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.assigned_host_id, "host_alpha");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("assignHostToInstance fails when manifest missing", () => {
  const root = makeTmpDir("factory-host-assignment-missing-manifest-");
  try {
    const registryPath = writeRegistry(root, [baseRegistryRow()]);
    assert.throws(
      () => assignHostToInstance({
        context: { factory_id: "mothership", instance_id: "mothership" },
        paths: { installationManifestPath: join(root, "missing", "installation.json") },
        hostId: "host_alpha",
        instanceId: "mothership",
        installationManifestPath: join(root, "missing", "installation.json"),
        registryPath,
      }),
      /installation_manifest_not_found/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("assignHostToInstance fails when registry row missing", () => {
  const root = makeTmpDir("factory-host-assignment-missing-row-");
  try {
    const installationDir = join(root, ".hatch", "hosts", "mothership");
    const installationManifestPath = writeManifest(installationDir, baseManifest("host_alpha"));
    const registryPath = writeRegistry(root, []);

    assert.throws(
      () => assignHostToInstance({
        context: { factory_id: "mothership", instance_id: "mothership" },
        paths: { installationManifestPath },
        hostId: "host_alpha",
        instanceId: "mothership",
        installationManifestPath,
        registryPath,
      }),
      /instance_not_registered:mothership/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("assignHostToInstance rejects conflicting host assignment", () => {
  const root = makeTmpDir("factory-host-assignment-conflict-");
  try {
    const installationDir = join(root, ".hatch", "hosts", "mothership");
    const installationManifestPath = writeManifest(installationDir, baseManifest("host_beta"));
    const registryPath = writeRegistry(root, [{
      ...baseRegistryRow(),
      assigned_host_id: "host_alpha",
      installation_manifest_path: installationManifestPath,
    }]);

    const leasePath = join(installationDir, "lease.json");
    const beforeRegistry = readFileSync(registryPath, "utf8");

    assert.throws(
      () => assignHostToInstance({
        context: { factory_id: "mothership", instance_id: "mothership" },
        paths: { installationManifestPath },
        hostId: "host_beta",
        instanceId: "mothership",
        installationManifestPath,
        registryPath,
      }),
      /ambiguous_host_assignment:assigned_host_id=host_alpha:requested_host_id=host_beta/,
    );

    assert.equal(readFileSync(registryPath, "utf8"), beforeRegistry);
    assert.equal(existsSync(leasePath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("describeHostAssignment returns lease + assigned host status", () => {
  const root = makeTmpDir("factory-host-assignment-status-");
  try {
    const installationDir = join(root, ".hatch", "hosts", "mothership");
    const installationManifestPath = writeManifest(installationDir, baseManifest("host_alpha"));
    const registryPath = writeRegistry(root, [baseRegistryRow()]);

    assignHostToInstance({
      context: { factory_id: "mothership", instance_id: "mothership" },
      paths: { installationManifestPath },
      hostId: "host_alpha",
      instanceId: "mothership",
      installationManifestPath,
      registryPath,
      now: Date.parse("2026-03-10T00:00:00.000Z"),
      leaseTtlSec: 600,
    });

    const out = describeHostAssignment({
      context: { factory_id: "mothership", instance_id: "mothership" },
      paths: { installationManifestPath },
      instanceId: "mothership",
      installationManifestPath,
      registryPath,
    });

    assert.equal(out.ok, true);
    assert.equal(out.assigned_host_id, "host_alpha");
    assert.equal(out.lease_present, true);
    assert.equal(out.lease.lease_owner.includes("host_alpha"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
