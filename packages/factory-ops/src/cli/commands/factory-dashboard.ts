import { Command, Option } from "clipanion";

import { parseNonNegativeNumber, parsePositiveNumber } from "../helpers.ts";

async function resolveScheduledJobsContext(context = {}) {
  const { existsSync, readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const factoryId = String(context.factory_id || "mothership").trim();
  const baseDir = String(process.env.HATCH_HOST_BASE_DIR || `${process.env.HOME || "/tmp"}/.hatch-hosts`).trim();
  const statePath = resolve(baseDir, factoryId, "tmp", "scheduled-jobs-state.json");
  const configPath = String(context.factory_config_path || "").trim();
  let config = {};
  if (configPath && existsSync(configPath)) {
    try { config = JSON.parse(readFileSync(configPath, "utf8")); } catch { /* ignore */ }
  }
  return { scheduledJobsStatePath: statePath, factoryConfig: config };
}

async function resolveFactoryContextOrExit(command, options = {}) {
  try {
    const { resolveFactoryContext } = await import("../../lib/factory-context-resolver.ts");
    return resolveFactoryContext(options);
  } catch (error) {
    command.context.stderr.write(String(error?.message || error) + "\n");
    return null;
  }
}

function formatPercent(rate = 0) {
  const value = Number(rate);
  if (!Number.isFinite(value) || value <= 0) return "0.0%";
  return `${(value * 100).toFixed(1)}%`;
}

function formatReviewMetricsHuman(metrics = {}) {
  const lines = [];
  const lookback = Number.isFinite(Number(metrics.lookback_hours)) ? Number(metrics.lookback_hours) : 0;
  const totalIssues = Number(metrics.total_issues || 0);
  const retry = metrics.retry_distribution || {};

  lines.push(`Review Harness Metrics (last ${lookback}h, ${totalIssues} issues)`);
  lines.push(`  First-pass approval rate : ${formatPercent(metrics.first_pass_approval_rate)}`);
  lines.push(`  Force-merge rate         : ${formatPercent(metrics.force_merge_rate)}`);
  lines.push(`  Retry distribution       : 1st=${Number(retry.attempt_1 || 0)}  2nd=${Number(retry.attempt_2 || 0)}  3rd=${Number(retry.attempt_3 || 0)}  force=${Number(retry.force_merged || 0)}`);
  lines.push("  Top reason codes:");

  const reasonCodes = Array.isArray(metrics.top_reason_codes) ? metrics.top_reason_codes : [];
  if (reasonCodes.length === 0) {
    lines.push("    (none)");
  } else {
    for (let index = 0; index < reasonCodes.length; index += 1) {
      const item = reasonCodes[index] || {};
      lines.push(`    ${index + 1}. ${String(item.code || "(unknown)")} (${Number(item.count || 0)})`);
    }
  }

  lines.push("  Approval rate by label:");
  const byLabel = Array.isArray(metrics.approval_rate_by_label) ? metrics.approval_rate_by_label : [];
  if (byLabel.length === 0) {
    lines.push("    (none)");
  } else {
    for (const item of byLabel) {
      const label = String(item.label || "(unknown)");
      lines.push(`    ${label} : ${Number(item.approved || 0)}/${Number(item.total || 0)}  (${formatPercent(item.rate)})`);
    }
  }

  return lines.join("\n");
}

function buildDashboardInitialFilters({ runId = "", graph = "", node = "", issue = "" } = {}) {
  const issueNumber = Number(String(issue || "").trim().replace(/^#/, ""));
  return {
    run_id: String(runId || "").trim(),
    graph: String(graph || "").trim(),
    node: String(node || "").trim(),
    issue: Number.isFinite(issueNumber) && issueNumber > 0 ? issueNumber : null,
  };
}

export class FactoryDashboardCommand extends Command {
  static paths = [["factory", "dashboard"]];

  runsDir = Option.String("--runs-dir", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");
  lookbackHours = Option.String("--lookback-hours", "24");
  runId = Option.String("--run-id", "");
  graph = Option.String("--graph", "");
  node = Option.String("--node", "");
  issue = Option.String("--issue", "");
  json = Option.Boolean("--json", false);

  async execute() {
    const { buildFactoryDashboard, formatFactoryDashboardHuman } = await import("../../commands/factory-dashboard.ts");
    const context = await resolveFactoryContextOrExit(this, {
      runsDir: this.runsDir,
      factoryRoot: this.factoryRoot,
      factoryConfigPath: this.factoryConfigPath,
      factoryId: this.factoryId,
      targetRepo: this.repo,
      controlPlaneRepo: this.controlPlaneRepo,
      scenariosRoot: this.scenariosRoot,
    });
    if (!context) return 2;

    const sjCtx = await resolveScheduledJobsContext(context);
    const dashboard = await buildFactoryDashboard({
      runsDir: context.runs_dir,
      context,
      lookbackHours: parsePositiveNumber(this.lookbackHours, 24),
      scheduledJobsStatePath: sjCtx.scheduledJobsStatePath,
      factoryConfig: sjCtx.factoryConfig,
      filters: buildDashboardInitialFilters({
        runId: this.runId,
        graph: this.graph,
        node: this.node,
        issue: this.issue,
      }),
    });

    if (this.json) {
      this.context.stdout.write(JSON.stringify(dashboard, null, 2));
    } else {
      this.context.stdout.write(formatFactoryDashboardHuman(dashboard, { activeTab: "now" }));
    }
    return 0;
  }
}

export class FactoryReviewMetricsCommand extends Command {
  static paths = [["factory", "review-metrics"]];

  runsDir = Option.String("--runs-dir", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");
  lookbackHours = Option.String("--lookback-hours", "24");
  window = Option.String("--window", "");
  json = Option.Boolean("--json", false);

  async execute() {
    const {
      computeReviewMetrics,
      resolveReviewVerdictsLogPath,
    } = await import("../../commands/factory-review-metrics.ts");

    const context = await resolveFactoryContextOrExit(this, {
      runsDir: this.runsDir,
      factoryRoot: this.factoryRoot,
      factoryConfigPath: this.factoryConfigPath,
      factoryId: this.factoryId,
      targetRepo: this.repo,
      controlPlaneRepo: this.controlPlaneRepo,
      scenariosRoot: this.scenariosRoot,
    });
    if (!context) return 2;

    const verdictsLogPath = resolveReviewVerdictsLogPath({
      factoryId: context.factory_id,
      runsDir: context.runs_dir,
    });

    const metrics = computeReviewMetrics({
      verdictsLogPath,
      lookbackHours: parsePositiveNumber(this.lookbackHours, 24),
      window: this.window ? parsePositiveNumber(this.window, 0) : undefined,
    });

    if (this.json) {
      this.context.stdout.write(JSON.stringify(metrics, null, 2));
    } else {
      this.context.stdout.write(formatReviewMetricsHuman(metrics));
    }
    return 0;
  }
}

export class FactoryDashboardTuiCommand extends Command {
  static paths = [["factory", "dashboard-tui"]];

  runsDir = Option.String("--runs-dir", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");
  lookbackHours = Option.String("--lookback-hours", "24");
  runId = Option.String("--run-id", "");
  graph = Option.String("--graph", "");
  node = Option.String("--node", "");
  issue = Option.String("--issue", "");
  refreshMs = Option.String("--refresh-ms", "2000");

  async execute() {
    const { buildFactoryDashboard } = await import("../../commands/factory-dashboard.ts");
    const { runFactoryDashboardTui } = await import("../factory-dashboard-tui.ts");
    const { buildFactorySessionBrowserSnapshot } = await import("../../commands/factory-session-browser.ts");
    const { runFactorySessionBrowserTui } = await import("../factory-session-browser-tui.ts");
    const context = await resolveFactoryContextOrExit(this, {
      runsDir: this.runsDir,
      factoryRoot: this.factoryRoot,
      factoryConfigPath: this.factoryConfigPath,
      factoryId: this.factoryId,
      targetRepo: this.repo,
      controlPlaneRepo: this.controlPlaneRepo,
      scenariosRoot: this.scenariosRoot,
    });
    if (!context) return 2;

    const sjCtxTui = await resolveScheduledJobsContext(context);
    const initialFilters = buildDashboardInitialFilters({
      runId: this.runId,
      graph: this.graph,
      node: this.node,
      issue: this.issue,
    });
    await runFactoryDashboardTui({
      loadSnapshot: ({ filters } = {}) => buildFactoryDashboard({
        runsDir: context.runs_dir,
        context,
        lookbackHours: parsePositiveNumber(this.lookbackHours, 24),
        scheduledJobsStatePath: sjCtxTui.scheduledJobsStatePath,
        factoryConfig: sjCtxTui.factoryConfig,
        filters: filters || initialFilters,
      }),
      stdout: this.context.stdout,
      stdin: this.context.stdin || process.stdin,
      refreshMs: parseNonNegativeNumber(this.refreshMs, 2000),
      initialFilters,
      launchSessionBrowser: async ({ initialTarget } = {}) => {
        await runFactorySessionBrowserTui({
          loadSnapshot: () => buildFactorySessionBrowserSnapshot({
            runsDir: context.runs_dir,
            context,
            lookbackHours: parsePositiveNumber(this.lookbackHours, 24),
          }),
          stdout: this.context.stdout,
          stdin: this.context.stdin || process.stdin,
          refreshMs: parseNonNegativeNumber(this.refreshMs, 2000),
          initialTarget,
        });
      },
    });
    return 0;
  }
}

export const factoryDashboardCommands = [
  FactoryDashboardCommand,
  FactoryDashboardTuiCommand,
  FactoryReviewMetricsCommand,
];
