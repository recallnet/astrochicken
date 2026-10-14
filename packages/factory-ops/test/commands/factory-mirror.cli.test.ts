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


function makeTmpDir(prefix = "factory-mirror-cli-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeFactoryConfig(rootDir, factoryId = "brainstorm") {
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

function runCli(args, { cwd = repoRoot, expectStatus = 0 } = {}) {
  const run = spawnOpsCli([
      ...args
    ], {
      cwd
    });
  assert.equal(run.status, expectStatus, `stderr=${run.stderr}\nstdout=${run.stdout}`);
  return run;
}

test("factory-mirror snapshots --json reads mirrored snapshots", () => {
  const root = makeTmpDir("factory-mirror-cli-snapshots-");
  try {
    const { configPath } = writeFactoryConfig(root, "brainstorm");
    const mirrorRoot = join(root, "mirror-store");
    const instanceDir = join(mirrorRoot, "fac_01TEST");
    mkdirSync(instanceDir, { recursive: true });

    writeJson(join(instanceDir, "snapshot.json"), {
      schema_version: "managed-factory-snapshot-mirror/v1",
      factory_id: "brainstorm",
      instance_id: "fac_01TEST",
      state_version: 11,
      mirror_version: 11,
      mirror_updated_at: "2026-03-16T21:40:00.000Z",
      lifecycle_state: "active",
      lifecycle_reason: "processing intake",
      blockers: {
        upstream: {
          has_open_upstream_bugs: false,
          open_upstream_bug_count: 0,
          open_upstream_bug_numbers: [],
        },
        action_items: {
          has_action_items: false,
          action_item_count: 0,
        },
      },
      unresolved_actions: 0,
      queue_depth: 2,
      oldest_work_age_seconds: 45,
      latest_incidents: [],
    });

    const run = runCli([
      "factory-mirror",
      "snapshots",
      "--factory-root",
      join(root, "factories", "brainstorm"),
      "--factory-config-path",
      configPath,
      "--factory-id",
      "brainstorm",
      "--mirror-dir",
      mirrorRoot,
      "--json",
    ], { cwd: root });

    const out = JSON.parse(String(run.stdout || "{}"));
    assert.equal(out.ok, true);
    assert.equal(out.factory_id, "brainstorm");
    assert.equal(out.snapshot_count, 1);
    assert.equal(out.snapshots[0].instance_id, "fac_01TEST");
    assert.equal(out.snapshots[0].state_version, 11);
    assert.equal(out.snapshots[0].lifecycle_state, "active");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("factory-mirror events --json reads recent mirrored events", () => {
  const root = makeTmpDir("factory-mirror-cli-events-");
  try {
    const { configPath } = writeFactoryConfig(root, "brainstorm");
    const mirrorRoot = join(root, "mirror-store");
    mkdirSync(mirrorRoot, { recursive: true });

    writeJson(join(mirrorRoot, "events.json"), [
      {
        factory_id: "brainstorm",
        instance_id: "fac_01TEST",
        installation_id: "inst_01TEST",
        host_id: "host-a",
        kind_id: "brainstorm",
        run_id: "run-21",
        tick_id: "tick-21",
        event_type: "factory.lifecycle.tick",
        status: "completed",
        started_at: "2026-03-16T21:00:00.000Z",
        ended_at: "2026-03-16T21:00:04.000Z",
        duration_ms: 4000,
        incident_fingerprint: "sha256:test-a",
        runtime_version: "1.2.3",
        kind_version: "2026.03.16",
        policy_profile: "policy_pack:v1",
      },
      {
        factory_id: "brainstorm",
        instance_id: "fac_01TEST",
        installation_id: "inst_01TEST",
        host_id: "host-a",
        kind_id: "brainstorm",
        run_id: "run-22",
        tick_id: "tick-22",
        event_type: "factory.lifecycle.tick",
        status: "failed",
        started_at: "2026-03-16T21:01:00.000Z",
        ended_at: "2026-03-16T21:01:05.000Z",
        duration_ms: 5000,
        incident_fingerprint: "sha256:test-b",
        runtime_version: "1.2.3",
        kind_version: "2026.03.16",
        policy_profile: "policy_pack:v1",
      },
    ]);

    const run = runCli([
      "factory-mirror",
      "events",
      "--factory-root",
      join(root, "factories", "brainstorm"),
      "--factory-config-path",
      configPath,
      "--factory-id",
      "brainstorm",
      "--mirror-dir",
      mirrorRoot,
      "--limit",
      "1",
      "--json",
    ], { cwd: root });

    const out = JSON.parse(String(run.stdout || "{}"));
    assert.equal(out.ok, true);
    assert.equal(out.factory_id, "brainstorm");
    assert.equal(out.events.length, 1);
    const event = out.events[0];
    assert.equal(event.run_id, "run-22");
    assert.equal(event.tick_id, "tick-22");
    assert.equal(event.event_type, "factory.lifecycle.tick");
    assert.equal(event.status, "failed");
    assert.equal(event.incident_fingerprint, "sha256:test-b");
    assert.equal(event.runtime_version, "1.2.3");
    assert.equal(event.kind_version, "2026.03.16");
    assert.equal(event.policy_profile, "policy_pack:v1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("factory-mirror events exits non-zero when mirror path is missing", () => {
  const root = makeTmpDir("factory-mirror-cli-events-missing-");
  try {
    const { configPath } = writeFactoryConfig(root, "brainstorm");
    const mirrorRoot = join(root, "missing-mirror");

    const run = runCli([
      "factory-mirror",
      "events",
      "--factory-root",
      join(root, "factories", "brainstorm"),
      "--factory-config-path",
      configPath,
      "--factory-id",
      "brainstorm",
      "--mirror-dir",
      mirrorRoot,
      "--json",
    ], { cwd: root, expectStatus: 1 });

    const out = JSON.parse(String(run.stdout || "{}"));
    assert.equal(out.ok, false);
    assert.equal(out.error, "mirror_missing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
