import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveWorkflowDiagramPngPath,
  deriveWorkflowRuntimeDotPath,
  defineWorkflowIrModule,
  exportWorkflowIrDocument,
  stringifyWorkflowIrDocument,
  renderWorkflowSourceModuleToDot,
} from "../src/workflow-ir-registry.ts";

test("renderWorkflowSourceModuleToDot emits deterministic runtime DOT IR", () => {
  const rendered = renderWorkflowSourceModuleToDot({
    workflowId: "demo_flow",
    sourcePath: "factories/demo/workflows/demo.workflow-source.mjs",
    runtimeGraphPath: "factories/demo/graphs/demo.dot",
    nodes: [
      { id: "start", kind: "start", title: "Start" },
      { id: "count", kind: "tool_action", title: "Count", actionId: "common.count_json_items", handlerType: "tool", policy: { governance: "irreversible" }, binding: { outputKey: "count" } },
      { id: "gate", kind: "decision", title: "Ready?" },
      { id: "done", kind: "terminal", title: "Done" },
    ],
    edges: [
      { from: "start", to: "count" },
      { from: "count", to: "gate" },
      { from: "gate", to: "done", condition: "count>0", label: "go" },
    ],
  });

  assert.match(rendered, /digraph demo_flow/);
  assert.match(rendered, /workflow_source = "factories\/demo\/workflows\/demo\.workflow-source\.mjs"/);
  assert.match(rendered, /count \[type="tool" governance="irreversible" action_runtime="in_process" action_id="common.count_json_items"/);
  assert.match(rendered, /start -> count -> gate/);
  assert.match(rendered, /gate -> done \[condition="count>0" label="go"\]/);
});

test("deriveWorkflowDiagramPngPath returns a sibling PNG path for generated DOT runtime IR", () => {
  assert.equal(
    deriveWorkflowDiagramPngPath("docs/contracts/workflow-ir/factory-runtime/managed_software_delivery_domain.dot"),
    "docs/contracts/workflow-ir/factory-runtime/managed_software_delivery_domain.png",
  );
  assert.equal(
    deriveWorkflowDiagramPngPath("docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot"),
    "docs/contracts/workflow-ir/factory-runtime/managed_supervisor.png",
  );
});

test("renderWorkflowSourceModuleToDot preserves recovery ownership on decision nodes", () => {
  const rendered = renderWorkflowSourceModuleToDot({
    workflowId: "decision_recovery_demo",
    sourcePath: "factories/demo/workflows/decision_recovery_demo.workflow-source.mjs",
    runtimeGraphPath: "factories/demo/graphs/decision_recovery_demo.dot",
    nodes: [
      { id: "start", kind: "start", title: "Start", policy: { recoveryOwner: "supervisor" } },
      { id: "gate", kind: "decision", title: "Ready?", policy: { recoveryOwner: "supervisor" } },
      { id: "done", kind: "terminal", title: "Done", policy: { recoveryOwner: "supervisor" } },
    ],
    edges: [
      { from: "start", to: "gate" },
      { from: "gate", to: "done", condition: "count>0" },
    ],
  });

  assert.match(rendered, /gate \[shape="diamond" label="Ready\?" recovery_owner="supervisor"\]/);
});

test("renderWorkflowSourceModuleToDot emits Hatch pipeline targets for pipeline nodes", () => {
  const rendered = renderWorkflowSourceModuleToDot({
    workflowId: "pipeline_demo",
    sourcePath: "factories/demo/workflows/pipeline_demo.workflow-source.mjs",
    runtimeGraphPath: "factories/demo/graphs/pipeline_demo.dot",
    nodes: [
      { id: "start", kind: "start", title: "Start" },
      {
        id: "run_child",
        kind: "pipeline",
        title: "Run child",
        handlerType: "pipeline",
        composition: { workflowRef: "factories/demo/workflows/child/child.workflow-source.mjs" },
      },
      { id: "done", kind: "terminal", title: "Done" },
    ],
    edges: [
      { from: "start", to: "run_child" },
      { from: "run_child", to: "done" },
    ],
  });

  assert.match(rendered, /run_child \[type="pipeline" label="Run child" pipeline="factories\/demo\/workflows\/child\/child\.workflow-source\.mjs"\]/);
  assert.doesNotMatch(rendered, /workflow="factories\/demo\/workflows\/child\/child\.workflow-source\.mjs"/);
});

test("renderWorkflowSourceModuleToDot quotes graph identifiers that are not valid DOT bare ids", () => {
  const rendered = renderWorkflowSourceModuleToDot({
    workflowId: "managed-supervisor-shell",
    sourcePath: "packages/factory-runtime/workflows/managed-supervisor-shell/managed-supervisor-shell.workflow-source.mjs",
    runtimeGraphPath: deriveWorkflowRuntimeDotPath(
      "packages/factory-runtime/workflows/managed-supervisor-shell/managed-supervisor-shell.workflow-source.mjs",
      "managed-supervisor-shell",
    ),
    nodes: [
      { id: "start", kind: "start", title: "Start" },
      { id: "done", kind: "terminal", title: "Done" },
    ],
    edges: [
      { from: "start", to: "done" },
    ],
  });

  assert.match(rendered, /digraph "managed-supervisor-shell" \{/);
});

test("renderWorkflowSourceModuleToDot preserves declared attribute order for source-owned action metadata", () => {
  const rendered = renderWorkflowSourceModuleToDot({
    workflowId: "ordered_demo",
    sourcePath: "packages/demo/workflows/ordered_demo/ordered_demo.workflow-source.mjs",
    runtimeGraphPath: "packages/demo/graphs/ordered_demo.dot",
    nodes: [
      { id: "start", kind: "start", title: "Start" },
      {
        id: "resolve_execution_path",
        kind: "tool_action",
        title: "Resolve canonical goal execution-path metadata",
        dotAttributes: {
          type: "tool",
          governance: "reversible",
          action_runtime: "in_process",
          action_id: "software.resolve_goal_execution_path",
          label: "Resolve canonical goal execution-path metadata",
          output_format: "json",
          outputs: "goal_execution_path",
          action_repo: "${repo}",
          action_goal_issue_number: "${issue_number}",
          action_goal_execution_paths: "${goal_execution_paths}",
          action_factory_id: "${factory_id}",
          trust_domain: "${trust_domain}",
          trust_role: "${trust_role}.tool",
        },
      },
      { id: "done", kind: "terminal", title: "Done" },
    ],
    edges: [
      { from: "start", to: "resolve_execution_path" },
      { from: "resolve_execution_path", to: "done" },
    ],
  });

  assert.match(rendered, /action_repo="\$\{repo\}" action_goal_issue_number="\$\{issue_number\}" action_goal_execution_paths="\$\{goal_execution_paths\}" action_factory_id="\$\{factory_id\}"/);
});

test("renderWorkflowSourceModuleToDot relocates stylesheet imports for docs and runtime hosts", () => {
  const definition = {
    workflowId: "goal_execute",
    sourcePath: "packages/capability-software-development/workflows/goal_execute/goal_execute.workflow-source.mjs",
    runtimeGraphPath: "docs/contracts/workflow-ir/capability-software-development/goal_execute.dot",
    imports: ["roles.stylesheet"],
    nodes: [
      { id: "start", kind: "start", title: "Start" },
      { id: "done", kind: "terminal", title: "Done" },
    ],
    edges: [{ from: "start", to: "done" }],
  };

  const docsRendered = renderWorkflowSourceModuleToDot(definition);
  const runtimeRendered = renderWorkflowSourceModuleToDot(definition, {
    hostPath: "packages/capability-software-development/workflows/goal_execute/goal_execute.workflow-source.mjs",
  });

  assert.match(docsRendered, /@import "\.\.\/\.\.\/\.\.\/\.\.\/packages\/capability-software-development\/graphs\/roles\.stylesheet"/);
  assert.match(runtimeRendered, /@import "\.\.\/\.\.\/graphs\/roles\.stylesheet"/);
});

test("renderWorkflowSourceModuleToDot keeps workflow-source stylesheet imports repo-relative for absolute host paths", () => {
  const definition = {
    workflowId: "goal_execute",
    sourcePath: "packages/capability-software-development/workflows/goal_execute/goal_execute.workflow-source.mjs",
    runtimeGraphPath: "docs/contracts/workflow-ir/capability-software-development/goal_execute.dot",
    imports: ["roles.stylesheet"],
    nodes: [
      { id: "start", kind: "start", title: "Start" },
      { id: "done", kind: "terminal", title: "Done" },
    ],
    edges: [{ from: "start", to: "done" }],
  };

  const rendered = renderWorkflowSourceModuleToDot(definition, {
    hostPath: "/path/to/astrochicken/packages/capability-software-development/workflows/goal_execute/goal_execute.workflow-source.mjs",
  });

  assert.match(rendered, /@import "\.\.\/\.\.\/graphs\/roles\.stylesheet"/);
  assert.doesNotMatch(rendered, /@import "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/packages\/capability-software-development\/graphs\/roles\.stylesheet"/);
});

test("defineWorkflowIrModule exports canonical workflow IR artifact metadata", () => {
  const document = exportWorkflowIrDocument(defineWorkflowIrModule({
    workflowId: "write_scenarios",
    familyId: "scenario_writing",
    sourcePath: "factories/mothership/workflows/scenario-writing/write_scenarios.workflow-source.mjs",
    runtimeGraphPath: "factories/mothership/graphs/write_scenarios.dot",
    artifactRef: "ghcr.io/recallnet/factory/workflow-ir:mothership-write-scenarios",
    compilerVersion: "workflow_ir_compiler/v1",
    generatedFiles: [
      "factories/mothership/graphs/write_scenarios.dot",
      "factories/mothership/graphs/write_scenarios.png",
    ],
    metadata: {
      schema_version: "workflow_ir_artifact_metadata/v1",
      artifact_identity: {
        factory_id: "mothership",
        run_id: "phase9-2",
        capability_id: "scenario_writing",
        workflow_id: "write_scenarios",
        workflow_source_revision: "d6efac26",
        correlation_id: "phase9-2",
      },
      workflow_graph_id: "write_scenarios",
      compiler_version: "workflow_ir_compiler/v1",
    },
  }));

  assert.equal(document.schemaVersion, "workflow_ir_document/v1");
  assert.equal(document.artifactClass, "workflow_ir_bundle");
  assert.equal(document.runtimeGraphPath, "factories/mothership/graphs/write_scenarios.dot");
  assert.equal(document.publicationPlan.media_type, "application/vnd.recallnet.factory.workflow-ir.bundle.v1");
  assert.deepEqual(
    document.publicationPlan.files.map((entry) => [entry.path, entry.mediaType]),
    [
      ["factories/mothership/graphs/write_scenarios.dot", "text/vnd.graphviz"],
      ["factories/mothership/graphs/write_scenarios.png", "image/png"],
    ],
  );
});

test("stringifyWorkflowIrDocument returns deterministic JSON", () => {
  const rendered = stringifyWorkflowIrDocument(defineWorkflowIrModule({
    workflowId: "demo_flow",
    familyId: "demo_family",
    sourcePath: "factories/demo/workflows/demo.workflow-source.mjs",
    runtimeGraphPath: "factories/demo/graphs/demo.dot",
    artifactRef: "ghcr.io/recallnet/factory/workflow-ir:demo",
    compilerVersion: "workflow_ir_compiler/v1",
    generatedFiles: ["factories/demo/graphs/demo.dot", "factories/demo/graphs/demo.png"],
    metadata: {
      schema_version: "workflow_ir_artifact_metadata/v1",
      artifact_identity: {
        factory_id: "demo",
        run_id: "phase9-2",
        capability_id: "demo_family",
        workflow_id: "demo_flow",
        workflow_source_revision: "rev1",
        correlation_id: "phase9-2",
      },
      workflow_graph_id: "demo_flow",
      compiler_version: "workflow_ir_compiler/v1",
    },
  }));

  assert.match(rendered, /"schemaVersion": "workflow_ir_document\/v1"/);
  assert.match(rendered, /"artifactClass": "workflow_ir_bundle"/);
  assert.match(rendered, /"image\/png"/);
});
