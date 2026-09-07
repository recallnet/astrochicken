import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { analyzeOtelTaxonomyContract } from "./lib/otel-taxonomy-contract.ts";

const baseContract = JSON.stringify({
  schema_version: "otel_taxonomy_contract/v1",
  required_correlation_attributes: ["factory_id", "run_id", "workflow_id", "capability_id", "owner"],
  naming: {
    event_name_pattern: "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9_]*)+$",
    span_name_pattern: "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9_]*)+$",
    metric_name_pattern: "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9_]*)+$",
    attribute_key_pattern: "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$",
  },
  allowed_attribute_keys: ["factory_id", "run_id", "workflow_id", "capability_id", "owner", "pipeline"],
}, null, 2);

function readFile(path) {
  if (path === "packages/factory-telemetry/src/otel-contract.json") return baseContract;
  if (path === "packages/factory-ops/src/lib/emitter.mjs") {
    return `
      import { emitGovernedOtelEvent } from "@recallnet/factory-telemetry";
      emitGovernedOtelEvent({
        event_name: "factory.supervisor.telemetry",
        correlation: {
          factory_id: "mothership",
          run_id: "run-1",
          workflow_id: "factory_supervisor",
          capability_id: "supervisor",
          owner: "factory_ops.supervisor_artifact"
        },
        attributes: {
          pipeline: "factory_supervisor"
        },
        body: {}
      });
    `;
  }
  if (path === "packages/factory-ops/src/lib/bypass.mjs") {
    return `
      import { emitOtelEvent } from "@recallnet/factory-telemetry";
      emitOtelEvent({ event_name: "factory.bad", attributes: {} });
    `;
  }
  throw new Error(`unexpected file ${path}`);
}

test("otel taxonomy analysis succeeds for governed emitters with required correlation", () => {
  const analysis = analyzeOtelTaxonomyContract({
    files: ["packages/factory-ops/src/lib/emitter.mjs"],
    readFile,
  });

  assert.equal(analysis.ok, true);
  assert.equal(analysis.report.summary.governed_emitters, 1);
  assert.deepEqual(analysis.diagnostics, []);
});

test("otel taxonomy analysis fails on direct raw emit bypass", () => {
  const analysis = analyzeOtelTaxonomyContract({
    files: ["packages/factory-ops/src/lib/bypass.mjs"],
    readFile,
  });

  assert.equal(analysis.ok, false);
  assert.match(analysis.diagnostics.join("\n"), /direct_emit_otel_event_forbidden/);
});

test("otel taxonomy analysis fails when governed correlation keys are missing", () => {
  const analysis = analyzeOtelTaxonomyContract({
    files: ["packages/factory-ops/src/lib/emitter.mjs"],
    readFile(path) {
      if (path === "packages/factory-telemetry/src/otel-contract.json") return baseContract;
      return `
        import { emitGovernedOtelEvent } from "@recallnet/factory-telemetry";
        emitGovernedOtelEvent({
          event_name: "factory.supervisor.telemetry",
          correlation: { factory_id: "mothership" },
          attributes: { pipeline: "factory_supervisor" },
          body: {}
        });
      `;
    },
  });

  assert.equal(analysis.ok, false);
  assert.match(analysis.diagnostics.join("\n"), /missing_required_correlation_key/);
});

test("otel taxonomy analysis can skip report drift enforcement for staged scope", () => {
  const analysis = analyzeOtelTaxonomyContract({
    files: ["packages/factory-ops/src/lib/emitter.mjs"],
    readFile,
    expectedJson: '{"drift":true}\n',
    expectedMarkdown: "# drift\n",
    enforceReportDrift: false,
  });

  assert.equal(analysis.ok, true);
  assert.ok(!analysis.diagnostics.includes("otel_taxonomy_json_drift"));
  assert.ok(!analysis.diagnostics.includes("otel_taxonomy_markdown_drift"));
});

test("otel taxonomy analysis completes on the managed lifecycle telemetry runtime file", () => {
  const analysis = analyzeOtelTaxonomyContract({
    files: ["packages/factory-ops/src/lib/managed-factory-lifecycle-telemetry.ts"],
    readFile(path) {
      return readFileSync(path, "utf8");
    },
    enforceReportDrift: false,
  });

  assert.equal(analysis.ok, true);
  assert.ok(analysis.report.summary.governed_emitters >= 1);
});
