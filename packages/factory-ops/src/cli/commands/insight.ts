import { Command, Option } from "clipanion";

import {
  resolveFactoryContextOrExit,
} from "../factory-command-helpers.ts";
import {
  parsePositiveNumber,
} from "../helpers.ts";

function formatIsoAge(timestamp = "") {
  const parsed = Date.parse(String(timestamp || ""));
  if (!Number.isFinite(parsed)) return "unknown";
  const ageMs = Math.max(0, Date.now() - parsed);
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function formatFailureSummary(projection = {}) {
  const lines = [
    `Failures  window=${projection?.filters?.lookback_hours || 0}h  signatures=${projection?.total_signatures || 0}  events=${projection?.total_failure_events || 0}`,
  ];

  const rows = Array.isArray(projection?.rows) ? projection.rows : [];
  if (rows.length === 0) {
    lines.push("No failure signatures in scope.");
    return lines.join("\n");
  }

  for (const [index, row] of rows.entries()) {
    lines.push(
      `${index + 1}. ${row.graph_id}/${row.node_name}  failures=${row.failure_count}  runs=${row.run_count}  class=${row.error_class}  last=${formatIsoAge(row.last_timestamp)} ago`,
    );
  }

  return lines.join("\n");
}

function formatRetrySummary(projection = {}) {
  const lines = [
    `Retries  window=${projection?.filters?.lookback_hours || 0}h  hotspots=${projection?.hotspot_count || 0}  retries=${projection?.total_retry_events || 0}`,
  ];

  const rows = Array.isArray(projection?.rows) ? projection.rows : [];
  if (rows.length === 0) {
    lines.push("No retry hotspots in scope.");
    return lines.join("\n");
  }

  for (const [index, row] of rows.entries()) {
    lines.push(
      `${index + 1}. ${row.graph_id}/${row.node_name}  retries=${row.retry_count}  runs=${row.run_count}  max_attempt=${row.max_attempt}  avg_attempt=${row.avg_attempt}`,
    );
  }

  return lines.join("\n");
}

function formatLatencySummary(projection = {}) {
  const lines = [
    `Latency  window=${projection?.filters?.lookback_hours || 0}h  series=${projection?.series_count || 0}`,
  ];

  const rows = Array.isArray(projection?.rows) ? projection.rows : [];
  if (rows.length === 0) {
    lines.push("No latency drift samples in scope.");
    return lines.join("\n");
  }

  for (const [index, row] of rows.entries()) {
    const sign = Number(row.p95_drift_ms || 0) > 0 ? "+" : "";
    lines.push(
      `${index + 1}. ${row.graph_id}/${row.node_name}  baseline_p95=${row.baseline_p95_ms}ms  recent_p95=${row.recent_p95_ms}ms  drift=${sign}${row.p95_drift_ms}ms (${row.drift_direction})`,
    );
  }

  return lines.join("\n");
}

async function resolveInsightContext(command) {
  const context = await resolveFactoryContextOrExit(command, {
    runsDir: command.runsDir,
    factoryRoot: command.factoryRoot,
    factoryConfigPath: command.factoryConfigPath,
    factoryId: command.factoryId,
    targetRepo: command.repo,
    controlPlaneRepo: command.controlPlaneRepo,
    scenariosRoot: command.scenariosRoot,
  });
  if (!context) return null;

  return {
    context,
    lookbackHours: parsePositiveNumber(command.lookbackHours, 24),
    top: Math.max(1, Math.trunc(parsePositiveNumber(command.top, 5))),
    graph: command.graph,
    node: command.node,
  };
}

export class InsightFailuresCommand extends Command {
  static paths = [["insight", "failures"]];

  runsDir = Option.String("--runs-dir", "");
  lookbackHours = Option.String("--lookback-hours", "24");
  top = Option.String("--top", "5");
  graph = Option.String("--graph", "");
  node = Option.String("--node", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");
  json = Option.Boolean("--json", false);

  async execute() {
    const resolved = await resolveInsightContext(this);
    if (!resolved) return 2;

    const { aggregateFailureSignatures } = await import("../../lib/insight-projection.ts");

    const projection = aggregateFailureSignatures({
      runsDir: resolved.context.runs_dir,
      lookbackHours: resolved.lookbackHours,
      top: resolved.top,
      graph: resolved.graph,
      node: resolved.node,
    });

    if (this.json) {
      this.context.stdout.write(JSON.stringify(projection, null, 2));
    } else {
      this.context.stdout.write(formatFailureSummary(projection));
    }

    return 0;
  }
}

export class InsightRetriesCommand extends Command {
  static paths = [["insight", "retries"]];

  runsDir = Option.String("--runs-dir", "");
  lookbackHours = Option.String("--lookback-hours", "24");
  top = Option.String("--top", "5");
  graph = Option.String("--graph", "");
  node = Option.String("--node", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");
  json = Option.Boolean("--json", false);

  async execute() {
    const resolved = await resolveInsightContext(this);
    if (!resolved) return 2;

    const { aggregateRetryHotspots } = await import("../../lib/insight-projection.ts");

    const projection = aggregateRetryHotspots({
      runsDir: resolved.context.runs_dir,
      lookbackHours: resolved.lookbackHours,
      top: resolved.top,
      graph: resolved.graph,
      node: resolved.node,
    });

    if (this.json) {
      this.context.stdout.write(JSON.stringify(projection, null, 2));
    } else {
      this.context.stdout.write(formatRetrySummary(projection));
    }

    return 0;
  }
}

export class InsightLatencyCommand extends Command {
  static paths = [["insight", "latency"]];

  runsDir = Option.String("--runs-dir", "");
  lookbackHours = Option.String("--lookback-hours", "24");
  top = Option.String("--top", "5");
  graph = Option.String("--graph", "");
  node = Option.String("--node", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");
  json = Option.Boolean("--json", false);

  async execute() {
    const resolved = await resolveInsightContext(this);
    if (!resolved) return 2;

    const { measureLatencyDrift } = await import("../../lib/insight-projection.ts");

    const projection = measureLatencyDrift({
      runsDir: resolved.context.runs_dir,
      lookbackHours: resolved.lookbackHours,
      top: resolved.top,
      graph: resolved.graph,
      node: resolved.node,
    });

    if (this.json) {
      this.context.stdout.write(JSON.stringify(projection, null, 2));
    } else {
      this.context.stdout.write(formatLatencySummary(projection));
    }

    return 0;
  }
}

export { INSIGHT_PROJECTION_CONTRACT as INSIGHT_COMMAND_CONTRACT } from "../../lib/insight-projection.ts";

export const insightCommands = [
  InsightFailuresCommand,
  InsightRetriesCommand,
  InsightLatencyCommand,
];
