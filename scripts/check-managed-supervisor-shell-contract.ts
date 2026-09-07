#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseDot } from "./lib/hatch-dot-parser-wrapper.ts";
import { loadGraphSemanticsText } from "./lib/load-graph-semantics.ts";

const TELEMETRY_PREFIX = "managed-supervisor-shell-contract";
const CANONICAL_SHARED_SHELL_PATH = "packages/factory-runtime/workflows/managed-supervisor-shell/managed-supervisor-shell.workflow-source.mjs";
const MANAGED_SUPERVISOR_ENTRY_GRAPH_PATH = "packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs";
const CONTROL_STATE_PATH = "packages/factory-ops/src/lib/external-factory-control-state.ts";
const LIFECYCLE_COMMAND_PATH = "packages/factory-ops/src/commands/supervisor-external-factory-lifecycle.ts";
const FACTORY_SUPERVISOR_TICK_GRAPH_FILENAME = "factory_supervisor_tick.dot";

const SHARED_SHELL_ALIAS_REFERENCES = Object.freeze([
  CANONICAL_SHARED_SHELL_PATH,
  "managed-supervisor-shell.dot",
  "managed_supervisor_shell",
  MANAGED_SUPERVISOR_ENTRY_GRAPH_PATH,
  "managed_supervisor.dot",
  "managed_supervisor",
]);

const REQUIRED_LIFECYCLE_NODES = Object.freeze([
  Object.freeze({ id: "blocker_gate", tokens: Object.freeze(["blocker", "gate"]) }),
  Object.freeze({ id: "domain_graph_invocation", tokens: Object.freeze(["domain", "graph"]) }),
  Object.freeze({ id: "telemetry_emission", tokens: Object.freeze(["telemetry", "emit"]) }),
]);

function trim(value = "") {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTokenInput(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readText(path) {
  return loadGraphSemanticsText(path);
}

function hasRequiredString(value) {
  return typeof value === "string" && trim(value).length > 0;
}

function collectFactoryKindFiles(repoRoot) {
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
      path: join(factoriesRoot, name, "kind.json"),
    }))
    .filter((entry) => existsSync(entry.path));
}

function extractFrozenStringArray(sourceText, constName) {
  const blockRegex = new RegExp(
    `export\\s+const\\s+${constName}\\s*=\\s*Object\\.freeze\\(\\s*\\[([\\s\\S]*?)\\]\\s*\\)`,
    "m",
  );
  const match = blockRegex.exec(sourceText);
  if (!match) {
    return null;
  }

  const body = match[1] || "";
  const values = [];
  const stringRegex = /["']([^"'\\]*(?:\\.[^"'\\]*)*)["']/g;
  for (const stringMatch of body.matchAll(stringRegex)) {
    values.push(String(stringMatch[1] || ""));
  }

  return values;
}

function nodeMatchesTokens(node, tokens) {
  const haystack = normalizeTokenInput(`${trim(node?.id)} ${trim(node?.attrs?.label)}`);
  if (!haystack) return false;
  return tokens.every((token) => haystack.includes(token));
}

function collectFactoryKinds({ repoRoot, diagnostics, requireKinds }) {
  const kindFiles = collectFactoryKindFiles(repoRoot);
  if (kindFiles.length === 0) {
    if (requireKinds) {
      diagnostics.push(`missing_kind_definitions root=${join(repoRoot, "factories")}`);
    }
    return {
      kindCount: 0,
      shellRequired: requireKinds,
      managedKinds: [],
    };
  }

  const managedKinds = [];
  for (const kindFile of kindFiles) {
    let parsed;
    try {
      parsed = readJson(kindFile.path);
    } catch (error) {
      diagnostics.push(`invalid_json file=${kindFile.path} message=${String(error?.message || error)}`);
      continue;
    }

    if (!isPlainObject(parsed)) {
      diagnostics.push(`invalid_shape file=${kindFile.path} message=kind.json must be a JSON object`);
      continue;
    }

    if (!hasRequiredString(parsed.shared_supervisor_shell)) {
      diagnostics.push(`missing_required_field file=${kindFile.path} field=shared_supervisor_shell`);
      continue;
    }

    const declaredShell = trim(parsed.shared_supervisor_shell);
    if (declaredShell !== CANONICAL_SHARED_SHELL_PATH) {
      diagnostics.push(
        `shared_shell_mismatch file=${kindFile.path} expected=${CANONICAL_SHARED_SHELL_PATH} actual=${declaredShell}`,
      );
    }

    const factoryRoot = resolve(kindFile.path, "..");
    const configPath = join(factoryRoot, "factory.config.json");
    let dispatchGraphPath = "";
    let pipelineGraphPath = "";
    if (existsSync(configPath)) {
      try {
        const parsedConfig = readJson(configPath);
        dispatchGraphPath = trim(parsedConfig?.dispatch?.graph);
        pipelineGraphPath = trim(parsedConfig?.pipeline?.supervisor_tick);
      } catch (error) {
        diagnostics.push(`invalid_json file=${configPath} message=${String(error?.message || error)}`);
      }
    }
    const instanceTemplatePath = join(factoryRoot, "instance.template.json");
    if (!existsSync(instanceTemplatePath)) {
      continue;
    }

    managedKinds.push({
      kindId: trim(parsed.kind_id) || "unknown",
      factoryRoot,
      dispatchGraphPath,
      pipelineGraphPath,
    });
  }

  return {
    kindCount: kindFiles.length,
    shellRequired: true,
    managedKinds,
  };
}

