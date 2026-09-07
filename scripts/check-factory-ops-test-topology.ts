#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TEST_ROOT = "packages/factory-ops/test";
const ALLOWED_TOP_LEVEL_DIRS = new Set([
  "commands",
  "packets",
  "merge",
  "wave",
  "scenarios",
  "supervisor",
  "leases",
  "shared",
]);
const ALLOWED_TOP_LEVEL_FILES = new Set([".coverage-baseline.json"]);
const FORBIDDEN_LEGACY_DIRS = new Set(["fixtures", "snapshots", "harness", "state-machines"]);

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : "";
}

export function parseArgs(argv) {
  return {
    repoRoot: argValue(argv, "--repo-root") || process.cwd(),
    json: argv.includes("--json"),
  };
}

export function validateFactoryOpsTestTopology({ repoRoot }) {
  const diagnostics = [];
  const rootPath = resolve(repoRoot, TEST_ROOT);
  if (!existsSync(rootPath)) {
    return { ok: false, diagnostics: [`missing factory-ops test root: ${TEST_ROOT}`], checked_entries: 0 };
  }

  const entries = readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (FORBIDDEN_LEGACY_DIRS.has(entry.name)) {
        diagnostics.push(`forbidden legacy top-level directory: ${TEST_ROOT}/${entry.name}`);
      } else if (!ALLOWED_TOP_LEVEL_DIRS.has(entry.name)) {
        diagnostics.push(`unexpected top-level directory: ${TEST_ROOT}/${entry.name}`);
      }
      continue;
    }
    if (entry.isFile() && !ALLOWED_TOP_LEVEL_FILES.has(entry.name)) {
      diagnostics.push(`unexpected top-level file: ${TEST_ROOT}/${entry.name}`);
    }
  }

  return { ok: diagnostics.length === 0, diagnostics, checked_entries: entries.length };
}

export function emitTelemetry(result) {
  console.log(`[factory_ops_test_topology] result=${result.ok ? "ok" : "fail"} entries=${result.checked_entries} errors=${result.diagnostics.length}`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = validateFactoryOpsTestTopology(options);
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
    emitTelemetry({ ok: false, diagnostics: [String(error)], checked_entries: 0 });
    process.exit(1);
  }
}
