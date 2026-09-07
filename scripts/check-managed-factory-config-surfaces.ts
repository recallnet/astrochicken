#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TELEMETRY_PREFIX = "managed-factory-config-surfaces";
const REQUIRED_KIND_FIELDS = Object.freeze(["kind_id", "execution_mode", "shared_supervisor_shell"]);
const REQUIRED_INSTANCE_FIELDS = Object.freeze(["instance_id", "kind_id", "target_repo", "status"]);
const WORKSPACE_MODES = new Set(["api_only", "checkout", "worktree"]);

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

function collectForbiddenKeyLocations(value, forbiddenKey, pathPrefix = "$") {
  const locations = [];

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      locations.push(...collectForbiddenKeyLocations(value[index], forbiddenKey, `${pathPrefix}[${index}]`));
    }
    return locations;
  }

  if (!isPlainObject(value)) {
    return locations;
  }

  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right, "en"));
  for (const [key, nestedValue] of entries) {
    const nestedPath = `${pathPrefix}.${key}`;
    if (key === forbiddenKey) {
      locations.push(nestedPath);
    }
    locations.push(...collectForbiddenKeyLocations(nestedValue, forbiddenKey, nestedPath));
  }

  return locations;
}

function collectFactoryKindDirectories(repoRoot) {
  const factoriesRoot = join(repoRoot, "factories");
  if (!existsSync(factoriesRoot)) {
    return [];
  }

  const dirs = readdirSync(factoriesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("_"))
    .sort((left, right) => left.localeCompare(right, "en"));

  return dirs.map((name) => ({
    name,
    root: join(factoriesRoot, name),
    kindPath: join(factoriesRoot, name, "kind.json"),
    configPath: join(factoriesRoot, name, "factory.config.json"),
  }));
}

function validateKindFile({ kindPath, kindDirName, diagnostics, kindFiles, shouldValidate }) {
  if (!shouldValidate || !existsSync(kindPath)) {
    return;
  }

  let parsed;
  try {
    parsed = readJson(kindPath);
  } catch (error) {
    diagnostics.push(`invalid_json file=${kindPath} message=${String(error?.message || error)}`);
    return;
  }

  kindFiles.push({ path: kindPath, parsed, kindDirName });

  if (!isPlainObject(parsed)) {
    diagnostics.push(`invalid_shape file=${kindPath} message=kind.json must be a JSON object`);
    return;
  }

  for (const field of REQUIRED_KIND_FIELDS) {
    if (!hasRequiredString(parsed[field])) {
      diagnostics.push(`missing_required_field file=${kindPath} field=${field}`);
    }
  }

  const declaredKindId = trim(parsed.kind_id);
  if (declaredKindId && declaredKindId !== kindDirName) {
    diagnostics.push(`kind_id_mismatch file=${kindPath} expected=${kindDirName} actual=${declaredKindId}`);
  }

}

function validateFactoryConfigTargetRepo(configPath, diagnostics) {
  if (!existsSync(configPath)) {
    return;
  }

  let parsed;
  try {
    parsed = readJson(configPath);
  } catch (error) {
    diagnostics.push(`invalid_json file=${configPath} message=${String(error?.message || error)}`);
    return;
  }

  if (!isPlainObject(parsed)) {
    diagnostics.push(`invalid_shape file=${configPath} message=factory.config.json must be a JSON object`);
    return;
  }

  return parsed;
}

function validateInstanceTemplate(templatePath, diagnostics) {
  if (!existsSync(templatePath)) {
    diagnostics.push(`missing_file file=${templatePath}`);
    return {};
  }

  let parsed;
  try {
    parsed = readJson(templatePath);
  } catch (error) {
    diagnostics.push(`invalid_json file=${templatePath} message=${String(error?.message || error)}`);
    return {};
  }

  if (!isPlainObject(parsed)) {
    diagnostics.push(`invalid_shape file=${templatePath} message=instance.template.json must be a JSON object`);
    return {};
  }

  return parsed;
}

