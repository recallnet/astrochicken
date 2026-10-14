#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TELEMETRY_PREFIX = "whole_repo_quality_proof";
const DEFAULT_MANIFEST_DIR = "config/testing/package-test-manifests";
const DEFAULT_SPEC_REGISTRY = "config/testing/spec-registry.json";
const DEFAULT_OWNERSHIP = "config/testing/subsystem-ownership.json";

function argValues(argv, flag) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag && argv[index + 1]) {
      values.push(argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

function argValue(argv, flag) {
  const values = argValues(argv, flag);
  return values.length > 0 ? values[values.length - 1] : "";
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseArgs(argv) {
  return {
    repoRoot: argValue(argv, "--repo-root") || process.cwd(),
    manifestDir: argValue(argv, "--manifest-dir") || DEFAULT_MANIFEST_DIR,
    registryPath: argValue(argv, "--registry") || DEFAULT_SPEC_REGISTRY,
    ownershipPath: argValue(argv, "--ownership") || DEFAULT_OWNERSHIP,
    telemetryPrefix: argValue(argv, "--telemetry-prefix") || "pre-merge",
    executedSuiteNames: argValues(argv, "--executed-suite"),
    executedGateIds: argValues(argv, "--executed-gate"),
    json: argv.includes("--json"),
  };
}

function wildcardPatternToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesEntryPoint(pathValue, entrypoint) {
  if (entrypoint.endsWith("/**")) {
    const prefix = entrypoint.slice(0, -3);
    return pathValue === prefix || pathValue.startsWith(`${prefix}/`);
  }

  if (entrypoint.includes("*")) {
    return wildcardPatternToRegex(entrypoint).test(pathValue);
  }

  return pathValue === entrypoint || pathValue.startsWith(`${entrypoint}/`);
}

function loadPackageManifests(repoRoot, manifestDir) {
  const absoluteDir = resolve(repoRoot, manifestDir);
  if (!existsSync(absoluteDir)) {
    return { diagnostics: [`missing package test manifest directory: ${manifestDir}`], manifests: [] };
  }

  const manifests = [];
  const diagnostics = [];
  for (const entry of readdirSync(absoluteDir).filter((name) => name.endsWith(".json")).sort()) {
    const relativePath = `${manifestDir}/${entry}`;
    const absolutePath = resolve(repoRoot, relativePath);
    const manifest = readJson(absolutePath);
    if (!isRecord(manifest)) {
      diagnostics.push(`package manifest must be a JSON object: ${relativePath}`);
      continue;
    }
    manifests.push({
      relativePath,
      packageName: manifest.package_name,
      suites: Array.isArray(manifest.suites) ? manifest.suites : [],
    });
  }

  return { diagnostics, manifests };
}

function loadOwnership(repoRoot, ownershipPath) {
  const absolutePath = resolve(repoRoot, ownershipPath);
  if (!existsSync(absolutePath)) {
    return { diagnostics: [`missing subsystem ownership config: ${ownershipPath}`], owners: new Map() };
  }
  const ownership = readJson(absolutePath);
  if (!isRecord(ownership) || !Array.isArray(ownership.owners)) {
    return { diagnostics: [`invalid subsystem ownership config: ${ownershipPath}`], owners: new Map() };
  }
  return {
    diagnostics: [],
    owners: new Map(
      ownership.owners
        .filter((entry) => isRecord(entry) && typeof entry.id === "string")
        .map((entry) => [entry.id, entry]),
    ),
  };
}

function loadSpecRegistry(repoRoot, registryPath) {
  const absolutePath = resolve(repoRoot, registryPath);
  if (!existsSync(absolutePath)) {
    return { diagnostics: [`missing spec registry: ${registryPath}`], specs: [] };
  }
  const registry = readJson(absolutePath);
  if (!isRecord(registry) || !Array.isArray(registry.specs)) {
    return { diagnostics: [`invalid spec registry: ${registryPath}`], specs: [] };
  }
  return {
    diagnostics: [],
    specs: registry.specs.filter((entry) => isRecord(entry) && entry.status === "active").sort((left, right) => String(left.id).localeCompare(String(right.id))),
  };
}

export function buildWholeRepoQualityProof({
  repoRoot,
  manifestDir = DEFAULT_MANIFEST_DIR,
  registryPath = DEFAULT_SPEC_REGISTRY,
  ownershipPath = DEFAULT_OWNERSHIP,
  executedSuiteNames = [],
  executedGateIds = [],
} = {}) {
  const diagnostics = [];
  const manifestLoad = loadPackageManifests(repoRoot, manifestDir);
  const ownershipLoad = loadOwnership(repoRoot, ownershipPath);
  const registryLoad = loadSpecRegistry(repoRoot, registryPath);
  diagnostics.push(...manifestLoad.diagnostics, ...ownershipLoad.diagnostics, ...registryLoad.diagnostics);

  const suiteDefinitions = new Map();
  const aliases = new Map();
  for (const manifest of manifestLoad.manifests) {
    for (const suite of manifest.suites) {
      if (!isRecord(suite) || typeof suite.name !== "string") continue;
      const id = `${manifest.packageName}#${suite.name}`;
      if (suiteDefinitions.has(id)) {
        diagnostics.push(`duplicate package suite identity: ${id}`);
        continue;
      }
      const definition = {
        name: suite.name,
        packageName: manifest.packageName,
        manifestPath: manifest.relativePath,
        entrypoints: (Array.isArray(suite.entrypoints) ? suite.entrypoints : []).map((entrypoint) =>
          relative(repoRoot, resolve(repoRoot, suite.working_directory || ".", entrypoint)).replaceAll("\\", "/")),
      };
      suiteDefinitions.set(id, definition);
      aliases.set(suite.name, [...(aliases.get(suite.name) || []), definition]);
    }
  }

  const resolvedSuites = new Map();
  for (const name of executedSuiteNames) {
    const qualified = suiteDefinitions.get(name);
    const candidates = qualified ? [qualified] : [...new Set([
      ...(aliases.get(name) || []),
      ...(name.startsWith("test:") ? aliases.get(name.slice(5)) || [] : []),
    ])];
    if (candidates.length === 1) resolvedSuites.set(name, candidates[0]);
    else if (candidates.length > 1) diagnostics.push(`ambiguous executed suite name across package manifests: ${name}`);
    else diagnostics.push(`executed suite is not declared in any package manifest: ${name}`);
  }
  const packages = manifestLoad.manifests.map((manifest) => ({
    packageName: manifest.packageName,
    manifestPath: manifest.relativePath,
    executedSuites: [...new Set([...resolvedSuites.values()]
      .filter((suite) => suite.manifestPath === manifest.relativePath).map((suite) => suite.name))].sort(),
  }));

  const specs = [];
  const subsystemMap = new Map();

  for (const spec of registryLoad.specs) {
    const owner = ownershipLoad.owners.get(spec.owner_id);
    if (!owner) {
      diagnostics.push(`spec references unknown owner: ${spec.id} -> ${spec.owner_id}`);
      continue;
    }
    if (typeof spec.path !== "string" || !existsSync(resolve(repoRoot, spec.path))) {
      diagnostics.push(`missing spec file: ${spec.id} -> ${spec.path}`);
    }

    const provingSuites = new Set();
    for (const surface of Array.isArray(spec.test_surfaces) ? spec.test_surfaces : []) {
      if (!isRecord(surface) || typeof surface.path !== "string" || surface.path.trim() === "") {
        diagnostics.push(`invalid test surface on spec ${spec.id}`);
        continue;
      }
      if (!existsSync(resolve(repoRoot, surface.path))) {
        diagnostics.push(`missing test surface file: ${spec.id} -> ${surface.path}`);
        continue;
      }
      let matched = false;
      for (const suiteName of executedSuiteNames) {
        const suite = resolvedSuites.get(suiteName);
        if (!suite) continue;
        if (suite.entrypoints.some((entrypoint) => matchesEntryPoint(surface.path, entrypoint))) {
          provingSuites.add(suiteName);
          matched = true;
        }
      }
      if (!matched) {
        diagnostics.push(`unproven test surface for spec ${spec.id}: ${surface.path}`);
      }
    }

    const sortedSuites = [...provingSuites].sort();
    specs.push({
      id: spec.id,
      subsystem: spec.subsystem,
      ownerId: spec.owner_id,
      provingSuites: sortedSuites,
      surfaceCount: Array.isArray(spec.test_surfaces) ? spec.test_surfaces.length : 0,
    });

    const subsystemEntry = subsystemMap.get(spec.subsystem) || {
      subsystem: spec.subsystem,
      ownerIds: new Set(),
      specIds: [],
      provingSuites: new Set(),
    };
    subsystemEntry.ownerIds.add(spec.owner_id);
    subsystemEntry.specIds.push(spec.id);
    for (const suiteName of sortedSuites) {
      subsystemEntry.provingSuites.add(suiteName);
    }
    subsystemMap.set(spec.subsystem, subsystemEntry);
  }

  const subsystems = [...subsystemMap.values()]
    .map((entry) => ({
      subsystem: entry.subsystem,
      ownerIds: [...entry.ownerIds].sort(),
      specIds: entry.specIds.sort(),
      provingSuites: [...entry.provingSuites].sort(),
    }))
    .sort((left, right) => left.subsystem.localeCompare(right.subsystem));

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    executedGateIds: [...executedGateIds].sort(),
    executedSuiteNames: [...executedSuiteNames].sort(),
    packages: packages.sort((left, right) => String(left.packageName).localeCompare(String(right.packageName))),
    subsystems,
    specs: specs.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function emitWholeRepoQualityProof(result) {
  console.log(
    `[${TELEMETRY_PREFIX}] result=${result.ok ? "ok" : "fail"} gates=${result.executedGateIds.length} suites=${result.executedSuiteNames.length} packages=${result.packages.length} subsystems=${result.subsystems.length} specs=${result.specs.length} errors=${result.diagnostics.length}`,
  );
  if (!result.ok) {
    for (const diagnostic of result.diagnostics) {
      console.log(`[${TELEMETRY_PREFIX}] diagnostic=${JSON.stringify(diagnostic)}`);
    }
    return;
  }

  if (result.executedGateIds.length > 0) {
    console.log(`[${TELEMETRY_PREFIX}] executed_gates=${result.executedGateIds.join(",")}`);
  }
  if (result.executedSuiteNames.length > 0) {
    console.log(`[${TELEMETRY_PREFIX}] executed_suites=${result.executedSuiteNames.join(",")}`);
  }
  for (const pkg of result.packages) {
    console.log(
      `[${TELEMETRY_PREFIX}] package=${JSON.stringify(pkg.packageName)} suites=${pkg.executedSuites.length > 0 ? pkg.executedSuites.join(",") : "none"} manifest=${JSON.stringify(pkg.manifestPath)}`,
    );
  }
  for (const subsystem of result.subsystems) {
    console.log(
      `[${TELEMETRY_PREFIX}] subsystem=${subsystem.subsystem} owners=${subsystem.ownerIds.join(",")} specs=${subsystem.specIds.join(",")} suites=${subsystem.provingSuites.length > 0 ? subsystem.provingSuites.join(",") : "none"}`,
    );
  }
  for (const spec of result.specs) {
    console.log(
      `[${TELEMETRY_PREFIX}] spec=${spec.id} subsystem=${spec.subsystem} owner=${spec.ownerId} suites=${spec.provingSuites.length > 0 ? spec.provingSuites.join(",") : "none"} surfaces=${spec.surfaceCount}`,
    );
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = buildWholeRepoQualityProof(options);
  emitWholeRepoQualityProof(result);
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
    const result = {
      ok: false,
      diagnostics: [String(error?.message || error)],
      executedGateIds: [],
      executedSuiteNames: [],
      packages: [],
      subsystems: [],
      specs: [],
    };
    emitWholeRepoQualityProof(result);
    process.exit(1);
  }
}
