import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildReleaseManifest } from "../../src/commands/release-manifest.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

function writeRegistry() {
  const root = mkdtempSync(join(tmpdir(), "release-targeting-cli-"));
  const path = join(root, "factory-registry.json");
  writeFileSync(path, JSON.stringify({
    schema: "hatch.factory.registry.v1",
    factories: [{
      id: "sample-factory",
      repo: "example/sample-factory",
      graphs: [{ id: "tick", path: "factories/sample/graphs/factory_supervisor_tick.dot" }],
      daemonStatus: { status: "running" },
    }],
  }, null, 2));
  return path;
}

function buildFetchCommand(manifest) {
  const encoded = Buffer.from(JSON.stringify(manifest), "utf8").toString("base64");
  return `node -e "process.stdout.write(Buffer.from('${encoded}','base64').toString('utf8'))"`;
}

function makeManifest({ schemaVersion = "factory_release_manifest/v1" } = {}) {
  const manifest = buildReleaseManifest({
    controlPlaneRepo: "recallnet/astrochicken",
    releaseTag: "v2.4.0",
    releaseSha: "sha-240",
    entries: [{
      source_repo: "example/sample-factory",
      source_issue: 100,
      source_issue_url: "https://example/100",
      summary: "sample",
      status: "blocked_upstream",
      required_factory_release: "2.0.0",
      factory_id: "sample-factory",
      signature_hash: "sha256:sample-100",
      linkage: {
        schema_version: "factory_link.v1",
        control_plane_repo: "recallnet/astrochicken",
        control_plane_goal: 4100,
        source_repo: "example/sample-factory",
        source_issue: 100,
        status: "blocked_upstream",
        factory_id: "sample-factory",
        required_factory_release: "2.0.0",
        signature_hash: "sha256:sample-100",
      },
    }],
  });

  manifest.schema_version = schemaVersion;
  manifest.rollout.controller.status = "promoted";
  manifest.rollout.controller.stage = "general";
  manifest.rollout.controller.resume_blocked = false;
  return manifest;
}

test("factory release-targeting-status CLI command wiring includes required flags", () => {
  const source = readFileSync("packages/factory-ops/src/cli/commands/factory-release-cmds.ts", "utf8");
  assert.match(source, /class FactoryReleaseTargetingStatusCommand/);
  assert.match(source, /FactoryReleaseTargetingStatusCommand[\s\S]*static paths = \[\["factory", "release-targeting-status"\]\]/);
  assert.match(source, /FactoryReleaseTargetingStatusCommand[\s\S]*Option\.String\("--registry-path", "factory-registry\.json"\)/);
  assert.match(source, /FactoryReleaseTargetingStatusCommand[\s\S]*Option\.String\("--policy-path", ""\)/);
  assert.match(source, /FactoryReleaseTargetingStatusCommand[\s\S]*Option\.String\("--policy-json", ""\)/);
  assert.match(source, /FactoryReleaseTargetingStatusCommand[\s\S]*Option\.String\("--local-release-cmd-by-factory", ""\)/);
  assert.match(source, /FactoryReleaseTargetingStatusCommand[\s\S]*Option\.String\("--manifest-path", ""\)/);
  assert.match(source, /FactoryReleaseTargetingStatusCommand[\s\S]*Option\.String\("--manifest-ref", ""\)/);
  assert.match(source, /FactoryReleaseTargetingStatusCommand[\s\S]*Option\.String\("--manifest-fetch-cmd", ""\)/);
  assert.match(source, /FactoryReleaseTargetingStatusCommand[\s\S]*Option\.Boolean\("--json", false\)/);
});

