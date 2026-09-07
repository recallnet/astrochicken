#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TELEMETRY_PREFIX = "factory-env-contracts";
const FACTORY_CONTRACT_SCHEMA = "hatch.factory.env-contract.v1";
const SHARED_CONTRACT_SCHEMA = "hatch.shared.env-contract.v1";
const SHARED_CONTRACT_PATH = join("config", "testing", "factory-env", "shared-env.contract.json");
const ENV_EXAMPLE_FILENAME = ".env.example";
const VARIABLE_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const COMMENT_WIDTH = 88;

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

function wrapComment(text) {
  const normalized = trim(text);
  if (!normalized) {
    return [];
  }

  const words = normalized.split(/\s+/g);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= COMMENT_WIDTH) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
    }
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function collectFactoryDirectories(repoRoot) {
  const factoriesRoot = join(repoRoot, "factories");
  if (!existsSync(factoriesRoot)) {
    return [];
  }

  return readdirSync(factoriesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("_"))
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((name) => ({
      factoryId: name,
      root: join(factoriesRoot, name),
      configPath: join(factoriesRoot, name, "factory.config.json"),
      contractPath: join(factoriesRoot, name, "env.contract.json"),
      examplePath: join(factoriesRoot, name, ENV_EXAMPLE_FILENAME),
    }))
    .filter(({ configPath }) => existsSync(configPath));
}

function validateVariableEntry({ entry, filePath, index, diagnostics }) {
  if (!isPlainObject(entry)) {
    diagnostics.push(`invalid_shape file=${filePath} entry=variables[${index}] message=variable must be an object`);
    return null;
  }

  const name = trim(entry.name);
  const description = trim(entry.description);

  if (!VARIABLE_NAME_PATTERN.test(name)) {
    diagnostics.push(`invalid_variable_name file=${filePath} entry=variables[${index}] value=${name || "<empty>"}`);
  }
  if (!description) {
    diagnostics.push(`missing_required_field file=${filePath} entry=variables[${index}] field=description`);
  }
  if (typeof entry.required !== "boolean") {
    diagnostics.push(`invalid_shape file=${filePath} entry=variables[${index}] field=required message=required must be boolean`);
  }
  if (typeof entry.secret !== "boolean") {
    diagnostics.push(`invalid_shape file=${filePath} entry=variables[${index}] field=secret message=secret must be boolean`);
  }
  if ("example" in entry && entry.example !== null && typeof entry.example !== "string") {
    diagnostics.push(`invalid_shape file=${filePath} entry=variables[${index}] field=example message=example must be string or null`);
  }

  return {
    name,
    description,
    required: Boolean(entry.required),
    secret: Boolean(entry.secret),
    example: typeof entry.example === "string" ? entry.example : "",
  };
}

function validateSharedContract(sharedContractPath, diagnostics) {
  if (!existsSync(sharedContractPath)) {
    diagnostics.push(`missing_file file=${sharedContractPath}`);
    return [];
  }

  let parsed;
  try {
    parsed = readJson(sharedContractPath);
  } catch (error) {
    diagnostics.push(`invalid_json file=${sharedContractPath} message=${String(error?.message || error)}`);
    return [];
  }

  if (!isPlainObject(parsed)) {
    diagnostics.push(`invalid_shape file=${sharedContractPath} message=shared env contract must be a JSON object`);
    return [];
  }

  if (trim(parsed.schema) !== SHARED_CONTRACT_SCHEMA) {
    diagnostics.push(`schema_mismatch file=${sharedContractPath} expected=${SHARED_CONTRACT_SCHEMA} actual=${trim(parsed.schema) || "<empty>"}`);
  }

  if (!Array.isArray(parsed.variables)) {
    diagnostics.push(`missing_required_field file=${sharedContractPath} field=variables`);
    return [];
  }

  const entries = [];
  const seen = new Set();
  for (let index = 0; index < parsed.variables.length; index += 1) {
    const normalized = validateVariableEntry({
      entry: parsed.variables[index],
      filePath: sharedContractPath,
      index,
      diagnostics,
    });
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized.name)) {
      diagnostics.push(`duplicate_variable file=${sharedContractPath} name=${normalized.name}`);
      continue;
    }
    seen.add(normalized.name);
    entries.push(normalized);
  }

  return entries;
}

