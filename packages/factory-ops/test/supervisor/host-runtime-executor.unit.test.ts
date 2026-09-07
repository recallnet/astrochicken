import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { executeHostRuntimeDecisions } from "../../src/lib/host-runtime-executor.ts";

function writeRegistry(root, rows = []) {
  const registryPath = path.join(root, "factory-registry.json");
  writeFileSync(registryPath, `${JSON.stringify({
    schema: "hatch.factory.registry.v1",
    instances: rows,
  }, null, 2)}\n`);
  return registryPath;
}

test("executeHostRuntimeDecisions resolves managed factory root and control plane repo for shared graphs", async () => {
  const hostBaseDir = mkdtempSync(path.join(tmpdir(), "host-runtime-executor-"));
  const repoRoot = mkdtempSync(path.join(tmpdir(), "host-runtime-executor-repo-"));
  const runtimeLogDir = path.join(hostBaseDir, "runtime", "logs");
  mkdirSync(runtimeLogDir, { recursive: true });

  const installationRoot = path.join(hostBaseDir, "example-trading");
  mkdirSync(installationRoot, { recursive: true });
  const installationManifestPath = path.join(installationRoot, "installation.json");
  writeFileSync(installationManifestPath, `${JSON.stringify({
    installation_id: "inst_example_trading_devrel",
    instance_id: "example-trading",
    manifest_path: installationManifestPath,
    workspace_mode: "api_only",
    work_dir: null,
  }, null, 2)}\n`);

  writeRegistry(hostBaseDir, [
    {
      instance_id: "example-trading",
      kind_id: "example-trading",
      target_repo: "example-org/example-trading",
      control_plane_repo: "recallnet/astrochicken",
      installation_manifest_path: installationManifestPath,
      graphs: [
        { id: "factory_supervisor_tick", path: "packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs" },
      ],
    },
  ]);

  const runtimeCalls = [];
  const out = await executeHostRuntimeDecisions({
    decisions: [{ installation_id: "inst_example_trading_devrel", instance_id: "example-trading", decision: "scheduled" }],
    installations: [{
      installation_id: "inst_example_trading_devrel",
      instance_id: "example-trading",
      manifest_path: installationManifestPath,
      workspace_mode: "api_only",
      work_dir: null,
    }],
    paths: {
      repoRoot,
      runtimeLogDir,
      baseDir: hostBaseDir,
    },
    env: {
      ...process.env,
      HATCH_FACTORY_REGISTRY_PATH: path.join(hostBaseDir, "factory-registry.json"),
      HATCH_FACTORY_REGISTRY_CWD: hostBaseDir,
    },
    runTickFn: async ({ runtime }) => {
      runtimeCalls.push(runtime);
      return {
        runId: "run_example_trading_01",
        tickId: "tick_example_trading_01",
        exitCode: 0,
        tickIdle: false,
        durationMs: 10,
        tickLogPath: path.join(runtimeLogDir, "tick_example_trading_01.log"),
      };
    },
  });

  assert.equal(out.results.length, 1);
  assert.equal(runtimeCalls.length, 1);
  assert.equal(runtimeCalls[0].factoryId, "example-trading");
  assert.equal(runtimeCalls[0].factoryRoot, path.join(repoRoot, "factories", "example-trading"));
  assert.equal(runtimeCalls[0].factoryConfigPath, path.join(repoRoot, "factories", "example-trading", "factory.config.json"));
  assert.equal(runtimeCalls[0].controlPlaneRepo, "recallnet/astrochicken");
  assert.equal(runtimeCalls[0].targetRepo, "example-org/example-trading");
});
