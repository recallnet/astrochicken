import {
  summarizeFactoryAttention,
} from "../lib/factory-fleet-attention.ts";

function trim(value = "") {
  return String(value || "").trim();
}

export function buildFactoryAttentionReport(fleetStatus = {}) {
  const rows = Array.isArray(fleetStatus?.factories) ? fleetStatus.factories : [];
  const items = rows
    .map((row) => ({
      factory_id: trim(row.factory_id) || "unknown",
      health: trim(row.health) || "unknown",
      attention: summarizeFactoryAttention(row),
      blocked_reason: trim(row.blocked_reason),
      outcomes_summary: Array.isArray(row.recent_outcomes) ? trim(row.recent_outcomes[0]?.summary) : "",
    }))
    .filter((row) => row.attention)
    .sort((left, right) => left.factory_id.localeCompare(right.factory_id));

  return {
    schema_version: "factory_attention.v1",
    generated_at: trim(fleetStatus.generated_at),
    kpis: fleetStatus?.kpis && typeof fleetStatus.kpis === "object" ? fleetStatus.kpis : {},
    summary: {
      total_factories: rows.length,
      attention_factories: items.length,
      attention_ids: items.map((row) => row.factory_id),
    },
    items,
  };
}

export function formatFactoryAttentionHuman(report = {}) {
  const lines = [];
  const kpis = report?.kpis && typeof report.kpis === "object" ? report.kpis : {};
  const summary = report?.summary && typeof report.summary === "object" ? report.summary : {};
  lines.push(`Factory attention generated_at=${trim(report.generated_at) || "(unknown)"}`);
  lines.push(`KPIs window=${Number(kpis.window_hours || 0)}h factories_reporting=${Number(kpis.factories_reporting || 0)} daemons_running=${Number(kpis.daemons_running || 0)} last_tick_known=${Number(kpis.last_tick_known || 0)} goals=${Number(kpis.closed_goals || 0)} issues=${Number(kpis.closed_features || 0)} bugs=${Number(kpis.closed_bugs || 0)} merge_commits=${Number(kpis.merge_commits_main || 0)}`);
  lines.push(`Attention total=${Number(summary.attention_factories || 0)}/${Number(summary.total_factories || 0)}`);
  const items = Array.isArray(report?.items) ? report.items : [];
  for (const item of items) {
    lines.push(`${item.factory_id} health=${item.health} attention=${item.attention} outcomes=${item.outcomes_summary || "none"}`);
  }
  if (items.length === 0) lines.push("No operator attention required.");
  return lines.join("\n");
}
