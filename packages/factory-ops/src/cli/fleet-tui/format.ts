/**
 * Pure formatting functions for fleet TUI display.
 */

import {
  summarizeFleetWarning,
  summarizeFactoryAttention,
} from "../../lib/factory-fleet-attention.ts";

export function trim(value = "") {
  return String(value || "").trim();
}

function isBootstrapPlaceholder(value = "") {
  const text = trim(value);
  if (!text) return false;
  // @context:regression The fleet bootstrap snapshot intentionally paints placeholder text before
  // the first live hydrate. Detail mode refreshes the dashboard, not the original fleet row, so the
  // formatter must collapse these placeholders back to stable idle empty-state copy.
  return text === "Loading live factory state…" || text === "Hydrating fleet state…";
}

export function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function humanizeGraphName(value = "") {
  const raw = trim(value).replace(/\.dot$/i, "");
  if (!raw) return "";
  return (raw.split("/").pop() || raw)
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function humanizeRecentSummary(value = "") {
  return trim(value)
    .replace(/factory_supervisor_tick\.dot/ig, "supervisor tick")
    .replace(/managed_supervisor\.dot/ig, "managed supervisor")
    .replace(/triage_item\.dot/ig, "triage item")
    .replace(/goal_execute\.dot/ig, "goal execute")
    .replace(/goal_issue_execute\.dot/ig, "issue execute")
    .replace(/run_managed_supervisor_shell/ig, "managed supervisor")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const summarizeWarning = summarizeFleetWarning;

export function daemonLabel(row = {}) {
  const health = row?.daemon_health || {};
  if (health.running === true) return "running";
  return trim(health.status || "stopped") || "stopped";
}

export function healthTone(health = "") {
  const normalized = trim(health);
  if (normalized === "healthy") return { color: "green", label: "Healthy" };
  if (normalized === "blocked") return { color: "yellow", label: "Blocked" };
  if (normalized === "upgrading") return { color: "cyan", label: "Upgrading" };
  if (normalized === "idle") return { color: "gray", label: "Idle" };
  return { color: "red", label: "Down" };
}

export function healthGlyph(health = "") {
  const normalized = trim(health);
  if (normalized === "healthy") return { glyph: "●", color: "green" };
  if (normalized === "blocked") return { glyph: "◆", color: "yellow" };
  if (normalized === "idle") return { glyph: "○", color: "gray" };
  if (normalized === "upgrading") return { glyph: "◐", color: "cyan" };
  return { glyph: "▲", color: "red" };
}

export function shortHealthLabel(health = "") {
  return healthTone(health).label.toLowerCase();
}

export function rowCurrentSummary(row = {}) {
  const issues = Array.isArray(row.active_issues) ? row.active_issues.filter(Boolean) : [];
  const waves = Array.isArray(row.active_waves) ? row.active_waves.filter(Boolean) : [];
  const summary = trim(row.active_work_summary);
  if (isBootstrapPlaceholder(summary) && issues.length === 0 && waves.length === 0) {
    return "no active work";
  }
  const stage = summary
    .replace(/^waves=[^ ]+\s+issues=[^ ]+\s+stage=/i, "")
    .replace(/^waves=[^ ]+\s+issues=[^ ]+/i, "")
    .trim();
  if (issues.length > 0) {
    const issueLabel = issues.slice(0, 3).map((issue) => `#${issue}`).join(" · ");
    return stage ? `${issueLabel} · ${humanizeRecentSummary(stage)}` : issueLabel;
  }
  if (waves.length > 0) {
    const waveLabel = waves.slice(0, 2).join(" · ");
    return stage ? `${waveLabel} · ${humanizeRecentSummary(stage)}` : waveLabel;
  }
  if (stage) return humanizeRecentSummary(stage);
  return "no active work";
}

function recentOutcomes(row = {}) {
  return Array.isArray(row?.recent_outcomes) ? row.recent_outcomes[0] || {} : {};
}

export function rowRecentOutcomeCount(row = {}) {
  const outcomes = recentOutcomes(row);
  return [
    toNumber(outcomes.closed_goals, 0),
    toNumber(outcomes.merged_prs, 0),
    toNumber(outcomes.closed_features, 0),
    toNumber(outcomes.closed_bugs, 0),
    toNumber(outcomes.merge_commits_main, 0),
  ].reduce((sum, value) => sum + value, 0);
}

export function rowRecentOutcomeSummary(row = {}) {
  const outcomes = recentOutcomes(row);
  const goalCount = toNumber(outcomes.closed_goals, 0);
  const mergeCount = toNumber(outcomes.merged_prs, 0);
  const issueCount = toNumber(outcomes.closed_features, 0) + toNumber(outcomes.closed_bugs, 0);
  const commitCount = toNumber(outcomes.merge_commits_main, 0);
  const parts = [];
  if (goalCount > 0) parts.push(`${goalCount} goal${goalCount === 1 ? "" : "s"}`);
  if (mergeCount > 0) parts.push(`${mergeCount} merge${mergeCount === 1 ? "" : "s"}`);
  if (issueCount > 0) parts.push(`${issueCount} issue${issueCount === 1 ? "" : "s"}`);
  if (commitCount > 0) parts.push(`${commitCount} commit${commitCount === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export function rowRecentSummary(row = {}) {
  const outcomeSummary = rowRecentOutcomeSummary(row);
  // @context:decision !critical The fleet TUI's primary "Recent" lane must be canonical-first.
  // Host-run residue can lag or disagree with PG-backed lifecycle state, so operator summaries
  // prefer durable outcomes and only fall back to the empty-state copy when no outcomes exist.
  if (outcomeSummary) return outcomeSummary;
  const recent = trim(row?.recent_host_activity?.latest_summary);
  if (isBootstrapPlaceholder(recent) && toNumber(row?.recent_host_activity?.count, 0) <= 0) {
    return "no recent work";
  }
  return "no recent work";
}

export const rowAttention = summarizeFactoryAttention;

export function warningSummary(snapshot = {}, row = {}) {
  const localWarning = rowAttention(row);
  if (isBootstrapPlaceholder(localWarning)) return "";
  if (localWarning) return localWarning;
  const warnings = Array.isArray(snapshot?.warnings)
    ? snapshot.warnings.filter((entry) => trim(entry) !== "fleet_bootstrap_snapshot")
    : [];
  return warnings.length > 0 ? summarizeWarning(warnings[0]) : "";
}

export function matchesSearch(row = {}, query = "") {
  const needle = trim(query).toLowerCase();
  if (!needle) return true;
  const haystack = [
    row.factory_id,
    row.target_repo,
    row.health,
    row.release_state,
    row.active_work_summary,
    row.blocked_reason,
    row?.managed_state?.reason,
    row?.recent_host_activity?.latest_summary,
    row?.recent_host_activity?.latest_graph,
    row.gate_reason,
  ].join(" ").toLowerCase();
  return haystack.includes(needle);
}

export function matchesView(row = {}, view = "all") {
  if (view === "all") return true;
  if (view === "blocked") return trim(row.health) === "blocked";
  if (view === "unhealthy") return trim(row.health) === "unhealthy";
  if (view === "idle") return trim(row.health) === "idle";
  if (view === "active") {
    return (Array.isArray(row.active_waves) && row.active_waves.length > 0)
      || (Array.isArray(row.active_issues) && row.active_issues.length > 0)
      || trim(row.health) === "healthy";
  }
  return true;
}

export function availableViews() {
  return [
    { id: "all", title: "All" },
    { id: "active", title: "Active" },
    { id: "blocked", title: "Blocked" },
    { id: "unhealthy", title: "Unhealthy" },
    { id: "idle", title: "Idle" },
  ];
}

const SPARKLINE_CHARS = "▁▂▃▄▅▆▇█";

export function renderMeter(count = 0, max = 8) {
  const active = Math.max(0, Math.min(max, Number(count) || 0));
  const filled = Math.max(0, active);
  const empty = Math.max(0, max - active);
  if (filled === 0) return "░".repeat(max);
  const intensity = Math.min(SPARKLINE_CHARS.length - 1, Math.floor((filled / max) * (SPARKLINE_CHARS.length - 1)));
  const sparkChar = SPARKLINE_CHARS[intensity];
  return `${sparkChar.repeat(filled)}${"░".repeat(empty)}`;
}

export function topSummary(snapshot = {}) {
  const totals = snapshot?.fleet_totals && typeof snapshot.fleet_totals === "object" ? snapshot.fleet_totals : {};
  const factories = Array.isArray(snapshot?.factories) ? snapshot.factories : [];
  const running = factories.filter((row) => {
    const waveCount = Array.isArray(row?.active_waves) ? row.active_waves.length : 0;
    const issueCount = Array.isArray(row?.active_issues) ? row.active_issues.length : 0;
    return waveCount + issueCount > 0 || trim(row?.health) === "healthy";
  }).length;
  const recent = factories.filter((row) => rowRecentOutcomeCount(row) > 0).length;
  return {
    total: toNumber(totals.total_factories, factories.length),
    running,
    unhealthy: toNumber(totals.unhealthy, 0),
    recent,
  };
}

export function formatDetailMeta(row = {}) {
  return [
    trim(row.kind).replace(/_/g, " "),
    trim(row.issue),
    trim(row.status),
    trim(row.updated_age),
  ].filter(Boolean).join(" · ");
}

export function compactRowTitle(row = {}) {
  return trim(row.title || row.summary || row.id || "Selected row");
}

export function normalizeRowDetail(row = {}) {
  return Array.isArray(row?.detail) ? row.detail.map((entry) => trim(entry)).filter(Boolean) : [];
}

export function padCell(value = "", width = 12) {
  const text = trim(value);
  if (width <= 0) return "";
  if (text.length >= width) {
    return `${text.slice(0, Math.max(1, width - 1))}…`;
  }
  return text.padEnd(width, " ");
}
