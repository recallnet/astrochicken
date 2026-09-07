import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let ts = null;

function getTypescript() {
  if (!ts) ts = require("typescript");
  return ts;
}

export const REACTOR_COLLECTOR_REPORT_JSON_PATH = "docs/contracts/reactor-collector-coverage.json";
export const REACTOR_COLLECTOR_REPORT_MARKDOWN_PATH = "docs/contracts/reactor-collector-coverage.md";
export const OTEL_COLLECTOR_CONFIG_PATH = "packages/factory-telemetry/config/otel-collector.yaml";
export const REACTOR_HELPER_PATH = "apps/hatch/src/pipeline/reactor-instrumentation.ts";
export const OTEL_RUNTIME_PATH = "packages/factory-telemetry/src/otel-stdout.ts";

const CONTROL_PLANE_ENTRYPOINTS = Object.freeze([
  "apps/hatch/src/cli.ts",
  "apps/hatch/src/server/server.ts",
]);

const HANDLER_LAYER_FILES = Object.freeze([
  "apps/hatch/src/pipeline/handler/manager.ts",
  "apps/hatch/src/pipeline/handler/codergen.ts",
]);

const BANNED_RUNTIME_IMPORTS = Object.freeze([
  "bindLangfuseLifecycleTelemetry",
  "createLangfuseTelemetry",
  "createRuntimeRedisTelemetrySink",
  "projectRunLifecycleEventsToTelemetrySink",
]);

const BANNED_HANDLER_IMPORTS = Object.freeze([
  "bindLangfuseSessionTelemetry",
  "computeLangfusePromptHash",
  "emitLangfuseGenerationEvent",
  "nextLangfuseAttemptIndex",
  "recordLangfuseSessionContext",
]);

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function defaultReadFile(filePath) {
  return readFileSync(filePath, "utf8");
}

function listTrackedFilesFromGit() {
  const result = spawnSync("git", ["ls-files"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "git ls-files failed");
  }
  return String(result.stdout || "").split(/\r?\n/g).map((entry) => entry.trim()).filter(Boolean);
}

function parseModule(source = "", filePath = "") {
  const typescript = getTypescript();
  const scriptKind = filePath.endsWith(".tsx")
    ? typescript.ScriptKind.TSX
    : filePath.endsWith(".ts")
      ? typescript.ScriptKind.TS
      : filePath.endsWith(".jsx")
        ? typescript.ScriptKind.JSX
        : typescript.ScriptKind.JS;
  return typescript.createSourceFile(
    filePath || "module.js",
    source,
    typescript.ScriptTarget.Latest,
    true,
    scriptKind,
  );
}

function collectImportNames(ast) {
  const names = new Set();
  const typescript = getTypescript();
  for (const statement of ast.statements || []) {
    if (!typescript.isImportDeclaration(statement) || !statement.importClause) continue;
    const clause = statement.importClause;
    if (clause.name?.text) {
      names.add(String(clause.name.text));
    }
    if (clause.namedBindings && typescript.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        names.add(String(element.propertyName?.text || element.name?.text || ""));
      }
    } else if (clause.namedBindings && typescript.isNamespaceImport(clause.namedBindings) && clause.namedBindings.name?.text) {
      names.add(String(clause.namedBindings.name.text));
    }
  }
  return names;
}

function hasImportSource(ast, fragment) {
  const typescript = getTypescript();
  return (ast.statements || []).some((statement) =>
    typescript.isImportDeclaration(statement) && String(statement.moduleSpecifier?.text || "").includes(fragment),
  );
}

