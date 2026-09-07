#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TELEMETRY_PREFIX = "daily_lens_collector_ownership";

const FORBIDDEN_FILES = Object.freeze([
  "packages/factory-ops/src/lib/analysis/collect-github-state.ts",
  "packages/factory-ops/src/lib/analysis/collect-langfuse.ts",
  "packages/factory-ops/src/lib/analysis/collect-langfuse-metrics.ts",
]);

const DETECTORS = Object.freeze([
  {
    id: "factory_ops_local_github_collector",
    message: "GitHub Daily Lens collectors belong in @hatch/github-adapter, not factory-ops.",
    regex: /from\s+["']\.\/collect-github-state\.(?:mjs|ts)["']/m,
  },
  {
    id: "factory_ops_local_langfuse_collector",
    message: "Langfuse Daily Lens collectors belong in @recallnet/factory-telemetry, not factory-ops.",
    regex: /from\s+["']\.\/collect-langfuse\.(?:mjs|ts)["']/m,
  },
  {
    id: "factory_ops_local_langfuse_metrics_collector",
    message: "Langfuse metrics collectors belong in @recallnet/factory-telemetry, not factory-ops.",
    regex: /from\s+["']\.\/collect-langfuse-metrics\.(?:mjs|ts)["']/m,
  },
]);

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : "";
}

export function parseArgs(argv) {
  return {
    repoRoot: resolve(argValue(argv, "--repo-root") || process.cwd()),
    stagedFileList: argValue(argv, "--staged-file-list") || "",
    allTracked: argv.includes("--all-tracked"),
    json: argv.includes("--json"),
  };
}

function parseNulDelimitedPathList(raw = Buffer.alloc(0)) {
  return String(raw)
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function listFiles(rootPath) {
  const output = [];
  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = resolve(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (entry.isFile()) {
        output.push(absolute);
      }
    }
  }
  return output;
}

function resolveScopedPaths({ repoRoot, stagedFileList = "", allTracked = false } = {}) {
  if (allTracked || !stagedFileList) return null;
  const absoluteListPath = resolve(repoRoot, stagedFileList);
  if (!existsSync(absoluteListPath)) return [];
  return new Set(parseNulDelimitedPathList(readFileSync(absoluteListPath)).map((entry) => entry.replaceAll("\\", "/")));
}

function collectAnalysisFiles(repoRoot, scopedPaths = null) {
  const rootPath = resolve(repoRoot, "packages/factory-ops/src/lib/analysis");
  if (!existsSync(rootPath)) return [];
  return listFiles(rootPath)
    .map((absolutePath) => absolutePath.slice(repoRoot.length + 1).replaceAll("\\", "/"))
    .filter((relativePath) => relativePath.endsWith(".mjs") || relativePath.endsWith(".ts"))
    .filter((relativePath) => !/\.(?:test|unit|integration|contract)\./.test(relativePath))
    .filter((relativePath) => !scopedPaths || scopedPaths.has(relativePath))
    .sort();
}

export function analyzeDailyLensCollectorOwnership({
  repoRoot,
  stagedFileList = "",
  allTracked = false,
} = {}) {
  const absoluteRepoRoot = resolve(repoRoot);
  const scopedPaths = resolveScopedPaths({ repoRoot: absoluteRepoRoot, stagedFileList, allTracked });
  const diagnostics = [];

  for (const relativePath of FORBIDDEN_FILES) {
    if (existsSync(resolve(absoluteRepoRoot, relativePath))) {
      diagnostics.push(
        `daily lens collector ownership violation: ${relativePath} must move into its owner package`,
      );
    }
  }

  const files = collectAnalysisFiles(absoluteRepoRoot, scopedPaths);
  for (const relativePath of files) {
    const content = readFileSync(resolve(absoluteRepoRoot, relativePath), "utf8");
    for (const detector of DETECTORS) {
      if (!detector.regex.test(content)) continue;
      diagnostics.push(
        `daily lens collector ownership violation in ${relativePath}: ${detector.id} (${detector.message})`,
      );
    }
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    file_count: files.length,
    violation_count: diagnostics.length,
  };
}

export function emitTelemetry(result) {
  console.log(
    `[${TELEMETRY_PREFIX}] result=${result.ok ? "ok" : "fail"} files=${result.file_count} violations=${result.violation_count}`,
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = analyzeDailyLensCollectorOwnership(options);
  emitTelemetry(result);
  if (options.json) {
    console.log(JSON.stringify(result));
  }
  if (!result.ok) {
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
