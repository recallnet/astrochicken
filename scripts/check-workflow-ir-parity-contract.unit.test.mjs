import test from "node:test";
import assert from "node:assert/strict";

import { analyzeWorkflowIrParityContract } from "./lib/workflow-ir-parity-contract.ts";

test("workflow IR parity contract fails on generated DOT drift", async () => {
  const result = await analyzeWorkflowIrParityContract({
    repoRoot: "/repo",
    trackedFiles: [
      "factories/mothership/workflows/scenario-writing/write_scenarios.workflow-source.mjs",
      "factories/mothership/graphs/write_scenarios.dot",
    ],
    readFile(filePath) {
      if (filePath.endsWith("write_scenarios.dot")) {
        return "digraph wrong_name { label = \"wrong_name\" workflow_source = \"factories/mothership/workflows/scenario-writing/write_scenarios.workflow-source.mjs\" start [shape=Mdiamond] done [shape=Msquare] start -> done }";
      }
      return "";
    },
    importWorkflowSource: async () => ({
      WORKFLOW_SOURCE_MODULE: {
        workflowId: "write_scenarios",
        familyId: "scenario_writing",
        title: "Write scenarios",
        sourcePath: "factories/mothership/workflows/scenario-writing/write_scenarios.workflow-source.mjs",
        runtimeGraphPath: "factories/mothership/graphs/write_scenarios.dot",
        jsonSchemaOutputPath: "docs/contracts/workflow-source-module.v1.schema.json",
        sourceMap: { graphName: "write_scenarios", nodeMappings: [{ sourceNodeId: "start", runtimeNodeId: "start" }] },
        invariants: { mustPreserve: ["node.id"], mayNormalize: ["attribute_order"] },
        nodes: [{ id: "start", kind: "start" }, { id: "done", kind: "terminal" }],
        edges: [{ from: "start", to: "done" }],
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /workflow_ir_runtime_dot_drift/);
});

test("workflow IR parity contract fails on missing publication registry artifacts", async () => {
  const result = await analyzeWorkflowIrParityContract({
    repoRoot: "/repo",
    trackedFiles: [
      "factories/mothership/workflows/scenario-writing/write_scenario_item.workflow-source.mjs",
      "factories/mothership/graphs/write_scenario_item.dot",
    ],
    readFile(filePath) {
      if (filePath.endsWith("write_scenario_item.dot")) {
        return [
          "digraph write_scenario_item {",
          "  label = \"write_scenario_item\"",
          "  workflow_source = \"factories/mothership/workflows/scenario-writing/write_scenario_item.workflow-source.mjs\"",
          "  start [shape=Mdiamond]",
          "  done [shape=Msquare]",
          "  start -> done",
          "}",
        ].join("\n");
      }
      return "";
    },
    importWorkflowSource: async () => ({
      WORKFLOW_SOURCE_MODULE: {
        workflowId: "write_scenario_item",
        familyId: "scenario_writing",
        title: "Write scenario item",
        sourcePath: "factories/mothership/workflows/scenario-writing/write_scenario_item.workflow-source.mjs",
        runtimeGraphPath: "factories/mothership/graphs/write_scenario_item.dot",
        jsonSchemaOutputPath: "docs/contracts/workflow-source-module.v1.schema.json",
        sourceMap: { graphName: "write_scenario_item", nodeMappings: [{ sourceNodeId: "start", runtimeNodeId: "start" }] },
        invariants: { mustPreserve: ["node.id"], mayNormalize: ["attribute_order"] },
        nodes: [{ id: "start", kind: "start" }, { id: "done", kind: "terminal" }],
        edges: [{ from: "start", to: "done" }],
      },
    }),
    expectedRegistryJson: "{\"schema_version\":\"workflow_ir_registry/v1\",\"workflow_irs\":[],\"diagnostics\":[]}\n",
    expectedRegistryMarkdown: "",
  });

  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /workflow_ir_registry_drift/);
});

test("workflow IR parity markdown describes publication-ready packaging rather than a completed publish path", async () => {
  const result = await analyzeWorkflowIrParityContract({
    repoRoot: "/repo",
    trackedFiles: [
      "factories/mothership/workflows/scenario-writing/write_scenario_item.workflow-source.mjs",
      "factories/mothership/graphs/write_scenario_item.dot",
      "docs/contracts/mothership.write_scenario_item.workflow-ir.json",
      "docs/contracts/workflow-ir-document.v1.schema.json",
    ],
    readFile(filePath) {
      if (filePath.endsWith("write_scenario_item.dot")) {
        return [
          "digraph write_scenario_item {",
          '    label = "write_scenario_item"',
          '    workflow_source = "factories/mothership/workflows/scenario-writing/write_scenario_item.workflow-source.mjs"',
          "    start [shape=Mdiamond]",
          "    done [shape=Msquare recovery_sink_type=\"terminal\"]",
          "    start -> done",
          "}",
          "",
        ].join("\n");
      }
      return "";
    },
    importWorkflowSource: async () => ({
      WORKFLOW_SOURCE_MODULE: {
        workflowId: "write_scenario_item",
        familyId: "scenario_writing",
        title: "Write scenario item",
        sourcePath: "factories/mothership/workflows/scenario-writing/write_scenario_item.workflow-source.mjs",
        runtimeGraphPath: "factories/mothership/graphs/write_scenario_item.dot",
        jsonSchemaOutputPath: "docs/contracts/workflow-source-module.v1.schema.json",
        sourceOwnership: { runtimeIr: "generated_dot_runtime_ir" },
        nodes: [{ id: "start", kind: "start" }, { id: "done", kind: "terminal" }],
        edges: [{ from: "start", to: "done" }],
      },
    }),
  });

  assert.doesNotMatch(result.renderedMarkdown, /publish governed workflow IR bundles/i);
  assert.doesNotMatch(result.renderedMarkdown, /publishes through the governed `workflow_ir_bundle`/i);
});

test("workflow IR parity contract fails on missing generated PNG sibling drift", async () => {
  const result = await analyzeWorkflowIrParityContract({
    repoRoot: "/repo",
    trackedFiles: [
      "packages/factory-runtime/workflows/managed-software-delivery-domain/managed-software-delivery-domain.workflow-source.mjs",
      "docs/contracts/workflow-ir/factory-runtime/managed-software-delivery-domain.dot",
      "docs/contracts/workflow-ir/factory-runtime/managed-software-delivery-domain.png",
    ],
    readFile(filePath) {
      if (filePath.endsWith("managed-software-delivery-domain.dot")) {
        return [
          "digraph managed_software_delivery_domain {",
          '    label = "managed_software_delivery_domain"',
          '    workflow_source = "packages/factory-runtime/workflows/managed-software-delivery-domain/managed-software-delivery-domain.workflow-source.mjs"',
          "    start [shape=Mdiamond]",
          "    done [shape=Msquare recovery_sink_type=\"terminal\"]",
          "    start -> done",
          "}",
          "",
        ].join("\n");
      }
      return "";
    },
    readBinary(filePath) {
      if (filePath.endsWith("managed-software-delivery-domain.png")) {
        return Buffer.from("not-the-generated-png");
      }
      return Buffer.alloc(0);
    },
    importWorkflowSource: async () => ({
      WORKFLOW_SOURCE_MODULE: {
        workflowId: "managed-software-delivery-domain",
        familyId: "runtime",
        title: "Managed software delivery domain",
        sourcePath: "packages/factory-runtime/workflows/managed-software-delivery-domain/managed-software-delivery-domain.workflow-source.mjs",
        runtimeGraphPath: "docs/contracts/workflow-ir/factory-runtime/managed-software-delivery-domain.dot",
        jsonSchemaOutputPath: "docs/contracts/workflow-source-module.v1.schema.json",
        sourceOwnership: { runtimeIr: "generated_dot_runtime_ir" },
        nodes: [{ id: "start", kind: "start" }, { id: "done", kind: "terminal" }],
        edges: [{ from: "start", to: "done" }],
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /workflow_ir_runtime_png_drift graph="docs\/contracts\/workflow-ir\/factory-runtime\/managed-software-delivery-domain\.png"/);
});
