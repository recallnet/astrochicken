import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { analyzeFactoryCompositionContract, writeFactoryCompositionOutputs } from "./lib/factory-composition-contract.ts";

test("factory composition registry passes for governed factories", async () => {
  const result = await analyzeFactoryCompositionContract();
  assert.equal(result.ok, true);
  assert.ok(result.report.summary.registered_factories > 0);
  assert.deepEqual(result.report.diagnostics, []);
});

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function seedThinCompositionRepo(root, { graphs, extraFiles = [], configOverrides = {}, writePolicyPack = true, activeSurfaceManifest = null }) {
  mkdirSync(join(root, "factories", "demo", "graphs"), { recursive: true });
  mkdirSync(join(root, "factories", "demo", "inventory"), { recursive: true });
  mkdirSync(join(root, "docs", "contracts"), { recursive: true });
  writeFileSync(join(root, "factories", "demo", "README.md"), "# Demo\n");
  if (writePolicyPack) {
    mkdirSync(join(root, "factories", "demo", "policy-pack", "v1"), { recursive: true });
    writeFileSync(join(root, "factories", "demo", "policy-pack", "v1", "metadata.json"), "{}\n");
  }
  writeJson(join(root, "factories", "demo", "factory.config.json"), {
    factory_id: "demo",
    instance_id: "demo",
    target_repo: "example-org/demo",
    control_plane_repo: "recallnet/astrochicken",
    runs_dir: ".hatch/demo/runs",
    trust: { domain: "demo.local", roles: ["demo.local.tool"] },
    dispatch: { graph: "factories/demo/graphs/factory_supervisor_tick.dot" },
    pipeline: { supervisor_tick: "factories/demo/graphs/factory_supervisor_tick.dot" },
    schedules: { jobs: [] },
    conformance: {},
    ...(writePolicyPack ? { policyPack: { version: "v1", overrides: {} } } : {}),
    ...configOverrides,
  });
  writeJson(join(root, "factory-registry.json"), {
    factories: [{ id: "demo", graphs }],
  });
  writeJson(
    join(root, "docs", "contracts", "active-surface-manifest.json"),
    activeSurfaceManifest || {
      schema_version: "active_surface_manifest/v1",
      graph_families: [
        {
          id: "factory_graphs_active",
          classification: "active_factory",
          include: ["factories/demo/graphs/*.dot"],
        },
        {
          id: "capability_graphs_active",
          classification: "active_runtime",
          include: ["packages/capability-demo/graphs/placeholder.dot"],
        },
      ],
      runtime_surfaces: [
        {
          id: "shared_runtime_execution",
          classification: "execution_path",
          include: ["packages/**/*.mjs"],
        },
      ],
      command_surfaces: [
        {
          id: "factory_ops_active_owner_commands",
          classification: "active_deterministic_owner",
          include: ["packages/factory-ops/src/commands/demo-owner.mjs"],
        },
      ],
    },
  );
  for (const graph of graphs) {
    const fullPath = join(root, graph.path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, `digraph ${graph.id} { start -> done }\n`);
  }
  for (const extraFile of extraFiles) {
    mkdirSync(dirname(extraFile), { recursive: true });
    writeFileSync(extraFile, "\n");
  }
}

test("factory composition contract fails closed on any extra thin-composition factory execution graph", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "factory-composition-private-glue-"));
  seedThinCompositionRepo(repoRoot, {
    graphs: [
      { id: "factory_supervisor_tick", path: "factories/demo/graphs/factory_supervisor_tick.dot" },
      { id: "custom_execute", path: "factories/demo/graphs/custom_execute.dot" },
    ],
  });

  const result = await analyzeFactoryCompositionContract({ repoRoot });
  assert.equal(result.ok, false);
  assert.match(result.report.diagnostics.join("\n"), /factory_composition_private_execution_glue/);
  assert.match(result.report.diagnostics.join("\n"), /custom_execute\.dot/);
});

test("factory composition contract requires shared package graphs to resolve to governed capability surfaces", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "factory-composition-governed-shared-"));
  seedThinCompositionRepo(repoRoot, {
    graphs: [
      { id: "factory_supervisor_tick", path: "factories/demo/graphs/factory_supervisor_tick.dot" },
      { id: "shared_custom", path: "packages/shared-runtime/graphs/shared_custom.dot" },
    ],
  });

  const result = await analyzeFactoryCompositionContract({ repoRoot });
  assert.equal(result.ok, false);
  assert.match(result.report.diagnostics.join("\n"), /factory_composition_ungoverned_shared_graph/);
  assert.match(result.report.diagnostics.join("\n"), /packages\/shared-runtime\/graphs\/shared_custom\.dot/);
});

test("factory composition contract accepts governed shared runtime graphs and config-only managed factories", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "factory-composition-managed-runtime-"));
  seedThinCompositionRepo(repoRoot, {
    graphs: [
      { id: "factory_supervisor_tick", path: "packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs" },
      { id: "managed_domain", path: "packages/factory-runtime/graphs/managed_domain.dot" },
    ],
    writePolicyPack: false,
    configOverrides: {
      managed: true,
      dispatch: { graph: "packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs" },
      pipeline: { supervisor_tick: "packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs" },
    },
    activeSurfaceManifest: {
      schema_version: "active_surface_manifest/v1",
      graph_families: [
        {
          id: "factory_graphs_active",
          classification: "active_factory",
          include: ["factories/demo/graphs/*.dot"],
        },
        {
          id: "capability_graphs_active",
          classification: "active_runtime",
          include: [
            "packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs",
            "packages/factory-runtime/graphs/managed_domain.dot",
          ],
        },
      ],
      runtime_surfaces: [
        {
          id: "shared_runtime_execution",
          classification: "execution_path",
          include: ["packages/**/*.mjs"],
        },
      ],
      command_surfaces: [
        {
          id: "factory_ops_active_owner_commands",
          classification: "active_deterministic_owner",
          include: ["packages/factory-ops/src/commands/demo-owner.mjs"],
        },
      ],
    },
  });

  await writeFactoryCompositionOutputs({ repoRoot });
  const result = await analyzeFactoryCompositionContract({ repoRoot });
  assert.equal(result.ok, true);
  assert.deepEqual(result.report.diagnostics, []);
});
