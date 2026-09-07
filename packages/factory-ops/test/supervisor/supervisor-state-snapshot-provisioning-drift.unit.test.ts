import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { buildStateSnapshot } from "../../src/commands/supervisor-state-snapshot.ts";

function writeJson(pathValue, value) {
  mkdirSync(resolve(pathValue, ".."), { recursive: true });
  writeFileSync(pathValue, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function seedProvisioningFixture(rootDir) {
  const fixtureRoot = join(rootDir, "fixture");
  const homeRoot = join(fixtureRoot, "home");

  writeJson(join(fixtureRoot, "factory-registry.json"), {
    schema: "hatch.factory.registry.v1",
    instances: [
      {
        instance_id: "example-trading",
        kind_id: "example-trading",
        target_repo: "example/example-trading-home",
        status: "active",
        assigned_host_id: "host_local_01",
        installation_manifest_path: ".hatch/hosts/example-trading/installation.json",
        service_tier: "standard",
        scheduler_weight: 1,
        reserved_capacity: 0,
        upgrade_channel: "stable",
        allowed_runtime_version: "*",
        support_owner: "ops",
        feature_flags: {},
      },
    ],
  });

  writeJson(join(fixtureRoot, "home-repos.json"), {
    "example-trading": "./home/example-trading",
  });

  writeJson(join(fixtureRoot, "labels.json"), {
    "example/example-trading-home": [
      {
        name: "managed-factory-bug",
        description: "Factory label: managed-factory-bug",
        color: "5319e7",
      },
    ],
  });

  writeJson(join(homeRoot, "example-trading", ".hatch", "instance.json"), {
    instance_id: "example-trading",
    kind_id: "example-trading",
    target_repo: {
      provider: "github",
      full_name: "example/example-trading-home",
    },
    control_plane_repo: "recallnet/astrochicken",
    workspace_mode: "",
    intake: {
      issue_selector: {
        labels: ["managed-factory-bug", "kind:example-trading"],
      },
    },
    destinations: {
      platform_incidents: {
        repo: "recallnet/astrochicken",
        labels: ["managed-factory-bug", "kind:example-trading"],
      },
    },
  });

  writeJson(join(fixtureRoot, ".hatch", "hosts", "example-trading", "installation.json"), {
    installation_id: "inst_example_trading_01",
    instance_id: "example-trading",
    host_id: "host_local_01",
    runtime_version: "1.0.0",
  });

  return {
    fixtureRoot,
    registryPath: join(fixtureRoot, "factory-registry.json"),
    targetRepoMapPath: join(fixtureRoot, "home-repos.json"),
    labelsPath: join(fixtureRoot, "labels.json"),
  };
}

test("supervisor snapshot emits provisioning_drift action with host + installation + manifest hash", () => {
  const root = mkdtempSync(join(tmpdir(), "snapshot-provisioning-drift-"));
  const prevCwd = process.cwd();

  try {
    const fixtures = seedProvisioningFixture(root);
    process.chdir(fixtures.fixtureRoot);

    const snapshot = JSON.parse(buildStateSnapshot({
      repo: "example/example-trading-home",
      factoryId: "example-trading",
      registryPath: fixtures.registryPath,
      runsDir: join(fixtures.fixtureRoot, ".hatch", "runs"),
      recoverySweepFn: () => ({ stale_runs: [] }),
      ghJsonFn: () => [],
      nowMs: Date.parse("2026-03-17T00:00:00.000Z"),
    }));

    const drift = (snapshot.action_items || []).find((item) => item.kind === "provisioning_drift");
    assert.ok(drift, "expected provisioning_drift action item");
    assert.equal(drift.instance_id, "example-trading");
    assert.equal(drift.repo, "example/example-trading-home");
    assert.equal(drift.host_id, "host_local_01");
    assert.equal(drift.installation_id, "inst_example_trading_01");
    assert.equal(typeof drift.manifest_identity_hash, "string");
    assert.equal(drift.manifest_identity_hash.length, 12);
    assert.deepEqual(drift.drift_details.missing_labels, ["factory:example-trading"]);
    assert.equal(drift.drift_details.manifest_drift?.drifted, true);
  } finally {
    process.chdir(prevCwd);
    rmSync(root, { recursive: true, force: true });
  }
});
