import { Command, Option } from "clipanion";

import { resolveB64OrRaw, resolveJsonPayload } from "../helpers.ts";

async function resolveRepo(rawRepo = "") {
  const { resolveGhRepo } = await import("../../commands/common-resolve-gh-repo.ts");
  return resolveGhRepo(rawRepo);
}

export class GoalRunResolveConfigCommand extends Command {
  static paths = [["goal-run", "resolve-config"]];
  integrationCommand = Option.String("--integration-command", "");
  reviewQaCommand = Option.String("--review-qa-command", "");
  stalledGoalMinutes = Option.String("--stalled-goal-minutes", "");

  async execute() {
    const { resolveWaveConfig } = await import("../../commands/wave-resolve-config.ts");
    this.context.stdout.write(JSON.stringify(resolveWaveConfig({
      integrationCommand: this.integrationCommand,
      reviewQaCommand: this.reviewQaCommand,
      stalledWaveMinutes: this.stalledGoalMinutes,
    })));
    return 0;
  }
}

export class GoalRunFallbackJudgeCommand extends Command {
  static paths = [["goal-run", "fallback-judge"]];
  verdict = Option.String("--verdict", "");
  error = Option.String("--error", "");
  factoryId = Option.String("--factory-id", "");
  runId = Option.String("--run-id", "");
  workflowId = Option.String("--workflow-id", "goal_run");

  async execute() {
    const { fallbackJudgeDecision } = await import("../../commands/wave-judge-fallback.ts");
    this.context.stdout.write(JSON.stringify(fallbackJudgeDecision({
      verdictRaw: this.verdict,
      error: this.error,
      factoryId: this.factoryId,
      runId: this.runId,
      workflowId: this.workflowId,
      capabilityId: "goal_execution",
    })));
    return 0;
  }
}

export class GoalRunSplitResultsCommand extends Command {
  static paths = [["goal-run", "split-results"]];
  runId = Option.String("--run-id", "");
  runsDir = Option.String("--runs-dir", ".hatch/runs");
  fallback = Option.String("--fallback", { required: false });
  fallbackB64 = Option.String("--fallback-b64", { required: false });

  async execute() {
    const { splitWaveImplResultsFromSources } = await import("../../commands/wave-split-results.ts");
    const hasFallbackTransport = this.fallback !== undefined || this.fallbackB64 !== undefined;
    let resolvedPayload;
    try {
      resolvedPayload = await resolveJsonPayload({
        flag: this.fallback,
        flagB64: this.fallbackB64,
        flagName: "fallback",
        allowStdin: !this.runId,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }

    if (this.fallbackB64 !== undefined && this.fallbackB64.trim() && !resolvedPayload) {
      this.context.stderr.write("goal-run split-results payload decode failed; ensure --fallback-b64 decodes to UTF-8 JSON\n");
      return 2;
    }

    const fallbackRaw = hasFallbackTransport ? (resolvedPayload || "") : "";
    const stdinRaw = (!hasFallbackTransport && !this.runId) ? (resolvedPayload || "") : "";
    this.context.stdout.write(JSON.stringify(splitWaveImplResultsFromSources({
      runId: this.runId,
      runsDir: this.runsDir,
      stdinRaw,
      fallbackRaw,
    })));
    return 0;
  }
}

export class GoalRunHandleReviewFailuresCommand extends Command {
  static paths = [["goal-run", "handle-review-failures"]];
  repo = Option.String("--repo", "");
  reviewFailures = Option.String("--review-failures", { required: false });
  reviewFailuresB64 = Option.String("--review-failures-b64", { required: false });
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "goal_execute");
  mode = Option.String("--mode", "goal_execute");
  quarantineThreshold = Option.String("--quarantine-threshold", "3");
  cooldownHours = Option.String("--cooldown-hours", "6");

  async execute() {
    const { commentReviewFailures } = await import("../../commands/wave-handle-review-failures.ts");
    let reviewFailuresRaw;
    try {
      reviewFailuresRaw = await resolveJsonPayload({
        flag: this.reviewFailures,
        flagB64: this.reviewFailuresB64,
        flagName: "review-failures",
        allowStdin: true,
      });
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }
    if (this.reviewFailuresB64 !== undefined && this.reviewFailuresB64.trim() && !reviewFailuresRaw) {
      this.context.stderr.write("goal-run handle-review-failures payload decode failed; ensure --review-failures-b64 decodes to UTF-8 JSON\n");
      return 2;
    }
    this.context.stdout.write(JSON.stringify(commentReviewFailures({
      repo: await resolveRepo(this.repo),
      reviewFailuresRaw: reviewFailuresRaw || "[]",
      runId: this.runId,
      pipeline: this.pipeline,
      mode: this.mode,
      quarantineThreshold: Number(this.quarantineThreshold),
      cooldownHours: Number(this.cooldownHours),
    })));
    return 0;
  }
}

export class GoalRunHandleMergeFailuresCommand extends Command {
  static paths = [["goal-run", "handle-merge-failures"]];
  repo = Option.String("--repo", "");
  mergeFailures = Option.String("--merge-failures", "[]");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "goal_execute");
  goalNumber = Option.String("--goal-number", "");
  readyIssue = Option.String("--ready-issue", "");

