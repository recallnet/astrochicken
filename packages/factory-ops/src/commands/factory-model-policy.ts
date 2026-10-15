import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadGraphSemanticsText } from "@hatch/factory-core/graph-source-loader";

import { loadFactoryConfig } from "./factory-config-loader.ts";
import { trim } from "../lib/cli-helpers.ts";

const require = createRequire(import.meta.url);
const REPO_ROOT = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const BENCHMARK_QUERIES_PATH = fileURLToPath(new URL("../../../../docs/contracts/langfuse-benchmark-queries.json", import.meta.url));

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

function readJsonFileOrThrow(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${path}: ${String(error?.message || error)}`);
  }
}

function importIfExists(filePath = "") {
  const resolved = trim(filePath);
  if (!resolved || !existsSync(resolved)) return null;
  return import(pathToFileURL(resolved).href);
}

async function loadRuntimeModelPolicyModule() {
  const moduleDir = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [
    resolve(moduleDir, "../../../../apps/hatch/dist/factory/model-policy.js"),
    resolve(process.cwd(), "apps/hatch/dist/factory/model-policy.js"),
  ];

  const contextRepoRoot = trim(process.env.FACTORY_CONTEXT_REPO_PATH || "");
  if (contextRepoRoot) {
    candidates.push(resolve(contextRepoRoot, "apps/hatch/dist/factory/model-policy.js"));
  }

  for (const candidate of candidates) {
    const loaded = await importIfExists(candidate);
    if (!loaded) continue;
    if (
      typeof loaded.resolveEffectiveModelPolicyForPipeline === "function"
      && typeof loaded.resolveModelPolicyForNode === "function"
    ) {
      return loaded;
    }
  }

  try {
    const fromSubpath = await import("hatch/factory/model-policy");
    if (
      typeof fromSubpath.resolveEffectiveModelPolicyForPipeline === "function"
      && typeof fromSubpath.resolveModelPolicyForNode === "function"
    ) {
      return fromSubpath;
    }
  } catch {
    // fall through
  }

  try {
    const hatch = await import("hatch");
    if (
      typeof hatch.resolveEffectiveModelPolicyForPipeline === "function"
      && typeof hatch.resolveModelPolicyForNode === "function"
    ) {
      return hatch;
    }
  } catch {
    // fall through
  }

  throw new Error("Unable to load runtime model-policy resolver from hatch");
}

async function loadNodeRoutingPolicyModule() {
  const moduleDir = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [
    resolve(moduleDir, "../../../../apps/hatch/dist/pipeline/llm-routing-policy.js"),
    resolve(process.cwd(), "apps/hatch/dist/pipeline/llm-routing-policy.js"),
  ];

  const contextRepoRoot = trim(process.env.FACTORY_CONTEXT_REPO_PATH || "");
  if (contextRepoRoot) {
    candidates.push(resolve(contextRepoRoot, "apps/hatch/dist/pipeline/llm-routing-policy.js"));
  }

  for (const candidate of candidates) {
    const loaded = await importIfExists(candidate);
    if (!loaded) continue;
    if (
      typeof loaded.resolveRoutingPolicyForNode === "function"
      && typeof loaded.formatRoutingPolicySummary === "function"
    ) {
      return loaded;
    }
  }

  try {
    const hatch = await import("hatch");
    if (
      typeof hatch.resolveRoutingPolicyForNode === "function"
      && typeof hatch.formatRoutingPolicySummary === "function"
    ) {
      return hatch;
    }
  } catch {
    // fall through
  }

  throw new Error("Unable to load node routing policy resolver from hatch");
}


async function loadHatchGraphRuntime() {
  const hatch = await import("hatch");
  if (
    typeof hatch.parseWithAst !== "function"
    || typeof hatch.applyGraphStylesheetImports !== "function"
  ) {
    throw new Error("hatch graph parser/runtime exports unavailable");
  }
  return hatch;
}

function resolveFactoryRootFromFactoryId(factoryId = "") {
  const id = trim(factoryId);
  if (!id) return "";

  const candidates = [
    join(REPO_ROOT, "factories", id),
    join(REPO_ROOT, "examples", "external-factories", id),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "factory.config.json"))) {
      return candidate;
    }
  }
  return "";
}

function resolveFactoryConfigInputs({ factoryRoot = "", factoryId = "", factoryConfigPath = "" } = {}) {
  const root = trim(factoryRoot) || resolveFactoryRootFromFactoryId(factoryId);
  return {
    factoryRoot: root,
    factoryConfigPath: trim(factoryConfigPath),
  };
}

function loadBenchmarkQueryDescriptions() {
  const parsed = readJsonFileOrThrow(BENCHMARK_QUERIES_PATH, "benchmark query contract");
  const rows = Array.isArray(parsed) ? parsed : [];
  const byQueryId = new Map();
  for (const row of rows) {
    const queryId = trim(row?.query_id);
    if (!queryId) continue;
    byQueryId.set(queryId, trim(row?.description));
  }
  return byQueryId;
}

function resolveGraphPath(rawPath = "", { factoryRoot = "", repoRoot = REPO_ROOT } = {}) {
  const raw = trim(rawPath);
  if (!raw) throw new Error("graph selector cannot be empty");

  if (raw.startsWith("@")) {
    try {
      return require.resolve(raw, { paths: [repoRoot] });
    } catch (error) {
      throw new Error(`Unable to resolve graph package path: ${raw} (${String(error?.message || error)})`);
    }
  }

  if (isAbsolute(raw)) {
    if (!existsSync(raw)) throw new Error(`Graph not found: ${raw}`);
    return raw;
  }

  const relativeCandidates = [];
  if (raw.endsWith(".dot") && !raw.includes("/")) {
    relativeCandidates.push(join(factoryRoot, "graphs", raw));
  }
  relativeCandidates.push(join(factoryRoot, raw));
  relativeCandidates.push(join(repoRoot, raw));

  for (const candidate of relativeCandidates) {
    if (existsSync(candidate)) {
      return resolve(candidate);
    }
  }

  throw new Error(`Graph not found: ${raw}`);
}

function toRepoRelativePath(absolutePath = "") {
  const abs = resolve(absolutePath);
  const relativePath = relative(REPO_ROOT, abs).split("\\").join("/");
  return relativePath.startsWith("..") ? abs : relativePath;
}

function resolveDefaultPipelineGraphPath(loadedConfig) {
  const config = asObject(loadedConfig?.config) || {};
  const dispatch = asObject(config.dispatch) || {};
  const pipeline = asObject(config.pipeline) || {};
  const candidate = trim(dispatch.graph) || trim(pipeline.supervisor_tick) || "graphs/factory_supervisor_tick.dot";
  return resolveGraphPath(candidate, { factoryRoot: loadedConfig.factoryRoot, repoRoot: REPO_ROOT });
}

function normalizeSelector({ graph = "", node = "", className = "", role = "", llmPathId = "" } = {}) {
  return {
    graph: trim(graph),
    node: trim(node),
    class: trim(className),
    role: trim(role),
    llm_path_id: trim(llmPathId),
  };
}

function hasSelector(selector = {}) {
  return Boolean(
    trim(selector.graph)
    || trim(selector.node)
    || trim(selector.class)
    || trim(selector.role)
    || trim(selector.llm_path_id),
  );
}

function selectorKind(selector = {}) {
  if (selector.llm_path_id) return "llm_path_id";
  if (selector.node) return "node";
  if (selector.class && selector.role) return "class+role";
  if (selector.class) return "class";
  if (selector.role) return "role";
  if (selector.graph) return "graph";
  return "factory";
}

function loadRouteInventory({ factoryRoot = "" } = {}) {
  const inventoryPath = join(factoryRoot, "inventory", "llm-role-session-baseline.json");
  if (!existsSync(inventoryPath)) {
    return {
      inventory_path: "",
      nodes: [],
    };
  }

  const parsed = readJsonFileOrThrow(inventoryPath, "LLM route inventory");
  const routes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  const nodes = routes
    .map((entry) => ({
      graph_path: trim(entry?.graph_path),
      node_id: trim(entry?.node_id),
      llm_path_id: trim(entry?.llm_path_id),
      class: trim(entry?.class),
      trust_role: trim(entry?.trust_role),
      handler_type: trim(entry?.handler_type),
    }))
    .filter((entry) => entry.graph_path && entry.node_id)
    .sort((left, right) => {
      return left.graph_path.localeCompare(right.graph_path, "en")
        || left.node_id.localeCompare(right.node_id, "en");
    });

  return {
    inventory_path: resolve(inventoryPath),
    nodes,
  };
}

async function collectRoutesFromGraph(graphPathAbs) {
  const hatch = await loadHatchGraphRuntime();
  const source = loadGraphSemanticsText(graphPathAbs);
  const parsed = hatch.parseWithAst(source);
  hatch.applyGraphStylesheetImports({
    graph: parsed.graph,
    graphFile: graphPathAbs,
    stylesheetImports: parsed.stylesheetImports,
    repoRootPath: REPO_ROOT,
  });

  return Object.values(parsed.graph.nodes)
    .map((node) => ({
      graph_path: toRepoRelativePath(graphPathAbs),
      node_id: trim(node?.id),
      llm_path_id: trim(node?.attrs?.llm_path_id),
      class: trim(node?.attrs?.class),
      trust_role: trim(node?.attrs?.trust_role),
      handler_type: trim(node?.attrs?.type),
    }))
    .filter((entry) => entry.node_id);
}

function matchesRole(route = {}, role = "") {
  const target = trim(role);
  if (!target) return true;
  if (route.class === target) return true;
  if (route.trust_role === target) return true;
  return route.trust_role.endsWith(`.${target}`);
}

function matchesClass(route = {}, className = "") {
  const target = trim(className);
  if (!target) return true;
  return route.class === target;
}

function winnerSourceFromLayer(layer = "") {
  if (layer === "node_override") return "node_attribute";
  if (layer === "env_override") return "env_override";
  return "policy_pack_default";
}

function normalizeBenchmarkJustification(rawValue = null) {
  if (!rawValue || typeof rawValue !== "object") return null;
  const value = asObject(rawValue);
  if (!value) return null;
  return {
    query_ids: asStringArray(value.query_ids),
    evidence_date: trim(value.evidence_date),
    notes: trim(value.notes),
  };
}

function buildBenchmarkQueryLinks(benchmarkJustification, benchmarkDescriptions) {
  const queryIds = benchmarkJustification?.query_ids || [];
  return queryIds.map((queryId) => ({
    query_id: queryId,
    description: benchmarkDescriptions.get(queryId) || "",
  }));
}

function normalizeOverrides(overrides = []) {
  const rows = Array.isArray(overrides) ? overrides : [];
  return rows.map((entry) => ({
    layer: trim(entry?.layer),
    key: trim(entry?.key),
    value: trim(entry?.value),
    source_key: trim(entry?.sourceKey),
  }));
}

async function loadGraphNodeAttrs({ graphPathAbs = "", nodeId = "" } = {}) {
  const hatch = await loadHatchGraphRuntime();
  const source = loadGraphSemanticsText(graphPathAbs);
  const parsed = hatch.parseWithAst(source);
  hatch.applyGraphStylesheetImports({
    graph: parsed.graph,
    graphFile: graphPathAbs,
    stylesheetImports: parsed.stylesheetImports,
    repoRootPath: REPO_ROOT,
  });

  const node = parsed.graph?.nodes?.[nodeId];
  if (!node) {
    throw new Error(`Node not found: ${nodeId} in ${toRepoRelativePath(graphPathAbs)}`);
  }

  const attrs = {};
  for (const [key, value] of Object.entries(node.attrs || {})) {
    attrs[key] = value === undefined ? undefined : String(value);
  }

  return {
    attrs,
    class: trim(node?.attrs?.class),
    trust_role: trim(node?.attrs?.trust_role),
    handler_type: trim(node?.attrs?.type),
    reasoning: trim(node?.attrs?.reasoning_effort),
    llm_path_id: trim(node?.attrs?.llm_path_id),
  };
}

function resolveSelectedRoute({ routes = [], selector = {}, graphPathFilter = "" } = {}) {
  const sorted = [...routes].sort((left, right) => {
    return left.graph_path.localeCompare(right.graph_path, "en")
      || left.node_id.localeCompare(right.node_id, "en");
  });

  const byGraph = graphPathFilter
    ? sorted.filter((entry) => trim(entry.graph_path) === trim(graphPathFilter))
    : sorted;

  let candidates = byGraph;

  if (selector.llm_path_id) {
    candidates = byGraph.filter((entry) => trim(entry.llm_path_id) === selector.llm_path_id);
    if (candidates.length === 0) {
      throw new Error(`Unknown llm_path_id: ${selector.llm_path_id}`);
    }
  } else if (selector.node) {
    candidates = byGraph.filter((entry) => trim(entry.node_id) === selector.node);
    if (candidates.length === 0) {
      const graphNote = graphPathFilter ? ` in graph ${graphPathFilter}` : "";
      throw new Error(`Unknown node: ${selector.node}${graphNote}`);
    }
  } else {
    if (selector.class) {
      candidates = candidates.filter((entry) => matchesClass(entry, selector.class));
    }
    if (selector.role) {
      candidates = candidates.filter((entry) => matchesRole(entry, selector.role));
    }
    if ((selector.class || selector.role) && candidates.length === 0) {
      const filters = [
        selector.class ? `class=${selector.class}` : "",
        selector.role ? `role=${selector.role}` : "",
      ].filter(Boolean).join(",");
      const graphNote = graphPathFilter ? ` graph=${graphPathFilter}` : "";
      throw new Error(`No node matched selector (${filters})${graphNote}`);
    }
  }

  if (candidates.length === 0) {
    throw new Error("No selectable LLM nodes found for selector");
  }

  return {
    selected: candidates[0],
    matched_count: candidates.length,
  };
}

function extractPolicySummary({ loadedConfig, policyPath, policyDoc, benchmarkDescriptions }) {
  const config = asObject(loadedConfig?.config) || {};
  const policyFactory = asObject(policyDoc?.factory) || {};
  const benchmarkJustification = normalizeBenchmarkJustification(policyFactory.benchmark_justification);
  const benchmarkQueryLinks = buildBenchmarkQueryLinks(benchmarkJustification, benchmarkDescriptions);

  return {
    factory_id: trim(config.factory_id),
    policy_version: trim(config?.policyPack?.version),
    policy_source: resolve(policyPath),
    preferred_model: trim(policyFactory.preferred_model),
    allowed_models: asStringArray(policyFactory.allowed_models),
    provider_order: asStringArray(policyFactory.provider_order),
    safe_fallback_model: trim(policyFactory.safe_fallback_model) || null,
    benchmark_justification: benchmarkJustification,
    benchmark_query_links: benchmarkQueryLinks,
  };
}

function loadSingleFactoryPolicy({ factoryRoot = "", factoryId = "", factoryConfigPath = "", benchmarkDescriptions }) {
  const resolvedInputs = resolveFactoryConfigInputs({ factoryRoot, factoryId, factoryConfigPath });
  const loaded = loadFactoryConfig({
    factoryRoot: resolvedInputs.factoryRoot,
    configPath: resolvedInputs.factoryConfigPath,
    requiredKeys: [],
  });

  const policyVersion = trim(loaded?.config?.policyPack?.version);
  if (!policyVersion) {
    throw new Error("factory config is missing policyPack section or version");
  }

  const policyPackDir = join(loaded.factoryRoot, "policy-pack", policyVersion);
  const policyPath = join(policyPackDir, "model-policy.json");
  const policyDoc = readJsonFileOrThrow(policyPath, "model-policy");

  return {
    loaded,
    policyDoc,
    summary: extractPolicySummary({
      loadedConfig: loaded,
      policyPath,
      policyDoc,
      benchmarkDescriptions,
    }),
  };
}

function valuesEqual(field, left, right) {
  if (field === "allowed_models" || field === "provider_order") {
    const leftValue = asStringArray(left).sort((a, b) => a.localeCompare(b, "en")).join("\u0000");
    const rightValue = asStringArray(right).sort((a, b) => a.localeCompare(b, "en")).join("\u0000");
    return leftValue === rightValue;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildComparison(factoryA, factoryB) {
  const differingFields = [];
  const fieldSpecs = [
    { field: "preferred_model", valueA: factoryA.preferred_model, valueB: factoryB.preferred_model },
    { field: "allowed_models", valueA: factoryA.allowed_models, valueB: factoryB.allowed_models },
    { field: "provider_order", valueA: factoryA.provider_order, valueB: factoryB.provider_order },
    { field: "safe_fallback_model", valueA: factoryA.safe_fallback_model, valueB: factoryB.safe_fallback_model },
    {
      field: "benchmark_justification.evidence_date",
      valueA: trim(factoryA?.benchmark_justification?.evidence_date),
      valueB: trim(factoryB?.benchmark_justification?.evidence_date),
    },
  ];

  for (const spec of fieldSpecs) {
    if (valuesEqual(spec.field, spec.valueA, spec.valueB)) continue;
    differingFields.push({
      field: spec.field,
      factory_a_value: spec.valueA,
      factory_b_value: spec.valueB,
    });
  }

  return {
    factory_a: trim(factoryA.factory_id),
    factory_b: trim(factoryB.factory_id),
    differing_fields: differingFields,
  };
}

function enrichWithResolvedRouting(summary, resolved, { selector = {}, selection = {} } = {}) {
  const benchmarkJustification = normalizeBenchmarkJustification(resolved?.benchmarkJustification)
    || summary.benchmark_justification
    || null;

  return {
    ...summary,
    selected_via: trim(resolved?.selectedVia),
    winner_source: winnerSourceFromLayer(trim(resolved?.winningLayer || resolved?.selectedVia)),
    effective_provider: trim(resolved?.effectiveProvider || ""),
    effective_model: trim(resolved?.effectiveModel || ""),
    effective_reasoning: selection.reasoning || null,
    policy_config_path: trim(resolved?.policySource?.configPath),
    policy_pack_dir: trim(resolved?.policySource?.policyPackDir),
    policy_source: trim(summary.policy_source || join(trim(resolved?.policySource?.policyPackDir), "model-policy.json")),
    overrides: normalizeOverrides(resolved?.appliedOverrides),
    llm_path_id: selection.llm_path_id || null,
    graph_path: selection.graph_path || null,
    node_id: selection.node_id || null,
    class: selection.class || null,
    role: selection.role || null,
    handler_type: selection.handler_type || null,
    selector: {
      kind: selectorKind(selector),
      graph: selector.graph || null,
      node: selector.node || null,
      class: selector.class || null,
      role: selector.role || null,
      llm_path_id: selector.llm_path_id || null,
      matched_nodes: selection.matched_count ?? 0,
    },
    benchmark_justification: benchmarkJustification,
  };
}

export async function resolveNodeRoutingPolicy({
  factoryRoot = "",
  factoryId = "",
  factoryConfigPath = "",
  graphFile = "",
  nodeId = "",
  nodeRole = "",
  env = process.env,
} = {}) {
  const normalizedGraph = trim(graphFile);
  const normalizedNodeId = trim(nodeId);
  if (!normalizedGraph) {
    throw new Error("--graph-file is required when --show-node-policy is set");
  }
  if (!normalizedNodeId) {
    throw new Error("--node-id is required when --show-node-policy is set");
  }

  const benchmarkDescriptions = loadBenchmarkQueryDescriptions();
  const primary = loadSingleFactoryPolicy({
    factoryRoot,
    factoryId,
    factoryConfigPath,
    benchmarkDescriptions,
  });

  const graphPathAbs = resolveGraphPath(normalizedGraph, {
    factoryRoot: primary.loaded.factoryRoot,
    repoRoot: REPO_ROOT,
  });
  const graphPathRel = toRepoRelativePath(graphPathAbs);

  const routingModule = await loadNodeRoutingPolicyModule();
  const nodeSummary = routingModule.resolveRoutingPolicyForNode({
    graphFile: graphPathAbs,
    nodeId: normalizedNodeId,
    env,
  });
  const formattedNodePolicy = routingModule.formatRoutingPolicySummary(nodeSummary);

  const resolvedRouting = {
    selectedVia: formattedNodePolicy?.resolved?.selected_via,
    winningLayer: formattedNodePolicy?.resolved?.winning_layer,
    effectiveProvider: formattedNodePolicy?.resolved?.effective_provider,
    effectiveModel: formattedNodePolicy?.resolved?.effective_model,
    appliedOverrides: (formattedNodePolicy?.resolved?.applied_overrides || []).map((entry) => ({
      layer: trim(entry?.layer),
      key: trim(entry?.key),
      value: trim(entry?.value),
      sourceKey: trim(entry?.source_key),
    })),
    benchmarkJustification: primary.summary.benchmark_justification,
    policySource: {
      configPath: formattedNodePolicy?.policy?.source?.config_path || "",
      policyPackDir: formattedNodePolicy?.policy?.source?.policy_pack_dir || "",
      policyVersion: formattedNodePolicy?.policy?.source?.policy_version || "",
    },
  };

  const output = enrichWithResolvedRouting(primary.summary, resolvedRouting, {
    selector: {
      graph: normalizedGraph,
      node: normalizedNodeId,
      class: "",
      role: "",
      llm_path_id: "",
    },
    selection: {
      graph_path: graphPathRel,
      node_id: normalizedNodeId,
      llm_path_id: trim(formattedNodePolicy?.node?.llm_path_id),
      class: trim(formattedNodePolicy?.node?.class),
      role: trim(formattedNodePolicy?.node?.trust_role),
      handler_type: trim(formattedNodePolicy?.node?.handler_type),
      reasoning: trim(formattedNodePolicy?.node?.overrides?.reasoning)
        || trim(formattedNodePolicy?.node?.reasoning_effort),
      matched_count: 1,
    },
  });

  output.selector.kind = "node";
  output.selector.graph = graphPathRel;
  output.selector.node = normalizedNodeId;

  return {
    ...output,
    show_node_policy: true,
    node_policy: formattedNodePolicy,
    attempt_chain: Array.isArray(formattedNodePolicy?.attempts)
      ? formattedNodePolicy.attempts.map((attempt) => ({
        ...attempt,
        precedence_comment: trim(attempt?.reason || attempt?.skip_reason),
      }))
      : [],
    benchmark_query_links: buildBenchmarkQueryLinks(
      normalizeBenchmarkJustification(primary.summary.benchmark_justification),
      benchmarkDescriptions,
    ),
  };
}


/**
 * Selector precedence (highest to lowest):
 * llm_path_id -> node -> class/role filters -> graph -> factory default.
 *
 * For role/class selectors that match multiple nodes, selection is deterministic:
 * graph_path ASC, then node_id ASC.
 */
async function resolveSelectorPolicyOutput({
  loaded,
  summary,
  selector,
  benchmarkDescriptions,
}) {
  const runtime = await loadRuntimeModelPolicyModule();
  const defaultGraphAbs = resolveDefaultPipelineGraphPath(loaded);
  const selectedGraphAbs = selector.graph
    ? resolveGraphPath(selector.graph, { factoryRoot: loaded.factoryRoot, repoRoot: REPO_ROOT })
    : defaultGraphAbs;
  const selectedGraphRel = toRepoRelativePath(selectedGraphAbs);

  const hasNodeSelector = Boolean(selector.llm_path_id || selector.node || selector.class || selector.role);
  if (!hasNodeSelector) {
    const resolved = runtime.resolveModelPolicyForNode({
      pipelineFile: selectedGraphAbs,
      handlerType: "factory.model-policy",
      nodeId: "",
      llm_path_id: "",
      nodeAttrs: {},
      env: process.env,
    });

    if (!resolved) {
      throw new Error(`Unable to resolve model policy for graph ${selectedGraphRel}`);
    }

    return {
      ...enrichWithResolvedRouting(summary, resolved, {
        selector,
        selection: {
          graph_path: selectedGraphRel,
          matched_count: 0,
        },
      }),
      benchmark_query_links: buildBenchmarkQueryLinks(
        normalizeBenchmarkJustification(resolved?.benchmarkJustification) || summary.benchmark_justification,
        benchmarkDescriptions,
      ),
    };
  }

  const inventory = loadRouteInventory({ factoryRoot: loaded.factoryRoot });
  let routes = inventory.nodes;
  if (routes.length === 0 && selector.graph) {
    routes = await collectRoutesFromGraph(selectedGraphAbs);
  }
  if (routes.length === 0) {
    throw new Error("No route inventory found for selector-based model-policy lookup");
  }

  const selection = resolveSelectedRoute({
    routes,
    selector,
    graphPathFilter: selector.graph ? selectedGraphRel : "",
  });

  const selectedRoute = selection.selected;
  const routeGraphAbs = resolveGraphPath(selectedRoute.graph_path, {
    factoryRoot: loaded.factoryRoot,
    repoRoot: REPO_ROOT,
  });

  const graphNode = await loadGraphNodeAttrs({
    graphPathAbs: routeGraphAbs,
    nodeId: selectedRoute.node_id,
  });

  const resolved = runtime.resolveModelPolicyForNode({
    pipelineFile: routeGraphAbs,
    handlerType: graphNode.handler_type || selectedRoute.handler_type || "",
    nodeId: selectedRoute.node_id,
    llm_path_id: graphNode.llm_path_id || selectedRoute.llm_path_id || "",
    nodeAttrs: graphNode.attrs,
    env: process.env,
  });

  if (!resolved) {
    throw new Error(`Unable to resolve node policy for ${selectedRoute.graph_path}#${selectedRoute.node_id}`);
  }

  const enriched = enrichWithResolvedRouting(summary, resolved, {
    selector,
    selection: {
      graph_path: selectedRoute.graph_path,
      node_id: selectedRoute.node_id,
      llm_path_id: graphNode.llm_path_id || selectedRoute.llm_path_id || null,
      class: graphNode.class || selectedRoute.class || null,
      role: graphNode.trust_role || selectedRoute.trust_role || null,
      handler_type: graphNode.handler_type || selectedRoute.handler_type || null,
      reasoning: graphNode.reasoning || null,
      matched_count: selection.matched_count,
    },
  });

  return {
    ...enriched,
    benchmark_query_links: buildBenchmarkQueryLinks(
      normalizeBenchmarkJustification(resolved?.benchmarkJustification) || summary.benchmark_justification,
      benchmarkDescriptions,
    ),
    inventory_path: inventory.inventory_path || null,
  };
}