function hasManagedShellHooks(parsed = {}) {
  if (!isPlainObject(parsed)) return false;
  const hooks = isPlainObject(parsed.shell_hooks) ? parsed.shell_hooks : {};
  return hasRequiredString(hooks.managed_load_context) || hasRequiredString(hooks.managed_domain_contract);
}

function validateManagedRuntimeReadiness({
  kindPath,
  kindDoc = {},
  configPath,
  configDoc = {},
  templatePath,
  templateDoc = {},
  registryPath,
  registryInstance = {},
  diagnostics,
}) {
  if (!hasManagedShellHooks(kindDoc)) {
    return;
  }

  const kindWorkspaceMode = trim(kindDoc.default_workspace_mode);
  if (!hasRequiredString(kindWorkspaceMode)) {
    diagnostics.push(`missing_required_field file=${kindPath} field=default_workspace_mode`);
  } else if (!WORKSPACE_MODES.has(kindWorkspaceMode)) {
    diagnostics.push(`invalid_value file=${kindPath} field=default_workspace_mode value=${kindWorkspaceMode}`);
  }

  const configWorkspaceMode = trim(configDoc.workspace_mode);
  if (!hasRequiredString(configWorkspaceMode)) {
    diagnostics.push(`missing_required_field file=${configPath} field=workspace_mode`);
  } else if (!WORKSPACE_MODES.has(configWorkspaceMode)) {
    diagnostics.push(`invalid_value file=${configPath} field=workspace_mode value=${configWorkspaceMode}`);
  }

  for (const field of ["service_registry_path", "installation_manifest_path"]) {
    if (!hasRequiredString(configDoc[field])) {
      diagnostics.push(`missing_required_field file=${configPath} field=${field}`);
    }
  }

  const templateWorkspaceMode = trim(templateDoc.workspace_mode);
  if (!hasRequiredString(templateWorkspaceMode)) {
    diagnostics.push(`missing_required_field file=${templatePath} field=workspace_mode`);
  } else if (!WORKSPACE_MODES.has(templateWorkspaceMode)) {
    diagnostics.push(`invalid_value file=${templatePath} field=workspace_mode value=${templateWorkspaceMode}`);
  }

  if (configWorkspaceMode && templateWorkspaceMode && configWorkspaceMode !== templateWorkspaceMode) {
    diagnostics.push(`workspace_mode_mismatch config=${configPath} template=${templatePath} config_mode=${configWorkspaceMode} template_mode=${templateWorkspaceMode}`);
  }
  if (kindWorkspaceMode && configWorkspaceMode && kindWorkspaceMode !== configWorkspaceMode) {
    diagnostics.push(`workspace_mode_mismatch kind=${kindPath} config=${configPath} kind_mode=${kindWorkspaceMode} config_mode=${configWorkspaceMode}`);
  }

  const effectiveWorkspaceMode = configWorkspaceMode || templateWorkspaceMode || kindWorkspaceMode;
  if ((effectiveWorkspaceMode === "checkout" || effectiveWorkspaceMode === "worktree") && !hasRequiredString(configDoc.work_dir)) {
    diagnostics.push(`missing_required_field file=${configPath} field=work_dir`);
  }

  if (!hasRequiredString(registryInstance.installation_manifest_path)) {
    diagnostics.push(`missing_required_field file=${registryPath} entry=instances[${registryInstance.__index ?? "?"}] field=installation_manifest_path`);
  }
}

