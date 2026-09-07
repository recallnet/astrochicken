import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  discoverCapabilityPackagePaths,
  listCandidateFiles,
  loadSurface,
  readText,
  sortStrings,
  stableJson,
} from "./capability-contract.ts";
import {
  stringifyCapabilityManifestDocument,
} from "../../packages/factory-core/src/capability-contract-registry.ts";

export const CAPABILITY_MANIFEST_REGISTRY_JSON_PATH = "docs/contracts/capability-manifest-registry.json";
export const CAPABILITY_MANIFEST_REGISTRY_MARKDOWN_PATH = "docs/contracts/capability-manifest-registry.md";

function listFilesInDir(repoRoot, packageRoot, dirName, predicate = () => true) {
  const root = path.join(repoRoot, packageRoot, dirName);
  if (!existsSync(root)) return [];
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && predicate(entry.name, fullPath)) {
        files.push(path.relative(path.join(repoRoot, packageRoot), fullPath).replaceAll("\\", "/"));
      }
    }
  };
  walk(root);
  return sortStrings(files);
}

function collectProducerPaths(surface = {}) {
  return sortStrings([
    ...(surface.outputSurfaces?.events || []).flatMap((entry) => entry.producerPaths || []),
    ...(surface.outputSurfaces?.artifacts || []).flatMap((entry) => entry.producerPaths || []),
    ...(surface.outputSurfaces?.telemetry || []).flatMap((entry) => entry.producerPaths || []),
  ]);
}

function manifestPathFor(packageRoot) {
  return `${packageRoot}/capability-manifest.v1.json`;
}

function renderMarkdown(entries, diagnostics) {
  return [
    "---",
    'doc_type: "reference"',
    'owner: "platform-architecture"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-21"',
    'status: "active"',
    'summary: "Generated registry for governed capability manifests."',
    'tags: [capability, contracts, generated, manifests, registry]',
    'written: "2026-03-21"',
    "---",
    "",
    "# Capability Manifest Registry",
    "",
    `- Registered capability manifests: ${entries.length}`,
    `- Diagnostics: ${diagnostics.length}`,
    "",
    "## Capability Manifests",
    "",
    ...entries.flatMap((entry) => [
      `- \`${entry.package_name}\``,
      `  - manifest: \`${entry.manifest_path}\``,
      `  - contract: \`${entry.contract_path}\``,
      `  - graphs: \`${entry.graph_count}\``,
      `  - prompts: \`${entry.prompt_count}\``,
      `  - skills: \`${entry.skill_count}\``,
      `  - producer paths: \`${entry.producer_path_count}\``,
    ]),
    "",
    "## Diagnostics",
    "",
    ...(diagnostics.length > 0 ? diagnostics.map((entry) => `- \`${entry}\``) : ["- none"]),
    "",
  ].join("\n");
}

