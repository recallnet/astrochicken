import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildHostRuntimeReleaseManifest,
  produceHostRuntimeReleaseManifest,
  publishHostRuntimeReleaseManifest,
} from "../../src/commands/host-runtime-release-manifest.ts";
import {
  HOST_RUNTIME_RELEASE_SCHEMA_VERSION,
  validateHostRuntimeReleaseManifestContract,
} from "../../src/lib/host-runtime-release-contract.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

function baseManifest() {
  return buildHostRuntimeReleaseManifest({
    version: "v1.2.3",
    channel: "stable",
    provenanceGitSha: "abc123",
    provenanceSourceRef: "refs/tags/v1.2.3",
    buildTimestamp: "2026-03-17T00:00:00.000Z",
    metadataTimestamp: "2026-03-17T00:00:00.000Z",
    supportedKinds: ["example-notes"],
    supportedPlatforms: ["darwin-arm64"],
    artifactUrl: "https://example.invalid/hatch-host-v1.2.3.tgz",
    artifactChecksumSha256: "sha256:abc",
    releaseId: "v1.2.3",
    releaseTag: "v1.2.3",
    releaseSha: "abc123",
    runtimeSignature: "base64-signature",
    runtimeSignatureKeyId: "runtime-key-01",
    runtimeSignatureAlgorithm: "sha256",
  });
}

test("host runtime release manifest contract accepts complete payload", () => {
  const validation = validateHostRuntimeReleaseManifestContract(baseManifest());
  assert.equal(validation.ok, true);
  assert.equal(validation.schema_version, HOST_RUNTIME_RELEASE_SCHEMA_VERSION);
});

test("host runtime release manifest contract fails when required fields are omitted", () => {
  const requiredOmissions = [
    { key: "version", omit: (m) => delete m.version, reason: /missing_version/ },
    { key: "provenance", omit: (m) => delete m.provenance, reason: /missing_provenance/ },
    {
      key: "provenance.git_sha",
      omit: (m) => {
        m.provenance = { ...m.provenance };
        delete m.provenance.git_sha;
      },
      reason: /missing_provenance\.git_sha/,
    },
    { key: "compatibility", omit: (m) => delete m.compatibility, reason: /missing_compatibility/ },
    {
      key: "compatibility.supported_kinds",
      omit: (m) => {
        m.compatibility = { ...m.compatibility };
        delete m.compatibility.supported_kinds;
      },
      reason: /missing_compatibility\.supported_kinds/,
    },
    { key: "artifactRef", omit: (m) => delete m.artifactRef, reason: /missing_artifactRef/ },
    {
      key: "artifactRef.url",
      omit: (m) => {
        m.artifactRef = { ...m.artifactRef };
        delete m.artifactRef.url;
      },
      reason: /missing_artifactRef\.url/,
    },
    { key: "trust", omit: (m) => delete m.trust, reason: /missing_trust/ },
    {
      key: "trust.signature",
      omit: (m) => {
        m.trust = { ...m.trust };
        delete m.trust.signature;
      },
      reason: /missing_trust\.signature/,
    },
    { key: "metadata", omit: (m) => delete m.metadata, reason: /missing_metadata/ },
    {
      key: "metadata.timestamp",
      omit: (m) => {
        m.metadata = { ...m.metadata };
        delete m.metadata.timestamp;
      },
      reason: /missing_metadata\.timestamp/,
    },
  ];

  for (const check of requiredOmissions) {
    const candidate = structuredClone(baseManifest());
    check.omit(candidate);
    const validation = validateHostRuntimeReleaseManifestContract(candidate);
    assert.equal(validation.ok, false, `expected ${check.key} omission to fail`);
    assert.match(validation.reasons.join(","), check.reason);
  }
});

