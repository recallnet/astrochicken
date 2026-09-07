#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export const MAX_CODE_LINES = 1200;
const CODE_FILE_PATTERN = /\.(?:ts|tsx|js|mjs|cjs|py)$/;

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

export function analyzeLineLimits({ files = [], maxCodeLines = MAX_CODE_LINES } = {}) {
  const checkedFiles = [];
  const violations = [];

  for (const file of files) {
    if (!CODE_FILE_PATTERN.test(file) || !existsSync(file)) continue;
    checkedFiles.push(file);
    const content = readFileSync(file, "utf8");
    const lineCount = content.split("\n").length - 1 + Number(!content.endsWith("\n"));
    if (lineCount > maxCodeLines) {
      violations.push({
        file,
        lines: lineCount,
        max_lines: maxCodeLines,
      });
    }
  }

  return {
    checked: checkedFiles.length,
    violations,
  };
}

function main() {
  const args = process.argv.slice(2);
  const fileListPath = argValue(args, "--file-list");
  const maxCodeLines = Number(argValue(args, "--max-code-lines") || MAX_CODE_LINES);
  const allTracked = args.includes("--all-tracked");
  const jsonOutput = args.includes("--json");

  if (allTracked && fileListPath) {
    throw new Error("Use only one input mode: --file-list or --all-tracked");
  }

  const files = allTracked ? collectTrackedFiles() : readPathList(fileListPath);
  const result = analyzeLineLimits({ files, maxCodeLines });

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.violations.length > 0) {
    for (const violation of result.violations) {
      process.stderr.write(
        `[line-limit] violation file=${JSON.stringify(violation.file)} lines=${violation.lines} max=${violation.max_lines}\n`,
      );
    }
    process.stderr.write(
      `[line-limit] result=fail checked=${result.checked} violations=${result.violations.length}\n`,
    );
  } else {
    process.stdout.write(`[line-limit] result=ok checked=${result.checked} violations=0\n`);
  }

  process.exit(result.violations.length > 0 ? 1 : 0);
}

if (process.argv[1]?.endsWith("check-line-limit.ts") || process.argv[1]?.endsWith("check-line-limit.mjs")) {
  main();
}
