import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  exportBoundaryJsonSchema,
  stringifySchemaDocument,
} from "../../packages/factory-core/src/schema-registry.ts";

export const BOUNDARY_SCHEMA_REGISTRY_JSON_PATH = "docs/contracts/boundary-schema-registry.json";
export const BOUNDARY_SCHEMA_REGISTRY_MARKDOWN_PATH = "docs/contracts/boundary-schema-registry.md";

const HATCH_BOUNDARY_REGISTRY_DIST_PATH = "apps/hatch/dist/factory/boundary-schema-registry.js";

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
    throw new Error(`boundary_schema_git_ls_files_failed:${String(run.stderr || run.stdout || "").trim()}`);
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

export function discoverBoundarySchemaSourceModules({
  repoRoot = process.cwd(),
  trackedFiles = listCandidateFiles(repoRoot),
} = {}) {
  return trackedFiles
    .filter((filePath) => isSourceCandidate(filePath))
    .filter((filePath) => /=\s*defineBoundarySchema\s*\(/.test(readModuleSource(repoRoot, filePath)))
    .sort((left, right) => left.localeCompare(right));
}

function buildHatchRegistry(repoRoot) {
  const run = spawnSync("pnpm", ["--filter", "hatch", "--silent", "build"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    throw new Error(`hatch_boundary_schema_build_failed:${String(run.stderr || run.stdout || "").trim()}`);
  }
}

async function importModule(repoRoot, relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  return import(pathToFileURL(absolutePath).href);
}

export async function loadBoundarySchemaDefinitions({
  repoRoot = process.cwd(),
  buildHatch = true,
} = {}) {
  if (buildHatch) {
    buildHatchRegistry(repoRoot);
  }

  const hatchRegistryModule = await importModule(repoRoot, HATCH_BOUNDARY_REGISTRY_DIST_PATH);
  const sourceModulePaths = discoverBoundarySchemaSourceModules({ repoRoot })
    .filter((modulePath) => /\.(mjs|js)$/.test(modulePath));
  const sourceModules = await Promise.all(sourceModulePaths.map((modulePath) => importModule(repoRoot, modulePath)));

  const definitions = [
    ...sourceModules.flatMap((module, index) => {
      const definitionModulePath = sourceModulePaths[index];
      return Object.values(module)
        .filter((value) =>
          value
          && typeof value === "object"
          && typeof value.id === "string"
          && typeof value.outputPath === "string"
          && typeof value.sourcePath === "string"
          && value.schema,
        )
        .map((definition) => ({ ...definition, definitionModulePath }));
    }),
    ...(hatchRegistryModule.HATCH_BOUNDARY_SCHEMA_REGISTRY || []),
  ];
  const deduped = new Map();
  for (const definition of definitions) {
    const key = `${String(definition?.id || "")}::${String(definition?.outputPath || "")}::${String(definition?.sourcePath || "")}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, definition);
      continue;
    }
    deduped.set(key, {
      ...existing,
      ...definition,
      definitionModulePath: String(existing?.definitionModulePath || definition?.definitionModulePath || "").trim(),
    });
  }
  return [...deduped.values()];
}

export function analyzeBoundarySchemaContract({
  definitions = [],
  readFile = defaultReadFile,
  governedOutputPaths = [],
  expectedRegistryJson = "",
  expectedRegistryMarkdown = "",
  discoveredSourcePaths = [],
} = {}) {
  const diagnostics = [];
  const entries = [];
  const seenIds = new Set();
  const seenOutputs = new Set();
  const generatedOutputs = new Map();

  for (const definition of definitions) {
    const id = String(definition?.id || "").trim();
    const version = String(definition?.version || "").trim();
    const sourcePath = String(definition?.sourcePath || "").trim();
    const outputPath = String(definition?.outputPath || "").trim();
    const documentVersionField = String(definition?.documentVersionField || "schema_version").trim();
    const definitionModulePath = String(definition?.definitionModulePath || "").trim();

    if (!id) diagnostics.push("boundary_schema_missing_id");
    if (!version) diagnostics.push(`boundary_schema_missing_version source=${JSON.stringify(sourcePath)}`);
    if (!sourcePath) diagnostics.push(`boundary_schema_missing_source id=${JSON.stringify(id)}`);
    if (!outputPath) diagnostics.push(`boundary_schema_missing_output id=${JSON.stringify(id)}`);

    if (id) {
      if (seenIds.has(id)) diagnostics.push(`boundary_schema_duplicate_id id=${JSON.stringify(id)}`);
      seenIds.add(id);
    }

    if (outputPath) {
      if (seenOutputs.has(outputPath)) diagnostics.push(`boundary_schema_duplicate_output output=${JSON.stringify(outputPath)}`);
      seenOutputs.add(outputPath);
      generatedOutputs.set(outputPath, stringifySchemaDocument(exportBoundaryJsonSchema(definition)));
    }

    entries.push({
      id,
      version,
      document_version_field: documentVersionField,
      title: String(definition?.title || "").trim(),
      source_path: sourcePath,
      definition_module_path: definitionModulePath,
      output_path: outputPath,
    });
  }

  const governedOutputs = sortStrings(governedOutputPaths.length > 0 ? governedOutputPaths : [...generatedOutputs.keys()]);
  const registeredOutputs = sortStrings([...generatedOutputs.keys()]);
  const registeredSources = sortStrings(entries.flatMap((entry) => [entry.source_path, entry.definition_module_path]));

  // Only check source paths that were actually importable for dynamic registration.
  // .ts files are handled through the compiled hatch registry or future TS-aware loaders.
  const importableDiscoveredPaths = sortStrings(discoveredSourcePaths)
    .filter((filePath) => /\.(mjs|js)$/.test(filePath));
  for (const sourcePath of importableDiscoveredPaths) {
    if (!registeredSources.includes(sourcePath)) {
      diagnostics.push(`boundary_schema_unregistered_source source=${JSON.stringify(sourcePath)}`);
    }
  }

  for (const outputPath of governedOutputs) {
    if (!generatedOutputs.has(outputPath)) {
      diagnostics.push(`boundary_schema_unregistered_output output=${JSON.stringify(outputPath)}`);
      continue;
    }
    const expected = generatedOutputs.get(outputPath) || "";
    const actual = readFile(outputPath);
    if (actual !== expected) {
      diagnostics.push(`boundary_schema_output_drift output=${JSON.stringify(outputPath)}`);
    }
  }

  const sortedEntries = entries.sort((left, right) => left.output_path.localeCompare(right.output_path));

  const renderMarkdown = (activeDiagnostics) => [
    "---",
    "doc_type: \"reference\"",
    "owner: \"platform-architecture\"",
    "review_policy: \"periodic-7\"",
    "reviewed: \"2026-03-20\"",
    "status: \"active\"",
    "summary: \"Governed Zod-authored boundary schema registry and generated JSON Schema outputs for Phase 3.1.\"",
    "tags: [contracts, json-schema, schemas, zod]",
    "written: \"2026-03-20\"",
    "---",
    "# Boundary Schema Registry",
    "",
    `- Registered boundaries: ${sortedEntries.length}`,
    `- Governed outputs: ${governedOutputs.length}`,
    `- Diagnostics: ${activeDiagnostics.length}`,
    "",
    "## Registered Boundaries",
    "",
    ...sortedEntries
      .flatMap((entry) => [
        `- \`${entry.output_path}\``,
        `  - source: \`${entry.source_path}\``,
        `  - version: \`${entry.version}\``,
        `  - document version field: \`${entry.document_version_field}\``,
      ]),
    "",
    "## Diagnostics",
    "",
    ...(activeDiagnostics.length > 0 ? activeDiagnostics.map((entry) => `- \`${entry}\``) : ["- none"]),
    "",
  ].join("\n");

  const contentDiagnostics = [...diagnostics];

  const initialReport = {
    schema_version: "boundary_schema_registry/v1",
    summary: {
      registered_boundaries: sortedEntries.length,
      governed_outputs: governedOutputs.length,
      discovered_sources: sortStrings(discoveredSourcePaths).length,
      diagnostics: contentDiagnostics.length,
    },
    governed_output_paths: governedOutputs,
    registered_output_paths: registeredOutputs,
    discovered_source_paths: sortStrings(discoveredSourcePaths),
    boundaries: sortedEntries,
    diagnostics: contentDiagnostics,
  };
  const initialJson = stableJson(initialReport);
  const initialMarkdown = renderMarkdown(contentDiagnostics);

  if (expectedRegistryJson && expectedRegistryJson !== initialJson) {
    diagnostics.push(`boundary_schema_registry_report_drift path=${JSON.stringify(BOUNDARY_SCHEMA_REGISTRY_JSON_PATH)}`);
  }
  if (expectedRegistryMarkdown && expectedRegistryMarkdown.trimEnd() !== initialMarkdown.trimEnd()) {
    diagnostics.push(`boundary_schema_registry_report_drift path=${JSON.stringify(BOUNDARY_SCHEMA_REGISTRY_MARKDOWN_PATH)}`);
  }
  const report = {
    schema_version: "boundary_schema_registry/v1",
    summary: {
      registered_boundaries: sortedEntries.length,
      governed_outputs: governedOutputs.length,
      discovered_sources: sortStrings(discoveredSourcePaths).length,
      diagnostics: contentDiagnostics.length,
    },
    governed_output_paths: governedOutputs,
    registered_output_paths: registeredOutputs,
    discovered_source_paths: sortStrings(discoveredSourcePaths),
    boundaries: sortedEntries,
    diagnostics: contentDiagnostics,
  };

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    report,
    renderedJson: stableJson(report),
    renderedMarkdown: renderMarkdown(contentDiagnostics),
    generatedOutputs,
  };
}

export function writeBoundarySchemaArtifacts(
  analysis,
  {
    writeFile = defaultWriteFile,
  } = {},
) {
  for (const [outputPath, content] of analysis.generatedOutputs.entries()) {
    writeFile(outputPath, content);
  }
  writeFile(BOUNDARY_SCHEMA_REGISTRY_JSON_PATH, analysis.renderedJson);
  writeFile(BOUNDARY_SCHEMA_REGISTRY_MARKDOWN_PATH, `${analysis.renderedMarkdown}\n`);
}
