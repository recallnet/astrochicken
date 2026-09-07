import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import path from "node:path";

import {
  ACTIVE_SURFACE_MANIFEST_PATH,
  classifyActiveSurfaceFiles,
  loadActiveSurfaceManifest,
  selectManifestScopedFiles,
} from "./active-surface-manifest.ts";
import { renderWorkflowSourceModuleToDot } from "../../packages/factory-core/src/workflow-ir-registry.ts";
import { exportWorkflowSourceDocument } from "../../packages/factory-core/src/workflow-source-registry.ts";

export const ACTIVE_SURFACE_INVENTORY_JSON_PATH = "docs/contracts/active-surface-inventory.json";
export const ACTIVE_SURFACE_INVENTORY_MARKDOWN_PATH = "docs/contracts/active-surface-inventory.md";

const ACTIVE_GRAPH_CLASSIFICATIONS = new Set(["active_factory", "active_runtime"]);
const ACTIVE_RUNTIME_CLASSIFICATIONS = new Set(["hot_path", "execution_path"]);
const ACTIVE_OWNER_CLASSIFICATION = "active_deterministic_owner";
const COMMAND_IMPORT_ROOT = "packages/factory-ops/src/commands/";
const COMMAND_FILE_PATTERN = /^packages\/factory-ops\/src\/commands\/.+\.(?:mjs|ts)$/;

function normalizePath(value = "") {
  return String(value || "").replace(/\\/g, "/");
}

function stableUnique(values = []) {
  return [...new Set(values.map((entry) => String(entry)).filter(Boolean))].sort();
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function safeReadJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return readJsonFile(filePath);
  } catch {
    return null;
  }
}

function resolveRepoPath(repoRoot, relativePath) {
  return path.resolve(repoRoot, normalizePath(relativePath));
}

function fileExists(repoRoot, relativePath) {
  return existsSync(resolveRepoPath(repoRoot, relativePath));
}

function isWorkflowSourcePath(relativePath = "") {
  return normalizePath(relativePath).endsWith(".workflow-source.mjs");
}

function loadGraphLikeSource(repoRoot, graphPath) {
  const normalizedPath = normalizePath(graphPath);
  if (!isWorkflowSourcePath(normalizedPath)) {
    return readFileSync(resolveRepoPath(repoRoot, normalizedPath), "utf8");
  }
  const workflowSourceDataPath = normalizedPath.replace(/\.workflow-source\.mjs$/u, ".workflow-source.data.json");
  const workflowSourceData = readJsonFile(resolveRepoPath(repoRoot, workflowSourceDataPath));
  return renderWorkflowSourceModuleToDot(exportWorkflowSourceDocument(workflowSourceData), {
    hostPath: normalizedPath,
  });
}

function resolveGraphReferencePath({ fromGraph = "", rawPath = "" } = {}) {
  const normalized = normalizePath(rawPath).trim();
  if (!normalized || normalized.includes("${")) return "";
  if (normalized.startsWith("@hatch/")) {
    return normalized.replace(/^@hatch\//, "packages/");
  }
  if (normalized.startsWith("factories/") || normalized.startsWith("packages/") || normalized.startsWith("docs/")) {
    return normalized;
  }
  return normalizePath(path.posix.normalize(path.posix.join(path.posix.dirname(fromGraph), normalized)));
}

export function extractStaticGraphReferences(content = "", graphPath = "") {
  const references = [];
  for (const regex of [
    /pipeline\s*=\s*"([^"]+\.(?:dot|workflow-source\.mjs))"/g,
    /template\s*=\s*"([^"]+\.(?:dot|workflow-source\.mjs))"/g,
  ]) {
    for (const match of content.matchAll(regex)) {
      const rawPath = normalizePath(match[1]);
      const resolvedPath = resolveGraphReferencePath({ fromGraph: graphPath, rawPath });
      references.push({
        raw_path: rawPath,
        resolved_path: resolvedPath,
        dynamic: resolvedPath.length === 0,
      });
    }
  }
  return references;
}

