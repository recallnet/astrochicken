import assert from "node:assert/strict";
import test from "node:test";

import { analyzePhase1OwnershipArtifacts } from "./lib/phase1-ownership-map.ts";

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

test("analyzePhase1OwnershipArtifacts succeeds when checked-in markdown matches", () => {
  const first = analyzePhase1OwnershipArtifacts({
    files: ["factories/a.dot", "apps/a.ts", "packages/factory-ops/src/commands/a.mjs", "packages/factory-ops/src/commands/legacy.mjs"],
    manifest,
    readFile,
    pathExists,
    ownershipMap,
    readinessReport,
    activeInventory,
  });
  const second = analyzePhase1OwnershipArtifacts({
    files: ["factories/a.dot", "apps/a.ts", "packages/factory-ops/src/commands/a.mjs", "packages/factory-ops/src/commands/legacy.mjs"],
    manifest,
    readFile,
    pathExists,
    ownershipMap,
    expectedMarkdown: first.rendered_markdown,
    readinessReport,
    activeInventory,
  });
  assert.equal(second.ok, true);
  assert.deepEqual(second.diagnostics, []);
});

test("analyzePhase1OwnershipArtifacts succeeds for zero-backlog completion artifacts", () => {
  const first = analyzePhase1OwnershipArtifacts({
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
  const second = analyzePhase1OwnershipArtifacts({
    files: ["factories/a.dot", "apps/a.ts", "packages/factory-ops/src/commands/a.mjs", "packages/factory-ops/src/commands/legacy.mjs"],
    manifest,
    readFile,
    pathExists,
    ownershipMap: {
      schema_version: "phase1_ownership_map/v1",
      active_violation_owners: [],
      legacy_deletion_owners: [],
    },
    expectedMarkdown: first.rendered_markdown,
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
  assert.equal(second.ok, true);
  assert.deepEqual(second.diagnostics, []);
});
