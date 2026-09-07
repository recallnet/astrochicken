import { Command, Option } from "clipanion";

import { decodeBase64Utf8OrRaw } from "../helpers.ts";

// -- merge acquire-lock --
export class MergeAcquireLockCommand extends Command {
  static paths = [["merge", "acquire-lock"]];
  repo = Option.String("--repo", ".");

  async execute() {
    const { acquireMergeLock } = await import("../../commands/merge-lock.ts");
    const out = acquireMergeLock({ repo: this.repo });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- merge release-lock --
export class MergeReleaseLockCommand extends Command {
  static paths = [["merge", "release-lock"]];
  repo = Option.String("--repo", ".");

  async execute() {
    const { releaseMergeLock } = await import("../../commands/merge-lock.ts");
    const out = releaseMergeLock({ repo: this.repo });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- merge assert-main-branch --
export class MergeAssertMainBranchCommand extends Command {
  static paths = [["merge", "assert-main-branch"]];
  repo = Option.String("--repo", ".");

  async execute() {
    const { assertMainBranch } = await import("../../commands/merge-item-ops.ts");
    const out = assertMainBranch({ repo: this.repo });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- merge assert-main-clean --
export class MergeAssertMainCleanCommand extends Command {
  static paths = [["merge", "assert-main-clean"]];
  repo = Option.String("--repo", ".");

  async execute() {
    const { assertMainClean } = await import("../../commands/merge-assert-main-clean.ts");
    const out = assertMainClean({ repo: this.repo });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- merge extract-item --
export class MergeExtractItemCommand extends Command {
  static paths = [["merge", "extract-item"]];
  item = Option.String("--item", "{}");

  async execute() {
    const { extractMergeItem } = await import("../../commands/merge-item-ops.ts");
    const out = extractMergeItem(this.item);
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- merge resolve-context --
export class MergeResolveContextCommand extends Command {
  static paths = [["merge", "resolve-context"]];
  mergeCandidatesRaw = Option.String("--merge-candidates", "[]");
  fallbackBranch = Option.String("--fallback-branch", "");
  fallbackWorktreeDir = Option.String("--fallback-worktree-dir", "");

  async execute() {
    const { resolveMergeContext } = await import("../../commands/merge-item-ops.ts");
    const out = resolveMergeContext({
      mergeCandidatesRaw: this.mergeCandidatesRaw,
      fallbackBranch: this.fallbackBranch,
      fallbackWorktreeDir: this.fallbackWorktreeDir,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- merge setup-worktree --
export class MergeSetupWorktreeCommand extends Command {
  static paths = [["merge", "setup-worktree"]];
  repo = Option.String("--repo", ".");
  branch = Option.String("--branch", "");
  issue = Option.String("--issue", "");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "merge");
  mergeWorktreeDir = Option.String("--merge-worktree-dir", "");

  async execute() {
    const { setupMergeWorktree } = await import("../../commands/merge-worktree.ts");
    const out = setupMergeWorktree({
      repo: this.repo,
      branch: this.branch,
      issueNumber: this.issue,
      runId: this.runId,
      pipeline: this.pipeline,
      mergeWorktreeDir: this.mergeWorktreeDir,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- merge cleanup-worktree --
export class MergeCleanupWorktreeCommand extends Command {
  static paths = [["merge", "cleanup-worktree"]];
  repo = Option.String("--repo", ".");
  mergeWorktreeDir = Option.String("--merge-worktree-dir", "");

  async execute() {
    const { cleanupMergeWorktree } = await import("../../commands/merge-worktree.ts");
    const out = cleanupMergeWorktree({
      repo: this.repo,
      mergeWorktreeDir: this.mergeWorktreeDir,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- merge rebase --
export class MergeRebaseCommand extends Command {
  static paths = [["merge", "rebase"]];
  repo = Option.String("--repo", ".");
  branch = Option.String("--branch", "");
  worktreeDir = Option.String("--worktree-dir", "");
  mergeWorktreeDir = Option.String("--merge-worktree-dir", "");

  async execute() {
    const { rebaseBranchOnMain } = await import("../../commands/merge-item-ops.ts");
    const out = rebaseBranchOnMain({
      repo: this.repo,
      branch: this.branch,
      worktreeDir: this.worktreeDir,
      mergeWorktreeDir: this.mergeWorktreeDir,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- merge attempt --
export class MergeAttemptCommand extends Command {
  static paths = [["merge", "attempt"]];
  repo = Option.String("--repo", ".");
  branch = Option.String("--branch", "");
  mergeWorktreeDir = Option.String("--merge-worktree-dir", "");
  branchHeadSha = Option.String("--branch-head-sha", "");
  commitMessage = Option.String("--commit-message", "");

  async execute() {
    const { attemptDeterministicMerge } = await import("../../commands/merge-item-ops.ts");
    const out = attemptDeterministicMerge({
      repo: this.repo,
      branch: this.branch,
      mergeWorktreeDir: this.mergeWorktreeDir,
      branchHeadSha: this.branchHeadSha,
      commitMessage: this.commitMessage,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- merge push-main --
export class MergePushMainCommand extends Command {
  static paths = [["merge", "push-main"]];
  repo = Option.String("--repo", ".");
  branch = Option.String("--branch", "main");
  remote = Option.String("--remote", "origin");
  mergeWorktreeDir = Option.String("--merge-worktree-dir", "");
  mergedHeadSha = Option.String("--merged-head-sha", "");

  async execute() {
    const { pushMainBranch } = await import("../../commands/merge-item-ops.ts");
    const out = pushMainBranch({
      repo: this.repo,
      branch: this.branch,
      remote: this.remote,
      mergeWorktreeDir: this.mergeWorktreeDir,
      mergedHeadSha: this.mergedHeadSha,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- merge build-conflict-packet --
export class MergeBuildConflictPacketCommand extends Command {
  static paths = [["merge", "build-conflict-packet"]];
  repo = Option.String("--repo", ".");
  branch = Option.String("--branch", "");
  issue = Option.String("--issue", "");
  mergeStderr = Option.String("--merge-stderr", "");
  worktreeDir = Option.String("--worktree-dir", "");
  factoryId = Option.String("--factory-id", "");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "");
  nodeId = Option.String("--node-id", "");
  targetRepo = Option.String("--target-repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  mergeCandidates = Option.String("--merge-candidates", "");

  async execute() {
    const { buildConflictPacket } = await import("../../commands/merge-item-ops.ts");
    const out = buildConflictPacket({
      repo: this.repo,
      branch: this.branch,
      issueNumber: this.issue,
      mergeCandidates: this.mergeCandidates,
      mergeStderr: this.mergeStderr,
      worktreeDir: this.worktreeDir,
      factoryId: this.factoryId,
      runId: this.runId,
      pipeline: this.pipeline,
      nodeId: this.nodeId,
      targetRepo: this.targetRepo,
      controlPlaneRepo: this.controlPlaneRepo,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- merge finalize-commit --
export class MergeFinalizeCommitCommand extends Command {
  static paths = [["merge", "finalize-commit"]];
  repo = Option.String("--repo", ".");
  worktreeDir = Option.String("--worktree-dir", "");
  mergeWorktreeDir = Option.String("--merge-worktree-dir", "");
  expectedBranch = Option.String("--expected-branch", "");
  commitMessage = Option.String("--commit-message", "");

  async execute() {
    const { finalizeMergeCommit } = await import("../../commands/merge-item-ops.ts");
    const out = finalizeMergeCommit({
      repo: this.repo,
      worktreeDir: this.mergeWorktreeDir || this.worktreeDir,
      expectedBranch: this.expectedBranch,
      commitMessage: this.commitMessage,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- merge build-commit-message --
export class MergeBuildCommitMessageCommand extends Command {
  static paths = [["merge", "build-commit-message"]];
  goalNumber = Option.String("--goal-number", "");
  milestoneTitle = Option.String("--milestone-title", "");
  goalIssueNumber = Option.String("--goal-issue-number", "");
  goalIssueTitle = Option.String("--goal-issue-title", "");
  mergeCandidatesRaw = Option.String("--merge-candidates-raw", "[]");

  async execute() {
    const { buildGoalScopedMergeMessage } = await import("../../commands/merge-item-ops.ts");
    const out = buildGoalScopedMergeMessage({
      milestoneTitle: this.milestoneTitle || (this.goalNumber ? `goal-${this.goalNumber}` : ""),
      goalIssueNumber: this.goalIssueNumber || this.goalNumber,
      goalIssueTitle: this.goalIssueTitle,
      mergeCandidatesRaw: this.mergeCandidatesRaw,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- merge verify-resolution --
export class MergeVerifyResolutionCommand extends Command {
  static paths = [["merge", "verify-resolution"]];
  repo = Option.String("--repo", ".");
  branch = Option.String("--branch", "");
  worktreeDir = Option.String("--worktree-dir", "");
  mergeWorktreeDir = Option.String("--merge-worktree-dir", "");

  async execute() {
    const { verifyConflictResolution } = await import("../../commands/merge-item-ops.ts");
    const out = verifyConflictResolution({
      repo: this.repo,
      branch: this.branch,
      worktreeDir: this.worktreeDir,
      mergeWorktreeDir: this.mergeWorktreeDir,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- merge verify-push-resolution --
export class MergeVerifyPushResolutionCommand extends Command {
  static paths = [["merge", "verify-push-resolution"]];
  repo = Option.String("--repo", ".");
  branch = Option.String("--branch", "main");
  remote = Option.String("--remote", "origin");

  async execute() {
    const { verifyPushResolution } = await import("../../commands/merge-item-ops.ts");
    const out = verifyPushResolution({ repo: this.repo, branch: this.branch, remote: this.remote });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- merge run-integration --
export class MergeRunIntegrationCommand extends Command {
  static paths = [["merge", "run-integration"]];
  repo = Option.String("--repo", ".");
  worktreeDir = Option.String("--worktree-dir", "");
  mergeWorktreeDir = Option.String("--merge-worktree-dir", "");
  integrationCommand = Option.String("--integration-command", { required: false });
  integrationCommandB64 = Option.String("--integration-command-b64", { required: false });

  async execute() {
    const { runMergeIntegration } = await import("../../commands/merge-item-ops.ts");
    if (this.integrationCommand !== undefined && this.integrationCommandB64 !== undefined) {
      this.context.stderr.write("merge run-integration accepts one payload transport at a time: --integration-command or --integration-command-b64\n");
      return 2;
    }
    const integrationCommand = this.integrationCommandB64 !== undefined
      ? decodeBase64Utf8OrRaw(this.integrationCommandB64)
      : (this.integrationCommand ?? "");
    const out = runMergeIntegration({
      repo: this.repo,
      worktreeDir: this.worktreeDir,
      mergeWorktreeDir: this.mergeWorktreeDir,
      integrationCommand,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- merge report --
export class MergeReportCommand extends Command {
  static paths = [["merge", "report"]];
  issue = Option.String("--issue", "");
  branch = Option.String("--branch", "");
  mergeStatus = Option.String("--merge-status", "");
  mergeResolver = Option.String("--merge-resolver", "");
  pathTaken = Option.String("--path-taken", "");
  notes = Option.String("--notes", { required: false });
  notesB64 = Option.String("--notes-b64", { required: false });
  integrationResult = Option.String("--integration-result", { required: false });
  integrationResultB64 = Option.String("--integration-result-b64", { required: false });

  async execute() {
    const { buildMergeReport } = await import("../../commands/merge-item-ops.ts");
    if (this.notes !== undefined && this.notesB64 !== undefined) {
      this.context.stderr.write("merge report notes accepts one payload transport at a time: --notes or --notes-b64\n");
      return 2;
    }
    if (this.integrationResult !== undefined && this.integrationResultB64 !== undefined) {
      this.context.stderr.write("merge report integration-result accepts one payload transport at a time: --integration-result or --integration-result-b64\n");
      return 2;
    }
    const notes = this.notesB64 !== undefined
      ? decodeBase64Utf8OrRaw(this.notesB64)
      : (this.notes ?? "");
    const integrationResultRaw = this.integrationResultB64 !== undefined
      ? decodeBase64Utf8OrRaw(this.integrationResultB64)
      : (this.integrationResult ?? "");
    const out = buildMergeReport({
      issueNumber: this.issue,
      branch: this.branch,
      mergeStatus: this.mergeStatus,
      mergeResolver: this.mergeResolver,
      pathTaken: this.pathTaken,
      notes,
      integrationResultRaw,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- merge emit-resolution-failure --
export class MergeEmitResolutionFailureCommand extends Command {
  static paths = [["merge", "emit-resolution-failure"]];
  recurrenceKey = Option.String("--recurrence-key", "");
  resolutionNotes = Option.String("--resolution-notes", "");
  resolutionCheck = Option.String("--resolution-check", "");
  branch = Option.String("--branch", "");
  issue = Option.String("--issue", "");
  runId = Option.String("--run-id", "");
  factoryId = Option.String("--factory-id", "");
  runsDir = Option.String("--runs-dir", "");

  async execute() {
    const { emitResolutionFailure } = await import("../../commands/merge-item-ops.ts");
    const out = emitResolutionFailure({
      recurrenceKey: this.recurrenceKey,
      resolutionNotes: this.resolutionNotes,
      resolutionCheck: this.resolutionCheck,
      branch: this.branch,
      issue: this.issue,
      runId: this.runId,
      factoryId: this.factoryId,
      runsDir: this.runsDir,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- merge run-count --
export class MergeRunCountCommand extends Command {
  static paths = [["merge", "run-count"]];
  recurrenceKey = Option.String("--recurrence-key", "");
  lookbackHours = Option.String("--lookback-hours", "24");
  factoryId = Option.String("--factory-id", "");
  runsDir = Option.String("--runs-dir", "");

  async execute() {
    const { countResolutionFailures } = await import("../../commands/merge-item-ops.ts");
    const out = countResolutionFailures({
      recurrenceKey: this.recurrenceKey,
      lookbackHours: this.lookbackHours,
      factoryId: this.factoryId,
      runsDir: this.runsDir,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export const mergeCommands = [
  MergeAcquireLockCommand,
  MergeReleaseLockCommand,
  MergeAssertMainBranchCommand,
  MergeAssertMainCleanCommand,
  MergeExtractItemCommand,
  MergeResolveContextCommand,
  MergeSetupWorktreeCommand,
  MergeCleanupWorktreeCommand,
  MergeRebaseCommand,
  MergeAttemptCommand,
  MergePushMainCommand,
  MergeBuildConflictPacketCommand,
  MergeBuildCommitMessageCommand,
  MergeFinalizeCommitCommand,
  MergeVerifyResolutionCommand,
  MergeVerifyPushResolutionCommand,
  MergeRunIntegrationCommand,
  MergeReportCommand,
  MergeEmitResolutionFailureCommand,
  MergeRunCountCommand,
];