export function analyzeReactorCollectorContract({
  files = [],
  readFile = defaultReadFile,
  expectedJson = "",
  expectedMarkdown = "",
  fileExists = existsSync,
  enforceReportDrift = true,
} = {}) {
  const diagnostics = [];
  const helperConsumers = [];
  const presentEntrypoints = CONTROL_PLANE_ENTRYPOINTS.filter((entry) => files.includes(entry));

  if (presentEntrypoints.length > 0) {
    if (!fileExists(OTEL_COLLECTOR_CONFIG_PATH)) {
      diagnostics.push(`reactor_collector_missing_profile path=${JSON.stringify(OTEL_COLLECTOR_CONFIG_PATH)}`);
    } else {
      const collectorSource = readFile(OTEL_COLLECTOR_CONFIG_PATH);
      for (const requiredToken of ["receivers:", "processors:", "exporters:", "service:", "otlp:"]) {
        if (!collectorSource.includes(requiredToken)) {
          diagnostics.push(`reactor_collector_profile_missing_token token=${JSON.stringify(requiredToken)} path=${JSON.stringify(OTEL_COLLECTOR_CONFIG_PATH)}`);
        }
      }
    }

    if (!fileExists(REACTOR_HELPER_PATH)) {
      diagnostics.push(`reactor_collector_missing_helper path=${JSON.stringify(REACTOR_HELPER_PATH)}`);
    }

    if (!fileExists(OTEL_RUNTIME_PATH)) {
      diagnostics.push(`reactor_collector_missing_otel_runtime path=${JSON.stringify(OTEL_RUNTIME_PATH)}`);
    } else {
      const otelRuntimeSource = readFile(OTEL_RUNTIME_PATH);
      if (otelRuntimeSource.includes("fetch(") || otelRuntimeSource.includes("resourceLogs") || otelRuntimeSource.includes("scopeLogs")) {
        diagnostics.push(`reactor_collector_manual_otlp_transport path=${JSON.stringify(OTEL_RUNTIME_PATH)}`);
      }
      if (!otelRuntimeSource.includes("@opentelemetry/sdk-logs") || !otelRuntimeSource.includes("@opentelemetry/exporter-logs-otlp-http")) {
        diagnostics.push(`reactor_collector_missing_sdk_transport path=${JSON.stringify(OTEL_RUNTIME_PATH)}`);
      }
    }
  }

  for (const file of presentEntrypoints) {
    const source = readFile(file);
    let ast;
    try {
      ast = parseModule(source, file);
    } catch (error) {
      diagnostics.push(`reactor_collector_unparseable_entrypoint file=${JSON.stringify(file)} error=${JSON.stringify(String(error?.message || error || "parse_failed"))}`);
      continue;
    }
    const importNames = collectImportNames(ast);
    const importsHelper = hasImportSource(ast, "reactor-instrumentation") || source.includes("reactor-instrumentation");
    if (importsHelper) helperConsumers.push(file);
    for (const banned of BANNED_RUNTIME_IMPORTS) {
      if (importNames.has(banned) || source.includes(banned)) {
        diagnostics.push(`reactor_collector_custom_transport_import file=${JSON.stringify(file)} symbol=${JSON.stringify(banned)}`);
      }
    }
    if (!importsHelper) {
      diagnostics.push(`reactor_collector_helper_missing file=${JSON.stringify(file)} helper=${JSON.stringify(REACTOR_HELPER_PATH)}`);
    }
  }

  // Check handler-layer files for banned langfuse imports
  const presentHandlerFiles = HANDLER_LAYER_FILES.filter((entry) => files.includes(entry));
  for (const file of presentHandlerFiles) {
    let source;
    try {
      source = readFile(file);
    } catch {
      continue;
    }
    for (const banned of BANNED_HANDLER_IMPORTS) {
      if (source.includes(banned)) {
        diagnostics.push(`reactor_collector_handler_banned_import file=${JSON.stringify(file)} symbol=${JSON.stringify(banned)}`);
      }
    }
  }

  const uniqueHelperConsumers = [...new Set(helperConsumers)].sort();
  const report = {
    schema_version: "reactor_collector_contract/v1",
    collector_profile_path: OTEL_COLLECTOR_CONFIG_PATH,
    reactor_helper_path: REACTOR_HELPER_PATH,
    summary: {
      control_plane_entrypoints: CONTROL_PLANE_ENTRYPOINTS.length,
      helper_consumer_files: uniqueHelperConsumers.length,
      diagnostics: diagnostics.length,
    },
    control_plane_entrypoints: CONTROL_PLANE_ENTRYPOINTS,
    helper_consumers: uniqueHelperConsumers,
    banned_runtime_imports: BANNED_RUNTIME_IMPORTS,
    handler_layer_files: HANDLER_LAYER_FILES,
    banned_handler_imports: BANNED_HANDLER_IMPORTS,
  };

  const rendered_json = stableJson(report);
  const rendered_markdown = [
    "---",
    'doc_type: "reference"',
    'owner: "platform-architecture"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-20"',
    'status: "active"',
    'summary: "Checked-in audit for Phase 2.3 reactor instrumentation and collector rollout coverage."',
    'tags: [contracts, generated, hatch, observability, opentelemetry, reactor]',
    'written: "2026-03-20"',
    "---",
    "",
    "# Reactor Collector Coverage",
    "",
    `Schema: \`${report.schema_version}\``,
    `- collector profile path: \`${OTEL_COLLECTOR_CONFIG_PATH}\``,
    `- reactor helper path: \`${REACTOR_HELPER_PATH}\``,
    `- control-plane entrypoints: \`${report.summary.control_plane_entrypoints}\``,
    `- helper consumer files: \`${report.summary.helper_consumer_files}\``,
    `- diagnostics: \`${report.summary.diagnostics}\``,
    "",
    "## Control-Plane Entrypoints",
    "",
    ...CONTROL_PLANE_ENTRYPOINTS.map((file) => `- \`${file}\``),
    "",
    "## Helper Consumers",
    "",
    ...(uniqueHelperConsumers.length > 0 ? uniqueHelperConsumers.map((file) => `- \`${file}\``) : ["- none"]),
    "",
    "## Banned Runtime Imports",
    "",
    ...BANNED_RUNTIME_IMPORTS.map((symbol) => `- \`${symbol}\``),
    "",
  ].join("\n");

  if (enforceReportDrift && expectedJson && expectedJson !== rendered_json) diagnostics.push("reactor_collector_contract_json_drift");
  if (enforceReportDrift && expectedMarkdown && expectedMarkdown !== rendered_markdown) diagnostics.push("reactor_collector_contract_markdown_drift");

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    report,
    rendered_json,
    rendered_markdown,
  };
}

export { listTrackedFilesFromGit };
