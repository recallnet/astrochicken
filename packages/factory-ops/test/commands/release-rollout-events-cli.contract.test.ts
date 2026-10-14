import { spawnOpsCli } from "../helpers/ops-command-cli-fixture.ts";
import assert from "node:assert/strict";

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";


import { RELEASE_ROLLOUT_EVENT_SCHEMA_VERSION } from "../../src/commands/release-rollout-controller.ts";

function writeManifestFixture({ events = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "release-rollout-events-"));
  const manifestPath = join(root, "release-manifest.json");

  const manifest = {
    schema_version: "factory_release_manifest/v1",
    release: {
      control_plane_repo: "recallnet/astrochicken",
      sha: "sha-100",
      tag: "v1.0.0",
    },
    rollout: {
      schema_version: "release_rollout_state/v1",
      controller: {
        status: "promoted",
        stage: "general",
        resume_blocked: false,
        rollback_reason: "",
        canary_factory_ids: [],
        events,
      },
    },
    compatibility_matrix: {
      required_factory_release_floor: "1.0.0",
      required_factory_releases: ["1.0.0"],
      by_factory: [],
    },
    artifacts: [],
  };

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

test("release rollout-events --json emits rollout event array with required fields", () => {
  const manifestPath = writeManifestFixture({
    events: [
      {
        schema_version: RELEASE_ROLLOUT_EVENT_SCHEMA_VERSION,
        action: "promote",
        channel: "general",
        status: "promoted",
        reason: "health_checks_passed",
        release_id: "v1.0.0",
        at: "2026-03-09T12:00:00.000Z",
      },
      {
        schema_version: RELEASE_ROLLOUT_EVENT_SCHEMA_VERSION,
        action: "publish_manifest_asset",
        channel: "release",
        status: "published",
        reason: "control_plane_manifest_published",
        release_id: "v1.0.0",
        at: "2026-03-09T12:01:00.000Z",
      },
    ],
  });

  const run = spawnOpsCli([
      "release",
      "rollout-events",
      "--json",
      "--manifest-path",
      manifestPath
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout || "[]");
  assert.ok(Array.isArray(payload));
  assert.equal(payload.length, 2);

  for (const event of payload) {
    assert.equal(event.schema_version, RELEASE_ROLLOUT_EVENT_SCHEMA_VERSION);
    assert.equal(typeof event.action, "string");
    assert.equal(typeof event.channel, "string");
    assert.equal(typeof event.status, "string");
    assert.equal(typeof event.reason, "string");
    assert.equal(typeof event.release_id, "string");
    assert.equal(typeof event.at, "string");
  }
});

test("release rollout-events prints [] for empty event logs in json mode", () => {
  const manifestPath = writeManifestFixture({ events: [] });

  const jsonRun = spawnOpsCli([
      "release",
      "rollout-events",
      "--json",
      "--manifest-path",
      manifestPath
    ]);

  assert.equal(jsonRun.status, 0, jsonRun.stderr || jsonRun.stdout);
  assert.deepEqual(JSON.parse(jsonRun.stdout || "[]"), []);

  const humanRun = spawnOpsCli([
      "release",
      "rollout-events",
      "--manifest-path",
      manifestPath
    ]);

  assert.equal(humanRun.status, 0, humanRun.stderr || humanRun.stdout);
  assert.match(humanRun.stdout, /No rollout events/);
});

test("release rollout-events fails clearly when manifest path is missing", () => {
  const run = spawnOpsCli([
      "release",
      "rollout-events",
      "--manifest-path",
      "/tmp/does-not-exist-release-manifest.json"
    ]);

  assert.equal(run.status, 1);
  assert.match(run.stderr, /release rollout-events failed:/);
  assert.match(run.stderr, /manifest not found at/);
});
