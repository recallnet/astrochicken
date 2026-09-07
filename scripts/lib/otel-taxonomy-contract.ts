import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let ts = null;

function getTypescript() {
  if (!ts) ts = require("typescript");
  return ts;
}

export const OTEL_TAXONOMY_SOURCE_JSON_PATH = "packages/factory-telemetry/src/otel-contract.json";
export const OTEL_TAXONOMY_REPORT_JSON_PATH = "docs/contracts/otel-taxonomy.json";
export const OTEL_TAXONOMY_REPORT_MARKDOWN_PATH = "docs/contracts/otel-taxonomy.md";

function defaultReadFile(filePath) {
  return readFileSync(filePath, "utf8");
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sortStrings(values = []) {
  return [...new Set(values.map((value) => String(value)).filter(Boolean))].sort();
}

function isSourceFile(filePath = "") {
  return /^(apps|packages)\//.test(filePath) && /\.(mjs|js|ts)$/.test(filePath);
}

function isTestFile(filePath = "") {
  return /(^|\/)(test|__tests__)\//.test(filePath) || /\.test\.(mjs|js|ts)$/.test(filePath) || /\.contract\.test\.(mjs|js|ts)$/.test(filePath);
}

function isTelemetryPackageFile(filePath = "") {
  return filePath.startsWith("packages/factory-telemetry/src/");
}

function loadJsonContract(readFile = defaultReadFile) {
  const parsed = JSON.parse(readFile(OTEL_TAXONOMY_SOURCE_JSON_PATH));
  return {
    ...parsed,
    required_correlation_attributes: Array.isArray(parsed?.required_correlation_attributes) ? parsed.required_correlation_attributes : [],
    allowed_attribute_keys: Array.isArray(parsed?.allowed_attribute_keys) ? parsed.allowed_attribute_keys : [],
    naming: parsed?.naming || {},
  };
}

function parseModule(source = "", filePath = "") {
  const typescript = getTypescript();
  const scriptKind = /\.(ts|tsx)$/.test(filePath) ? typescript.ScriptKind.TS : typescript.ScriptKind.JS;
  return typescript.createSourceFile(filePath, source, typescript.ScriptTarget.Latest, true, scriptKind);
}

function mayReferenceTelemetrySurface(source = "") {
  return String(source || "").includes("@recallnet/factory-telemetry")
    || String(source || "").includes("emitGovernedOtelEvent")
    || String(source || "").includes("emitOtelEvent");
}

function getLiteralKeyName(node) {
  const typescript = getTypescript();
  if (!node) return "";
  if (typescript.isIdentifier(node)) return node.text;
  if (typescript.isStringLiteralLike(node) || typescript.isNumericLiteral(node)) return String(node.text || "");
  return "";
}

function collectTopLevelObjectKeys(objectNode) {
  const typescript = getTypescript();
  if (!objectNode || !typescript.isObjectLiteralExpression(objectNode)) {
    return {
      keys: [],
      diagnostics: [],
    };
  }
  const diagnostics = [];
  const keys = [];
  for (const property of objectNode.properties || []) {
    if (typescript.isSpreadAssignment(property)) {
      diagnostics.push("unsupported_spread");
      continue;
    }
    if (!("name" in property) && !("initializer" in property)) {
      diagnostics.push("unsupported_property_key");
      continue;
    }
    const key = getLiteralKeyName(property.name);
    if (!key) {
      diagnostics.push("unsupported_property_key");
      continue;
    }
    keys.push(key);
  }
  return { keys, diagnostics };
}

function findObjectProperty(node, propertyName) {
  const typescript = getTypescript();
  if (!node || !typescript.isObjectLiteralExpression(node)) return null;
  for (const property of node.properties || []) {
    if (!typescript.isPropertyAssignment(property)) continue;
    if (getLiteralKeyName(property.name) === propertyName) return property.initializer;
  }
  return null;
}

function getNodeLine(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function analyzeGovernedEmitterCall({ file, node, contract, sourceFile }) {
  const typescript = getTypescript();
  const diagnostics = [];
  const arg = node.arguments?.[0];
  if (!arg || !typescript.isObjectLiteralExpression(arg)) {
    diagnostics.push(`governed_emitter_requires_object_literal file=${JSON.stringify(file)} line=${getNodeLine(sourceFile, node)}`);
    return { diagnostics, emitter: null };
  }

  const eventNameNode = findObjectProperty(arg, "event_name");
  const correlationNode = findObjectProperty(arg, "correlation");
  const attributesNode = findObjectProperty(arg, "attributes");

  const eventName = typescript.isStringLiteralLike(eventNameNode) ? String(eventNameNode.text || "") : "";
  if (!eventName) diagnostics.push(`missing_literal_event_name file=${JSON.stringify(file)} line=${getNodeLine(sourceFile, node)}`);
  if (eventName && !(new RegExp(contract.naming.event_name_pattern)).test(eventName)) {
    diagnostics.push(`invalid_event_name file=${JSON.stringify(file)} event=${JSON.stringify(eventName)}`);
  }

  const correlationKeys = collectTopLevelObjectKeys(correlationNode);
  diagnostics.push(...correlationKeys.diagnostics.map((code) => `${code} file=${JSON.stringify(file)} property=correlation`));
  for (const required of contract.required_correlation_attributes || []) {
    if (!correlationKeys.keys.includes(required)) diagnostics.push(`missing_required_correlation_key file=${JSON.stringify(file)} key=${required}`);
  }

  const attributeKeys = collectTopLevelObjectKeys(attributesNode);
  diagnostics.push(...attributeKeys.diagnostics.map((code) => `${code} file=${JSON.stringify(file)} property=attributes`));
  const allowed = new Set(contract.allowed_attribute_keys || []);
  for (const key of attributeKeys.keys) {
    if (!allowed.has(key)) diagnostics.push(`unknown_attribute_key file=${JSON.stringify(file)} key=${key}`);
  }

  return {
    diagnostics,
    emitter: {
      file,
      line: getNodeLine(sourceFile, node),
      event_name: eventName,
      correlation_keys: sortStrings(correlationKeys.keys),
      attribute_keys: sortStrings(attributeKeys.keys),
    },
  };
}

export function analyzeOtelTaxonomyContract({
  files = [],
  readFile = defaultReadFile,
  expectedJson = "",
  expectedMarkdown = "",
  enforceReportDrift = true,
} = {}) {
  const contract = loadJsonContract(readFile);
  const diagnostics = [];
  const governedEmitters = [];
  const governedEmitterFiles = [];
  const rawBypassFiles = [];

  for (const file of files.filter((entry) => isSourceFile(entry))) {
    if (!existsSync(file)) continue;
    const typescript = getTypescript();
    const source = readFile(file);
    if (!mayReferenceTelemetrySurface(source)) continue;
    let sourceFile;
    try {
      sourceFile = parseModule(source, file);
    } catch (error) {
      diagnostics.push(`unparseable_telemetry_candidate file=${JSON.stringify(file)} error=${JSON.stringify(String(error?.message || error || "parse_failed"))}`);
      continue;
    }
    const rawEmitNames = new Set();
    const governedEmitNames = new Set();

    for (const statement of sourceFile.statements || []) {
      if (!typescript.isImportDeclaration(statement)) continue;
      if (!typescript.isStringLiteralLike(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "@recallnet/factory-telemetry") continue;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !typescript.isNamedImports(bindings)) continue;
      for (const specifier of bindings.elements || []) {
        const importedName = specifier.propertyName?.text || specifier.name?.text || "";
        const localName = specifier.name?.text || importedName;
        if (importedName === "emitOtelEvent") rawEmitNames.add(localName);
        if (importedName === "emitGovernedOtelEvent") governedEmitNames.add(localName);
      }
    }

    if (rawEmitNames.size > 0 && !isTelemetryPackageFile(file) && !isTestFile(file)) {
      rawBypassFiles.push(file);
      diagnostics.push(`direct_emit_otel_event_forbidden file=${JSON.stringify(file)}`);
    }

    const governedCalleeNames = new Set([...governedEmitNames, ...(governedEmitNames.size > 0 ? ["emitOtelEventFn", "emitGovernedOtelEventFn"] : [])]);
    if (governedCalleeNames.size === 0) continue;

    function visit(node) {
      if (typescript.isCallExpression(node) && typescript.isIdentifier(node.expression) && governedCalleeNames.has(node.expression.text)) {
        const analysis = analyzeGovernedEmitterCall({ file, node, contract, sourceFile });
        diagnostics.push(...analysis.diagnostics);
        if (analysis.emitter) governedEmitters.push(analysis.emitter);
      }
      typescript.forEachChild(node, visit);
    }

    visit(sourceFile);

    if (governedEmitters.some((entry) => entry.file === file)) governedEmitterFiles.push(file);
  }

  const report = {
    schema_version: "otel_taxonomy_report/v1",
    summary: {
      required_correlation_attributes: contract.required_correlation_attributes.length,
      allowed_attribute_keys: contract.allowed_attribute_keys.length,
      governed_emitter_files: sortStrings(governedEmitterFiles).length,
      governed_emitters: governedEmitters.length,
      direct_bypass_files: sortStrings(rawBypassFiles).length,
      diagnostics: diagnostics.length,
    },
    contract,
    governed_emitter_inventory: governedEmitters.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line),
    direct_bypass_files: sortStrings(rawBypassFiles),
    diagnostics,
  };

  const renderedJson = stableJson(report);
  const renderedMarkdown = [
    "---",
    "doc_type: \"reference\"",
    "owner: \"platform-architecture\"",
    "review_policy: \"periodic-7\"",
    "reviewed: \"2026-03-20\"",
    "status: \"active\"",
    "summary: \"Canonical OpenTelemetry taxonomy and governed emitter inventory for Phase 2.1.\"",
    "tags: [contracts, observability, opentelemetry, telemetry]",
    "written: \"2026-03-20\"",
    "---",
    "# OTel Taxonomy",
    "",
    `- Required correlation attributes: ${(contract.required_correlation_attributes || []).map((key) => `\`${key}\``).join(", ")}`,
    `- Allowed custom attribute keys: ${(contract.allowed_attribute_keys || []).length}`,
    `- Governed emitter files: ${sortStrings(governedEmitterFiles).length}`,
    `- Governed emitter calls: ${governedEmitters.length}`,
    `- Direct bypass files: ${sortStrings(rawBypassFiles).length}`,
    "",
    "## Naming Rules",
    "",
    `- Event names: \`${contract.naming.event_name_pattern}\``,
    `- Span names: \`${contract.naming.span_name_pattern}\``,
    `- Metric names: \`${contract.naming.metric_name_pattern}\``,
    `- Attribute keys: \`${contract.naming.attribute_key_pattern}\``,
    "",
    "## Governed Emitter Inventory",
    "",
    ...(governedEmitters.length === 0
      ? ["- _No governed emitters found._"]
      : governedEmitters.map((entry) => `- \`${entry.file}:${entry.line}\` -> \`${entry.event_name}\` (${entry.attribute_keys.length} attributes)`)),
    "",
    "## Diagnostics",
    "",
    ...(diagnostics.length === 0 ? ["- none"] : diagnostics.map((entry) => `- ${entry}`)),
    "",
  ].join("\n");

  if (enforceReportDrift && expectedJson && expectedJson !== renderedJson) diagnostics.push("otel_taxonomy_json_drift");
  if (enforceReportDrift && expectedMarkdown && expectedMarkdown !== renderedMarkdown) diagnostics.push("otel_taxonomy_markdown_drift");

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    rendered_json: renderedJson,
    rendered_markdown: renderedMarkdown,
    report,
  };
}

export function listTrackedFilesFromGit({ cwd = process.cwd() } = {}) {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "git ls-files failed").trim());
  }
  return String(result.stdout || "").split("\0").map((entry) => entry.trim()).filter(Boolean);
}

export function analyzeOtelTaxonomyArtifacts({
  files = [],
  readFile = defaultReadFile,
  expectedJsonPath = OTEL_TAXONOMY_REPORT_JSON_PATH,
  expectedMarkdownPath = OTEL_TAXONOMY_REPORT_MARKDOWN_PATH,
  enforceReportDrift = true,
} = {}) {
  const expectedJson = enforceReportDrift && existsSync(expectedJsonPath) ? readFile(expectedJsonPath) : "";
  const expectedMarkdown = enforceReportDrift && existsSync(expectedMarkdownPath) ? readFile(expectedMarkdownPath) : "";
  return analyzeOtelTaxonomyContract({
    files,
    readFile,
    expectedJson,
    expectedMarkdown,
    enforceReportDrift,
  });
}
