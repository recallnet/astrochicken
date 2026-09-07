import assert from "node:assert/strict";
import test from "node:test";

import { analyzePhase1OwnershipArtifacts, buildPhase1OwnershipAudit, renderPhase1OwnershipMarkdown } from "./phase1-ownership-map.ts";

const manifest = {
  schema_version: "active_surface_manifest/v1",
  graph_families: [{ id: "g", classification: "active_factory", include: ["factories/a.dot"] }],
  runtime_surfaces: [{ id: "r", classification: "hot_path", include: ["apps/a.ts"] }],
  command_surfaces: [
    { id: "owner", classification: "active_deterministic_owner", include: ["packages/factory-ops/src/commands/a.mjs"] },
    { id: "legacy", classification: "legacy_or_deletion_candidate", include: ["packages/factory-ops/src/commands/legacy.mjs"] },
    { id: "cli", classification: "external_operator_cli", include: ["packages/factory-ops/src/cli/commands/x.ts"] },
    { id: "support", classification: "operator_support_surface", include: ["packages/factory-ops/src/commands/support.mjs"] }
  ]
};

const ownershipMap = {
  schema_version: "phase1_ownership_map/v1",
  active_violation_owners: [
    { file: "factories/a.dot", surface: "graph_transport", owner_id: "owner.graph", owner_path: "factories/a.dot" },
    { file: "apps/a.ts", surface: "runtime_internal_cli", owner_id: "owner.runtime", owner_path: "apps/a.ts" },
    { file: "packages/factory-ops/src/commands/a.mjs", surface: "command_thinness", owner_id: "owner.command", owner_path: "packages/factory-ops/src/commands/a.mjs" }
  ],
  legacy_deletion_owners: [
    { file: "packages/factory-ops/src/commands/legacy.mjs", owner_id: "owner.legacy", owner_path: "packages/factory-ops/src/commands/legacy.mjs" }
  ]
};

const readinessReport = {
  phase1_violation_inventory: {
    graph_transport: { violations: [{ file: "factories/a.dot" }] },
    runtime_internal_cli: { violations: [{ file: "apps/a.ts" }] },
    command_thinness: { violations: [{ file: "packages/factory-ops/src/commands/a.mjs" }] },
  },
};

const activeInventory = {
  active_command_reachable_files: [{ path: "packages/factory-ops/src/commands/a.mjs" }],
};

function readFile(file) {
  if (file === "factories/a.dot") return 'digraph x { a [type="tool" prompt="hatch-ops x"] }';
  if (file === "apps/a.ts") return 'spawnSync("node", ["packages/factory-ops/src/cli.ts"]);';
  if (file === "packages/factory-ops/src/commands/a.mjs") return `${"x\n".repeat(401)}import "./legacy.mjs";\n`;
  if (file === "packages/factory-ops/src/commands/legacy.mjs") return "export const legacy = true;\n";
  throw new Error(`unexpected path ${file}`);
}

function pathExists(file) {
  return [
    "factories/a.dot",
    "apps/a.ts",
    "packages/factory-ops/src/commands/a.mjs",
    "packages/factory-ops/src/commands/legacy.mjs",
  ].includes(file);
}

test("buildPhase1OwnershipAudit succeeds for exactly owned active and legacy targets", () => {
  const audit = buildPhase1OwnershipAudit({
    files: ["factories/a.dot", "apps/a.ts", "packages/factory-ops/src/commands/a.mjs", "packages/factory-ops/src/commands/legacy.mjs"],
    manifest,
    readFile,
    pathExists,
    ownershipMap,
    readinessReport,
    activeInventory,
  });
  assert.equal(audit.ok, true);
  assert.equal(audit.summary.active_targets, 3);
  assert.equal(audit.summary.legacy_targets, 1);
  assert.deepEqual(audit.diagnostics, []);
  assert.match(renderPhase1OwnershipMarkdown(audit), /Phase 1 Ownership Map/);
});

test("buildPhase1OwnershipAudit fails on unowned active targets", () => {
  const audit = buildPhase1OwnershipAudit({
    files: ["factories/a.dot", "apps/a.ts", "packages/factory-ops/src/commands/a.mjs", "packages/factory-ops/src/commands/legacy.mjs"],
    manifest,
    readFile,
    pathExists,
    ownershipMap: { ...ownershipMap, active_violation_owners: ownershipMap.active_violation_owners.slice(1) },
    readinessReport,
    activeInventory,
  });
  assert.equal(audit.ok, false);
  assert.match(audit.diagnostics.join("\n"), /unowned_active_surface_violation/);
});

test("analyzePhase1OwnershipArtifacts reports markdown drift", () => {
  const analysis = analyzePhase1OwnershipArtifacts({
    files: ["factories/a.dot", "apps/a.ts", "packages/factory-ops/src/commands/a.mjs", "packages/factory-ops/src/commands/legacy.mjs"],
    manifest,
    readFile,
    pathExists,
    ownershipMap,
    expectedMarkdown: "# stale\n",
    readinessReport,
    activeInventory,
  });
  assert.equal(analysis.ok, false);
  assert.match(analysis.diagnostics.join("\n"), /phase1_ownership_markdown_drift/);
});

test("buildPhase1OwnershipAudit accepts zero-backlog completion state", () => {
  const audit = buildPhase1OwnershipAudit({
    files: ["factories/a.dot", "apps/a.ts", "packages/factory-ops/src/commands/a.mjs", "packages/factory-ops/src/commands/legacy.mjs"],
    manifest,
    readFile,
    pathExists,
    ownershipMap: {
      schema_version: "phase1_ownership_map/v1",
      active_violation_owners: [],
      legacy_deletion_owners: [],
    },
    readinessReport: {
      phase1_violation_inventory: {
        graph_transport: { violations: [] },
        runtime_internal_cli: { violations: [] },
        command_thinness: { violations: [] },
      },
    },
    activeInventory: {
      active_command_reachable_files: [],
    },
  });

  assert.equal(audit.ok, true);
  assert.equal(audit.summary.active_targets, 0);
  assert.equal(audit.summary.legacy_targets, 0);
  assert.deepEqual(audit.diagnostics, []);
});
