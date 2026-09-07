#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REPO_TEST_MANIFEST_PATH = "config/testing/repo-test-manifests/default.json";
export const REPO_TEST_MANIFEST_SCHEMA = "hatch.repo-test-manifest.v1";

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : "";
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseArgs(argv) {
  return {
    repoRoot: argValue(argv, "--repo-root") || process.cwd(),
    manifest: argValue(argv, "--manifest") || REPO_TEST_MANIFEST_PATH,
    json: argv.includes("--json"),
  };
}

function loadJson(filePath) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(filePath, "utf8")) };
  } catch (error) {
    return { ok: false, error: `failed to parse JSON at ${filePath}: ${error?.message || error}` };
  }
}

export function validateRepoManifest(manifest) {
  const diagnostics = [];
  if (!isRecord(manifest)) {
    return ["manifest must be a JSON object"];
  }
  if (manifest.schema !== REPO_TEST_MANIFEST_SCHEMA) {
    diagnostics.push(`schema must be "${REPO_TEST_MANIFEST_SCHEMA}"`);
  }
  if (manifest.repo_name !== "astrochicken") {
    diagnostics.push('repo_name must be "astrochicken"');
  }
  if (manifest.repo_root !== ".") {
    diagnostics.push('repo_root must be "."');
  }
  if (typeof manifest.default_suite !== "string" || manifest.default_suite.trim() === "") {
    diagnostics.push("default_suite must be a non-empty string");
  }
  if (!Array.isArray(manifest.suites) || manifest.suites.length === 0) {
    diagnostics.push("suites must be a non-empty array");
    return diagnostics;
  }

  const seenNames = new Set();
  for (let index = 0; index < manifest.suites.length; index += 1) {
    const suite = manifest.suites[index];
    const path = `suites[${index}]`;
    if (!isRecord(suite)) {
      diagnostics.push(`${path} must be an object`);
      continue;
    }
    for (const key of ["name", "runner", "working_directory", "command"]) {
      if (typeof suite[key] !== "string" || suite[key].trim() === "") {
        diagnostics.push(`${path}.${key} must be a non-empty string`);
      }
    }
    if (!Array.isArray(suite.entrypoints) || suite.entrypoints.length === 0) {
      diagnostics.push(`${path}.entrypoints must be a non-empty array`);
    } else if (suite.entrypoints.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
      diagnostics.push(`${path}.entrypoints entries must be non-empty strings`);
    }
    if (typeof suite.name === "string" && suite.name.trim() !== "") {
      if (seenNames.has(suite.name)) {
        diagnostics.push(`duplicate suite name "${suite.name}"`);
      }
      seenNames.add(suite.name);
    }
  }

  if (typeof manifest.default_suite === "string" && !seenNames.has(manifest.default_suite)) {
    diagnostics.push(`default_suite "${manifest.default_suite}" must reference a declared suite`);
  }

  return diagnostics;
}

export function validateManifestCollection({ repoRoot, manifest }) {
  const manifestPath = resolve(repoRoot, manifest || REPO_TEST_MANIFEST_PATH);
  if (!existsSync(manifestPath)) {
    return {
      ok: false,
      diagnostics: [`missing required manifest: ${manifest || REPO_TEST_MANIFEST_PATH}`],
      suite_count: 0,
    };
  }
  const parsed = loadJson(manifestPath);
  if (!parsed.ok) {
    return { ok: false, diagnostics: [parsed.error], suite_count: 0 };
  }
  const diagnostics = validateRepoManifest(parsed.value);
  return {
    ok: diagnostics.length === 0,
    diagnostics,
    suite_count: Array.isArray(parsed.value?.suites) ? parsed.value.suites.length : 0,
  };
}

export function emitTelemetry(result) {
  console.log(
    `[repo_test_manifest_contract] result=${result.ok ? "ok" : "fail"} suites=${result.suite_count} errors=${result.diagnostics.length}`,
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = validateManifestCollection(options);
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
    emitTelemetry({ ok: false, diagnostics: [String(error)], suite_count: 0 });
    process.exit(1);
  }
}
