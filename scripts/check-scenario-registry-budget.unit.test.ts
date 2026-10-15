import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkScenarioRegistryBudget } from "./check-scenario-registry-budget.ts";

const scriptPath = resolve(fileURLToPath(new URL("./check-scenario-registry-budget.ts", import.meta.url)));

function writeScenario(root, relativeDir, scenarioId) {
  const dir = join(root, relativeDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SCENARIO.md"),
    `---\nid: ${scenarioId}\ndomain: post-merge\npriority: medium\ncreated: 2026-03-15\n---\n\nTruth.\n`,
    "utf8",
  );
}

function writeConfig(path, payload) {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

test("checkScenarioRegistryBudget passes when total is within limit", () => {
  const fixture = mkdtempSync(join(tmpdir(), "scenario-registry-budget-"));
  const rootA = join(fixture, "registry-a");
  const rootB = join(fixture, "registry-b");
  const configPath = join(fixture, "scenario-registry.json");

  writeScenario(rootA, "astrochicken/post-merge/core", "core");
  writeScenario(rootB, "astrochicken/post-merge/safety", "safety");

  writeConfig(configPath, {
    maxScenarios: 2,
    roots: [rootA, rootB],
  });

  const result = checkScenarioRegistryBudget({ configPath });
  assert.equal(result.ok, true);
  assert.equal(result.total_scenarios, 2);
  assert.equal(result.max_scenarios, 2);
  assert.equal(result.error, "");
  assert.deepEqual(result.roots.map((entry) => entry.count), [1, 1]);
});

test("checkScenarioRegistryBudget fails closed when total exceeds limit", () => {
  const fixture = mkdtempSync(join(tmpdir(), "scenario-registry-budget-"));
  const rootA = join(fixture, "registry-a");
  const configPath = join(fixture, "scenario-registry.json");

  writeScenario(rootA, "astrochicken/post-merge/core", "core");
  writeScenario(rootA, "astrochicken/post-merge/safety", "safety");

  writeConfig(configPath, {
    maxScenarios: 1,
    roots: [rootA],
  });

  const result = checkScenarioRegistryBudget({ configPath });
  assert.equal(result.ok, false);
  assert.equal(result.total_scenarios, 2);
  assert.equal(result.max_scenarios, 1);
  assert.match(result.error, /exceeds configured ceiling/);
});

test("CLI prints Scenario count machine-readable line and exits 1 on budget violation", () => {
  const fixture = mkdtempSync(join(tmpdir(), "scenario-registry-budget-"));
  const rootA = join(fixture, "registry-a");
  const configPath = join(fixture, "scenario-registry.json");

  writeScenario(rootA, "astrochicken/post-merge/core", "core");
  writeScenario(rootA, "astrochicken/post-merge/safety", "safety");

  writeConfig(configPath, {
    maxScenarios: 1,
    roots: [rootA],
  });

  const run = spawnSync("node", [scriptPath, "--config", configPath], { encoding: "utf8" });
  const output = `${run.stdout}${run.stderr}`;

  assert.equal(run.status, 1, output);
  assert.match(output, /Scenario count: 2 \/ limit 1/);
  assert.match(output, /\[scenario_registry_budget\] result=fail total=2 max=1/);
});
