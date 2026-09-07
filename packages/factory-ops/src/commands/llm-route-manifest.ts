import { resolve } from "node:path";

import { readJsonFile } from "../lib/io.ts";

export const DEFAULT_LLM_ROUTE_INVENTORY_PATH = "factories/mothership/inventory/llm-role-session-baseline.json";

function trim(value = "") {
  return String(value ?? "").trim();
}

function stableCompare(a = "", b = "") {
  return String(a).localeCompare(String(b));
}

function formatTable(rows = [], headers = []) {
  const widths = headers.map((header, index) => {
    const values = rows.map((row) => String(row[index] ?? ""));
    return Math.max(header.length, ...values.map((value) => value.length));
  });

  const renderRow = (values) => values
    .map((value, index) => String(value ?? "").padEnd(widths[index], " "))
    .join("  ")
    .trimEnd();

  return [renderRow(headers), renderRow(widths.map((width) => "-".repeat(width))), ...rows.map(renderRow)].join("\n");
}

export function resolveLlmRouteInventoryPath({ repoRoot = ".", inventoryPath = "" } = {}) {
  const resolvedRepoRoot = resolve(trim(repoRoot) || ".");
  const relativeInventoryPath = trim(inventoryPath) || DEFAULT_LLM_ROUTE_INVENTORY_PATH;
  return resolve(resolvedRepoRoot, relativeInventoryPath);
}

export function loadLlmRouteInventory({ repoRoot = ".", inventoryPath = "" } = {}) {
  const resolvedPath = resolveLlmRouteInventoryPath({ repoRoot, inventoryPath });
  const inventory = readJsonFile(resolvedPath, null);
  if (!inventory || typeof inventory !== "object") {
    throw new Error(`Unable to read LLM route inventory at ${resolvedPath}`);
  }
  if (!Array.isArray(inventory.nodes)) {
    throw new Error(`LLM route inventory at ${resolvedPath} is missing nodes[]`);
  }
  return { resolvedPath, inventory };
}

function normalizePromptMetadata(raw = {}) {
  return {
    benchmark_job_id: trim(raw?.benchmark_job_id),
    prompt_source: trim(raw?.prompt_source),
    system_prompt_source: trim(raw?.system_prompt_source),
    task_prompt_source: trim(raw?.task_prompt_source),
    prompt_input_keys: trim(raw?.prompt_input_keys),
    prompt_version: trim(raw?.prompt_version),
    role_version: trim(raw?.role_version),
    skill_id: trim(raw?.skill_id),
  };
}

function isSkillLikeDependency(dependency = {}) {
  const sourcePath = trim(dependency?.source_path).toLowerCase();
  const outputKey = trim(dependency?.output_key).toLowerCase();
  const loaderNodeId = trim(dependency?.loader_node_id).toLowerCase();
  const loaderPrompt = trim(dependency?.loader_prompt).toLowerCase();
  return sourcePath.includes("/skills/")
    || outputKey.includes("skill")
    || outputKey.includes("rules")
    || loaderNodeId.includes("skill")
    || loaderNodeId.includes("rules")
    || loaderPrompt.includes("/skills/");
}

function deriveResolvedPromptInputs(route = {}) {
  const dependencies = Array.isArray(route.payload_evidence?.prompt_dependencies)
    ? route.payload_evidence.prompt_dependencies
    : [];
  const systemSourceId = trim(route.prompt_family_metadata?.system_prompt_source);
  const taskSourceId = trim(route.prompt_family_metadata?.task_prompt_source);
  const systemPrompt = dependencies.find((dependency) => trim(dependency.output_key) === systemSourceId) || null;
  const taskPrompt = dependencies.find((dependency) => trim(dependency.output_key) === taskSourceId) || null;
  const supplemental = dependencies.filter((dependency) => dependency !== systemPrompt && dependency !== taskPrompt);

  return {
    system_prompt: {
      source_id: systemSourceId,
      dependency: systemPrompt,
    },
    task_prompt: {
      source_id: taskSourceId,
      dependency: taskPrompt,
    },
    skill_dependencies: supplemental.filter(isSkillLikeDependency),
    additional_dependencies: supplemental.filter((dependency) => !isSkillLikeDependency(dependency)),
  };
}