function nodeReferencesSharedShell(node) {
  const haystack = normalizeTokenInput([
    trim(node?.id),
    trim(node?.attrs?.label),
    trim(node?.attrs?.pipeline),
  ].join(" "));
  if (!haystack) {
    return false;
  }

  return SHARED_SHELL_ALIAS_REFERENCES
    .map((reference) => normalizeTokenInput(reference))
    .some((referenceToken) => referenceToken && haystack.includes(referenceToken));
}

function nodeReferencesManagedSupervisorEntry(node) {
  const pipelineToken = normalizeTokenInput(trim(node?.attrs?.pipeline));
  if (!pipelineToken) {
    return false;
  }

  return [
    normalizeTokenInput(MANAGED_SUPERVISOR_ENTRY_GRAPH_PATH),
    normalizeTokenInput("managed_supervisor.dot"),
  ].some((token) => token && pipelineToken.includes(token));
}

function graphHasSharedShellDelegation(graph) {
  const nodes = Object.values(graph?.nodes || {});
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];

  const delegatedNodes = nodes
    .filter((node) => trim(node?.attrs?.type) === "pipeline")
    .filter((node) => nodeReferencesSharedShell(node));

  if (delegatedNodes.length === 0) {
    return false;
  }

  if (delegatedNodes.some((node) => nodeReferencesManagedSupervisorEntry(node))) {
    return true;
  }

  const delegatedNodeIds = new Set(delegatedNodes.map((node) => trim(node?.id)).filter(Boolean));
  if (delegatedNodeIds.size === 0) {
    return false;
  }

  return edges.some((edge) => delegatedNodeIds.has(trim(edge?.from)) && trim(edge?.to) === "managed_supervisor");
}

async function validateManagedFactorySupervisorDelegation({ managedKinds, diagnostics }) {
  for (const managedKind of managedKinds) {
    const configuredEntryGraph = trim(managedKind.dispatchGraphPath) || trim(managedKind.pipelineGraphPath);
    if (configuredEntryGraph === MANAGED_SUPERVISOR_ENTRY_GRAPH_PATH) {
      continue;
    }

    const supervisorGraphPath = configuredEntryGraph
      ? join(managedKind.factoryRoot, "..", "..", configuredEntryGraph)
      : join(managedKind.factoryRoot, "graphs", FACTORY_SUPERVISOR_TICK_GRAPH_FILENAME);

    if (!existsSync(supervisorGraphPath)) {
      diagnostics.push(
        `missing_shared_shell_delegation kind=${managedKind.kindId} graph=${trim(configuredEntryGraph) || FACTORY_SUPERVISOR_TICK_GRAPH_FILENAME} reason=missing_graph file=${supervisorGraphPath}`,
      );
      continue;
    }

    const source = readText(supervisorGraphPath);
    let graph;
    try {
      graph = await parseDot(source);
    } catch (error) {
      diagnostics.push(
        `invalid_dot file=${supervisorGraphPath} kind=${managedKind.kindId} graph=${FACTORY_SUPERVISOR_TICK_GRAPH_FILENAME} message=${String(error?.message || error)}`,
      );
      continue;
    }

    if (!graphHasSharedShellDelegation(graph)) {
      diagnostics.push(
        `missing_shared_shell_delegation kind=${managedKind.kindId} graph=${FACTORY_SUPERVISOR_TICK_GRAPH_FILENAME} file=${supervisorGraphPath} expected_alias=${MANAGED_SUPERVISOR_ENTRY_GRAPH_PATH} expected_entry=managed_supervisor`,
      );
    }
  }
}

