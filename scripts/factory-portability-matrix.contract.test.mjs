import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  PORTABILITY_CONTEXTS,
  resolvePortabilityMatrix,
} from "./lib/factory-portability-matrix.ts";
import { resolveGhRepo } from "../packages/factory-ops/src/commands/common-resolve-gh-repo.ts";
import { resolveJudgeScenarioSelectionBasis } from "../packages/factory-ops/src/commands/judge-context-contract.ts";
import { buildStateSnapshot } from "../packages/factory-ops/src/commands/supervisor-state-snapshot.ts";
import { resolveFactoryContext } from "../packages/factory-ops/src/lib/factory-context-resolver.ts";

function normalizePath(value) {
  return String(value || "")
    .replace(/^\/private\//, "/")
    .replace(/\\/g, "/");
}

test("portability matrix is deterministic and constrained to mothership + one external fixture", () => {
  assert.equal(PORTABILITY_CONTEXTS.length, 3);
  assert.deepEqual(
    PORTABILITY_CONTEXTS.map((entry) => entry.id),
    ["mothership", "example-trading", "external_fixture"],
  );
});

test("hatch runtime keeps factory-scoped runs at .hatch/<factory_id>/runs", () => {
  const hatchRunSource = readFileSync("apps/hatch/src/pipeline/run.ts", "utf8");
  assert.match(hatchRunSource, /resolve\(process\.cwd\(\), "\.hatch", factoryId, "runs"\)/);
});

test("factory portability matrix enforces shared contracts across contexts", () => {
  const matrix = resolvePortabilityMatrix();
  const observedRunsDirs = new Set();

  for (const entry of matrix) {
    const resolvedRepo = resolveGhRepo("", {
      cwd: process.cwd(),
      factoryConfigPath: entry.factoryConfigPath,
    });
    assert.equal(resolvedRepo, entry.targetRepo);

    const context = resolveFactoryContext({
      cwd: process.cwd(),
      factoryConfigPath: entry.factoryConfigPath,
      requireTargetRepo: true,
    });

    assert.equal(context.factory_id, entry.factoryId);
    assert.equal(context.target_repo, entry.targetRepo);
    assert.equal(context.control_plane_repo, entry.controlPlaneRepo);
    assert.equal(normalizePath(context.runs_dir), normalizePath(entry.runsDirExpected));
    assert.equal(normalizePath(context.scenarios_root), normalizePath(entry.scenariosRoot));
    assert.equal(normalizePath(entry.configuredScenarioRoot), normalizePath(entry.scenariosRoot));

    observedRunsDirs.add(normalizePath(context.runs_dir));

    assert.equal(existsSync(entry.skillSupervisorPath), true, `${entry.id}: skill path missing`);
    assert.equal(existsSync(entry.scenarioSelectorRootPath), true, `${entry.id}: scenario selector root missing`);

    const scenarioBasis = resolveJudgeScenarioSelectionBasis({
      scenarioSelector: entry.scenarioSelector,
      scenarioRegistryRoot: entry.scenariosRoot,
    });

    assert.equal(scenarioBasis.ok, true, `${entry.id}: scenario selector should resolve`);
    assert.equal(scenarioBasis.code, "ok");
    assert.equal(normalizePath(scenarioBasis.registry_root), normalizePath(entry.scenariosRoot));
    assert.deepEqual(scenarioBasis.selector_paths, [entry.scenarioSelector]);
    assert.equal(Array.isArray(scenarioBasis.scenario_paths), true);
    assert.equal(scenarioBasis.scenario_paths.length > 0, true, `${entry.id}: expected at least one selected scenario`);
    for (const scenarioPath of scenarioBasis.scenario_paths) {
      assert.equal(
        String(scenarioPath).startsWith(`${entry.scenarioSelector}/`),
        true,
        `${entry.id}: scenario path should stay scoped to selector`,
      );
    }

    const snapshot = JSON.parse(buildStateSnapshot({
      repo: entry.targetRepo,
      factoryId: entry.factoryId,
      targetRepo: entry.targetRepo,
      controlPlaneRepo: entry.controlPlaneRepo,
      factoryRoot: entry.factoryRoot,
      factoryConfigPath: entry.factoryConfigPath,
      ghJsonFn: () => [],
      recoverySweepFn: () => ({ stale_runs: [] }),
      scanCliCrashesFn: () => [],
      runsDir: entry.runsDirExpected,
    }));

    assert.equal(snapshot.factory_id, entry.factoryId);
    assert.equal(snapshot.target_repo, entry.targetRepo);
    assert.equal(snapshot.control_plane_repo, entry.controlPlaneRepo);
    assert.equal(snapshot.context_scope?.factory_id, entry.factoryId);
    assert.equal(snapshot.context_scope?.target_repo, entry.targetRepo);
    assert.equal(snapshot.context_scope?.control_plane_repo, entry.controlPlaneRepo);
    assert.equal(snapshot.judge_context_scope_identity, entry.telemetry.benchmark_identity);

    assert.equal(entry.telemetry.factory_id, entry.factoryId);
    assert.equal(entry.telemetry.factory_tags.includes(`factory:${entry.factoryId}`), true);
    assert.equal(entry.telemetry.factory_tags.includes(`target_repo:${entry.targetRepo}`), true);
    assert.equal(entry.telemetry.factory_tags.includes(`control_plane_repo:${entry.controlPlaneRepo}`), true);
    assert.equal(entry.targetOwner.length > 0, true, `${entry.id}: target owner missing`);
    assert.equal(entry.controlPlaneOwner.length > 0, true, `${entry.id}: control-plane owner missing`);
  }

  assert.equal(observedRunsDirs.size, matrix.length, "runs_dir must stay isolated per factory_id");
});

test("telemetry identity/tag fields remain wired for portability contexts", () => {
  const universalMetadataSource = readFileSync("packages/factory-telemetry/src/telemetry/universal-metadata.ts", "utf8");
  const langfuseSource = readFileSync("packages/factory-telemetry/src/langfuse.ts", "utf8");

  assert.match(universalMetadataSource, /"hatch\.tag\.factory"/);
  assert.match(universalMetadataSource, /"hatch\.tag\.factory_id"/);
  assert.match(universalMetadataSource, /"hatch\.repo"/);

  assert.match(langfuseSource, /"factory_id"/);
  assert.match(langfuseSource, /"hatch\.tag\.factory"/);
  assert.match(langfuseSource, /"hatch\.tag\.factory_id"/);
});
