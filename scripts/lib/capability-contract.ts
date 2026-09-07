import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { stringifyCapabilityContractDocument } from "../../packages/factory-core/src/capability-contract-registry.ts";

export const CAPABILITY_CONTRACT_REGISTRY_JSON_PATH = "docs/contracts/capability-contract-registry.json";
export const CAPABILITY_CONTRACT_REGISTRY_MARKDOWN_PATH = "docs/contracts/capability-contract-registry.md";

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sortStrings(values = []) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

export function readText(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

export function listCandidateFiles(repoRoot) {
  const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" });
  if (tracked.status !== 0) {
    throw new Error(`capability_contract_git_ls_files_failed:${String(tracked.stderr || tracked.stdout || "").trim()}`);
  }
  return String(tracked.stdout || "")
    .split("\0")
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

export function discoverCapabilityPackagePaths(trackedFiles = []) {
  return trackedFiles
    .filter((filePath) => /^packages\/capability-[^/]+\/package\.json$/.test(filePath))
    .map((filePath) => filePath.replace(/\/package\.json$/, ""))
    .sort((left, right) => left.localeCompare(right));
}

async function importModule(repoRoot, relativePath) {
  return import(pathToFileURL(path.join(repoRoot, relativePath)).href);
}

export async function loadSurface(repoRoot, packageRoot) {
  const module = await importModule(repoRoot, `${packageRoot}/capability-contract.mjs`);
  return Object.values(module).find((value) =>
    value
    && typeof value === "object"
    && typeof value.packageName === "string"
    && typeof value.outputPath === "string"
    && Array.isArray(value.entrypoints)
  );
}

function listDotFiles(repoRoot, packageRoot) {
  const graphsRoot = path.join(repoRoot, packageRoot, "graphs");
  if (!existsSync(graphsRoot)) return [];
  const discovered = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".dot")) {
        discovered.push(path.relative(path.join(repoRoot, packageRoot), fullPath).replaceAll("\\", "/"));
      }
    }
  };
  walk(graphsRoot);
  return discovered.sort((left, right) => left.localeCompare(right));
}

function renderMarkdown(entries, diagnostics) {
  return [
    "---",
    'doc_type: "reference"',
    'owner: "platform-architecture"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-21"',
    'status: "active"',
    'summary: "Governed registry for standard capability contract surfaces."',
    'tags: [capability, contracts, generated, registry]',
    'written: "2026-03-21"',
    "---",
    "",
    "# Capability Contract Registry",
    "",
    `- Registered capabilities: ${entries.length}`,
    `- Diagnostics: ${diagnostics.length}`,
    "",
    "## Capability Surfaces",
    "",
    ...entries.flatMap((entry) => [
      `- \`${entry.package_name}\``,
      `  - contract: \`${entry.output_path}\``,
      `  - source: \`${entry.source_path}\``,
      `  - sync entrypoints: \`${entry.sync_entrypoints}\``,
      `  - async entrypoints: \`${entry.async_entrypoints}\``,
      `  - reusable across factories: \`${entry.reusable_across_factories}\``,
    ]),
    "",
    "## Diagnostics",
    "",
    ...(diagnostics.length > 0 ? diagnostics.map((entry) => `- \`${entry}\``) : ["- none"]),
    "",
  ].join("\n");
}

