import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { analyzeWorkflowSourceContract, shouldBuildHatchDist } from "./lib/workflow-source-contract.ts";
import { stringifyWorkflowSourceModuleJsonSchema } from "../packages/factory-core/src/workflow-source-registry.ts";

test("workflow source contract reuses existing hatch parse dist", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "workflow-source-dist-"));
  mkdirSync(join(repoRoot, "apps", "hatch", "dist", "pipeline"), { recursive: true });
  writeFileSync(join(repoRoot, "apps", "hatch", "dist", "pipeline", "parse.js"), "export const parse = () => ({});\n");

  assert.equal(shouldBuildHatchDist(repoRoot), false);
});

test("workflow source contract fails closed on missing governed runtime graph source declarations", async () => {
  const result = await analyzeWorkflowSourceContract({
    repoRoot: "/repo",
    trackedFiles: [
      "factories/mothership/graphs/write_scenarios.dot",
      "factories/mothership/workflows/scenario-writing/write_scenarios.workflow-source.mjs",
    ],
    readFile(filePath) {
      if (filePath.endsWith("write_scenarios.dot")) {
        return "digraph write_scenarios { label = \"write_scenarios\" start [shape=Mdiamond] done [shape=Msquare] start -> done }";
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
    parseDot: (input) => ({
      name: "write_scenarios",
      attrs: {},
      nodes: { start: { id: "start" }, done: { id: "done" } },
      edges: [{ from: "start", to: "done", attrs: {} }],
    }),
  });

  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /workflow_source_missing_runtime_graph_marker/);
});

test("workflow source contract reports drift when runtime graph ownership markers disagree", async () => {
  const result = await analyzeWorkflowSourceContract({
    repoRoot: "/repo",
    trackedFiles: [
      "factories/mothership/graphs/write_scenarios.dot",
      "factories/mothership/workflows/scenario-writing/write_scenarios.workflow-source.mjs",
    ],
    readFile(filePath) {
      if (filePath.endsWith("write_scenarios.dot")) {
        return [
          "digraph write_scenarios {",
          "  label = \"wrong_name\"",
          "  workflow_source = \"factories/mothership/workflows/scenario-writing/write_scenarios.workflow-source.mjs\"",
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
    parseDot: (input) => ({
      name: "write_scenarios",
      attrs: {
        label: "wrong_name",
        workflow_source: "factories/mothership/workflows/scenario-writing/write_scenarios.workflow-source.mjs",
      },
      nodes: { start: { id: "start" }, done: { id: "done" } },
      edges: [{ from: "start", to: "done", attrs: {} }],
    }),
  });

  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /workflow_source_runtime_graph_label_drift/);
});

test("workflow source contract accepts declared graph labels that differ from workflow ids", async () => {
  const result = await analyzeWorkflowSourceContract({
    repoRoot: "/repo",
    trackedFiles: [
      "packages/factory-runtime/workflows/managed-supervisor-shell/managed-supervisor-shell.workflow-source.mjs",
      "docs/contracts/workflow-ir/factory-runtime/managed-supervisor-shell.dot",
    ],
    readFile(filePath) {
      if (filePath.endsWith("governed-execution-dot-exemptions.json")) {
        return JSON.stringify({ schema_version: "governed_execution_dot_exemptions/v1", exemptions: [] });
      }
      if (filePath.endsWith("workflow-source-module.v1.schema.json")) {
        return stringifyWorkflowSourceModuleJsonSchema();
      }
      if (filePath.endsWith("managed-supervisor-shell.dot")) {
        return [
          "digraph \"managed-supervisor-shell\" {",
          "  label = \"managed_supervisor\"",
          "  workflow_source = \"packages/factory-runtime/workflows/managed-supervisor-shell/managed-supervisor-shell.workflow-source.mjs\"",
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
        workflowId: "managed-supervisor-shell",
        familyId: "runtime",
        title: "Managed Supervisor Shell",
        sourcePath: "packages/factory-runtime/workflows/managed-supervisor-shell/managed-supervisor-shell.workflow-source.mjs",
        runtimeGraphPath: "docs/contracts/workflow-ir/factory-runtime/managed-supervisor-shell.dot",
        jsonSchemaOutputPath: "docs/contracts/workflow-source-module.v1.schema.json",
        graphAttributes: { label: "managed_supervisor" },
        sourceMap: { graphName: "managed-supervisor-shell", nodeMappings: [{ sourceNodeId: "start", runtimeNodeId: "start" }] },
        invariants: { mustPreserve: ["node.id"], mayNormalize: ["attribute_order"] },
        nodes: [{ id: "start", kind: "start" }, { id: "done", kind: "terminal" }],
        edges: [{ from: "start", to: "done" }],
      },
    }),
    parseDot: (input) => ({
      name: "managed-supervisor-shell",
      attrs: {
        label: "managed_supervisor",
        workflow_source: "packages/factory-runtime/workflows/managed-supervisor-shell/managed-supervisor-shell.workflow-source.mjs",
      },
      nodes: { start: { id: "start" }, done: { id: "done" } },
      edges: [{ from: "start", to: "done", attrs: {} }],
    }),
  });

  assert.equal(result.ok, true);
  assert.doesNotMatch(result.diagnostics.join("\n"), /workflow_source_runtime_graph_label_drift/);
});

test("workflow source contract fails when an active mothership graph remains handwritten", async () => {
  const result = await analyzeWorkflowSourceContract({
    repoRoot: "/repo",
    trackedFiles: [
      "docs/contracts/active-surface-manifest.json",
      "docs/contracts/governed-execution-dot-exemptions.json",
      "factories/mothership/workflows/daily-reporting/daily_release_report.workflow-source.mjs",
      "factories/mothership/graphs/daily_release_report.dot",
    ],
    readFile(filePath) {
      if (filePath.endsWith("governed-execution-dot-exemptions.json")) {
        return JSON.stringify({ schema_version: "governed_execution_dot_exemptions/v1", exemptions: [] });
      }
      if (filePath.endsWith("active-surface-manifest.json")) {
        return JSON.stringify({
          graph_families: [{
            classification: "active_factory",
            include: ["factories/mothership/workflows/daily-reporting/daily_release_report.workflow-source.mjs"],
          }],
        });
      }
      if (filePath.endsWith("daily_release_report.dot")) {
        return [
          "digraph daily_release_report {",
          "  label = \"daily_release_report\"",
          "  start [shape=Mdiamond]",
          "  done [shape=Msquare]",
          "  start -> done",
          "}",
        ].join("\n");
      }
      return "";
    },
    parseDot: () => ({
      name: "daily_release_report",
      attrs: { label: "daily_release_report" },
      nodes: { start: { id: "start" }, done: { id: "done" } },
      edges: [{ from: "start", to: "done", attrs: {} }],
    }),
    importWorkflowSource: async () => ({
      WORKFLOW_SOURCE_MODULE: {
        workflowId: "daily_release_report",
        familyId: "daily_reporting",
        title: "Daily Release Report",
        sourcePath: "factories/mothership/workflows/daily-reporting/daily_release_report.workflow-source.mjs",
        runtimeGraphPath: "docs/contracts/workflow-ir/mothership/daily_release_report.dot",
        jsonSchemaOutputPath: "docs/contracts/workflow-source-module.v1.schema.json",
        sourceMap: { graphName: "daily_release_report", nodeMappings: [{ sourceNodeId: "start", runtimeNodeId: "start" }] },
        invariants: { mustPreserve: ["node.id"], mayNormalize: ["attribute_order"] },
        nodes: [{ id: "start", kind: "start" }, { id: "done", kind: "terminal" }],
        edges: [{ from: "start", to: "done" }],
      },
    }),
    buildHatchDist: false,
  });

  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /workflow_source_missing_runtime_graph_marker/);
  assert.match(result.diagnostics.join("\n"), /workflow_source_governed_execution_dot_input_forbidden/);
});

test("workflow source contract bans handwritten factory execution dot inputs repo-wide", async () => {
  const result = await analyzeWorkflowSourceContract({
    repoRoot: "/repo",
    trackedFiles: [
      "docs/contracts/governed-execution-dot-exemptions.json",
      "factories/brainstorm/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
      "factories/brainstorm/graphs/factory_supervisor_tick.dot",
    ],
    readFile(filePath) {
      if (filePath.endsWith("governed-execution-dot-exemptions.json")) {
        return JSON.stringify({ schema_version: "governed_execution_dot_exemptions/v1", exemptions: [] });
      }
      if (filePath.endsWith("factory_supervisor_tick.dot")) {
        return [
          "digraph factory_supervisor_tick {",
          "  label = \"factory_supervisor_tick\"",
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
        workflowId: "factory_supervisor_tick",
        familyId: "dispatch_control",
        title: "Factory Supervisor Tick",
        sourcePath: "factories/brainstorm/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
        runtimeGraphPath: "docs/contracts/workflow-ir/brainstorm/factory_supervisor_tick.dot",
        jsonSchemaOutputPath: "docs/contracts/workflow-source-module.v1.schema.json",
        sourceMap: { graphName: "factory_supervisor_tick", nodeMappings: [{ sourceNodeId: "start", runtimeNodeId: "start" }] },
        invariants: { mustPreserve: ["node.id"], mayNormalize: ["attribute_order"] },
        nodes: [{ id: "start", kind: "start" }, { id: "done", kind: "terminal" }],
        edges: [{ from: "start", to: "done" }],
      },
    }),
    parseDot: () => ({
      name: "factory_supervisor_tick",
      attrs: { label: "factory_supervisor_tick" },
      nodes: { start: { id: "start" }, done: { id: "done" } },
      edges: [{ from: "start", to: "done", attrs: {} }],
    }),
    buildHatchDist: false,
  });

  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /workflow_source_governed_execution_dot_input_forbidden graph="factories\/brainstorm\/graphs\/factory_supervisor_tick\.dot"/);
});

test("workflow source contract bans handwritten package execution dot inputs unless explicitly exempted", async () => {
  const result = await analyzeWorkflowSourceContract({
    repoRoot: "/repo",
    trackedFiles: [
      "docs/contracts/governed-execution-dot-exemptions.json",
      "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
      "packages/capability-goal-decomposition/graphs/goal_run.dot",
    ],
    readFile(filePath) {
      if (filePath.endsWith("governed-execution-dot-exemptions.json")) {
        return JSON.stringify({
          schema_version: "governed_execution_dot_exemptions/v1",
          exemptions: [],
        });
      }
      if (filePath.endsWith("goal_run.dot")) {
        return [
          "digraph goal_run {",
          "  label = \"goal_run\"",
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
        workflowId: "goal_run",
        familyId: "goal_decomposition",
        title: "Goal Run",
        sourcePath: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
        runtimeGraphPath: "docs/contracts/workflow-ir/capability-goal-decomposition/goal_run.dot",
        jsonSchemaOutputPath: "docs/contracts/workflow-source-module.v1.schema.json",
        sourceMap: { graphName: "goal_run", nodeMappings: [{ sourceNodeId: "start", runtimeNodeId: "start" }] },
        invariants: { mustPreserve: ["node.id"], mayNormalize: ["attribute_order"] },
        nodes: [{ id: "start", kind: "start" }, { id: "done", kind: "terminal" }],
        edges: [{ from: "start", to: "done" }],
      },
    }),
    parseDot: () => ({
      name: "goal_run",
      attrs: { label: "goal_run" },
      nodes: { start: { id: "start" }, done: { id: "done" } },
      edges: [{ from: "start", to: "done", attrs: {} }],
    }),
    buildHatchDist: false,
  });

  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /workflow_source_governed_execution_dot_input_forbidden graph="packages\/capability-goal-decomposition\/graphs\/goal_run\.dot"/);
});