export async function analyzeCapabilityManifestContract({
  repoRoot = process.cwd(),
  trackedFiles = listCandidateFiles(repoRoot),
} = {}) {
  const diagnostics = [];
  const entries = [];
  const packageRoots = discoverCapabilityPackagePaths(trackedFiles);

  for (const packageRoot of packageRoots) {
    const packageJsonPath = path.join(repoRoot, packageRoot, "package.json");
    const packageJson = JSON.parse(readText(packageJsonPath) || "{}");
    const surface = await loadSurface(repoRoot, packageRoot);
    if (!surface) {
      diagnostics.push(`capability_manifest_missing_surface_export package=${JSON.stringify(packageRoot)}`);
      continue;
    }

    const manifestPath = manifestPathFor(packageRoot);
    const graphPaths = (surface.entrypoints || [])
      .filter((entrypoint) => entrypoint.kind === "graph")
      .map((entrypoint) => entrypoint.path);
    const promptPaths = listFilesInDir(repoRoot, packageRoot, "prompts");
    const discoveredSkillPaths = listFilesInDir(repoRoot, packageRoot, "skills");
    const producerPaths = collectProducerPaths(surface);
    const supportFilePaths = sortStrings([
      ...producerPaths.filter((entry) => !graphPaths.includes(entry) && !discoveredSkillPaths.includes(entry) && !promptPaths.includes(entry)),
      ...(existsSync(path.join(repoRoot, packageRoot, "README.md")) ? ["README.md"] : []),
      ...(existsSync(path.join(repoRoot, packageRoot, "timeouts.defaults.json")) ? ["timeouts.defaults.json"] : []),
    ]);

    const rendered = stringifyCapabilityManifestDocument(surface, {
      packageRoot,
      manifestPath,
      contractPath: surface.outputPath,
      packageJsonPath: `${packageRoot}/package.json`,
      packageMetadata: {
        description: packageJson.description,
        exports: packageJson.exports || {},
        files: packageJson.files || [],
      },
      graphPaths,
      promptPaths,
      skillPaths: discoveredSkillPaths,
      supportFilePaths,
      producerPaths,
    });

    const currentOutput = readText(path.join(repoRoot, manifestPath));
    if (currentOutput !== rendered) {
      diagnostics.push(`capability_manifest_output_drift output=${JSON.stringify(manifestPath)}`);
    }

    const exportsField = packageJson.exports || {};
    if (!("./manifest" in exportsField)) {
      diagnostics.push(`capability_manifest_missing_export package=${JSON.stringify(packageRoot)} export="./manifest"`);
    } else if (exportsField["./manifest"] !== "./capability-manifest.v1.json") {
      diagnostics.push(`capability_manifest_export_miswired package=${JSON.stringify(packageRoot)} export="./manifest" target=${JSON.stringify(exportsField["./manifest"])}`);
    }
    if (!("./capability-manifest.v1.json" in exportsField)) {
      diagnostics.push(`capability_manifest_missing_versioned_export package=${JSON.stringify(packageRoot)} export="./capability-manifest.v1.json"`);
    }
    if ((packageJson.files || []).includes("capability-manifest.json")) {
      diagnostics.push(`capability_manifest_legacy_file_listed package=${JSON.stringify(packageRoot)} file="capability-manifest.json"`);
    }
    if (!(packageJson.files || []).includes("capability-manifest.v1.json")) {
      diagnostics.push(`capability_manifest_missing_published_file package=${JSON.stringify(packageRoot)} file="capability-manifest.v1.json"`);
    }
    if (existsSync(path.join(repoRoot, packageRoot, "capability-manifest.json"))) {
      diagnostics.push(`capability_manifest_legacy_manifest_present path=${JSON.stringify(`${packageRoot}/capability-manifest.json`)}`);
    }

    for (const filePath of [...graphPaths, ...discoveredSkillPaths, ...promptPaths, ...producerPaths]) {
      if (!existsSync(path.join(repoRoot, packageRoot, filePath))) {
        diagnostics.push(`capability_manifest_missing_surface_path package=${JSON.stringify(packageRoot)} path=${JSON.stringify(filePath)}`);
      }
    }

    entries.push({
      package_name: surface.packageName,
      capability_id: surface.capabilityId,
      manifest_path: manifestPath,
      contract_path: surface.outputPath,
      graph_count: graphPaths.length,
      prompt_count: promptPaths.length,
      skill_count: discoveredSkillPaths.length,
      producer_path_count: producerPaths.length,
    });
  }

  const sortedEntries = entries.sort((left, right) => left.package_name.localeCompare(right.package_name));
  const report = {
    schema_version: "capability_manifest_registry/v1",
    summary: {
      registered_capabilities: sortedEntries.length,
      diagnostics: diagnostics.length,
    },
    capabilities: sortedEntries,
    diagnostics,
  };

  return {
    ok: diagnostics.length === 0,
    report,
    renderedJson: stableJson(report),
    renderedMarkdown: renderMarkdown(sortedEntries, diagnostics),
    packageRoots,
  };
}

export async function writeCapabilityManifestOutputs({
  repoRoot = process.cwd(),
  trackedFiles = listCandidateFiles(repoRoot),
} = {}) {
  const initialResult = await analyzeCapabilityManifestContract({ repoRoot, trackedFiles });
  for (const packageRoot of initialResult.packageRoots) {
    const packageJson = JSON.parse(readText(path.join(repoRoot, packageRoot, "package.json")) || "{}");
    const surface = await loadSurface(repoRoot, packageRoot);
    if (!surface) continue;
    const manifestPath = manifestPathFor(packageRoot);
    const graphPaths = (surface.entrypoints || [])
      .filter((entrypoint) => entrypoint.kind === "graph")
      .map((entrypoint) => entrypoint.path);
    const promptPaths = listFilesInDir(repoRoot, packageRoot, "prompts");
    const discoveredSkillPaths = listFilesInDir(repoRoot, packageRoot, "skills");
    const producerPaths = collectProducerPaths(surface);
    const supportFilePaths = sortStrings([
      ...producerPaths.filter((entry) => !graphPaths.includes(entry) && !discoveredSkillPaths.includes(entry) && !promptPaths.includes(entry)),
      ...(existsSync(path.join(repoRoot, packageRoot, "README.md")) ? ["README.md"] : []),
      ...(existsSync(path.join(repoRoot, packageRoot, "timeouts.defaults.json")) ? ["timeouts.defaults.json"] : []),
    ]);
    writeFileSync(
      path.join(repoRoot, manifestPath),
      stringifyCapabilityManifestDocument(surface, {
        packageRoot,
        manifestPath,
        contractPath: surface.outputPath,
        packageJsonPath: `${packageRoot}/package.json`,
        packageMetadata: {
          description: packageJson.description,
          exports: packageJson.exports || {},
          files: packageJson.files || [],
        },
        graphPaths,
        promptPaths,
        skillPaths: discoveredSkillPaths,
        supportFilePaths,
        producerPaths,
      }),
      "utf8",
    );
  }
  const finalResult = await analyzeCapabilityManifestContract({ repoRoot, trackedFiles });
  writeFileSync(path.join(repoRoot, CAPABILITY_MANIFEST_REGISTRY_JSON_PATH), finalResult.renderedJson, "utf8");
  writeFileSync(path.join(repoRoot, CAPABILITY_MANIFEST_REGISTRY_MARKDOWN_PATH), finalResult.renderedMarkdown, "utf8");
  return finalResult;
}
