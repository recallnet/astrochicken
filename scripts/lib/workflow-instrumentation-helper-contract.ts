import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parse } = require("acorn");
let ts = null;

function getTypescript() {
  if (!ts) ts = require("typescript");
  return ts;
}

export const WORKFLOW_INSTRUMENTATION_REPORT_JSON_PATH = "docs/contracts/workflow-instrumentation-coverage.json";
export const WORKFLOW_INSTRUMENTATION_REPORT_MARKDOWN_PATH = "docs/contracts/workflow-instrumentation-coverage.md";
export const WORKFLOW_INSTRUMENTATION_HELPER_PATH = "apps/hatch/src/pipeline/instrumentation-helpers.ts";
export const REACTOR_INSTRUMENTATION_HELPER_PATH = "apps/hatch/src/pipeline/reactor-instrumentation.ts";
export const WORKFLOW_INSTRUMENTATION_HELPER_PATHS = [
  WORKFLOW_INSTRUMENTATION_HELPER_PATH,
  REACTOR_INSTRUMENTATION_HELPER_PATH,
];

const DIRECT_EVENT_KINDS = new Set([
  "pipeline.start",
  "pipeline.finish",
  "pipeline.error",
  "pipeline.warning",
  "stage.start",
  "stage.finish",
  "stage.error",
  "stage.retry",
  "stage.skip",
  "quality.signal",
  "context.update",
  "parallel.fan_out",
  "parallel.fan_in",
]);

