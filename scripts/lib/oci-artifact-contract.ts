import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  exportOciArtifactMetadataSchema,
  exportOciArtifactTaxonomyDocument,
} from "../../packages/factory-core/src/oci-artifact-registry.ts";

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sortStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
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

function listGitFiles(repoRoot, args) {
  const run = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (run.status !== 0) {
    throw new Error(`oci_artifact_git_ls_files_failed:${String(run.stderr || run.stdout || "").trim()}`);
  }
  return String(run.stdout || "").split("\0").map((value) => String(value || "").trim()).filter(Boolean);
}

function listCandidateFiles(repoRoot) {
  return [...new Set([
    ...listGitFiles(repoRoot, ["ls-files", "-z"]),
    ...listGitFiles(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ])].sort((left, right) => left.localeCompare(right));
}

function isSourceCandidate(filePath = "") {
  const normalized = String(filePath || "").trim();
  if (!normalized) return false;
  if (!/\.(mjs|js|ts)$/.test(normalized)) return false;
  if (normalized.endsWith(".d.ts")) return false;
  if (/\.(test|spec)\./.test(normalized)) return false;
  if (normalized.includes("/dist/")) return false;
  if (normalized.includes("/test/")) return false;
  if (normalized.includes("/tests/")) return false;
  if (normalized.includes("/docs/")) return false;
  if (normalized.includes("/node_modules/")) return false;
  return true;
}

function readModuleSource(repoRoot, relativePath) {
  try {
    return readFileSync(path.join(repoRoot, relativePath), "utf8");
  } catch {
    return "";
  }
}

async function importModule(repoRoot, relativePath) {
  return import(pathToFileURL(path.join(repoRoot, relativePath)).href);
}

export const OCI_ARTIFACT_TAXONOMY_JSON_PATH = "docs/contracts/oci-artifact-taxonomy.json";
export const OCI_ARTIFACT_TAXONOMY_MARKDOWN_PATH = "docs/contracts/oci-artifact-taxonomy.md";

export function discoverOciArtifactSourceModules({
  repoRoot = process.cwd(),
  trackedFiles = listCandidateFiles(repoRoot),
} = {}) {
  return trackedFiles
    .filter((filePath) => isSourceCandidate(filePath))
    .filter((filePath) => /=\s*defineOciArtifactClass\s*\(/.test(readModuleSource(repoRoot, filePath)))
    .sort((left, right) => left.localeCompare(right));
}

export function discoverOciArtifactPublisherModules({
  repoRoot = process.cwd(),
  trackedFiles = listCandidateFiles(repoRoot),
} = {}) {
  return trackedFiles
    .filter((filePath) => isSourceCandidate(filePath))
    .filter((filePath) => {
      const source = readModuleSource(repoRoot, filePath);
      return /\bpublishOciArtifact\s*\(/.test(source)
        && !/\bexport\s+(?:async\s+)?function\s+publishOciArtifact\s*\(/.test(source);
    })
    .sort((left, right) => left.localeCompare(right));
}

export async function loadOciArtifactClasses({ repoRoot = process.cwd() } = {}) {
  const modules = await Promise.all(
    discoverOciArtifactSourceModules({ repoRoot })
      .filter((modulePath) => /\.(mjs|js|ts)$/.test(modulePath))
      .map((modulePath) => importModule(repoRoot, modulePath)),
  );
  return modules.flatMap((module) => Object.values(module).filter((value) =>
    value
    && typeof value === "object"
    && typeof value.key === "string"
    && typeof value.canonicalMediaType === "string"
    && typeof value.metadataOutputPath === "string",
  ));
}

const DIRECT_ORAS_PATTERN = /\boras\s+(push|cp|copy|manifest|discover)\b/;
const HELPER_IMPORT_NEEDLE = "oci-artifact-registry";
const LEGACY_SUBJECT_REF_PATTERN = /\bsubjectRef\s*:/;
const LEGACY_SUBJECT_ID_PATTERN = /\bsubject_id\b/;
const SUBJECT_REFERRER_HELPER_NEEDLE = "buildOciSubjectReferrerRelation";
const LIFECYCLE_HELPER_NEEDLE = "buildOciArtifactLifecycleEvaluation";
const BESPOKE_LIFECYCLE_PATTERN = /\b(retentionDays|retention_days|retain_until|expires_at|expiry_action|delete_after|ttl)\b/;
const TRUST_HELPER_NEEDLE = "artifact-trust-registry";
const BESPOKE_TRUST_PATTERN = /\b(runtime_signature|signature_algorithm|predicate_type|slsa|attestation|dsse|cosign)\b/;

export function analyzeOciArtifactContract({
  artifactClasses = [],
  readFile = defaultReadFile,
  expectedRegistryJson = "",
  expectedRegistryMarkdown = "",
  expectedSchemaByPath = {},
  discoveredSourcePaths = [],
  discoveredPublisherPaths = [],
} = {}) {
  const diagnostics = [];
  const entries = [];

  for (const artifactClass of artifactClasses) {
    const key = String(artifactClass?.key || "").trim();
    const version = String(artifactClass?.version || "").trim();
    const title = String(artifactClass?.title || "").trim();
    const sourcePath = String(artifactClass?.sourcePath || "").trim();
    const canonicalMediaType = String(artifactClass?.canonicalMediaType || "").trim();
    const metadataSchemaId = String(artifactClass?.metadataSchemaId || "").trim();
    const metadataOutputPath = String(artifactClass?.metadataOutputPath || "").trim();
    const lifecyclePolicy = artifactClass?.lifecyclePolicy || null;
    const trustPolicy = artifactClass?.trustPolicy || null;
    const governedPublisherPaths = sortStrings(artifactClass?.governedPublisherPaths || []);
    const sourceContent = readFile(sourcePath);

    if (!key) diagnostics.push("oci_missing_key");
    if (!version) diagnostics.push(`oci_missing_version key=${JSON.stringify(key)}`);
    if (!title) diagnostics.push(`oci_missing_title key=${JSON.stringify(key)}`);
    if (!sourcePath) diagnostics.push(`oci_missing_source key=${JSON.stringify(key)}`);
    if (!canonicalMediaType) diagnostics.push(`oci_missing_media_type key=${JSON.stringify(key)}`);
    if (!metadataSchemaId) diagnostics.push(`oci_missing_metadata_schema_id key=${JSON.stringify(key)}`);
    if (!metadataOutputPath) diagnostics.push(`oci_missing_metadata_output_path key=${JSON.stringify(key)}`);
    if (!lifecyclePolicy?.schema_version) diagnostics.push(`oci_missing_lifecycle_policy key=${JSON.stringify(key)}`);
    if (!Number.isInteger(lifecyclePolicy?.retention_days) || lifecyclePolicy.retention_days < 1) {
      diagnostics.push(`oci_invalid_lifecycle_retention key=${JSON.stringify(key)}`);
    }
    if (String(lifecyclePolicy?.enforcement_mode || "").trim() !== "shared_policy_engine") {
      diagnostics.push(`oci_invalid_lifecycle_enforcement key=${JSON.stringify(key)}`);
    }
    if (!String(lifecyclePolicy?.expiry_action || "").trim()) {
      diagnostics.push(`oci_missing_lifecycle_expiry_action key=${JSON.stringify(key)}`);
    }
    if (trustPolicy?.required === true) {
      if (!String(trustPolicy?.signing_stack || "").trim()) {
        diagnostics.push(`oci_missing_trust_policy key=${JSON.stringify(key)}`);
      }
      if (String(trustPolicy?.signing_stack || "").trim() !== "cosign") {
        diagnostics.push(`oci_invalid_trust_signing_stack key=${JSON.stringify(key)}`);
      }
      if (String(trustPolicy?.attestation_stack || "").trim() !== "in_toto_dsse") {
        diagnostics.push(`oci_invalid_trust_attestation_stack key=${JSON.stringify(key)}`);
      }
      if (String(trustPolicy?.provenance_profile || "").trim() !== "slsa_provenance/v1") {
        diagnostics.push(`oci_invalid_trust_provenance_profile key=${JSON.stringify(key)}`);
      }
      if (!Array.isArray(trustPolicy?.verification_boundaries) || trustPolicy.verification_boundaries.length < 1) {
        diagnostics.push(`oci_missing_trust_verification_boundaries key=${JSON.stringify(key)}`);
      }
    }
    for (const publisherPath of governedPublisherPaths) {
      const content = readFile(publisherPath);
      if (!content.includes(HELPER_IMPORT_NEEDLE)) {
        diagnostics.push(`oci_governed_publisher_missing_helper_import publisher=${JSON.stringify(publisherPath)} key=${JSON.stringify(key)}`);
      }
      if (DIRECT_ORAS_PATTERN.test(content)) {
        diagnostics.push(`oci_direct_oras_usage path=${JSON.stringify(publisherPath)} key=${JSON.stringify(key)}`);
      }
      if (LEGACY_SUBJECT_REF_PATTERN.test(content)) {
        diagnostics.push(`oci_legacy_subject_ref_usage path=${JSON.stringify(publisherPath)} key=${JSON.stringify(key)}`);
      }
      if (LEGACY_SUBJECT_ID_PATTERN.test(content)) {
        diagnostics.push(`oci_bespoke_attachment_identifier path=${JSON.stringify(publisherPath)} key=${JSON.stringify(key)}`);
      }
      if (/\bsubject\s*:/.test(content) && !content.includes(SUBJECT_REFERRER_HELPER_NEEDLE)) {
        diagnostics.push(`oci_subject_referrer_helper_missing path=${JSON.stringify(publisherPath)} key=${JSON.stringify(key)}`);
      }
      if (BESPOKE_LIFECYCLE_PATTERN.test(content) && !content.includes(LIFECYCLE_HELPER_NEEDLE)) {
        diagnostics.push(`oci_bespoke_lifecycle_policy path=${JSON.stringify(publisherPath)} key=${JSON.stringify(key)}`);
      }
      if (trustPolicy?.required === true && !content.includes(TRUST_HELPER_NEEDLE)) {
        diagnostics.push(`oci_governed_publisher_missing_trust_helper path=${JSON.stringify(publisherPath)} key=${JSON.stringify(key)}`);
      }
      if (trustPolicy?.required === true && BESPOKE_TRUST_PATTERN.test(content) && !content.includes(TRUST_HELPER_NEEDLE)) {
        diagnostics.push(`oci_bespoke_trust_material path=${JSON.stringify(publisherPath)} key=${JSON.stringify(key)}`);
      }
    }

    const renderedSchema = stableJson(exportOciArtifactMetadataSchema(artifactClass));
    if (LEGACY_SUBJECT_ID_PATTERN.test(renderedSchema) || LEGACY_SUBJECT_ID_PATTERN.test(sourceContent)) {
      diagnostics.push(`oci_bespoke_attachment_identifier path=${JSON.stringify(metadataOutputPath)} key=${JSON.stringify(key)}`);
    }
    if (expectedSchemaByPath[metadataOutputPath] && expectedSchemaByPath[metadataOutputPath] !== renderedSchema) {
      diagnostics.push(`oci_metadata_schema_drift path=${JSON.stringify(metadataOutputPath)}`);
    }

    entries.push({
      key,
      version,
      title,
      source_path: sourcePath,
      canonical_media_type: canonicalMediaType,
      metadata_schema_id: metadataSchemaId,
      metadata_output_path: metadataOutputPath,
      lifecycle_policy: lifecyclePolicy,
      trust_policy: trustPolicy,
      governed_publisher_paths: governedPublisherPaths,
    });
  }

  const registeredSources = sortStrings(entries.map((entry) => entry.source_path));
  const registeredPublishers = sortStrings(
    artifactClasses.flatMap((artifactClass) => sortStrings(artifactClass?.governedPublisherPaths || [])),
  );
  for (const sourcePath of sortStrings(discoveredSourcePaths)) {
    if (!registeredSources.includes(sourcePath)) {
      diagnostics.push(`oci_unregistered_source source=${JSON.stringify(sourcePath)}`);
    }
  }
  for (const publisherPath of sortStrings(discoveredPublisherPaths)) {
    if (!registeredPublishers.includes(publisherPath)) {
      diagnostics.push(`oci_unregistered_governed_publisher publisher=${JSON.stringify(publisherPath)}`);
    }
  }

  const report = exportOciArtifactTaxonomyDocument(artifactClasses);
  const renderedJson = stableJson(report);
  const renderedMarkdown = [
    "---",
    'doc_type: "reference"',
    'owner: "platform-architecture"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-21"',
    'status: "active"',
    'summary: "Governed OCI artifact taxonomy and publication ownership registry."',
    "tags: [artifacts, contracts, oci, oras]",
    'written: "2026-03-21"',
    "---",
    "# OCI Artifact Taxonomy",
    "",
    `- Registered classes: ${entries.length}`,
    `- Diagnostics: ${diagnostics.length}`,
    "",
    "## Registered Classes",
    "",
    ...entries.flatMap((entry) => [
      `- \`${entry.key}\``,
      `  - media type: \`${entry.canonical_media_type}\``,
      `  - metadata schema: \`${entry.metadata_output_path}\``,
      `  - lifecycle policy: \`${entry.lifecycle_policy?.retention_days || "missing"}d / ${entry.lifecycle_policy?.expiry_action || "missing"} / ${entry.lifecycle_policy?.enforcement_mode || "missing"}\``,
      `  - trust policy: \`${entry.trust_policy?.required === true ? `${entry.trust_policy?.signing_stack || "missing"} / ${entry.trust_policy?.attestation_stack || "missing"} / ${entry.trust_policy?.provenance_profile || "missing"}` : "optional"}\``,
      `  - governed publishers: ${entry.governed_publisher_paths.length > 0 ? entry.governed_publisher_paths.map((publisher) => `\`${publisher}\``).join(", ") : "none"}`,
    ]),
    "",
    "## Diagnostics",
    "",
    ...(diagnostics.length > 0 ? diagnostics.map((entry) => `- \`${entry}\``) : ["- none"]),
    "",
  ].join("\n");

  if (expectedRegistryJson && expectedRegistryJson !== renderedJson) {
    diagnostics.push(`oci_registry_report_drift path=${JSON.stringify(OCI_ARTIFACT_TAXONOMY_JSON_PATH)}`);
  }
  if (expectedRegistryMarkdown && expectedRegistryMarkdown.trimEnd() !== renderedMarkdown.trimEnd()) {
    diagnostics.push(`oci_registry_report_drift path=${JSON.stringify(OCI_ARTIFACT_TAXONOMY_MARKDOWN_PATH)}`);
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    report,
    renderedJson,
    renderedMarkdown,
    renderedSchemasByPath: Object.fromEntries(
      artifactClasses.map((artifactClass) => [
        artifactClass.metadataOutputPath,
        stableJson(exportOciArtifactMetadataSchema(artifactClass)),
      ]),
    ),
  };
}

export function writeOciArtifactArtifacts(analysis, { writeFile = defaultWriteFile } = {}) {
  writeFile(OCI_ARTIFACT_TAXONOMY_JSON_PATH, analysis.renderedJson);
  writeFile(OCI_ARTIFACT_TAXONOMY_MARKDOWN_PATH, `${analysis.renderedMarkdown}\n`);
  for (const [outputPath, renderedSchema] of Object.entries(analysis.renderedSchemasByPath || {})) {
    writeFile(outputPath, renderedSchema);
  }
}
