import { spawnOpsCli } from "../helpers/ops-command-cli-fixture.ts";
import { writeFixtureJson as writeJson } from "../helpers/ops-command-fixtures.ts";
import assert from "node:assert/strict";

import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");


function makeTmpDir(prefix = "factory-fleet-triage-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeFactoryConfig(rootDir, factoryId = "mothership") {
  const factoryRoot = join(rootDir, "factories", factoryId);
  mkdirSync(factoryRoot, { recursive: true });
  const configPath = join(factoryRoot, "factory.config.json");
  writeJson(configPath, {
    schema: "hatch.factory.config.v1",
    factory_id: factoryId,
    kind_id: factoryId,
    instance_id: factoryId,
    factory_root: `factories/${factoryId}`,
    target_repo: "recallnet/astrochicken",
    control_plane_repo: "recallnet/astrochicken",
    runs_dir: `.hatch/${factoryId}/runs`,
    scenarios: {
      root: `factories/${factoryId}/scenarios`,
    },
  });
  return { configPath, factoryRoot };
}

function writeFleetFixture(rootDir) {
  const registryPath = join(rootDir, "factory-registry.json");
  writeJson(registryPath, {
    schema: "hatch.factory.registry.v1",
    instances: [
      {
        instance_id: "alpha",
        kind_id: "brainstorm",
        target_repo: "example/alpha",
        service_tier: "premium",
        support_owner: "ops-platform",
      },
      {
        instance_id: "beta",
        kind_id: "brainstorm",
        target_repo: "example/beta",
        service_tier: "standard",
        support_owner: "ops-beta",
      },
    ],
  });

  const mirrorRoot = join(rootDir, "mirror-store");
  const alphaDir = join(mirrorRoot, "alpha");
  const betaDir = join(mirrorRoot, "beta");
  mkdirSync(alphaDir, { recursive: true });
  mkdirSync(betaDir, { recursive: true });

  writeJson(join(alphaDir, "snapshot.json"), {
    schema_version: "managed-factory-snapshot-mirror/v1",
    factory_id: "alpha",
    instance_id: "alpha",
    state_version: 11,
    mirror_version: 11,
    mirror_updated_at: "2026-03-16T21:40:00.000Z",
    lifecycle_state: "blocked_platform",
    lifecycle_reason: "shared incident",
    lifecycle_updated_at: "2026-03-16T21:30:00.000Z",
    blockers: {
      upstream: {
        has_open_upstream_bugs: true,
        open_upstream_bug_count: 1,
        open_upstream_bug_numbers: [901],
      },
      action_items: {
        has_action_items: true,
        action_item_count: 2,
      },
    },
    unresolved_actions: 2,
    queue_depth: 3,
    oldest_work_age_seconds: 900,
    latest_incidents: [
      {
        incident_fingerprint: "fp-shared-1",
        severity: "error",
      },
    ],
  });

  writeJson(join(betaDir, "snapshot.json"), {
    schema_version: "managed-factory-snapshot-mirror/v1",
    factory_id: "beta",
    instance_id: "beta",
    state_version: 9,
    mirror_version: 9,
    mirror_updated_at: "2026-03-16T21:41:00.000Z",
    lifecycle_state: "blocked_platform",
    lifecycle_reason: "shared incident",
    lifecycle_updated_at: "2026-03-16T21:31:00.000Z",
    blockers: {
      upstream: {
        has_open_upstream_bugs: true,
        open_upstream_bug_count: 1,
        open_upstream_bug_numbers: [901],
      },
      action_items: {
        has_action_items: false,
        action_item_count: 0,
      },
    },
    unresolved_actions: 1,
    queue_depth: 1,
    oldest_work_age_seconds: 300,
    latest_incidents: [
      {
        incident_fingerprint: "fp-shared-1",
        severity: "warn",
      },
    ],
  });

  writeJson(join(mirrorRoot, "events.json"), [
    {
      factory_id: "alpha",
      instance_id: "alpha",
      event_type: "factory.lifecycle.tick",
      status: "failed",
      started_at: "2026-03-16T21:00:00.000Z",
      ended_at: "2026-03-16T21:00:03.000Z",
      duration_ms: 3000,
      incident_fingerprint: "fp-shared-1",
      runtime_version: "1.2.3",
      kind_version: "2026.03.16",
      policy_profile: "stable",
    },
    {
      factory_id: "alpha",
      instance_id: "alpha",
      event_type: "factory.lifecycle.tick",
      status: "failed",
      started_at: "2026-03-16T21:05:00.000Z",
      ended_at: "2026-03-16T21:05:04.000Z",
      duration_ms: 4000,
      incident_fingerprint: "fp-shared-1",
      runtime_version: "1.2.3",
      kind_version: "2026.03.16",
      policy_profile: "stable",
    },
  ]);

  return { registryPath, mirrorRoot };
}

