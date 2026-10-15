import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveModelPolicyOutput } from "../../src/commands/factory-model-policy.ts";

import { loadGraphSemanticsText } from "@hatch/factory-core/graph-source-loader";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");
const mothershipFactoryRoot = "factories/mothership";
const mothershipInventoryPath = join(repoRoot, mothershipFactoryRoot, "inventory/llm-role-session-baseline.json");

function runCli(args) {
  return spawnSync("node", [opsCliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function readMothershipRoutes() {
  const parsed = JSON.parse(readFileSync(mothershipInventoryPath, "utf8"));
  return Array.isArray(parsed?.nodes) ? parsed.nodes : [];
}

const mothershipRoutes = readMothershipRoutes();

function selectRoute(description, predicate) {
  const route = mothershipRoutes.find(predicate);
  assert.ok(route, `expected inventory route for ${description}`);
  return route;
}

function parseJsonFromCli(run) {
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout || "{}");
}

function expectedWinnerSourceFromLayer(layer = "") {
  if (layer === "node_override") return "node_attribute";
  if (layer === "env_override") return "env_override";
  return "policy_pack_default";
}

async function loadRuntimeModelPolicyResolver() {
  const runtimeModulePath = join(repoRoot, "apps/hatch/dist/factory/model-policy.js");
  return import(pathToFileURL(runtimeModulePath).href);
}

async function loadNodePolicyContext(route) {
  const hatch = await import("hatch");
  const graphAbsPath = join(repoRoot, route.graph_path);
  const source = loadGraphSemanticsText(graphAbsPath);
  const parsed = hatch.parseWithAst(source);
  hatch.applyGraphStylesheetImports({
    graph: parsed.graph,
    graphFile: graphAbsPath,
    stylesheetImports: parsed.stylesheetImports,
    repoRootPath: repoRoot,
  });

  const node = parsed.graph?.nodes?.[route.node_id];
  assert.ok(node, `expected node ${route.node_id} in ${route.graph_path}`);

  const nodeAttrs = {};
  for (const [key, value] of Object.entries(node.attrs || {})) {
    nodeAttrs[key] = value === undefined ? undefined : String(value);
  }

  return {
    pipelineFile: graphAbsPath,
    handlerType: String(node.attrs?.type || ""),
    nodeId: route.node_id,
    llm_path_id: String(node.attrs?.llm_path_id || ""),
    nodeAttrs,
  };
}

test("resolveModelPolicyOutput returns benchmark query links for mothership policy", async () => {
  const result = await resolveModelPolicyOutput({
    factoryRoot: mothershipFactoryRoot,
  });

  assert.equal(result.factory_id, "mothership");
  assert.equal(result.policy_version, "v1");
  assert.ok(Array.isArray(result.benchmark_query_links));
  assert.ok(result.benchmark_query_links.length >= 1);
  assert.ok(result.benchmark_query_links.every((entry) => typeof entry.description === "string"));
});

test("factory model-policy CLI returns JSON summary for mothership", () => {
  const run = runCli([
    "factory",
    "model-policy",
    "--factory-root",
    mothershipFactoryRoot,
    "--json",
  ]);

  const parsed = parseJsonFromCli(run);
  assert.equal(parsed.factory_id, "mothership");
  assert.equal(parsed.policy_version, "v1");
  assert.equal(typeof parsed.preferred_model, "string");
  assert.ok(parsed.preferred_model.length > 0);
  assert.ok(Array.isArray(parsed.allowed_models));
  assert.ok(Array.isArray(parsed.provider_order));
  assert.ok(Array.isArray(parsed.benchmark_query_links));
});

test("factory model-policy CLI selector JSON exposes provenance for class selector", () => {
  const route = selectRoute("class=supervisor", (entry) => entry.class === "supervisor");
  const run = runCli([
    "factory",
    "model-policy",
    "--factory-root",
    mothershipFactoryRoot,
    "--class",
    route.class,
    "--json",
  ]);

  const parsed = parseJsonFromCli(run);
  assert.equal(parsed.selector?.kind, "class");
  assert.equal(parsed.class, route.class);
  assert.equal(typeof parsed.effective_provider, "string");
  assert.ok(parsed.effective_provider.length > 0);
  assert.equal(typeof parsed.effective_model, "string");
  assert.ok(parsed.effective_model.length > 0);
  assert.equal(typeof parsed.selected_via, "string");
  assert.equal(parsed.winner_source, expectedWinnerSourceFromLayer(parsed.selected_via));
  assert.ok(Array.isArray(parsed.overrides));
  assert.ok(parsed.overrides.length >= 2);
});

test("factory model-policy CLI selector JSON supports node and llm_path_id selectors", () => {
  const route = selectRoute("node=supervisor_review", (entry) => entry.node_id === "supervisor_review");

  const nodeRun = runCli([
    "factory",
    "model-policy",
    "--factory-root",
    mothershipFactoryRoot,
    "--graph",
    route.graph_path,
    "--node",
    route.node_id,
    "--json",
  ]);
  const nodeJson = parseJsonFromCli(nodeRun);
  assert.equal(nodeJson.selector?.kind, "node");
  assert.equal(nodeJson.graph_path, route.graph_path);
  assert.equal(nodeJson.node_id, route.node_id);
  assert.equal(nodeJson.llm_path_id, route.llm_path_id);
  assert.equal(nodeJson.winner_source, expectedWinnerSourceFromLayer(nodeJson.selected_via));

  const llmPathRun = runCli([
    "factory",
    "model-policy",
    "--factory-root",
    mothershipFactoryRoot,
    "--llm-path-id",
    route.llm_path_id,
    "--json",
  ]);
  const llmPathJson = parseJsonFromCli(llmPathRun);
  assert.equal(llmPathJson.selector?.kind, "llm_path_id");
  assert.equal(llmPathJson.llm_path_id, route.llm_path_id);
  assert.equal(llmPathJson.node_id, route.node_id);
  assert.equal(llmPathJson.winner_source, expectedWinnerSourceFromLayer(llmPathJson.selected_via));
});

test("factory model-policy CLI --show-node-policy JSON exposes attempt chain and node policy summary", () => {
  const route = selectRoute("node policy selector route", (entry) => entry.node_id === "supervisor_review");
  const run = runCli([
    "factory",
    "model-policy",
    "--factory-root",
    mothershipFactoryRoot,
    "--show-node-policy",
    "--graph-file",
    route.graph_path,
    "--node-id",
    route.node_id,
    "--json",
  ]);

  const parsed = parseJsonFromCli(run);
  assert.equal(parsed.selector?.kind, "node");
  assert.equal(parsed.graph_path, route.graph_path);
  assert.equal(parsed.node_id, route.node_id);
  assert.equal(parsed.show_node_policy, true);
  assert.equal(typeof parsed.node_policy, "object");
  assert.equal(parsed.node_policy.graph_file, join(repoRoot, route.graph_path));
  assert.equal(parsed.node_policy.node_id, route.node_id);
  assert.ok(Array.isArray(parsed.attempt_chain));
  assert.ok(parsed.attempt_chain.length >= 1);
  assert.ok(parsed.attempt_chain.some((entry) => entry.is_winner === true));
  assert.ok(parsed.attempt_chain.every((entry) => typeof entry.precedence_comment === "string"));
});


test("factory model-policy CLI selector flags work in text mode with provenance sections", () => {
  const supervisorRoute = selectRoute("graph/node selector route", (entry) => entry.node_id === "supervisor_review");
  const roleRoute = selectRoute("role=codergen", (entry) => String(entry.trust_role || "").endsWith(".codergen"));

  const selectorArgsList = [
    ["--graph", supervisorRoute.graph_path],
    ["--graph", supervisorRoute.graph_path, "--node", supervisorRoute.node_id],
    ["--class", supervisorRoute.class],
    ["--role", "codergen"],
    ["--llm-path-id", supervisorRoute.llm_path_id],
  ];

  for (const selectorArgs of selectorArgsList) {
    const run = runCli([
      "factory",
      "model-policy",
      "--factory-root",
      mothershipFactoryRoot,
      ...selectorArgs,
    ]);

    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stdout, /Winner Source:/);
    assert.match(run.stdout, /Overrides:/);
  }

  const roleRun = runCli([
    "factory",
    "model-policy",
    "--factory-root",
    mothershipFactoryRoot,
    "--role",
    roleRoute.trust_role,
  ]);
  assert.equal(roleRun.status, 0, roleRun.stderr || roleRun.stdout);
  assert.match(roleRun.stdout, /Selector Kind:\s+role/);
  assert.match(roleRun.stdout, /Winner Source:/);
});

test("factory model-policy CLI --show-node-policy text output includes node policy and attempt chain", () => {
  const route = selectRoute("node policy text route", (entry) => entry.node_id === "supervisor_review");
  const run = runCli([
    "factory",
    "model-policy",
    "--factory-root",
    mothershipFactoryRoot,
    "--show-node-policy",
    "--graph-file",
    route.graph_path,
    "--node-id",
    route.node_id,
  ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /Node Policy:/);
  assert.match(run.stdout, /Attempt Chain:/);
  assert.match(run.stdout, /\* \[\d+\].*phase=primary/);
});


test("factory model-policy CLI JSON matches runtime node resolver output", async () => {
  const route = selectRoute("runtime parity node", (entry) => entry.node_id === "supervisor_review");
  const runtime = await loadRuntimeModelPolicyResolver();
  const context = await loadNodePolicyContext(route);

  const runtimeResolved = runtime.resolveModelPolicyForNode({
    ...context,
    env: process.env,
  });
  assert.ok(runtimeResolved, "expected runtime resolver result");

  const run = runCli([
    "factory",
    "model-policy",
    "--factory-root",
    mothershipFactoryRoot,
    "--graph",
    route.graph_path,
    "--node",
    route.node_id,
    "--json",
  ]);

  const parsed = parseJsonFromCli(run);
  assert.equal(parsed.effective_provider, runtimeResolved.effectiveProvider);
  assert.equal(parsed.effective_model, runtimeResolved.effectiveModel);
  assert.equal(parsed.selected_via, runtimeResolved.selectedVia);
  assert.equal(parsed.winner_source, expectedWinnerSourceFromLayer(runtimeResolved.winningLayer));

  const expectedOverrides = runtimeResolved.appliedOverrides.map((override) => ({
    layer: override.layer,
    key: override.key,
    value: override.value,
    source_key: override.sourceKey,
  }));
  assert.deepEqual(parsed.overrides, expectedOverrides);
});

test("factory model-policy CLI prints human-readable output", () => {
  const run = runCli([
    "factory",
    "model-policy",
    "--factory-root",
    mothershipFactoryRoot,
  ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /Policy Version:/);
  assert.match(run.stdout, /Preferred Model:/);
  assert.match(run.stdout, /Allowed Models:/);
  assert.match(run.stdout, /Benchmark Justification:/);
});

test("factory model-policy CLI returns comparison output", () => {
  const run = runCli([
    "factory",
    "model-policy",
    "--factory-root",
    mothershipFactoryRoot,
    "--compare-factory-root",
    "examples/external-factories/acme-support",
    "--json",
  ]);

  const parsed = parseJsonFromCli(run);
  assert.equal(typeof parsed.comparison, "object");
  assert.equal(parsed.comparison.factory_a, "mothership");
  assert.equal(parsed.comparison.factory_b, "acme-support");
  assert.ok(Array.isArray(parsed.comparison.differing_fields));
  assert.ok(parsed.comparison.differing_fields.some((entry) => entry.field === "allowed_models"));
});

test("factory model-policy CLI fails for missing factory root", () => {
  const run = runCli([
    "factory",
    "model-policy",
    "--factory-root",
    "/definitely/missing/factory-root",
  ]);

  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Unable to read factory config at/);
});

test("factory model-policy CLI fails when policyPack is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-model-policy-missing-policy-pack-"));
  const configPath = join(root, "factory.config.json");
  mkdirSync(root, { recursive: true });
  writeFileSync(configPath, JSON.stringify({
    schema: "hatch.factory.config.v1",
    factory_id: "test-factory",
    target_repo: "acme/test-factory",
    control_plane_repo: "recallnet/astrochicken",
    tracking_issue: 1,
    model: "openai/gpt-5.3-codex",
    provider: "openrouter",
  }, null, 2));

  const run = runCli([
    "factory",
    "model-policy",
    "--factory-config-path",
    configPath,
  ]);

  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /factory config is missing policyPack section or version/);
});

test("factory model-policy CLI --show-node-policy fails closed without required node selector", () => {
  const runMissingGraph = runCli([
    "factory",
    "model-policy",
    "--factory-root",
    mothershipFactoryRoot,
    "--show-node-policy",
    "--node-id",
    "supervisor_review",
  ]);
  assert.notEqual(runMissingGraph.status, 0);
  assert.match(runMissingGraph.stderr, /--graph-file is required when --show-node-policy is set/);

  const runMissingNode = runCli([
    "factory",
    "model-policy",
    "--factory-root",
    mothershipFactoryRoot,
    "--show-node-policy",
    "--graph-file",
    "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot",
  ]);
  assert.notEqual(runMissingNode.status, 0);
  assert.match(runMissingNode.stderr, /--node-id is required when --show-node-policy is set/);
});
