import { ghGraphqlQuery } from "@hatch/github-adapter";

import { readAllRunStates } from "./factory-status-support.ts";

const MAX_PROGRESS_WAVES = 10;
const MAX_PROGRESS_FEATURE_IDS = 10;

function parseJson(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function buildSearchQuery(repo, labels = []) {
  const labelTerms = labels.map((l) => ` label:${l}`).join("");
  return `repo:${repo} is:issue is:open${labelTerms}`;
}

function buildGraphqlSearch(repo, labels = []) {
  const q = buildSearchQuery(repo, labels).replace(/"/g, '\\"');
  return `query { search(query: \"${q}\", type: ISSUE, first: 100) { nodes { ... on Issue { number blockedBy(first: 100) { nodes { number state } } } } } }`;
}

function fetchIssueNodes({ repo, labels = [], ghGraphqlFn = ghGraphql } = {}) {
  const payload = ghGraphqlFn(buildGraphqlSearch(repo, labels), {});
  return payload?.data?.search?.nodes || [];
}

function countUnblocked(nodes = []) {
  let unblocked = 0;
  for (const issue of nodes) {
    const blockers = issue?.blockedBy?.nodes || [];
    const openBlockers = blockers.filter((b) => String(b?.state || "").toUpperCase() === "OPEN");
    if (openBlockers.length === 0) unblocked += 1;
  }
  return unblocked;
}

function normalizeTelemetry(raw = {}) {
  if (!raw || typeof raw !== "object") return null;
  const waveIssueNumber = Number(raw.wave_issue_number);
  return {
    wave_issue_number: Number.isFinite(waveIssueNumber) ? waveIssueNumber : 0,
    milestone: String(raw.milestone || ""),
    reason: String(raw.reason || ""),
    wave_stale_minutes: Number(raw.wave_stale_minutes || 0),
    threshold_minutes: Number(raw.threshold_minutes || 0),
    open_feature_count: Number(raw.open_feature_count || 0),
    open_feature_numbers: Array.isArray(raw.open_feature_numbers)
      ? raw.open_feature_numbers.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
      : [],
  };
}

function collectStalledWaveTelemetry({ runsDir = ".hatch/runs", reader = null } = {}) {
  const entries = [];
  const runRows = reader && typeof reader.listRuns === "function"
    ? reader.listRuns().map((row) => row?.state).filter(Boolean)
    : [...readAllRunStates({ runsDir }).values()];

  for (const state of runRows) {
    const ctx = state.context || {};
    const raw = ctx.stalled_wave_telemetry || ctx.stalledWaveTelemetry || "";
    if (!raw) continue;
    const parsed = typeof raw === "string" ? parseJson(raw, null) : raw;
    if (!Array.isArray(parsed)) continue;
    for (const item of parsed) {
      const normalized = normalizeTelemetry(item);
      if (normalized) entries.push(normalized);
    }
  }
  return entries;
}

function summarizeStalledWaveTelemetry(entries = []) {
  const dedup = new Map();
  for (const item of entries) {
    const key = `${item.wave_issue_number}:${item.milestone}`;
    if (!dedup.has(key)) dedup.set(key, item);
  }

  const unique = [...dedup.values()];
  unique.sort((a, b) => (b.wave_stale_minutes - a.wave_stale_minutes) || String(a.milestone).localeCompare(String(b.milestone)));

  const totalFeatures = unique.reduce((sum, item) => sum + (Number(item.open_feature_count) || item.open_feature_numbers.length || 0), 0);
  const featureIds = [];
  for (const item of unique) {
    for (const id of item.open_feature_numbers || []) {
      if (!featureIds.includes(id)) featureIds.push(id);
    }
  }
  featureIds.sort((a, b) => a - b);

  return {
    stalled_wave_count: unique.length,
    stalled_wave_feature_count: totalFeatures,
    stalled_wave_feature_ids: featureIds.slice(0, MAX_PROGRESS_FEATURE_IDS),
    stalled_waves: unique.slice(0, MAX_PROGRESS_WAVES),
  };
}

export function collectFactoryProgressMetrics({ repo, ghGraphqlFn = ghGraphqlQuery, runsDir = ".hatch/runs", reader = null } = {}) {
  if (!repo) return { error: "missing_repo" };

  const readyGoals = fetchIssueNodes({ repo, labels: ["goal", "ready"], ghGraphqlFn });
  const openFeatures = fetchIssueNodes({ repo, labels: ["feature"], ghGraphqlFn });
  const openBugs = fetchIssueNodes({ repo, labels: ["bug"], ghGraphqlFn });

  const goals_ready_total = readyGoals.length;
  const goals_ready_unblocked = countUnblocked(readyGoals);
  const features_open_total = openFeatures.length;
  const features_open_unblocked = countUnblocked(openFeatures);

  const stalledWaveTelemetry = summarizeStalledWaveTelemetry(collectStalledWaveTelemetry({ runsDir, reader }));

  return {
    repo,
    goals_ready_total,
    goals_ready_unblocked,
    goals_ready_blocked: Math.max(0, goals_ready_total - goals_ready_unblocked),
    features_open_total,
    features_open_unblocked,
    features_open_blocked: Math.max(0, features_open_total - features_open_unblocked),
    bugs_open_total: openBugs.length,
    stalled_wave_count: stalledWaveTelemetry.stalled_wave_count,
    stalled_wave_feature_count: stalledWaveTelemetry.stalled_wave_feature_count,
    stalled_wave_feature_ids: stalledWaveTelemetry.stalled_wave_feature_ids,
    stalled_waves: stalledWaveTelemetry.stalled_waves,
  };
}

export function formatFactoryProgressMetrics(metrics = {}) {
  if (metrics?.error) return `[PROGRESS] error=${metrics.error}`;
  const stalledCount = Number(metrics?.stalled_wave_count || 0);
  const stalledFeatures = Number(metrics?.stalled_wave_feature_count || 0);
  const stalledFeatureIds = Array.isArray(metrics?.stalled_wave_feature_ids)
    ? metrics.stalled_wave_feature_ids.join(",")
    : "";
  return `[PROGRESS] goals_ready_unblocked=${metrics.goals_ready_unblocked}/${metrics.goals_ready_total} features_unblocked=${metrics.features_open_unblocked}/${metrics.features_open_total} open_bugs=${metrics.bugs_open_total} stalled_waves=${stalledCount} stalled_wave_features=${stalledFeatures} stalled_wave_feature_ids=${stalledFeatureIds}`;
}
