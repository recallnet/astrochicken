#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { formatPlatformInvariantTelemetry } from "./lib/platform-invariant-telemetry.ts";

// Emits deterministic telemetry marker: [managed-factory-telemetry-contract] result=ok|fail ...
const TELEMETRY_PREFIX = "managed-factory-telemetry-contract";
const DEFAULT_CONTRACT_PATH = "scripts/fixtures/managed-factory-telemetry-contract.json";
const DAEMON_RELATIVE_PATH = "packages/factory-ops/src/lib/daemon.ts";
const FACTORY_RUNTIME_ROOT = "packages/factory-runtime";

const TELEMETRY_EVENTS_CONSTANT = "MANAGED_FACTORY_TELEMETRY_EVENTS";
const SNAPSHOT_SCHEMA_CONSTANT = "MANAGED_FACTORY_DAEMON_STATE_SNAPSHOT_SCHEMA";

function trim(value = "") {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function extractStringArray(source = "") {
  const values = [];
  const tokenRegex = /["']([^"'\\]*(?:\\.[^"'\\]*)*)["']/g;
  for (const token of String(source || "").matchAll(tokenRegex)) {
    values.push(String(token[1] || ""));
  }
  return values;
}

function readObjectFreezeBlock(source = "", constantName = "") {
  const blockRegex = new RegExp(
    `export\\s+const\\s+${constantName}\\s*=\\s*Object\\.freeze\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`,
    "m",
  );
  const match = blockRegex.exec(source);
  return match ? String(match[1] || "") : "";
}

function readArrayFreezeBlock(source = "", constantName = "") {
  const marker = `export const ${constantName} = Object.freeze([`;
  const sourceText = String(source || "");
  const markerIndex = sourceText.indexOf(marker);
  if (markerIndex < 0) {
    return "";
  }

  const arrayStart = sourceText.indexOf("[", markerIndex + marker.length - 1);
  if (arrayStart < 0) {
    return "";
  }

  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let index = arrayStart; index < sourceText.length; index += 1) {
    const char = sourceText[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }

    if (char === "[") {
      depth += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return sourceText.slice(arrayStart + 1, index);
      }
    }
  }

  return "";
}

function extractRequiredFieldsFromObjectBody(objectBody = "") {
  const requiredObjectFreeze = /required_fields\s*:\s*Object\.freeze\(\s*\[([\s\S]*?)\]\s*\)/m.exec(objectBody);
  if (requiredObjectFreeze) {
    return extractStringArray(requiredObjectFreeze[1]);
  }

  const requiredArrayLiteral = /required_fields\s*:\s*\[([\s\S]*?)\]/m.exec(objectBody);
  if (requiredArrayLiteral) {
    return extractStringArray(requiredArrayLiteral[1]);
  }

  return [];
}

function extractTelemetryEventDefinitions(source = "", filePath = "", diagnostics = []) {
  const body = readArrayFreezeBlock(source, TELEMETRY_EVENTS_CONSTANT);
  if (!body) {
    return [];
  }

  const events = [];
  const objectRegex = /Object\.freeze\(\s*\{([\s\S]*?)\}\s*\)/g;
  for (const match of body.matchAll(objectRegex)) {
    const objectBody = String(match[1] || "");
    const eventMatch = /event\s*:\s*["']([^"'\\]*(?:\\.[^"'\\]*)*)["']/.exec(objectBody);
    const eventName = trim(eventMatch?.[1] || "");
    if (!eventName) {
      diagnostics.push(`invalid_telemetry_event_definition file=${filePath} reason=missing_event_name`);
      continue;
    }

    const requiredFields = [...new Set(extractRequiredFieldsFromObjectBody(objectBody))]
      .sort((left, right) => left.localeCompare(right, "en"));

    if (requiredFields.length === 0) {
      diagnostics.push(`invalid_telemetry_event_definition file=${filePath} event=${eventName} reason=missing_required_fields`);
      continue;
    }

    events.push({
      event: eventName,
      requiredFields,
      filePath,
    });
  }

  return events;
}

