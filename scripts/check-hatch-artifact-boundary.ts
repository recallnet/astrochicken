#!/usr/bin/env node

/**
 * check-hatch-artifact-boundary.mjs
 *
 * Pre-commit guard: rejects staged files that look like factory run artifacts
 * leaked to the repo root instead of living under .hatch/<factory>/.
 *
 * Common leak patterns:
 * - DOT graph node names materialized as 0-byte files (e.g. `done`, `archive_synthesis_failed`)
 * - Run state files at repo root (`state.json`, `metadata.json`)
 * - Factory issue specs (`issues/1846.md`)
 * - Stray checkpoint/trace files (`.hatch-checkpoint-*`, `.hatch-trace-*`)
 */

import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";

// Allowlist: repo-root files that match the bare-name pattern but are legitimate.
const ALLOWLISTED_ROOT_FILES = new Set([
  "Makefile",
  "Dockerfile",
  "Procfile",
  "Brewfile",
  "Gemfile",
  "Rakefile",
  "Vagrantfile",
  "Justfile",
  "turbo",
]);

// Exact repo-root filenames that are always violations.
const EXACT_ROOT_VIOLATIONS = new Set([
  "state.json",
  "metadata.json",
]);

// Repo-root directory prefixes that indicate factory artifact leaks.
const LEAKED_DIRECTORY_PREFIXES = [
  "issues/",
];

// Prefix patterns for stray hatch files.
const HATCH_STRAY_PREFIXES = [
  ".hatch-checkpoint-",
  ".hatch-trace-",
];

/**
 * A bare name at repo root (no extension, no path separators, lowercase + underscores/digits)
 * is almost certainly a leaked DOT graph node name.
 */
function looksLikeDotNodeName(filePath) {
  if (filePath.includes("/")) return false;
  // Must be a bare name: no dots (no extension), only lowercase letters, digits, underscores
  if (!/^[a-z][a-z0-9_]+$/.test(filePath)) return false;
  if (filePath.length < 2) return false;
  if (ALLOWLISTED_ROOT_FILES.has(filePath)) return false;
  return true;
}

function isExactRootViolation(filePath) {
  if (filePath.includes("/")) return false;
  return EXACT_ROOT_VIOLATIONS.has(filePath);
}

function isLeakedDirectoryArtifact(filePath) {
  return LEAKED_DIRECTORY_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

function isStrayHatchFile(filePath) {
  const name = filePath.includes("/") ? basename(filePath) : filePath;
  return HATCH_STRAY_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function analyzeArtifactLeaks({ files = [] } = {}) {
  const violations = [];

  for (const file of files) {
    let reason = "";

    if (isExactRootViolation(file)) {
      reason = "run_state_file_at_repo_root";
    } else if (looksLikeDotNodeName(file)) {
      reason = "dot_node_name_at_repo_root";
    } else if (isLeakedDirectoryArtifact(file)) {
      reason = "factory_artifact_directory_at_repo_root";
    } else if (isStrayHatchFile(file)) {
      reason = "stray_hatch_checkpoint_or_trace";
    }

    if (reason) {
      violations.push({ file, reason });
    }
  }

  return { checked: files.length, violations };
}

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function readStagedPaths(path) {
  if (!path) return [];
  try {
    return readFileSync(path, "utf8").split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

function main() {
  const args = process.argv.slice(2);
  const stagedFileList = argValue(args, "--staged-file-list");
  const jsonOutput = args.includes("--json");
  const files = readStagedPaths(stagedFileList);
  const result = analyzeArtifactLeaks({ files });

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.violations.length > 0) {
    for (const violation of result.violations) {
      console.error(
        `[hatch-artifact-boundary] violation file=${JSON.stringify(violation.file)} reason=${violation.reason}`,
      );
    }
    console.error(
      `[hatch-artifact-boundary] result=fail checked=${result.checked} violations=${result.violations.length}`,
    );
  } else {
    console.log(
      `[hatch-artifact-boundary] result=ok checked=${result.checked} violations=0`,
    );
  }

  process.exit(result.violations.length > 0 ? 1 : 0);
}

const isDirectRun = process.argv[1]?.endsWith("check-hatch-artifact-boundary.ts") || process.argv[1]?.endsWith("check-hatch-artifact-boundary.mjs") === true;
if (isDirectRun) {
  main();
}
