import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  inspectFactoryServiceProfile,
  updateFactoryServiceProfile,
} from "../../src/commands/factory-service-profile.ts";

function makeTmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeRegistry(root) {
  const registryPath = join(root, "factory-registry.json");
  writeFileSync(registryPath, `${JSON.stringify({
    schema: "hatch.factory.registry.v1",
    instances: [
      {
        instance_id: "brainstorm",
        kind_id: "brainstorm",
        target_repo: "example-org/example-notes",
        status: "active",
        assigned_host_id: "unassigned",
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

test("inspectFactoryServiceProfile returns canonical service profile payload", () => {
  const root = makeTmpDir("factory-service-profile-inspect-unit-");
  try {
    const registryPath = writeRegistry(root);
    const out = inspectFactoryServiceProfile({
      instanceId: "brainstorm",
      registryPath,
      cwd: root,
    });

    assert.equal(out.ok, true);
    assert.equal(out.instance_id, "brainstorm");
    assert.equal(out.service_profile.service_tier, "standard");
    assert.equal(out.service_profile.upgrade_channel, "stable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("updateFactoryServiceProfile persists profile changes", () => {
  const root = makeTmpDir("factory-service-profile-update-unit-");
  try {
    const registryPath = writeRegistry(root);
    const profilePath = join(root, "profile.json");
    writeFileSync(profilePath, `${JSON.stringify({
      service_tier: "gold",
      scheduler_weight: 3,
      reserved_capacity: 1,
      upgrade_channel: "canary",
      allowed_runtime_version: ">=2.0.0 <3.0.0",
      support_owner: "ops-platform",
      feature_flags: {
        wave_autoretry: "enabled",
      },
    }, null, 2)}\n`);

    const out = updateFactoryServiceProfile({
      instanceId: "brainstorm",
      profilePath,
      registryPath,
      cwd: root,
    });

    assert.equal(out.ok, true);
    assert.equal(out.service_profile.service_tier, "gold");

    const persisted = JSON.parse(readFileSync(registryPath, "utf8"));
    assert.equal(persisted.instances[0].service_tier, "gold");
    assert.equal(persisted.instances[0].upgrade_channel, "canary");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
