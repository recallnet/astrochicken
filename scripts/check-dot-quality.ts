#!/usr/bin/env node

import { spawnSync } from "node:child_process";

import { isArchivedDocPath } from "./lib/live-doc-assets-manifest.ts";

export function shouldCheckDotPath(pathValue = "") {
  if (!pathValue.endsWith(".dot")) {
    return false;
  }
  if (isArchivedDocPath(pathValue)) {
    return false;
  }
  if (pathValue.startsWith("docs/contracts/workflow-ir/")) {
    return false;
  }
  if (pathValue.startsWith("scripts/test/fixtures/")) {
    return false;
  }
  // Engine test fixtures are intentionally minimal stubs; skip schema validation.
  if (pathValue.startsWith("apps/hatch/src/pipeline/fixtures/")) {
    return false;
  }
  return true;
}

function collectTrackedDotFiles({ cwd = process.cwd() } = {}) {
  const run = spawnSync("git", ["ls-files", "-z", "--", "*.dot"], {
    cwd,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    throw new Error(`git ls-files failed: ${String(run.stderr || run.stdout || "unknown_error")}`);
  }
  return String(run.stdout || "").split("\0").filter(Boolean).filter((file) => shouldCheckDotPath(file));
}

function runCommand(command, args, target, { quiet = false } = {}) {
  const run = spawnSync(command, args, {
    encoding: "utf8",
  });
  if (run.error) {
    throw run.error;
  }
  if ((run.status ?? 1) !== 0) {
    if (run.stdout) {
      process.stdout.write(run.stdout);
    }
    if (run.stderr) {
      process.stderr.write(run.stderr);
    }
    throw new Error(`[dot-quality] command failed target=${target} command=${JSON.stringify([command, ...args].join(" "))} exit=${run.status ?? 1}`);
  }
  if (!quiet) {
    if (run.stdout) {
      process.stdout.write(run.stdout);
    }
    if (run.stderr) {
      process.stderr.write(run.stderr);
    }
  }
}

function main() {
  const quiet = !process.argv.includes("--verbose");
  const dotFiles = collectTrackedDotFiles();
  if (!quiet) {
    process.stdout.write(`[dot-quality] start files=${dotFiles.length}\n`);
  }

  for (const file of dotFiles) {
    if (!quiet) {
      process.stdout.write(`[dot-quality] validate file=${JSON.stringify(file)}\n`);
    }
    runCommand("./node_modules/.bin/hatch", ["validate", file], file, { quiet });
    if (!quiet) {
      process.stdout.write(`[dot-quality] lint file=${JSON.stringify(file)}\n`);
    }
    runCommand(process.execPath, ["scripts/lint-dot.mjs", "--strict-warnings", file], file, { quiet });
  }

  process.stdout.write(`[dot-quality] result=ok files=${dotFiles.length} quiet=${quiet}\n`);
}

if (process.argv[1]?.endsWith("check-dot-quality.ts") || process.argv[1]?.endsWith("check-dot-quality.mjs")) {
  main();
}
