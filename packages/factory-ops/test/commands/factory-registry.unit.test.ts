import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  SERVICE_PROFILE_KEYS,
  loadFactoryRegistry,
  saveFactoryRegistry,
} from "../../src/lib/factory-registry.ts";

function makeTmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("loadFactoryRegistry injects default service profile metadata", () => {
  const root = makeTmpDir("factory-registry-defaults-");
  try {
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
        },
      ],
    }, null, 2)}\n`);

    const loaded = loadFactoryRegistry({ registryPath, cwd: root });
    assert.deepEqual(loaded.registry.instances[0], {
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
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("saveFactoryRegistry serializes canonical service profile keys in deterministic order", () => {
  const root = makeTmpDir("factory-registry-serialize-");
  try {
    const registryPath = join(root, "factory-registry.json");
    saveFactoryRegistry({
      registryPath,
      registry: {
        schema: "hatch.factory.registry.v1",
        instances: [
          {
            instance_id: "zzz",
            kind_id: "example-trading",
            target_repo: "example-org/example-trading",
            status: "active",
            assigned_host_id: "unassigned",
            feature_flags: { zeta: "on", alpha: "off" },
          },
          {
            instance_id: "aaa",
            kind_id: "brainstorm",
            target_repo: "example-org/example-notes",
            status: "active",
            assigned_host_id: "unassigned",
          },
        ],
      },
    });

    const persisted = JSON.parse(readFileSync(registryPath, "utf8"));
    assert.deepEqual(
      persisted.instances.map((entry) => entry.instance_id),
      ["aaa", "zzz"],
    );

    for (const instance of persisted.instances) {
      const keys = Object.keys(instance);
      const serviceProfileStart = keys.indexOf("service_tier");
      assert.ok(serviceProfileStart >= 0, "service_tier should be present");
      assert.deepEqual(keys.slice(serviceProfileStart, serviceProfileStart + 7), [
        "service_tier",
        "scheduler_weight",
        "reserved_capacity",
        "upgrade_channel",
        "allowed_runtime_version",
        "support_owner",
        "feature_flags",
      ]);

      assert.equal(typeof instance.service_tier, "string");
      assert.equal(typeof instance.scheduler_weight, "number");
      assert.equal(typeof instance.reserved_capacity, "number");
      assert.equal(typeof instance.upgrade_channel, "string");
      assert.equal(typeof instance.allowed_runtime_version, "string");
      assert.equal(typeof instance.support_owner, "string");
      assert.equal(typeof instance.feature_flags, "object");
    }

    const zzz = persisted.instances.find((entry) => entry.instance_id === "zzz");
    assert.deepEqual(Object.keys(zzz.feature_flags), ["alpha", "zeta"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SERVICE_PROFILE_KEYS stays aligned with canonical key order", () => {
  assert.deepEqual(SERVICE_PROFILE_KEYS, [
    "service_tier",
    "scheduler_weight",
    "reserved_capacity",
    "upgrade_channel",
    "allowed_runtime_version",
    "support_owner",
    "feature_flags",
  ]);
});
