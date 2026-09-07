import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readFactoryRegistry } from "../../src/commands/factory-fleet-status.ts";

test("readFactoryRegistry overlays host runtime registry onto checked-in fleet registry without dropping missing runtime factories", () => {
  const root = mkdtempSync(join(tmpdir(), "fleet-registry-overlay-"));
  const runtimeDir = join(root, ".hatch-hosts", "runtime");
  mkdirSync(runtimeDir, { recursive: true });

  writeFileSync(join(root, "factory-registry.json"), JSON.stringify({
    schema: "hatch.factory.registry.v1",
    instances: [
      {
        instance_id: "mothership",
        kind_id: "mothership",
        target_repo: "recallnet/astrochicken",
        assigned_host_id: "unassigned",
      },
      {
        instance_id: "example-trading",
        kind_id: "example-trading",
        target_repo: "example-org/example-trading",
        assigned_host_id: "unassigned",
      },
      {
        instance_id: "example-scanner",
        kind_id: "example-scanner",
        target_repo: "example-org/example-scanner",
        assigned_host_id: "unassigned",
      },
    ],
  }, null, 2));

  const runtimeRegistryPath = join(runtimeDir, "factory-registry.json");
  writeFileSync(runtimeRegistryPath, JSON.stringify({
    schema: "hatch.factory.registry.v1",
    instances: [
      {
        instance_id: "mothership",
        kind_id: "mothership",
        target_repo: "recallnet/astrochicken",
        assigned_host_id: "devrel",
        daemonStatus: { status: "running" },
      },
      {
        instance_id: "example-trading",
        kind_id: "example-trading",
        target_repo: "example-org/example-trading",
        assigned_host_id: "devrel",
        daemonStatus: { status: "running" },
      },
    ],
  }, null, 2));

  const previous = process.env.HATCH_HOST_BASE_DIR;
  process.env.HATCH_HOST_BASE_DIR = join(root, ".hatch-hosts");
  try {
    const registry = readFactoryRegistry({ registryPath: runtimeRegistryPath, cwd: root });
    assert.equal(registry.ok, true);
    assert.deepEqual(
      registry.factories.map((row) => row.factory_id),
      ["example-scanner", "example-trading", "mothership"],
    );
    const exampleScanner = registry.factories.find((row) => row.factory_id === "example-scanner");
    assert.equal(exampleScanner?.target_repo, "example-org/example-scanner");
    const exampleTrading = registry.factories.find((row) => row.factory_id === "example-trading");
    assert.equal(exampleTrading?.daemon_status?.status, "running");
  } finally {
    if (previous === undefined) delete process.env.HATCH_HOST_BASE_DIR;
    else process.env.HATCH_HOST_BASE_DIR = previous;
  }
});