function collectFactoryConfigRoots(config = {}) {
  const roots = [];
  const pushRoot = (relativePath, sourceKind, sourceId) => {
    if (typeof relativePath !== "string" || (!relativePath.endsWith(".dot") && !relativePath.endsWith(".workflow-source.mjs"))) return;
    roots.push({
      path: normalizePath(relativePath),
      source_kind: sourceKind,
      source_id: sourceId,
    });
  };

  pushRoot(config?.dispatch?.graph, "factory_config.dispatch_graph", "dispatch.graph");
  for (const [key, value] of Object.entries(config?.pipeline || {})) {
    pushRoot(value, "factory_config.pipeline_graph", `pipeline.${key}`);
  }
  pushRoot(config?.conformance?.smoke_graph, "factory_config.conformance_smoke_graph", "conformance.smoke_graph");
  for (const job of Array.isArray(config?.schedules?.jobs) ? config.schedules.jobs : []) {
    pushRoot(job?.graph, "factory_config.scheduled_graph", String(job?.id || "scheduled_graph"));
  }

  return roots;
}

export function collectLiveGraphRoots({ repoRoot = process.cwd() } = {}) {
  const roots = [];
  const rootByKey = new Map();
  const pushRoot = (entry = {}) => {
    const graphPath = normalizePath(entry.path);
    if (!graphPath.endsWith(".dot") && !graphPath.endsWith(".workflow-source.mjs")) return;
    const key = `${graphPath}::${entry.source_kind}::${entry.source_id}`;
    if (rootByKey.has(key)) return;
    rootByKey.set(key, true);
    roots.push({
      path: graphPath,
      source_kind: String(entry.source_kind || ""),
      source_id: String(entry.source_id || ""),
      exists: fileExists(repoRoot, graphPath),
    });
  };

  const registry = safeReadJson(resolveRepoPath(repoRoot, "factory-registry.json"));
  for (const instance of Array.isArray(registry?.instances) ? registry.instances : []) {
    if (String(instance?.status || "").trim() !== "active") continue;
    for (const graph of Array.isArray(instance?.graphs) ? instance.graphs : []) {
      pushRoot({
        path: graph?.path,
        source_kind: "factory_registry.instance_graph",
        source_id: `${String(instance?.instance_id || "unknown")}::${String(graph?.id || "graph")}`,
      });
    }
  }

  const factoriesDir = resolveRepoPath(repoRoot, "factories");
  for (const factoryName of existsSync(factoriesDir) ? readdirSync(factoriesDir) : []) {
    const factoryRoot = path.join(factoriesDir, factoryName);
    const configPath = path.join(factoryRoot, "factory.config.json");
    const kindPath = path.join(factoryRoot, "kind.json");

    const config = safeReadJson(configPath);
    for (const root of collectFactoryConfigRoots(config)) {
      pushRoot(root);
    }

    const kind = safeReadJson(kindPath);
    if (typeof kind?.domain_graph === "string" && (kind.domain_graph.endsWith(".dot") || kind.domain_graph.endsWith(".workflow-source.mjs"))) {
      pushRoot({
        path: kind.domain_graph,
        source_kind: "factory_kind.domain_graph",
        source_id: `${factoryName}::domain_graph`,
      });
    }
  }

  return roots.sort((left, right) => {
    const pathCompare = left.path.localeCompare(right.path);
    if (pathCompare !== 0) return pathCompare;
    const sourceCompare = left.source_kind.localeCompare(right.source_kind);
    if (sourceCompare !== 0) return sourceCompare;
    return left.source_id.localeCompare(right.source_id);
  });
}

function loadCommandPathRegistry({ repoRoot = process.cwd(), files = [] } = {}) {
  const registry = new Map();
  for (const file of files.filter((entry) => COMMAND_FILE_PATTERN.test(entry))) {
    const resolvedPath = resolveRepoPath(repoRoot, file);
    if (!existsSync(resolvedPath)) {
      continue;
    }
    const content = readFileSync(resolvedPath, "utf8");
    const match = content.match(/static\s+paths\s*=\s*(\[[\s\S]*?\]);/);
    if (!match) continue;
    let pathsValue = [];
    try {
      pathsValue = Function(`"use strict"; return (${match[1]});`)();
    } catch {
      continue;
    }
    if (!Array.isArray(pathsValue)) continue;
    for (const commandPath of pathsValue) {
      if (!Array.isArray(commandPath)) continue;
      const key = commandPath.map((segment) => String(segment || "").trim()).filter(Boolean).join(" ");
      if (!key) continue;
      registry.set(key, file);
    }
  }
  return registry;
}