function normalizeRoute(entry = {}) {
  const route = {
    llm_path_id: trim(entry.llm_path_id),
    graph_path: trim(entry.graph_path),
    node_id: trim(entry.node_id),
    class: trim(entry.class),
    handler_type: trim(entry.handler_type),
    provider: trim(entry.provider),
    model: trim(entry.model),
    trust_role: trim(entry.trust_role),
    session_id_expression: trim(entry.session_id_expression),
    payload_contract_id: trim(entry.payload_contract_id),
    payload_fingerprint: trim(entry.payload_fingerprint),
    prompt_family_metadata: normalizePromptMetadata(entry.prompt_family_metadata || {}),
    payload_evidence: {
      prompt_template_hash: trim(entry.payload_evidence?.prompt_template_hash),
      prompt_dependencies: Array.isArray(entry.payload_evidence?.prompt_dependencies)
        ? entry.payload_evidence.prompt_dependencies.map((dependency) => Object.fromEntries(
          Object.entries(dependency || {}).map(([key, value]) => [key, trim(value)]),
        ))
        : [],
    },
  };
  return {
    ...route,
    resolved_prompt_inputs: deriveResolvedPromptInputs(route),
  };
}

export function buildLlmRouteManifest(inventory = {}, inventoryPath = "") {
  const routes = (Array.isArray(inventory?.nodes) ? inventory.nodes : [])
    .map(normalizeRoute)
    .sort((left, right) => stableCompare(left.llm_path_id, right.llm_path_id));

  return {
    schema_version: "llm_route_manifest/v1",
    inventory_schema_version: trim(inventory?.schema_version),
    inventory_path: trim(inventoryPath),
    route_count: routes.length,
    routes,
  };
}

