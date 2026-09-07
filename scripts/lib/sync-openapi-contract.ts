import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { stringifyOpenApiDocument } from "../../packages/factory-core/src/openapi-registry.ts";

export const SYNC_OPENAPI_REGISTRY_JSON_PATH = "docs/contracts/sync-openapi-registry.json";
export const SYNC_OPENAPI_REGISTRY_MARKDOWN_PATH = "docs/contracts/sync-openapi-registry.md";
export const HATCH_SYNC_OPENAPI_DIST_PATH = "apps/hatch/dist/server/openapi-contract.js";

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
    throw new Error(`sync_openapi_git_ls_files_failed:${String(run.stderr || run.stdout || "").trim()}`);
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

export function discoverSyncOpenApiSourceModules({
  repoRoot = process.cwd(),
  trackedFiles = listCandidateFiles(repoRoot),
} = {}) {
  return trackedFiles
    .filter((filePath) => isSourceCandidate(filePath))
    .filter((filePath) => /=\s*defineSyncHttpSurface\s*\(/.test(readModuleSource(repoRoot, filePath)))
    .sort((left, right) => left.localeCompare(right));
}

function buildHatch(repoRoot) {
  const run = spawnSync("pnpm", ["--filter", "hatch", "--silent", "build"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    throw new Error(`hatch_sync_openapi_build_failed:${String(run.stderr || run.stdout || "").trim()}`);
  }
}

async function importModule(repoRoot, relativePath) {
  return import(pathToFileURL(path.join(repoRoot, relativePath)).href);
}

export async function loadSyncOpenApiSurfaces({
  repoRoot = process.cwd(),
  buildHatchDist = true,
} = {}) {
  if (buildHatchDist) {
    buildHatch(repoRoot);
  }

  const module = await importModule(repoRoot, HATCH_SYNC_OPENAPI_DIST_PATH);
  const sourceModules = await Promise.all(
    discoverSyncOpenApiSourceModules({ repoRoot })
      .filter((modulePath) => /\.(mjs|js)$/.test(modulePath))
      .map((modulePath) => importModule(repoRoot, modulePath)),
  );
  return [
    ...sourceModules.flatMap((entry) => Object.values(entry).filter((value) =>
      value
      && typeof value === "object"
      && typeof value.id === "string"
      && typeof value.outputPath === "string"
      && typeof value.sourcePath === "string"
      && Array.isArray(value.operations)
    )),
    module.HATCH_SERVER_OPENAPI_SURFACE,
  ].filter(Boolean);
}

export function analyzeSyncOpenApiContract({
  surfaces = [],
  readFile = defaultReadFile,
  expectedRegistryJson = "",
  expectedRegistryMarkdown = "",
  discoveredSourcePaths = [],
} = {}) {
  const diagnostics = [];
  const generatedOutputs = new Map();
  const entries = [];
  const registeredSources = [];

  for (const surface of surfaces) {
    const id = String(surface?.id || "").trim();
    const version = String(surface?.version || "").trim();
    const sourcePath = String(surface?.sourcePath || "").trim();
    const outputPath = String(surface?.outputPath || "").trim();
    const title = String(surface?.title || "").trim();
    const consumers = sortStrings(surface?.consumers || []);

    if (!id) diagnostics.push("sync_openapi_missing_id");
    if (!version) diagnostics.push(`sync_openapi_missing_version source=${JSON.stringify(sourcePath)}`);
    if (!sourcePath) diagnostics.push(`sync_openapi_missing_source id=${JSON.stringify(id)}`);
    if (!outputPath) diagnostics.push(`sync_openapi_missing_output id=${JSON.stringify(id)}`);
    if (!title) diagnostics.push(`sync_openapi_missing_title id=${JSON.stringify(id)}`);
    if (!Array.isArray(surface?.operations) || surface.operations.length === 0) {
      diagnostics.push(`sync_openapi_missing_operations id=${JSON.stringify(id)}`);
    }

    if (outputPath) {
      generatedOutputs.set(outputPath, stringifyOpenApiDocument(surface));
      if (readFile(outputPath) !== generatedOutputs.get(outputPath)) {
        diagnostics.push(`sync_openapi_output_drift output=${JSON.stringify(outputPath)}`);
      }
    }

    for (const consumerPath of consumers) {
      const consumerSource = readFile(consumerPath);
      if (!consumerSource.includes("openapi-contract")) {
        diagnostics.push(
          `sync_openapi_consumer_missing_contract_import consumer=${JSON.stringify(consumerPath)} source=${JSON.stringify(sourcePath)}`,
        );
      }
    }

    entries.push({
      id,
      version,
      title,
      source_path: sourcePath,
      output_path: outputPath,
      consumer_paths: consumers,
      operations: Array.isArray(surface?.operations) ? surface.operations.length : 0,
    });
    if (sourcePath) {
      registeredSources.push(sourcePath);
    }
  }

  for (const sourcePath of sortStrings(discoveredSourcePaths)) {
    if (!registeredSources.includes(sourcePath)) {
      diagnostics.push(`sync_openapi_unregistered_source source=${JSON.stringify(sourcePath)}`);
    }
  }

  const sortedEntries = entries.sort((left, right) => left.output_path.localeCompare(right.output_path));

  const renderMarkdown = (activeDiagnostics) => [
    "---",
    'doc_type: "reference"',
    'owner: "platform-architecture"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-20"',
    'status: "active"',
    'summary: "Governed OpenAPI registry for synchronous Hatch capability surfaces."',
    "tags: [contracts, openapi, server, sync]",
    'written: "2026-03-20"',
    "---",
    "# Sync OpenAPI Registry",
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
      `  - operations: \`${entry.operations}\``,
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
    schema_version: "sync_openapi_registry/v1",
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
    diagnostics.push(`sync_openapi_registry_report_drift path=${JSON.stringify(SYNC_OPENAPI_REGISTRY_JSON_PATH)}`);
  }
  if (expectedRegistryMarkdown && expectedRegistryMarkdown.trimEnd() !== renderedMarkdown.trimEnd()) {
    diagnostics.push(`sync_openapi_registry_report_drift path=${JSON.stringify(SYNC_OPENAPI_REGISTRY_MARKDOWN_PATH)}`);
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

export function writeSyncOpenApiArtifacts(
  analysis,
  {
    writeFile = defaultWriteFile,
  } = {},
) {
  for (const [outputPath, content] of analysis.generatedOutputs.entries()) {
    writeFile(outputPath, content);
  }
  writeFile(SYNC_OPENAPI_REGISTRY_JSON_PATH, analysis.renderedJson);
  writeFile(SYNC_OPENAPI_REGISTRY_MARKDOWN_PATH, `${analysis.renderedMarkdown}\n`);
}
