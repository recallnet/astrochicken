import { trim } from "../lib/cli-helpers.ts";
import {
  collectJudgeScenarioUsage,
  DEFAULT_SCENARIO_LOOKBACK_RUNS,
  DEFAULT_SCENARIO_REGISTRY_ROOT,
  DEFAULT_SCENARIO_RUNS_ROOT,
  DEFAULT_SCENARIO_STALE_DAYS,
  isScenarioStale,
  loadScenarioRegistry,
  normalizeScenarioRegistryPath,
  resolveScenarioUsage,
  SCENARIO_REGISTRY_MAX_COUNT,
} from "../lib/scenario-registry.ts";

function toIsoOrNever(epochMs = 0) {
  const value = Number(epochMs || 0);
  if (!Number.isFinite(value) || value <= 0) return "never";
  return new Date(value).toISOString();
}

function compareRows(a = {}, b = {}) {
  const staleA = String(a.stale) === "true";
  const staleB = String(b.stale) === "true";
  if (staleA !== staleB) return staleA ? -1 : 1;

  const usageA = Number(a.usage_count || 0);
  const usageB = Number(b.usage_count || 0);
  if (usageA !== usageB) return usageA - usageB;

  const lastA = Number(a.last_used_epoch_ms || 0);
  const lastB = Number(b.last_used_epoch_ms || 0);
  if (lastA !== lastB) return lastA - lastB;

  return String(a.scenario_id || "").localeCompare(String(b.scenario_id || ""));
}

export function scenarioCurate({
  registryRoot = DEFAULT_SCENARIO_REGISTRY_ROOT,
  runsRoot = DEFAULT_SCENARIO_RUNS_ROOT,
  lookbackRuns = DEFAULT_SCENARIO_LOOKBACK_RUNS,
  staleDays = DEFAULT_SCENARIO_STALE_DAYS,
} = {}) {
  const registry = loadScenarioRegistry({ registryRoot });
  const usage = collectJudgeScenarioUsage({ runsRoot, lookbackRuns });

  const rows = registry.rows.map((scenario) => {
    const usageStats = resolveScenarioUsage({
      scenarioPath: scenario.path,
      scenarioId: scenario.scenario_id,
      usageByPath: usage.usage_by_path,
      usageById: usage.usage_by_id,
    });

    const stale = isScenarioStale({
      usageCount: usageStats.usage_count,
      lastUsedEpochMs: usageStats.last_used_epoch_ms,
      staleDays,
    });

    return {
      scenario_id: scenario.scenario_id,
      domain: scenario.domain,
      priority: scenario.priority,
      path: scenario.path,
      usage_count: String(usageStats.usage_count),
      last_used: toIsoOrNever(usageStats.last_used_epoch_ms),
      last_used_epoch_ms: String(usageStats.last_used_epoch_ms || 0),
      stale: stale ? "true" : "false",
      usage_source: usageStats.usage_source,
    };
  });

  rows.sort((a, b) => compareRows(a, b));

  const stale_count = rows.filter((row) => row.stale === "true").length;
  const scenario_count = registry.scenario_count;
  const withinCeiling = scenario_count <= SCENARIO_REGISTRY_MAX_COUNT;
  const staleCandidates = rows.filter((row) => row.stale === "true").map((row) => row.scenario_id);

  return {
    ok: withinCeiling,
    error: withinCeiling
      ? ""
      : `scenario registry count ${scenario_count} exceeds configured ceiling ${SCENARIO_REGISTRY_MAX_COUNT}`,
    registry_root: registry.registry_root,
    runs_root: usage.runs_root,
    lookback_runs: String(usage.lookback_runs),
    stale_days: String(staleDays),
    scenario_count: String(scenario_count),
    scenario_count_ceiling: String(SCENARIO_REGISTRY_MAX_COUNT),
    observed_run_count: String(usage.observed_run_count),
    selection_artifact_count: String(usage.selection_artifact_count),
    parsed_selection_artifact_count: String(usage.parsed_selection_artifact_count),
    stale_count: String(stale_count),
    stale_candidates: staleCandidates,
    rows,
    notes: [
      "scenario authoring is deliberate: add truths only when evidence shows coverage gaps.",
      "stale=true means zero observed usage or last use older than stale_days.",
    ],
  };
}

export function formatScenarioCurateTable(out = {}) {
  const rows = Array.isArray(out.rows) ? out.rows : [];
  const lines = [
    "Scenario curation report",
    `registry_root=${trim(out.registry_root)}`,
    `runs_root=${trim(out.runs_root)}`,
    `lookback_runs=${trim(out.lookback_runs)}`,
    `stale_days=${trim(out.stale_days)}`,
    `scenario_count=${trim(out.scenario_count)}/${trim(out.scenario_count_ceiling)}`,
    `stale_count=${trim(out.stale_count)}`,
    `observed_run_count=${trim(out.observed_run_count)}`,
    "",
    ["scenario_id", "domain", "priority", "usage", "last_used", "stale", "path"].join("\t"),
  ];

  for (const row of rows) {
    lines.push([
      row.scenario_id || "",
      row.domain || "",
      row.priority || "",
      row.usage_count || "0",
      row.last_used || "never",
      row.stale || "true",
      normalizeScenarioRegistryPath(row.path || ""),
    ].join("\t"));
  }

  if (Array.isArray(out.notes) && out.notes.length > 0) {
    lines.push("", "notes:");
    for (const note of out.notes) {
      lines.push(`- ${note}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