function extractDaemonSnapshotSchema(source = "") {
  const objectBody = readObjectFreezeBlock(source, SNAPSHOT_SCHEMA_CONSTANT);
  if (!objectBody) {
    return null;
  }

  const requiredFields = [...new Set(extractRequiredFieldsFromObjectBody(objectBody))]
    .sort((left, right) => left.localeCompare(right, "en"));

  return {
    requiredFields,
  };
}

function collectMjsFiles(rootPath = "") {
  if (!existsSync(rootPath)) {
    return [];
  }

  const files = [];
  const queue = [rootPath];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;

    const entries = readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"));

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".mjs")) {
        files.push(fullPath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right, "en"));
}

function normalizeContract(contract = {}, diagnostics = []) {
  if (!isPlainObject(contract)) {
    diagnostics.push("invalid_contract reason=contract_must_be_json_object");
    return {
      events: new Map(),
      daemonSnapshotRequiredFields: [],
    };
  }

  const events = new Map();
  const contractEvents = Array.isArray(contract.events) ? contract.events : [];
  for (const definition of contractEvents) {
    const eventName = trim(definition?.event || "");
    if (!eventName) {
      diagnostics.push("invalid_contract_event reason=missing_event_name");
      continue;
    }

    const requiredFields = Array.isArray(definition?.required_fields)
      ? definition.required_fields.map((field) => trim(field)).filter(Boolean)
      : [];

    if (requiredFields.length === 0) {
      diagnostics.push(`invalid_contract_event event=${eventName} reason=missing_required_fields`);
      continue;
    }

    events.set(
      eventName,
      [...new Set(requiredFields)].sort((left, right) => left.localeCompare(right, "en")),
    );
  }

  const daemonSnapshot = isPlainObject(contract.daemon_state_snapshot_schema)
    ? contract.daemon_state_snapshot_schema
    : {};

  const daemonSnapshotRequiredFields = Array.isArray(daemonSnapshot.required_fields)
    ? [...new Set(daemonSnapshot.required_fields.map((field) => trim(field)).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, "en"))
    : [];

  if (daemonSnapshotRequiredFields.length === 0) {
    diagnostics.push("invalid_contract reason=missing_daemon_state_snapshot_required_fields");
  }

  return {
    events,
    daemonSnapshotRequiredFields,
  };
}

function compareRequiredFieldSets({ expected = [], actual = [], diagnostics = [], basePrefix = "" }) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  for (const field of [...expectedSet].sort((left, right) => left.localeCompare(right, "en"))) {
    if (!actualSet.has(field)) {
      diagnostics.push(`${basePrefix}missing_required_field field=${field}`);
    }
  }

  for (const field of [...actualSet].sort((left, right) => left.localeCompare(right, "en"))) {
    if (!expectedSet.has(field)) {
      diagnostics.push(`${basePrefix}undocumented_field field=${field}`);
    }
  }
}

function buildTelemetry({ ok, diagnosticsCount, filesChecked, eventsChecked, daemonSchemaFields }) {
  return formatPlatformInvariantTelemetry({
    prefix: TELEMETRY_PREFIX,
    ok,
    diagnosticsCount,
    fields: {
      files_checked: filesChecked,
      events_checked: eventsChecked,
      daemon_schema_fields: daemonSchemaFields,
    },
  });
}

