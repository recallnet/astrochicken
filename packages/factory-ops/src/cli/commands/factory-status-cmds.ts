import { Command, Option } from "clipanion";

import {
  resolveRepoOrExit,
  resolveFactoryContextOrExit,
  resolveFleetTuiDetailContext,
  resolveFactoryRunsDir,
  resolveHostLifecycleInputs,
  printHostLifecycleJson,
  buildHostLifecycleJson,
  resolveDaemonScriptPath,
  buildHostDaemonEnv,
  executeFactoryControlMutation,
  resolveFleetRegistryPath,
} from "../factory-command-helpers.ts";
import { parsePositiveNumber, parseNonNegativeNumber, parseBoolFlag, parseJsonObjectFlag } from "../helpers.ts";

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
export class FactoryStatusCommand extends Command {
  static paths = [["factory", "status"]];
  static usage = Command.Usage({
    description: "Inspect factory run health and control-plane signals. mode: both",
  });
  runsDir = Option.String("--runs-dir", "");
  staleMinutes = Option.String("--stale-minutes", "20");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");
  json = Option.Boolean("--json", false);

  async execute() {
    const { factoryStatus, formatFactoryStatus } = await import("../../commands/factory-status.ts");
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

    const status = factoryStatus({
      runsDir: context.runs_dir,
      staleMinutes: parsePositiveNumber(this.staleMinutes, 20),
      context,
    });
    if (this.json) {
      this.context.stdout.write(JSON.stringify(status, null, 2));
    } else {
      this.context.stdout.write(formatFactoryStatus(status));
    }
    return 0;
  }
}