function validateFactoryContract(factory, diagnostics) {
  if (!existsSync(factory.contractPath)) {
    diagnostics.push(`missing_file file=${factory.contractPath}`);
    return { parsed: {}, variables: [] };
  }

  let parsed;
  try {
    parsed = readJson(factory.contractPath);
  } catch (error) {
    diagnostics.push(`invalid_json file=${factory.contractPath} message=${String(error?.message || error)}`);
    return { parsed: {}, variables: [] };
  }

  if (!isPlainObject(parsed)) {
    diagnostics.push(`invalid_shape file=${factory.contractPath} message=factory env contract must be a JSON object`);
    return { parsed: {}, variables: [] };
  }

  if (trim(parsed.schema) !== FACTORY_CONTRACT_SCHEMA) {
    diagnostics.push(`schema_mismatch file=${factory.contractPath} expected=${FACTORY_CONTRACT_SCHEMA} actual=${trim(parsed.schema) || "<empty>"}`);
  }
  if (trim(parsed.factory_id) !== factory.factoryId) {
    diagnostics.push(`factory_id_mismatch file=${factory.contractPath} expected=${factory.factoryId} actual=${trim(parsed.factory_id) || "<empty>"}`);
  }
  if (!Array.isArray(parsed.variables)) {
    diagnostics.push(`missing_required_field file=${factory.contractPath} field=variables`);
    return { parsed, variables: [] };
  }

  const variables = [];
  const seen = new Set();
  for (let index = 0; index < parsed.variables.length; index += 1) {
    const normalized = validateVariableEntry({
      entry: parsed.variables[index],
      filePath: factory.contractPath,
      index,
      diagnostics,
    });
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized.name)) {
      diagnostics.push(`duplicate_variable file=${factory.contractPath} name=${normalized.name}`);
      continue;
    }
    seen.add(normalized.name);
    variables.push(normalized);
  }

  return { parsed, variables };
}

function mergeVariables(sharedVariables, localVariables) {
  const merged = [];
  const localByName = new Map(localVariables.map((entry) => [entry.name, entry]));

  for (const sharedEntry of sharedVariables) {
    merged.push(localByName.get(sharedEntry.name) || sharedEntry);
    localByName.delete(sharedEntry.name);
  }

  for (const localEntry of localVariables) {
    if (localByName.has(localEntry.name)) {
      merged.push(localEntry);
      localByName.delete(localEntry.name);
    }
  }

  return {
    effective: merged,
    localOnly: localVariables.filter((entry) => !sharedVariables.some((shared) => shared.name === entry.name)),
  };
}

function collectJsonFiles(rootDir) {
  const discovered = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"));

    for (const entry of entries) {
      const absolutePath = join(current, entry.name);
      if (entry.name.startsWith(".")) {
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      if (entry.name === "env.contract.json") {
        continue;
      }
      discovered.push(absolutePath);
    }
  }

  return discovered.sort((left, right) => left.localeCompare(right, "en"));
}

function collectReferencedEnvVariables(factoryRoot) {
  const referenced = new Map();
  const jsonFiles = collectJsonFiles(factoryRoot);
  const envInterpolationPattern = /\$\{([A-Z][A-Z0-9_]+)\}/g;
  const envVarFieldPattern = /"envVar"\s*:\s*"([A-Z][A-Z0-9_]+)"/g;

  for (const filePath of jsonFiles) {
    const text = readFileSync(filePath, "utf8");
    for (const match of text.matchAll(envInterpolationPattern)) {
      if (!referenced.has(match[1])) {
        referenced.set(match[1], filePath);
      }
    }
    for (const match of text.matchAll(envVarFieldPattern)) {
      if (!referenced.has(match[1])) {
        referenced.set(match[1], filePath);
      }
    }
  }

  return referenced;
}

function renderSection(title, variables) {
  if (variables.length === 0) {
    return [];
  }

  const lines = [`# ${title}`];
  for (const variable of variables) {
    lines.push(`# ${variable.required ? "Required" : "Optional"} · ${variable.secret ? "secret" : "non-secret"}`);
    for (const descriptionLine of wrapComment(variable.description)) {
      lines.push(`# ${descriptionLine}`);
    }
    lines.push(`${variable.name}=${variable.example}`);
    lines.push("");
  }

  while (lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }

  return lines;
}

