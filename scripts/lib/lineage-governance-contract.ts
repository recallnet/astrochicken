import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { HATCH_RUN_LIFECYCLE_CLOUDEVENT_SURFACE } from "../../packages/factory-core/src/hatch-run-lifecycle-asyncapi.ts";
import {
  defineOpenLineageArtifactClass,
  defineOpenLineageRunClass,
  exportOpenLineageRegistryDocument,
  renderOpenLineageRegistryMarkdown,
  stringifyOpenLineageRegistryDocument,
} from "../../packages/factory-core/src/openlineage-registry.ts";
import { OCI_ARTIFACT_CLASSES } from "../../packages/factory-ops/src/lib/oci-artifact-taxonomy.ts";
import {
  RELEASE_ROLLOUT_CLOUDEVENT_SURFACE,
} from "../../packages/factory-ops/src/lib/release-rollout-asyncapi-contract.ts";

export const OPENLINEAGE_REGISTRY_JSON_PATH = "docs/contracts/openlineage-registry.json";
export const OPENLINEAGE_REGISTRY_MARKDOWN_PATH = "docs/contracts/openlineage-registry.md";
export const LINEAGE_GATE_MODES = Object.freeze({
  lineage_supported_class_truth: "lineage_supported_class_truth",
  lineage_hot_path_isolation: "lineage_hot_path_isolation",
});