export class FactoryFleetStatusCommand extends Command {
  static paths = [["factory", "fleet-status"]];
  runsDir = Option.String("--runs-dir", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");
  registryPath = Option.String("--registry-path", "factory-registry.json");
  lookbackHours = Option.String("--lookback-hours", "24");
  json = Option.Boolean("--json", false);

  async execute() {
    const {
      factoryFleetStatus,
      formatFleetStatusHuman,
    } = await import("../../commands/factory-fleet-status.ts");

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

    const report = await factoryFleetStatus({
      context,
      lookbackHours: parsePositiveNumber(this.lookbackHours, 24),
      json: this.json,
      registryPath: resolveFleetRegistryPath(this.registryPath),
    });

    if (this.json) {
      this.context.stdout.write(JSON.stringify(report, null, 2));
    } else {
      this.context.stdout.write(formatFleetStatusHuman(report));
    }

    return Array.isArray(report?.factories) && report.factories.length > 0 ? 0 : 1;
  }
}

export class FactoryAttentionCommand extends Command {
  static paths = [["factory", "attention"]];
  static usage = Command.Usage({
    description: "Show only actionable factories with top-level operator KPIs. mode: both",
  });
  runsDir = Option.String("--runs-dir", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");
  registryPath = Option.String("--registry-path", "factory-registry.json");
  lookbackHours = Option.String("--lookback-hours", "1");
  json = Option.Boolean("--json", false);

  async execute() {
    const {
      factoryFleetBootstrapSnapshot,
      factoryFleetStatus,
    } = await import("../../commands/factory-fleet-status.ts");
    const {
      buildFactoryAttentionReport,
      formatFactoryAttentionHuman,
    } = await import("../../commands/factory-attention.ts");

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

    const fleet = await factoryFleetStatus({
      context,
      lookbackHours: parsePositiveNumber(this.lookbackHours, 1),
      json: true,
      registryPath: resolveFleetRegistryPath(this.registryPath),
    });
    const report = buildFactoryAttentionReport(fleet);

    if (this.json) {
      this.context.stdout.write(JSON.stringify(report, null, 2));
    } else {
      this.context.stdout.write(formatFactoryAttentionHuman(report));
    }

    return report.summary.attention_factories > 0 ? 1 : 0;
  }
}

export class FactoryFleetTuiCommand extends Command {
  static paths = [["factory", "fleet-tui"]];
  runsDir = Option.String("--runs-dir", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");
  registryPath = Option.String("--registry-path", "factory-registry.json");
  lookbackHours = Option.String("--lookback-hours", "24");
  refreshMs = Option.String("--refresh-ms", "10000");

  async execute() {
    const { factoryFleetBootstrapSnapshot, factoryFleetStatus } = await import("../../commands/factory-fleet-status.ts");
    const { buildFactoryDashboard } = await import("../../commands/factory-dashboard.ts");
    const { buildFactorySessionBrowserSnapshot } = await import("../../commands/factory-session-browser.ts");
    const { runFactoryFleetTui } = await import("../factory-fleet-tui.ts");
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

    const { callOffThread, terminateDispatcher } = await import("../../lib/offthread-dispatcher.ts");

    const initialSnapshot = factoryFleetBootstrapSnapshot({
      context,
      registryPath: resolveFleetRegistryPath(this.registryPath),
    });
    // Pre-warm the worker in the background so it's ready by the first auto-refresh
    void callOffThread("ping", { warm: "fleet" }, { lane: "fleet" });
    void callOffThread("ping", { warm: "detail" }, { lane: "detail" });

    await runFactoryFleetTui({
      initialSnapshot,
      loadSnapshot: () => callOffThread("factoryFleetStatus", {
        context,
        lookbackHours: parsePositiveNumber(this.lookbackHours, 24),
        registryPath: resolveFleetRegistryPath(this.registryPath),
      }, { lane: "fleet" }),
      stdout: this.context.stdout,
      stdin: this.context.stdin || process.stdin,
      refreshMs: parseNonNegativeNumber(this.refreshMs, 10000),
      loadFactoryDetail: async ({ initialFactoryContext } = {}) => {
        const resolvedContext = await resolveFleetTuiDetailContext(initialFactoryContext || {});
        const dashboardContext = {
          ...resolvedContext,
          target_repo: resolvedContext?.target_repo || initialFactoryContext?.target_repo || "",
          runs_dir: resolvedContext?.runs_dir || initialFactoryContext?.runs_dir || "",
        };
        const scheduled = await resolveScheduledJobsContext(dashboardContext);
        return callOffThread("buildFactoryDashboard", {
          runsDir: dashboardContext.runs_dir,
          context: dashboardContext,
          lookbackHours: parsePositiveNumber(this.lookbackHours, 24),
          scheduledJobsStatePath: scheduled.scheduledJobsStatePath,
          factoryConfig: scheduled.factoryConfig,
        }, { lane: "detail" });
      },
      launchSessionBrowser: async ({ initialTarget, initialFactoryContext } = {}) => {
        const sessionContext = {
          ...context,
          ...(initialFactoryContext || {}),
          target_repo: initialFactoryContext?.target_repo || context.target_repo || "",
          runs_dir: initialFactoryContext?.runs_dir || context.runs_dir || "",
        };
        await runFactorySessionBrowserTui({
          loadSnapshot: () => buildFactorySessionBrowserSnapshot({
            runsDir: sessionContext.runs_dir || "",
            context: sessionContext,
            lookbackHours: parsePositiveNumber(this.lookbackHours, 24),
          }),
          stdout: this.context.stdout,
          stdin: this.context.stdin || process.stdin,
          refreshMs: parseNonNegativeNumber(this.refreshMs, 10000),
          initialTarget,
        });
      },
    });
    await terminateDispatcher();
    return 0;
  }
}

export class FactoryActiveSummaryCommand extends Command {
  static paths = [["factory", "active-summary"]];
  runsDir = Option.String("--runs-dir", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");
  json = Option.Boolean("--json", false);
  minimal = Option.Boolean("--minimal", false);
  follow = Option.Boolean("--follow", false);
  intervalMs = Option.String("--interval-ms", "2000");

  async execute() {
    const {
      factoryActiveSummary,
      formatFactoryActiveSummary,
      formatFactoryActiveMinimal,
    } = await import("../../commands/factory-status.ts");
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

    if (this.json && this.follow) {
      this.context.stderr.write("--json cannot be combined with --follow\n");
      return 2;
    }

    const render = () => {
      const summary = factoryActiveSummary({ runsDir: context.runs_dir, context });
      if (this.json) {
        return JSON.stringify(summary, null, 2);
      }
      return this.minimal ? formatFactoryActiveMinimal(summary) : formatFactoryActiveSummary(summary);
    };

    if (!this.follow) {
      this.context.stdout.write(render());
      return 0;
    }

    const interval = parseNonNegativeNumber(this.intervalMs, 2000);
    const sleepMs = interval > 0 ? interval : 2000;
    let stopped = false;
    const stop = () => { stopped = true; };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    const {
      enterFullscreenTui,
      exitFullscreenTui,
      writeFollowFrame,
    } = await import("../factory-follow-render.ts");

    try {
      enterFullscreenTui(this.context.stdout);
      while (!stopped) {
        const output = render();
        writeFollowFrame(this.context.stdout, output);
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
      }
    } finally {
      exitFullscreenTui(this.context.stdout);
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
    return 0;
  }
}

export class FactoryTickStatusCommand extends Command {
  static paths = [["factory", "tick-status"]];
  static usage = Command.Usage({
    description: "Inspect current supervisor tick progress and stage context. mode: both",
  });
  runsDir = Option.String("--runs-dir", "");
  factoryRoot = Option.String("--factory-root", "");
  factoryConfigPath = Option.String("--factory-config-path", "");
  factoryId = Option.String("--factory-id", "");
  repo = Option.String("--repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  scenariosRoot = Option.String("--scenarios-root", "");
  json = Option.Boolean("--json", false);

  async execute() {
    const { tickStatus, formatTickStatus } = await import("../../commands/factory-tick-status.ts");
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

    const status = tickStatus({ runsDir: context.runs_dir, context });
    if (this.json) {
      this.context.stdout.write(JSON.stringify(status, null, 2));
    } else {
      this.context.stdout.write(formatTickStatus(status));
    }
    return 0;
  }
}

export class FactoryRecentFailuresCommand extends Command {
  static paths = [["factory", "recent-failures"]];
  runsDir = Option.String("--runs-dir", ".hatch/runs");
  limit = Option.String("--limit", "10");

  async execute() {
    const { listRecentFailures } = await import("../../commands/factory-failures.ts");
    this.context.stdout.write(JSON.stringify(listRecentFailures({ runsDir: this.runsDir, limit: Number(this.limit) || 10 }), null, 2));
    return 0;
  }
}

export class FactoryOutcomesCommand extends Command {
  static paths = [["factory", "outcomes"]];
  repo = Option.String("--repo", "");
  repoPath = Option.String("--repo-path", ".");
  lookbackHours = Option.String("--lookback-hours", "24");

  async execute() {
    const { collectFactoryOutcomes } = await import("../../commands/factory-outcomes.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;
    this.context.stdout.write(JSON.stringify(collectFactoryOutcomes({ repo, repoPath: this.repoPath, lookbackHours: Number(this.lookbackHours) || 24 }), null, 2));
    return 0;
  }
}

export class FactoryAgentTraceCommand extends Command {
  static paths = [["factory", "agent-trace"]];
  runsDir = Option.String("--runs-dir", ".hatch/runs");
  runId = Option.String("--run-id", "");
  maxItems = Option.String("--max-items", "3");

  async execute() {
    const { factoryAgentTrace } = await import("../../commands/factory-agent-trace.ts");
    const out = factoryAgentTrace({ runsDir: this.runsDir, runId: this.runId, maxItems: Number(this.maxItems) || 3 });
    this.context.stdout.write(JSON.stringify(out, null, 2));
    return out.ok ? 0 : 1;
  }
}

export class FactoryAuditRecordsCommand extends Command {
  static paths = [["factory", "audit-records"]];
  instanceId = Option.String("--instance-id", "");
  since = Option.String("--since", "");
  to = Option.String("--to", "");
  action = Option.String("--action", "");
  hostId = Option.String("--host-id", "");
  hostBaseDir = Option.String("--host-base-dir", "");
  logPath = Option.String("--log-path", "");
  json = Option.Boolean("--json", false);

  async execute() {
    const {
      readFactoryAuditRecords,
      formatFactoryAuditRecordsHuman,
    } = await import("../../commands/factory-audit-records.ts");

    try {
      const out = readFactoryAuditRecords({
        instanceId: this.instanceId,
        since: this.since,
        until: this.to,
        action: this.action,
        hostId: this.hostId,
        hostBaseDir: this.hostBaseDir,
        logPath: this.logPath,
      });

      if (this.json) {
        this.context.stdout.write(JSON.stringify(out, null, 2));
      } else {
        this.context.stdout.write(`${formatFactoryAuditRecordsHuman(out.records)}\n`);
      }
      return 0;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error || "factory_audit_records_failed")}\n`);
      return 1;
    }
  }
}

export class FactoryQuarantineStatusCommand extends Command {
  static paths = [["factory", "quarantine-status"]];
  static usage = Command.Usage({
    description: "Show quarantined issues and their cooldown status. mode: both",
  });
  repo = Option.String("--repo", "");
  json = Option.Boolean("--json", true);

  async execute() {
    const { quarantineStatus } = await import("../../commands/quarantine-status.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;

    const result = quarantineStatus({ repo });
    this.context.stdout.write(JSON.stringify(result, null, 2));
    return 0;
  }
}

export class FactoryInspectCanonicalCommand extends Command {
  static paths = [["factory", "inspect-canonical"]];
  json = Option.Boolean("--json", false);

  async execute() {
    const { spawnSync } = await import("node:child_process");
    const { existsSync, readdirSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { resolveCanonicalCheckoutPath } = await import("../../lib/canonical-worktree.ts");

    const canonicalPath = resolveCanonicalCheckoutPath();
    if (!canonicalPath) {
      const result = { ok: false, error: "no_canonical_checkout_configured", canonical_path: "" };
      this.context.stdout.write(this.json ? JSON.stringify(result, null, 2) + "\n" : "No canonical checkout configured (set HATCH_CANONICAL_CHECKOUT_PATH).\n");
      return 1;
    }

    if (!existsSync(canonicalPath)) {
      const result = { ok: false, error: "canonical_checkout_not_found", canonical_path: canonicalPath };
      this.context.stdout.write(this.json ? JSON.stringify(result, null, 2) + "\n" : `Canonical checkout not found: ${canonicalPath}\n`);
      return 1;
    }

    const git = (args) => {
      const p = spawnSync("git", ["-C", canonicalPath, ...args], { encoding: "utf8", timeout: 10_000 });
      return { code: p.status ?? 1, stdout: (p.stdout || "").trim(), stderr: (p.stderr || "").trim() };
    };

    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
    const dirty = git(["status", "--porcelain"]);
    const dirtyFiles = (dirty.stdout || "").split(/\r?\n/).filter(Boolean);
    const onMain = branch.stdout === "main";
    const mergeInProgress = existsSync(resolve(canonicalPath, ".git", "MERGE_HEAD"));
    const rebaseInProgress = existsSync(resolve(canonicalPath, ".git", "rebase-merge"))
      || existsSync(resolve(canonicalPath, ".git", "rebase-apply"));

    // Check worktrees
    const worktreeList = git(["worktree", "list", "--porcelain"]);
    const worktreeCount = (worktreeList.stdout || "").split(/\n/).filter((l) => l.startsWith("worktree ")).length;

    // Check orphaned hatch worktrees
    const hatchWorktreeRoot = resolve(dirname(canonicalPath), ".hatch-worktrees");
    const orphanedWorktrees = [];
    if (existsSync(hatchWorktreeRoot)) {
      for (const kind of ["wave", "merge"]) {
        const kindDir = resolve(hatchWorktreeRoot, kind);
        try {
          for (const entry of readdirSync(kindDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const wtPath = resolve(kindDir, entry.name);
            const isGit = git(["-C", wtPath, "rev-parse", "--is-inside-work-tree"]);
            if (isGit.code !== 0) {
              orphanedWorktrees.push(wtPath);
            }
          }
        } catch { /* kind dir missing */ }
      }
    }

    const healthy = onMain && dirtyFiles.length === 0 && !mergeInProgress && !rebaseInProgress;

    const result = {
      ok: healthy,
      canonical_path: canonicalPath,
      branch: branch.stdout,
      on_main: onMain,
      dirty: dirtyFiles.length > 0,
      dirty_file_count: dirtyFiles.length,
      dirty_files: dirtyFiles.slice(0, 20),
      merge_in_progress: mergeInProgress,
      rebase_in_progress: rebaseInProgress,
      worktree_count: worktreeCount,
      orphaned_worktree_count: orphanedWorktrees.length,
      orphaned_worktrees: orphanedWorktrees,
    };

    if (this.json) {
      this.context.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      const status = healthy ? "HEALTHY" : "UNHEALTHY";
      const lines = [
        `Canonical Checkout: ${status}`,
        `  Path:     ${canonicalPath}`,
        `  Branch:   ${branch.stdout}${onMain ? "" : "  *** NOT ON MAIN ***"}`,
        `  Dirty:    ${dirtyFiles.length > 0 ? `${dirtyFiles.length} file(s)` : "clean"}`,
      ];
      if (mergeInProgress) lines.push("  Merge:    IN PROGRESS");
      if (rebaseInProgress) lines.push("  Rebase:   IN PROGRESS");
      lines.push(`  Worktrees: ${worktreeCount}`);
      if (orphanedWorktrees.length > 0) {
        lines.push(`  Orphaned:  ${orphanedWorktrees.length} worktree(s)`);
        for (const wt of orphanedWorktrees) lines.push(`    - ${wt}`);
      }
      if (dirtyFiles.length > 0) {
        lines.push("  Dirty files:");
        for (const f of dirtyFiles.slice(0, 10)) lines.push(`    ${f}`);
        if (dirtyFiles.length > 10) lines.push(`    ... and ${dirtyFiles.length - 10} more`);
      }
      this.context.stdout.write(lines.join("\n") + "\n");
    }
    return healthy ? 0 : 1;
  }
}

export const factoryStatusCommands = [
  FactoryStatusCommand,
  FactoryFleetStatusCommand,
  FactoryAttentionCommand,
  FactoryFleetTuiCommand,
  FactoryActiveSummaryCommand,
  FactoryTickStatusCommand,
  FactoryRecentFailuresCommand,
  FactoryOutcomesCommand,
  FactoryAgentTraceCommand,
  FactoryAuditRecordsCommand,
  FactoryQuarantineStatusCommand,
  FactoryInspectCanonicalCommand,
];