export function renderFactoryEnvExample({ factoryId, sharedVariables, localOnlyVariables, mergedVariables }) {
  const localNames = new Set(localOnlyVariables.map((entry) => entry.name));
  const sharedSectionVariables = mergedVariables.filter((entry) => !localNames.has(entry.name));

  const lines = [
    `# ${factoryId} factory environment example`,
    "# Generated from config/testing/factory-env/shared-env.contract.json and factories/<factory>/env.contract.json.",
    "# Update the contracts, then run: node scripts/check-factory-env-contracts.ts --write",
    "",
    ...renderSection("Shared runtime env", sharedSectionVariables),
  ];

  const localSection = renderSection("Factory-specific env", localOnlyVariables);
  if (localSection.length > 0) {
    lines.push("");
    lines.push(...localSection);
  }

  while (lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }
  return `${lines.join("\n")}\n`;
}

function validateFactoryExample({ factory, expected, write }, diagnostics) {
  if (write) {
    mkdirSync(dirname(factory.examplePath), { recursive: true });
    writeFileSync(factory.examplePath, expected);
    return;
  }

  if (!existsSync(factory.examplePath)) {
    diagnostics.push(`missing_file file=${factory.examplePath}`);
    return;
  }

  const actual = readFileSync(factory.examplePath, "utf8");
  if (actual !== expected) {
    diagnostics.push(`stale_example file=${factory.examplePath}`);
  }
}

function buildTelemetry({ ok, factoryCount, diagnosticsCount, sharedVariableCount }) {
  if (ok) {
    return `[${TELEMETRY_PREFIX}] result=ok factory_count=${factoryCount} shared_variable_count=${sharedVariableCount}`;
  }
  return `[${TELEMETRY_PREFIX}] result=fail diagnostics=${diagnosticsCount} factory_count=${factoryCount} shared_variable_count=${sharedVariableCount}`;
}

export function validateFactoryEnvContracts({ manifestsRoot = process.cwd(), write = false } = {}) {
  const repoRoot = resolve(manifestsRoot);
  const diagnostics = [];
  const sharedContractPath = join(repoRoot, SHARED_CONTRACT_PATH);
  const sharedVariables = validateSharedContract(sharedContractPath, diagnostics);
  const factories = collectFactoryDirectories(repoRoot);

  for (const factory of factories) {
    const { variables: localVariables } = validateFactoryContract(factory, diagnostics);
    const { effective, localOnly } = mergeVariables(sharedVariables, localVariables);
    const declaredNames = new Set(effective.map((entry) => entry.name));
    const referencedVariables = collectReferencedEnvVariables(factory.root);

    for (const [envName, sourcePath] of referencedVariables.entries()) {
      if (!declaredNames.has(envName)) {
        diagnostics.push(`undeclared_env_reference factory=${factory.factoryId} env=${envName} source=${relative(repoRoot, sourcePath)}`);
      }
    }

    const expectedExample = renderFactoryEnvExample({
      factoryId: factory.factoryId,
      sharedVariables,
      localOnlyVariables: localOnly,
      mergedVariables: effective,
    });
    validateFactoryExample({ factory, expected: expectedExample, write }, diagnostics);
  }

  const sortedDiagnostics = [...diagnostics].sort((left, right) => left.localeCompare(right, "en"));
  const ok = sortedDiagnostics.length === 0;

  return {
    ok,
    manifestsRoot: repoRoot,
    diagnostics: sortedDiagnostics,
    factoryCount: factories.length,
    sharedVariableCount: sharedVariables.length,
    telemetry: buildTelemetry({
      ok,
      factoryCount: factories.length,
      diagnosticsCount: sortedDiagnostics.length,
      sharedVariableCount: sharedVariables.length,
    }),
  };
}

function parseArgs(argv) {
  const options = {
    manifestsRoot: process.cwd(),
    write: false,
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

    if (arg === "--write") {
      options.write = true;
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
  return "Usage: node scripts/check-factory-env-contracts.ts [--manifests <path>] [--write]";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const result = validateFactoryEnvContracts(options);
  if (result.ok) {
    process.stdout.write(`${result.telemetry}\n`);
    return;
  }

  for (const diagnostic of result.diagnostics) {
    process.stderr.write(`${diagnostic}\n`);
  }
  process.stderr.write(`${result.telemetry}\n`);
  process.exitCode = 1;
}

const isEntryPoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isEntryPoint) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exit(1);
  });
}