function validateRegistry({ registryPath, diagnostics, requireInstances }) {
  if (!existsSync(registryPath)) {
    diagnostics.push(`missing_file file=${registryPath}`);
    return { instanceCount: 0, instances: [] };
  }

  let parsed;
  try {
    parsed = readJson(registryPath);
  } catch (error) {
    diagnostics.push(`invalid_json file=${registryPath} message=${String(error?.message || error)}`);
    return { instanceCount: 0, instances: [] };
  }

  if (!isPlainObject(parsed)) {
    diagnostics.push(`invalid_shape file=${registryPath} message=factory-registry.json must be a JSON object`);
    return { instanceCount: 0, instances: [] };
  }

  if (!Array.isArray(parsed.instances)) {
    const hasLegacyFactories = Array.isArray(parsed.factories);
    if (hasLegacyFactories && !requireInstances) {
      return { instanceCount: 0, instances: [] };
    }

    diagnostics.push(`missing_required_field file=${registryPath} field=instances`);
    return { instanceCount: 0, instances: [] };
  }

  const instances = [];
  for (let index = 0; index < parsed.instances.length; index += 1) {
    const instance = parsed.instances[index];
    if (!isPlainObject(instance)) {
      diagnostics.push(`invalid_shape file=${registryPath} entry=instances[${index}] message=instance must be a JSON object`);
      continue;
    }

    instances.push({ ...instance, __index: index });

    for (const field of REQUIRED_INSTANCE_FIELDS) {
      if (!hasRequiredString(instance[field])) {
        diagnostics.push(`missing_required_field file=${registryPath} entry=instances[${index}] field=${field}`);
      }
    }
  }

  return { instanceCount: parsed.instances.length, instances };
}

function buildTelemetry({ ok, diagnosticsCount, kindCount, instanceCount }) {
  if (ok) {
    return `[${TELEMETRY_PREFIX}] result=ok kind_count=${kindCount} instance_count=${instanceCount}`;
  }
  return `[${TELEMETRY_PREFIX}] result=fail diagnostics=${diagnosticsCount} kind_count=${kindCount} instance_count=${instanceCount}`;
}

export function validateManagedFactoryConfigSurfaces({ manifestsRoot = process.cwd(), requireInstances = false } = {}) {
  const repoRoot = resolve(manifestsRoot);
  const diagnostics = [];
  const kindFiles = [];

  const registry = validateRegistry({
    registryPath: join(repoRoot, "factory-registry.json"),
    diagnostics,
    requireInstances,
  });

  const registryKindIds = new Set((registry.instances || []).map((entry) => trim(entry.kind_id)).filter(Boolean));

  const kindDirectories = collectFactoryKindDirectories(repoRoot);
  for (const kindDirectory of kindDirectories) {
    const shouldValidateKind = registryKindIds.has(kindDirectory.name);
    if (!shouldValidateKind) {
      continue;
    }

    if (!existsSync(kindDirectory.kindPath)) {
      diagnostics.push(`missing_file file=${kindDirectory.kindPath}`);
    }

    validateKindFile({
      kindPath: kindDirectory.kindPath,
      kindDirName: kindDirectory.name,
      diagnostics,
      kindFiles,
      shouldValidate: shouldValidateKind,
    });
    const configDoc = validateFactoryConfigTargetRepo(kindDirectory.configPath, diagnostics);
    const kindDoc = kindFiles.find((entry) => entry.path === kindDirectory.kindPath)?.parsed || {};
    const templatePath = join(kindDirectory.root, "instance.template.json");
    const templateDoc = hasManagedShellHooks(kindDoc) ? validateInstanceTemplate(templatePath, diagnostics) : {};
    const registryInstance = (registry.instances || []).find((entry) => trim(entry.kind_id) === kindDirectory.name) || {};

    validateManagedRuntimeReadiness({
      kindPath: kindDirectory.kindPath,
      kindDoc,
      configPath: kindDirectory.configPath,
      configDoc,
      templatePath,
      templateDoc,
      registryPath: join(repoRoot, "factory-registry.json"),
      registryInstance,
      diagnostics,
    });
  }

  const kindCount = registryKindIds.size;
  const instanceCount = registry.instanceCount;
  const sortedDiagnostics = [...diagnostics].sort((left, right) => left.localeCompare(right, "en"));
  const ok = sortedDiagnostics.length === 0;

  return {
    ok,
    manifestsRoot: repoRoot,
    diagnostics: sortedDiagnostics,
    kindCount,
    instanceCount,
    telemetry: buildTelemetry({
      ok,
      diagnosticsCount: sortedDiagnostics.length,
      kindCount,
      instanceCount,
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
  return "Usage: node scripts/check-managed-factory-config-surfaces.ts [--manifests <path>] [--require-instances]";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const result = validateManagedFactoryConfigSurfaces({
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
