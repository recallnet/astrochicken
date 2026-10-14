import assert from "node:assert/strict";
import test from "node:test";

import { GATE_MANIFEST } from "./lib/gate-manifest.ts";

test("build gate invokes pnpm build without forwarding silent args into turbo", () => {
  const buildGate = GATE_MANIFEST.find((gate) => gate.id === "build");

  assert.ok(buildGate);
  assert.equal(buildGate.command, "pnpm");
  assert.deepEqual(buildGate.args, ["build"]);
});

test("active surface manifest gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "active_surface_manifest");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-active-surface-manifest.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-active-surface-manifest");
});

test("active surface inventory gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "active_surface_inventory");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-active-surface-inventory.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-active-surface-inventory");
});

test("typed action graph transport gate enforces all active graphs", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "typed_action_graph_transport");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-internal-cli-transport.ts", "--fail-active-graphs", "--active-graphs-only"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-internal-cli-transport");
});

test("active owner command thinness gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "command_thinness_active_owner_surface");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-command-thinness-enforcement.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-command-thinness-enforcement");
});

test("repo-wide runtime internal CLI gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "runtime_internal_cli_repo_wide");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-runtime-internal-cli-enforcement.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-runtime-internal-cli-enforcement");
});

test("release slice structured IO gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "structured_io_release_slice");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-structured-io-enforcement.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-structured-io-enforcement");
});

test("release slice shared ownership gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "shared_ownership_release_slice");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-shared-ownership-enforcement.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-shared-ownership-enforcement");
});

test("phase1 gate readiness gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "phase1_gate_readiness");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-phase1-gate-readiness.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-phase1-gate-readiness");
});

test("phase1 ownership mapping gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "phase1_ownership_mapping");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-phase1-ownership-map.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-phase1-ownership-map");
});

test("phase1 burndown finalization gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "phase1_burndown_finalization");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-phase1-burndown-finalization.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-phase1-burndown-finalization");
});

test("otel taxonomy contract gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "otel_taxonomy_contract");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-otel-taxonomy-contract.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-otel-taxonomy-contract");
});

test("workflow instrumentation helper contract gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "workflow_instrumentation_helper_contract");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-workflow-instrumentation-helper-contract.mjs"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-workflow-instrumentation-helper-contract");
});

test("canonical event emitter ownership gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "canonical_event_emitter_ownership");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-canonical-event-emitter-ownership.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-canonical-event-emitter-ownership");
});

test("github adapter boundary gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "github_adapter_boundary");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-github-adapter-boundary.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-github-adapter-boundary");
  assert.equal(gate.runtime.stagedFileList, true);
});

test("github truth-read boundary gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "github_truth_read_boundary");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-github-truth-read-boundary.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-github-truth-read-boundary");
  assert.equal(gate.runtime.allTracked, true);
});

test("postgres canonical replay suite runs in full profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "postgres_canonical_replay");

  assert.ok(gate);
  assert.equal(gate.command, "pnpm");
  assert.deepEqual(gate.args, ["test:postgres-canonical-replay"]);
  assert.deepEqual(gate.profiles, ["full"]);
});

test("reactor collector contract gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "reactor_collector_contract");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-reactor-collector-contract.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-reactor-collector-contract");
});

test("boundary schema contract gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "boundary_schema_contract");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-boundary-schema-contract.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-boundary-schema-contract");
});

test("sync OpenAPI contract gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "sync_openapi_contract");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-sync-openapi-contract.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-sync-openapi-contract");
});

test("asyncapi contract gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "asyncapi_contract");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-asyncapi-contract.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-asyncapi-contract");
});

test("capability contract gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "capability_contract");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-capability-contract.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-capability-contract");
});

test("capability output contract gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "capability_output_contract");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-capability-output-contract.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-capability-output-contract");
});

test("capability manifest contract gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "capability_manifest_contract");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-capability-manifest-contract.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-capability-manifest-contract");
});

test("workflow source contract gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "workflow_source_contract");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-workflow-source-contract.mjs"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-workflow-source-contract");
});

test("workflow IR parity contract gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "workflow_ir_parity_contract");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-workflow-ir-parity-contract.mjs"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-workflow-ir-parity-contract");
});

