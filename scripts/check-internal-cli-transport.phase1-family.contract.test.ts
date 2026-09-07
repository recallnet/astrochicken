import test from "node:test";
import assert from "node:assert/strict";

import { analyzeInternalCliTransport } from "./check-internal-cli-transport.ts";

test("common wrapper binding slice is free of repo-internal CLI transport", () => {
  const files = [
    "factories/brainstorm/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    "packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs",
    "packages/factory-runtime/workflows/managed_software_delivery_domain/managed_software_delivery_domain.workflow-source.mjs",
    "factories/mothership/graphs/daily_release_report.dot",
    "packages/capability-release-reporting/workflows/release_report_flow/release_report_flow.workflow-source.mjs",
  ];

  const result = analyzeInternalCliTransport({ files, failActiveGraphs: true });

  assert.equal(result.summary.graph_internal_cli_transport, 0);
  assert.equal(result.summary.active_graph_internal_cli_transport, 0);
  assert.equal(result.violations.length, 0);
});

test("common binding and brainstorm domain slice is free of repo-internal CLI transport", () => {
  const files = [
    "factories/brainstorm/workflows/dispatch-control/domain_brainstorm.workflow-source.mjs",
    "packages/capability-brainstorming/workflows/brainstorm/brainstorm.workflow-source.mjs",
  ];

  const result = analyzeInternalCliTransport({ files, failActiveGraphs: true });

  assert.equal(result.summary.graph_internal_cli_transport, 0);
  assert.equal(result.summary.active_graph_internal_cli_transport, 0);
  assert.equal(result.violations.length, 0);
});

test("scenario registry slice is free of repo-internal CLI transport", () => {
  const files = [
    "factories/mothership/graphs/write_scenarios.dot",
    "factories/mothership/graphs/write_scenario_item.dot",
  ];

  const result = analyzeInternalCliTransport({ files, failActiveGraphs: true });

  assert.equal(result.summary.graph_internal_cli_transport, 0);
  assert.equal(result.summary.active_graph_internal_cli_transport, 0);
  assert.equal(result.violations.length, 0);
});

test("daily lens slice is free of repo-internal CLI transport", () => {
  const files = [
    "factories/mothership/graphs/daily_lens_publish.dot",
  ];

  const result = analyzeInternalCliTransport({ files, failActiveGraphs: true });

  assert.equal(result.summary.graph_internal_cli_transport, 0);
  assert.equal(result.summary.active_graph_internal_cli_transport, 0);
  assert.equal(result.violations.length, 0);
});

test("goal run slice is free of repo-internal CLI transport", () => {
  const files = [
    "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
  ];

  const result = analyzeInternalCliTransport({ files, failActiveGraphs: true });

  assert.equal(result.summary.graph_internal_cli_transport, 0);
  assert.equal(result.summary.active_graph_internal_cli_transport, 0);
  assert.equal(result.violations.length, 0);
});

test("wave issue legacy bridge slice is free of repo-internal CLI transport", () => {
  const files = [
    "factories/mothership/workflows/wave-execution/wave_issue_execute.workflow-source.mjs",
  ];

  const result = analyzeInternalCliTransport({ files, failActiveGraphs: true });

  assert.equal(result.summary.graph_internal_cli_transport, 0);
  assert.equal(result.summary.active_graph_internal_cli_transport, 0);
  assert.equal(result.violations.length, 0);
});

test("goal queue and execution slice is free of repo-internal CLI transport", () => {
  const files = [
    "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    "packages/factory-runtime/workflows/managed_software_delivery_domain/managed_software_delivery_domain.workflow-source.mjs",
  ];

  const result = analyzeInternalCliTransport({ files, failActiveGraphs: true });

  assert.equal(result.summary.graph_internal_cli_transport, 0);
  assert.equal(result.summary.active_graph_internal_cli_transport, 0);
  assert.equal(result.violations.length, 0);
});

// @context:regression !critical example-web no longer owns local graph wrappers; this phase-1 transport slice must stay pinned to shared runtime graphs to prevent reintroducing deleted example-web-local DOT files.
test("supervisor core and factory control-plane slice is free of repo-internal CLI transport", () => {
  const files = [
    "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    "packages/factory-runtime/workflows/managed_software_delivery_domain/managed_software_delivery_domain.workflow-source.mjs",
    "packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs",
  ];

  const result = analyzeInternalCliTransport({ files, failActiveGraphs: true });

  assert.equal(result.summary.graph_internal_cli_transport, 0);
  assert.equal(result.summary.active_graph_internal_cli_transport, 0);
  assert.equal(result.violations.length, 0);
});
