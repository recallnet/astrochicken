#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TESTING_CONFIG_ROOT = "config/testing";
const PACKAGE_MANIFESTS_DIR = `${TESTING_CONFIG_ROOT}/package-test-manifests`;
const TELEMETRY_PREFIX = "test_config_contract";

export const REQUIRED_CONFIGS = Object.freeze([
  {
    relativePath: `${TESTING_CONFIG_ROOT}/test-taxonomy.json`,
    schema: "hatch.test-taxonomy.v1",
    requiredArrayFields: ["allowed_categories"],
    requiredObjectFields: ["naming"],
  },
  {
    relativePath: `${TESTING_CONFIG_ROOT}/subsystem-ownership.json`,
    schema: "hatch.subsystem-ownership.v1",
    requiredArrayFields: ["scan_roots", "owners", "path_rules"],
    requiredObjectFields: [],
  },
  {
    relativePath: `${TESTING_CONFIG_ROOT}/shared-surface-ownership.json`,
    schema: "hatch.shared-surface-ownership.v1",
    requiredArrayFields: ["scan_roots", "surfaces"],
    requiredObjectFields: [],
  },
  {
    relativePath: `${TESTING_CONFIG_ROOT}/suite-routing.json`,
    schema: "hatch.suite-routing.v1",
    requiredArrayFields: ["routes"],
    requiredObjectFields: [],
  },
  {
    relativePath: `${TESTING_CONFIG_ROOT}/spec-registry.json`,
    schema: "hatch.spec-registry.v1",
    requiredArrayFields: ["specs"],
    requiredObjectFields: [],
  },
  {
    relativePath: `${TESTING_CONFIG_ROOT}/topology-enforcement.json`,
    schema: "hatch.test-topology.v1",
    requiredArrayFields: ["allowed_test_prefixes", "allowed_fixture_prefixes", "fixture_directory_names"],
    requiredObjectFields: [],
  },
  {
    relativePath: `${TESTING_CONFIG_ROOT}/hook-profiles.json`,
    schema: "hatch.hook-profiles.v1",
    requiredArrayFields: [],
    requiredObjectFields: ["profiles"],
  },
]);

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

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJsonFile(filePath) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(filePath, "utf8")) };
  } catch (error) {
    return {
      ok: false,
      error: `failed to parse JSON at ${filePath}: ${error?.message || error}`,
    };
  }
}

function validateProfilesShape(value, relativePath, diagnostics) {
  const profiles = value.profiles;
  if (!isRecord(profiles)) {
    diagnostics.push(`${relativePath}.profiles must be an object`);
    return;
  }

  for (const profileName of ["fast", "strict", "full"]) {
    const profile = profiles[profileName];
    if (!isRecord(profile)) {
      diagnostics.push(`${relativePath}.profiles.${profileName} must be an object`);
      continue;
    }
    if (typeof profile.description !== "string" || profile.description.trim() === "") {
      diagnostics.push(`${relativePath}.profiles.${profileName}.description must be a non-empty string`);
    }
    if (!Array.isArray(profile.suite_selectors)) {
      diagnostics.push(`${relativePath}.profiles.${profileName}.suite_selectors must be an array`);
    }
  }
}

function validateTaxonomyShape(value, relativePath, diagnostics) {
  const allowed = value.allowed_categories;
  if (!Array.isArray(allowed)) {
    diagnostics.push(`${relativePath}.allowed_categories must be an array`);
  } else {
    for (const category of ["unit", "contract", "integration", "regressions"]) {
      if (!allowed.includes(category)) {
        diagnostics.push(`${relativePath}.allowed_categories must include "${category}"`);
      }
    }
  }

  const naming = value.naming;
  if (!isRecord(naming)) {
    diagnostics.push(`${relativePath}.naming must be an object`);
    return;
  }
  if (!Array.isArray(naming.required_class_suffixes)) {
    diagnostics.push(`${relativePath}.naming.required_class_suffixes must be an array`);
  }
  if (!Array.isArray(naming.forbidden_new_generic_names)) {
    diagnostics.push(`${relativePath}.naming.forbidden_new_generic_names must be an array`);
  }
}

export function validateTestingConfig({ repoRoot }) {
  const diagnostics = [];
  const rootPath = resolve(repoRoot, TESTING_CONFIG_ROOT);
  if (!existsSync(rootPath)) {
    diagnostics.push(`missing required directory: ${TESTING_CONFIG_ROOT}`);
  }

  const manifestsDirPath = resolve(repoRoot, PACKAGE_MANIFESTS_DIR);
  if (!existsSync(manifestsDirPath)) {
    diagnostics.push(`missing required directory: ${PACKAGE_MANIFESTS_DIR}`);
  }

  for (const config of REQUIRED_CONFIGS) {
    const absolutePath = resolve(repoRoot, config.relativePath);
    if (!existsSync(absolutePath)) {
      diagnostics.push(`missing required config: ${config.relativePath}`);
      continue;
    }

    const parsed = readJsonFile(absolutePath);
    if (!parsed.ok) {
      diagnostics.push(parsed.error);
      continue;
    }

    const value = parsed.value;
    if (!isRecord(value)) {
      diagnostics.push(`${config.relativePath} must contain a JSON object`);
      continue;
    }

    if (value.schema !== config.schema) {
      diagnostics.push(`${config.relativePath}.schema must be "${config.schema}"`);
    }

    for (const field of config.requiredArrayFields) {
      if (!Array.isArray(value[field])) {
        diagnostics.push(`${config.relativePath}.${field} must be an array`);
      }
    }

    for (const field of config.requiredObjectFields) {
      if (!isRecord(value[field])) {
        diagnostics.push(`${config.relativePath}.${field} must be an object`);
      }
    }

    if (config.relativePath.endsWith("hook-profiles.json")) {
      validateProfilesShape(value, config.relativePath, diagnostics);
    }

    if (config.relativePath.endsWith("test-taxonomy.json")) {
      validateTaxonomyShape(value, config.relativePath, diagnostics);
    }
  }

  const manifestEntries = existsSync(manifestsDirPath)
    ? readdirSync(manifestsDirPath).filter((entry) => !entry.startsWith("."))
    : [];

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    config_count: REQUIRED_CONFIGS.length,
    manifest_entries: manifestEntries.length,
  };
}

export function emitTelemetry(result) {
  const status = result.ok ? "ok" : "fail";
  console.log(
    `[${TELEMETRY_PREFIX}] result=${status} configs=${result.config_count} manifests=${result.manifest_entries} errors=${result.diagnostics.length}`,
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = validateTestingConfig(options);
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
    emitTelemetry({ ok: false, diagnostics: [String(error)], config_count: 0, manifest_entries: 0 });
    process.exit(1);
  }
}