function runCli(args, { cwd = repoRoot, expectStatus = 0, env = {} } = {}) {
  const run = spawnOpsCli([
      ...args
    ], {
      cwd,
      env: {
      ...process.env,
      ...env,
    }
    });
  assert.equal(run.status, expectStatus, `stderr=${run.stderr}\nstdout=${run.stdout}`);
  return run;
}

test("factory triage-queues --json returns ranked normalized queue rows", () => {
  const root = makeTmpDir("factory-fleet-triage-json-");
  try {
    const { configPath } = writeFactoryConfig(root, "mothership");
    const { registryPath, mirrorRoot } = writeFleetFixture(root);

    const run = runCli([
      "factory",
      "triage-queues",
      "--factory-root",
      join(root, "factories", "mothership"),
      "--factory-config-path",
      configPath,
      "--factory-id",
      "mothership",
      "--registry-path",
      registryPath,
      "--mirror-dir",
      mirrorRoot,
      "--json",
    ], { cwd: root });

    const payload = JSON.parse(String(run.stdout || "{}"));
    assert.equal(typeof payload.generatedAt, "string");
    assert.ok(Array.isArray(payload.items));
    assert.ok(payload.items.length > 0);

    const first = payload.items[0];
    assert.equal(typeof first.queueType, "string");
    assert.equal(typeof first.priorityScore, "number");
    assert.equal(typeof first.blockedDuration, "number");
    assert.equal(typeof first.backlogAge, "number");
    assert.equal(typeof first.supportOwner, "string");
    assert.equal(typeof first.serviceTier, "string");
    assert.equal(Array.isArray(first.affectedInstances), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("factory triage-queues human output includes rank duration and routing columns", () => {
  const root = makeTmpDir("factory-fleet-triage-human-");
  try {
    const { configPath } = writeFactoryConfig(root, "mothership");
    const { registryPath, mirrorRoot } = writeFleetFixture(root);

    const run = runCli([
      "factory",
      "triage-queues",
      "--factory-root",
      join(root, "factories", "mothership"),
      "--factory-config-path",
      configPath,
      "--factory-id",
      "mothership",
      "--registry-path",
      registryPath,
      "--mirror-dir",
      mirrorRoot,
      "--format",
      "human",
    ], { cwd: root });

    assert.match(run.stdout, /rank queue\s+priority blocked\s+backlog\s+owner\s+tier\s+affected/i);
    assert.match(run.stdout, /platform_incidents|blocked_instances|repeated_failure_risk/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("factory triage-blast-radius returns exactly one deduped fingerprint view", () => {
  const root = makeTmpDir("factory-fleet-triage-blast-");
  try {
    const { configPath } = writeFactoryConfig(root, "mothership");
    const { registryPath, mirrorRoot } = writeFleetFixture(root);

    const run = runCli([
      "factory",
      "triage-blast-radius",
      "--factory-root",
      join(root, "factories", "mothership"),
      "--factory-config-path",
      configPath,
      "--factory-id",
      "mothership",
      "--registry-path",
      registryPath,
      "--mirror-dir",
      mirrorRoot,
      "--fingerprint",
      "fp-shared-1",
      "--json",
    ], { cwd: root });

    const payload = JSON.parse(String(run.stdout || "{}"));
    assert.equal(payload.ok, true);
    assert.equal(payload.blastRadius.fingerprint, "fp-shared-1");
    assert.equal(payload.blastRadius.affectedInstanceCount, 2);
    assert.deepEqual(payload.blastRadius.affectedInstances, ["alpha", "beta"]);
    assert.equal(typeof payload.blastRadius.supportOwner, "string");
    assert.equal(typeof payload.blastRadius.serviceTier, "string");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("factory triage-blast-radius exits non-zero with structured error when fingerprint missing/unknown", () => {
  const root = makeTmpDir("factory-fleet-triage-error-");
  try {
    const { configPath } = writeFactoryConfig(root, "mothership");
    const { registryPath, mirrorRoot } = writeFleetFixture(root);

    const run = runCli([
      "factory",
      "triage-blast-radius",
      "--factory-root",
      join(root, "factories", "mothership"),
      "--factory-config-path",
      configPath,
      "--factory-id",
      "mothership",
      "--registry-path",
      registryPath,
      "--mirror-dir",
      mirrorRoot,
      "--fingerprint",
      "fp-unknown",
      "--json",
    ], { cwd: root, expectStatus: 2 });

    const payload = JSON.parse(String(run.stdout || "{}"));
    assert.equal(payload.ok, false);
    assert.equal(payload.error_code, "invalid_fingerprint");
    assert.match(String(payload.message || ""), /fingerprint_not_found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
