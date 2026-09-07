import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../..");
const mothershipGraphs = join(repoRoot, "factories/mothership/graphs");

// ── Materialized graphs exist ───────────────────────────────────────────

test("write_scenarios.dot is materialized in mothership graphs", () => {
  const graphPath = join(mothershipGraphs, "write_scenarios.dot");
  assert.ok(existsSync(graphPath), "write_scenarios.dot should exist in mothership graphs");

  const content = readFileSync(graphPath, "utf8");

  // Template vars must be resolved (no {{...}} remaining)
  assert.equal(/\{\{[^}]+\}\}/.test(content), false, "no unresolved template variables should remain");

  // Must use mothership trust domain
  assert.ok(content.includes('trust_domain="mothership.local"'), "should use mothership.local trust domain");

  // Must reference the fan-out child template (materialized, not template)
  assert.ok(
    content.includes("factories/mothership/graphs/write_scenario_item.dot"),
    "fan_out template should reference materialized write_scenario_item.dot",
  );

  // Must have the scenario_author class (LLM scoping)
  assert.ok(content.includes('class="scenario_author"'), "should use scenario_author LLM class");

  // Must have count gate for zero-scenario short-circuit
  assert.ok(content.includes("recommended_count=0"), "should short-circuit when no scenarios recommended");
});

test("write_scenario_item.dot is materialized in mothership graphs", () => {
  const graphPath = join(mothershipGraphs, "write_scenario_item.dot");
  assert.ok(existsSync(graphPath), "write_scenario_item.dot should exist in mothership graphs");

  const content = readFileSync(graphPath, "utf8");

  assert.equal(/\{\{[^}]+\}\}/.test(content), false, "no unresolved template variables should remain");
  assert.ok(content.includes('trust_domain="mothership.local"'), "should use mothership.local trust domain");

  // Must validate before saving
  assert.ok(content.includes("validate_payload"), "should validate scenario payload");
  assert.ok(content.includes('action_id="scenario.save"'), "should save scenario to registry");

  // Must fail closed on bad payload
  assert.ok(content.includes("fail_closed"), "should fail closed on invalid repaired payload");
});

// ── Shared surface manifest wires sync ──────────────────────────────────

test("shared surface manifest includes write_scenarios entries", async () => {
  const { FACTORY_SHARED_SURFACE_MANIFEST } = await import(
    "../../scripts/lib/factory-shared-surface-manifest.ts"
  );

  const scenariosSurface = FACTORY_SHARED_SURFACE_MANIFEST.find(
    (s) => s.id === "write_scenarios",
  );
  assert.ok(scenariosSurface, "manifest should include write_scenarios surface");
  assert.ok(scenariosSurface.templatePath.endsWith("write_scenarios.dot.template"));

  const itemSurface = FACTORY_SHARED_SURFACE_MANIFEST.find(
    (s) => s.id === "write_scenario_item",
  );
  assert.ok(itemSurface, "manifest should include write_scenario_item surface");
  assert.ok(itemSurface.templatePath.endsWith("write_scenario_item.dot.template"));

  // Both should have mothership output
  for (const surface of [scenariosSurface, itemSurface]) {
    const mothershipOutput = surface.outputs.find((o) => o.factoryId === "mothership");
    assert.ok(mothershipOutput, `${surface.id} should have mothership output`);
    assert.equal(mothershipOutput.values.factory_id, "mothership");
    assert.equal(mothershipOutput.values.trust_domain, "mothership.local");
  }
});

// ── goal_execute.dot calls write_scenarios after judge passes ───────────

test("goal_execute.dot wires write_scenarios pipeline after successful merge judge", () => {
  const dotPath = join(mothershipGraphs, "goal_execute.dot");
  const content = readFileSync(dotPath, "utf8");

  // Must have a write_scenarios pipeline node
  assert.ok(
    content.includes("write_scenarios"),
    "goal_execute.dot should reference write_scenarios",
  );

  // The write_scenarios node should be a pipeline type (subgraph invocation)
  assert.ok(
    /write_scenarios\s*\[.*type="pipeline"/.test(content),
    "write_scenarios should be a pipeline-type node",
  );

  // Must pass scenarios_root and approved_features context
  assert.ok(
    content.includes("scenarios_root"),
    "write_scenarios invocation should include scenarios_root",
  );
});

// ── Prompt quality: scoping prompt enforces sparsity ────────────────────

test("write_scenarios scoping prompt enforces scenario sparsity", () => {
  const graphPath = join(mothershipGraphs, "write_scenarios.dot");
  const content = readFileSync(graphPath, "utf8");

  // The key constraint: prefer 0 or 1
  assert.ok(
    content.includes("Prefer 0 or 1 scenario"),
    "scoping prompt must enforce sparse scenario generation",
  );

  // Must not generate noise
  assert.ok(
    content.includes("Do not generate minutia"),
    "scoping prompt must discourage noise scenarios",
  );

  // Must consider existing registry before creating
  assert.ok(
    content.includes("registry_snapshot"),
    "scoping prompt must include existing registry for dedup",
  );
});

// ── Materialized graphs match typed workflow source after rendering ─────

test("materialized write_scenarios.dot matches rendered typed workflow source", async () => {
  const { renderWorkflowSourceModuleToDot } = await import(
    "../../packages/factory-core/src/workflow-ir-registry.ts"
  );
  const { WORKFLOW_SOURCE_MODULE } = await import(
    "../../factories/mothership/workflows/scenario-writing/write_scenarios.workflow-source.mjs"
  );
  const rendered = renderWorkflowSourceModuleToDot(WORKFLOW_SOURCE_MODULE);

  const materialized = readFileSync(join(mothershipGraphs, "write_scenarios.dot"), "utf8");
  assert.equal(materialized, rendered, "materialized graph should match rendered template");
});

test("materialized write_scenario_item.dot matches rendered typed workflow source", async () => {
  const { renderWorkflowSourceModuleToDot } = await import(
    "../../packages/factory-core/src/workflow-ir-registry.ts"
  );
  const { WORKFLOW_SOURCE_MODULE } = await import(
    "../../factories/mothership/workflows/scenario-writing/write_scenario_item.workflow-source.mjs"
  );
  const rendered = renderWorkflowSourceModuleToDot(WORKFLOW_SOURCE_MODULE);

  const materialized = readFileSync(join(mothershipGraphs, "write_scenario_item.dot"), "utf8");
  assert.equal(materialized, rendered, "materialized graph should match rendered template");
});
