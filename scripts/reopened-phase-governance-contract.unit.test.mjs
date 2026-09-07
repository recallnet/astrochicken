import test from "node:test";
import assert from "node:assert/strict";

import { analyzeReopenedPhaseGovernance } from "./lib/reopened-phase-governance-contract.ts";

test("reopened phase governance report records green generated governed DOT-only gate status after migration", async () => {
  const result = await analyzeReopenedPhaseGovernance({
    workflowIrAcceptanceAnalysis: {
      ok: true,
      diagnostics: [],
      claimTruthDiagnostics: [],
      publishStateDiagnostics: [],
      runtimeParityDiagnostics: [],
    },
    capabilityOutputAnalysis: {
      ok: true,
      report: { diagnostics: [] },
    },
    workflowSourceAnalysis: {
      ok: true,
      diagnostics: [],
    },
    workflowIrParityAnalysis: {
      diagnostics: [],
    },
    factoryCompositionAnalysis: {
      ok: true,
      report: { diagnostics: [] },
      manifests: [],
    },
    lineageAnalysis: {
      ok: true,
      diagnostics: [],
    },
    lineageSamplesAnalysis: {
      ok: true,
      diagnostics: [],
    },
  });

  assert.equal(typeof result.report.supporting_gate_status.generated_governed_dot_only, "boolean");
  assert.equal(result.report.supporting_gate_status.generated_governed_dot_only, true);
});

test("reopened phase governance keeps workflow IR failures local to workflow IR gates", async () => {
  const result = await analyzeReopenedPhaseGovernance({
    workflowIrAcceptanceAnalysis: {
      ok: false,
      diagnostics: ["workflow_ir_runtime_validation_failed"],
      claimTruthDiagnostics: [],
      publishStateDiagnostics: [],
      runtimeParityDiagnostics: ["workflow_ir_runtime_validation_failed"],
    },
    workflowIrParityAnalysis: {
      diagnostics: ["workflow_ir_registry_drift"],
    },
    lineageSamplesAnalysis: {
      ok: true,
      diagnostics: [],
    },
    capabilityOutputAnalysis: {
      ok: true,
      report: { diagnostics: [] },
    },
    workflowSourceAnalysis: {
      ok: true,
      diagnostics: [],
    },
    factoryCompositionAnalysis: {
      ok: true,
      report: { diagnostics: [] },
      manifests: [],
    },
    lineageAnalysis: {
      ok: true,
      diagnostics: [],
    },
  });

  assert.equal(result.report.supporting_gate_status.workflow_ir_runtime_parity_e2e, false);
  assert.equal(result.report.supporting_gate_status.workflow_ir_parity_contract, false);
  assert.equal(result.report.supporting_gate_status.governed_surface_totality, true);
});

test("reopened phase governance keeps legacy inventory and workflow IR support gates outside governed surface owner totality", async () => {
  const result = await analyzeReopenedPhaseGovernance({
    workflowIrAcceptanceAnalysis: {
      ok: false,
      diagnostics: ["workflow_ir_runtime_validation_failed"],
      claimTruthDiagnostics: [],
      publishStateDiagnostics: [],
      runtimeParityDiagnostics: ["workflow_ir_runtime_validation_failed"],
    },
    workflowIrParityAnalysis: {
      diagnostics: [],
    },
    lineageSamplesAnalysis: {
      ok: true,
      diagnostics: [],
    },
    capabilityOutputAnalysis: {
      ok: true,
      report: { diagnostics: [] },
    },
    workflowSourceAnalysis: {
      ok: true,
      diagnostics: [],
    },
    factoryCompositionAnalysis: {
      ok: true,
      report: { diagnostics: [] },
    },
    lineageAnalysis: {
      ok: true,
      diagnostics: [],
    },
  });

  assert.equal(result.report.supporting_gate_status.workflow_ir_acceptance, false);
  assert.equal(result.report.supporting_gate_status.workflow_ir_runtime_parity_e2e, false);
  assert.equal(typeof result.report.supporting_gate_status.legacy_pattern_zero_inventory, "boolean");
  assert.equal(result.report.supporting_gate_status.governed_surface_totality, true);
});

test("reopened phase governance can skip workflow IR runtime parity for lightweight preflight gates", async () => {
  const calls = [];
  const result = await analyzeReopenedPhaseGovernance({
    includeWorkflowIrRuntimeParity: false,
    workflowIrAcceptanceAnalyzer: async ({ includeRuntimeParity }) => {
      calls.push(includeRuntimeParity);
      return {
        ok: true,
        diagnostics: [],
        claimTruthDiagnostics: [],
        publishStateDiagnostics: [],
        runtimeParityDiagnostics: ["should_not_drive_lightweight_mode"],
      };
    },
    capabilityOutputAnalysis: {
      ok: true,
      report: { diagnostics: [] },
    },
    workflowSourceAnalysis: {
      ok: true,
      diagnostics: [],
    },
    workflowIrParityAnalysis: {
      diagnostics: [],
    },
    factoryCompositionAnalysis: {
      ok: true,
      report: { diagnostics: [] },
      manifests: [],
    },
    lineageAnalysis: {
      ok: true,
      diagnostics: [],
    },
    lineageSamplesAnalysis: {
      ok: true,
      diagnostics: [],
    },
  });

  assert.deepEqual(calls, [false]);
  assert.equal(result.report.supporting_gate_status.workflow_ir_acceptance, true);
  assert.equal(result.report.supporting_gate_status.workflow_ir_runtime_parity_e2e, true);
});