async function validateSharedShellGraph({ shellPath, diagnostics }) {
  if (!existsSync(shellPath)) {
    diagnostics.push(`missing_file file=${shellPath}`);
    return;
  }

  const source = readText(shellPath);
  let graph;
  try {
    graph = await parseDot(source);
  } catch (error) {
    diagnostics.push(`invalid_dot file=${shellPath} message=${String(error?.message || error)}`);
    return;
  }

  const nodes = Object.values(graph?.nodes || {});
  for (const requirement of REQUIRED_LIFECYCLE_NODES) {
    const found = nodes.some((node) => nodeMatchesTokens(node, requirement.tokens));
    if (!found) {
      diagnostics.push(
        `missing_lifecycle_node file=${shellPath} node=${requirement.id} tokens=${requirement.tokens.join(",")}`,
      );
    }
  }
}

function validateLifecycleEnumParity({ repoRoot, diagnostics }) {
  const controlStatePath = join(repoRoot, CONTROL_STATE_PATH);
  const lifecycleCommandPath = join(repoRoot, LIFECYCLE_COMMAND_PATH);

  if (!existsSync(controlStatePath)) {
    diagnostics.push(`missing_file file=${controlStatePath}`);
    return;
  }
  if (!existsSync(lifecycleCommandPath)) {
    diagnostics.push(`missing_file file=${lifecycleCommandPath}`);
    return;
  }

  const controlStateSource = readText(controlStatePath);
  const lifecycleCommandSource = readText(lifecycleCommandPath);

  const controlStates = extractFrozenStringArray(controlStateSource, "LIFECYCLE_STATES");
  const lifecycleStates = extractFrozenStringArray(lifecycleCommandSource, "LIFECYCLE_STATES");

  if (!Array.isArray(controlStates) || controlStates.length === 0) {
    diagnostics.push(`missing_exported_enum file=${controlStatePath} export=LIFECYCLE_STATES`);
    return;
  }

  if (!Array.isArray(lifecycleStates) || lifecycleStates.length === 0) {
    diagnostics.push(`missing_exported_enum file=${lifecycleCommandPath} export=LIFECYCLE_STATES`);
    return;
  }

  if (JSON.stringify(controlStates) !== JSON.stringify(lifecycleStates)) {
    diagnostics.push(
      `enum_mismatch file=${lifecycleCommandPath} source=${controlStatePath} expected=${controlStates.join(",")} actual=${lifecycleStates.join(",")}`,
    );
  }
}

function buildTelemetry({ ok, diagnosticsCount, kindCount, shellRequired }) {
  if (ok) {
    return `[${TELEMETRY_PREFIX}] result=ok kind_count=${kindCount} shell_required=${shellRequired ? 1 : 0}`;
  }
  return `[${TELEMETRY_PREFIX}] result=fail diagnostics=${diagnosticsCount} kind_count=${kindCount} shell_required=${shellRequired ? 1 : 0}`;
}

export async function validateManagedSupervisorShellContract({ manifestsRoot = process.cwd(), requireKinds = false } = {}) {
  const repoRoot = resolve(manifestsRoot);
  const diagnostics = [];

  validateLifecycleEnumParity({ repoRoot, diagnostics });

  const kindValidation = collectFactoryKinds({
    repoRoot,
    diagnostics,
    requireKinds,
  });

  if (kindValidation.shellRequired) {
    await validateSharedShellGraph({
      shellPath: join(repoRoot, CANONICAL_SHARED_SHELL_PATH),
      diagnostics,
    });

    await validateManagedFactorySupervisorDelegation({
      managedKinds: kindValidation.managedKinds,
      diagnostics,
    });
  }

  const sortedDiagnostics = [...diagnostics].sort((left, right) => left.localeCompare(right, "en"));
  const ok = sortedDiagnostics.length === 0;

  return {
    ok,
    manifestsRoot: repoRoot,
    diagnostics: sortedDiagnostics,
    kindCount: kindValidation.kindCount,
    shellRequired: kindValidation.shellRequired,
    telemetry: buildTelemetry({
      ok,
      diagnosticsCount: sortedDiagnostics.length,
      kindCount: kindValidation.kindCount,
      shellRequired: kindValidation.shellRequired,
    }),
  };
}

function parseArgs(argv) {
  const options = {
    manifestsRoot: process.cwd(),
    requireKinds: false,
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

    if (arg === "--require-kinds") {
      options.requireKinds = true;
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
  return "Usage: node scripts/check-managed-supervisor-shell-contract.ts [--manifests <path>] [--require-kinds]";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const result = await validateManagedSupervisorShellContract({
    manifestsRoot: options.manifestsRoot,
    requireKinds: options.requireKinds,
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
    process.stderr.write(`[${TELEMETRY_PREFIX}] result=fail diagnostics=1 kind_count=0 shell_required=0\n`);
    process.exit(1);
  });
}
