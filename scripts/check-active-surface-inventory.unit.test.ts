import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { analyzeActiveSurfaceInventory } from "./check-active-surface-inventory.ts";

test("analyzeActiveSurfaceInventory reports drift when checked-in artifacts do not match", () => {
  const root = mkdtempSync(path.join(tmpdir(), "active-surface-check-"));
  mkdirSync(path.join(root, "docs/contracts"), { recursive: true });
  mkdirSync(path.join(root, "factories/mothership/graphs"), { recursive: true });
  mkdirSync(path.join(root, "packages/factory-ops/src/commands/analysis"), { recursive: true });
  mkdirSync(path.join(root, "apps/hatch/src/pipeline"), { recursive: true });

  writeFileSync(path.join(root, "factory-registry.json"), JSON.stringify({
    schema: "hatch.factory.registry.v1",
    instances: [{ instance_id: "mothership", status: "active", graphs: [{ id: "daily_lens_publish", path: "factories/mothership/graphs/daily_lens_publish.dot" }] }],
  }, null, 2));
  writeFileSync(path.join(root, "factories/mothership/factory.config.json"), JSON.stringify({
    schema: "hatch.factory.config.v1",
    dispatch: { graph: "factories/mothership/graphs/daily_lens_publish.dot" },
  }, null, 2));
  writeFileSync(path.join(root, "factories/mothership/kind.json"), JSON.stringify({
    domain_graph: "factories/mothership/graphs/daily_lens_publish.dot",
  }, null, 2));
  writeFileSync(path.join(root, "docs/contracts/active-surface-manifest.json"), JSON.stringify({
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
  writeFileSync(path.join(root, "docs/contracts/active-surface-inventory.json"), "{}\n");
  writeFileSync(path.join(root, "docs/contracts/active-surface-inventory.md"), "# stale\n");

  const cwd = process.cwd();
  process.chdir(root);

  try {
    const result = analyzeActiveSurfaceInventory({
      repoRoot: root,
      files: [
        "factories/mothership/graphs/daily_lens_publish.dot",
        "apps/hatch/src/pipeline/engine.ts",
        "packages/factory-ops/src/commands/analysis/lens-followup-candidates.mjs",
        "packages/factory-ops/src/commands/analysis/lens.mjs",
      ],
    });

    assert.equal(result.ok, false);
    assert.match(result.diagnostics.join("\n"), /inventory_json_drift/);
    assert.match(result.diagnostics.join("\n"), /inventory_markdown_drift/);
  } finally {
    process.chdir(cwd);
  }
});

test("CLI ignores tracked files that have been deleted from the working tree", () => {
  const root = mkdtempSync(path.join(tmpdir(), "active-surface-inventory-cli-"));
  mkdirSync(path.join(root, "docs/contracts"), { recursive: true });
  mkdirSync(path.join(root, "factories/demo/graphs"), { recursive: true });
  writeFileSync(path.join(root, "factory-registry.json"), JSON.stringify({
    schema: "hatch.factory.registry.v1",
    instances: [],
  }, null, 2));
  writeFileSync(path.join(root, "docs/contracts/active-surface-manifest.json"), JSON.stringify({
    schema_version: "active_surface_manifest/v1",
    graph_families: [
      {
        id: "demo_graphs",
        classification: "historical_or_test_only",
        include: ["factories/demo/graphs/*.dot"],
      },
    ],
    runtime_surfaces: [
      {
        id: "runtime_tests",
        classification: "test_only",
        include: ["apps/**/*.test.ts"],
      },
    ],
    command_surfaces: [
      {
        id: "cli_commands",
        classification: "external_operator_cli",
        include: ["packages/factory-ops/src/cli/commands/**/*.mjs"],
      },
    ],
  }, null, 2));
  writeFileSync(path.join(root, "docs/contracts/active-surface-inventory.json"), "{}\n");
  writeFileSync(path.join(root, "docs/contracts/active-surface-inventory.md"), "# stale\n");
  writeFileSync(path.join(root, "factories/demo/graphs/live.dot"), "digraph live { start -> done }\n");
  writeFileSync(path.join(root, "factories/demo/graphs/deleted.dot"), "digraph deleted { start -> done }\n");

  assert.equal(spawnSync("git", ["init"], { cwd: root, encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("git", ["add", "."], { cwd: root, encoding: "utf8" }).status, 0);
  rmSync(path.join(root, "factories/demo/graphs/deleted.dot"));

  const writeRun = spawnSync("node", [path.join(process.cwd(), "scripts/check-active-surface-inventory.ts"), "--write"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(writeRun.status, 1, writeRun.stderr || writeRun.stdout);

  const verifyRun = spawnSync("node", [path.join(process.cwd(), "scripts/check-active-surface-inventory.ts")], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(verifyRun.status, 0, verifyRun.stderr || verifyRun.stdout);
  assert.match(verifyRun.stdout, /\[active-surface-inventory\] result=ok/);
});
