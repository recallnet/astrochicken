import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

function makeTmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeRegistry(root, { serviceTier = "gold", channel = "stable", runtime = ">=1.2.0 <2.0.0" } = {}) {
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
        service_tier: serviceTier,
        scheduler_weight: 2,
        reserved_capacity: 1,
        upgrade_channel: channel,
        allowed_runtime_version: runtime,
        support_owner: "ops-platform",
        feature_flags: { wave_autoretry: "enabled" },
      },
    ],
  }, null, 2)}\n`);
  return registryPath;
}

function writeProfile(root, payload) {
  const profilePath = join(root, "profile.json");
  writeFileSync(profilePath, `${JSON.stringify(payload, null, 2)}\n`);
  return profilePath;
}

function runCli(args, { expectStatus = 0 } = {}) {
  const run = spawnSync("node", [opsCliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(run.status, expectStatus, `stderr=${run.stderr}\nstdout=${run.stdout}`);
  return run;
}

test("factory service-profile inspect prints service-profile JSON only", () => {
  const root = makeTmpDir("factory-service-profile-inspect-");
  try {
    const registryPath = writeRegistry(root);

    const run = runCli([
      "factory",
      "service-profile",
      "inspect",
      "brainstorm",
      "--registry-path",
      registryPath,
    ]);

    const payload = JSON.parse(String(run.stdout || "{}"));
    assert.deepEqual(payload, {
      service_tier: "gold",
      scheduler_weight: 2,
      reserved_capacity: 1,
      upgrade_channel: "stable",
      allowed_runtime_version: ">=1.2.0 <2.0.0",
      support_owner: "ops-platform",
      feature_flags: { wave_autoretry: "enabled" },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("factory service-profile update persists validated profile payload", () => {
  const root = makeTmpDir("factory-service-profile-update-");
  try {
    const registryPath = writeRegistry(root);
    const profilePath = writeProfile(root, {
      service_tier: "platinum",
      scheduler_weight: 5,
      reserved_capacity: 2,
      upgrade_channel: "canary",
      allowed_runtime_version: ">=2.0.0 <3.0.0",
      support_owner: "ops-sre",
      feature_flags: {
        beta_feature: "on",
      },
    });

    const run = runCli([
      "factory",
      "service-profile",
      "update",
      "brainstorm",
      "--registry-path",
      registryPath,
      "--profile",
      profilePath,
    ]);

    const out = JSON.parse(String(run.stdout || "{}"));
    assert.equal(out.ok, true);
    assert.equal(out.status, "updated");
    assert.equal(out.instance_id, "brainstorm");
    assert.equal(out.registry_path, registryPath);
    assert.equal(out.profile_path, profilePath);
    assert.equal(out.service_profile.service_tier, "platinum");
    assert.equal(out.service_profile.upgrade_channel, "canary");

    const persisted = JSON.parse(readFileSync(registryPath, "utf8"));
    const row = persisted.instances.find((entry) => entry.instance_id === "brainstorm");
    assert.equal(row.service_tier, "platinum");
    assert.equal(row.scheduler_weight, 5);
    assert.equal(row.reserved_capacity, 2);
    assert.equal(row.upgrade_channel, "canary");
    assert.equal(row.allowed_runtime_version, ">=2.0.0 <3.0.0");
    assert.equal(row.support_owner, "ops-sre");
    assert.deepEqual(row.feature_flags, { beta_feature: "on" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("factory service-profile update fails closed on invalid tier/channel/runtime", () => {
  const root = makeTmpDir("factory-service-profile-invalid-values-");
  try {
    const registryPath = writeRegistry(root);
    const profilePath = writeProfile(root, {
      service_tier: "tier!",
      scheduler_weight: 2,
      reserved_capacity: 1,
      upgrade_channel: "stable/channel",
      allowed_runtime_version: "v(one)",
      support_owner: "ops-platform",
      feature_flags: {
        wave_autoretry: "enabled",
      },
    });

    const run = runCli([
      "factory",
      "service-profile",
      "update",
      "brainstorm",
      "--registry-path",
      registryPath,
      "--profile",
      profilePath,
    ], { expectStatus: 1 });

    assert.match(String(run.stderr || ""), /service_profile_validation_failed:instances\[0\]\.service_tier: must match/);

    const persisted = JSON.parse(readFileSync(registryPath, "utf8"));
    const row = persisted.instances.find((entry) => entry.instance_id === "brainstorm");
    assert.equal(row.service_tier, "gold");
    assert.equal(row.upgrade_channel, "stable");
    assert.equal(row.allowed_runtime_version, ">=1.2.0 <2.0.0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("factory service-profile update rejects unknown service-profile keys", () => {
  const root = makeTmpDir("factory-service-profile-unknown-key-");
  try {
    const registryPath = writeRegistry(root);
    const profilePath = writeProfile(root, {
      service_tier: "gold",
      scheduler_weight: 1,
      reserved_capacity: 0,
      upgrade_channel: "stable",
      allowed_runtime_version: "*",
      support_owner: "ops",
      feature_flags: {},
      extra_policy: "nope",
    });

    const run = runCli([
      "factory",
      "service-profile",
      "update",
      "brainstorm",
      "--registry-path",
      registryPath,
      "--profile",
      profilePath,
    ], { expectStatus: 1 });

    assert.match(String(run.stderr || ""), /service_profile_unknown_keys:extra_policy/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