export function validateManagedFactoryTelemetryContract({
  manifestsRoot = process.cwd(),
  contractPath = DEFAULT_CONTRACT_PATH,
} = {}) {
  const repoRoot = resolve(manifestsRoot);
  const diagnostics = [];

  const resolvedContractPath = resolve(repoRoot, contractPath);
  if (!existsSync(resolvedContractPath)) {
    diagnostics.push(`missing_contract_file file=${resolvedContractPath}`);
  }

  let rawContract = {};
  if (diagnostics.length === 0) {
    try {
      rawContract = readJson(resolvedContractPath);
    } catch (error) {
      diagnostics.push(`invalid_contract_json file=${resolvedContractPath} message=${String(error?.message || error)}`);
    }
  }

  const normalizedContract = normalizeContract(rawContract, diagnostics);

  const runtimeRoot = resolve(repoRoot, FACTORY_RUNTIME_ROOT);
  const daemonPath = resolve(repoRoot, DAEMON_RELATIVE_PATH);
  const scannedFiles = [
    ...collectMjsFiles(runtimeRoot),
    ...(existsSync(daemonPath) ? [daemonPath] : []),
  ].sort((left, right) => left.localeCompare(right, "en"));

  if (!existsSync(daemonPath)) {
    diagnostics.push(`missing_required_file file=${daemonPath}`);
  }

  const discoveredEventDefinitions = [];
  for (const filePath of scannedFiles) {
    const source = readText(filePath);
    discoveredEventDefinitions.push(...extractTelemetryEventDefinitions(source, filePath, diagnostics));
  }

  let daemonSchema = null;
  if (existsSync(daemonPath)) {
    const daemonSource = readText(daemonPath);
    daemonSchema = extractDaemonSnapshotSchema(daemonSource);
    if (!daemonSchema) {
      diagnostics.push(`missing_required_constant file=${daemonPath} constant=${SNAPSHOT_SCHEMA_CONSTANT}`);
    } else if (daemonSchema.requiredFields.length === 0) {
      diagnostics.push(`invalid_snapshot_schema file=${daemonPath} reason=missing_required_fields`);
    }
  }

  const discoveredEventsByName = new Map();
  for (const definition of discoveredEventDefinitions) {
    if (!discoveredEventsByName.has(definition.event)) {
      discoveredEventsByName.set(definition.event, []);
    }
    discoveredEventsByName.get(definition.event).push(definition);

    const expectedFields = normalizedContract.events.get(definition.event);
    if (!expectedFields) {
      diagnostics.push(`undocumented_telemetry_event file=${definition.filePath} event=${definition.event}`);
      continue;
    }

    compareRequiredFieldSets({
      expected: expectedFields,
      actual: definition.requiredFields,
      diagnostics,
      basePrefix: `event_schema_mismatch file=${definition.filePath} event=${definition.event} `,
    });
  }

  for (const [eventName, definitions] of discoveredEventsByName.entries()) {
    if (definitions.length > 1) {
      diagnostics.push(`duplicate_telemetry_event_definition event=${eventName} count=${definitions.length}`);
    }
  }

  for (const contractEventName of normalizedContract.events.keys()) {
    if (!discoveredEventsByName.has(contractEventName)) {
      diagnostics.push(`missing_telemetry_event_definition event=${contractEventName}`);
    }
  }

  if (daemonSchema) {
    compareRequiredFieldSets({
      expected: normalizedContract.daemonSnapshotRequiredFields,
      actual: daemonSchema.requiredFields,
      diagnostics,
      basePrefix: `state_snapshot_schema_mismatch file=${daemonPath} `,
    });
  }

  const sortedDiagnostics = [...diagnostics].sort((left, right) => left.localeCompare(right, "en"));
  const ok = sortedDiagnostics.length === 0;

  return {
    ok,
    manifestsRoot: repoRoot,
    contractPath: resolvedContractPath,
    diagnostics: sortedDiagnostics,
    filesChecked: scannedFiles.length,
    eventsChecked: discoveredEventDefinitions.length,
    daemonSchemaFields: daemonSchema?.requiredFields?.length || 0,
    telemetry: buildTelemetry({
      ok,
      diagnosticsCount: sortedDiagnostics.length,
      filesChecked: scannedFiles.length,
      eventsChecked: discoveredEventDefinitions.length,
      daemonSchemaFields: daemonSchema?.requiredFields?.length || 0,
    }),
  };
}

function usage() {
  return "Usage: node scripts/check-managed-factory-telemetry-contract.ts [--manifests <path>] [--contract <path>]";
}

function parseArgs(argv) {
  const options = {
    manifestsRoot: process.cwd(),
    contractPath: DEFAULT_CONTRACT_PATH,
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

    if (arg === "--contract") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--contract requires a path");
      }
      options.contractPath = value;
      index += 1;
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

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const result = validateManagedFactoryTelemetryContract({
    manifestsRoot: options.manifestsRoot,
    contractPath: options.contractPath,
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
  try {
    main();
  } catch (error) {
    const message = String(error?.message || error);
    process.stderr.write(`${message}\n`);
    process.stderr.write(`${buildTelemetry({
      ok: false,
      diagnosticsCount: 1,
      filesChecked: 0,
      eventsChecked: 0,
      daemonSchemaFields: 0,
    })}\n`);
    process.exit(1);
  }
}
