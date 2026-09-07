import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  analyzeTestClassification,
  findStaleBaselineEntries,
  isExplicitlyClassifiedTest,
  isLegacyGenericTest,
} from "./check-test-classification.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..");
const scriptPath = join(repoRoot, "scripts", "check-test-classification.mjs");

function write(root, relativePath, content) {
  const absolute = join(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  return absolute;
}

test("classification helpers distinguish explicit and legacy test names", () => {
  assert.equal(isExplicitlyClassifiedTest("packages/factory-ops/test/wave.cli.test.mjs"), true);
  assert.equal(isExplicitlyClassifiedTest("packages/factory-ops/test/wave.test.mjs"), false);
  assert.equal(isLegacyGenericTest("packages/factory-ops/test/wave.test.mjs"), true);
  assert.equal(isLegacyGenericTest("packages/factory-ops/test/wave.contract.test.mjs"), false);
  assert.equal(isExplicitlyClassifiedTest("apps/hatch/src/pipeline/regressions/run-stale-heartbeat-requeue.regression.test.ts"), true);
  assert.equal(isLegacyGenericTest("apps/hatch/src/pipeline/regressions/run-stale-heartbeat-requeue.regression.test.ts"), false);
});

test("analyzeTestClassification ignores legacy test names already tracked in baseline", () => {
  const file = "packages/factory-ops/test/existing.test.mjs";
  const out = analyzeTestClassification({
    files: [file],
    baseline: {
      schema: "test_classification_baseline/v1",
      legacy_test_files: [file],
    },
  });
  assert.equal(out.violations.length, 0);
});

test("analyzeTestClassification flags newly added generic test names", () => {
  const file = "packages/factory-ops/test/new-behavior.test.mjs";
  const out = analyzeTestClassification({
    files: [file],
    baseline: {
      schema: "test_classification_baseline/v1",
      legacy_test_files: [],
    },
  });
  assert.deepEqual(out.violations, [
    {
      file,
      reason:
        "new test file must declare a class suffix: .unit.test.*, .cli.test.*, .integration.test.*, .contract.test.*, or .regression.test.*",
    },
  ]);
});

test("findStaleBaselineEntries reports legacy debt that has been removed", () => {
  const stale = findStaleBaselineEntries({
    baseline: {
      schema: "test_classification_baseline/v1",
      legacy_test_files: [
        "packages/factory-ops/test/old.test.mjs",
        "packages/factory-ops/test/current.test.mjs",
      ],
    },
    trackedFiles: ["packages/factory-ops/test/current.test.mjs"],
  });
  assert.deepEqual(stale, ["packages/factory-ops/test/old.test.mjs"]);
});

test("CLI exits non-zero when a staged generic test name is not in baseline", () => {
  const root = mkdtempSync(join(tmpdir(), "test-classification-cli-"));
  const badTest = write(root, "packages/factory-ops/test/bad.test.mjs", 'import test from "node:test";\n');
  const stagedPathFile = write(root, "staged.txt", `${badTest}\0`);
  const baselinePath = write(
    root,
    "baseline.json",
    JSON.stringify({
      schema: "test_classification_baseline/v1",
      legacy_test_files: [],
    }),
  );

  const run = spawnSync(
    "node",
    [scriptPath, "--staged-file-list", stagedPathFile, "--baseline", baselinePath],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 1, run.stderr || run.stdout);
  assert.match(run.stderr, /\[test-classification\] violation/);
  assert.match(run.stderr, /bad\.test\.mjs/);
});

test("CLI exits zero when staged generic test is covered by baseline", () => {
  const root = mkdtempSync(join(tmpdir(), "test-classification-cli-"));
  const existingTest = write(root, "packages/factory-ops/test/existing.test.mjs", 'import test from "node:test";\n');
  const stagedPathFile = write(root, "staged.txt", `${existingTest}\0`);
  const baselinePath = write(
    root,
    "baseline.json",
    JSON.stringify({
      schema: "test_classification_baseline/v1",
      legacy_test_files: [existingTest],
    }),
  );

  const run = spawnSync(
    "node",
    [scriptPath, "--staged-file-list", stagedPathFile, "--baseline", baselinePath],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /\[test-classification\] result=ok/);
});

test("CLI exits zero when staged file list includes a deleted (non-existent) generic test path", () => {
  const root = mkdtempSync(join(tmpdir(), "test-classification-deleted-"));
  // Simulate a deleted file: path does not exist on disk
  const deletedTestPath = join(root, "packages/factory-ops/test/deleted.test.mjs");
  const stagedPathFile = join(root, "staged.txt");
  const baselinePath = join(root, "baseline.json");
  writeFileSync(stagedPathFile, `${deletedTestPath}\0`);
  writeFileSync(baselinePath, JSON.stringify({ schema: "test_classification_baseline/v1", legacy_test_files: [] }));

  const run = spawnSync(
    "node",
    [scriptPath, "--staged-file-list", stagedPathFile, "--baseline", baselinePath],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /\[test-classification\] result=ok/);
});

test("CLI supports whole-repo classification checks via --all-tracked", () => {
  const run = spawnSync("node", [scriptPath, "--all-tracked"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /\[test-classification\] result=ok/);
});
