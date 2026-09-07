import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildReleaseManifest } from "../../src/commands/release-manifest.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

function makeManifest() {
  return buildReleaseManifest({
    controlPlaneRepo: "recallnet/astrochicken",
    releaseTag: "v2.7.1",
    releaseSha: "sha-271",
    entries: [{
      source_repo: "example/sample-factory",
      source_issue: 201,
      source_issue_url: "https://example/201",
      summary: "sample",
      status: "blocked_upstream",
      required_factory_release: "2.7.0",
      factory_id: "sample-factory",
      signature_hash: "sha256:sample-201",
      linkage: {
        schema_version: "factory_link.v1",
        control_plane_repo: "recallnet/astrochicken",
        control_plane_goal: 1511,
        source_repo: "example/sample-factory",
        source_issue: 201,
        status: "blocked_upstream",
        factory_id: "sample-factory",
        required_factory_release: "2.7.0",
        signature_hash: "sha256:sample-201",
      },
    }],
  });
}

function setupPaths() {
  const root = mkdtempSync(join(tmpdir(), "factory-manifest-sync-cli-"));
  const manifestPath = join(root, "release-manifest.json");
  return { root, manifestPath };
}

test("factory publish-control-plane-manifest command wiring includes required flags", () => {
  const source = readFileSync("packages/factory-ops/src/cli/commands/factory-release-cmds.ts", "utf8");
  assert.match(source, /class FactoryPublishControlPlaneManifestCommand/);
  assert.match(source, /FactoryPublishControlPlaneManifestCommand[\s\S]*static paths = \[\["factory", "publish-control-plane-manifest"\]\]/);
  assert.match(source, /FactoryPublishControlPlaneManifestCommand[\s\S]*Option\.String\("--manifest-path", \{ required: true \}\)/);
  assert.match(source, /FactoryPublishControlPlaneManifestCommand[\s\S]*Option\.String\("--repo-root", "\."\)/);
});

test("factory publish-control-plane-manifest exits 0 and prints manifest paths on success", () => {
  const paths = setupPaths();
  try {
    writeFileSync(paths.manifestPath, JSON.stringify(makeManifest(), null, 2));

    const run = spawnSync("node", [
      opsCliPath,
      "factory",
      "publish-control-plane-manifest",
      "--manifest-path",
      paths.manifestPath,
      "--repo-root",
      paths.root,
    ], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.equal(run.status, 0, run.stderr || run.stdout);
    const payload = JSON.parse(run.stdout || "{}");
    assert.equal(payload.ok, true);
    assert.equal(payload.reason, "manifest_synced");
    assert.equal(typeof payload.manifest_paths?.canary, "string");
    assert.equal(typeof payload.manifest_paths?.stable, "string");
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("factory publish-control-plane-manifest exits 1 with deterministic missing-manifest recovery", () => {
  const paths = setupPaths();
  try {
    const run = spawnSync("node", [
      opsCliPath,
      "factory",
      "publish-control-plane-manifest",
      "--manifest-path",
      paths.manifestPath,
      "--repo-root",
      paths.root,
    ], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.equal(run.status, 1, run.stderr || run.stdout);
    const payload = JSON.parse(run.stdout || "{}");
    assert.equal(payload.ok, false);
    assert.equal(payload.reason, "manifest_missing");
    assert.match(payload.recovery, /factory publish-control-plane-manifest/);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});
