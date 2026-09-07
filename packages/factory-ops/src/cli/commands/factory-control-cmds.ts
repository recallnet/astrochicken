import { Command, Option } from "clipanion";

import {
  resolveRepoOrExit,
  resolveFactoryContextOrExit,
  resolveFactoryRunsDir,
  resolveHostLifecycleInputs,
  printHostLifecycleJson,
  buildHostLifecycleJson,
  resolveDaemonScriptPath,
  buildHostDaemonEnv,
  executeFactoryControlMutation,
} from "../factory-command-helpers.ts";
import { parsePositiveNumber, parseNonNegativeNumber, parseBoolFlag, parseJsonObjectFlag } from "../helpers.ts";

export class FactoryResetBudgetCommand extends Command {
  static paths = [["factory", "reset-budget"]];
  runId = Option.String("--run-id", "");
  runsDir = Option.String("--runs-dir", ".hatch/runs");
  actor = Option.String("--actor", "");
  force = Option.Boolean("--force", false);

  async execute() {
    const { resetFactoryBudget } = await import("../../commands/factory-reset-budget.ts");
    const out = resetFactoryBudget({
      runId: this.runId,
      runsDir: this.runsDir,
      actorId: this.actor,
      force: this.force,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class FactoryReapStaleRunsCommand extends Command {
  static paths = [["factory", "reap-stale-runs"]];
  runsDir = Option.String("--runs-dir", ".hatch/runs");
  staleMinutes = Option.String("--stale-minutes", "20");
  dryRun = Option.Boolean("--dry-run", false);

  async execute() {
    const { reapStaleRuns } = await import("../../commands/factory-reap-stale-runs.ts");
    const out = reapStaleRuns({ runsDir: this.runsDir, staleMinutes: Number(this.staleMinutes), dryRun: this.dryRun });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class FactoryRecoverySweepCommand extends Command {
  static paths = [["factory", "recovery-sweep"]];
  runsDir = Option.String("--runs-dir", ".hatch/runs");
  factoryId = Option.String("--factory-id", "");
  repoPath = Option.String("--repo-path", process.cwd());
  lockDir = Option.String("--lock-dir", "");
  staleMinutes = Option.String("--stale-minutes", "20");
  apply = Option.String("--apply", "false");
  runId = Option.String("--run-id", "");
  worktree = Option.String("--worktree", "");
  branch = Option.String("--branch", "");
  protectedPaths = Option.Array("--protected-path", []);
  skipWorktreeScan = Option.Boolean("--skip-worktree-scan", false);

  async execute() {
    const { reconcileRuntimeRecoverySweep } = await import("../../commands/factory-recovery-sweep.ts");
    const resolvedRunsDir = await resolveFactoryRunsDir(this.runsDir, this.factoryId);
    const out = reconcileRuntimeRecoverySweep({
      runsDir: resolvedRunsDir,
      repoPath: this.repoPath,
      lockDir: this.lockDir,
      staleMinutes: Number(this.staleMinutes),
      apply: parseBoolFlag(this.apply),
      runId: this.runId,
      worktree: this.worktree,
      branch: this.branch,
      protectedPaths: this.protectedPaths,
      skipWorktreeScan: this.skipWorktreeScan,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class FactoryPauseCommand extends Command {
  static paths = [["factory", "pause"]];
  factoryId = Option.String("--factory-id", "");
  reason = Option.String("--reason", "");
  retryTarget = Option.String("--retry-target", "");
  async execute() { return executeFactoryControlMutation(this, { action: "pause", factoryId: this.factoryId, reason: this.reason, retryTarget: this.retryTarget }); }
}

export class FactoryQuarantineCommand extends Command {
  static paths = [["factory", "quarantine"]];
  factoryId = Option.String("--factory-id", "");
  reason = Option.String("--reason", "");
  retryTarget = Option.String("--retry-target", "");
  async execute() { return executeFactoryControlMutation(this, { action: "quarantine", factoryId: this.factoryId, reason: this.reason, retryTarget: this.retryTarget }); }
}

export class FactoryRetryCommand extends Command {
  static paths = [["factory", "retry"]];
  factoryId = Option.String("--factory-id", "");
  reason = Option.String("--reason", "");
  retryTarget = Option.String("--retry-target", "");
  async execute() { return executeFactoryControlMutation(this, { action: "retry", factoryId: this.factoryId, reason: this.reason, retryTarget: this.retryTarget }); }
}

export class FactoryUnblockCommand extends Command {
  static paths = [["factory", "unblock"]];
  factoryId = Option.String("--factory-id", "");
  reason = Option.String("--reason", "");
  retryTarget = Option.String("--retry-target", "");
  async execute() { return executeFactoryControlMutation(this, { action: "unblock", factoryId: this.factoryId, reason: this.reason, retryTarget: this.retryTarget }); }
}

export class FactoryResumeCommand extends Command {
  static paths = [["factory", "resume"]];
  factoryId = Option.String("--factory-id", "");
  reason = Option.String("--reason", "");
  retryTarget = Option.String("--retry-target", "");
  async execute() { return executeFactoryControlMutation(this, { action: "resume", factoryId: this.factoryId, reason: this.reason, retryTarget: this.retryTarget }); }
}

export class FactoryDisableCommand extends Command {
  static paths = [["factory", "disable"]];
  static usage = Command.Usage({
    description: "Disable a factory on this host (operator intent, host-local, no daemon restart needed)",
  });
  factoryId = Option.String("--factory-id", "");
  reason = Option.String("--reason", "");
  hostBaseDir = Option.String("--host-base-dir", "");

  async execute() {
    const { writeHostFactoryIntent, resolveIntentFilePath } = await import("../../lib/host-factory-intent.ts");
    const factoryId = String(this.factoryId || "").trim();
    if (!factoryId) {
      this.context.stderr.write("--factory-id is required\n");
      return 1;
    }
    const baseDir = this.hostBaseDir || process.env.HATCH_HOST_BASE_DIR || "";
    const intentFilePath = resolveIntentFilePath({ factoryId, baseDir });
    writeHostFactoryIntent({
      intentFilePath,
      factoryId,
      enabled: false,
      reason: this.reason || "",
      actor: "operator",
    });
    const out = { ok: true, action: "disable", factory_id: factoryId, intent_file: intentFilePath };
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class FactoryEnableCommand extends Command {
  static paths = [["factory", "enable"]];
  static usage = Command.Usage({
    description: "Enable a factory on this host (operator intent, host-local, no daemon restart needed)",
  });
  factoryId = Option.String("--factory-id", "");
  hostBaseDir = Option.String("--host-base-dir", "");

  async execute() {
    const { writeHostFactoryIntent, resolveIntentFilePath } = await import("../../lib/host-factory-intent.ts");
    const factoryId = String(this.factoryId || "").trim();
    if (!factoryId) {
      this.context.stderr.write("--factory-id is required\n");
      return 1;
    }
    const baseDir = this.hostBaseDir || process.env.HATCH_HOST_BASE_DIR || "";
    const intentFilePath = resolveIntentFilePath({ factoryId, baseDir });
    writeHostFactoryIntent({
      intentFilePath,
      factoryId,
      enabled: true,
      reason: "",
      actor: "operator",
    });
    const out = { ok: true, action: "enable", factory_id: factoryId, intent_file: intentFilePath };
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class FactoryControlStateCommand extends Command {
  static paths = [["factory", "control-state"]];
  factoryId = Option.String("--factory-id", "");

  async execute() {
    const { runFactoryControlStateRead } = await import("../../commands/factory-control-state.ts");
    const out = runFactoryControlStateRead({ factoryId: this.factoryId });
    this.context.stdout.write(JSON.stringify(out));
    if (out?.ok === false) {
      this.context.stderr.write(JSON.stringify({
        ok: false,
        action: "control-state",
        error: String(out.error || "control_state_read_failed"),
        message: String(out.message || ""),
      }) + "\n");
      return 1;
    }
    return 0;
  }
}

export class FactoryResumeGateCommand extends Command {
  static paths = [["factory", "resume-gate"]];
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  sourceRepo = Option.String("--source-repo", "");
  sourceIssue = Option.String("--source-issue", "0");
  milestoneTitle = Option.String("--milestone-title", "");
  rolloutChannel = Option.String("--rollout-channel", "");
  policyPath = Option.String("--policy-path", "");
  policyJson = Option.String("--policy-json", "");
  manifestPath = Option.String("--manifest-path", "");
  manifestRef = Option.String("--manifest-ref", "");
  manifestFetchCmd = Option.String("--manifest-fetch-cmd", "");
  localFactoryRelease = Option.String("--local-factory-release", "");
  localFactoryReleaseCmd = Option.String("--local-factory-release-cmd", "");
  selfUpdateCmd = Option.String("--self-update-cmd", "");

  async execute() {
    const { ensureResumeReady } = await import("../../commands/factory-resume-gate.ts");
    const out = ensureResumeReady({
      controlPlaneRepo: this.controlPlaneRepo,
      sourceRepo: this.sourceRepo,
      sourceIssueNumber: Number(this.sourceIssue),
      milestoneTitle: this.milestoneTitle,
      rolloutChannel: this.rolloutChannel,
      policyPath: this.policyPath,
      policyJson: this.policyJson,
      manifestPath: this.manifestPath,
      manifestRef: this.manifestRef,
      manifestFetchCommand: this.manifestFetchCmd,
      localFactoryRelease: this.localFactoryRelease,
      localFactoryReleaseCommand: this.localFactoryReleaseCmd,
      selfUpdateCommand: this.selfUpdateCmd,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class FactoryGenerateInstanceIdCommand extends Command {
  static paths = [["factory", "generate-instance-id"]];

  async execute() {
    const { generateFactoryInstanceIdPayload } = await import("../../commands/factory-generate-instance-id.ts");
    const out = generateFactoryInstanceIdPayload();
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export const factoryControlCommands = [
  FactoryResetBudgetCommand,
  FactoryReapStaleRunsCommand,
  FactoryRecoverySweepCommand,
  FactoryPauseCommand,
  FactoryQuarantineCommand,
  FactoryRetryCommand,
  FactoryUnblockCommand,
  FactoryResumeCommand,
  FactoryDisableCommand,
  FactoryEnableCommand,
  FactoryControlStateCommand,
  FactoryResumeGateCommand,
  FactoryGenerateInstanceIdCommand,
];
