import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  buildArtifactTrustBundle,
  buildArtifactVerificationRecord,
  buildCosignSignatureRecord,
  buildSlsaAttestation,
  buildSlsaProvenancePredicate,
  defineArtifactTrustPolicy,
} from "@hatch/factory-core/artifact-trust-registry";

import { publishControlPlaneReleaseAsset } from "./control-plane-release-asset.ts";
import { stableStringify } from "./tick-artifact.ts";
import { trim } from "../lib/cli-helpers.ts";
import {
  HOST_RUNTIME_RELEASE_SCHEMA_VERSION,
  validateHostRuntimeReleaseManifestContract,
} from "../lib/host-runtime-release-contract.ts";

const HOST_RUNTIME_RELEASE_FILENAME = "host-runtime-release.json";

function parseCsv(value = "") {
  return String(value || "")
    .split(",")
    .map((entry) => trim(entry))
    .filter(Boolean);
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => trim(value)).filter(Boolean))];
}

function normalizeVersionToken(value = "") {
  return trim(value).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
}

function resolveReleaseVersion({ version = "", releaseTag = "", releaseSha = "" } = {}) {
  const explicit = normalizeVersionToken(version);
  if (explicit) return explicit;

  const tag = normalizeVersionToken(releaseTag);
  if (tag) return tag;

  const sha = normalizeVersionToken(releaseSha);
  if (sha) return sha;

  return "";
}

function resolveGitSha(repoRoot = ".") {
  try {
    return trim(execSync("git rev-parse HEAD", { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }));
  } catch {
    return "";
  }
}

function resolveManifestPath({ version = "", runId = "", runsDir = ".hatch/runs", releasesDir = ".hatch/releases", outPath = "" } = {}) {
  const explicit = trim(outPath);
  if (explicit) return explicit;

  const run = trim(runId);
  if (run) {
    return join(trim(runsDir || ".hatch/runs"), run, "artifacts", HOST_RUNTIME_RELEASE_FILENAME);
  }

  const releaseVersion = normalizeVersionToken(version) || "unversioned";
  return join(trim(releasesDir || ".hatch/releases"), "host-runtime", releaseVersion, HOST_RUNTIME_RELEASE_FILENAME);
}

function assertContractOrThrow(manifest = {}) {
  const validation = validateHostRuntimeReleaseManifestContract(manifest);
  if (!validation.ok) {
    const reason = (validation.reasons || []).join(",") || "unknown_contract_error";
    throw new Error(`host_runtime_release_contract_violation:${reason}`);
  }
}

function buildHostRuntimeReleaseTrust({
  version = "",
  channel = "",
  releaseId = "",
  releaseTag = "",
  releaseSha = "",
  provenanceGitSha = "",
  artifactUrl = "",
  artifactChecksumSha256 = "",
  runtimeSignature = "",
  runtimeSignatureKeyId = "",
  runtimeSignatureAlgorithm = "sha256",
  buildTimestamp = "",
} = {}) {
  const policy = defineArtifactTrustPolicy({
    rationale: "Host runtime release manifests are promotion-critical release artifacts and must use the canonical signing, attestation, and provenance stack.",
  });
  const signature = buildCosignSignatureRecord({
    keyId: trim(runtimeSignatureKeyId),
    signature: trim(runtimeSignature),
    signatureAlgorithm: trim(runtimeSignatureAlgorithm || "sha256"),
    payloadRef: trim(artifactUrl) || trim(releaseId) || trim(version),
    payloadType: "runtime_entrypoint",
    payloadDigest: trim(artifactChecksumSha256) || "sha256:unknown",
  });
  const attestation = buildSlsaAttestation({
    predicate: buildSlsaProvenancePredicate({
      buildType: "https://recallnet.dev/build/host-runtime-release",
      builderId: "https://recallnet.dev/builders/host-runtime-release",
      invocationId: trim(releaseId) || trim(version),
      startedOn: trim(buildTimestamp),
      finishedOn: trim(buildTimestamp),
      externalParameters: {
        channel: trim(channel),
        artifact_url: trim(artifactUrl),
      },
      internalParameters: {
        release_tag: trim(releaseTag),
        release_sha: trim(releaseSha || provenanceGitSha),
        version: trim(version),
      },
      resolvedDependencies: [{
        uri: "git+https://github.com/recallnet/astrochicken",
        digest: {
          sha1: trim(provenanceGitSha || releaseSha),
        },
      }],
    }),
    keyId: trim(runtimeSignatureKeyId),
    signature: trim(runtimeSignature),
  });

  return buildArtifactTrustBundle({
    policy,
    signature,
    attestations: [attestation],
    verifications: [buildArtifactVerificationRecord({
      boundary: "release",
      status: "verified",
      verifiedAt: trim(buildTimestamp),
    })],
  });
}