test("factory release-targeting-status --json returns normalized fleet contract", () => {
  const registryPath = writeRegistry();
  const manifest = makeManifest();
  const run = spawnSync("node", [
    opsCliPath,
    "factory",
    "release-targeting-status",
    "--registry-path",
    registryPath,
    "--policy-json",
    JSON.stringify({
      control_plane_repo: "recallnet/astrochicken",
      rollout: { default_channel: "stable" },
      factory_releases: { repos: { "example/sample-factory": "2.1.0" } },
    }),
    "--manifest-fetch-cmd",
    buildFetchCommand(manifest),
    "--json",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout || "{}");

  assert.equal(typeof payload.generated_at, "string");
  assert.ok(payload.fleet_totals && typeof payload.fleet_totals === "object");
  assert.ok(Array.isArray(payload.factories));
  assert.equal(payload.factories.length, 1);

  const row = payload.factories[0];
  assert.equal(row.factory_id, "sample-factory");
  assert.equal(row.rollout_channel, "stable");
  assert.ok(Object.hasOwn(row, "required_factory_release"));
  assert.ok(Object.hasOwn(row, "gate_reason"));
  assert.ok(Object.hasOwn(row, "release_identity"));
  assert.ok(Object.hasOwn(row, "upgrade_verification_outcome"));
  assert.ok(Object.hasOwn(row, "resume_blocked"));
  assert.ok(Object.hasOwn(row, "selected_for_canary"));
  assert.ok(["ready", "blocked", "lagging", "unknown"].includes(row.rollout_status));
});

test("factory release-targeting-status --json handles three-factory registry with manifest-fetch-cmd", () => {
  const root = mkdtempSync(join(tmpdir(), "release-targeting-cli-three-factory-"));
  const registryPath = join(root, "factory-registry.json");
  writeFileSync(registryPath, JSON.stringify({
    schema: "hatch.factory.registry.v1",
    factories: [
      {
        id: "factory-a",
        repo: "example/factory-a",
        graphs: [{ id: "tick", path: "factories/a/graphs/factory_supervisor_tick.dot" }],
        daemonStatus: { status: "running" },
      },
      {
        id: "factory-b",
        repo: "example/factory-b",
        graphs: [{ id: "tick", path: "factories/b/graphs/factory_supervisor_tick.dot" }],
        daemonStatus: { status: "running" },
      },
      {
        id: "factory-c",
        repo: "example/factory-c",
        graphs: [{ id: "tick", path: "factories/c/graphs/factory_supervisor_tick.dot" }],
        daemonStatus: { status: "running" },
      },
    ],
  }, null, 2));

  const manifest = buildReleaseManifest({
    controlPlaneRepo: "recallnet/astrochicken",
    releaseTag: "v2.5.0",
    releaseSha: "sha-250",
    entries: [
      {
        source_repo: "example/factory-a",
        source_issue: 200,
        source_issue_url: "https://example/200",
        summary: "factory-a",
        status: "blocked_upstream",
        required_factory_release: "2.1.0",
        factory_id: "factory-a",
        signature_hash: "sha256:factory-a-200",
        linkage: {
          schema_version: "factory_link.v1",
          control_plane_repo: "recallnet/astrochicken",
          control_plane_goal: 5200,
          source_repo: "example/factory-a",
          source_issue: 200,
          status: "blocked_upstream",
          factory_id: "factory-a",
          required_factory_release: "2.1.0",
          signature_hash: "sha256:factory-a-200",
        },
      },
      {
        source_repo: "example/factory-b",
        source_issue: 201,
        source_issue_url: "https://example/201",
        summary: "factory-b",
        status: "blocked_upstream",
        required_factory_release: "2.2.0",
        factory_id: "factory-b",
        signature_hash: "sha256:factory-b-201",
        linkage: {
          schema_version: "factory_link.v1",
          control_plane_repo: "recallnet/astrochicken",
          control_plane_goal: 5201,
          source_repo: "example/factory-b",
          source_issue: 201,
          status: "blocked_upstream",
          factory_id: "factory-b",
          required_factory_release: "2.2.0",
          signature_hash: "sha256:factory-b-201",
        },
      },
      {
        source_repo: "example/factory-c",
        source_issue: 202,
        source_issue_url: "https://example/202",
        summary: "factory-c",
        status: "blocked_upstream",
        required_factory_release: "2.3.0",
        factory_id: "factory-c",
        signature_hash: "sha256:factory-c-202",
        linkage: {
          schema_version: "factory_link.v1",
          control_plane_repo: "recallnet/astrochicken",
          control_plane_goal: 5202,
          source_repo: "example/factory-c",
          source_issue: 202,
          status: "blocked_upstream",
          factory_id: "factory-c",
          required_factory_release: "2.3.0",
          signature_hash: "sha256:factory-c-202",
        },
      },
    ],
  });
  manifest.rollout.controller.status = "promoted";
  manifest.rollout.controller.stage = "general";
  manifest.rollout.controller.resume_blocked = false;

  const run = spawnSync("node", [
    opsCliPath,
    "factory",
    "release-targeting-status",
    "--registry-path",
    registryPath,
    "--policy-json",
    JSON.stringify({
      control_plane_repo: "recallnet/astrochicken",
      rollout: { default_channel: "stable" },
      factory_releases: {
        repos: {
          "example/factory-a": "2.1.0",
          "example/factory-b": "2.0.0",
          "example/factory-c": "2.5.0",
        },
      },
    }),
    "--manifest-fetch-cmd",
    buildFetchCommand(manifest),
    "--json",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);

  const payload = JSON.parse(run.stdout || "{}");
  assert.equal(payload?.fleet_totals?.total_factories, 3);
  assert.equal(Array.isArray(payload?.factories), true);
  assert.equal(payload.factories.length, 3);

  for (const row of payload.factories) {
    assert.ok(["ready", "blocked", "lagging", "unknown"].includes(row?.rollout_status));
  }
});

test("factory release-targeting-status human output prints totals and one-line rows", () => {
  const registryPath = writeRegistry();
  const manifest = makeManifest();
  const run = spawnSync("node", [
    opsCliPath,
    "factory",
    "release-targeting-status",
    "--registry-path",
    registryPath,
    "--policy-json",
    JSON.stringify({
      control_plane_repo: "recallnet/astrochicken",
      rollout: { default_channel: "stable" },
      factory_releases: { repos: { "example/sample-factory": "2.1.0" } },
    }),
    "--manifest-fetch-cmd",
    buildFetchCommand(manifest),
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /Fleet release targeting total=1/);
  assert.match(run.stdout, /sample-factory channel=stable release=v2\.4\.0 status=ready/);
  assert.match(run.stdout, /reason=resume gate ready/);
});

test("factory release-targeting-status exits non-zero on manifest schema mismatch", () => {
  const registryPath = writeRegistry();
  const invalidManifest = makeManifest({ schemaVersion: "factory_release_manifest/v2" });
  const run = spawnSync("node", [
    opsCliPath,
    "factory",
    "release-targeting-status",
    "--registry-path",
    registryPath,
    "--policy-json",
    JSON.stringify({
      control_plane_repo: "recallnet/astrochicken",
      rollout: { default_channel: "stable" },
    }),
    "--manifest-fetch-cmd",
    buildFetchCommand(invalidManifest),
    "--json",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 1, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout || "{}");
  assert.equal(payload.fleet_totals.manifest_failures, 1);
  assert.equal(payload.factories[0].gate_reason, "manifest_schema_mismatch");
});
