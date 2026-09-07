import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { scenarioCountGate } from "../packages/factory-ops/src/commands/scenario-count-gate.ts";

function writeScenario(registryRoot, relPath, scenarioId) {
  const scenarioDir = join(registryRoot, relPath);
  mkdirSync(scenarioDir, { recursive: true });
  writeFileSync(
    join(scenarioDir, "SCENARIO.md"),
    `---\nid: ${scenarioId}\ndomain: post-merge\npriority: medium\ncreated: 2026-03-15\n---\n\nTruth.\n`,
    "utf8",
  );
}

test("scenarioCountGate passes when scenario count is at or below ceiling", () => {
  const registry = mkdtempSync(join(tmpdir(), "scenario-count-gate-"));
  writeScenario(registry, "astrochicken/post-merge/core", "core");
  writeScenario(registry, "astrochicken/post-merge/safety", "safety");

  const out = scenarioCountGate({ registryRoot: registry, maxCount: "2" });
  assert.equal(out.ok, true);
  assert.equal(out.scenario_count, "2");
  assert.equal(out.max_count, "2");
});

test("scenarioCountGate fails closed when scenario count exceeds ceiling", () => {
  const registry = mkdtempSync(join(tmpdir(), "scenario-count-gate-"));
  writeScenario(registry, "astrochicken/post-merge/core", "core");
  writeScenario(registry, "astrochicken/post-merge/safety", "safety");

  const out = scenarioCountGate({ registryRoot: registry, maxCount: "1" });
  assert.equal(out.ok, false);
  assert.match(out.error, /exceeds configured ceiling/);
  assert.equal(out.scenario_count, "2");
  assert.equal(out.max_count, "1");
});
