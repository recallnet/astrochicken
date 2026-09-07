import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildActiveSurfaceInventory,
  extractCliCommandReferences,
  extractStaticGraphReferences,
} from "./active-surface-inventory.ts";

test("extractStaticGraphReferences resolves alias and relative pipeline references", () => {
  const references = extractStaticGraphReferences(`
    a [type="pipeline" pipeline="packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs"]
    b [type="pipeline" pipeline="../child.dot"]
    c [type="pipeline" pipeline="${"${domain_graph}"}"]
  `, "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs");

  assert.deepEqual(references, [
    {
      raw_path: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
      resolved_path: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
      dynamic: false,
    },
    {
      raw_path: "../child.dot",
      resolved_path: "factories/mothership/child.dot",
      dynamic: false,
    },
  ]);
});

test("extractCliCommandReferences resolves the longest matching hatch-ops command path", () => {
  const registry = new Map([
    ["analysis lens-followup-candidates", "packages/factory-ops/src/commands/analysis/lens-followup-candidates.mjs"],
    ["analysis lens", "packages/factory-ops/src/commands/analysis/lens.mjs"],
  ]);
  const references = extractCliCommandReferences(
    `prompt="hatch-ops analysis lens-followup-candidates --repo 'recallnet/astrochicken'"`,
    registry,
  );

  assert.deepEqual(references, [
    {
      command_path: "analysis lens-followup-candidates",
      command_file: "packages/factory-ops/src/commands/analysis/lens-followup-candidates.mjs",
    },
  ]);
});

test("buildActiveSurfaceInventory fails when an active graph reaches a non-owner command closure", () => {
  const root = mkdtempSync(path.join(tmpdir(), "active-surface-inventory-"));
  mkdirSync(path.join(root, "docs/contracts"), { recursive: true });
  mkdirSync(path.join(root, "factories/mothership/graphs"), { recursive: true });
  mkdirSync(path.join(root, "packages/factory-ops/src/commands/analysis"), { recursive: true });
  mkdirSync(path.join(root, "packages/factory-ops/src/commands/common"), { recursive: true });
  mkdirSync(path.join(root, "apps/hatch/src/pipeline"), { recursive: true });

  writeFileSync(path.join(root, "factory-registry.json"), JSON.stringify({
    schema: "hatch.factory.registry.v1",
    instances: [
      {
        instance_id: "mothership",
        status: "active",
        graphs: [
          { id: "daily_lens_publish", path: "factories/mothership/graphs/daily_lens_publish.dot" },
        ],
      },
    ],
  }, null, 2));
  writeFileSync(path.join(root, "factories/mothership/factory.config.json"), JSON.stringify({
    schema: "hatch.factory.config.v1",
    dispatch: { graph: "factories/mothership/graphs/daily_lens_publish.dot" },
    pipeline: { supervisor_tick: "factories/mothership/graphs/daily_lens_publish.dot" },
  }, null, 2));
  writeFileSync(path.join(root, "factories/mothership/kind.json"), JSON.stringify({
    domain_graph: "factories/mothership/graphs/daily_lens_publish.dot",
  }, null, 2));
  writeFileSync(path.join(root, "factories/mothership/graphs/daily_lens_publish.dot"), `
    digraph x {
      start [type="tool" prompt="hatch-ops analysis lens-followup-candidates --repo 'recallnet/astrochicken'"]
    }
  `);
  writeFileSync(path.join(root, "apps/hatch/src/pipeline/engine.ts"), "export const engine = true;\n");
  writeFileSync(path.join(root, "packages/factory-ops/src/commands/analysis/lens-followup-candidates.mjs"), `
    import "./lens.mjs";
    export class AnalysisLensFollowupCandidatesCommand {
      static paths = [["analysis", "lens-followup-candidates"]];
    }
  `);
  writeFileSync(path.join(root, "packages/factory-ops/src/commands/analysis/lens.mjs"), "export const helper = true;\n");

  const manifest = {
    schema_version: "active_surface_manifest/v1",
    graph_families: [
      {
        id: "active_factory_graphs",
        classification: "active_factory",
        include: ["factories/mothership/graphs/daily_lens_publish.dot"],
      },
    ],
    runtime_surfaces: [
      {
        id: "hot_path",
        classification: "hot_path",
        include: ["apps/hatch/src/pipeline/**/*.ts"],
      },
    ],
    command_surfaces: [
      {
        id: "analysis_followup_owner",
        classification: "active_deterministic_owner",
        include: ["packages/factory-ops/src/commands/analysis/lens-followup-candidates.mjs"],
      },
      {
        id: "analysis_helper_support",
        classification: "operator_support_surface",
        include: ["packages/factory-ops/src/commands/analysis/lens.mjs"],
      },
    ],
  };

  const inventory = buildActiveSurfaceInventory({
    repoRoot: root,
    manifest,
    files: [
      "factories/mothership/graphs/daily_lens_publish.dot",
      "apps/hatch/src/pipeline/engine.ts",
      "packages/factory-ops/src/commands/analysis/lens-followup-candidates.mjs",
      "packages/factory-ops/src/commands/analysis/lens.mjs",
    ],
  });

  assert.match(inventory.diagnostics.join("\n"), /active_surface_command_reachability_violation/);
});

test("buildActiveSurfaceInventory ignores deleted command files from diff-scoped file lists", () => {
  const root = mkdtempSync(path.join(tmpdir(), "active-surface-inventory-missing-"));
  mkdirSync(path.join(root, "docs/contracts"), { recursive: true });
  mkdirSync(path.join(root, "factories/mothership/graphs"), { recursive: true });
  mkdirSync(path.join(root, "packages/factory-ops/src/cli/commands"), { recursive: true });

  writeFileSync(path.join(root, "factories/mothership/factory.config.json"), JSON.stringify({
    schema: "hatch.factory.config.v1",
    pipeline: { supervisor_tick: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs" },
  }, null, 2));
  writeFileSync(path.join(root, "factories/mothership/kind.json"), JSON.stringify({
    domain_graph: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
  }, null, 2));
  writeFileSync(path.join(root, "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs"), `
    digraph x {
      start [type="tool" prompt="echo ok"]
    }
  `);
  writeFileSync(path.join(root, "packages/factory-ops/src/cli/commands/factory-host-cmds.ts"), `
    export class FactoryTargetRepoBootstrapCommand {
      static paths = [["factory", "target-repo", "bootstrap"]];
    }
  `);

  const manifest = {
    schema_version: "active_surface_manifest/v1",
    graph_families: [
      {
        id: "active_factory_graphs",
        classification: "active_factory",
        include: ["factories/mothership/graphs/*.dot"],
      },
    ],
    runtime_surfaces: [
      {
        id: "runtime_hot_path",
        classification: "hot_path",
        include: ["apps/**/*.ts"],
      },
    ],
    command_surfaces: [
      {
        id: "cli_commands",
        classification: "external_operator_cli",
        include: ["packages/factory-ops/src/cli/commands/**/*.mjs"],
      },
    ],
  };

  const inventory = buildActiveSurfaceInventory({
    repoRoot: root,
    manifest,
    files: [
      "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
      "packages/factory-ops/src/cli/commands/factory-host-cmds.ts",
      "packages/factory-ops/src/commands/factory-home-repo-bootstrap.mjs",
    ],
  });

  assert.equal(inventory.diagnostics.length, 0);
});