export function extractCliCommandReferences(content = "", commandPathRegistry = new Map()) {
  const references = [];
  for (const match of content.matchAll(/\bhatch-ops\s+([^"\n]+)/g)) {
    const tokens = String(match[1] || "").trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    let resolvedPath = "";
    for (let length = Math.min(4, tokens.length); length >= 1; length -= 1) {
      const candidate = tokens.slice(0, length).join(" ");
      if (commandPathRegistry.has(candidate)) {
        resolvedPath = candidate;
        break;
      }
    }
    if (!resolvedPath) continue;
    references.push({
      command_path: resolvedPath,
      command_file: commandPathRegistry.get(resolvedPath) || "",
    });
  }
  return references;
}

function expandCommandImportClosure({ repoRoot = process.cwd(), commandFiles = [] } = {}) {
  const seen = new Set();
  const queue = [...commandFiles];

  while (queue.length > 0) {
    const commandFile = normalizePath(queue.pop());
    if (!commandFile || seen.has(commandFile) || !fileExists(repoRoot, commandFile)) continue;
    seen.add(commandFile);
    const content = readFileSync(resolveRepoPath(repoRoot, commandFile), "utf8");
    for (const match of content.matchAll(/(?:import|from)\s+["'](\.[^"']+)["']/g)) {
      let importedPath = normalizePath(path.posix.normalize(path.posix.join(path.posix.dirname(commandFile), match[1])));
      if (!importedPath.endsWith(".mjs") && !importedPath.endsWith(".ts")) importedPath += ".ts";
      if (!importedPath.startsWith(COMMAND_IMPORT_ROOT)) continue;
      queue.push(importedPath);
    }
  }

  return [...seen].sort();
}

function activeRuntimeEntries({ manifest, files = [] }) {
  const activeFiles = selectManifestScopedFiles({
    manifest,
    files,
    surfaceType: "runtime",
    classifications: [...ACTIVE_RUNTIME_CLASSIFICATIONS],
  });
  const classified = classifyActiveSurfaceFiles({ manifest, files });
  return activeFiles.map((file) => {
    const match = classified.classificationByFile.get(file);
    return {
      path: file,
      classification: match?.classification || "",
      entry_id: match?.entryId || "",
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function activeGraphEntries({ manifest, files = [], liveRoots = [], repoRoot = process.cwd() } = {}) {
  const classified = classifyActiveSurfaceFiles({ manifest, files });
  const activeRoots = liveRoots.filter((entry) => {
    const match = classified.classificationByFile.get(entry.path);
    return ACTIVE_GRAPH_CLASSIFICATIONS.has(String(match?.classification || ""));
  });
  const queue = activeRoots.map((entry) => entry.path);
  const seen = new Set();
  const reachedBy = new Map();
  const rootSourcesByPath = new Map();
  const graphReferences = [];
  const diagnostics = [];

  for (const root of liveRoots) {
    if (!rootSourcesByPath.has(root.path)) rootSourcesByPath.set(root.path, []);
    rootSourcesByPath.get(root.path).push({
      source_kind: root.source_kind,
      source_id: root.source_id,
      exists: root.exists,
    });
    if (!root.exists) {
      diagnostics.push(`missing_live_graph_root file=${JSON.stringify(root.path)} source=${JSON.stringify(root.source_kind)} id=${JSON.stringify(root.source_id)}`);
    }
  }

  while (queue.length > 0) {
    const graphPath = normalizePath(queue.pop());
    if (!graphPath || seen.has(graphPath)) continue;
    seen.add(graphPath);
    if (!fileExists(repoRoot, graphPath)) continue;
    const content = loadGraphLikeSource(repoRoot, graphPath);
    const references = extractStaticGraphReferences(content, graphPath);
    for (const reference of references) {
      graphReferences.push({
        source_graph: graphPath,
        raw_path: reference.raw_path,
        resolved_path: reference.resolved_path,
        dynamic: reference.dynamic,
      });
      if (!reference.resolved_path) continue;
      if (!reachedBy.has(reference.resolved_path)) reachedBy.set(reference.resolved_path, new Set());
      reachedBy.get(reference.resolved_path).add(graphPath);
      const match = classified.classificationByFile.get(reference.resolved_path);
      if (ACTIVE_GRAPH_CLASSIFICATIONS.has(String(match?.classification || ""))) {
        queue.push(reference.resolved_path);
      }
    }
  }

  const activeGraphs = [...seen].map((graphPath) => {
    const match = classified.classificationByFile.get(graphPath);
    return {
      path: graphPath,
      classification: match?.classification || "",
      entry_id: match?.entryId || "",
      root_sources: (rootSourcesByPath.get(graphPath) || []).sort((left, right) => (
        left.source_kind.localeCompare(right.source_kind) || left.source_id.localeCompare(right.source_id)
      )),
      reached_from: stableUnique([...(reachedBy.get(graphPath) || new Set())]),
    };
  }).sort((left, right) => left.path.localeCompare(right.path));

  return {
    active_graphs: activeGraphs,
    graph_references: graphReferences.sort((left, right) => (
      left.source_graph.localeCompare(right.source_graph)
      || left.raw_path.localeCompare(right.raw_path)
      || left.resolved_path.localeCompare(right.resolved_path)
    )),
    diagnostics,
  };
}

function buildActiveCommandReachability({
  repoRoot = process.cwd(),
  manifest,
  files = [],
  activeGraphs = [],
  activeRuntimeFiles = [],
}) {
  const commandRegistry = loadCommandPathRegistry({ repoRoot, files });
  const classified = classifyActiveSurfaceFiles({ manifest, files });
  const sourceEntries = [
    ...activeGraphs.map((entry) => ({ surface_type: "graph", path: entry.path })),
    ...activeRuntimeFiles.map((entry) => ({ surface_type: "runtime", path: entry.path })),
  ];
  const directReferences = [];

  for (const sourceEntry of sourceEntries) {
    if (!fileExists(repoRoot, sourceEntry.path)) continue;
    const content = readFileSync(resolveRepoPath(repoRoot, sourceEntry.path), "utf8");
    for (const reference of extractCliCommandReferences(content, commandRegistry)) {
      directReferences.push({
        surface_type: sourceEntry.surface_type,
        source_path: sourceEntry.path,
        command_path: reference.command_path,
        command_file: reference.command_file,
      });
    }
  }

  const reachableCommandFiles = expandCommandImportClosure({
    repoRoot,
    commandFiles: directReferences.map((entry) => entry.command_file),
  });
  const diagnostics = [];
  const reachableCommands = reachableCommandFiles.map((commandFile) => {
    const match = classified.classificationByFile.get(commandFile);
    const entry = {
      path: commandFile,
      classification: match?.classification || "",
      entry_id: match?.entryId || "",
    };
    if (entry.classification !== ACTIVE_OWNER_CLASSIFICATION) {
      diagnostics.push(
        `active_surface_command_reachability_violation file=${JSON.stringify(commandFile)} classification=${JSON.stringify(entry.classification || "unclassified")} expected=${JSON.stringify(ACTIVE_OWNER_CLASSIFICATION)}`,
      );
    }
    return entry;
  });

  return {
    direct_references: directReferences.sort((left, right) => (
      left.source_path.localeCompare(right.source_path)
      || left.command_path.localeCompare(right.command_path)
    )),
    reachable_commands: reachableCommands.sort((left, right) => left.path.localeCompare(right.path)),
    diagnostics,
  };
}

export function buildActiveSurfaceInventory({
  repoRoot = process.cwd(),
  files = [],
  manifest = loadActiveSurfaceManifest({ repoRoot, manifestPath: ACTIVE_SURFACE_MANIFEST_PATH }),
} = {}) {
  const existingFiles = files.filter((file) => fileExists(repoRoot, file));
  const classification = classifyActiveSurfaceFiles({ manifest, files: existingFiles });
  const liveRoots = collectLiveGraphRoots({ repoRoot });
  const runtimeEntries = activeRuntimeEntries({ manifest, files: existingFiles });
  const graphInventory = activeGraphEntries({ manifest, files: existingFiles, liveRoots, repoRoot });
  const commandReachability = buildActiveCommandReachability({
    repoRoot,
    manifest,
    files: existingFiles,
    activeGraphs: graphInventory.active_graphs,
    activeRuntimeFiles: runtimeEntries,
  });

  const rootEntries = liveRoots.map((root) => {
    const match = classification.classificationByFile.get(root.path);
    return {
      path: root.path,
      source_kind: root.source_kind,
      source_id: root.source_id,
      exists: root.exists,
      classification: match?.classification || "",
      entry_id: match?.entryId || "",
    };
  }).sort((left, right) => (
    left.path.localeCompare(right.path) || left.source_kind.localeCompare(right.source_kind) || left.source_id.localeCompare(right.source_id)
  ));

  const diagnostics = [
    ...classification.diagnostics.filter((entry) => /\bkind=(graph|runtime)\b/.test(entry)),
    ...graphInventory.diagnostics,
    ...commandReachability.diagnostics,
  ];

  return {
    schema_version: "active_surface_inventory/v1",
    manifest_path: ACTIVE_SURFACE_MANIFEST_PATH,
    live_graph_roots: rootEntries,
    active_graphs: graphInventory.active_graphs,
    active_runtime_files: runtimeEntries,
    active_command_references: commandReachability.direct_references,
    active_command_reachable_files: commandReachability.reachable_commands,
    graph_references: graphInventory.graph_references,
    diagnostics: stableUnique(diagnostics),
    summary: {
      live_graph_roots: rootEntries.length,
      active_graphs: graphInventory.active_graphs.length,
      active_runtime_files: runtimeEntries.length,
      active_command_references: commandReachability.direct_references.length,
      active_command_reachable_files: commandReachability.reachable_commands.length,
      diagnostics: stableUnique(diagnostics).length,
    },
  };
}

export function renderActiveSurfaceInventoryMarkdown(inventory = {}) {
  const lines = [
    "---",
    'doc_type: "reference"',
    'owner: "docs-stewards"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-20"',
    'status: "active"',
    'summary: "Generated audit inventory for the canonical active graph, runtime, and reachable command surface used by Phase 0.2 and Phase 1 gating."',
    'tags: [architecture, contracts, generated, graphs, inventory, runtime]',
    'written: "2026-03-20"',
    "---",
    "",
    "# Active Surface Inventory",
    "",
    `Schema: \`${String(inventory.schema_version || "")}\``,
    `Manifest: \`${String(inventory.manifest_path || "")}\``,
    `Live graph roots: ${Number(inventory?.summary?.live_graph_roots || 0)}`,
    `Active graphs: ${Number(inventory?.summary?.active_graphs || 0)}`,
    `Active runtime files: ${Number(inventory?.summary?.active_runtime_files || 0)}`,
    `Active command references: ${Number(inventory?.summary?.active_command_references || 0)}`,
    `Reachable active command files: ${Number(inventory?.summary?.active_command_reachable_files || 0)}`,
    `Diagnostics: ${Number(inventory?.summary?.diagnostics || 0)}`,
    "",
    "## Live Graph Roots",
    "",
    "| Path | Classification | Source |",
    "| --- | --- | --- |",
    ...(Array.isArray(inventory.live_graph_roots) ? inventory.live_graph_roots : []).map((entry) => (
      `| \`${entry.path}\` | \`${entry.classification}\` | \`${entry.source_kind}:${entry.source_id}\` |`
    )),
    "",
    "## Active Graphs",
    "",
    "| Path | Classification | Entry |",
    "| --- | --- | --- |",
    ...(Array.isArray(inventory.active_graphs) ? inventory.active_graphs : []).map((entry) => (
      `| \`${entry.path}\` | \`${entry.classification}\` | \`${entry.entry_id}\` |`
    )),
    "",
    "## Active Runtime Files",
    "",
    "| Path | Classification | Entry |",
    "| --- | --- | --- |",
    ...(Array.isArray(inventory.active_runtime_files) ? inventory.active_runtime_files : []).map((entry) => (
      `| \`${entry.path}\` | \`${entry.classification}\` | \`${entry.entry_id}\` |`
    )),
    "",
    "## Active Command References",
    "",
    "| Source | Command Path | Command File |",
    "| --- | --- | --- |",
    ...(Array.isArray(inventory.active_command_references) ? inventory.active_command_references : []).map((entry) => (
      `| \`${entry.source_path}\` | \`${entry.command_path}\` | \`${entry.command_file}\` |`
    )),
    "",
    "## Reachable Command Files",
    "",
    "| Path | Classification | Entry |",
    "| --- | --- | --- |",
    ...(Array.isArray(inventory.active_command_reachable_files) ? inventory.active_command_reachable_files : []).map((entry) => (
      `| \`${entry.path}\` | \`${entry.classification}\` | \`${entry.entry_id}\` |`
    )),
    "",
    "## Diagnostics",
    "",
    ...(Array.isArray(inventory.diagnostics) && inventory.diagnostics.length > 0
      ? inventory.diagnostics.map((entry) => `- ${entry}`)
      : ["- none"]),
    "",
  ];

  return `${lines.join("\n")}\n`;
}