export async function resolveModelPolicyOutput({
  factoryRoot = "",
  factoryId = "",
  factoryConfigPath = "",
  compareFactoryRoot = "",
  graph = "",
  node = "",
  className = "",
  role = "",
  llmPathId = "",
} = {}) {
  const selector = normalizeSelector({
    graph,
    node,
    className,
    role,
    llmPathId,
  });

  const benchmarkDescriptions = loadBenchmarkQueryDescriptions();
  const primary = loadSingleFactoryPolicy({
    factoryRoot,
    factoryId,
    factoryConfigPath,
    benchmarkDescriptions,
  });

  const compareRoot = trim(compareFactoryRoot);
  if (hasSelector(selector)) {
    if (compareRoot) {
      throw new Error("--compare-factory-root cannot be combined with selector flags");
    }

    return resolveSelectorPolicyOutput({
      loaded: primary.loaded,
      summary: primary.summary,
      selector,
      benchmarkDescriptions,
    });
  }

  const defaultRouting = await resolveSelectorPolicyOutput({
    loaded: primary.loaded,
    summary: primary.summary,
    selector,
    benchmarkDescriptions,
  });

  if (!compareRoot) return defaultRouting;

  const secondary = loadSingleFactoryPolicy({
    factoryRoot: compareRoot,
    benchmarkDescriptions,
  });

  return {
    ...defaultRouting,
    comparison: buildComparison(primary.summary, secondary.summary),
  };
}
