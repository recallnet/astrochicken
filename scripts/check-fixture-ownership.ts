#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveOwnerId } from "./check-subsystem-ownership.ts";

const DEFAULT_TOPOLOGY_CONFIG = "config/testing/topology-enforcement.json";
const DEFAULT_OWNERSHIP_CONFIG = "config/testing/subsystem-ownership.json";

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : "";
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
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

function hasAllowedPrefix(path, prefixes) {
  return prefixes.some((prefix) => path.startsWith(prefix));
}

function isFixturePath(path, names) {
  return names.some((name) => path.includes(`/${name}/`));
}

function isForbiddenFactoryFixturePath(path) {
  return path.startsWith("factories/") && !path.startsWith("factories/_templates/factory/conformance/");
}

export function parseArgs(argv) {
  return {
    repoRoot: argValue(argv, "--repo-root") || process.cwd(),
    topologyConfigPath: argValue(argv, "--config") || DEFAULT_TOPOLOGY_CONFIG,
    ownershipConfigPath: argValue(argv, "--ownership") || DEFAULT_OWNERSHIP_CONFIG,
    stagedFileList: argValue(argv, "--staged-file-list"),
    allTracked: argv.includes("--all-tracked"),
    json: argv.includes("--json"),
  };
}

export function filterExistingStagedPaths(paths, { repoRoot }) {
  return paths.filter((path) => existsSync(resolve(repoRoot, path)));
}

export function validateFixtureOwnership({
  repoRoot,
  topologyConfigPath = DEFAULT_TOPOLOGY_CONFIG,
  ownershipConfigPath = DEFAULT_OWNERSHIP_CONFIG,
  files = null,
  allTracked = false,
} = {}) {
  const diagnostics = [];
  const topologyPath = resolve(repoRoot, topologyConfigPath);
  const ownershipPath = resolve(repoRoot, ownershipConfigPath);

  if (!existsSync(topologyPath)) {
    return {
      ok: false,
      diagnostics: [`missing topology enforcement config: ${topologyConfigPath}`],
      checked: 0,
      violations: 0,
    };
  }
  if (!existsSync(ownershipPath)) {
    return {
      ok: false,
      diagnostics: [`missing subsystem ownership config: ${ownershipConfigPath}`],
      checked: 0,
      violations: 0,
    };
  }

  const topology = readJson(topologyPath);
  const ownership = readJson(ownershipPath);
  if (!isRecord(topology)) {
    diagnostics.push(`${topologyConfigPath} must be a JSON object`);
  }
  if (!isRecord(ownership)) {
    diagnostics.push(`${ownershipConfigPath} must be a JSON object`);
  }
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics, checked: 0, violations: diagnostics.length };
  }

  if (topology.schema !== "hatch.test-topology.v1") {
    diagnostics.push(`${topologyConfigPath}.schema must be "hatch.test-topology.v1"`);
  }
  if (!Array.isArray(topology.allowed_fixture_prefixes) || topology.allowed_fixture_prefixes.length === 0) {
    diagnostics.push(`${topologyConfigPath}.allowed_fixture_prefixes must be a non-empty array`);
  }
  if (!Array.isArray(topology.fixture_directory_names) || topology.fixture_directory_names.length === 0) {
    diagnostics.push(`${topologyConfigPath}.fixture_directory_names must be a non-empty array`);
  }
  if (!Array.isArray(ownership.path_rules) || ownership.path_rules.length === 0) {
    diagnostics.push(`${ownershipConfigPath}.path_rules must be a non-empty array`);
  }
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics, checked: 0, violations: diagnostics.length };
  }

  const candidates = files
    ? [...files]
    : (allTracked ? collectTrackedFiles({ cwd: repoRoot }) : []);
  const fixtureFiles = candidates.filter((path) => isFixturePath(path, topology.fixture_directory_names));

  for (const path of fixtureFiles) {
    if (isForbiddenFactoryFixturePath(path)) {
      diagnostics.push(`factory fixture roots are forbidden outside scaffold conformance template: ${path}`);
      continue;
    }
    if (!hasAllowedPrefix(path, topology.allowed_fixture_prefixes)) {
      diagnostics.push(`fixture outside approved ownership roots: ${path}`);
      continue;
    }
    const resolution = resolveOwnerId(path, ownership.path_rules);
    if (resolution.status !== "ok") {
      diagnostics.push(`fixture without deterministic owner: ${path}`);
    }
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    checked: fixtureFiles.length,
    violations: diagnostics.length,
  };
}

export function emitTelemetry(result) {
  console.log(
    `[fixture_ownership] result=${result.ok ? "ok" : "fail"} checked=${result.checked} violations=${result.violations}`,
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.allTracked && options.stagedFileList) {
    throw new Error("Use only one input mode: --all-tracked or --staged-file-list");
  }
  const files = options.allTracked
    ? null
    : filterExistingStagedPaths(readPathList(options.stagedFileList), { repoRoot: options.repoRoot });
  const result = validateFixtureOwnership({
    repoRoot: options.repoRoot,
    topologyConfigPath: options.topologyConfigPath,
    ownershipConfigPath: options.ownershipConfigPath,
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
