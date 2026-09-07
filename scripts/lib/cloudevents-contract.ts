import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
    throw new Error(`cloudevents_git_ls_files_failed:${String(run.stderr || run.stdout || "").trim()}`);
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

export const CLOUDEVENTS_REGISTRY_JSON_PATH = "docs/contracts/cloudevents-registry.json";
export const CLOUDEVENTS_REGISTRY_MARKDOWN_PATH = "docs/contracts/cloudevents-registry.md";

export function discoverCloudEventSourceModules({
  repoRoot = process.cwd(),
  trackedFiles = listCandidateFiles(repoRoot),
} = {}) {
  return trackedFiles
    .filter((filePath) => isSourceCandidate(filePath))
    .filter((filePath) => /=\s*defineCloudEventSurface\s*\(/.test(readModuleSource(repoRoot, filePath)))
    .sort((left, right) => left.localeCompare(right));
}

async function importModule(repoRoot, relativePath) {
  return import(pathToFileURL(path.join(repoRoot, relativePath)).href);
}

export async function loadCloudEventSurfaces({ repoRoot = process.cwd() } = {}) {
  const modules = await Promise.all(
    discoverCloudEventSourceModules({ repoRoot })
      .filter((modulePath) => /\.(mjs|js|ts)$/.test(modulePath))
      .map((modulePath) => importModule(repoRoot, modulePath)),
  );
  return modules.flatMap((module) => Object.values(module).filter((value) =>
    value
    && typeof value === "object"
    && typeof value.id === "string"
    && typeof value.outputPath === "string"
    && typeof value.sourcePath === "string"
    && Array.isArray(value.governedPaths),
  ));
}

const LEGACY_ENVELOPE_PATTERN = /WAVE_READY_LEASE_EVENT |RELEASE_ROLLOUT_EVENT /;

export function analyzeCloudEventsContract({
  surfaces = [],
  readFile = defaultReadFile,
  expectedRegistryJson = "",
  expectedRegistryMarkdown = "",
  discoveredSourcePaths = [],
} = {}) {
  const diagnostics = [];
  const entries = [];

  for (const surface of surfaces) {
    const id = String(surface?.id || "").trim();
    const version = String(surface?.version || "").trim();
    const sourcePath = String(surface?.sourcePath || "").trim();
    const outputPath = String(surface?.outputPath || "").trim();
    const title = String(surface?.title || "").trim();
    const producers = sortStrings(surface?.producers || []);
    const consumers = sortStrings(surface?.consumers || []);
    const governedPaths = sortStrings(surface?.governedPaths || []);
    const payloadSchemaVersion = String(surface?.payloadSchemaVersion || "").trim();
    const payloadSchemaId = String(surface?.payloadSchemaId || "").trim();

    if (!id) diagnostics.push("cloudevents_missing_id");
    if (!version) diagnostics.push(`cloudevents_missing_version source=${JSON.stringify(sourcePath)}`);
    if (!sourcePath) diagnostics.push(`cloudevents_missing_source id=${JSON.stringify(id)}`);
    if (!outputPath) diagnostics.push(`cloudevents_missing_output id=${JSON.stringify(id)}`);
    if (!title) diagnostics.push(`cloudevents_missing_title id=${JSON.stringify(id)}`);
    if (!payloadSchemaVersion) diagnostics.push(`cloudevents_missing_payload_schema_version source=${JSON.stringify(sourcePath)}`);
    if (!payloadSchemaId) diagnostics.push(`cloudevents_missing_payload_schema_id source=${JSON.stringify(sourcePath)}`);

    const importNeedle = path.basename(sourcePath).replace(/\.(mjs|js|ts)$/i, "");
    for (const producerPath of producers) {
      if (!readFile(producerPath).includes(importNeedle)) {
        diagnostics.push(`cloudevents_producer_missing_contract_import producer=${JSON.stringify(producerPath)} source=${JSON.stringify(sourcePath)}`);
      }
    }
    for (const consumerPath of consumers) {
      if (!readFile(consumerPath).includes(importNeedle)) {
        diagnostics.push(`cloudevents_consumer_missing_contract_import consumer=${JSON.stringify(consumerPath)} source=${JSON.stringify(sourcePath)}`);
      }
    }
    for (const governedPath of governedPaths) {
      const content = readFile(governedPath);
      if (LEGACY_ENVELOPE_PATTERN.test(content)) {
        diagnostics.push(`cloudevents_legacy_envelope_pattern path=${JSON.stringify(governedPath)}`);
      }
    }

    entries.push({
      id,
      version,
      title,
      source_path: sourcePath,
      output_path: outputPath,
      payload_schema_version: payloadSchemaVersion,
      payload_schema_id: payloadSchemaId,
      producer_paths: producers,
      consumer_paths: consumers,
      governed_paths: governedPaths,
    });
  }

  const registeredSources = sortStrings(entries.map((entry) => entry.source_path));
  for (const sourcePath of sortStrings(discoveredSourcePaths)) {
    if (!registeredSources.includes(sourcePath)) {
      diagnostics.push(`cloudevents_unregistered_source source=${JSON.stringify(sourcePath)}`);
    }
  }

  const sortedEntries = entries.sort((left, right) => left.output_path.localeCompare(right.output_path));
  const contentDiagnostics = [...diagnostics];
  const report = {
    schema_version: "cloudevents_registry/v1",
    summary: {
      registered_surfaces: sortedEntries.length,
      discovered_sources: sortStrings(discoveredSourcePaths).length,
      diagnostics: contentDiagnostics.length,
    },
    registered_output_paths: sortStrings(sortedEntries.map((entry) => entry.output_path)),
    discovered_source_paths: sortStrings(discoveredSourcePaths),
    surfaces: sortedEntries,
    diagnostics: contentDiagnostics,
  };

  const renderedJson = stableJson(report);
  const renderedMarkdown = [
    "---",
    'doc_type: "reference"',
    'owner: "platform-architecture"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-21"',
    'status: "active"',
    'summary: "Governed CloudEvents registry for domain and reactor event surfaces."',
    "tags: [cloudevents, contracts, events]",
    'written: "2026-03-21"',
    "---",
    "# CloudEvents Registry",
    "",
    `- Registered surfaces: ${sortedEntries.length}`,
    `- Diagnostics: ${contentDiagnostics.length}`,
    "",
    "## Registered Surfaces",
    "",
    ...sortedEntries.flatMap((entry) => [
      `- \`${entry.output_path}\``,
      `  - source: \`${entry.source_path}\``,
      `  - payload schema version: \`${entry.payload_schema_version}\``,
      `  - producers: ${entry.producer_paths.length > 0 ? entry.producer_paths.map((producer) => `\`${producer}\``).join(", ") : "none"}`,
      `  - consumers: ${entry.consumer_paths.length > 0 ? entry.consumer_paths.map((consumer) => `\`${consumer}\``).join(", ") : "none"}`,
    ]),
    "",
    "## Diagnostics",
    "",
    ...(contentDiagnostics.length > 0 ? contentDiagnostics.map((entry) => `- \`${entry}\``) : ["- none"]),
    "",
  ].join("\n");

  if (expectedRegistryJson && expectedRegistryJson !== renderedJson) {
    diagnostics.push(`cloudevents_registry_report_drift path=${JSON.stringify(CLOUDEVENTS_REGISTRY_JSON_PATH)}`);
  }
  if (expectedRegistryMarkdown && expectedRegistryMarkdown.trimEnd() !== renderedMarkdown.trimEnd()) {
    diagnostics.push(`cloudevents_registry_report_drift path=${JSON.stringify(CLOUDEVENTS_REGISTRY_MARKDOWN_PATH)}`);
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    report,
    renderedJson,
    renderedMarkdown,
  };
}

export function writeCloudEventArtifacts(analysis, { writeFile = defaultWriteFile } = {}) {
  writeFile(CLOUDEVENTS_REGISTRY_JSON_PATH, analysis.renderedJson);
  writeFile(CLOUDEVENTS_REGISTRY_MARKDOWN_PATH, `${analysis.renderedMarkdown}\n`);
}
