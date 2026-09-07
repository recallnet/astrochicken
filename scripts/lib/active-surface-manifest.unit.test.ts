import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMAND_CLASSIFICATIONS,
  GRAPH_CLASSIFICATIONS,
  RUNTIME_CLASSIFICATIONS,
  allowedClassificationsForSurfaceType,
  classifyPathWithManifestEntries,
  listActiveSurfaceCandidateFiles,
  selectManifestScopedFiles,
  validateActiveSurfaceManifest,
} from "./active-surface-manifest.ts";

test("listActiveSurfaceCandidateFiles partitions graph, runtime, and command candidates", () => {
  const candidates = listActiveSurfaceCandidateFiles([
    "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    "apps/hatch/src/pipeline/engine.ts",
    "packages/factory-ops/src/commands/release-manifest.ts",
    "packages/factory-ops/src/cli/commands/release.ts",
    "scripts/check-internal-cli-transport.ts",
  ]);

  assert.deepEqual(candidates.graphs, ["factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs"]);
  assert.deepEqual(candidates.runtime, ["apps/hatch/src/pipeline/engine.ts"]);
  assert.deepEqual(candidates.commands, [
    "packages/factory-ops/src/cli/commands/release.ts",
    "packages/factory-ops/src/commands/release-manifest.ts",
  ]);
});

test("classifyPathWithManifestEntries supports include and exclude patterns", () => {
  const match = classifyPathWithManifestEntries({
    path: "apps/hatch/src/pipeline/engine.ts",
    entries: [
      {
        id: "pipeline_hot_path",
        classification: "hot_path",
        include: ["apps/hatch/src/pipeline/**/*.ts"],
        exclude: ["apps/hatch/src/pipeline/**/*.test.ts"],
      },
    ],
  });

  const excluded = classifyPathWithManifestEntries({
    path: "apps/hatch/src/pipeline/engine.test.ts",
    entries: [
      {
        id: "pipeline_hot_path",
        classification: "hot_path",
        include: ["apps/hatch/src/pipeline/**/*.ts"],
        exclude: ["apps/hatch/src/pipeline/**/*.test.ts"],
      },
    ],
  });

  assert.equal(match.matches.length, 1);
  assert.equal(match.matches[0].classification, "hot_path");
  assert.equal(excluded.matches.length, 0);
});

test("allowedClassificationsForSurfaceType exposes the closed enum for each surface", () => {
  assert.deepEqual(allowedClassificationsForSurfaceType("graph"), GRAPH_CLASSIFICATIONS);
  assert.deepEqual(allowedClassificationsForSurfaceType("runtime"), RUNTIME_CLASSIFICATIONS);
  assert.deepEqual(allowedClassificationsForSurfaceType("command"), COMMAND_CLASSIFICATIONS);
  assert.deepEqual(allowedClassificationsForSurfaceType("unknown"), []);
});

test("validateActiveSurfaceManifest rejects coarse active owner buckets", () => {
  const diagnostics = validateActiveSurfaceManifest({
    schema_version: "active_surface_manifest/v1",
    graph_families: [
      {
        id: "graphs",
        classification: "active_factory",
        include: ["factories/**/*.dot"],
      },
    ],
    runtime_surfaces: [
      {
        id: "runtime",
        classification: "execution_path",
        include: ["apps/**/*.ts"],
      },
    ],
    command_surfaces: [
      {
        id: "owner_commands",
        classification: "active_deterministic_owner",
        include: ["packages/factory-ops/src/commands/**/*.mjs"],
      },
    ],
  });

  assert.match(diagnostics.join("\n"), /coarse active_deterministic_owner pattern/);
});

test("validateActiveSurfaceManifest reports unknown classifications", () => {
  const diagnostics = validateActiveSurfaceManifest({
    schema_version: "active_surface_manifest/v1",
    graph_families: [
      {
        id: "graphs",
        classification: "active_factory_typo",
        include: ["factories/**/*.dot"],
      },
    ],
    runtime_surfaces: [
      {
        id: "runtime",
        classification: "execution_path",
        include: ["apps/**/*.ts"],
      },
    ],
    command_surfaces: [
      {
        id: "commands",
        classification: "active_deterministic_owner",
        include: ["packages/factory-ops/src/commands/**/*.mjs"],
      },
    ],
  });

  assert.match(diagnostics.join("\n"), /unknown classification/);
});

test("selectManifestScopedFiles fails closed on invalid manifest input", () => {
  assert.throws(
    () => selectManifestScopedFiles({
      manifest: {
        schema_version: "active_surface_manifest/v1",
        graph_families: [
          {
            id: "graphs",
            classification: "active_factory",
            include: ["factories/**/*.dot"],
          },
        ],
        runtime_surfaces: [
          {
            id: "runtime",
            classification: "execution_path_typo",
            include: ["apps/**/*.ts"],
          },
        ],
        command_surfaces: [
          {
            id: "commands",
            classification: "active_deterministic_owner",
            include: ["packages/factory-ops/src/commands/**/*.mjs"],
          },
        ],
      },
      files: ["apps/hatch/src/pipeline/engine.ts"],
      surfaceType: "runtime",
      classifications: ["execution_path"],
    }),
    /Invalid active-surface manifest/,
  );
});