  async execute() {
    const { commentMergeFailures } = await import("../../commands/wave-handle-merge-failures.ts");
    const out = commentMergeFailures({
      repo: await resolveRepo(this.repo),
      mergeFailuresRaw: this.mergeFailures,
      runId: this.runId,
      pipeline: this.pipeline,
      milestoneTitle: this.goalNumber ? `goal-${this.goalNumber}` : "",
      readyIssueNumber: this.readyIssue,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class GoalRunCheckMergeCandidatesCommand extends Command {
  static paths = [["goal-run", "check-merge-candidates"]];
  mergeCandidates = Option.String("--merge-candidates", "[]");

  async execute() {
    const { checkMergeCandidates } = await import("../../commands/wave-split-results.ts");
    this.context.stdout.write(JSON.stringify(checkMergeCandidates(this.mergeCandidates)));
    return 0;
  }
}

export class GoalRunCloseMergedIssuesCommand extends Command {
  static paths = [["goal-run", "close-merged-issues"]];
  repo = Option.String("--repo", "");
  mergeCandidates = Option.String("--merge-candidates", "[]");
  runId = Option.String("--run-id", "");
  goalNumber = Option.String("--goal-number", "");

  async execute() {
    const { closeMergedIssues } = await import("../../commands/wave-close-merged.ts");
    const out = closeMergedIssues({
      repo: await resolveRepo(this.repo),
      mergeCandidatesRaw: this.mergeCandidates,
      runId: this.runId,
      milestoneTitle: this.goalNumber ? `goal-${this.goalNumber}` : "",
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class GoalRunBuildMergeResultsCommand extends Command {
  static paths = [["goal-run", "build-merge-results"]];
  mergeCandidates = Option.String("--merge-candidates", "[]");
  mergeStatus = Option.String("--merge-status", "");
  pushStatus = Option.String("--push-status", "");
  repo = Option.String("--repo", "");
  mergeNotes = Option.String("--merge-notes", { required: false });
  mergeNotesB64 = Option.String("--merge-notes-b64", { required: false });
  mergeResolver = Option.String("--merge-resolver", "");
  pathTaken = Option.String("--path-taken", "");

  async execute() {
    const { buildWaveMergeResults } = await import("../../commands/wave-merge-results.ts");
    const mergeNotes = resolveB64OrRaw(this.mergeNotes, this.mergeNotesB64, "merge-notes");
    this.context.stdout.write(JSON.stringify(buildWaveMergeResults({
      mergeCandidatesRaw: this.mergeCandidates,
      mergeStatus: this.mergeStatus,
      pushStatus: this.pushStatus,
      repo: this.repo,
      mergeNotes,
      mergeResolver: this.mergeResolver,
      pathTaken: this.pathTaken,
    })));
    return 0;
  }
}

export const goalRunCommands = [
  GoalRunResolveConfigCommand,
  GoalRunFallbackJudgeCommand,
  GoalRunSplitResultsCommand,
  GoalRunHandleReviewFailuresCommand,
  GoalRunHandleMergeFailuresCommand,
  GoalRunCheckMergeCandidatesCommand,
  GoalRunCloseMergedIssuesCommand,
  GoalRunBuildMergeResultsCommand,
];