export function buildHostRuntimeReleaseManifest({
  version = "",
  channel = "",
  provenanceGitSha = "",
  provenanceSourceRef = "",
  buildTimestamp = "",
  metadataTimestamp = "",
  supportedKinds = [],
  supportedPlatforms = [],
  minFactoryOpsVersion = "",
  maxFactoryOpsVersion = "",
  artifactUrl = "",
  artifactChecksumSha256 = "",
  artifactSizeBytes = "",
  releaseId = "",
  releaseTag = "",
  releaseSha = "",
  artifactId = "",
  artifactPath = "",
  runtimeSignature = "",
  runtimeSignatureKeyId = "",
  runtimeSignatureAlgorithm = "",
} = {}) {
  const normalizedBuildTimestamp = trim(buildTimestamp || new Date().toISOString());
  const normalizedMetadataTimestamp = trim(metadataTimestamp || normalizedBuildTimestamp);
  const normalizedChannel = trim(channel || "").toLowerCase();

  const manifest = {
    schema_version: HOST_RUNTIME_RELEASE_SCHEMA_VERSION,
    version: trim(version),
    channel: normalizedChannel,
    provenance: {
      git_sha: trim(provenanceGitSha),
      build_timestamp: normalizedBuildTimestamp,
      source_ref: trim(provenanceSourceRef),
    },
    compatibility: {
      supported_kinds: unique(supportedKinds),
      supported_platforms: unique(supportedPlatforms),
      min_factory_ops_version: trim(minFactoryOpsVersion),
      max_factory_ops_version: trim(maxFactoryOpsVersion),
    },
    artifactRef: {
      url: trim(artifactUrl),
      checksum_sha256: trim(artifactChecksumSha256),
      size_bytes: Number.isFinite(Number(artifactSizeBytes)) ? Math.max(0, Math.trunc(Number(artifactSizeBytes))) : undefined,
      asset_id: trim(artifactId),
      asset_path: trim(artifactPath),
    },
    trust: buildHostRuntimeReleaseTrust({
      version,
      channel: normalizedChannel,
      releaseId,
      releaseTag,
      releaseSha,
      provenanceGitSha,
      artifactUrl,
      artifactChecksumSha256,
      runtimeSignature,
      runtimeSignatureKeyId,
      runtimeSignatureAlgorithm,
      buildTimestamp: normalizedBuildTimestamp,
    }),
    metadata: {
      timestamp: normalizedMetadataTimestamp,
      release_id: trim(releaseId),
      release_tag: trim(releaseTag),
      release_sha: trim(releaseSha),
    },
  };

  if (manifest.artifactRef.size_bytes === undefined) {
    delete manifest.artifactRef.size_bytes;
  }

  return manifest;
}

