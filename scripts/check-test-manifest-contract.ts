#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TEST_MANIFEST_DIR = "config/testing/package-test-manifests";
export const TEST_MANIFEST_SCHEMA = "hatch.package-test-manifest.v1";
export const REQUIRED_PACKAGE_MANIFESTS = Object.freeze([
  Object.freeze({
    relativePath: `${TEST_MANIFEST_DIR}/apps-hatch.json`,
    packageName: "hatch",
    packagePath: "apps/hatch",
  }),
  Object.freeze({
    relativePath: `${TEST_MANIFEST_DIR}/packages-factory-ops.json`,
    packageName: "@hatch/factory-ops",
    packagePath: "packages/factory-ops",
  }),
  Object.freeze({
    relativePath: `${TEST_MANIFEST_DIR}/packages-factory-telemetry.json`,
    packageName: "@recallnet/factory-telemetry",
    packagePath: "packages/factory-telemetry",
  }),
]);

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
    manifest: argValue(argv, "--manifest"),
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

function validateCoveragePolicy(policy, path, diagnostics) {
  if (!isRecord(policy)) {
    diagnostics.push(`${path} must be an object`);
    return;
  }
  if (!Array.isArray(policy.src) || policy.src.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    diagnostics.push(`${path}.src must be a non-empty string array`);
  }
  if (!Array.isArray(policy.exclude) || policy.exclude.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    diagnostics.push(`${path}.exclude must be a string array`);
  }
  if (!isRecord(policy.thresholds)) {
    diagnostics.push(`${path}.thresholds must be an object`);
    return;
  }
  for (const threshold of ["statements", "lines", "functions", "branches"]) {
    if (!Number.isInteger(policy.thresholds[threshold])) {
      diagnostics.push(`${path}.thresholds.${threshold} must be an integer`);
    }
  }
}

export function validatePackageManifest(manifest, expectation) {
  const diagnostics = [];
  if (!isRecord(manifest)) {
    return ["manifest must be a JSON object"];
  }
  if (manifest.schema !== TEST_MANIFEST_SCHEMA) {
    diagnostics.push(`schema must be "${TEST_MANIFEST_SCHEMA}"`);
  }
  if (manifest.package_name !== expectation.packageName) {
    diagnostics.push(`package_name must be "${expectation.packageName}"`);
  }
  if (manifest.package_path !== expectation.packagePath) {
    diagnostics.push(`package_path must be "${expectation.packagePath}"`);
  }
  if (typeof manifest.default_suite !== "string" || manifest.default_suite.trim() === "") {
    diagnostics.push("default_suite must be a non-empty string");
  }
  if (!Array.isArray(manifest.suites) || manifest.suites.length === 0) {
    diagnostics.push("suites must be a non-empty array");
    return diagnostics;
  }

  const seenSuiteNames = new Set();
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
      if (seenSuiteNames.has(suite.name)) {
        diagnostics.push(`duplicate suite name "${suite.name}"`);
      }
      seenSuiteNames.add(suite.name);
    }
    if (suite.coverage_policy !== undefined) {
      validateCoveragePolicy(suite.coverage_policy, `${path}.coverage_policy`, diagnostics);
    }
  }

  if (typeof manifest.default_suite === "string" && !seenSuiteNames.has(manifest.default_suite)) {
    diagnostics.push(`default_suite "${manifest.default_suite}" must reference a declared suite`);
  }

  return diagnostics;
}

export function loadPackageManifest({ repoRoot, relativePath }) {
  const absolutePath = resolve(repoRoot, relativePath);
  const parsed = loadJson(absolutePath);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.value;
}

export function validateManifestCollection({ repoRoot, manifest }) {
  const diagnostics = [];
  const manifests = [];
  const manifestDir = resolve(repoRoot, TEST_MANIFEST_DIR);
  if (!existsSync(manifestDir)) {
    return {
      ok: false,
      diagnostics: [`missing required directory: ${TEST_MANIFEST_DIR}`],
      manifest_count: 0,
      suite_count: 0,
      manifest_entries: 0,
    };
  }

  const expectedEntries = manifest
    ? REQUIRED_PACKAGE_MANIFESTS.filter((entry) => entry.relativePath === manifest)
    : REQUIRED_PACKAGE_MANIFESTS;

  if (manifest && expectedEntries.length === 0) {
    return {
      ok: false,
      diagnostics: [`unknown manifest path: ${manifest}`],
      manifest_count: 0,
      suite_count: 0,
      manifest_entries: 0,
    };
  }

  const seenPackageNames = new Set();
  for (const expectation of expectedEntries) {
    const absolutePath = resolve(repoRoot, expectation.relativePath);
    if (!existsSync(absolutePath)) {
      diagnostics.push(`missing required manifest: ${expectation.relativePath}`);
      continue;
    }
    const parsed = loadJson(absolutePath);
    if (!parsed.ok) {
      diagnostics.push(parsed.error);
      continue;
    }
    const manifestDoc = parsed.value;
    manifests.push(manifestDoc);
    for (const issue of validatePackageManifest(manifestDoc, expectation)) {
      diagnostics.push(`${expectation.relativePath}: ${issue}`);
    }
    const packageName = manifestDoc?.package_name;
    if (typeof packageName === "string" && packageName.trim() !== "") {
      if (seenPackageNames.has(packageName)) {
        diagnostics.push(`duplicate package_name "${packageName}" across manifests`);
      }
      seenPackageNames.add(packageName);
    }
  }

  const visibleEntries = readdirSync(manifestDir).filter((entry) => !entry.startsWith("."));
  return {
    ok: diagnostics.length === 0,
    diagnostics,
    manifest_count: manifests.length,
    suite_count: manifests.reduce((sum, current) => sum + (Array.isArray(current?.suites) ? current.suites.length : 0), 0),
    manifest_entries: visibleEntries.length,
  };
}

export function emitTelemetry(result) {
  console.log(
    `[test_manifest_contract] result=${result.ok ? "ok" : "fail"} manifests=${result.manifest_count} suites=${result.suite_count} errors=${result.diagnostics.length}`,
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
    emitTelemetry({ ok: false, diagnostics: [String(error)], manifest_count: 0, suite_count: 0, manifest_entries: 0 });
    process.exit(1);
  }
}
