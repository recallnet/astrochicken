import { spawnOpsCli } from "../helpers/ops-command-cli-fixture.ts";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DEFAULT_LLM_ROUTE_INVENTORY_PATH, buildLlmRouteManifest, diffLlmRouteManifests, inspectLlmRoute, loadLlmRouteInventory, renderLlmRouteDiff, renderLlmRouteInspect, renderLlmRouteList, resolveLlmRouteInventoryPath } from "../../src/commands/llm-route-manifest.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");

const inventoryPath = join(repoRoot, "factories/mothership/inventory/llm-role-session-baseline.json");
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
const opsCliEnv = {
  HOME: process.env.HOME,
  LANG: process.env.LANG || "en_US.UTF-8",
  PATH: process.env.PATH,
  PWD: repoRoot,
  TERM: process.env.TERM || "xterm",
  FACTORY_CONTEXT_REPO_PATH: repoRoot,
};

function runOpsCli(args) {
  return spawnOpsCli([
      ...args
    ], {
      env: opsCliEnv
    });
}

test("inventory path helpers resolve the canonical default inventory", () => {
  assert.equal(DEFAULT_LLM_ROUTE_INVENTORY_PATH, "factories/mothership/inventory/llm-role-session-baseline.json");
  assert.equal(resolveLlmRouteInventoryPath({ repoRoot }), inventoryPath);
  const loaded = loadLlmRouteInventory({ repoRoot });
  assert.equal(loaded.resolvedPath, inventoryPath);
  assert.equal(loaded.inventory.nodes.length, inventory.nodes.length);
});

test("manifest keeps payload evidence available for route inspection", () => {
  const manifest = buildLlmRouteManifest(inventory, inventoryPath);
  const route = inspectLlmRoute(manifest, "mothership.supervisor.review");
  assert.match(route.payload_evidence.prompt_template_hash, /^sha256:/);
  assert.ok(Array.isArray(route.payload_evidence.prompt_dependencies));
});

test("buildLlmRouteManifest sorts and projects route identity fields", () => {
  const manifest = buildLlmRouteManifest(inventory, inventoryPath);
  assert.equal(manifest.schema_version, "llm_route_manifest/v1");
  assert.equal(manifest.route_count, inventory.nodes.length);
  assert.deepEqual(
    manifest.routes.map((route) => route.llm_path_id),
    [...manifest.routes.map((route) => route.llm_path_id)].sort(),
  );
  assert.ok(manifest.routes.some((route) => route.llm_path_id === "capability.goal_intake_decompose.propose"));
  assert.ok(manifest.routes[0].payload_contract_id.length > 0);
});

test("inspectLlmRoute resolves a route and keeps prompt metadata available", () => {
  const manifest = buildLlmRouteManifest(inventory, inventoryPath);
  const route = inspectLlmRoute(manifest, "mothership.supervisor.review");
  assert.equal(route.node_id, "supervisor_review");
  assert.equal(route.prompt_family_metadata.task_prompt_source, "supervisor_review_task_prompt");
  assert.match(renderLlmRouteInspect(route, manifest.inventory_path), /payload_fingerprint:/);
  assert.equal(route.resolved_prompt_inputs.system_prompt.source_id, "supervisor_system_prompt");
  assert.match(route.resolved_prompt_inputs.system_prompt.dependency.source_path, /supervisor\/system\.md$/);
  assert.equal(route.resolved_prompt_inputs.task_prompt.source_id, "supervisor_review_task_prompt");
  assert.match(route.resolved_prompt_inputs.task_prompt.dependency.source_path, /supervisor\/review\.md$/);
  assert.match(renderLlmRouteInspect(route, manifest.inventory_path), /resolved_prompt_inputs:/);
  assert.match(renderLlmRouteInspect(route, manifest.inventory_path), /system_prompt_source_path:/);
});

test("renderLlmRouteList exposes stable route rows", () => {
  const manifest = buildLlmRouteManifest(inventory, inventoryPath);
  const output = renderLlmRouteList(manifest);
  assert.match(output, /PATH_ID/);
  assert.match(output, /mothership\.supervisor\.review/);
  assert.match(output, /factories\/mothership\/workflows\/dispatch-control\/factory_supervisor_tick\.workflow-source\.mjs/);
});

test("CLI lists LLM routes from the checked-in inventory", () => {
  const run = runOpsCli(["llm", "route", "list"]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /mothership\.supervisor\.review/);
  assert.match(run.stdout, /PATH_ID/);
});

test("CLI inspects a specific route in json form", () => {
  const run = runOpsCli(["llm", "route", "inspect", "--path-id", "mothership.supervisor.review", "--json"]);
  assert.equal(run.status, 0, run.stderr);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.llm_path_id, "mothership.supervisor.review");
  assert.equal(parsed.payload_contract_id, "supervisor.tick.review");
  assert.match(parsed.payload_evidence.prompt_template_hash, /^sha256:/);
  assert.equal(parsed.resolved_prompt_inputs.system_prompt.source_id, "supervisor_system_prompt");
});

test("CLI fails closed on unknown route ids", () => {
  const run = runOpsCli(["llm", "route", "inspect", "--path-id", "missing.route"]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Unknown llm_path_id/);
});

test("diffLlmRouteManifests reports changed payload routes", () => {
  const manifest = buildLlmRouteManifest(inventory, inventoryPath);
  const mutatedInventory = structuredClone(inventory);
  const changedRoute = mutatedInventory.nodes.find((entry) => entry.llm_path_id === "mothership.supervisor.review");
  changedRoute.payload_contract_id = "supervisor.tick.review.v2";
  changedRoute.payload_fingerprint = "sha256:changed";
  changedRoute.payload_evidence.prompt_template_hash = "sha256:template-changed";
  const baselineManifest = buildLlmRouteManifest(mutatedInventory, "/tmp/baseline.json");
  const diff = diffLlmRouteManifests(manifest, baselineManifest, { llmPathId: "mothership.supervisor.review" });
  assert.equal(diff.route_count, 1);
  assert.equal(diff.changes[0].llm_path_id, "mothership.supervisor.review");
  assert.equal(diff.changes[0].status, "changed");
  assert.ok(diff.changes[0].changed_fields.includes("payload_contract_id"));
  assert.ok(diff.changes[0].changed_fields.includes("payload_fingerprint"));
  assert.match(renderLlmRouteDiff(diff), /mothership\.supervisor\.review/);
});

test("CLI diffs route inventories against a baseline inventory path", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "llm-route-diff-"));
  const baselinePath = join(tempDir, "baseline.json");
  const baselineInventory = structuredClone(inventory);
  const changedRoute = baselineInventory.nodes.find((entry) => entry.llm_path_id === "mothership.supervisor.review");
  changedRoute.payload_contract_id = "supervisor.tick.review.v2";
  writeFileSync(baselinePath, JSON.stringify(baselineInventory));

  const run = runOpsCli([
    "llm",
    "route",
    "diff",
    "--path-id",
    "mothership.supervisor.review",
    "--baseline-inventory-path",
    baselinePath,
    "--json",
  ]);

  assert.equal(run.status, 0, run.stderr);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.schema_version, "llm_route_diff/v1");
  assert.equal(parsed.route_count, 1);
  assert.equal(parsed.changes[0].llm_path_id, "mothership.supervisor.review");
  assert.ok(parsed.changes[0].changed_fields.includes("payload_contract_id"));
});