export function produceHostRuntimeReleaseManifest({
  version = "",
  channel = "",
  releaseId = "",
  releaseTag = "",
  releaseSha = "",
  provenanceGitSha = "",
  provenanceSourceRef = "",
  buildTimestamp = "",
  metadataTimestamp = "",
  supportedKinds = [],
  supportedKindsCsv = "",
  supportedPlatforms = [],
  supportedPlatformsCsv = "",
  minFactoryOpsVersion = "",
  maxFactoryOpsVersion = "",
  artifactUrl = "",
  artifactChecksumSha256 = "",
  artifactSizeBytes = "",
  artifactId = "",
  artifactPath = "",
  runtimeSignature = "",
  runtimeSignatureKeyId = "",
  runtimeSignatureAlgorithm = "",
  runId = "",
  runsDir = ".hatch/runs",
  releasesDir = ".hatch/releases",
  outPath = "",
  repoRoot = ".",
} = {}) {
  const resolvedVersion = resolveReleaseVersion({ version, releaseTag, releaseSha });
  if (!resolvedVersion) {
    throw new Error("missing_version");
  }

  const gitSha = trim(provenanceGitSha) || trim(releaseSha) || resolveGitSha(repoRoot);

  const manifest = buildHostRuntimeReleaseManifest({
    version: resolvedVersion,
    channel,
    provenanceGitSha: gitSha,
    provenanceSourceRef,
    buildTimestamp,
    metadataTimestamp,
    supportedKinds: [...(Array.isArray(supportedKinds) ? supportedKinds : []), ...parseCsv(supportedKindsCsv)],
    supportedPlatforms: [...(Array.isArray(supportedPlatforms) ? supportedPlatforms : []), ...parseCsv(supportedPlatformsCsv)],
    minFactoryOpsVersion,
    maxFactoryOpsVersion,
    artifactUrl,
    artifactChecksumSha256,
    artifactSizeBytes,
    releaseId,
    releaseTag,
    releaseSha,
    artifactId,
    artifactPath,
    runtimeSignature,
    runtimeSignatureKeyId,
    runtimeSignatureAlgorithm,
  });

  assertContractOrThrow(manifest);

  const manifestPath = resolveManifestPath({
    version: resolvedVersion,
    runId,
    runsDir,
    releasesDir,
    outPath,
  });

  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${stableStringify(manifest)}\n`, "utf8");

  return {
    ok: true,
    schema_version: HOST_RUNTIME_RELEASE_SCHEMA_VERSION,
    manifest_path: manifestPath,
    version: resolvedVersion,
    channel: manifest.channel,
    manifest,
  };
}

export async function publishHostRuntimeReleaseManifest({
  repo = "",
  version = "",
  channel = "",
  releaseId = "",
  releaseTag = "",
  releaseSha = "",
  provenanceGitSha = "",
  provenanceSourceRef = "",
  buildTimestamp = "",
  metadataTimestamp = "",
  supportedKinds = [],
  supportedKindsCsv = "",
  supportedPlatforms = [],
  supportedPlatformsCsv = "",
  minFactoryOpsVersion = "",
  maxFactoryOpsVersion = "",
  artifactUrl = "",
  artifactChecksumSha256 = "",
  artifactSizeBytes = "",
  runtimeSignature = "",
  runtimeSignatureKeyId = "",
  runtimeSignatureAlgorithm = "",
  runId = "",
  runsDir = ".hatch/runs",
  releasesDir = ".hatch/releases",
  outPath = "",
  repoRoot = ".",
  publishManifestAssetFn = publishControlPlaneReleaseAsset,
  releaseAssetGithubClient = null,
} = {}) {
  const built = produceHostRuntimeReleaseManifest({
    version,
    channel,
    releaseId,
    releaseTag,
    releaseSha,
    provenanceGitSha,
    provenanceSourceRef,
    buildTimestamp,
    metadataTimestamp,
    supportedKinds,
    supportedKindsCsv,
    supportedPlatforms,
    supportedPlatformsCsv,
    minFactoryOpsVersion,
    maxFactoryOpsVersion,
    artifactUrl,
    artifactChecksumSha256,
    artifactSizeBytes,
    runtimeSignature,
    runtimeSignatureKeyId,
    runtimeSignatureAlgorithm,
    runId,
    runsDir,
    releasesDir,
    outPath,
    repoRoot,
  });

  const publishResult = await publishManifestAssetFn({
    manifestPath: built.manifest_path,
    releaseId,
    releaseTag,
    releaseSha,
    githubClient: releaseAssetGithubClient,
    repo,
  });

  const nextManifest = buildHostRuntimeReleaseManifest({
    ...built.manifest,
    version: built.version,
    channel: built.channel,
    provenanceGitSha: built.manifest.provenance.git_sha,
    provenanceSourceRef: built.manifest.provenance.source_ref,
    buildTimestamp: built.manifest.provenance.build_timestamp,
    metadataTimestamp: built.manifest.metadata.timestamp,
    supportedKinds: built.manifest.compatibility.supported_kinds,
    supportedPlatforms: built.manifest.compatibility.supported_platforms,
    minFactoryOpsVersion: built.manifest.compatibility.min_factory_ops_version,
    maxFactoryOpsVersion: built.manifest.compatibility.max_factory_ops_version,
    artifactUrl: trim(built.manifest.artifactRef.url) || trim(publishResult.asset_url),
    artifactChecksumSha256: built.manifest.artifactRef.checksum_sha256,
    artifactSizeBytes: built.manifest.artifactRef.size_bytes,
    releaseId: built.manifest.metadata.release_id,
    releaseTag: built.manifest.metadata.release_tag,
    releaseSha: built.manifest.metadata.release_sha,
    runtimeSignature: built.manifest.trust.signature.signature,
    runtimeSignatureKeyId: built.manifest.trust.signature.key_id,
    runtimeSignatureAlgorithm: built.manifest.trust.signature.signature_algorithm,
    artifactId: trim(publishResult.asset_id),
    artifactPath: trim(publishResult.manifest_path),
  });

  assertContractOrThrow(nextManifest);
  writeFileSync(built.manifest_path, `${stableStringify(nextManifest)}\n`, "utf8");

  return {
    ok: true,
    schema_version: HOST_RUNTIME_RELEASE_SCHEMA_VERSION,
    manifest_path: built.manifest_path,
    version: built.version,
    channel: built.channel,
    publish: publishResult,
    manifest: nextManifest,
  };
}
