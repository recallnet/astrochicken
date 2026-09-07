#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const COMMAND_FILE_PATTERN = /^packages\/[^/]+\/src\/(?:commands|cli\/commands)\/.+\.(?:mjs|cjs|js|mts|cts|ts|tsx)$/;
const THINNESS_LINE_THRESHOLD = 400;
const HOTSPOT_LINE_THRESHOLD = 800;
const COMPLEXITY_TOKEN_PATTERN = /\b(?:if|else\s+if|for|while|switch|catch)\b/g;

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

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

function classifyThinness(lineCount) {
  if (lineCount >= HOTSPOT_LINE_THRESHOLD) return "hotspot";
  if (lineCount >= THINNESS_LINE_THRESHOLD) return "oversized";
  return "";
}

export function analyzeCommandThinnessInventory({ files = [], readFile = defaultReadFile } = {}) {
  const violations = [];
  let checked = 0;

  for (const file of files) {
    if (!COMMAND_FILE_PATTERN.test(file)) continue;

    let content;
    try {
      content = readFile(file);
    } catch {
      continue;
    }

    checked += 1;
    const lineCount = content.split("\n").length - 1 + Number(!content.endsWith("\n"));
    const classification = classifyThinness(lineCount);
    if (!classification) continue;

    const complexitySignals = Array.isArray(content.match(COMPLEXITY_TOKEN_PATTERN))
      ? content.match(COMPLEXITY_TOKEN_PATTERN).length
      : 0;

    violations.push({
      file,
      kind: "command_thinness_hotspot",
      classification,
      lines: lineCount,
      complexity_signals: complexitySignals,
    });
  }

  return {
    schema_version: "command_thinness_inventory/v1",
    ok: true,
    checked,
    summary: {
      oversized: violations.filter((entry) => entry.classification === "oversized").length,
      hotspots: violations.filter((entry) => entry.classification === "hotspot").length,
    },
    violations,
  };
}

function defaultReadFile(filePath) {
  return readFileSync(filePath, "utf8");
}

function main() {
  const args = process.argv.slice(2);
  const fileListPath = argValue(args, "--file-list");
  const allTracked = args.includes("--all-tracked");
  const jsonOutput = args.includes("--json");

  if (allTracked && fileListPath) {
    throw new Error("Use only one input mode: --file-list or --all-tracked");
  }

  const files = allTracked ? collectTrackedFiles() : readPathList(fileListPath);
  const result = analyzeCommandThinnessInventory({ files });

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(0);
    return;
  }

  for (const violation of result.violations) {
    process.stdout.write(
      `[command-thinness] inventory class=${violation.classification} file=${JSON.stringify(violation.file)} lines=${violation.lines} complexity_signals=${violation.complexity_signals}\n`,
    );
  }
  process.stdout.write(
    `[command-thinness] result=ok checked=${result.checked} oversized=${result.summary.oversized} hotspots=${result.summary.hotspots}\n`,
  );
}

if (process.argv[1]?.endsWith("check-command-thinness-inventory.ts") || process.argv[1]?.endsWith("check-command-thinness-inventory.mjs")) {
  main();
}
