import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { parseJson, trim } from "./cli-helpers.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_SCENARIO_REGISTRY_ROOT = "factories/mothership/scenarios/astrochicken";
export const DEFAULT_SCENARIO_RUNS_ROOT = ".hatch/runs";
export const DEFAULT_SCENARIO_LOOKBACK_RUNS = 30;
export const DEFAULT_SCENARIO_STALE_DAYS = 90;
export const SCENARIO_REGISTRY_MAX_COUNT = 30;

function normalizePath(value = "") {
  return trim(value).replaceAll("\\", "/").replace(/^\.\//, "");
}

function toAbsolute(pathValue = "", fallback = "") {
  const raw = trim(pathValue);
  const candidate = raw || trim(fallback);
  if (!candidate) return "";
  return isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFrontmatter(content = "") {
  const match = String(content || "").match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return {};

  const out = {};
  for (const rawLine of String(match[1] || "").split("\n")) {
    const line = trim(rawLine);
    if (!line || line.startsWith("#")) continue;
    const kv = line.match(/^([A-Za-z0-9_.-]+):\s*(.+)$/);
    if (!kv) continue;
    out[trim(kv[1])] = trim(String(kv[2] || "").replace(/^['"]|['"]$/g, ""));
  }

  return out;
}

function inferScenarioPathFields(relativePath = "") {
  const parts = normalizePath(relativePath).split("/").filter(Boolean);
  const fileName = parts[parts.length - 1] || "";
  const id = parts.length >= 2 ? parts[parts.length - 2] : fileName;
  const domain = parts.length >= 3 ? parts[parts.length - 3] : "";
  const scope = parts.length >= 4 ? parts[parts.length - 4] : "";
  return {
    id: trim(id),
    domain: trim(domain),
    scope: trim(scope),
  };
}

function collectScenarioFiles(rootPath = "") {
  if (!rootPath || !existsSync(rootPath)) return [];

  const files = [];
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

      if (stats.isFile() && entry === "SCENARIO.md") {
        files.push(full);
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function readScenarioFileMetadata({ absolutePath = "", registryRoot = "" } = {}) {
  const relativePath = normalizePath(relative(registryRoot, absolutePath));

  let content = "";
  try {
    content = readFileSync(absolutePath, "utf8");
  } catch {
    content = "";
  }

  const frontmatter = parseFrontmatter(content);
  const inferred = inferScenarioPathFields(relativePath);

  return {
    scenario_id: trim(frontmatter.id) || inferred.id,
    domain: trim(frontmatter.domain) || inferred.domain,
    priority: trim(frontmatter.priority),
    created: trim(frontmatter.created),
    status: trim(frontmatter.status),
    scope: trim(frontmatter.scope) || inferred.scope,
    path: relativePath,
  };
}

function listRunRoots(runsRoot = "") {
  if (!runsRoot || !existsSync(runsRoot)) return [];

  const roots = [];
  let entries = [];
  try {
    entries = readdirSync(runsRoot).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }

  for (const entry of entries) {
    const full = join(runsRoot, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      roots.push({ path: full, mtime_ms: stats.mtimeMs });
    }
  }

  roots.sort((a, b) => b.mtime_ms - a.mtime_ms || a.path.localeCompare(b.path));
  return roots;
}

function collectSelectionArtifacts(rootPath = "") {
  if (!rootPath || !existsSync(rootPath)) return [];

  const artifacts = [];
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

      if (!stats.isFile() || !entry.endsWith(".json")) continue;

      const normalized = normalizePath(full);
      if (!normalized.includes("/judge/scenario-selection/")) continue;

      artifacts.push({
        path: full,
        mtime_ms: stats.mtimeMs,
      });
    }
  }

  artifacts.sort((a, b) => b.mtime_ms - a.mtime_ms || a.path.localeCompare(b.path));
  return artifacts;
}

function mergeUsage(current = null, next = null) {
  const base = current || {
    usage_count: 0,
    last_used_epoch_ms: 0,
    last_used: "",
  };

  const candidate = next || {
    usage_count: 0,
    last_used_epoch_ms: 0,
    last_used: "",
  };

  const lastEpoch = Math.max(base.last_used_epoch_ms || 0, candidate.last_used_epoch_ms || 0);

  return {
    usage_count: Number(base.usage_count || 0) + Number(candidate.usage_count || 0),
    last_used_epoch_ms: lastEpoch,
    last_used: lastEpoch > 0 ? new Date(lastEpoch).toISOString() : "",
  };
}

function selectionEntryFromArtifact(entry = {}, mtimeMs = 0) {
  return {
    scenario_id: trim(entry?.scenario_id),
    scenario_path: normalizePath(entry?.scenario_path),
    usage_count: 1,
    last_used_epoch_ms: mtimeMs,
    last_used: mtimeMs > 0 ? new Date(mtimeMs).toISOString() : "",
  };
}

function collectUsageFromArtifacts(artifacts = []) {
  const usageByPath = new Map();
  const usageById = new Map();
  let parsedArtifactCount = 0;

  for (const artifact of artifacts) {
    let raw = "";
    try {
      raw = readFileSync(artifact.path, "utf8");
    } catch {
      continue;
    }

    const parsed = parseJson(raw, null);
    if (!parsed || typeof parsed !== "object") continue;

    const selected = Array.isArray(parsed.selected_scenarios) ? parsed.selected_scenarios : [];
    if (selected.length === 0) continue;

    parsedArtifactCount += 1;
    for (const entry of selected) {
      const normalized = selectionEntryFromArtifact(entry, artifact.mtime_ms);
      if (normalized.scenario_path) {
        usageByPath.set(
          normalized.scenario_path,
          mergeUsage(usageByPath.get(normalized.scenario_path), normalized),
        );
      }
      if (normalized.scenario_id) {
        usageById.set(
          normalized.scenario_id,
          mergeUsage(usageById.get(normalized.scenario_id), normalized),
        );
      }
    }
  }

  return {
    usage_by_path: usageByPath,
    usage_by_id: usageById,
    parsed_artifact_count: parsedArtifactCount,
  };
}

function findPathUsageMatches(path = "", usageByPath = new Map()) {
  const normalizedPath = normalizePath(path);
  if (!normalizedPath) return [];

  const matches = [];
  for (const [usagePath, usage] of usageByPath.entries()) {
    const normalizedUsagePath = normalizePath(usagePath);
    if (!normalizedUsagePath) continue;
    if (normalizedUsagePath === normalizedPath) {
      matches.push(usage);
      continue;
    }
    if (normalizedUsagePath.endsWith(`/${normalizedPath}`) || normalizedPath.endsWith(`/${normalizedUsagePath}`)) {
      matches.push(usage);
    }
  }

  return matches;
}

export function loadScenarioRegistry({ registryRoot = DEFAULT_SCENARIO_REGISTRY_ROOT } = {}) {
  const resolvedRegistryRoot = toAbsolute(registryRoot, DEFAULT_SCENARIO_REGISTRY_ROOT);
  const scenarioFiles = collectScenarioFiles(resolvedRegistryRoot);

  const rows = scenarioFiles.map((filePath) => readScenarioFileMetadata({
    absolutePath: filePath,
    registryRoot: resolvedRegistryRoot,
  }));

  rows.sort((a, b) => a.path.localeCompare(b.path));

  return {
    registry_root: resolvedRegistryRoot,
    scenario_count: rows.length,
    rows,
  };
}

export function collectJudgeScenarioUsage({
  runsRoot = DEFAULT_SCENARIO_RUNS_ROOT,
  lookbackRuns = DEFAULT_SCENARIO_LOOKBACK_RUNS,
} = {}) {
  const resolvedRunsRoot = toAbsolute(runsRoot, DEFAULT_SCENARIO_RUNS_ROOT);
  const lookback = parsePositiveInt(lookbackRuns, DEFAULT_SCENARIO_LOOKBACK_RUNS);

  const runRoots = listRunRoots(resolvedRunsRoot);
  const scopedRunRoots = runRoots.slice(0, lookback);

  let artifacts = [];
  for (const runRoot of scopedRunRoots) {
    artifacts = artifacts.concat(collectSelectionArtifacts(runRoot.path));
  }

  if (scopedRunRoots.length === 0 && existsSync(resolvedRunsRoot)) {
    artifacts = collectSelectionArtifacts(resolvedRunsRoot);
  }

  const usage = collectUsageFromArtifacts(artifacts);

  return {
    runs_root: resolvedRunsRoot,
    lookback_runs: lookback,
    observed_run_count: scopedRunRoots.length,
    selection_artifact_count: artifacts.length,
    parsed_selection_artifact_count: usage.parsed_artifact_count,
    usage_by_path: usage.usage_by_path,
    usage_by_id: usage.usage_by_id,
  };
}

export function resolveScenarioUsage({
  scenarioPath = "",
  scenarioId = "",
  usageByPath = new Map(),
  usageById = new Map(),
} = {}) {
  const pathMatches = findPathUsageMatches(scenarioPath, usageByPath);
  if (pathMatches.length > 0) {
    const merged = pathMatches.reduce((acc, value) => mergeUsage(acc, value), null) || {
      usage_count: 0,
      last_used_epoch_ms: 0,
      last_used: "",
    };
    const source = pathMatches.length === 1 ? "scenario_path" : "scenario_path_suffix";
    return {
      usage_count: Number(merged.usage_count || 0),
      last_used_epoch_ms: Number(merged.last_used_epoch_ms || 0),
      last_used: merged.last_used || "",
      usage_source: source,
    };
  }

  const idKey = trim(scenarioId);
  if (idKey && usageById.has(idKey)) {
    const byId = usageById.get(idKey) || {
      usage_count: 0,
      last_used_epoch_ms: 0,
      last_used: "",
    };
    return {
      usage_count: Number(byId.usage_count || 0),
      last_used_epoch_ms: Number(byId.last_used_epoch_ms || 0),
      last_used: byId.last_used || "",
      usage_source: "scenario_id",
    };
  }

  return {
    usage_count: 0,
    last_used_epoch_ms: 0,
    last_used: "",
    usage_source: "unobserved",
  };
}

export function isScenarioStale({
  usageCount = 0,
  lastUsedEpochMs = 0,
  staleDays = DEFAULT_SCENARIO_STALE_DAYS,
  nowEpochMs = Date.now(),
} = {}) {
  const count = Number(usageCount || 0);
  if (count <= 0) return true;

  const lastUsed = Number(lastUsedEpochMs || 0);
  if (!Number.isFinite(lastUsed) || lastUsed <= 0) return true;

  const staleWindowDays = parsePositiveInt(staleDays, DEFAULT_SCENARIO_STALE_DAYS);
  const ageMs = Math.max(Number(nowEpochMs || 0) - lastUsed, 0);
  return ageMs > staleWindowDays * DAY_MS;
}

export function normalizeScenarioRegistryPath(pathValue = "") {
  return normalizePath(pathValue);
}
