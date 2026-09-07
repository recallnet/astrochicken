import assert from "node:assert/strict";
import test from "node:test";

import {
  FACTORY_LABEL_CATEGORIES,
  globalFactoryLabelRegistry,
  findFactoryLabelByName,
  defaultAllowedFactoryLabelNames,
  waveReadyFactoryLabelNames,
} from "../../src/lib/factory-label-registry.ts";
import { mothershipFactoryLabelRegistry } from "../../src/lib/mothership-label-overlay.ts";

test("globalFactoryLabelRegistry entries are unique, typed, and metadata complete", () => {
  const categorySet = new Set(FACTORY_LABEL_CATEGORIES);
  const names = new Set();

  for (const entry of globalFactoryLabelRegistry) {
    assert.equal(typeof entry.name, "string");
    assert.ok(entry.name.length > 0, "label name must be non-empty");
    assert.equal(names.has(entry.name), false, `duplicate label name: ${entry.name}`);
    names.add(entry.name);

    assert.equal(typeof entry.description, "string");
    assert.ok(entry.description.length > 0, `description must be non-empty for ${entry.name}`);

    assert.equal(typeof entry.color, "string");
    assert.match(entry.color, /^[0-9a-f]{6}$/i, `color must be 6-char hex for ${entry.name}`);

    assert.ok(categorySet.has(entry.category), `invalid category ${entry.category} for ${entry.name}`);
  }
});

test("defaultAllowedFactoryLabelNames matches registry include_by_default labels", () => {
  const expected = globalFactoryLabelRegistry
    .filter((entry) => entry.include_by_default)
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const actual = defaultAllowedFactoryLabelNames().sort((a, b) => a.localeCompare(b));
  assert.deepEqual(actual, expected);
});

test("findFactoryLabelByName resolves known labels and returns null for unknown", () => {
  const goalLabel = findFactoryLabelByName("goal");
  assert.equal(goalLabel?.name, "goal");
  assert.equal(goalLabel?.category, "type");

  assert.equal(findFactoryLabelByName("does-not-exist"), null);
});

test("waveReadyFactoryLabelNames is subset of defaultAllowed labels and includes core wave labels", () => {
  const registry = mothershipFactoryLabelRegistry();
  const waveReady = waveReadyFactoryLabelNames(registry);
  const allowed = new Set(defaultAllowedFactoryLabelNames(registry));

  for (const name of waveReady) {
    assert.equal(allowed.has(name), true, `${name} must be in default allowed labels`);
  }

  assert.equal(waveReady.includes("ready"), true);
  assert.equal(waveReady.includes("wave-in-progress"), true);
  assert.equal(waveReady.includes("quarantined"), true);

  for (const name of ["ready", "wave-in-progress", "quarantined"]) {
    const entry = findFactoryLabelByName(name, registry);
    assert.equal(typeof entry?.description, "string");
    assert.ok((entry?.description || "").length > 0, `${name} must have description`);
    assert.match(String(entry?.color || ""), /^[0-9a-f]{6}$/i, `${name} must have 6-char hex color`);
  }
});

test("registry covers historical default label names", () => {
  const historicalDefaultLabels = [
    "goal",
    "feature",
    "bug",
    "ready",
    "wave-in-progress",
    "triaged",
    "duplicate",
    "priorities",
    "artifacts",
    "telemetry",
    "quarantined",
    "deferred",
    "factory-tracking",
    "process",
  ];

  const allowed = new Set(defaultAllowedFactoryLabelNames(mothershipFactoryLabelRegistry()));
  for (const label of historicalDefaultLabels) {
    assert.equal(allowed.has(label), true, `missing historical default label ${label}`);
  }
});
