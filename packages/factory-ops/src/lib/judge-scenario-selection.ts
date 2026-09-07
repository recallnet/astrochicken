import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { trim } from "./cli-helpers.ts";

export const JUDGE_SCENARIO_BASIS_SCHEMA_VERSION = "scenario_selection_basis/v1";
export const JUDGE_SCENARIO_SELECTION_SCHEMA_VERSION = "judge_scenario_selection/v1";

const MAX_SELECTED_SCENARIOS = 2;
const SCENARIO_PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function resolvePath(pathValue = "") {
  const raw = trim(pathValue);
  if (!raw) return "";
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

function normalizePath(value = "") {
  return trim(value).replaceAll("\\", "/").replace(/^\.\//, "");
}

function uniqueSorted(values = []) {
  return [...new Set(values.map((value) => trim(value)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function resolveRequiredRegistryRoot(registryRoot = "") {
  const resolvedRoot = resolvePath(registryRoot);
  if (!resolvedRoot) {
    return {
      ok: false,
      code: "judge_context_scenario_registry_root_missing",
      registry_root: "",
    };
  }
  return {
    ok: true,
    code: "ok",
    registry_root: resolvedRoot,
  };
}

function sortObjectDeep(value) {
  if (Array.isArray(value)) return value.map((entry) => sortObjectDeep(entry));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    out[key] = sortObjectDeep(value[key]);
  }
  return out;
}

export function normalizeScenarioPriority(value = "") {
  const normalized = trim(value).toLowerCase();
  return Object.prototype.hasOwnProperty.call(SCENARIO_PRIORITY_RANK, normalized)
    ? normalized
    : "medium";
}

export function compareScenarioSelectionEntries(a = {}, b = {}) {
  const byPriority = (SCENARIO_PRIORITY_RANK[normalizeScenarioPriority(a.priority)] ?? 99)
    - (SCENARIO_PRIORITY_RANK[normalizeScenarioPriority(b.priority)] ?? 99);
  if (byPriority !== 0) return byPriority;

  const byId = trim(a.scenario_id).localeCompare(trim(b.scenario_id));
  if (byId !== 0) return byId;

  return normalizePath(a.scenario_path).localeCompare(normalizePath(b.scenario_path));
}

function parseScenarioSelectors(rawSelector = "", { allowEmpty = false } = {}) {
  const selectors = uniqueSorted(String(rawSelector || "").split(",").map((value) => normalizePath(value)));
  if (selectors.length === 0 && !allowEmpty) {
    return { ok: false, code: "judge_context_scenario_selector_missing", selectors: [] };
  }
  return { ok: true, code: "ok", selectors };
}

function extractFrontmatter(content = "") {
  const match = String(content || "").match(/^---\n([\s\S]*?)\n---/);
  return match ? String(match[1] || "") : "";
}

function extractFrontmatterScalar(frontmatter = "", key = "") {
  const match = String(frontmatter || "").match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!match) return "";
  return trim(String(match[1] || "").replace(/^['"]|['"]$/g, ""));
}

function extractScenarioTruth(content = "") {
  const body = String(content || "").replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  if (!body) return "";

  const lines = body
    .split("\n")
    .map((line) => trim(line))
    .filter((line) => Boolean(line) && !line.startsWith("#"));

  return lines.slice(0, 5).join("\n");
}

function collectScenarioFiles(rootPath, accumulator) {
  const queue = [rootPath];
  while (queue.length > 0) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = readdirSync(current).sort((a, b) => a.localeCompare(b));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        queue.push(full);
        continue;
      }
      if (stats.isFile() && entry === "SCENARIO.md") accumulator.push(full);
    }
  }
}

function parseScenarioMetadata({ scenarioAbsolutePath = "", registryRoot = "" } = {}) {
  const resolvedScenarioPath = resolvePath(scenarioAbsolutePath);
  const resolvedRoot = resolvePath(registryRoot);
  if (!resolvedScenarioPath) return null;
  const relativePath = normalizePath(relative(resolvedRoot, resolvedScenarioPath));
  if (!relativePath || relativePath.startsWith("..")) return null;
  const parts = relativePath.split("/").filter(Boolean);
  const inferredScope = parts[0] || "";
  const inferredDomain = parts[1] || "";
  const inferredId = parts.length >= 2 ? parts[parts.length - 2] : relativePath;
  let content = "";
  try {
    content = readFileSync(resolvedScenarioPath, "utf8");
  } catch {
    content = "";
  }
  const frontmatter = extractFrontmatter(content);
  const scenarioId = extractFrontmatterScalar(frontmatter, "id") || inferredId;
  const scenarioScope = extractFrontmatterScalar(frontmatter, "scope") || inferredScope;
  const scenarioDomain = extractFrontmatterScalar(frontmatter, "domain") || inferredDomain;
  const priority = normalizeScenarioPriority(extractFrontmatterScalar(frontmatter, "priority") || "medium");
  const truth = extractScenarioTruth(content);
  return {
    scenario_id: scenarioId,
    scope: scenarioScope,
    domain: scenarioDomain,
    priority,
    scenario_path: relativePath,
    truth,
  };
}

function collectScenarioSelection({ selectors = [], registryRoot = "", scenarioContext = "", scope = "" } = {}) {
  const resolvedRootCheck = resolveRequiredRegistryRoot(registryRoot);
  if (!resolvedRootCheck.ok) {
    return {
      ok: false,
      code: resolvedRootCheck.code,
      registry_root: "",
      selected: [],
      scenario_paths: [],
      scenario_ids: [],
      missing_selector_paths: [],
    };
  }
  const resolvedRoot = resolvedRootCheck.registry_root;
  const selectionByPath = new Map();
  const missingSelectors = [];
  const expectedContext = trim(scenarioContext);
  const expectedScope = trim(scope);
  for (const selector of selectors) {
    const selectedAbsolute = resolve(resolvedRoot, selector);
    if (!existsSync(selectedAbsolute)) {
      missingSelectors.push(selector);
      continue;
    }
    let stats;
    try {
      stats = statSync(selectedAbsolute);
    } catch {
      missingSelectors.push(selector);
      continue;
    }
    const resolvedFiles = [];
    if (stats.isFile()) {
      if (selectedAbsolute.endsWith("SCENARIO.md")) {
        resolvedFiles.push(selectedAbsolute);
      } else {
        missingSelectors.push(selector);
      }
    } else if (stats.isDirectory()) {
      collectScenarioFiles(selectedAbsolute, resolvedFiles);
    } else {
      missingSelectors.push(selector);
    }
    for (const absoluteFile of resolvedFiles) {
      const metadata = parseScenarioMetadata({
        scenarioAbsolutePath: absoluteFile,
        registryRoot: resolvedRoot,
      });
      if (!metadata) continue;
      if (expectedContext && trim(metadata.domain) !== expectedContext) continue;
      if (expectedScope && trim(metadata.scope) !== expectedScope) continue;
      const key = metadata.scenario_path;
      const current = selectionByPath.get(key) || { ...metadata, source_selectors: [] };
      current.source_selectors = uniqueSorted([...(current.source_selectors || []), selector]);
      selectionByPath.set(key, current);
    }
  }
  const selected = [...selectionByPath.values()]
    .sort((a, b) => compareScenarioSelectionEntries(a, b))
    .slice(0, MAX_SELECTED_SCENARIOS)
    .map((entry, index) => sortObjectDeep({
      ...entry,
      source_selectors: uniqueSorted(entry.source_selectors || []),
      selection_rank: String(index + 1),
    }));
  return {
    ok: true,
    code: "ok",
    registry_root: normalizePath(resolvedRoot),
    selected,
    scenario_paths: selected.map((entry) => trim(entry.scenario_path)),
    scenario_ids: selected.map((entry) => trim(entry.scenario_id)),
    missing_selector_paths: uniqueSorted(missingSelectors),
  };
}

export function computeScenarioSignature({ selectorPaths = [], scenarioPaths = [] } = {}) {
  return sha256Hex(JSON.stringify(sortObjectDeep({
    schema_version: JUDGE_SCENARIO_BASIS_SCHEMA_VERSION,
    selector_paths: uniqueSorted(selectorPaths),
    scenario_paths: uniqueSorted(scenarioPaths),
  })));
}

export function resolveJudgeScenarioSelectionBasis({
  scenarioSelector = "",
  scenarioContext = "",
  scope = "",
  scenarioRegistryRoot = "",
} = {}) {
  const resolvedRootCheck = resolveRequiredRegistryRoot(scenarioRegistryRoot);
  if (!resolvedRootCheck.ok) {
    return {
      ok: false,
      code: resolvedRootCheck.code,
      schema_version: JUDGE_SCENARIO_SELECTION_SCHEMA_VERSION,
      configured: "false",
      selector_paths: [],
      selector_sources: ["node.scenarios"],
      registry_root: "",
      scenario_paths: [],
      scenario_ids: [],
      selected_scenarios: [],
      missing_selector_paths: [],
      scenario_signature_sha256: "",
      scenario_count: "0",
      scenario_basis: {
        schema_version: JUDGE_SCENARIO_BASIS_SCHEMA_VERSION,
        category: "unconfigured",
        ordering: "priority_then_id_then_path",
        source: "node.scenarios",
      },
    };
  }
  const selectorsParsed = parseScenarioSelectors(scenarioSelector, { allowEmpty: true });
  if (!selectorsParsed.ok) {
    return {
      ok: false,
      code: selectorsParsed.code,
      schema_version: JUDGE_SCENARIO_SELECTION_SCHEMA_VERSION,
      configured: "false",
      selector_paths: [],
      selector_sources: ["node.scenarios"],
      registry_root: normalizePath(resolvedRootCheck.registry_root),
      scenario_paths: [],
      scenario_ids: [],
      selected_scenarios: [],
      missing_selector_paths: [],
      scenario_signature_sha256: "",
      scenario_count: "0",
      scenario_basis: {
        schema_version: JUDGE_SCENARIO_BASIS_SCHEMA_VERSION,
        category: "unconfigured",
        ordering: "priority_then_id_then_path",
        source: "node.scenarios",
      },
    };
  }
  const configured = selectorsParsed.selectors.length > 0;
  const collected = collectScenarioSelection({
    selectors: selectorsParsed.selectors,
    scenarioContext,
    scope,
    registryRoot: resolvedRootCheck.registry_root,
  });
  if (!collected.ok) {
    return {
      ok: false,
      code: collected.code,
      schema_version: JUDGE_SCENARIO_SELECTION_SCHEMA_VERSION,
      configured: configured ? "true" : "false",
      selector_paths: selectorsParsed.selectors,
      selector_sources: ["node.scenarios"],
      registry_root: collected.registry_root,
      scenario_paths: [],
      scenario_ids: [],
      selected_scenarios: [],
      missing_selector_paths: [],
      scenario_signature_sha256: "",
      scenario_count: "0",
      scenario_basis: {
        schema_version: JUDGE_SCENARIO_BASIS_SCHEMA_VERSION,
        category: configured ? "configured" : "unconfigured",
        ordering: "priority_then_id_then_path",
        source: "node.scenarios",
      },
    };
  }
  const signature = computeScenarioSignature({
    selectorPaths: selectorsParsed.selectors,
    scenarioPaths: collected.scenario_paths,
  });
  const payload = {
    schema_version: JUDGE_SCENARIO_SELECTION_SCHEMA_VERSION,
    configured: configured ? "true" : "false",
    selector_paths: selectorsParsed.selectors,
    selector_sources: ["node.scenarios"],
    registry_root: collected.registry_root,
    scenario_ids: collected.scenario_ids,
    scenario_paths: collected.scenario_paths,
    selected_scenarios: collected.selected,
    missing_selector_paths: collected.missing_selector_paths,
    scenario_count: String(collected.selected.length),
    scenario_basis: {
      schema_version: JUDGE_SCENARIO_BASIS_SCHEMA_VERSION,
      category: configured ? "configured" : "unconfigured",
      ordering: "priority_then_id_then_path",
      source: "node.scenarios",
    },
    scenario_signature_sha256: signature,
  };
  return {
    ...payload,
    ok: true,
    code: "ok",
  };
}
