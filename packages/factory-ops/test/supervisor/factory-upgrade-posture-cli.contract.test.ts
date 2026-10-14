import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeReleasePolicy(root, canaryRuntimeVersion) {
  writeJson(join(root, "factories", "mothership", "policy-pack", "v1", "release-policy.json"), {
      shared: {
        default_channel: "stable",
        channels: {
          stable: {
            required_checks: ["build"],
            runtime_version_target: ">=1.0.0",
            kind_version_target: ">=1.0.0",
          },
          canary: {
            required_checks: ["build"],
            runtime_version_target: canaryRuntimeVersion,
            kind_version_target: ">=1.0.0",
          },
          pinned: {
            required_checks: ["build"],
            runtime_version_target: "1.0.0",
            kind_version_target: "1.0.0",
          },
        },
      },
      factory: {
        preferred_channel: "stable",
        freeze_windows: [],
        post_merge_notifications: [],
      },
    })
}

test("factory upgrade-posture inspect --json prints posture fields", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-upgrade-posture-cli-inspect-"));
  try {
    const registryPath = join(root, "factory-registry.json");
    writeJson(registryPath, {
      schema: "hatch.factory.registry.v1",
      instances: [
        {
          instance_id: "mothership",
          kind_id: "mothership",
          target_repo: "recallnet/astrochicken",
          status: "active",
          assigned_host_id: "hostA",
          installation_manifest_path: ".hatch/hosts/mothership/installation.json",
          upgrade_channel: "stable",
          allowed_runtime_version: "*",
        },
      ],
    });

    writeJson(join(root, ".hatch", "hosts", "mothership", "installation.json"), {
      installation_id: "inst_mothership_hostA",
      instance_id: "mothership",
      host_id: "hostA",
      workspace_mode: "api_only",
      runtime_version: "1.0.0",
      runtime_signature_hash: "sha256:abc",
      runtime_artifact_ref: "https://example/runtime-v1.0.0.tgz",
    });

    writeReleasePolicy(root, ">=1.0.0");

    const run = spawnSync("node", [
      opsCliPath,
      "factory",
      "upgrade-posture",
      "inspect",
      "mothership",
      "--registry-path",
      registryPath,
      "--policy-path",
      join(root, "factories", "mothership", "policy-pack", "v1", "release-policy.json"),
      "--json",
    ], {
      cwd: root,
      encoding: "utf8",
    });

    assert.equal(run.status, 0, run.stderr || run.stdout);
    const payload = JSON.parse(run.stdout || "{}");
    assert.equal(payload.ok, true);
    assert.equal(payload.instance.instance_id, "mothership");
    assert.equal(typeof payload.instance.runtime.artifact_version, "string");
    assert.equal(typeof payload.instance.kind.version, "string");
    assert.equal(typeof payload.instance.channel_posture, "string");
    assert.equal(typeof payload.instance.drift.drifted, "boolean");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("factory upgrade-posture cohort --json updates selected instance", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-upgrade-posture-cli-cohort-"));
  try {
    const registryPath = join(root, "factory-registry.json");
    writeJson(registryPath, {
      schema: "hatch.factory.registry.v1",
      instances: [
        {
          instance_id: "mothership",
          kind_id: "mothership",
          target_repo: "recallnet/astrochicken",
          status: "active",
          assigned_host_id: "hostA",
          upgrade_channel: "stable",
          allowed_runtime_version: "*",
        },
        {
          instance_id: "brainstorm",
          kind_id: "brainstorm",
          target_repo: "example-org/example-notes",
          status: "active",
          assigned_host_id: "hostB",
          upgrade_channel: "stable",
          allowed_runtime_version: "*",
        },
      ],
    });

    writeReleasePolicy(root, ">=1.1.0");

    const run = spawnSync("node", [
      opsCliPath,
      "factory",
      "upgrade-posture",
      "cohort",
      "instance:mothership",
      "--channel",
      "pinned",
      "--pin-version",
      "1.2.3",
      "--registry-path",
      registryPath,
      "--policy-path",
      join(root, "factories", "mothership", "policy-pack", "v1", "release-policy.json"),
      "--json",
    ], {
      cwd: root,
      encoding: "utf8",
    });

    assert.equal(run.status, 0, run.stderr || run.stdout);
    const payload = JSON.parse(run.stdout || "{}");
    assert.equal(payload.ok, true);
    assert.equal(payload.updated_count, 1);
    assert.equal(payload.updated_instances[0].instance_id, "mothership");
    assert.equal(payload.updated_instances[0].upgrade_channel, "pinned");
    assert.equal(payload.updated_instances[0].allowed_runtime_version, "1.2.3");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("factory upgrade-posture cohort fails when pinned target conflicts with allowed range", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-upgrade-posture-cli-cohort-fail-"));
  try {
    const registryPath = join(root, "factory-registry.json");
    writeJson(registryPath, {
      schema: "hatch.factory.registry.v1",
      instances: [
        {
          instance_id: "mothership",
          kind_id: "mothership",
          target_repo: "recallnet/astrochicken",
          status: "active",
          assigned_host_id: "hostA",
          upgrade_channel: "stable",
          allowed_runtime_version: "<1.0.0",
        },
      ],
    });

    writeReleasePolicy(root, ">=1.1.0");

    const run = spawnSync("node", [
      opsCliPath,
      "factory",
      "upgrade-posture",
      "cohort",
      "instance:mothership",
      "--channel",
      "pinned",
      "--pin-version",
      "2.0.0",
      "--registry-path",
      registryPath,
      "--policy-path",
      join(root, "factories", "mothership", "policy-pack", "v1", "release-policy.json"),
      "--json",
    ], {
      cwd: root,
      encoding: "utf8",
    });

    assert.equal(run.status, 1);
    assert.match(String(run.stderr || ""), /compatibility_conflict:mothership/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
