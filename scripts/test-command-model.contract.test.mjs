import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { GATE_MANIFEST } from "./lib/gate-manifest.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const packageJsonPath = join(repoRoot, "package.json");
const repoManifestPath = join(repoRoot, "config", "testing", "repo-test-manifests", "default.json");
const preCommitDocsPath = join(repoRoot, "docs", "architecture", "pre-commit-gates.md");
const hatchManifestPath = join(repoRoot, "config", "testing", "package-test-manifests", "apps-hatch.json");
const factoryOpsManifestPath = join(repoRoot, "config", "testing", "package-test-manifests", "packages-factory-ops.json");

test("root scripts expose fast local tests and strict proof as distinct commands", () => {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const scripts = packageJson.scripts ?? {};

  assert.equal(scripts.test, "node scripts/run-fast-tests.mjs");
  assert.equal(scripts["test:packages"], "turbo run test --output-logs=errors-only");
  assert.equal(
    scripts["test:repo"],
    "node scripts/run-repo-test-manifest.mjs --repo-root . --manifest config/testing/repo-test-manifests/default.json --suite default",
  );
  assert.equal(scripts["test:strict"], "node scripts/run-gates.mjs --profile strict --all-tracked");
  assert.equal(scripts["qa:strict"], "node scripts/run-gates.mjs --profile strict --all-tracked");
  assert.equal(scripts["qa:pre-merge"], "node scripts/run-gates.mjs --profile full --all-tracked");
  assert.equal(scripts["test:pre-commit-gates"], undefined);
});

test("repo default test manifest is the owned inventory for repo contract tests", () => {
  const manifest = JSON.parse(readFileSync(repoManifestPath, "utf8"));

  assert.equal(manifest.schema, "hatch.repo-test-manifest.v1");
  assert.equal(manifest.repo_name, "astrochicken");
  assert.equal(manifest.default_suite, "default");
  assert.deepEqual(manifest.suites.map((suite) => suite.name), ["default"]);
  assert.equal(manifest.suites[0].entrypoints.includes("scripts"), true);
  assert.equal(manifest.suites[0].entrypoints.includes("package.json"), true);
});

test("pre-commit docs describe test as fast local signal and test:strict as commit-equivalent proof", () => {
  const docs = readFileSync(preCommitDocsPath, "utf8");

  assert.match(docs, /`pnpm test` is the fast local verification path/);
  assert.match(docs, /`pnpm test:strict` runs the exact strict gate proof/);
  assert.doesNotMatch(docs, /SKIP_TESTS/);
});

test("pre-commit coverage suites are narrowed to their actual guard and wave-claim surfaces", () => {
  const hatchManifest = JSON.parse(readFileSync(hatchManifestPath, "utf8"));
  const factoryOpsManifest = JSON.parse(readFileSync(factoryOpsManifestPath, "utf8"));

  const guardSuite = hatchManifest.suites.find((suite) => suite.name === "guard-gates");
  assert.ok(guardSuite);
  assert.deepEqual(guardSuite.entrypoints, [
    "src/pipeline/engine-execution.unit.test.ts",
    "src/pipeline/guard-core.unit.test.ts",
    "src/pipeline/guard-eventbus.unit.test.ts",
    "src/pipeline/guard-recovery.unit.test.ts",
    "src/pipeline/guard-scope.unit.test.ts",
    "src/pipeline/runtime-path-guard.integration.test.ts",
  ]);
  assert.doesNotMatch(guardSuite.command, /src\/pipeline(?!\/engine-execution|\/guard-core|\/guard-eventbus|\/guard-recovery|\/guard-scope|\/runtime-path-guard)/);
  assert.match(guardSuite.command, /--coverage\.include=src\/pipeline\/engine-execution\.ts/);
  assert.match(guardSuite.command, /--coverage\.include=src\/pipeline\/guard\.ts/);
  assert.match(guardSuite.command, /--coverage\.include=src\/pipeline\/guard-core\.ts/);
  assert.match(guardSuite.command, /--coverage\.include=src\/pipeline\/guard-eventbus\.ts/);
  assert.match(guardSuite.command, /--coverage\.include=src\/pipeline\/guard-recovery\.ts/);
  assert.doesNotMatch(guardSuite.command, /--coverage\.include=src\/pipeline\/checkpoint\.ts/);
  assert.doesNotMatch(guardSuite.command, /--coverage\.include=src\/pipeline\/context\.ts/);
  assert.doesNotMatch(guardSuite.command, /--coverage\.include=src\/pipeline\/decision-artifacts\.ts/);
  assert.doesNotMatch(guardSuite.command, /--coverage\.include=src\/pipeline\/run\.ts/);

  const waveSuite = factoryOpsManifest.suites.find((suite) => suite.name === "wave-claim-gates");
  assert.ok(waveSuite);
  assert.equal(waveSuite.entrypoints.some((entry) => /\/test\/commands$|\/test\/wave$|\/test\/supervisor$/.test(entry)), false);
  assert.equal(waveSuite.entrypoints.every((entry) => entry.endsWith(".test.mjs")), true);
});

test("dist-backed platform quality families run only after build establishes fresh outputs", () => {
  const platformInvariants = GATE_MANIFEST.find((gate) => gate.id === "platform_invariants");
  const releaseQuality = GATE_MANIFEST.find((gate) => gate.id === "release_quality");

  assert.ok(platformInvariants);
  assert.ok(releaseQuality);
  assert.deepEqual(platformInvariants.dependsOn, ["build"]);
  assert.deepEqual(releaseQuality.dependsOn, ["build"]);
});
