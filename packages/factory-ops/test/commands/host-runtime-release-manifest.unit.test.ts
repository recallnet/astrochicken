import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  produceHostRuntimeReleaseManifest,
  publishHostRuntimeReleaseManifest,
} from "../../src/commands/host-runtime-release-manifest.ts";

test("produceHostRuntimeReleaseManifest writes host runtime release artifact manifest", () => {
  const temp = mkdtempSync(join(tmpdir(), "host-runtime-release-manifest-unit-"));
  try {
    const out = produceHostRuntimeReleaseManifest({
      version: "v3.0.0",
      channel: "canary",
      provenanceGitSha: "abc123",
      runtimeSignature: "base64-signature",
      runtimeSignatureKeyId: "runtime-key-01",
      supportedKindsCsv: "example-notes,mothership",
      supportedPlatformsCsv: "darwin-arm64,linux-x64",
      artifactUrl: "https://example.invalid/hatch-host-v3.0.0.tgz",
      outPath: join(temp, "host-runtime-release.json"),
    });

    assert.equal(out.ok, true);
    const manifest = JSON.parse(readFileSync(out.manifest_path, "utf8"));
    assert.equal(manifest.version, "v3.0.0");
    assert.equal(manifest.channel, "canary");
    assert.deepEqual(manifest.compatibility.supported_kinds, ["example-notes", "mothership"]);
    assert.equal(manifest.artifactRef.url, "https://example.invalid/hatch-host-v3.0.0.tgz");
    assert.equal(manifest.trust.signature.signature, "base64-signature");
    assert.equal(manifest.trust.signature.key_id, "runtime-key-01");
    assert.equal(manifest.trust.attestations[0].predicate_type, "https://slsa.dev/provenance/v1");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("publishHostRuntimeReleaseManifest publishes manifest asset and persists published asset metadata", async () => {
  const temp = mkdtempSync(join(tmpdir(), "host-runtime-release-publish-unit-"));
  const publishCalls = [];
  try {
    const out = await publishHostRuntimeReleaseManifest({
      repo: "recallnet/astrochicken",
      version: "v3.1.0",
      channel: "stable",
      releaseId: "v3.1.0",
      releaseTag: "v3.1.0",
      releaseSha: "def456",
      provenanceGitSha: "def456",
      runtimeSignature: "base64-signature",
      runtimeSignatureKeyId: "runtime-key-01",
      supportedKindsCsv: "example-notes",
      supportedPlatformsCsv: "darwin-arm64",
      artifactUrl: "https://example.invalid/hatch-host-v3.1.0.tgz",
      outPath: join(temp, "host-runtime-release.json"),
      publishManifestAssetFn: async (payload) => {
        publishCalls.push(payload);
        return {
          release_id: "v3.1.0",
          release_tag: "v3.1.0",
          release_sha: "def456",
          asset_id: "asset-77",
          asset_url: "https://example.invalid/assets/77",
          manifest_path: "control-plane-manifests/host-runtime-release.json",
        };
      },
    });

    assert.equal(out.ok, true);
    assert.equal(publishCalls.length, 1);

    const manifest = JSON.parse(readFileSync(out.manifest_path, "utf8"));
    assert.equal(manifest.artifactRef.asset_id, "asset-77");
    assert.equal(manifest.artifactRef.asset_path, "control-plane-manifests/host-runtime-release.json");
    assert.equal(manifest.trust.signature.key_id, "runtime-key-01");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
