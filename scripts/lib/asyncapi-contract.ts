import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { stringifyAsyncApiDocument } from "../../packages/factory-core/src/asyncapi-registry.ts";

export const ASYNCAPI_REGISTRY_JSON_PATH = "docs/contracts/asyncapi-registry.json";
export const ASYNCAPI_REGISTRY_MARKDOWN_PATH = "docs/contracts/asyncapi-registry.md";

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
  const run = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    throw new Error(`asyncapi_git_ls_files_failed:${String(run.stderr || run.stdout || "").trim()}`);
  }
  return String(run.stdout || "")
    .split("\0")
    .map((value) => String(value || "").trim())
    .filter(Boolean);
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
  if (normalized.includes("/examples/")) return false;
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

export function discoverAsyncApiSourceModules({
  repoRoot = process.cwd(),
  trackedFiles = listCandidateFiles(repoRoot),
} = {}) {
  return trackedFiles
    .filter((filePath) => isSourceCandidate(filePath))
    .filter((filePath) => /=\s*defineAsyncEventSurface\s*\(/.test(readModuleSource(repoRoot, filePath)))
    .sort((left, right) => left.localeCompare(right));
}

async function importModule(repoRoot, relativePath) {
  return import(pathToFileURL(path.join(repoRoot, relativePath)).href);
}

export async function loadAsyncApiSurfaces({
  repoRoot = process.cwd(),
} = {}) {
  const modules = await Promise.all(
    discoverAsyncApiSourceModules({ repoRoot })
      .filter((modulePath) => /\.(mjs|js|ts)$/.test(modulePath))
      .map((modulePath) => importModule(repoRoot, modulePath)),
  );
  return modules.flatMap((module) => Object.values(module).filter((value) =>
    value
    && typeof value === "object"
    && typeof value.id === "string"
    && typeof value.outputPath === "string"
    && typeof value.sourcePath === "string"
    && Array.isArray(value.channels),
  ));
}

export function analyzeAsyncApiContract({
  surfaces = [],
  readFile = defaultReadFile,
  expectedRegistryJson = "",
  expectedRegistryMarkdown = "",
  discoveredSourcePaths = [],
} = {}) {
  const diagnostics = [];
  const generatedOutputs = new Map();
  const entries = [];

  for (const surface of surfaces) {
    const id = String(surface?.id || "").trim();
    const version = String(surface?.version || "").trim();
    const sourcePath = String(surface?.sourcePath || "").trim();
    const outputPath = String(surface?.outputPath || "").trim();
    const title = String(surface?.title || "").trim();
    const producers = sortStrings(surface?.producers || []);
    const consumers = sortStrings(surface?.consumers || []);
    const channels = Array.isArray(surface?.channels) ? surface.channels : [];

    if (!id) diagnostics.push("asyncapi_missing_id");
    if (!version) diagnostics.push(`asyncapi_missing_version source=${JSON.stringify(sourcePath)}`);
    if (!sourcePath) diagnostics.push(`asyncapi_missing_source id=${JSON.stringify(id)}`);
    if (!outputPath) diagnostics.push(`asyncapi_missing_output id=${JSON.stringify(id)}`);
    if (!title) diagnostics.push(`asyncapi_missing_title id=${JSON.stringify(id)}`);
    if (channels.length === 0) diagnostics.push(`asyncapi_missing_channels id=${JSON.stringify(id)}`);

    if (outputPath) {
      generatedOutputs.set(outputPath, stringifyAsyncApiDocument(surface));
      if (readFile(outputPath) !== generatedOutputs.get(outputPath)) {
        diagnostics.push(`asyncapi_output_drift output=${JSON.stringify(outputPath)}`);
      }
    }

    const importNeedle = path.basename(sourcePath).replace(/\.(mjs|js|ts)$/i, "");
    for (const producerPath of producers) {
      if (!readFile(producerPath).includes(importNeedle)) {
        diagnostics.push(`asyncapi_producer_missing_contract_import producer=${JSON.stringify(producerPath)} source=${JSON.stringify(sourcePath)}`);
      }
    }
    for (const consumerPath of consumers) {
      if (!readFile(consumerPath).includes(importNeedle)) {
        diagnostics.push(`asyncapi_consumer_missing_contract_import consumer=${JSON.stringify(consumerPath)} source=${JSON.stringify(sourcePath)}`);
      }
    }

    entries.push({
      id,
      version,
      title,
      source_path: sourcePath,
      output_path: outputPath,
      producer_paths: producers,
      consumer_paths: consumers,
      channels: channels.length,
    });
  }

  const registeredSources = sortStrings(entries.map((entry) => entry.source_path));
  for (const sourcePath of sortStrings(discoveredSourcePaths)) {
    if (!registeredSources.includes(sourcePath)) {
      diagnostics.push(`asyncapi_unregistered_source source=${JSON.stringify(sourcePath)}`);
    }
  }

  const sortedEntries = entries.sort((left, right) => left.output_path.localeCompare(right.output_path));
  const renderMarkdown = (activeDiagnostics) => [
    "---",
    'doc_type: "reference"',
    'owner: "platform-architecture"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-21"',
    'status: "active"',
    'summary: "Governed AsyncAPI registry for asynchronous event capability surfaces."',
    "tags: [asyncapi, contracts, events]",
    'written: "2026-03-21"',
    "---",
    "# AsyncAPI Registry",
    "",
    `- Registered surfaces: ${sortedEntries.length}`,
    `- Diagnostics: ${activeDiagnostics.length}`,
    "",
    "## Registered Surfaces",
    "",
    ...sortedEntries.flatMap((entry) => [
      `- \`${entry.output_path}\``,
      `  - source: \`${entry.source_path}\``,
      `  - version: \`${entry.version}\``,
      `  - channels: \`${entry.channels}\``,
      `  - producers: ${entry.producer_paths.length > 0 ? entry.producer_paths.map((producer) => `\`${producer}\``).join(", ") : "none"}`,
      `  - consumers: ${entry.consumer_paths.length > 0 ? entry.consumer_paths.map((consumer) => `\`${consumer}\``).join(", ") : "none"}`,
    ]),
    "",
    "## Diagnostics",
    "",
    ...(activeDiagnostics.length > 0 ? activeDiagnostics.map((entry) => `- \`${entry}\``) : ["- none"]),
    "",
  ].join("\n");

  const contentDiagnostics = [...diagnostics];
  const report = {
    schema_version: "asyncapi_registry/v1",
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
  const renderedMarkdown = renderMarkdown(contentDiagnostics);

  if (expectedRegistryJson && expectedRegistryJson !== renderedJson) {
    diagnostics.push(`asyncapi_registry_report_drift path=${JSON.stringify(ASYNCAPI_REGISTRY_JSON_PATH)}`);
  }
  if (expectedRegistryMarkdown && expectedRegistryMarkdown.trimEnd() !== renderedMarkdown.trimEnd()) {
    diagnostics.push(`asyncapi_registry_report_drift path=${JSON.stringify(ASYNCAPI_REGISTRY_MARKDOWN_PATH)}`);
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    report,
    renderedJson,
    renderedMarkdown,
    generatedOutputs,
  };
}

export function writeAsyncApiArtifacts(
  analysis,
  {
    writeFile = defaultWriteFile,
  } = {},
) {
  for (const [outputPath, content] of analysis.generatedOutputs.entries()) {
    writeFile(outputPath, content);
  }
  writeFile(ASYNCAPI_REGISTRY_JSON_PATH, analysis.renderedJson);
  writeFile(ASYNCAPI_REGISTRY_MARKDOWN_PATH, `${analysis.renderedMarkdown}\n`);
}