test("workflow source contract records explicitly exempt governed dot templates as unresolved debt", async () => {
  const result = await analyzeWorkflowSourceContract({
    repoRoot: "/repo",
    trackedFiles: [
      "docs/contracts/governed-execution-dot-exemptions.json",
      "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
      "packages/capability-goal-decomposition/graphs/goal_run.dot",
    ],
    readFile(filePath) {
      if (filePath.endsWith("governed-execution-dot-exemptions.json")) {
        return JSON.stringify({
          schema_version: "governed_execution_dot_exemptions/v1",
          exemptions: [{
            graph_path: "packages/capability-goal-decomposition/graphs/goal_run.dot",
            classification: "explicit_exempt_template",
            owner: "capability-goal-decomposition",
            rationale: "Shared package template remains handwritten until package workflow-source migration lands.",
          }],
        });
      }
      if (filePath.endsWith("goal_run.dot")) {
        return [
          "digraph goal_run {",
          "  label = \"goal_run\"",
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
        workflowId: "goal_run",
        familyId: "goal_decomposition",
        title: "Goal Run",
        sourcePath: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
        runtimeGraphPath: "docs/contracts/workflow-ir/capability-goal-decomposition/goal_run.dot",
        jsonSchemaOutputPath: "docs/contracts/workflow-source-module.v1.schema.json",
        sourceMap: { graphName: "goal_run", nodeMappings: [{ sourceNodeId: "start", runtimeNodeId: "start" }] },
        invariants: { mustPreserve: ["node.id"], mayNormalize: ["attribute_order"] },
        nodes: [{ id: "start", kind: "start" }, { id: "done", kind: "terminal" }],
        edges: [{ from: "start", to: "done" }],
      },
    }),
    parseDot: () => ({
      name: "goal_run",
      attrs: { label: "goal_run" },
      nodes: { start: { id: "start" }, done: { id: "done" } },
      edges: [{ from: "start", to: "done", attrs: {} }],
    }),
    buildHatchDist: false,
  });

  assert.doesNotMatch(result.diagnostics.join("\n"), /workflow_source_governed_execution_dot_input_forbidden/);
  assert.match(result.diagnostics.join("\n"), /workflow_source_governed_execution_dot_exemption_inventory_nonzero count=1/);
});
