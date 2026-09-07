#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ESLINTABLE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".tsx"]);
const MAX_OLD_SPACE_SIZE_FLAG = "--max-old-space-size=4096";
const MAX_OLD_SPACE_SIZE_PATTERN = /--max-old-space-size(?:=|\s+)\d+/u;
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptsDir, "..");

function usage() {
  return "Usage: node scripts/eslint-gate.mjs [--staged-file-list <path> | --all-tracked] [--telemetry-prefix <prefix>]";
}

function parseArgs(argv) {
  const options = {
    stagedFileList: "",
    allTracked: false,
    telemetryPrefix: "pre-commit",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--staged-file-list") {
      options.stagedFileList = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg === "--all-tracked") {
      options.allTracked = true;
      continue;
    }
    if (arg === "--telemetry-prefix") {
      options.telemetryPrefix = argv[index + 1] || "pre-commit";
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.allTracked && options.stagedFileList) {
    throw new Error("Use only one input mode: --staged-file-list or --all-tracked");
  }

  return options;
}

function parsePathList(raw) {
  const text = String(raw || "");
  if (!text) {
    return [];
  }
  if (text.includes("\0")) {
    return text.split("\0").map((entry) => entry.trim()).filter(Boolean);
  }
  return text.split(/\r?\n/g).map((entry) => entry.trim()).filter(Boolean);
}

function isLintable(path) {
  for (const extension of ESLINTABLE_EXTENSIONS) {
    if (path.endsWith(extension)) {
      return true;
    }
  }
  return false;
}

export function filterExistingLintablePaths(paths = []) {
  return paths.filter((filePath) => existsSync(filePath)).filter(isLintable);
}

function readPaths(options) {
  if (options.allTracked) {
    return parsePathList(execFileSync("git", ["ls-files", "-z"], { encoding: "buffer" }));
  }
  if (options.stagedFileList) {
    return parsePathList(readFileSync(options.stagedFileList));
  }
  return parsePathList(execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMRD", "-M", "-z"], { encoding: "buffer" }));
}

export function ensureNodeOptionsHasHeapHeadroom(nodeOptions = "") {
  const options = String(nodeOptions || "").trim();
  if (!options) {
    return MAX_OLD_SPACE_SIZE_FLAG;
  }
  if (MAX_OLD_SPACE_SIZE_PATTERN.test(options)) {
    return options;
  }
  return `${options} ${MAX_OLD_SPACE_SIZE_FLAG}`;
}

export function resolveRepoOwnedEslintEntrypoint(repoRoot = defaultRepoRoot) {
  return path.resolve(repoRoot, "node_modules", "eslint", "bin", "eslint.js");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const files = filterExistingLintablePaths(readPaths(options));
  if (files.length === 0) {
    process.stdout.write(`[eslint] result=ok files=0 mode=skip\n`);
    return;
  }

  const eslintEntrypoint = resolveRepoOwnedEslintEntrypoint();
  const run = spawnSync(process.execPath, [eslintEntrypoint, "--max-warnings", "0", "--no-warn-ignored", ...files], {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_OPTIONS: ensureNodeOptionsHasHeapHeadroom(process.env.NODE_OPTIONS),
    },
  });

  const exitStatus = Number.isInteger(run.status) ? run.status : 1;
  if (run.error || exitStatus !== 0) {
    process.stderr.write(`[eslint] result=fail files=${files.length} exit=${exitStatus}\n`);
    process.exit(exitStatus || 1);
  }

  process.stdout.write(`[eslint] result=ok files=${files.length}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`[eslint] result=fail error=${JSON.stringify(error instanceof Error ? error.message : String(error))}\n`);
  process.exit(1);
}