const REQUIRED_RUN_CLASSES = Object.freeze(["hatch_run_lifecycle", "release_rollout"]);
const REQUIRED_ARTIFACT_CLASSES = Object.freeze(
  OCI_ARTIFACT_CLASSES
    .filter((artifactClass) => Array.isArray(artifactClass.governedPublisherPaths) && artifactClass.governedPublisherPaths.length > 0)
    .map((artifactClass) => artifactClass.key),
);
const HOT_PATH_PATH_PATTERN = /^(apps\/hatch\/src\/|packages\/factory-ops\/src\/|factories\/[^/]+\/graphs\/.+\.dot$)/;
const GOVERNANCE_SYSTEM_PATTERN = /\b(marquez|atlas)/i;
const DUPLICATE_LINEAGE_OWNER_PATTERN = /\b(function\s+(buildOpenLineageProjection|normalizeOpenLineageProjection)|openLineageProjectionSchema\.safeParse\s*\()/;

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

function listCandidateFiles(repoRoot) {
  const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" });
  if (tracked.status !== 0) {
    throw new Error(`lineage_governance_contract_git_ls_files_failed:${String(tracked.stderr || tracked.stdout || "").trim()}`);
  }
  return String(tracked.stdout || "")
    .split("\0")
    .map((entry) => trim(entry))
    .filter(Boolean);
}

function readPath(readFile, repoRoot, relativePath) {
  return readFile(path.join(repoRoot, relativePath)) || readFile(relativePath) || "";
}

async function defaultLoadRunClasses() {
  return [
    defineOpenLineageRunClass({
      key: "hatch_run_lifecycle",
      cloudEventSurfaceId: HATCH_RUN_LIFECYCLE_CLOUDEVENT_SURFACE.id,
      sourcePath: HATCH_RUN_LIFECYCLE_CLOUDEVENT_SURFACE.sourcePath,
      producerPaths: [...HATCH_RUN_LIFECYCLE_CLOUDEVENT_SURFACE.producers],
    }),
    defineOpenLineageRunClass({
      key: "release_rollout",
      cloudEventSurfaceId: RELEASE_ROLLOUT_CLOUDEVENT_SURFACE.id,
      sourcePath: RELEASE_ROLLOUT_CLOUDEVENT_SURFACE.sourcePath,
      producerPaths: [...RELEASE_ROLLOUT_CLOUDEVENT_SURFACE.producers],
    }),
  ];
}

async function defaultLoadArtifactClasses() {
  return OCI_ARTIFACT_CLASSES
    .filter((artifactClass) => Array.isArray(artifactClass.governedPublisherPaths) && artifactClass.governedPublisherPaths.length > 0)
    .map((artifactClass) => defineOpenLineageArtifactClass({
    key: artifactClass.key,
    sourcePath: artifactClass.sourcePath,
    publisherPaths: artifactClass.governedPublisherPaths || [],
    }));
}

function detectHotPathGovernanceDependency({ diagnostics, trackedFiles, readFile, repoRoot }) {
  for (const filePath of trackedFiles) {
    if (!HOT_PATH_PATH_PATTERN.test(filePath)) continue;
    const source = readPath(readFile, repoRoot, filePath);
    if (GOVERNANCE_SYSTEM_PATTERN.test(source)) {
      diagnostics.push(`lineage_hot_path_governance_dependency path=${JSON.stringify(filePath)}`);
    }
  }
}

function detectDuplicateProjectionOwners({ diagnostics, trackedFiles, readFile, repoRoot }) {
  const approvedOwners = new Set([
    "packages/factory-core/src/openlineage-registry.ts",
    "packages/factory-core/src/openlineage-registry.d.ts",
  ]);

  for (const filePath of trackedFiles) {
    if (filePath.includes("/test/") || filePath.includes(".test.")) continue;
    if (!/\.(mjs|ts|js)$/.test(filePath) || filePath.endsWith(".d.ts") || approvedOwners.has(filePath)) continue;
    const source = readPath(readFile, repoRoot, filePath);
    if (DUPLICATE_LINEAGE_OWNER_PATTERN.test(source)) {
      diagnostics.push(`lineage_duplicate_projection_owner path=${JSON.stringify(filePath)}`);
    }
  }
}

export function lineageDiagnosticMatchesMode(diagnostic = "", mode = "") {
  const entry = String(diagnostic || "");
  switch (mode) {
    case LINEAGE_GATE_MODES.lineage_supported_class_truth:
      return entry.startsWith("lineage_missing_run_class")
        || entry.startsWith("lineage_missing_artifact_class")
        || entry.startsWith("lineage_registry_");
    case LINEAGE_GATE_MODES.lineage_hot_path_isolation:
      return entry.startsWith("lineage_hot_path_governance_dependency")
        || entry.startsWith("lineage_duplicate_projection_owner");
    default:
      return true;
  }
}

export async function analyzeLineageGovernanceContract({
  repoRoot = process.cwd(),
  trackedFiles = listCandidateFiles(repoRoot),
  readFile = defaultReadFile,
  loadRunClasses = defaultLoadRunClasses,
  loadArtifactClasses = defaultLoadArtifactClasses,
  expectedRegistryJson = undefined,
  expectedRegistryMarkdown = undefined,
} = {}) {
  const semanticDiagnostics = [];
  const runClasses = await loadRunClasses();
  const artifactClasses = await loadArtifactClasses();
  const runClassKeys = new Set(runClasses.map((entry) => trim(entry.key)).filter(Boolean));
  const artifactClassKeys = new Set(artifactClasses.map((entry) => trim(entry.key)).filter(Boolean));

  for (const key of REQUIRED_RUN_CLASSES) {
    if (!runClassKeys.has(key)) {
      semanticDiagnostics.push(`lineage_missing_run_class key=${JSON.stringify(key)}`);
    }
  }
  for (const key of REQUIRED_ARTIFACT_CLASSES) {
    if (!artifactClassKeys.has(key)) {
      semanticDiagnostics.push(`lineage_missing_artifact_class key=${JSON.stringify(key)}`);
    }
  }

  detectHotPathGovernanceDependency({ diagnostics: semanticDiagnostics, trackedFiles, readFile, repoRoot });
  detectDuplicateProjectionOwners({ diagnostics: semanticDiagnostics, trackedFiles, readFile, repoRoot });

  const registryDocument = exportOpenLineageRegistryDocument({
    runClasses,
    artifactClasses,
    diagnostics: semanticDiagnostics,
  });
  const renderedJson = stringifyOpenLineageRegistryDocument(registryDocument);
  const renderedMarkdown = `${renderOpenLineageRegistryMarkdown(registryDocument)}\n`;
  const diagnostics = [...semanticDiagnostics];

  const currentRegistryJson = expectedRegistryJson ?? readPath(readFile, repoRoot, OPENLINEAGE_REGISTRY_JSON_PATH);
  const currentRegistryMarkdown = expectedRegistryMarkdown ?? readPath(readFile, repoRoot, OPENLINEAGE_REGISTRY_MARKDOWN_PATH);

  if (!currentRegistryJson) {
    diagnostics.push(`lineage_registry_missing path=${JSON.stringify(OPENLINEAGE_REGISTRY_JSON_PATH)}`);
  } else if (currentRegistryJson !== renderedJson) {
    diagnostics.push(`lineage_registry_drift path=${JSON.stringify(OPENLINEAGE_REGISTRY_JSON_PATH)}`);
  }
  if (!currentRegistryMarkdown) {
    diagnostics.push(`lineage_registry_missing path=${JSON.stringify(OPENLINEAGE_REGISTRY_MARKDOWN_PATH)}`);
  } else if (currentRegistryMarkdown.trimEnd() !== renderedMarkdown.trimEnd()) {
    diagnostics.push(`lineage_registry_drift path=${JSON.stringify(OPENLINEAGE_REGISTRY_MARKDOWN_PATH)}`);
  }

  const finalReport = exportOpenLineageRegistryDocument({
    runClasses,
    artifactClasses,
    diagnostics,
  });

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    report: finalReport,
    renderedJson,
    renderedMarkdown,
  };
}

export async function writeLineageGovernanceOutputs({
  repoRoot = process.cwd(),
  trackedFiles = listCandidateFiles(repoRoot),
} = {}) {
  const initialResult = await analyzeLineageGovernanceContract({ repoRoot, trackedFiles });
  writeFileSync(path.join(repoRoot, OPENLINEAGE_REGISTRY_JSON_PATH), initialResult.renderedJson, "utf8");
  writeFileSync(path.join(repoRoot, OPENLINEAGE_REGISTRY_MARKDOWN_PATH), initialResult.renderedMarkdown, "utf8");
  const finalResult = await analyzeLineageGovernanceContract({ repoRoot, trackedFiles });
  writeFileSync(path.join(repoRoot, OPENLINEAGE_REGISTRY_JSON_PATH), finalResult.renderedJson, "utf8");
  writeFileSync(path.join(repoRoot, OPENLINEAGE_REGISTRY_MARKDOWN_PATH), finalResult.renderedMarkdown, "utf8");
  return finalResult;
}
