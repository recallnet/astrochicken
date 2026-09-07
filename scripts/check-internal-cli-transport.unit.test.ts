import assert from "node:assert/strict";
import test from "node:test";

import { analyzeInternalCliTransport } from "./check-internal-cli-transport.ts";

test("analyzeInternalCliTransport inventories graph internal CLI transport", () => {
  const files = ["packages/capability-release-reporting/workflows/release_report_flow/release_report_flow.workflow-source.mjs"];
  const result = analyzeInternalCliTransport({
    files,
    readFile(file) {
      if (file.endsWith(".dot")) {
        return `digraph x { run [type="tool" prompt="hatch-ops release build-report-context --repo '\\''${"repo"}'\\''"] }`;
      }
      throw new Error("unexpected file");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.graph_internal_cli_transport, 1);
  assert.equal(result.summary.runtime_internal_cli_transport, 0);
  assert.equal(result.summary.opted_in_graph_internal_cli_transport, 0);
  assert.equal(result.violations[0]?.kind, "graph_internal_cli_transport");
  assert.equal(result.violations[0]?.typed_action_transport_mode, "legacy");
});

test("analyzeInternalCliTransport inventories runtime shell transport to internal CLI", () => {
  const files = ["packages/factory-ops/src/lib/runtime.mjs"];
  const result = analyzeInternalCliTransport({
    files,
    readFile() {
      return `import { spawnSync } from "node:child_process";\nspawnSync("node", ["packages/factory-ops/src/cli.ts", "release", "build-report-context"]);`;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.graph_internal_cli_transport, 0);
  assert.equal(result.summary.runtime_internal_cli_transport, 1);
  assert.equal(result.summary.opted_in_graph_internal_cli_transport, 0);
  assert.equal(result.violations[0]?.kind, "runtime_internal_cli_transport");
});

test("analyzeInternalCliTransport ignores files without internal CLI transport", () => {
  const files = ["packages/factory-ops/src/lib/safe.mjs", "README.md"];
  const result = analyzeInternalCliTransport({
    files,
    readFile() {
      return `export function safe() { return "ok"; }`;
    },
  });

  assert.equal(result.checked, 1);
  assert.deepEqual(result.violations, []);
});

test("analyzeInternalCliTransport fails only for opted-in graphs when enforcement is enabled", () => {
  const files = [
    "packages/capability-release-reporting/workflows/release_report_flow/release_report_flow.workflow-source.mjs",
    "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
  ];
  const result = analyzeInternalCliTransport({
    files,
    failOptedInGraphs: true,
    readFile(file) {
      if (file.includes("release_report_flow")) {
        return `digraph x { typed_action_transport_mode = "enforced"; run [type="tool" prompt="hatch-ops release build-report-context"] }`;
      }
      return `digraph y { run [type="tool" prompt="hatch-ops goal build-issue-plan"] }`;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.summary.graph_internal_cli_transport, 2);
  assert.equal(result.summary.opted_in_graph_internal_cli_transport, 1);
  assert.equal(result.violations[0]?.opted_in_graph_failure, true);
  assert.equal(result.violations[1]?.opted_in_graph_failure, false);
});

test("analyzeInternalCliTransport fails active graph transport when active enforcement is enabled", () => {
  const files = [
    "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
  ];
  const result = analyzeInternalCliTransport({
    files,
    failActiveGraphs: true,
    manifest: {
      schema_version: "active_surface_manifest/v1",
      graph_families: [
        {
          id: "active_graphs",
          classification: "active_factory",
          include: ["factories/mothership/graphs/*.dot"],
        },
      ],
      runtime_surfaces: [
        {
          id: "runtime_test_only",
          classification: "test_only",
          include: ["scripts/**/*.test.mjs"],
        },
      ],
      command_surfaces: [
        {
          id: "operator_cli",
          classification: "external_operator_cli",
          include: ["packages/factory-ops/src/cli/**/*.mjs"],
        },
      ],
    },
    activeGraphManifestClassifications: ["active_factory"],
    readFile(file) {
      if (file.includes("factory_supervisor_tick")) {
        return `digraph x { run [type="tool" prompt="hatch-ops supervisor run --op state-snapshot"] }`;
      }
      return `digraph y { run [type="tool" prompt="hatch-ops goal run --op count-decompose-attempts"] }`;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.summary.graph_internal_cli_transport, 1);
  assert.equal(result.summary.active_graph_internal_cli_transport, 1);
  assert.equal(result.violations[0]?.active_graph_failure, true);
});

test("analyzeInternalCliTransport can scope graph checking through the active-surface manifest", () => {
  const files = [
    "packages/capability-release-reporting/workflows/release_report_flow/release_report_flow.workflow-source.mjs",
    "docs/skills/factory-design/templates/top-level-graph.dot",
  ];
  const result = analyzeInternalCliTransport({
    files,
    activeGraphManifestClassifications: ["active_runtime"],
    manifest: {
      schema_version: "active_surface_manifest/v1",
      graph_families: [
        {
          id: "active_runtime_graphs",
          classification: "active_runtime",
          include: ["packages/capability-release-reporting/graphs/*.dot"],
        },
        {
          id: "template_graphs",
          classification: "migratable_template",
          include: ["docs/skills/factory-design/templates/*.dot"],
        },
      ],
      runtime_surfaces: [
        {
          id: "runtime_test_only",
          classification: "test_only",
          include: ["scripts/**/*.test.mjs"],
        },
      ],
      command_surfaces: [
        {
          id: "operator_cli",
          classification: "external_operator_cli",
          include: ["packages/factory-ops/src/cli/commands/release-delivery-cmds.ts"],
        },
      ],
    },
    readFile() {
      return `digraph x { run [type="tool" prompt="hatch-ops release build-report-context"] }`;
    },
  });

  assert.equal(result.checked, 1);
  assert.equal(result.summary.graph_internal_cli_transport, 1);
  assert.equal(result.violations[0]?.file, "packages/capability-release-reporting/workflows/release_report_flow/release_report_flow.workflow-source.mjs");
});