test("factory composition contract gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "factory_composition_contract");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-factory-composition-contract.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-factory-composition-contract");
});

test("governed execution dot input gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "governed_execution_dot_input_forbidden");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-governed-execution-dot-input-forbidden.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-governed-execution-dot-input-forbidden");
});

test("generated governed dot-only gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "generated_governed_dot_only");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-generated-governed-dot-only.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-generated-governed-dot-only");
});

test("lineage governance contract gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "lineage_governance_contract");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-lineage-governance-contract.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-lineage-governance-contract");
});

for (const [id, script] of [
  ["governed_output_path_only", "scripts/check-governed-output-path-only.ts"],
  ["capability_output_producer_discovery_fail_closed", "scripts/check-capability-output-producer-discovery-fail-closed.ts"],
  ["capability_output_contract_runtime_parity", "scripts/check-capability-output-contract-runtime-parity.ts"],
  ["workflow_ir_claim_truth", "scripts/check-workflow-ir-claim-truth.mjs"],
  ["workflow_ir_publish_or_plan_exclusive", "scripts/check-workflow-ir-publish-or-plan-exclusive.mjs"],
  ["no_handwritten_dot_for_migrated_families", "scripts/check-no-handwritten-dot-for-migrated-families.ts"],
  ["factory_local_dot_scope_guard", "scripts/check-factory-local-dot-scope-guard.ts"],
  ["factory_execution_glue_forbidden", "scripts/check-factory-execution-glue-forbidden.ts"],
  ["factory_composition_binding_truth", "scripts/check-factory-composition-binding-truth.ts"],
  ["thin_factory_end_state_guard", "scripts/check-thin-factory-end-state-guard.mjs"],
  ["lineage_supported_class_truth", "scripts/check-lineage-supported-class-truth.ts"],
  ["lineage_projection_presence", "scripts/check-lineage-projection-presence.ts"],
  ["lineage_hot_path_isolation", "scripts/check-lineage-hot-path-isolation.ts"],
  ["governed_surface_totality", "scripts/check-governed-surface-totality.ts"],
  ["claim_to_gate_mapping", "scripts/check-claim-to-gate-mapping.ts"],
]) {
  test(`${id} gate is active in every quality profile`, () => {
    const gate = GATE_MANIFEST.find((entry) => entry.id === id);

    assert.ok(gate);
    assert.equal(gate.command, "node");
    assert.deepEqual(gate.args, [script]);
    assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  });
}

for (const [id, script] of [
  ["workflow_ir_runtime_parity_e2e", "scripts/check-workflow-ir-runtime-parity-e2e.mjs"],
  ["runtime_conformance_matrix", "scripts/check-runtime-conformance-matrix.ts"],
]) {
  test(`${id} gate is active only in the full quality profile`, () => {
    const gate = GATE_MANIFEST.find((entry) => entry.id === id);

    assert.ok(gate);
    assert.equal(gate.command, "node");
    assert.deepEqual(gate.args, [script]);
    assert.deepEqual(gate.profiles, ["full"]);
  });
}

test("cloudevents contract gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "cloudevents_contract");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-cloudevents-contract.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-cloudevents-contract");
});

test("oci artifact contract gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "oci_artifact_contract");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-oci-artifact-contract.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-oci-artifact-contract");
});

test("artifact trust contract gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "artifact_trust_contract");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-artifact-trust-contract.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-artifact-trust-contract");
});

test("dispatch latency SLO contract gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "dispatch_latency_slo_contract");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-dispatch-latency-slo-contract.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-dispatch-latency-slo-contract");
});

test("reactor dispatch contract gate is active in every quality profile", () => {
  const gate = GATE_MANIFEST.find((entry) => entry.id === "reactor_dispatch_contract");

  assert.ok(gate);
  assert.equal(gate.command, "node");
  assert.deepEqual(gate.args, ["scripts/check-reactor-dispatch-contract.ts"]);
  assert.deepEqual(gate.profiles, ["fast", "strict", "full"]);
  assert.equal(gate.failureTarget, "check-reactor-dispatch-contract");
});