function defaultReadFile(filePath) {
  return readFileSync(filePath, "utf8");
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isSourceFile(filePath = "") {
  return filePath.startsWith("apps/hatch/src/pipeline/") && /\.(ts|js|mjs)$/.test(filePath);
}

function isTestFile(filePath = "") {
  return /\.test\.(ts|js|mjs)$/.test(filePath) || /\.contract\.test\.(ts|js|mjs)$/.test(filePath);
}

function parseModule(source = "", filePath = "") {
  const typescript = /\.(ts|tsx)$/.test(filePath) ? getTypescript() : null;
  const parseSource = /\.(ts|tsx)$/.test(filePath)
    ? typescript.transpileModule(source, {
      compilerOptions: {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ES2022,
      },
      fileName: filePath,
      reportDiagnostics: false,
    }).outputText
    : source;
  // @context:regression !critical acorn 7.4.1 (resolved from scripts/lib/)
  // infinite-loops on ecmaVersion:"latest". Use numeric 2022 which covers
  // all syntax we emit from TypeScript transpileModule.
  return parse(parseSource, {
    ecmaVersion: 2022,
    sourceType: "module",
    allowHashBang: true,
    locations: true,
  });
}

function collectFallbackSignalsFromSource(source = "") {
  const text = String(source || "");
  return {
    importsHelper: /from\s+["'][^"']*instrumentation-helpers[^"']*["']/.test(text),
    importsGovernedOtel: /from\s+["']@recallnet\/factory-telemetry["'][\s\S]*\bemitGovernedOtelEvent\b/.test(text),
    directEmitFound: /\.\s*emit\s*\(\s*\{[\s\S]*?\bkind\s*:\s*["'](?:pipeline|stage|quality|context|parallel)\.[^"']+["']/.test(text),
  };
}

function walk(node, visitor, seen = new WeakSet()) {
  if (!node || typeof node !== "object") return;
  if (seen.has(node)) return;
  seen.add(node);
  visitor(node);
  for (const value of Object.values(node)) {
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, visitor, seen);
      continue;
    }
    if (typeof value === "object" && value.type) walk(value, visitor, seen);
  }
}

function getLiteralKeyName(node) {
  if (!node) return "";
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal") return String(node.value || "");
  return "";
}

function findPropertyValue(node, keyName) {
  if (!node || node.type !== "ObjectExpression") return null;
  for (const property of node.properties || []) {
    if (property.type !== "Property") continue;
    if (getLiteralKeyName(property.key) === keyName) return property.value;
  }
  return null;
}

export function listTrackedFilesFromGit() {
  const result = spawnSync("git", ["ls-files"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "git ls-files failed");
  }
  return String(result.stdout || "").split(/\r?\n/g).map((entry) => entry.trim()).filter(Boolean);
}

export function analyzeWorkflowInstrumentationHelpers({
  files = [],
  readFile = defaultReadFile,
  expectedJson = "",
  expectedMarkdown = "",
  enforceReportDrift = true,
} = {}) {
  const diagnostics = [];
  const helperConsumers = [];
  const directBypassFiles = [];

  for (const file of files.filter((entry) => isSourceFile(entry) && !isTestFile(entry))) {
    const source = readFile(file);
    let ast;
    try {
      ast = parseModule(source, file);
    } catch (error) {
      const fallback = collectFallbackSignalsFromSource(source);
      if (fallback.importsHelper) helperConsumers.push(file);
      if (fallback.importsGovernedOtel && !WORKFLOW_INSTRUMENTATION_HELPER_PATHS.includes(file)) {
        diagnostics.push(`workflow_instrumentation_helper_bypass_direct_otel file=${JSON.stringify(file)}`);
        directBypassFiles.push(file);
      }
      if (fallback.directEmitFound && !WORKFLOW_INSTRUMENTATION_HELPER_PATHS.includes(file)) {
        diagnostics.push(`workflow_instrumentation_helper_bypass_direct_emit file=${JSON.stringify(file)}`);
        directBypassFiles.push(file);
      }
      continue;
    }

    let importsHelper = false;
    let importsGovernedOtel = false;
    let directEmitFound = false;

    for (const statement of ast.body || []) {
      if (statement.type !== "ImportDeclaration") continue;
      if (String(statement.source?.value || "").includes("instrumentation-helpers")) {
        importsHelper = true;
      }
      if (String(statement.source?.value || "") !== "@recallnet/factory-telemetry") continue;
      for (const specifier of statement.specifiers || []) {
        if (specifier.type !== "ImportSpecifier") continue;
        if (specifier.imported?.name === "emitGovernedOtelEvent") importsGovernedOtel = true;
      }
    }

    walk(ast, (node) => {
      if (node.type !== "CallExpression") return;
      if (node.callee?.type === "MemberExpression" && getLiteralKeyName(node.callee.property) === "emit") {
        const eventArg = node.arguments?.[0];
        if (!eventArg || eventArg.type !== "ObjectExpression") return;
        const kindNode = findPropertyValue(eventArg, "kind");
        const kind = kindNode?.type === "Literal" ? String(kindNode.value || "") : "";
        if (DIRECT_EVENT_KINDS.has(kind)) directEmitFound = true;
      }
    });

    if (importsHelper) helperConsumers.push(file);
    if (importsGovernedOtel && !WORKFLOW_INSTRUMENTATION_HELPER_PATHS.includes(file)) {
      diagnostics.push(`workflow_instrumentation_helper_bypass_direct_otel file=${JSON.stringify(file)}`);
      directBypassFiles.push(file);
    }
    if (directEmitFound && !WORKFLOW_INSTRUMENTATION_HELPER_PATHS.includes(file)) {
      diagnostics.push(`workflow_instrumentation_helper_bypass_direct_emit file=${JSON.stringify(file)}`);
      directBypassFiles.push(file);
    }
  }

  const uniqueHelperConsumers = [...new Set(helperConsumers)].sort();
  const uniqueDirectBypassFiles = [...new Set(directBypassFiles)].sort();
  const report = {
    schema_version: "workflow_instrumentation_helper_report/v1",
    summary: {
      helper_consumer_files: uniqueHelperConsumers.length,
      direct_bypass_files: uniqueDirectBypassFiles.length,
      diagnostics: diagnostics.length,
    },
    helper_paths: WORKFLOW_INSTRUMENTATION_HELPER_PATHS,
    helper_consumers: uniqueHelperConsumers,
    direct_bypass_files: uniqueDirectBypassFiles,
  };

  const rendered_json = stableJson(report);
  const rendered_markdown = [
    "---",
    'doc_type: "reference"',
    'owner: "hatch-runtime"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-20"',
    'status: "active"',
    'summary: "Checked-in helper-routing audit for Hatch workflow and action instrumentation coverage."',
    'tags: [contracts, generated, hatch, observability, telemetry]',
    'written: "2026-03-20"',
    "---",
    "",
    "# Workflow Instrumentation Coverage",
    "",
    `Schema: \`${report.schema_version}\``,
    `- helper paths: ${WORKFLOW_INSTRUMENTATION_HELPER_PATHS.map((entry) => `\`${entry}\``).join(", ")}`,
    `- helper consumer files: \`${report.summary.helper_consumer_files}\``,
    `- direct bypass files: \`${report.summary.direct_bypass_files}\``,
    `- diagnostics: \`${report.summary.diagnostics}\``,
    "",
    "## Helper Consumers",
    "",
    ...(uniqueHelperConsumers.length > 0 ? uniqueHelperConsumers.map((file) => `- \`${file}\``) : ["- none"]),
    "",
    "## Direct Bypass Files",
    "",
    ...(uniqueDirectBypassFiles.length > 0 ? uniqueDirectBypassFiles.map((file) => `- \`${file}\``) : ["- none"]),
    "",
  ].join("\n");

  if (enforceReportDrift && expectedJson && expectedJson !== rendered_json) diagnostics.push("workflow_instrumentation_helper_report_json_drift");
  if (enforceReportDrift && expectedMarkdown && expectedMarkdown !== rendered_markdown) diagnostics.push("workflow_instrumentation_helper_report_markdown_drift");

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    report,
    rendered_json,
    rendered_markdown,
  };
}
