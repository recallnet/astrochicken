import assert from "node:assert/strict";
import test from "node:test";

import { analyzePhase1BurndownArtifacts } from "./lib/phase1-burndown-finalization.ts";

const ownershipAudit = {
  ok: true,
  active_targets: [
    { file: "factories/a.dot", surface: "graph_transport" },
    { file: "apps/a.ts", surface: "runtime_internal_cli" },
  ],
  active_violation_owners: [
    { file: "factories/a.dot", surface: "graph_transport", owner_id: "owner.graph", owner_path: "factories/a.dot" },
    { file: "apps/a.ts", surface: "runtime_internal_cli", owner_id: "owner.runtime", owner_path: "apps/a.ts" },
  ],
  diagnostics: [],
};

const scopeFinalization = {
  schema_version: "phase1_scope_finalization/v1",
  phase1_target_frozen: true,
  no_rescope_rule: "Update this contract and the regenerated inventory in the same change.",
  remaining_active_classifications: [
    { file: "factories/a.dot", surface: "graph_transport", determinism_classification: "deterministic_internal_transport", graph_role: "real_owner", rationale: "Graph owns orchestration decisions directly." },
    { file: "apps/a.ts", surface: "runtime_internal_cli", determinism_classification: "true_external_boundary", rationale: "Example out-of-scope external boundary." },
  ],
};

test("analyzePhase1BurndownArtifacts succeeds when checked-in artifacts match", () => {
  const first = analyzePhase1BurndownArtifacts({
    ownershipAudit,
    scopeFinalization,
  });
  const second = analyzePhase1BurndownArtifacts({
    ownershipAudit,
    scopeFinalization,
    expectedJson: first.rendered_json,
    expectedMarkdown: first.rendered_markdown,
  });

  assert.equal(second.ok, true);
  assert.deepEqual(second.diagnostics, []);
});

test("analyzePhase1BurndownArtifacts succeeds for zero-target completion artifacts", () => {
  const first = analyzePhase1BurndownArtifacts({
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
  const second = analyzePhase1BurndownArtifacts({
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
    expectedJson: first.rendered_json,
    expectedMarkdown: first.rendered_markdown,
  });

  assert.equal(second.ok, true);
  assert.deepEqual(second.diagnostics, []);
});
