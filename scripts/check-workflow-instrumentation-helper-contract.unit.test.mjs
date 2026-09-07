import assert from "node:assert/strict";
import test from "node:test";

import { analyzeWorkflowInstrumentationHelpers } from "./lib/workflow-instrumentation-helper-contract.ts";

test("workflow instrumentation helper contract fails direct lifecycle EventBus emits", () => {
  const analysis = analyzeWorkflowInstrumentationHelpers({
    files: [
      "apps/hatch/src/pipeline/engine.ts",
      "apps/hatch/src/pipeline/instrumentation-helpers.ts",
    ],
    readFile(path) {
      if (path.endsWith("instrumentation-helpers.ts")) {
        return "export function createWorkflowInstrumentationHelpers() { return {}; }";
      }
      return `
        const events = {};
        events.emit({
          kind: "stage.finish",
          nodeId: "node-1",
        });
      `;
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("workflow_instrumentation_helper_bypass_direct_emit")));
});

test("workflow instrumentation helper contract passes helper-routed lifecycle code", () => {
  const analysis = analyzeWorkflowInstrumentationHelpers({
    files: [
      "apps/hatch/src/pipeline/engine.ts",
      "apps/hatch/src/pipeline/instrumentation-helpers.ts",
    ],
    readFile(path) {
      if (path.endsWith("instrumentation-helpers.ts")) {
        return `
          import { emitGovernedOtelEvent } from "@recallnet/factory-telemetry";
          export function createWorkflowInstrumentationHelpers() {
            return {
              emitWorkflowEvent(event) {
                emitGovernedOtelEvent(event);
              },
            };
          }
        `;
      }
      return `
        import { createWorkflowInstrumentationHelpers } from "./instrumentation-helpers.js";
        const helpers = createWorkflowInstrumentationHelpers();
        helpers.emitWorkflowEvent({ kind: "pipeline.start" });
      `;
    },
  });

  assert.equal(analysis.ok, true);
  assert.equal(analysis.report.summary.helper_consumer_files, 1);
  assert.equal(analysis.report.summary.direct_bypass_files, 0);
});

test("workflow instrumentation helper contract allows reactor helper otel routing", () => {
  const analysis = analyzeWorkflowInstrumentationHelpers({
    files: [
      "apps/hatch/src/pipeline/reactor-instrumentation.ts",
    ],
    readFile() {
      return `
        import { emitGovernedOtelEvent } from "@recallnet/factory-telemetry";
        export function createReactorInstrumentationHelpers() {
          emitGovernedOtelEvent({ event_name: "hatch.reactor.guard_decision" });
          return {};
        }
      `;
    },
  });

  assert.equal(analysis.ok, true);
  assert.equal(analysis.report.summary.direct_bypass_files, 0);
});

test("workflow instrumentation helper contract forbids direct governed otel wiring outside helper", () => {
  const analysis = analyzeWorkflowInstrumentationHelpers({
    files: [
      "apps/hatch/src/pipeline/engine.ts",
      "apps/hatch/src/pipeline/instrumentation-helpers.ts",
    ],
    readFile(path) {
      if (path.endsWith("instrumentation-helpers.ts")) {
        return "export function createWorkflowInstrumentationHelpers() { return {}; }";
      }
      return `
        import { emitGovernedOtelEvent } from "@recallnet/factory-telemetry";
        emitGovernedOtelEvent({ event_name: "hatch.workflow.start" });
      `;
    },
  });

  assert.equal(analysis.ok, false);
  assert.ok(analysis.diagnostics.some((entry) => entry.includes("workflow_instrumentation_helper_bypass_direct_otel")));
});

test("workflow instrumentation analysis can skip report drift enforcement for staged scope", () => {
  const analysis = analyzeWorkflowInstrumentationHelpers({
    files: [
      "apps/hatch/src/pipeline/engine.ts",
      "apps/hatch/src/pipeline/instrumentation-helpers.ts",
    ],
    expectedJson: '{"drift":true}\n',
    expectedMarkdown: "# drift\n",
    enforceReportDrift: false,
    readFile(path) {
      if (path.endsWith("instrumentation-helpers.ts")) {
        return `
          import { emitGovernedOtelEvent } from "@recallnet/factory-telemetry";
          export function createWorkflowInstrumentationHelpers() {
            return {
              emitWorkflowEvent(event) {
                emitGovernedOtelEvent(event);
              },
            };
          }
        `;
      }
      return `
        import { createWorkflowInstrumentationHelpers } from "./instrumentation-helpers.js";
        const helpers = createWorkflowInstrumentationHelpers();
        helpers.emitWorkflowEvent({ kind: "pipeline.start" });
      `;
    },
  });

  assert.equal(analysis.ok, true);
  assert.ok(!analysis.diagnostics.includes("workflow_instrumentation_helper_report_json_drift"));
  assert.ok(!analysis.diagnostics.includes("workflow_instrumentation_helper_report_markdown_drift"));
});

test("workflow instrumentation helper contract falls back to source scanning for unparseable TypeScript", () => {
  const analysis = analyzeWorkflowInstrumentationHelpers({
    files: [
      "apps/hatch/src/pipeline/handler/pipeline.ts",
      "apps/hatch/src/pipeline/instrumentation-helpers.ts",
    ],
    readFile(path) {
      if (path.endsWith("instrumentation-helpers.ts")) {
        return "export function createWorkflowInstrumentationHelpers() { return {}; }";
      }
      return `
        import { createWorkflowInstrumentationHelpers } from "./instrumentation-helpers.js";
        const helpers = createWorkflowInstrumentationHelpers();
        if (helpers?.emitWorkflowEvent) {
          helpers.emitWorkflowEvent({ kind: "pipeline.start" });
        }
        ???
      `;
    },
  });

  assert.equal(analysis.ok, true);
  assert.equal(analysis.report.summary.helper_consumer_files, 1);
});
