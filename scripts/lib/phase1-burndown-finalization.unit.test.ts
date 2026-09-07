import assert from "node:assert/strict";
import test from "node:test";

import { analyzePhase1BurndownArtifacts, buildPhase1BurndownAudit, renderPhase1BurndownMarkdown } from "./phase1-burndown-finalization.ts";

const ownershipAudit = {
  ok: true,
  active_targets: [
    { file: "factories/a.dot", surface: "graph_transport" },
    { file: "apps/a.ts", surface: "runtime_internal_cli" },
    { file: "packages/factory-ops/src/commands/a.mjs", surface: "command_thinness" },
  ],
  active_violation_owners: [
    { file: "factories/a.dot", surface: "graph_transport", owner_id: "owner.graph", owner_path: "factories/a.dot" },
    { file: "apps/a.ts", surface: "runtime_internal_cli", owner_id: "owner.runtime", owner_path: "apps/a.ts" },
    { file: "packages/factory-ops/src/commands/a.mjs", surface: "command_thinness", owner_id: "owner.command", owner_path: "packages/factory-ops/src/commands/a.mjs" },
  ],
  diagnostics: [],
};

const scopeFinalization = {
  schema_version: "phase1_scope_finalization/v1",
  phase1_target_frozen: true,
  no_rescope_rule: "Update this contract and the regenerated inventory in the same change.",
  remaining_active_classifications: [
    { file: "factories/a.dot", surface: "graph_transport", determinism_classification: "deterministic_internal_transport", graph_role: "wrapper_delegator", rationale: "Wrapper graph delegates execution to a downstream owner graph." },
    { file: "apps/a.ts", surface: "runtime_internal_cli", determinism_classification: "deterministic_internal_transport", rationale: "Runtime shell-out is internal deterministic transport." },
    { file: "packages/factory-ops/src/commands/a.mjs", surface: "command_thinness", determinism_classification: "deterministic_internal_transport", rationale: "Command remains active deterministic owner logic." },
  ],
};

test("buildPhase1BurndownAudit succeeds for fully classified remaining targets", () => {
  const audit = buildPhase1BurndownAudit({
    ownershipAudit,
    scopeFinalization,
  });

  assert.equal(audit.ok, true);
  assert.equal(audit.summary.phase1_targets, 3);
  assert.equal(audit.summary.out_of_scope_targets, 0);
  assert.deepEqual(audit.diagnostics, []);
  assert.match(renderPhase1BurndownMarkdown(audit), /Phase 1 Burn-Down Inventory/);
});

test("buildPhase1BurndownAudit fails when an active target is unclassified", () => {
  const audit = buildPhase1BurndownAudit({
    ownershipAudit,
    scopeFinalization: {
      ...scopeFinalization,
      remaining_active_classifications: scopeFinalization.remaining_active_classifications.slice(1),
    },
  });

  assert.equal(audit.ok, false);
  assert.match(audit.diagnostics.join("\n"), /unclassified_phase1_active_violation/);
});

test("analyzePhase1BurndownArtifacts reports inventory drift", () => {
  const analysis = analyzePhase1BurndownArtifacts({
    ownershipAudit,
    scopeFinalization,
    expectedJson: "{}\n",
    expectedMarkdown: "# stale\n",
  });

  assert.equal(analysis.ok, false);
  assert.match(analysis.diagnostics.join("\n"), /phase1_burndown_inventory_json_drift/);
  assert.match(analysis.diagnostics.join("\n"), /phase1_burndown_inventory_markdown_drift/);
});

test("buildPhase1BurndownAudit accepts zero-target completion state", () => {
  const audit = buildPhase1BurndownAudit({
    ownershipAudit: {
      ok: true,
      active_targets: [],
      active_violation_owners: [],
      diagnostics: [],
    },
    scopeFinalization: {
      schema_version: "phase1_scope_finalization/v1",
      phase1_target_frozen: true,
      no_rescope_rule: "Update this contract and the regenerated inventory in the same change.",
      remaining_active_classifications: [],
    },
  });

  assert.equal(audit.ok, true);
  assert.equal(audit.summary.phase1_targets, 0);
  assert.equal(audit.summary.out_of_scope_targets, 0);
  assert.deepEqual(audit.diagnostics, []);
});
