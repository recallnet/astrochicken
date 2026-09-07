#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { analyzeCommandThinnessInventory } from "./check-command-thinness-inventory.ts";
import { loadActiveSurfaceManifest, selectManifestScopedFiles } from "./lib/active-surface-manifest.ts";
import { PHASE1_GATE_SCOPE_CONTRACT } from "./lib/phase1-gate-scope-contract.ts";

const CLI_COMMAND_FILE_PATTERN = /^packages\/[^/]+\/src\/cli\/commands\/.+\.(?:mjs|cjs|js|mts|cts|ts|tsx)$/;
const ENFORCED_CLASSIFICATIONS = PHASE1_GATE_SCOPE_CONTRACT.command_thinness.classifications;

function readPathList(path) {
  if (!path || !existsSync(path)) return [];
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

function defaultReadFile(filePath) {
  return readFileSync(filePath, "utf8");
}

function analyzeCliThinness({ files = [], readFile = defaultReadFile } = {}) {
  const violations = [];
  let checked = 0;

  for (const file of files) {
    if (!CLI_COMMAND_FILE_PATTERN.test(file)) continue;
    if (!existsSync(file)) continue;
    checked += 1;
    const content = readFile(file);
    const lineCount = content.split("\n").length - 1 + Number(!content.endsWith("\n"));
    if (lineCount > 400) {
      violations.push({
        file,
        kind: "command_thinness_hotspot",
        classification: lineCount >= 800 ? "hotspot" : "oversized",
        lines: lineCount,
      });
    }
  }

  return { checked, violations };
}

export function analyzeCommandThinnessEnforcement({
  files = [],
  readFile = defaultReadFile,
  manifest = loadActiveSurfaceManifest(),
} = {}) {
  const commandInventory = analyzeCommandThinnessInventory({ files, readFile });
  const cliInventory = analyzeCliThinness({ files, readFile });
  const enforcedFiles = new Set(selectManifestScopedFiles({
    manifest,
    files,
    surfaceType: "command",
    classifications: ENFORCED_CLASSIFICATIONS,
  }));
  const violations = [...commandInventory.violations, ...cliInventory.violations]
    .filter((entry) => enforcedFiles.has(entry.file));

  return {
    schema_version: "command_thinness_enforcement/v1",
    ok: violations.length === 0,
    checked: commandInventory.checked + cliInventory.checked,
    enforced_classifications: [...ENFORCED_CLASSIFICATIONS],
    violations,
  };
}

function main() {
  const args = process.argv.slice(2);
  const fileListIndex = args.indexOf("--staged-file-list");
  const path = fileListIndex >= 0 ? args[fileListIndex + 1] : "";
  const allTracked = args.includes("--all-tracked");
  if (allTracked && path) {
    throw new Error("Use only one input mode: --staged-file-list or --all-tracked");
  }
  const files = allTracked ? collectTrackedFiles() : readPathList(path);
  const result = analyzeCommandThinnessEnforcement({ files });

  if (result.violations.length > 0) {
    for (const violation of result.violations) {
      process.stderr.write(
        `[command-thinness-enforcement] violation file=${JSON.stringify(violation.file)} class=${violation.classification} lines=${violation.lines}\n`,
      );
    }
    process.stderr.write(
      `[command-thinness-enforcement] result=fail checked=${result.checked} violations=${result.violations.length}\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `[command-thinness-enforcement] result=ok checked=${result.checked} violations=0\n`,
  );
}

if (process.argv[1]?.endsWith("check-command-thinness-enforcement.ts") || process.argv[1]?.endsWith("check-command-thinness-enforcement.mjs")) {
  main();
}
