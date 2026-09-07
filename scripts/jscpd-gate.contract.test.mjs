import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { GATE_MANIFEST } from "./lib/gate-manifest.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

const packageJsonPath = join(repoRoot, "package.json");
const prodConfigPath = join(repoRoot, ".jscpd.json");
const testConfigPath = join(repoRoot, ".jscpd.tests.json");
const workflowPath = join(repoRoot, ".github", "workflows", "pre-merge-quality.yml");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const prodConfig = JSON.parse(readFileSync(prodConfigPath, "utf8"));
const testConfig = JSON.parse(readFileSync(testConfigPath, "utf8"));

const REQUIRED_FIXTURE_IGNORES = [
  "scripts/test/fixtures/**",
  "scripts/fixtures/**",
  "packages/**/test/fixtures/**",
];

const REQUIRED_FIXTURE_IGNORE_VARIANTS = [
  ...REQUIRED_FIXTURE_IGNORES,
  "**/scripts/test/fixtures/**",
  "**/scripts/fixtures/**",
  "**/packages/**/test/fixtures/**",
];

function expectArrayContainsAll(actual, expected, label) {
  for (const entry of expected) {
    assert.equal(
      actual.includes(entry),
      true,
      `${label} missing required entry: ${entry}`,
    );
  }
}

test("cpd scripts contract is present in package.json", () => {
  const scripts = packageJson.scripts ?? {};

  assert.equal(scripts.cpd, "jscpd --config .jscpd.json");
  assert.equal(scripts["cpd:tests"], "jscpd --config .jscpd.tests.json");
  assert.equal(scripts["cpd:ci"], "pnpm --silent cpd && pnpm --silent cpd:tests");
  assert.equal(scripts["qa:pre-merge"], "node scripts/run-gates.mjs --profile full --all-tracked");
});

test("production jscpd config enforces required thresholds and test exclusions", () => {
  assert.equal(existsSync(prodConfigPath), true, ".jscpd.json must exist");

  assert.equal(prodConfig.threshold, 5);
  assert.equal(prodConfig.minLines, 10);
  assert.equal(prodConfig.minTokens, 100);

  assert.equal(Array.isArray(prodConfig.path), true);
  assert.equal(typeof prodConfig.pattern, "string");
  assert.equal(Array.isArray(prodConfig.ignore), true);

  expectArrayContainsAll(
    prodConfig.ignore,
    [
      "**/__tests__/**",
      "**/*.test.*",
      "**/*.spec.*",
      "packages/**/test/**",
      ...REQUIRED_FIXTURE_IGNORE_VARIANTS,
    ],
    "production ignore",
  );
});

test("test jscpd config enforces required thresholds and test-only scope", () => {
  assert.equal(existsSync(testConfigPath), true, ".jscpd.tests.json must exist");

  assert.equal(testConfig.threshold, 5);
  assert.equal(testConfig.minLines, 8);
  assert.equal(testConfig.minTokens, 50);

  assert.equal(Array.isArray(testConfig.path), true);
  assert.equal(typeof testConfig.pattern, "string");
  assert.equal(Array.isArray(testConfig.ignore), true);

  assert.equal(testConfig.pattern.includes("__tests__"), true);
  assert.equal(testConfig.pattern.includes("test/**/*"), true);
  assert.equal(testConfig.pattern.includes(".test"), true);

  expectArrayContainsAll(testConfig.ignore, REQUIRED_FIXTURE_IGNORE_VARIANTS, "test ignore");

  assert.notEqual(testConfig.pattern, prodConfig.pattern, "test scope must differ from production scope");
});

test("duplication gate is wired to full profile and excluded from fast profile", () => {
  const duplicationGate = GATE_MANIFEST.find((gate) => gate.id === "duplication_scan");
  const deadCodeGate = GATE_MANIFEST.find((gate) => gate.id === "dead_code");

  assert.ok(duplicationGate, "Expected duplication_scan in GATE_MANIFEST");
  assert.equal(duplicationGate.phase, "quality");
  assert.equal(duplicationGate.command, "pnpm");
  assert.deepEqual(duplicationGate.args, ["--silent", "cpd:ci"]);
  assert.equal(duplicationGate.profiles.includes("full"), true);
  assert.equal(duplicationGate.profiles.includes("fast"), false);

  assert.ok(deadCodeGate, "Expected dead_code in GATE_MANIFEST");
  assert.equal(deadCodeGate.phase, "quality");
  assert.equal(deadCodeGate.command, "pnpm");
  assert.deepEqual(deadCodeGate.args, ["--silent", "knip"]);
  assert.equal(deadCodeGate.profiles.includes("fast"), true);
  assert.equal(deadCodeGate.profiles.includes("full"), true);
});

test("pre-merge workflow remains transitive via qa:pre-merge", () => {
  const workflow = readFileSync(workflowPath, "utf8");

  assert.match(workflow, /pnpm --silent qa:pre-merge/);
  assert.doesNotMatch(workflow, /pnpm --silent cpd:ci/);
  assert.doesNotMatch(workflow, /jscpd/);
});
