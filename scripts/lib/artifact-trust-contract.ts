import { readFileSync, writeFileSync } from "node:fs";

import { loadOciArtifactClasses } from "./oci-artifact-contract.ts";

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function trim(value = "") {
  return String(value ?? "").trim();
}

function defaultReadFile(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function defaultWriteFile(filePath, content) {
  writeFileSync(filePath, content, "utf8");
}

export const ARTIFACT_TRUST_REGISTRY_JSON_PATH = "docs/contracts/artifact-trust-registry.json";
export const ARTIFACT_TRUST_REGISTRY_MARKDOWN_PATH = "docs/contracts/artifact-trust-registry.md";

export function exportArtifactTrustRegistryDocument(artifactClasses = []) {
  const requiredClasses = (Array.isArray(artifactClasses) ? artifactClasses : [])
    .filter((artifactClass) => artifactClass?.trustPolicy?.required === true)
    .sort((left, right) => String(left.key || "").localeCompare(String(right.key || "")))
    .map((artifactClass) => ({
      key: trim(artifactClass.key),
      version: trim(artifactClass.version),
      source_path: trim(artifactClass.sourcePath),
      trust_policy: artifactClass.trustPolicy,
      governed_publisher_paths: [...new Set((artifactClass.governedPublisherPaths || []).map((entry) => trim(entry)).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    }));

  return {
    schema_version: "artifact_trust_registry/v1",
    required_classes: requiredClasses,
  };
}

export function analyzeArtifactTrustContract({
  artifactClasses = [],
  readFile = defaultReadFile,
  expectedRegistryJson = "",
  expectedRegistryMarkdown = "",
} = {}) {
  const diagnostics = [];
  const report = exportArtifactTrustRegistryDocument(artifactClasses);
  const requiredClasses = Array.isArray(report.required_classes) ? report.required_classes : [];

  for (const artifactClass of requiredClasses) {
    const trustPolicy = artifactClass.trust_policy || {};
    if (trim(trustPolicy.signing_stack) !== "cosign") {
      diagnostics.push(`artifact_trust_invalid_signing_stack key=${JSON.stringify(artifactClass.key)}`);
    }
    if (trim(trustPolicy.attestation_stack) !== "in_toto_dsse") {
      diagnostics.push(`artifact_trust_invalid_attestation_stack key=${JSON.stringify(artifactClass.key)}`);
    }
    if (trim(trustPolicy.provenance_profile) !== "slsa_provenance/v1") {
      diagnostics.push(`artifact_trust_invalid_provenance_profile key=${JSON.stringify(artifactClass.key)}`);
    }
    if (!Array.isArray(trustPolicy.verification_boundaries) || trustPolicy.verification_boundaries.length < 1) {
      diagnostics.push(`artifact_trust_missing_verification_boundaries key=${JSON.stringify(artifactClass.key)}`);
    }
    for (const publisherPath of artifactClass.governed_publisher_paths || []) {
      const content = readFile(publisherPath);
      if (!content.includes("artifact-trust-registry")) {
        diagnostics.push(`artifact_trust_missing_publisher_helper path=${JSON.stringify(publisherPath)} key=${JSON.stringify(artifactClass.key)}`);
      }
      if (!content.includes("applyOciArtifactTrustFn")) {
        diagnostics.push(`artifact_trust_missing_publisher_execution path=${JSON.stringify(publisherPath)} key=${JSON.stringify(artifactClass.key)}`);
      }
    }
  }

  const hostRuntimeSchemaSource = readFile("packages/factory-ops/src/lib/host-runtime-release-schema.ts");
  const hostRuntimeManifestSource = readFile("packages/factory-ops/src/commands/host-runtime-release-manifest.ts");
  const hostRuntimeVerifySource = readFile("packages/factory-ops/src/lib/runtime-signature.ts");

  if (!hostRuntimeSchemaSource.includes("artifactTrustBundleSchema")) {
    diagnostics.push("artifact_trust_release_manifest_missing_trust_schema");
  }
  if (!hostRuntimeManifestSource.includes("buildArtifactTrustBundle")) {
    diagnostics.push("artifact_trust_release_manifest_missing_trust_helper");
  }
  if (!hostRuntimeVerifySource.includes("parsed?.trust?.signature")) {
    diagnostics.push("artifact_trust_release_verification_missing_canonical_signature_read");
  }

  const renderedJson = stableJson(report);
  const renderedMarkdown = [
    "---",
    'doc_type: "reference"',
    'owner: "platform-architecture"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-21"',
    'status: "active"',
    'summary: "Governed artifact trust registry and verification boundary ownership map."',
    "tags: [artifacts, cosign, provenance, trust]",
    'written: "2026-03-21"',
    "---",
    "# Artifact Trust Registry",
    "",
    `- Required governed classes: ${requiredClasses.length}`,
    `- Diagnostics: ${diagnostics.length}`,
    "",
    "## Required Classes",
    "",
    ...requiredClasses.flatMap((artifactClass) => [
      `- \`${artifactClass.key}\``,
      `  - signing: \`${artifactClass.trust_policy?.signing_stack || "missing"}\``,
      `  - attestations: \`${artifactClass.trust_policy?.attestation_stack || "missing"}\``,
      `  - provenance: \`${artifactClass.trust_policy?.provenance_profile || "missing"}\``,
      `  - verification boundaries: ${(artifactClass.trust_policy?.verification_boundaries || []).map((entry) => `\`${entry}\``).join(", ") || "none"}`,
      `  - governed publishers: ${(artifactClass.governed_publisher_paths || []).map((entry) => `\`${entry}\``).join(", ") || "none"}`,
    ]),
    "",
    "## Diagnostics",
    "",
    ...(diagnostics.length > 0 ? diagnostics.map((entry) => `- \`${entry}\``) : ["- none"]),
    "",
  ].join("\n");

  if (expectedRegistryJson && expectedRegistryJson !== renderedJson) {
    diagnostics.push(`artifact_trust_registry_drift path=${JSON.stringify(ARTIFACT_TRUST_REGISTRY_JSON_PATH)}`);
  }
  if (expectedRegistryMarkdown && expectedRegistryMarkdown.trimEnd() !== renderedMarkdown.trimEnd()) {
    diagnostics.push(`artifact_trust_registry_drift path=${JSON.stringify(ARTIFACT_TRUST_REGISTRY_MARKDOWN_PATH)}`);
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    report,
    renderedJson,
    renderedMarkdown,
  };
}

export async function writeArtifactTrustArtifacts(analysis, {
  writeFile = defaultWriteFile,
} = {}) {
  writeFile(ARTIFACT_TRUST_REGISTRY_JSON_PATH, analysis.renderedJson);
  writeFile(ARTIFACT_TRUST_REGISTRY_MARKDOWN_PATH, `${analysis.renderedMarkdown.replace(/\n?$/, "\n")}`);
}

export async function loadArtifactTrustClasses({ repoRoot = process.cwd() } = {}) {
  return loadOciArtifactClasses({ repoRoot });
}
