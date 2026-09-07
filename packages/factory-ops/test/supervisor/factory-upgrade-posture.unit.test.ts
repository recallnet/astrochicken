import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  inspectFactoryUpgradePosture,
  updateFactoryUpgradePostureCohort,
  formatFactoryUpgradePostureInspectHuman,
  formatFactoryUpgradePostureCohortHuman,
} from "../../src/commands/factory-upgrade-posture.ts";

function makeTmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeRegistry(root, rows = []) {
  const registryPath = join(root, "factory-registry.json");
  writeJson(registryPath, {
    schema: "hatch.factory.registry.v1",
    instances: rows,
  });
  return registryPath;
}

function writeReleasePolicy(root, channels = {}) {
  const policyPath = join(root, "factories", "mothership", "policy-pack", "v1", "release-policy.json");
  writeJson(policyPath, {
    shared: {
      default_channel: "stable",
      channels,
    },
    factory: {
      preferred_channel: "stable",
      freeze_windows: [],
      post_merge_notifications: [],
    },
  });
  return policyPath;
}

test("inspectFactoryUpgradePosture returns runtime/kind/channel/pin and drift facts", () => {
  const root = makeTmpDir("factory-upgrade-posture-inspect-");
  try {
    const installPath = join(root, ".hatch", "hosts", "mothership", "installation.json");
    writeJson(installPath, {
      installation_id: "inst_mothership_hostA",
      instance_id: "mothership",
      host_id: "hostA",
      workspace_mode: "api_only",
      runtime_version: "1.2.0",
      runtime_signature_hash: "sha256:abc",
      runtime_signature_key_id: "ops-key",
      runtime_artifact_ref: "https://example/releases/runtime-v1.2.0.tgz",
    });

    const mirrorSnapshotPath = join(root, ".hatch", "fleet", "mirrors", "mothership", "mothership", "snapshot.json");
    writeJson(mirrorSnapshotPath, {
      instance_id: "mothership",
      kind_version: "1.1.0",
      mirror_updated_at: "2026-03-17T00:00:00.000Z",
    });

    const registryPath = writeRegistry(root, [{
      instance_id: "mothership",
      kind_id: "mothership",
      target_repo: "recallnet/astrochicken",
      status: "active",
      assigned_host_id: "hostA",
      installation_manifest_path: ".hatch/hosts/mothership/installation.json",
      upgrade_channel: "stable",
      allowed_runtime_version: "*",
    }]);

    const policyPath = writeReleasePolicy(root, {
      stable: {
        required_checks: ["build"],
        runtime_version_target: ">=1.0.0 <2.0.0",
        kind_version_target: ">=1.5.0",
      },
      canary: {
        required_checks: ["build"],
      },
      pinned: {
        required_checks: ["build"],
      },
    });

    const out = inspectFactoryUpgradePosture({
      instanceId: "mothership",
      registryPath,
      policyPath,
      cwd: root,
      now: Date.parse("2026-03-17T07:00:00.000Z"),
    });

    assert.equal(out.ok, true);
    assert.equal(out.instance.instance_id, "mothership");
    assert.equal(out.instance.runtime.artifact_version, "1.2.0");
    assert.equal(out.instance.runtime.build_provenance_tag, "sha256:abc");
    assert.equal(out.instance.runtime.artifact_ref, "https://example/releases/runtime-v1.2.0.tgz");
    assert.equal(out.instance.kind.version, "1.1.0");
    assert.equal(out.instance.channel_posture, "stable");
    assert.equal(out.instance.pin_posture.pinned, false);
    assert.equal(out.instance.policy_target.runtime_version_target, ">=1.0.0 <2.0.0");
    assert.equal(out.instance.policy_target.kind_version_target, ">=1.5.0");
    assert.equal(out.instance.drift.runtime_drift, false);
    assert.equal(out.instance.drift.kind_drift, true);
    assert.equal(out.instance.drift.drifted, true);
    assert.ok(out.instance.drift.reasons.some((entry) => String(entry).startsWith("kind:")));
    assert.ok(out.instance.warnings.includes("policy_runtime_target_missing:stable") === false);
    assert.ok(out.instance.warnings.includes("policy_kind_target_missing:stable") === false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("updateFactoryUpgradePostureCohort updates channel/pin and appends audit log", () => {
  const root = makeTmpDir("factory-upgrade-posture-cohort-");
  try {
    const registryPath = writeRegistry(root, [
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
    ]);

    const policyPath = writeReleasePolicy(root, {
      stable: {
        required_checks: ["build"],
        runtime_version_target: ">=1.0.0",
        kind_version_target: ">=1.0.0",
      },
      canary: {
        required_checks: ["build"],
        runtime_version_target: ">=1.1.0",
        kind_version_target: ">=1.0.0",
      },
      pinned: {
        required_checks: ["build"],
        runtime_version_target: "1.0.0",
        kind_version_target: "1.0.0",
      },
    });

    const auditPath = join(root, ".hatch", "upgrade-posture", "audit-log.jsonl");
    const out = updateFactoryUpgradePostureCohort({
      selector: "kind:mothership",
      channel: "pinned",
      pinVersion: "1.2.3",
      registryPath,
      policyPath,
      auditLogPath: auditPath,
      actor: "ops-user",
      cwd: root,
      now: Date.parse("2026-03-17T08:00:00.000Z"),
    });

    assert.equal(out.ok, true);
    assert.equal(out.status, "updated");
    assert.equal(out.channel, "pinned");
    assert.equal(out.updated_count, 1);
    assert.equal(out.updated_instances[0].instance_id, "mothership");
    assert.equal(out.updated_instances[0].upgrade_channel, "pinned");
    assert.equal(out.updated_instances[0].allowed_runtime_version, "1.2.3");

    const persisted = JSON.parse(readFileSync(registryPath, "utf8"));
    const mothership = persisted.instances.find((entry) => entry.instance_id === "mothership");
    const brainstorm = persisted.instances.find((entry) => entry.instance_id === "brainstorm");
    assert.equal(mothership.upgrade_channel, "pinned");
    assert.equal(mothership.allowed_runtime_version, "1.2.3");
    assert.equal(brainstorm.upgrade_channel, "stable");

    const auditLines = readFileSync(auditPath, "utf8").trim().split(/\r?\n/).filter(Boolean);
    assert.equal(auditLines.length, 1);
    const auditEntry = JSON.parse(auditLines[0]);
    assert.equal(auditEntry.action, "cohort_update");
    assert.equal(auditEntry.actor, "ops-user");
    assert.equal(auditEntry.channel, "pinned");
    assert.equal(auditEntry.updated_instances.length, 1);
    assert.equal(auditEntry.updated_instances[0].after.instance_id, "mothership");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("updateFactoryUpgradePostureCohort fails closed when compatibility conflicts with pinned target", () => {
  const root = makeTmpDir("factory-upgrade-posture-compat-");
  try {
    const registryPath = writeRegistry(root, [{
      instance_id: "mothership",
      kind_id: "mothership",
      target_repo: "recallnet/astrochicken",
      status: "active",
      assigned_host_id: "hostA",
      upgrade_channel: "stable",
      allowed_runtime_version: "<1.0.0",
    }]);

    const policyPath = writeReleasePolicy(root, {
      stable: {
        required_checks: ["build"],
        runtime_version_target: ">=1.0.0",
        kind_version_target: ">=1.0.0",
      },
      canary: {
        required_checks: ["build"],
        runtime_version_target: ">=1.0.0",
        kind_version_target: ">=1.0.0",
      },
      pinned: {
        required_checks: ["build"],
        runtime_version_target: "1.0.0",
        kind_version_target: "1.0.0",
      },
    });

    assert.throws(() => updateFactoryUpgradePostureCohort({
      selector: "instance:mothership",
      channel: "pinned",
      pinVersion: "2.0.0",
      registryPath,
      policyPath,
      cwd: root,
    }), /compatibility_conflict:mothership:runtime_version_out_of_range:2\.0\.0:<1\.0\.0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inspectFactoryUpgradePosture fails closed when channel policy targets are missing", () => {
  const root = makeTmpDir("factory-upgrade-posture-policy-missing-");
  try {
    const registryPath = writeRegistry(root, [{
      instance_id: "mothership",
      kind_id: "mothership",
      target_repo: "recallnet/astrochicken",
      status: "active",
      assigned_host_id: "hostA",
      installation_manifest_path: ".hatch/hosts/mothership/installation.json",
      upgrade_channel: "stable",
      allowed_runtime_version: "*",
    }]);

    writeJson(join(root, ".hatch", "hosts", "mothership", "installation.json"), {
      installation_id: "inst_mothership_hostA",
      instance_id: "mothership",
      host_id: "hostA",
      workspace_mode: "api_only",
      runtime_version: "1.0.0",
    });

    const policyPath = writeReleasePolicy(root, {
      stable: {
        required_checks: ["build"],
      },
      canary: {
        required_checks: ["build"],
      },
      pinned: {
        required_checks: ["build"],
      },
    });

    assert.throws(() => inspectFactoryUpgradePosture({
      instanceId: "mothership",
      registryPath,
      policyPath,
      cwd: root,
    }), /release_policy_channel_targets_missing:stable/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("formatters return deterministic human summaries", () => {
  const inspectText = formatFactoryUpgradePostureInspectHuman({
    instance: {
      instance_id: "mothership",
      channel_posture: "stable",
      runtime: {
        artifact_version: "1.2.3",
        build_provenance_tag: "sha256:abc",
      },
      kind: {
        version: "1.0.0",
      },
      policy_target: {
        runtime_version_target: ">=1.0.0",
        kind_version_target: ">=1.0.0",
      },
      drift: {
        drifted: false,
        reasons: [],
      },
    },
  });
  assert.match(inspectText, /instance=mothership/);
  assert.match(inspectText, /runtime=1.2.3/);

  const cohortText = formatFactoryUpgradePostureCohortHuman({
    status: "updated",
    channel: "canary",
    updated_instances: [
      {
        instance_id: "mothership",
        upgrade_channel: "canary",
        allowed_runtime_version: ">=1.0.0",
      },
    ],
  });
  assert.match(cohortText, /status=updated channel=canary/);
  assert.match(cohortText, /mothership channel=canary allowed_runtime_version=>=1.0.0/);
});