export async function analyzeCapabilityContract({
  repoRoot = process.cwd(),
  trackedFiles = listCandidateFiles(repoRoot),
} = {}) {
  const diagnostics = [];
  const packageRoots = discoverCapabilityPackagePaths(trackedFiles);
  const entries = [];

  for (const packageRoot of packageRoots) {
    const packageJsonPath = path.join(repoRoot, packageRoot, "package.json");
    const packageJson = JSON.parse(readText(packageJsonPath) || "{}");
    const sourcePath = `${packageRoot}/capability-contract.mjs`;
    const legacyManifestPath = path.join(repoRoot, packageRoot, "capability.json");

    if (!existsSync(path.join(repoRoot, sourcePath))) {
      diagnostics.push(`capability_contract_missing_source source=${JSON.stringify(sourcePath)}`);
      continue;
    }

    const surface = await loadSurface(repoRoot, packageRoot);
    if (!surface) {
      diagnostics.push(`capability_contract_missing_surface_export source=${JSON.stringify(sourcePath)}`);
      continue;
    }

    const rendered = stringifyCapabilityContractDocument(surface);
    const currentOutput = readText(path.join(repoRoot, surface.outputPath));
    if (currentOutput !== rendered) {
      diagnostics.push(`capability_contract_output_drift output=${JSON.stringify(surface.outputPath)}`);
    }

    const exportsField = packageJson.exports || {};
    if (!("./contract" in exportsField)) {
      diagnostics.push(`capability_contract_missing_export package=${JSON.stringify(packageRoot)} export="./contract"`);
    } else if (exportsField["./contract"] !== "./capability-contract.v1.json") {
      diagnostics.push(`capability_contract_export_miswired package=${JSON.stringify(packageRoot)} export="./contract" target=${JSON.stringify(exportsField["./contract"])}`);
    }
    if ("./capability.json" in exportsField) {
      diagnostics.push(`capability_contract_legacy_export_present package=${JSON.stringify(packageRoot)} export="./capability.json"`);
    }
    if ((packageJson.files || []).includes("capability.json")) {
      diagnostics.push(`capability_contract_legacy_file_listed package=${JSON.stringify(packageRoot)} file="capability.json"`);
    }
    if (existsSync(legacyManifestPath)) {
      diagnostics.push(`capability_contract_legacy_manifest_present path=${JSON.stringify(`${packageRoot}/capability.json`)}`);
    }

    if (surface.reusableAcrossFactories !== true) {
      diagnostics.push(`capability_contract_not_factory_reusable package=${JSON.stringify(packageRoot)}`);
    }
    if (surface.privateGlueRequired) {
      diagnostics.push(`capability_contract_private_glue_required package=${JSON.stringify(packageRoot)}`);
    }

    const declaredGraphs = sortStrings(
      (surface.entrypoints || [])
        .filter((entrypoint) => entrypoint.kind === "graph")
        .map((entrypoint) => entrypoint.path),
    );
    const discoveredGraphs = listDotFiles(repoRoot, packageRoot);
    for (const dotPath of discoveredGraphs) {
      if (!declaredGraphs.includes(dotPath)) {
        diagnostics.push(`capability_contract_unregistered_graph package=${JSON.stringify(packageRoot)} graph=${JSON.stringify(dotPath)}`);
      }
    }
    for (const entrypoint of surface.entrypoints || []) {
      if (!entrypoint.id || !entrypoint.path || !entrypoint.transport || !entrypoint.kind) {
        diagnostics.push(`capability_contract_invalid_entrypoint package=${JSON.stringify(packageRoot)} entrypoint=${JSON.stringify(entrypoint.id || entrypoint.path || "unknown")}`);
      }
      if (entrypoint.kind === "graph" && !existsSync(path.join(repoRoot, packageRoot, entrypoint.path))) {
        diagnostics.push(`capability_contract_missing_graph package=${JSON.stringify(packageRoot)} graph=${JSON.stringify(entrypoint.path)}`);
      }
      if (entrypoint.kind === "module" && entrypoint.path !== ".") {
        diagnostics.push(`capability_contract_invalid_module_entrypoint package=${JSON.stringify(packageRoot)} path=${JSON.stringify(entrypoint.path)}`);
      }
    }
    for (const skillPath of surface.skillPaths || []) {
      if (!existsSync(path.join(repoRoot, packageRoot, skillPath))) {
        diagnostics.push(`capability_contract_missing_skill package=${JSON.stringify(packageRoot)} skill=${JSON.stringify(skillPath)}`);
      }
    }

    entries.push({
      package_name: surface.packageName,
      capability_id: surface.capabilityId,
      version: surface.version,
      source_path: surface.sourcePath,
      output_path: surface.outputPath,
      sync_entrypoints: (surface.entrypoints || []).filter((entrypoint) => entrypoint.transport === "sync").length,
      async_entrypoints: (surface.entrypoints || []).filter((entrypoint) => entrypoint.transport === "async").length,
      reusable_across_factories: surface.reusableAcrossFactories === true,
    });
  }

  const sortedEntries = entries.sort((left, right) => left.package_name.localeCompare(right.package_name));
  const report = {
    schema_version: "capability_contract_registry/v1",
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

export async function writeCapabilityContractOutputs({
  repoRoot = process.cwd(),
  trackedFiles = listCandidateFiles(repoRoot),
} = {}) {
  const initialResult = await analyzeCapabilityContract({ repoRoot, trackedFiles });
  for (const packageRoot of initialResult.packageRoots) {
    const surface = await loadSurface(repoRoot, packageRoot);
    if (!surface) continue;
    writeFileSync(path.join(repoRoot, surface.outputPath), stringifyCapabilityContractDocument(surface), "utf8");
  }
  const finalResult = await analyzeCapabilityContract({ repoRoot, trackedFiles });
  writeFileSync(path.join(repoRoot, CAPABILITY_CONTRACT_REGISTRY_JSON_PATH), finalResult.renderedJson, "utf8");
  writeFileSync(path.join(repoRoot, CAPABILITY_CONTRACT_REGISTRY_MARKDOWN_PATH), finalResult.renderedMarkdown, "utf8");
  return finalResult;
}
