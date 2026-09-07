import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export const REACTOR_DISPATCH_REPORT_JSON_PATH = path.join(REPO_ROOT, "docs/contracts/reactor-dispatch-contract.json");
export const REACTOR_DISPATCH_REPORT_MARKDOWN_PATH = path.join(REPO_ROOT, "docs/contracts/reactor-dispatch-contract.md");

const GOVERNED_FACTORY_CONFIG = "factories/mothership/factory.config.json";
const FACTORY_REGISTRY_PATH = "factory-registry.json";
const ACTIVE_SURFACE_MANIFEST_PATH = "docs/contracts/active-surface-manifest.json";
const LEGACY_DISPATCH_GRAPH_PATH = "factories/mothership/workflows/wave-execution/wave_dispatch.workflow-source.mjs";
const FORBIDDEN_SUPERVISOR_PATTERNS = Object.freeze([
  /software\.list_executable_goals/,
  /spawn_goal_execute/,
  /goal_execute_gate/,
  /factory\.stamp_contract_hash/,
  /goal\.sweep_completed/,
  /wave\.release_quarantine/,
  /goal\.auto_ready_artifacts/,
  /goal\.sanitize_duplicates/,
]);
const REQUIRED_DISPATCH_PATTERNS = Object.freeze([
  /goal\.auto_ready_artifacts/,
  /goal\.sanitize_duplicates/,
  /goal\.sweep_completed/,
  /wave\.release_quarantine/,
  /dispatch_retry_backoff_seconds/,
  /software\.list_executable_goals/,
  /spawn_goal_execute/,
  /goal_execute_gate/,
  /type="fan_out\.detached"/,
]);
const FORBIDDEN_DISPATCH_PATTERNS = Object.freeze([
  /release_manifest/,
  /emit_disposition_feedback/,
  /snapshot_state/,
  /supervisor_review/,
]);

function trim(value = "") {
  return String(value || "").trim();
}

function readJson(relativePath = "") {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));
}

function readText(relativePath = "") {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

export function listTrackedFilesFromGit() {
  return execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split(/\r?\n/g)
    .map((entry) => trim(entry))
    .filter(Boolean);
}

function renderReport({ configPath, dispatchGraph, supervisorGraph, diagnostics }) {
  const ok = diagnostics.length === 0;
  const report = {
    schema_version: "reactor_dispatch_contract/v1",
    generated_at: new Date().toISOString(),
    ok,
    governed_factory: "mothership",
    config_path: configPath,
    dispatch_graph: dispatchGraph,
    supervisor_graph: supervisorGraph,
    diagnostics,
  };
  const markdown = [
    "---",
    'doc_type: "reference"',
    'owner: "platform-architecture"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-21"',
    'status: "active"',
    'summary: "Governed audit for Phase 7.3 narrow reactor-owned dispatch boundaries and supervisor demotion."',
    'tags: [contracts, dispatch, generated, graphs, maintenance, reactor]',
    'written: "2026-03-21"',
    "---",
    "",
    "# Reactor Dispatch Contract",
    "",
    `- governed factory: \`mothership\``,
    `- config: \`${configPath}\``,
    `- dispatch graph: \`${dispatchGraph || "missing"}\``,
    `- supervisor graph: \`${supervisorGraph || "missing"}\``,
    `- result: \`${ok ? "ok" : "fail"}\``,
    "",
    "## Diagnostics",
    "",
    ...(diagnostics.length > 0 ? diagnostics.map((entry) => `- ${entry}`) : ["- none"]),
    "",
  ].join("\n");
  return {
    ok,
    report,
    rendered_json: `${JSON.stringify(report, null, 2)}\n`,
    rendered_markdown: markdown,
  };
}

export function analyzeReactorDispatchContract({ files = [] } = {}) {
  const tracked = new Set(files);
  const diagnostics = [];
  const shouldCheck = tracked.size === 0 || tracked.has(GOVERNED_FACTORY_CONFIG) || Array.from(tracked).some((entry) => entry.startsWith("factories/mothership/graphs/"));
  if (!shouldCheck) {
    return {
      ...renderReport({
        configPath: GOVERNED_FACTORY_CONFIG,
        dispatchGraph: "",
        supervisorGraph: "",
        diagnostics: [],
      }),
      skipped: true,
    };
  }

  const config = readJson(GOVERNED_FACTORY_CONFIG);
  const registry = readJson(FACTORY_REGISTRY_PATH);
  const activeSurfaceManifest = readJson(ACTIVE_SURFACE_MANIFEST_PATH);
  const configPath = GOVERNED_FACTORY_CONFIG;
  const dispatchGraph = trim(config?.dispatch?.graph || "");
  const supervisorGraph = trim(config?.pipeline?.supervisor_tick || "");

  if (!dispatchGraph) diagnostics.push("dispatch_graph_missing path=factories/mothership/factory.config.json");
  if (!supervisorGraph) diagnostics.push("supervisor_graph_missing path=factories/mothership/factory.config.json");
  if (dispatchGraph && supervisorGraph && dispatchGraph === supervisorGraph) {
    diagnostics.push(`dispatch_graph_must_not_equal_supervisor_tick path=${configPath} graph=${dispatchGraph}`);
  }

  const mothershipInstanceGraphs = Array.isArray(registry?.instances)
    ? registry.instances.find((entry) => trim(entry?.instance_id) === "mothership")?.graphs
    : [];
  if (Array.isArray(mothershipInstanceGraphs) && mothershipInstanceGraphs.some((entry) => trim(entry?.path) === LEGACY_DISPATCH_GRAPH_PATH)) {
    diagnostics.push(`factory_registry_contains_legacy_dispatch_graph path=${FACTORY_REGISTRY_PATH} graph=${LEGACY_DISPATCH_GRAPH_PATH}`);
  }

  const activeFactoryGraphs = Array.isArray(activeSurfaceManifest?.graph_families)
    ? activeSurfaceManifest.graph_families.find((entry) => trim(entry?.id) === "factory_graphs_active")?.include
    : [];
  if (Array.isArray(activeFactoryGraphs) && activeFactoryGraphs.includes(LEGACY_DISPATCH_GRAPH_PATH)) {
    diagnostics.push(`active_surface_manifest_contains_legacy_dispatch_graph path=${ACTIVE_SURFACE_MANIFEST_PATH} graph=${LEGACY_DISPATCH_GRAPH_PATH}`);
  }

  if (dispatchGraph) {
    const dispatchDot = readText(dispatchGraph);
    for (const pattern of REQUIRED_DISPATCH_PATTERNS) {
      if (!pattern.test(dispatchDot)) diagnostics.push(`dispatch_graph_missing_required_pattern path=${dispatchGraph} pattern=${pattern}`);
    }
    for (const pattern of FORBIDDEN_DISPATCH_PATTERNS) {
      if (pattern.test(dispatchDot)) diagnostics.push(`dispatch_graph_contains_non_hot_path_logic path=${dispatchGraph} pattern=${pattern}`);
    }
  }

  if (supervisorGraph) {
    const supervisorDot = readText(supervisorGraph);
    for (const pattern of FORBIDDEN_SUPERVISOR_PATTERNS) {
      if (pattern.test(supervisorDot)) diagnostics.push(`supervisor_graph_contains_dispatch_logic path=${supervisorGraph} pattern=${pattern}`);
    }
  }

  return renderReport({
    configPath,
    dispatchGraph,
    supervisorGraph,
    diagnostics,
  });
}
