import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  exportWorkflowSourceDocument,
  stringifyWorkflowSourceModuleJsonSchema,
} from "../../packages/factory-core/src/workflow-source-registry.ts";

export const WORKFLOW_SOURCE_REGISTRY_JSON_PATH = "docs/contracts/workflow-source-registry.json";
export const WORKFLOW_SOURCE_REGISTRY_MARKDOWN_PATH = "docs/contracts/workflow-source-registry.md";
export const WORKFLOW_SOURCE_SCHEMA_OUTPUT_PATH = "docs/contracts/workflow-source-module.v1.schema.json";
export const GOVERNED_EXECUTION_DOT_EXEMPTIONS_PATH = "docs/contracts/governed-execution-dot-exemptions.json";
const ACTIVE_SURFACE_MANIFEST_PATH = "docs/contracts/active-surface-manifest.json";
const HATCH_PARSE_DIST_PATH = "apps/hatch/dist/pipeline/parse.js";
const ALLOWED_DOT_EXEMPTION_CLASSES = new Set(["explicit_exempt_template"]);

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sortStrings(values = []) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function defaultReadFile(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function defaultImportWorkflowSource(repoRoot, relativePath) {
  return import(pathToFileURL(path.join(repoRoot, relativePath)).href);
}

function isWorkflowSourceModulePath(filePath = "") {
  return /\/workflows\/.+\.workflow-source\.mjs$/.test(String(filePath || "").trim());
}

function isGovernedExecutionGraphPath(filePath = "") {
  const normalized = String(filePath || "").trim();
  return /^factories\/(?!_templates\/|_shared\/)[^/]+\/graphs\/.+\.dot$/.test(normalized)
    || /^packages\/[^/]+\/graphs\/.+\.dot$/.test(normalized);
}

function listCandidateFiles(repoRoot) {
  const list = (args) => {
    const run = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
    if (run.status !== 0) {
      throw new Error(`workflow_source_git_ls_files_failed:${String(run.stderr || run.stdout || "").trim()}`);
    }
    return String(run.stdout || "")
      .split("\0")
      .map((value) => String(value || "").trim())
      .filter(Boolean);
  };
  return [...new Set([
    ...list(["ls-files", "-z"]),
    ...list(["ls-files", "--others", "--exclude-standard", "-z"]),
  ])].sort((left, right) => left.localeCompare(right));
}

function readPath(readFile, repoRoot, relativePath) {
  return readFile(path.join(repoRoot, relativePath)) || readFile(relativePath) || "";
}

function listRequiredMothershipMigratedSources(readFile, repoRoot) {
  try {
    const manifest = JSON.parse(readPath(readFile, repoRoot, ACTIVE_SURFACE_MANIFEST_PATH) || "{}");
    const families = Array.isArray(manifest.graph_families) ? manifest.graph_families : [];
    return [...new Set(families
      .filter((entry) => entry?.classification === "active_factory")
      .flatMap((entry) => Array.isArray(entry.include) ? entry.include : [])
      .map((entry) => String(entry || "").trim())
      .filter((entry) => entry.startsWith("factories/mothership/workflows/") && entry.endsWith(".workflow-source.mjs")))]
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function loadGovernedExecutionDotExemptions(readFile, repoRoot, trackedFiles) {
  const diagnostics = [];
  const exemptGraphs = new Set();
  const trackedSet = new Set((trackedFiles || []).map((entry) => String(entry || "").trim()).filter(Boolean));
  let report = {
    schema_version: "governed_execution_dot_exemptions/v1",
    exemptions: [],
  };

  const raw = readPath(readFile, repoRoot, GOVERNED_EXECUTION_DOT_EXEMPTIONS_PATH).trim();
  if (!raw) {
    diagnostics.push(`workflow_source_governed_execution_dot_exemption_missing_contract path=${JSON.stringify(GOVERNED_EXECUTION_DOT_EXEMPTIONS_PATH)}`);
    return { diagnostics, exemptGraphs, report };
  }

  try {
    const parsed = JSON.parse(raw);
    const exemptions = Array.isArray(parsed?.exemptions) ? parsed.exemptions : [];
    report = {
      schema_version: String(parsed?.schema_version || "governed_execution_dot_exemptions/v1"),
      exemptions: exemptions.map((entry) => ({
        graph_path: String(entry?.graph_path || "").trim(),
        classification: String(entry?.classification || "").trim(),
        owner: String(entry?.owner || "").trim(),
        rationale: String(entry?.rationale || "").trim(),
      })),
    };

    for (const entry of report.exemptions) {
      if (!entry.graph_path || !isGovernedExecutionGraphPath(entry.graph_path)) {
        diagnostics.push(`workflow_source_governed_execution_dot_exemption_invalid path=${JSON.stringify(entry.graph_path)} reason="graph_path_must_target_governed_execution_dot"`);
        continue;
      }
      if (!ALLOWED_DOT_EXEMPTION_CLASSES.has(entry.classification)) {
        diagnostics.push(`workflow_source_governed_execution_dot_exemption_invalid path=${JSON.stringify(entry.graph_path)} reason="classification_invalid" classification=${JSON.stringify(entry.classification)}`);
      }
      if (!entry.owner) {
        diagnostics.push(`workflow_source_governed_execution_dot_exemption_invalid path=${JSON.stringify(entry.graph_path)} reason="owner_required"`);
      }
      if (!entry.rationale) {
        diagnostics.push(`workflow_source_governed_execution_dot_exemption_invalid path=${JSON.stringify(entry.graph_path)} reason="rationale_required"`);
      }
      if (!trackedSet.has(entry.graph_path)) {
        diagnostics.push(`workflow_source_governed_execution_dot_exemption_stale path=${JSON.stringify(entry.graph_path)}`);
      }
      exemptGraphs.add(entry.graph_path);
    }
  } catch (error) {
    diagnostics.push(`workflow_source_governed_execution_dot_exemption_invalid path=${JSON.stringify(GOVERNED_EXECUTION_DOT_EXEMPTIONS_PATH)} reason=${JSON.stringify(String(error?.message || error || "invalid_json"))}`);
  }

  return { diagnostics, exemptGraphs, report };
}

function buildHatch(repoRoot) {
  const run = spawnSync("pnpm", ["--filter", "hatch", "--silent", "build"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    throw new Error(`workflow_source_hatch_build_failed:${String(run.stderr || run.stdout || "").trim()}`);
  }
}

export function shouldBuildHatchDist(repoRoot) {
  return !existsSync(path.join(repoRoot, HATCH_PARSE_DIST_PATH));
}

function renderMarkdown(entries, diagnostics, exemptionReport = { exemptions: [] }) {
  const exemptions = Array.isArray(exemptionReport?.exemptions) ? exemptionReport.exemptions : [];
  return [
    "---",
    'doc_type: "reference"',
    'owner: "platform-architecture"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-21"',
    'status: "active"',
    'summary: "Governed registry for typed workflow source modules and migrated handwritten DOT ownership markers."',
    'tags: [contracts, dot, hatch, source, workflows]',
    'written: "2026-03-21"',
    "---",
    "",
    "# Workflow Source Registry",
    "",
    "- Canonical source-module layout: `factories/<factory>/workflows/<family>/<workflow>.workflow-source.mjs`",
    "- Runtime graph ownership marker: graph attr `workflow_source=\"<source-module>\"`",
    "- Phase 9.2 runtime IR policy: migrated families treat checked-in DOT as generated runtime IR derived from typed source.",
    "- `docs/contracts/governed-execution-dot-exemptions.json` is debt inventory only; any nonzero entry count means governed DOT elimination is incomplete.",
    "",
    `- Registered workflow sources: ${entries.length}`,
    `- Explicit governed DOT exemptions: ${exemptions.length}`,
    `- Diagnostics: ${diagnostics.length}`,
    "",
    "## Registered Workflow Sources",
    "",
    ...entries.flatMap((entry) => [
      `- \`${entry.workflow_id}\``,
      `  - family: \`${entry.family_id}\``,
      `  - source: \`${entry.source_path}\``,
      `  - runtime graph: \`${entry.runtime_graph_path}\``,
      `  - nodes: \`${entry.node_count}\``,
      `  - edges: \`${entry.edge_count}\``,
    ]),
    "",
    "## Explicit DOT Exemptions",
    "",
    ...(exemptions.length > 0 ? exemptions.flatMap((entry) => [
      `- \`${entry.graph_path}\``,
      `  - classification: \`${entry.classification}\``,
      `  - owner: \`${entry.owner}\``,
      `  - rationale: ${entry.rationale}`,
    ]) : ["- none"]),
    "",
    "## Diagnostics",
    "",
    ...(diagnostics.length > 0 ? diagnostics.map((entry) => `- \`${entry}\``) : ["- none"]),
    "",
  ].join("\n");
}

function parseDotFallback(input = "") {
  const graphNameMatch = input.match(/digraph\s+([A-Za-z0-9_]+)/);
  const attrs = Object.create(null);
  for (const match of input.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"/gm)) {
    attrs[match[1]] = match[2];
  }
  const nodes = Object.create(null);
  for (const match of input.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\[(.*?)\]/gms)) {
    nodes[match[1]] = { id: match[1] };
  }
  const edges = [];
  for (const match of input.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)(?:\s*\[(.*?)\])?/g)) {
    const edgeAttrs = Object.create(null);
    const rawAttrList = match[3] || "";
    for (const attrMatch of rawAttrList.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"/g)) {
      edgeAttrs[attrMatch[1]] = attrMatch[2];
    }
    edges.push({ from: match[1], to: match[2], attrs: edgeAttrs });
  }
  return {
    name: graphNameMatch ? graphNameMatch[1] : "",
    attrs,
    nodes,
    edges,
  };
}

export async function analyzeWorkflowSourceContract({
  repoRoot = process.cwd(),
  trackedFiles = listCandidateFiles(repoRoot),
  readFile = defaultReadFile,
  importWorkflowSource = defaultImportWorkflowSource,
  parseDot,
  buildHatchDist = true,
  expectedRegistryJson = "",
  expectedRegistryMarkdown = "",
} = {}) {
  let dotParser = parseDot;
  if (!dotParser) {
    if (buildHatchDist && shouldBuildHatchDist(repoRoot)) {
      buildHatch(repoRoot);
    }
    try {
      const parseModule = await import(pathToFileURL(path.join(repoRoot, HATCH_PARSE_DIST_PATH)).href);
      dotParser = parseModule.parse;
    } catch {
      dotParser = parseDotFallback;
    }
  }
  const diagnostics = [];
  const entries = [];
  const sourceModulePaths = trackedFiles.filter((filePath) => isWorkflowSourceModulePath(filePath));
  const runtimeGraphsBySource = new Map();
  const requiredMothershipSources = listRequiredMothershipMigratedSources(readFile, repoRoot);
  const runtimeGraphsWithSource = new Set();
  const governedDotExemptions = loadGovernedExecutionDotExemptions(readFile, repoRoot, trackedFiles);
  diagnostics.push(...governedDotExemptions.diagnostics);
  if ((governedDotExemptions.report?.exemptions || []).length > 0) {
    diagnostics.push(`workflow_source_governed_execution_dot_exemption_inventory_nonzero count=${(governedDotExemptions.report?.exemptions || []).length}`);
  }

  for (const filePath of trackedFiles.filter((entry) => entry.endsWith(".dot"))) {
    const sourceText = readPath(readFile, repoRoot, filePath);
    if (!sourceText) continue;
    const parsed = dotParser(sourceText);
    const declaredSource = String(parsed?.attrs?.workflow_source || "").trim();
    if (declaredSource) {
      runtimeGraphsBySource.set(declaredSource, { filePath, parsed });
      runtimeGraphsWithSource.add(filePath);
    }
  }

  const loadedModules = new Map();
  for (const sourceModulePath of sourceModulePaths) {
    const moduleNamespace = await importWorkflowSource(repoRoot, sourceModulePath);
    const exported = moduleNamespace.WORKFLOW_SOURCE_MODULE
      || moduleNamespace.default
      || Object.values(moduleNamespace).find((value) => value && typeof value === "object" && value.workflowId && value.runtimeGraphPath);
    if (!exported) {
      diagnostics.push(`workflow_source_missing_export source=${JSON.stringify(sourceModulePath)}`);
      continue;
    }
    try {
      const document = exportWorkflowSourceDocument({
        ...exported,
        sourcePath: sourceModulePath,
      });
      loadedModules.set(sourceModulePath, document);
    } catch (error) {
      diagnostics.push(`workflow_source_schema_invalid source=${JSON.stringify(sourceModulePath)} error=${JSON.stringify(String(error?.message || error || "invalid"))}`);
    }
  }

  for (const [sourceModulePath, document] of loadedModules.entries()) {
    if (document.sourcePath !== sourceModulePath) {
      diagnostics.push(`workflow_source_path_mismatch source=${JSON.stringify(sourceModulePath)} declared=${JSON.stringify(document.sourcePath)}`);
    }

    const runtimeGraph = runtimeGraphsBySource.get(sourceModulePath);
    if (!runtimeGraph) {
      diagnostics.push(`workflow_source_missing_runtime_graph_marker source=${JSON.stringify(sourceModulePath)} graph=${JSON.stringify(document.runtimeGraphPath)}`);
      continue;
    }

    if (runtimeGraph.filePath !== document.runtimeGraphPath) {
      diagnostics.push(`workflow_source_runtime_graph_path_drift source=${JSON.stringify(sourceModulePath)} actual=${JSON.stringify(runtimeGraph.filePath)} declared=${JSON.stringify(document.runtimeGraphPath)}`);
    }

    if (runtimeGraph.parsed.name !== document.sourceMap.graphName) {
      diagnostics.push(`workflow_source_runtime_graph_name_drift source=${JSON.stringify(sourceModulePath)} actual=${JSON.stringify(runtimeGraph.parsed.name)} expected=${JSON.stringify(document.sourceMap.graphName)}`);
    }

    const expectedLabel = String(document.graphAttributes?.label || document.workflowId || "").trim();
    if (String(runtimeGraph.parsed.attrs?.label || "") !== expectedLabel) {
      diagnostics.push(`workflow_source_runtime_graph_label_drift source=${JSON.stringify(sourceModulePath)} actual=${JSON.stringify(String(runtimeGraph.parsed.attrs?.label || ""))} expected=${JSON.stringify(expectedLabel)}`);
    }

    const runtimeNodeIds = new Set(Object.keys(runtimeGraph.parsed.nodes || {}));
    const runtimeEdges = new Set((runtimeGraph.parsed.edges || []).map((edge) => `${edge.from}->${edge.to}:${String(edge.attrs?.condition || "")}`));

    for (const node of document.nodes) {
      if (!runtimeNodeIds.has(node.id)) {
        diagnostics.push(`workflow_source_runtime_node_missing source=${JSON.stringify(sourceModulePath)} node=${JSON.stringify(node.id)}`);
      }
    }

    for (const edge of document.edges) {
      if (!runtimeEdges.has(`${edge.from}->${edge.to}:${String(edge.condition || "")}`)) {
        diagnostics.push(`workflow_source_runtime_edge_missing source=${JSON.stringify(sourceModulePath)} edge=${JSON.stringify(`${edge.from}->${edge.to}`)}`);
      }
    }

    for (const mapping of document.sourceMap.nodeMappings) {
      if (!runtimeNodeIds.has(mapping.runtimeNodeId)) {
        diagnostics.push(`workflow_source_mapping_target_missing source=${JSON.stringify(sourceModulePath)} runtime_node=${JSON.stringify(mapping.runtimeNodeId)}`);
      }
    }

    for (const node of document.nodes) {
      if (node.composition?.templateWorkflowRef && !loadedModules.has(node.composition.templateWorkflowRef) && !sourceModulePaths.includes(node.composition.templateWorkflowRef)) {
        diagnostics.push(`workflow_source_unknown_template_ref source=${JSON.stringify(sourceModulePath)} ref=${JSON.stringify(node.composition.templateWorkflowRef)}`);
      }
    }

    entries.push({
      workflow_id: document.workflowId,
      family_id: document.familyId,
      source_path: sourceModulePath,
      runtime_graph_path: document.runtimeGraphPath,
      node_count: document.nodes.length,
      edge_count: document.edges.length,
    });
  }

  for (const [declaredSource, runtimeGraph] of runtimeGraphsBySource.entries()) {
    if (!loadedModules.has(declaredSource)) {
      diagnostics.push(`workflow_source_missing_for_runtime_graph graph=${JSON.stringify(runtimeGraph.filePath)} source=${JSON.stringify(declaredSource)}`);
    }
  }

  for (const graphPath of trackedFiles.filter((entry) => isGovernedExecutionGraphPath(entry))) {
    if (!readPath(readFile, repoRoot, graphPath)) {
      continue;
    }
    if (governedDotExemptions.exemptGraphs.has(graphPath)) {
      continue;
    }
    if (!runtimeGraphsWithSource.has(graphPath)) {
      diagnostics.push(`workflow_source_governed_execution_dot_input_forbidden graph=${JSON.stringify(graphPath)}`);
    }
  }

  for (const sourcePath of requiredMothershipSources) {
    if (!loadedModules.has(sourcePath)) {
      diagnostics.push(`workflow_source_active_mothership_graph_not_migrated source=${JSON.stringify(sourcePath)}`);
    }
  }

  const sortedEntries = [...entries].sort((left, right) => left.source_path.localeCompare(right.source_path));
  const report = {
    schema_version: "workflow_source_registry/v1",
    summary: {
      registered_workflow_sources: sortedEntries.length,
      explicit_governed_dot_exemptions: governedDotExemptions.exemptGraphs.size,
      diagnostics: diagnostics.length,
    },
    workflow_sources: sortedEntries,
    governed_dot_exemptions: governedDotExemptions.report.exemptions,
    diagnostics,
  };

  const renderedJson = stableJson(report);
  const renderedMarkdown = `${renderMarkdown(sortedEntries, diagnostics, governedDotExemptions.report)}\n`;
  const expectedSchema = stringifyWorkflowSourceModuleJsonSchema();
  if (expectedRegistryJson && expectedRegistryJson !== renderedJson) {
    diagnostics.push(`workflow_source_registry_drift path=${JSON.stringify(WORKFLOW_SOURCE_REGISTRY_JSON_PATH)}`);
  }
  if (expectedRegistryMarkdown && expectedRegistryMarkdown.trimEnd() !== renderedMarkdown.trimEnd()) {
    diagnostics.push(`workflow_source_registry_drift path=${JSON.stringify(WORKFLOW_SOURCE_REGISTRY_MARKDOWN_PATH)}`);
  }
  const currentSchema = readPath(readFile, repoRoot, WORKFLOW_SOURCE_SCHEMA_OUTPUT_PATH);
  if (currentSchema !== expectedSchema) {
    diagnostics.push(`workflow_source_schema_drift path=${JSON.stringify(WORKFLOW_SOURCE_SCHEMA_OUTPUT_PATH)}`);
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    report: {
      ...report,
      diagnostics,
      summary: {
        ...report.summary,
        diagnostics: diagnostics.length,
      },
    },
    renderedJson: stableJson({
      ...report,
      diagnostics,
      summary: {
        ...report.summary,
        diagnostics: diagnostics.length,
      },
    }),
    renderedMarkdown,
    renderedSchema: expectedSchema,
  };
}

export async function writeWorkflowSourceOutputs({
  repoRoot = process.cwd(),
  trackedFiles = listCandidateFiles(repoRoot),
} = {}) {
  const analysis = await analyzeWorkflowSourceContract({ repoRoot, trackedFiles });
  writeFileSync(path.join(repoRoot, WORKFLOW_SOURCE_SCHEMA_OUTPUT_PATH), analysis.renderedSchema, "utf8");
  const finalAnalysis = await analyzeWorkflowSourceContract({ repoRoot, trackedFiles });
  writeFileSync(path.join(repoRoot, WORKFLOW_SOURCE_REGISTRY_JSON_PATH), finalAnalysis.renderedJson, "utf8");
  writeFileSync(path.join(repoRoot, WORKFLOW_SOURCE_REGISTRY_MARKDOWN_PATH), finalAnalysis.renderedMarkdown, "utf8");
  return analyzeWorkflowSourceContract({
    repoRoot,
    trackedFiles,
    expectedRegistryJson: readFileSync(path.join(repoRoot, WORKFLOW_SOURCE_REGISTRY_JSON_PATH), "utf8"),
    expectedRegistryMarkdown: readFileSync(path.join(repoRoot, WORKFLOW_SOURCE_REGISTRY_MARKDOWN_PATH), "utf8").trimEnd(),
  });
}
