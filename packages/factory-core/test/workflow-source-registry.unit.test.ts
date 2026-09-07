import test from "node:test";
import assert from "node:assert/strict";

import {
  defineWorkflowSourceModule,
  exportWorkflowSourceDocument,
  stringifyWorkflowSourceDocument,
} from "../src/workflow-source-registry.ts";

test("defineWorkflowSourceModule normalizes workflow source metadata", () => {
  const source = defineWorkflowSourceModule({
    workflowId: "write_scenarios",
    familyId: "scenario_writing",
    title: "Write scenarios",
    sourcePath: "factories/mothership/workflows/scenario-writing/write_scenarios.workflow-source.mjs",
    runtimeGraphPath: "factories/mothership/graphs/write_scenarios.dot",
    jsonSchemaOutputPath: "docs/contracts/workflow-source-module.v1.schema.json",
    sourceMap: {
      graphName: "write_scenarios",
      nodeMappings: [
        { sourceNodeId: "scope", runtimeNodeId: "scope" },
        { sourceNodeId: "fan_out", runtimeNodeId: "fan_out" },
      ],
    },
    invariants: {
      mustPreserve: ["node.id", "edge.from", "edge.to", "edge.condition"],
      mayNormalize: ["attribute_order", "stylesheet_import_order"],
    },
    artifacts: [{ id: "scenario_file", ref: "run_snapshot_bundle", when: "runtime_output" }],
    events: [{ id: "scenario_scope", ref: "hatch.run.lifecycle", when: "runtime_output" }],
    nodes: [
      { id: "start", kind: "start" },
      {
        id: "scope",
        kind: "llm_prompt",
        title: "Scope scenarios",
        roleClass: "scenario_author",
        policy: { governance: "reversible", timeout: "2m" },
        binding: {
          outputKey: "scoping_result",
          outputFormat: "json",
          outputs: ["recommended", "declined", "coverage_notes"],
        },
      },
      {
        id: "fan_out",
        kind: "dynamic_fan_out",
        title: "Scenario fan-out",
        composition: {
          templateWorkflowRef: "factories/mothership/workflows/scenario-writing/write_scenario_item.workflow-source.mjs",
          sourceKey: "recommended",
          itemKey: "scenario_brief",
          maxConcurrency: 2,
        },
      },
      { id: "done", kind: "terminal" },
    ],
    edges: [
      { from: "start", to: "scope" },
      { from: "scope", to: "fan_out", condition: "recommended_count>0", label: "write" },
      { from: "fan_out", to: "done" },
    ],
  });

  assert.equal(source.workflowId, "write_scenarios");
  assert.equal(source.familyId, "scenario_writing");
  assert.equal(source.sourceMap.nodeMappings[0].sourceNodeId, "fan_out");
  assert.deepEqual(source.invariants.mustPreserve, ["edge.condition", "edge.from", "edge.to", "node.id"]);
});

test("exportWorkflowSourceDocument renders the canonical typed workflow source envelope", () => {
  const document = exportWorkflowSourceDocument(defineWorkflowSourceModule({
    workflowId: "write_scenario_item",
    familyId: "scenario_writing",
    title: "Write scenario item",
    sourcePath: "factories/mothership/workflows/scenario-writing/write_scenario_item.workflow-source.mjs",
    runtimeGraphPath: "factories/mothership/graphs/write_scenario_item.dot",
    jsonSchemaOutputPath: "docs/contracts/workflow-source-module.v1.schema.json",
    sourceMap: {
      graphName: "write_scenario_item",
      nodeMappings: [{ sourceNodeId: "write", runtimeNodeId: "write" }],
    },
    invariants: {
      mustPreserve: ["node.id"],
      mayNormalize: ["attribute_order"],
    },
    nodes: [
      { id: "start", kind: "start" },
      { id: "write", kind: "llm_prompt", roleClass: "scenario_author" },
      { id: "done", kind: "terminal" },
    ],
    edges: [
      { from: "start", to: "write" },
      { from: "write", to: "done" },
    ],
  }));

  assert.equal(document.schemaVersion, "workflow_source_module/v1");
  assert.equal(document.runtimeGraphPath, "factories/mothership/graphs/write_scenario_item.dot");
  assert.equal(document.sourceMap.graphName, "write_scenario_item");
});

test("stringifyWorkflowSourceDocument returns deterministic JSON", () => {
  const rendered = stringifyWorkflowSourceDocument(defineWorkflowSourceModule({
    workflowId: "demo",
    familyId: "demo_family",
    title: "Demo workflow",
    sourcePath: "factories/demo/workflows/demo.workflow-source.mjs",
    runtimeGraphPath: "factories/demo/graphs/demo.dot",
    jsonSchemaOutputPath: "docs/contracts/workflow-source-module.v1.schema.json",
    sourceMap: {
      graphName: "demo",
      nodeMappings: [{ sourceNodeId: "start", runtimeNodeId: "start" }],
    },
    invariants: {
      mustPreserve: ["node.id"],
      mayNormalize: ["attribute_order"],
    },
    nodes: [
      { id: "start", kind: "start" },
      { id: "done", kind: "terminal" },
    ],
    edges: [{ from: "start", to: "done" }],
  }));

  assert.match(rendered, /"schemaVersion": "workflow_source_module\/v1"/);
  assert.match(rendered, /"runtimeGraphPath": "factories\/demo\/graphs\/demo\.dot"/);
});

test("defineWorkflowSourceModule accepts detached fan-out nodes for generated execution IR migration", () => {
  const source = defineWorkflowSourceModule({
    workflowId: "managed-software-delivery-domain",
    familyId: "runtime",
    title: "Managed software delivery domain",
    sourcePath: "packages/factory-runtime/workflows/managed-software-delivery-domain/managed-software-delivery-domain.workflow-source.mjs",
    runtimeGraphPath: "packages/factory-runtime/workflows/managed_software_delivery_domain/managed_software_delivery_domain.workflow-source.mjs",
    jsonSchemaOutputPath: "docs/contracts/workflow-source-module.v1.schema.json",
    sourceMap: {
      graphName: "managed_software_delivery_domain",
      nodeMappings: [{ sourceNodeId: "spawn_goal_execute", runtimeNodeId: "spawn_goal_execute" }],
    },
    invariants: {
      mustPreserve: ["node.id"],
      mayNormalize: ["attribute_order"],
    },
    nodes: [
      { id: "start", kind: "start" },
      {
        id: "spawn_goal_execute",
        kind: "detached_fan_out",
        handlerType: "fan_out.detached",
        composition: {
          templateRuntimeGraphPath: "packages/capability-software-development/workflows/goal_execute/goal_execute.workflow-source.mjs",
          sourceKey: "executable_goals",
          itemKey: "goal_issue_number",
          maxConcurrency: 0,
        },
      },
      { id: "done", kind: "terminal" },
    ],
    edges: [
      { from: "start", to: "spawn_goal_execute" },
      { from: "spawn_goal_execute", to: "done" },
    ],
  });

  assert.equal(source.nodes.find((node) => node.id === "spawn_goal_execute")?.kind, "detached_fan_out");
  assert.equal(source.nodes.find((node) => node.id === "spawn_goal_execute")?.composition?.maxConcurrency, 0);
});
