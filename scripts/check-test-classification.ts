#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const DEFAULT_BASELINE_PATH = "scripts/test-classification-baseline.json";
const CLASSIFIED_TEST_PATTERN =
  /\.(?:contract|unit|cli|integration|regression|regressions)\.test\.(?:mjs|cjs|js|mts|cts|ts|tsx)$/;
const TEST_FILE_PATTERN = /\.test\.(?:mjs|cjs|js|mts|cts|ts|tsx)$/;

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function readStagedPaths(path) {
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\0")
    .filter(Boolean)
    .filter((f) => existsSync(f));
}

export function isTestFile(path = "") {
  return TEST_FILE_PATTERN.test(path);
}

export function isExplicitlyClassifiedTest(path = "") {
  return CLASSIFIED_TEST_PATTERN.test(path);
}

export function isLegacyGenericTest(path = "") {
  return isTestFile(path) && !isExplicitlyClassifiedTest(path);
}

export function loadBaseline(path = DEFAULT_BASELINE_PATH) {
  if (!existsSync(path)) {
    return { schema: "test_classification_baseline/v1", legacy_test_files: [] };
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export function collectTrackedTestFiles({ cwd = process.cwd() } = {}) {
  const run = spawnSync("git", ["ls-files", "-z"], {
    cwd,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    throw new Error(`git ls-files failed: ${String(run.stderr || run.stdout || "unknown_error")}`);
  }
  return String(run.stdout || "")
    .split("\0")
    .filter(Boolean)
    .filter((file) => isTestFile(file));
}

export function analyzeTestClassification({ files = [], baseline = loadBaseline() } = {}) {
  const baselineSet = new Set(baseline.legacy_test_files || []);
  const violations = [];

  for (const file of files) {
    if (!isLegacyGenericTest(file)) continue;
    if (baselineSet.has(file)) continue;
    violations.push({
      file,
      reason:
        "new test file must declare a class suffix: .unit.test.*, .cli.test.*, .integration.test.*, .contract.test.*, or .regression.test.*",
    });
  }

  return {
    checked: files.filter((file) => isTestFile(file)).length,
    violations,
  };
}

export function findStaleBaselineEntries({ baseline = loadBaseline(), trackedFiles = [] } = {}) {
  const trackedSet = new Set(trackedFiles);
  return (baseline.legacy_test_files || []).filter((file) => !trackedSet.has(file));
}

function main() {
  const args = process.argv.slice(2);
  const stagedFileList = argValue(args, "--staged-file-list");
  const baselinePath = argValue(args, "--baseline") || DEFAULT_BASELINE_PATH;
  const jsonOutput = args.includes("--json");
  const updateBaseline = args.includes("--update-baseline");
  const allTracked = args.includes("--all-tracked");

  if (updateBaseline) {
    const trackedFiles = collectTrackedTestFiles();
    const legacyTestFiles = trackedFiles.filter((file) => isLegacyGenericTest(file)).sort();
    const payload = {
      schema: "test_classification_baseline/v1",
      generated: new Date().toISOString(),
      description:
        "Legacy generic test filenames. Debt can only decrease; new tests must declare a classification suffix.",
      legacy_test_files: legacyTestFiles,
    };
    writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(
      `[test-classification] baseline_updated path=${baselinePath} legacy_tests=${legacyTestFiles.length}`,
    );
    process.exit(0);
  }

  if (allTracked && stagedFileList) {
    throw new Error("Use only one input mode: --staged-file-list or --all-tracked");
  }

  const files = allTracked ? collectTrackedTestFiles() : readStagedPaths(stagedFileList);
  const baseline = loadBaseline(baselinePath);
  const result = analyzeTestClassification({ files, baseline });
  const staleBaselineEntries = findStaleBaselineEntries({
    baseline,
    trackedFiles: collectTrackedTestFiles(),
  });

  if (jsonOutput) {
    console.log(JSON.stringify({
      ...result,
      stale_baseline_entries: staleBaselineEntries,
    }, null, 2));
  } else if (result.violations.length > 0) {
    for (const violation of result.violations) {
      console.error(
        `[test-classification] violation file=${JSON.stringify(violation.file)} reason=${JSON.stringify(violation.reason)}`,
      );
    }
    if (staleBaselineEntries.length > 0) {
      console.log(
        `[test-classification] stale_baseline_entries=${staleBaselineEntries.length} (run --update-baseline to clean up)`,
      );
    }
    console.error(
      `[test-classification] result=fail checked=${result.checked} violations=${result.violations.length}`,
    );
  } else {
    if (staleBaselineEntries.length > 0) {
      console.log(
        `[test-classification] stale_baseline_entries=${staleBaselineEntries.length} (run --update-baseline to clean up)`,
      );
    }
    console.log(
      `[test-classification] result=ok checked=${result.checked} violations=0`,
    );
  }

  process.exit(result.violations.length > 0 ? 1 : 0);
}

const isDirectRun = process.argv[1]?.endsWith("check-test-classification.ts") || process.argv[1]?.endsWith("check-test-classification.mjs") === true;
if (isDirectRun) {
  main();
}