test("produceHostRuntimeReleaseManifest writes validated manifest", () => {
  const temp = mkdtempSync(join(tmpdir(), "host-runtime-release-contract-"));
  try {
    const out = produceHostRuntimeReleaseManifest({
      version: "v9.9.9",
      channel: "canary",
      provenanceGitSha: "deadbeef",
      buildTimestamp: "2026-03-17T01:00:00.000Z",
      metadataTimestamp: "2026-03-17T01:00:00.000Z",
      runtimeSignature: "base64-signature",
      runtimeSignatureKeyId: "runtime-key-01",
      supportedKindsCsv: "example-notes,mothership",
      supportedPlatformsCsv: "darwin-arm64,linux-x64",
      artifactUrl: "https://example.invalid/hatch-host-v9.9.9.tgz",
      runId: "run-001",
      runsDir: join(temp, "runs"),
      releasesDir: join(temp, "releases"),
      repoRoot,
    });

    assert.equal(out.ok, true);
    assert.equal(out.schema_version, HOST_RUNTIME_RELEASE_SCHEMA_VERSION);
    const written = JSON.parse(readFileSync(out.manifest_path, "utf8"));
    assert.equal(written.version, "v9.9.9");
    assert.equal(written.channel, "canary");
    assert.equal(written.trust.signature.stack, "cosign");
    assert.equal(written.trust.signature.key_id, "runtime-key-01");
    assert.equal(written.trust.attestations[0].predicate_type, "https://slsa.dev/provenance/v1");
    assert.equal(written.trust.verifications[0].boundary, "release");
    assert.equal(validateHostRuntimeReleaseManifestContract(written).ok, true);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("produceHostRuntimeReleaseManifest fails closed on missing required generator inputs", () => {
  const temp = mkdtempSync(join(tmpdir(), "host-runtime-release-contract-fail-"));
  try {
    assert.throws(
      () => produceHostRuntimeReleaseManifest({
        channel: "stable",
        supportedKindsCsv: "example-notes",
        supportedPlatformsCsv: "darwin-arm64",
        artifactUrl: "https://example.invalid/runtime.tgz",
        repoRoot: join(temp, "no-git"),
      }),
      /missing_version/,
    );

    assert.throws(
      () => produceHostRuntimeReleaseManifest({
        version: "v1.0.0",
        channel: "stable",
        runtimeSignature: "base64-signature",
        runtimeSignatureKeyId: "runtime-key-01",
        supportedKindsCsv: "example-notes",
        supportedPlatformsCsv: "darwin-arm64",
        artifactUrl: "https://example.invalid/runtime.tgz",
        repoRoot: join(temp, "no-git"),
      }),
      /missing_provenance\.git_sha/,
    );

    assert.throws(
      () => produceHostRuntimeReleaseManifest({
        version: "v1.0.0",
        channel: "stable",
        provenanceGitSha: "abc123",
        runtimeSignature: "base64-signature",
        runtimeSignatureKeyId: "runtime-key-01",
        supportedPlatformsCsv: "darwin-arm64",
        artifactUrl: "https://example.invalid/runtime.tgz",
      }),
      /empty_compatibility\.supported_kinds/,
    );

    assert.throws(
      () => produceHostRuntimeReleaseManifest({
        version: "v1.0.0",
        channel: "stable",
        provenanceGitSha: "abc123",
        supportedKindsCsv: "example-notes",
        runtimeSignature: "base64-signature",
        runtimeSignatureKeyId: "runtime-key-01",
        supportedPlatformsCsv: "darwin-arm64",
      }),
      /missing_artifactRef\.url/,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("publishHostRuntimeReleaseManifest uses control-plane release asset primitive and persists asset metadata", async () => {
  const temp = mkdtempSync(join(tmpdir(), "host-runtime-release-publish-"));
  try {
    const out = await publishHostRuntimeReleaseManifest({
      repo: "recallnet/astrochicken",
      version: "v2.0.0",
      channel: "stable",
      releaseId: "v2.0.0",
      releaseTag: "v2.0.0",
      releaseSha: "abc123",
      provenanceGitSha: "abc123",
      supportedKindsCsv: "example-notes",
      supportedPlatformsCsv: "darwin-arm64",
      artifactUrl: "https://example.invalid/hatch-host-v2.0.0.tgz",
      runtimeSignature: "base64-signature",
      runtimeSignatureKeyId: "runtime-key-01",
      runtimeSignatureAlgorithm: "sha256",
      outPath: join(temp, "host-runtime-release.json"),
      publishManifestAssetFn: async () => ({
        release_id: "v2.0.0",
        release_tag: "v2.0.0",
        release_sha: "abc123",
        asset_id: "asset-42",
        asset_url: "https://example.invalid/assets/42",
        manifest_path: "control-plane-manifests/host-runtime-release.json",
      }),
    });

    assert.equal(out.ok, true);
    assert.equal(out.publish.asset_id, "asset-42");
    const written = JSON.parse(readFileSync(out.manifest_path, "utf8"));
    assert.equal(written.artifactRef.asset_id, "asset-42");
    assert.equal(written.artifactRef.asset_path, "control-plane-manifests/host-runtime-release.json");
    assert.equal(written.trust.signature.signature, "base64-signature");
    assert.equal(written.trust.signature.key_id, "runtime-key-01");
    assert.equal(written.trust.signature.signature_algorithm, "sha256");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("host runtime-release build CLI fails closed for missing required fields", () => {
  const run = spawnSync("node", [
    opsCliPath,
    "host",
    "runtime-release",
    "build",
    "--version",
    "v1.0.0",
    "--channel",
    "stable",
    "--supported-kinds",
    "example-notes",
    "--supported-platforms",
    "darwin-arm64",
    "--runtime-signature",
    "base64-signature",
    "--runtime-signature-key-id",
    "runtime-key-01",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 1);
  assert.match(String(run.stderr || ""), /host_runtime_release_contract_violation:missing_artifactRef\.url/);
});
