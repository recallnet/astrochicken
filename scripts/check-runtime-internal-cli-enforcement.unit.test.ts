import assert from "node:assert/strict";
import test from "node:test";

import { analyzeRuntimeInternalCliEnforcement } from "./check-runtime-internal-cli-enforcement.ts";

test("runtime internal CLI enforcement ignores operator-only manifest surfaces", () => {
  const result = analyzeRuntimeInternalCliEnforcement({
    files: ["packages/factory-ops/src/commands/goal-run.mjs"],
    manifest: {
      schema_version: "active_surface_manifest/v1",
      graph_families: [
        {
          id: "active_graphs",
          classification: "active_factory",
          include: ["factories/**/*.dot"],
        },
      ],
      runtime_surfaces: [
        {
          id: "operator_runtime",
          classification: "operator_only",
          include: ["packages/factory-ops/src/commands/**/*.mjs"],
        },
      ],
      command_surfaces: [
        {
          id: "owner_commands",
          classification: "active_deterministic_owner",
          include: ["packages/factory-ops/src/commands/goal-run.mjs"],
        },
      ],
    },
    readFile() {
      return 'spawnSync("node", ["packages/factory-ops/src/cli.ts"]);';
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.checked, 0);
  assert.deepEqual(result.violations, []);
});

test("runtime internal CLI enforcement fails manifest-scoped execution-path self-shelling", () => {
  const result = analyzeRuntimeInternalCliEnforcement({
    files: ["apps/hatch/src/pipeline/engine.ts"],
    manifest: {
      schema_version: "active_surface_manifest/v1",
      graph_families: [
        {
          id: "active_graphs",
          classification: "active_factory",
          include: ["factories/**/*.dot"],
        },
      ],
      runtime_surfaces: [
        {
          id: "execution_runtime",
          classification: "execution_path",
          include: ["apps/hatch/src/pipeline/**/*.ts"],
        },
      ],
      command_surfaces: [
        {
          id: "owner_commands",
          classification: "active_deterministic_owner",
          include: ["packages/factory-ops/src/commands/release-build-report-context.ts"],
        },
      ],
    },
    readFile() {
      return 'spawnSync("node", ["packages/factory-ops/src/cli.ts", "release", "post-to-slack"]);';
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.checked, 1);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].file, "apps/hatch/src/pipeline/engine.ts");
});

test("runtime internal CLI enforcement checks factory-ops runtime libraries when manifest classifies them as execution-path", () => {
  const result = analyzeRuntimeInternalCliEnforcement({
    files: ["packages/factory-ops/src/lib/analysis/collect-supervisor-status.ts"],
    manifest: {
      schema_version: "active_surface_manifest/v1",
      graph_families: [
        {
          id: "active_graphs",
          classification: "active_factory",
          include: ["factories/**/*.dot"],
        },
      ],
      runtime_surfaces: [
        {
          id: "factory_ops_runtime_lib",
          classification: "execution_path",
          include: ["packages/factory-ops/src/lib/**/*.mjs"],
        },
      ],
      command_surfaces: [
        {
          id: "owner_commands",
          classification: "active_deterministic_owner",
          include: ["packages/factory-ops/src/commands/factory-status.ts"],
        },
      ],
    },
    readFile() {
      return 'spawnSync("node", ["packages/factory-ops/src/cli.ts", "factory", "status"]);';
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.checked, 1);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].file, "packages/factory-ops/src/lib/analysis/collect-supervisor-status.ts");
});