export function inspectLlmRoute(manifest = {}, llmPathId = "") {
  const needle = trim(llmPathId);
  if (!needle) throw new Error("llm_path_id is required");
  const route = (Array.isArray(manifest?.routes) ? manifest.routes : []).find((entry) => entry.llm_path_id === needle);
  if (!route) throw new Error(`Unknown llm_path_id: ${needle}`);
  return route;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function projectDiffableRoute(route = {}) {
  return {
    graph_path: route.graph_path,
    node_id: route.node_id,
    class: route.class,
    handler_type: route.handler_type,
    provider: route.provider,
    model: route.model,
    trust_role: route.trust_role,
    session_id_expression: route.session_id_expression,
    payload_contract_id: route.payload_contract_id,
    payload_fingerprint: route.payload_fingerprint,
    prompt_family_metadata: route.prompt_family_metadata,
    payload_evidence: route.payload_evidence,
    resolved_prompt_inputs: route.resolved_prompt_inputs,
  };
}

export function diffLlmRouteManifests(currentManifest = {}, baselineManifest = {}, { llmPathId = "" } = {}) {
  const needle = trim(llmPathId);
  const currentRoutes = new Map((Array.isArray(currentManifest?.routes) ? currentManifest.routes : []).map((route) => [route.llm_path_id, route]));
  const baselineRoutes = new Map((Array.isArray(baselineManifest?.routes) ? baselineManifest.routes : []).map((route) => [route.llm_path_id, route]));
  const routeIds = [...new Set([...currentRoutes.keys(), ...baselineRoutes.keys()])]
    .filter((routeId) => !needle || routeId === needle)
    .sort(stableCompare);

  const changes = routeIds.flatMap((routeId) => {
    const current = currentRoutes.get(routeId) || null;
    const baseline = baselineRoutes.get(routeId) || null;
    if (!baseline && current) {
      return [{
        llm_path_id: routeId,
        status: "added",
        changed_fields: ["route"],
        current,
        baseline: null,
      }];
    }
    if (baseline && !current) {
      return [{
        llm_path_id: routeId,
        status: "removed",
        changed_fields: ["route"],
        current: null,
        baseline,
      }];
    }
    const currentProjected = projectDiffableRoute(current);
    const baselineProjected = projectDiffableRoute(baseline);
    const changedFields = Object.keys(currentProjected).filter((field) => stableStringify(currentProjected[field]) !== stableStringify(baselineProjected[field]));
    if (changedFields.length === 0) {
      return [];
    }
    return [{
      llm_path_id: routeId,
      status: "changed",
      changed_fields: changedFields,
      current,
      baseline,
    }];
  });

  return {
    schema_version: "llm_route_diff/v1",
    current_inventory_path: trim(currentManifest?.inventory_path),
    baseline_inventory_path: trim(baselineManifest?.inventory_path),
    route_count: changes.length,
    changes,
  };
}

export function renderLlmRouteList(manifest = {}) {
  const rows = (Array.isArray(manifest?.routes) ? manifest.routes : []).map((route) => [
    route.llm_path_id,
    route.class,
    route.node_id,
    route.payload_contract_id,
    route.prompt_family_metadata.skill_id,
    route.graph_path,
  ]);

  return formatTable(rows, ["PATH_ID", "CLASS", "NODE", "CONTRACT", "SKILL", "GRAPH"]);
}

function renderPromptInputDependency(label, entry = {}) {
  const dependency = entry?.dependency || null;
  return [
    `  ${label}_source_id: ${entry?.source_id || ""}`,
    `  ${label}_source_path: ${dependency?.source_path || ""}`,
    `  ${label}_source_hash: ${dependency?.source_hash || ""}`,
    `  ${label}_loader_node_id: ${dependency?.loader_node_id || ""}`,
    `  ${label}_loader_prompt: ${dependency?.loader_prompt || ""}`,
  ];
}

export function renderLlmRouteInspect(route = {}, inventoryPath = "") {
  const dependencyLines = (route.payload_evidence?.prompt_dependencies || []).flatMap((dependency) => [
    "  - dependency:",
    ...Object.entries(dependency).map(([key, value]) => `      ${key}: ${value}`),
  ]);
  const supplementalLines = [
    ...((route.resolved_prompt_inputs?.skill_dependencies || []).flatMap((dependency) => [
      "  - skill_dependency:",
      ...Object.entries(dependency).map(([key, value]) => `      ${key}: ${value}`),
    ])),
    ...((route.resolved_prompt_inputs?.additional_dependencies || []).flatMap((dependency) => [
      "  - additional_dependency:",
      ...Object.entries(dependency).map(([key, value]) => `      ${key}: ${value}`),
    ])),
  ];

  return [
    `llm_path_id: ${route.llm_path_id}`,
    `graph_path: ${route.graph_path}`,
    `node_id: ${route.node_id}`,
    `class: ${route.class}`,
    `handler_type: ${route.handler_type}`,
    `provider: ${route.provider}`,
    `model: ${route.model}`,
    `trust_role: ${route.trust_role}`,
    `session_id_expression: ${route.session_id_expression}`,
    `payload_contract_id: ${route.payload_contract_id}`,
    `payload_fingerprint: ${route.payload_fingerprint}`,
    `prompt_template_hash: ${route.payload_evidence?.prompt_template_hash || ""}`,
    `inventory_path: ${inventoryPath}`,
    "",
    "prompt_family_metadata:",
    `  benchmark_job_id: ${route.prompt_family_metadata?.benchmark_job_id || ""}`,
    `  prompt_source: ${route.prompt_family_metadata?.prompt_source || ""}`,
    `  system_prompt_source: ${route.prompt_family_metadata?.system_prompt_source || ""}`,
    `  task_prompt_source: ${route.prompt_family_metadata?.task_prompt_source || ""}`,
    `  prompt_input_keys: ${route.prompt_family_metadata?.prompt_input_keys || ""}`,
    `  prompt_version: ${route.prompt_family_metadata?.prompt_version || ""}`,
    `  role_version: ${route.prompt_family_metadata?.role_version || ""}`,
    `  skill_id: ${route.prompt_family_metadata?.skill_id || ""}`,
    "",
    "resolved_prompt_inputs:",
    ...renderPromptInputDependency("system_prompt", route.resolved_prompt_inputs?.system_prompt),
    ...renderPromptInputDependency("task_prompt", route.resolved_prompt_inputs?.task_prompt),
    "  supplemental_dependencies:",
    ...(supplementalLines.length > 0 ? supplementalLines : ["    - none"]),
    "",
    "prompt_dependencies:",
    ...(dependencyLines.length > 0 ? dependencyLines : ["  - none"]),
  ].join("\n");
}

export function renderLlmRouteDiff(diff = {}) {
  const rows = (Array.isArray(diff?.changes) ? diff.changes : []).map((change) => [
    change.llm_path_id,
    change.status,
    Array.isArray(change.changed_fields) ? change.changed_fields.join(",") : "",
  ]);
  if (rows.length === 0) {
    return "No route changes.";
  }
  return formatTable(rows, ["PATH_ID", "STATUS", "CHANGED_FIELDS"]);
}
