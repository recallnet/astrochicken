import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildReleaseManifest, syncControlPlaneManifest } from "../../src/lib/control-plane-manifest.ts";

function makeManifest() {
  return buildReleaseManifest({
    controlPlaneRepo: "recallnet/astrochicken",
    releaseTag: "v2.7.0",
    releaseSha: "sha-270",
    entries: [{
      source_repo: "example/sample-factory",
      source_issue: 101,
      source_issue_url: "https://example/101",
      summary: "sample",
      status: "blocked_upstream",
      required_factory_release: "2.6.0",
      factory_id: "sample-factory",
      signature_hash: "sha256:sample-101",
      linkage: {
        schema_version: "factory_link.v1",
        control_plane_repo: "recallnet/astrochicken",
        control_plane_goal: 1511,
        source_repo: "example/sample-factory",
        source_issue: 101,
        status: "blocked_upstream",
        factory_id: "sample-factory",
        required_factory_release: "2.6.0",
        signature_hash: "sha256:sample-101",
      },
    }],
  });
}

function setupPaths() {
  const root = mkdtempSync(join(tmpdir(), "control-plane-manifest-sync-"));
  const manifestPath = join(root, "candidate", "release-manifest.json");
  mkdirSync(join(root, "candidate"), { recursive: true });
  return {
    root,
    manifestPath,
  };
}

test("syncControlPlaneManifest writes canonical canary/stable release manifests", () => {
  const paths = setupPaths();
  try {
    const manifest = makeManifest();
    writeFileSync(paths.manifestPath, JSON.stringify(manifest, null, 2));

    const out = syncControlPlaneManifest({
      manifestPath: paths.manifestPath,
      repoRoot: paths.root,
      channels: ["canary", "stable", "CANARY", " stable "],
    });

    assert.equal(out.ok, true);
    assert.equal(out.reason, "manifest_synced");
    assert.equal(typeof out.manifest_paths.canary, "string");
    assert.equal(typeof out.manifest_paths.stable, "string");
    assert.match(out.manifest_paths.canary, /\.hatch[\\/]releases[\\/]canary[\\/]release-manifest\.json$/);
    assert.match(out.manifest_paths.stable, /\.hatch[\\/]releases[\\/]stable[\\/]release-manifest\.json$/);
    assert.equal(existsSync(out.manifest_paths.canary), true);
    assert.equal(existsSync(out.manifest_paths.stable), true);

    const canary = JSON.parse(readFileSync(out.manifest_paths.canary, "utf8"));
    const stable = JSON.parse(readFileSync(out.manifest_paths.stable, "utf8"));
    assert.deepEqual(canary, stable);
    assert.deepEqual(canary, manifest);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("syncControlPlaneManifest fails closed with publish-control-plane-manifest recovery when source manifest is missing", () => {
  const paths = setupPaths();
  try {
    const out = syncControlPlaneManifest({
      manifestPath: paths.manifestPath,
      repoRoot: paths.root,
    });

    assert.equal(out.ok, false);
    assert.equal(out.reason, "manifest_missing");
    assert.equal(out.manifest_path.endsWith("release-manifest.json"), true);
    assert.deepEqual(out.channels, ["canary", "stable"]);
    assert.match(out.recovery, /factory publish-control-plane-manifest/);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("syncControlPlaneManifest rejects invalid release manifest contracts", () => {
  const paths = setupPaths();
  try {
    const manifest = makeManifest();
    manifest.schema_version = "factory_release_manifest/v2";
    writeFileSync(paths.manifestPath, JSON.stringify(manifest, null, 2));

    const out = syncControlPlaneManifest({
      manifestPath: paths.manifestPath,
      channels: "canary,stable",
      repoRoot: paths.root,
    });

    assert.equal(out.ok, false);
    assert.equal(out.reason, "manifest_invalid_contract");
    assert.equal(Array.isArray(out.validation_errors), true);
    assert.ok(out.validation_errors.some((reason) => reason.startsWith("invalid_schema_version:")));
    assert.equal(existsSync(join(paths.root, ".hatch", "releases", "canary", "release-manifest.json")), false);
    assert.equal(existsSync(join(paths.root, ".hatch", "releases", "stable", "release-manifest.json")), false);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});
