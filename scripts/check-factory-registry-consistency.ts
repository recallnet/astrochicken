#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TELEMETRY_PREFIX = "factory-registry-consistency";
const REQUIRED_INSTANCE_FIELDS = Object.freeze(["instance_id", "kind_id", "target_repo", "status"]);
const ALLOWED_INSTANCE_STATUSES = Object.freeze(["active", "paused", "retired"]);

function trim(value = "") {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function hasRequiredString(value) {
  return typeof value === "string" && trim(value).length > 0;
}

function collectFactoryKindDefinitions({ repoRoot, diagnostics }) {
  const factoriesRoot = join(repoRoot, "factories");
  const kindById = new Map();

  if (!existsSync(factoriesRoot)) {
    return {
      kindById,
      kindCount: 0,
    };
  }

  const kindDirectories = readdirSync(factoriesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("_"))
    .sort((left, right) => left.localeCompare(right, "en"));

  for (const kindDirName of kindDirectories) {
    const kindPath = join(factoriesRoot, kindDirName, "kind.json");
    if (!existsSync(kindPath)) {
      continue;
    }

    let parsed;
    try {
      parsed = readJson(kindPath);
    } catch (error) {
      diagnostics.push(`invalid_json file=${kindPath} message=${String(error?.message || error)}`);
      continue;
    }

    if (!isPlainObject(parsed)) {
      diagnostics.push(`invalid_shape file=${kindPath} message=kind.json must be a JSON object`);
      continue;
    }

    const kindId = trim(parsed.kind_id);
    if (!kindId) {
      diagnostics.push(`missing_required_field file=${kindPath} field=kind_id`);
      continue;
    }

    if (kindId !== kindDirName) {
      diagnostics.push(`kind_id_mismatch file=${kindPath} expected=${kindDirName} actual=${kindId}`);
    }

    const existing = kindById.get(kindId);
    if (existing) {
      diagnostics.push(`duplicate_kind_id kind_id=${kindId} first_file=${existing.path} duplicate_file=${kindPath}`);
      continue;
    }

    kindById.set(kindId, {
      kindId,
      path: kindPath,
      kindDirName,
    });
  }

  return {
    kindById,
    kindCount: kindById.size,
  };
}

function validateRegistry({ registryPath, diagnostics, requireInstances }) {
  if (!existsSync(registryPath)) {
    diagnostics.push(`missing_file file=${registryPath}`);
    return { instances: [], instanceCount: 0 };
  }

  let parsed;
  try {
    parsed = readJson(registryPath);
  } catch (error) {
    diagnostics.push(`invalid_json file=${registryPath} message=${String(error?.message || error)}`);
    return { instances: [], instanceCount: 0 };
  }

  if (!isPlainObject(parsed)) {
    diagnostics.push(`invalid_shape file=${registryPath} message=factory-registry.json must be a JSON object`);
    return { instances: [], instanceCount: 0 };
  }

  if (!Array.isArray(parsed.instances)) {
    const hasLegacyFactories = Array.isArray(parsed.factories);
    if (hasLegacyFactories && !requireInstances) {
      return { instances: [], instanceCount: 0 };
    }

    diagnostics.push(`missing_required_field file=${registryPath} field=instances`);
    return { instances: [], instanceCount: 0 };
  }

  const instances = [];
  for (let index = 0; index < parsed.instances.length; index += 1) {
    const instance = parsed.instances[index];
    if (!isPlainObject(instance)) {
      diagnostics.push(`invalid_shape file=${registryPath} entry=instances[${index}] message=instance must be a JSON object`);
      continue;
    }
    instances.push(instance);
  }

  return {
    instances,
    instanceCount: parsed.instances.length,
  };
}

function validateInstances({ instances, registryPath, kindById, diagnostics }) {
  const seenInstanceIds = new Map();

  for (let index = 0; index < instances.length; index += 1) {
    const instance = instances[index];

    for (const field of REQUIRED_INSTANCE_FIELDS) {
      if (!hasRequiredString(instance[field])) {
        diagnostics.push(`missing_required_field file=${registryPath} entry=instances[${index}] field=${field}`);
      }
    }

    const instanceId = trim(instance.instance_id);
    if (instanceId) {
      const firstIndex = seenInstanceIds.get(instanceId);
      if (firstIndex !== undefined) {
        diagnostics.push(`duplicate_instance_id file=${registryPath} instance_id=${instanceId} first_index=${firstIndex} duplicate_index=${index}`);
      } else {
        seenInstanceIds.set(instanceId, index);
      }
    }

    const kindId = trim(instance.kind_id);
    if (kindId && !kindById.has(kindId)) {
      diagnostics.push(`unknown_kind_id file=${registryPath} entry=instances[${index}] kind_id=${kindId}`);
    }

    const status = trim(instance.status);
    if (status && !ALLOWED_INSTANCE_STATUSES.includes(status)) {
      diagnostics.push(
        `invalid_status file=${registryPath} entry=instances[${index}] status=${status} allowed=${ALLOWED_INSTANCE_STATUSES.join(",")}`,
      );
    }
  }
}

function buildTelemetry({ ok, diagnosticsCount, kindCount, instanceCount }) {
  if (ok) {
    return `[${TELEMETRY_PREFIX}] result=ok kind_count=${kindCount} instance_count=${instanceCount}`;
  }

  return `[${TELEMETRY_PREFIX}] result=fail diagnostics=${diagnosticsCount} kind_count=${kindCount} instance_count=${instanceCount}`;
}

export function validateFactoryRegistryConsistency({ manifestsRoot = process.cwd(), requireInstances = false } = {}) {
  const repoRoot = resolve(manifestsRoot);
  const registryPath = join(repoRoot, "factory-registry.json");
  const diagnostics = [];

  const { kindById, kindCount } = collectFactoryKindDefinitions({
    repoRoot,
    diagnostics,
  });

  const registry = validateRegistry({
    registryPath,
    diagnostics,
    requireInstances,
  });

  validateInstances({
    instances: registry.instances,
    registryPath,
    kindById,
    diagnostics,
  });

  const sortedDiagnostics = [...diagnostics].sort((left, right) => left.localeCompare(right, "en"));
  const ok = sortedDiagnostics.length === 0;

  return {
    ok,
    manifestsRoot: repoRoot,
    diagnostics: sortedDiagnostics,
    kindCount,
    instanceCount: registry.instanceCount,
    telemetry: buildTelemetry({
      ok,
      diagnosticsCount: sortedDiagnostics.length,
      kindCount,
      instanceCount: registry.instanceCount,
    }),
  };
}

function parseArgs(argv) {
  const options = {
    manifestsRoot: process.cwd(),
    requireInstances: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--manifests") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--manifests requires a path");
      }
      options.manifestsRoot = resolve(value);
      index += 1;
      continue;
    }

    if (arg === "--require-instances") {
      options.requireInstances = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function usage() {
  return "Usage: node scripts/check-factory-registry-consistency.ts [--manifests <path>] [--require-instances]";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const result = validateFactoryRegistryConsistency({
    manifestsRoot: options.manifestsRoot,
    requireInstances: options.requireInstances,
  });

  if (!result.ok) {
    for (const diagnostic of result.diagnostics) {
      process.stderr.write(`${diagnostic}\n`);
    }
    process.stderr.write(`${result.telemetry}\n`);
    process.exit(1);
    return;
  }

  process.stdout.write(`${result.telemetry}\n`);
}

const isEntryPoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isEntryPoint) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.stderr.write(`[${TELEMETRY_PREFIX}] result=fail diagnostics=1 kind_count=0 instance_count=0\n`);
    process.exit(1);
  });
}
