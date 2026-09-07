import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  analyzeActiveSurfaceManifest,
} from "./check-active-surface-manifest.ts";
import {
  ACTIVE_SURFACE_MANIFEST_PATH,
  classifyActiveSurfaceFiles,
  loadActiveSurfaceManifest,
} from "./lib/active-surface-manifest.ts";

test("classifyActiveSurfaceFiles matches files against the canonical manifest without ambiguity", () => {
  const manifest = {
    schema_version: "active_surface_manifest/v1",
    graph_families: [
      {
        id: "factory_graphs",
        classification: "active_factory",
        include: ["factories/mothership/graphs/*.dot"],
      },
    ],
    runtime_surfaces: [
      {
        id: "runtime_hot_path",
        classification: "hot_path",
        include: ["apps/hatch/src/pipeline/**/*.ts"],
        exclude: ["apps/hatch/src/pipeline/**/*.test.ts"],
      },
      {
        id: "runtime_tests",
        classification: "test_only",
        include: ["apps/hatch/src/pipeline/**/*.test.ts"],
      },
    ],
    command_surfaces: [
      {
        id: "owner_commands",
        classification: "active_deterministic_owner",
        include: ["packages/factory-ops/src/commands/release-manifest.ts"],
      },
    ],
  };

  const result = classifyActiveSurfaceFiles({
    manifest,
    files: [
      "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
      "apps/hatch/src/pipeline/engine.ts",
      "apps/hatch/src/pipeline/engine.test.ts",
      "packages/factory-ops/src/commands/release-manifest.ts",
    ],
  });

  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.classificationByFile.get("factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs")?.classification, "active_factory");
  assert.equal(result.classificationByFile.get("apps/hatch/src/pipeline/engine.ts")?.classification, "hot_path");
  assert.equal(result.classificationByFile.get("apps/hatch/src/pipeline/engine.test.ts")?.classification, "test_only");
  assert.equal(result.classificationByFile.get("packages/factory-ops/src/commands/release-manifest.ts")?.classification, "active_deterministic_owner");
});

test("analyzeActiveSurfaceManifest fails when a candidate file is left unclassified", () => {
  const result = analyzeActiveSurfaceManifest({
    manifest: {
      schema_version: "active_surface_manifest/v1",
      graph_families: [
        {
          id: "other_graphs",
          classification: "historical_or_test_only",
          include: ["scripts/test/fixtures/**/*.dot"],
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
    },
    files: ["factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs"],
  });

  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /unclassified_surface/);
});

test("analyzeActiveSurfaceManifest ignores deleted files from diff-scoped input", () => {
  const result = analyzeActiveSurfaceManifest({
    manifest: {
      schema_version: "active_surface_manifest/v1",
      graph_families: [
        {
          id: "factory_graphs",
          classification: "active_factory",
          include: ["factories/mothership/graphs/*.dot"],
        },
      ],
      runtime_surfaces: [
        {
          id: "runtime_hot_path",
          classification: "hot_path",
          include: ["apps/hatch/src/pipeline/**/*.ts"],
        },
      ],
      command_surfaces: [
        {
          id: "cli_commands",
          classification: "external_operator_cli",
          include: ["packages/factory-ops/src/cli/commands/**/*.mjs"],
        },
      ],
    },
    files: [
      "packages/factory-ops/src/commands/factory-home-repo-bootstrap.mjs",
      "packages/factory-ops/src/commands/factory-home-repo-validate.mjs",
    ],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics, []);
});

test("analyzeActiveSurfaceManifest fails when an entry uses an unknown classification", () => {
  const result = analyzeActiveSurfaceManifest({
    manifest: {
      schema_version: "active_surface_manifest/v1",
      graph_families: [
        {
          id: "factory_graphs",
          classification: "active_factory_typo",
          include: ["factories/mothership/graphs/*.dot"],
        },
      ],
      runtime_surfaces: [
        {
          id: "runtime_hot_path",
          classification: "hot_path",
          include: ["apps/hatch/src/**/*.ts"],
        },
      ],
      command_surfaces: [
        {
          id: "owner_commands",
          classification: "active_deterministic_owner",
          include: ["packages/factory-ops/src/commands/**/*.mjs"],
        },
      ],
    },
    files: ["factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs"],
  });

  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /unknown classification/);
});

test("analyzeActiveSurfaceManifest fails when command owners use a coarse catch-all bucket", () => {
  const result = analyzeActiveSurfaceManifest({
    manifest: {
      schema_version: "active_surface_manifest/v1",
      graph_families: [
        {
          id: "factory_graphs",
          classification: "active_factory",
          include: ["factories/mothership/graphs/*.dot"],
        },
      ],
      runtime_surfaces: [
        {
          id: "runtime_hot_path",
          classification: "hot_path",
          include: ["apps/hatch/src/**/*.ts"],
        },
      ],
      command_surfaces: [
        {
          id: "owner_commands",
          classification: "active_deterministic_owner",
          include: ["packages/factory-ops/src/commands/**/*.mjs"],
        },
      ],
    },
    files: ["packages/factory-ops/src/commands/release-manifest.ts"],
  });

  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /coarse active_deterministic_owner pattern/);
});

test("loadActiveSurfaceManifest reads the canonical repo manifest", () => {
  const manifest = loadActiveSurfaceManifest();

  assert.equal(manifest.schema_version, "active_surface_manifest/v1");
  assert.equal(Array.isArray(manifest.graph_families), true);
  assert.equal(Array.isArray(manifest.runtime_surfaces), true);
  assert.equal(Array.isArray(manifest.command_surfaces), true);
});

test("CLI validates the canonical active-surface manifest against tracked files", () => {
  const run = spawnSync("node", ["scripts/check-active-surface-manifest.ts", "--all-tracked"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /\[active-surface-manifest\] result=ok/);
  assert.match(run.stdout, new RegExp(ACTIVE_SURFACE_MANIFEST_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("CLI ignores tracked files that have been deleted from the working tree", () => {
  const repoDir = mkdtempSync(path.join(tmpdir(), "active-surface-manifest-"));
  mkdirSync(path.join(repoDir, "docs/contracts"), { recursive: true });
  mkdirSync(path.join(repoDir, "factories/demo/graphs"), { recursive: true });
  writeFileSync(path.join(repoDir, "docs/contracts/active-surface-manifest.json"), JSON.stringify({
    schema_version: "active_surface_manifest/v1",
    graph_families: [
      {
        id: "factory_graphs",
        classification: "active_factory",
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
  writeFileSync(path.join(repoDir, "factories/demo/graphs/live.dot"), "digraph live { start [shape=Mdiamond] done [shape=Msquare] start -> done }\n");
  writeFileSync(path.join(repoDir, "factories/demo/graphs/deleted.dot"), "digraph deleted { start [shape=Mdiamond] done [shape=Msquare] start -> done }\n");

  assert.equal(spawnSync("git", ["init"], { cwd: repoDir, encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("git", ["add", "."], { cwd: repoDir, encoding: "utf8" }).status, 0);
  rmSync(path.join(repoDir, "factories/demo/graphs/deleted.dot"));

  const run = spawnSync("node", [path.join(process.cwd(), "scripts/check-active-surface-manifest.ts"), "--all-tracked"], {
    cwd: repoDir,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.doesNotMatch(run.stdout, /deleted\.dot/);
});
