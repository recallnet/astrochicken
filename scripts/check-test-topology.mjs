#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_CONFIG_PATH = "config/testing/topology-enforcement.json";
const TEST_FILE_PATTERN = /\.test\.(?:mjs|cjs|js|mts|cts|ts|tsx)$/;

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : "";
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readPathList(path) {
  if (!path || !existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  if (text.includes("\0")) {
    return text.split("\0").filter(Boolean);
  }
  return text.split(/\r?\n/g).map((entry) => entry.trim()).filter(Boolean);
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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function hasAllowedPrefix(path, prefixes) {
  return prefixes.some((prefix) => path.startsWith(prefix));
}

export function parseArgs(argv) {
  return {
    repoRoot: argValue(argv, "--repo-root") || process.cwd(),
    configPath: argValue(argv, "--config") || DEFAULT_CONFIG_PATH,
    stagedFileList: argValue(argv, "--staged-file-list"),
    allTracked: argv.includes("--all-tracked"),
    json: argv.includes("--json"),
  };
}

export function validateTestTopology({
  repoRoot,
  configPath = DEFAULT_CONFIG_PATH,
  files = null,
  allTracked = false,
} = {}) {
  const diagnostics = [];
  const absoluteConfigPath = resolve(repoRoot, configPath);
  if (!existsSync(absoluteConfigPath)) {
    return {
      ok: false,
      diagnostics: [`missing topology enforcement config: ${configPath}`],
      checked: 0,
      violations: 0,
    };
  }

  const config = readJson(absoluteConfigPath);
  if (!isRecord(config)) {
    return {
      ok: false,
      diagnostics: [`${configPath} must be a JSON object`],
      checked: 0,
      violations: 0,
    };
  }

  if (config.schema !== "hatch.test-topology.v1") {
    diagnostics.push(`${configPath}.schema must be "hatch.test-topology.v1"`);
  }
  if (!Array.isArray(config.allowed_test_prefixes) || config.allowed_test_prefixes.length === 0) {
    diagnostics.push(`${configPath}.allowed_test_prefixes must be a non-empty array`);
  }

  const candidates = files
    ? [...files]
    : (allTracked ? collectTrackedFiles({ cwd: repoRoot }) : []);
  const testFiles = candidates.filter((path) => TEST_FILE_PATTERN.test(path));

  for (const path of testFiles) {
    if (!hasAllowedPrefix(path, config.allowed_test_prefixes || [])) {
      diagnostics.push(`test outside approved topology: ${path}`);
    }
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    checked: testFiles.length,
    violations: diagnostics.length,
  };
}

export function emitTelemetry(result) {
  console.log(
    `[test_topology] result=${result.ok ? "ok" : "fail"} checked=${result.checked} violations=${result.violations}`,
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.allTracked && options.stagedFileList) {
    throw new Error("Use only one input mode: --all-tracked or --staged-file-list");
  }
  const files = options.allTracked ? null : readPathList(options.stagedFileList);
  const result = validateTestTopology({
    repoRoot: options.repoRoot,
    configPath: options.configPath,
    files,
    allTracked: options.allTracked,
  });
  emitTelemetry(result);
  if (options.json) {
    console.log(JSON.stringify(result));
  }
  if (!result.ok) {
    process.exit(1);
  }
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || error);
    emitTelemetry({ ok: false, diagnostics: [String(error)], checked: 0, violations: 1 });
    process.exit(1);
  }
}
