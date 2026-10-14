#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PROD_SOURCE_LITERAL =
  /^(?:(?:packages|apps)\/[^"'`]*\/src\/[^"'`]+|factories\/[^/]+\/(?:graphs|workflows)\/[^"'`]+|packages\/[^/]+\/workflows\/[^"'`]+|docs\/contracts\/workflow-ir\/[^"'`]+)$/;
const STATIC_SOURCE_ASSERTION_PATTERN =
  /\bassert\.(?:match|doesNotMatch)\s*\(|\.toMatch\s*\(|\.toContain\s*\(/;

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function readStagedPaths(path) {
  if (!path) return [];
  return readFileSync(path, "utf8").split("\0").filter(Boolean);
}

function collectTrackedFiles({ cwd = process.cwd() } = {}) {
  const run = spawnSync("git", ["ls-files", "-z"], {
    cwd,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    throw new Error(`git ls-files failed: ${String(run.stderr || run.stdout || "unknown_error")}`);
  }
  return String(run.stdout || "").split("\0").filter(Boolean);
}

function isTestFile(path) {
  return /\.test\.(?:mjs|cjs|js|mts|cts|ts|tsx)$/.test(path);
}

function isContractTestFile(path) {
  return /\.contract\.test\.(?:mjs|cjs|js|mts|cts|ts|tsx)$/.test(path);
}

function collectPathBindings(content) {
  const bindings = new Map();
  const bindingPattern =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:fileURLToPath\(\s*)?new URL\(\s*["'`]([^"'`]+)["'`][^)]*\)|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*["'`]([^"'`]+)["'`]/g;
  for (const match of content.matchAll(bindingPattern)) {
    const name = match[1] || match[3];
    const value = match[2] || match[4];
    if (!name || !value) continue;
    bindings.set(name, value);
  }
  return bindings;
}

function collectProductionSourceReads(content) {
  const bindings = collectPathBindings(content);
  const reads = [];
  const readPattern = /\breadFileSync\s*\(\s*([^,\n)]+)\s*(?:,|\))/g;
  for (const match of content.matchAll(readPattern)) {
    const rawArg = String(match[1] || "").trim();
    let resolvedPath = "";

    const literalMatch = rawArg.match(/^["'`]([^"'`]+)["'`]$/);
    if (literalMatch) {
      resolvedPath = literalMatch[1];
    } else if (bindings.has(rawArg)) {
      resolvedPath = bindings.get(rawArg) || "";
    }

    if (resolvedPath && PROD_SOURCE_LITERAL.test(resolvedPath)) {
      reads.push(resolvedPath);
    }
  }
  return Array.from(new Set(reads));
}

export function analyzeTestBoundaries({ files = [] } = {}) {
  const violations = [];

  for (const file of files) {
    if (!isTestFile(file) || isContractTestFile(file)) continue;
    let content = "";
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    if (!STATIC_SOURCE_ASSERTION_PATTERN.test(content)) continue;
    const productionSourceReads = collectProductionSourceReads(content);
    if (productionSourceReads.length === 0) continue;

    violations.push({
      file,
      production_source_reads: productionSourceReads,
      reason:
        "behavioral test reads production source/graph text directly; move this assertion to *.contract.test.* or execute production code instead",
    });
  }

  return {
    checked: files.filter(isTestFile).length,
    violations,
  };
}

function main() {
  const args = process.argv.slice(2);
  const stagedFileList = argValue(args, "--staged-file-list");
  const allTracked = args.includes("--all-tracked");
  const jsonOutput = args.includes("--json");
  if (allTracked && stagedFileList) {
    throw new Error("Use only one input mode: --staged-file-list or --all-tracked");
  }
  const files = allTracked ? collectTrackedFiles() : readStagedPaths(stagedFileList);
  const result = analyzeTestBoundaries({ files });

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.violations.length > 0) {
    for (const violation of result.violations) {
      console.error(
        `[test-boundaries] violation file=${JSON.stringify(violation.file)} reads=${JSON.stringify(violation.production_source_reads)}`,
      );
    }
    console.error(
      `[test-boundaries] result=fail checked=${result.checked} violations=${result.violations.length}`,
    );
  } else {
    console.log(
      `[test-boundaries] result=ok checked=${result.checked} violations=0`,
    );
  }

  process.exit(result.violations.length > 0 ? 1 : 0);
}

const isDirectRun = process.argv[1]?.endsWith("check-test-boundaries.ts") || process.argv[1]?.endsWith("check-test-boundaries.mjs") === true;
if (isDirectRun) {
  main();
}
