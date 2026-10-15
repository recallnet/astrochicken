import { Command, Option } from "clipanion";

import { resolveB64OrRaw, resolveJsonPayload, decodeBase64Utf8 } from "../helpers.ts";

async function resolveRepo(rawRepo = "") {
  const { resolveGhRepo } = await import("../../commands/common-resolve-gh-repo.ts");
  return resolveGhRepo(rawRepo);
}

export class WaveComplexityEstimateCommand extends Command {
  static paths = [["wave", "complexity-estimate"]];

  input = Option.String("--input", "", { required: false });
  issueTitle = Option.String("--issue-title", { required: false });
  issueTitleB64 = Option.String("--issue-title-b64", { required: false });
  issueBody = Option.String("--issue-body", "", { required: false });
  changedFiles = Option.String("--changed-files", "", { required: false });
  estimatedLinesAdded = Option.String("--estimated-lines-added", "", { required: false });
  estimatedLinesDeleted = Option.String("--estimated-lines-deleted", "", { required: false });
  estimatedFileCount = Option.String("--estimated-file-count", "", { required: false });
  dependencyCount = Option.String("--dependency-count", "", { required: false });
  blockedByCount = Option.String("--blocked-by-count", "", { required: false });
  blocksCount = Option.String("--blocks-count", "", { required: false });
  qaCommand = Option.String("--qa-command", "", { required: false });

  async execute() {
    const { waveComplexityEstimate } = await import("../../commands/wave-complexity-estimate.ts");
    const issueTitle = resolveB64OrRaw(this.issueTitle, this.issueTitleB64, "issue-title");
    const out = waveComplexityEstimate({
      input: this.input,
      issueTitle,
      issueBody: this.issueBody,
      changedFiles: this.changedFiles,
      estimatedLinesAdded: this.estimatedLinesAdded,
      estimatedLinesDeleted: this.estimatedLinesDeleted,
      estimatedFileCount: this.estimatedFileCount,
      dependencyCount: this.dependencyCount,
      blockedByCount: this.blockedByCount,
      blocksCount: this.blocksCount,
      qaCommand: this.qaCommand,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : Number(out.exit_code || 1);
  }
}

export class WaveResolveConfigCommand extends Command {
  static paths = [["wave", "resolve-config"]];
  integrationCommand = Option.String("--integration-command", "");
  reviewQaCommand = Option.String("--review-qa-command", "");
  stalledWaveMinutes = Option.String("--stalled-wave-minutes", "");

  async execute() {
    const { resolveWaveConfig } = await import("../../commands/wave-resolve-config.ts");
    this.context.stdout.write(JSON.stringify(resolveWaveConfig({ integrationCommand: this.integrationCommand, reviewQaCommand: this.reviewQaCommand, stalledWaveMinutes: this.stalledWaveMinutes })));
    return 0;
  }
}

export class WaveFallbackJudgeCommand extends Command {
  static paths = [["wave", "fallback-judge"]];
  verdict = Option.String("--verdict", "");
  error = Option.String("--error", "");
  factoryId = Option.String("--factory-id", "");
  runId = Option.String("--run-id", "");
  workflowId = Option.String("--workflow-id", "wave_execute");

  async execute() {
    const { fallbackJudgeDecision } = await import("../../commands/wave-judge-fallback.ts");
    this.context.stdout.write(JSON.stringify(fallbackJudgeDecision({
      verdictRaw: this.verdict,
      error: this.error,
      factoryId: this.factoryId,
      runId: this.runId,
      workflowId: this.workflowId,
      capabilityId: "wave_execution",
    })));
    return 0;
  }
}

export class WaveEnumerateSlotsCommand extends Command {
  static paths = [["wave", "enumerate-slots"]];
  maxConcurrent = Option.String("--max-concurrent", "2");
  readyCount = Option.String("--ready-count", "");
  inFlightCount = Option.String("--in-flight-count", "");
  selectedCount = Option.String("--selected-count", "0");

  async execute() {
    const { enumerateWaveSlots } = await import("../../commands/wave-enumerate-slots.ts");
    this.context.stdout.write(enumerateWaveSlots({ maxConcurrent: this.maxConcurrent, readyCount: this.readyCount, inFlightCount: this.inFlightCount, selectedCount: this.selectedCount }));
    return 0;
  }
}

export class WaveFilterReadyIssuesCommand extends Command {
  static paths = [["wave", "filter-ready-issues"]];
  milestoneIssues = Option.String("--milestone-issues", { required: false });
  milestoneIssuesB64 = Option.String("--milestone-issues-b64", { required: false });
  repo = Option.String("--repo", "");

  async execute() {
    const { filterReadyIssues } = await import("../../commands/wave-filter-ready-issues.ts");
    let milestoneIssuesRaw;
    try {
      milestoneIssuesRaw = await resolveJsonPayload({
        flag: this.milestoneIssues,
        flagB64: this.milestoneIssuesB64,
        flagName: "milestone-issues",
        allowStdin: true,
      });
    } catch (e) {
      this.context.stderr.write(e.message + "\n");
      return 2;
    }

    if (this.milestoneIssuesB64 !== undefined && this.milestoneIssuesB64.trim() && !milestoneIssuesRaw) {
      this.context.stderr.write("wave filter-ready-issues payload decode failed; ensure --milestone-issues-b64 decodes to UTF-8 JSON\n");
      return 2;
    }

    this.context.stdout.write(JSON.stringify(filterReadyIssues({ milestoneIssuesRaw: milestoneIssuesRaw || "[]", repo: await resolveRepo(this.repo) })));
    return 0;
  }
}

export class WaveSplitResultsCommand extends Command {
  static paths = [["wave", "split-results"]];
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
    } catch (e) {
      this.context.stderr.write(e.message + "\n");
      return 2;
    }

    if (this.fallbackB64 !== undefined && this.fallbackB64.trim() && !resolvedPayload) {
      this.context.stderr.write("wave split-results payload decode failed; ensure --fallback-b64 decodes to UTF-8 JSON\n");
      return 2;
    }

    const fallbackRaw = hasFallbackTransport ? (resolvedPayload || "") : "";
    const stdinRaw = (!hasFallbackTransport && !this.runId) ? (resolvedPayload || "") : "";
    this.context.stdout.write(JSON.stringify(splitWaveImplResultsFromSources({ runId: this.runId, runsDir: this.runsDir, stdinRaw, fallbackRaw })));
    return 0;
  }
}

export class WaveSplitMergeResultsCommand extends Command {
  static paths = [["wave", "split-merge-results"]];
  mergeResults = Option.String("--merge-results", "[]");

  async execute() {
    const { splitMergeResults } = await import("../../commands/wave-merge-results.ts");
    this.context.stdout.write(JSON.stringify(splitMergeResults(this.mergeResults)));
    return 0;
  }
}

export class WaveDispatchSelectCommand extends Command {
  static paths = [["wave", "dispatch-select"]];
  repo = Option.String("--repo", "");
  maxConcurrent = Option.String("--max-concurrent", "1");
  milestones = Option.String("--milestones", { required: false });
  milestonesB64 = Option.String("--milestones-b64", { required: false });
  readyIssues = Option.String("--ready-issues", { required: false });
  readyIssuesB64 = Option.String("--ready-issues-b64", { required: false });
  prioritiesIssue = Option.String("--priorities-issue", { required: false });
  prioritiesIssueB64 = Option.String("--priorities-issue-b64", { required: false });

  async execute() {
    const { selectDispatchWavesFromArgs } = await import("../../commands/wave-dispatch-select.ts");
    const rawMaxConcurrent = Number(this.maxConcurrent);
    const maxConcurrent = Number.isFinite(rawMaxConcurrent) && rawMaxConcurrent > 0 ? rawMaxConcurrent : 1;

    const hasRawPayload = this.milestones !== undefined && this.readyIssues !== undefined && this.prioritiesIssue !== undefined;
    const hasB64Payload = this.milestonesB64 !== undefined && this.readyIssuesB64 !== undefined && this.prioritiesIssueB64 !== undefined;

    if (!hasRawPayload && !hasB64Payload) {
      this.context.stderr.write("wave dispatch-select requires explicit payload inputs: either (--milestones, --ready-issues, --priorities-issue) or (--milestones-b64, --ready-issues-b64, --priorities-issue-b64)\n");
      return 2;
    }
    if (hasRawPayload && hasB64Payload) {
      this.context.stderr.write("wave dispatch-select accepts one payload transport at a time: raw JSON flags or base64 flags\n");
      return 2;
    }

    const milestonesRaw = hasRawPayload ? this.milestones : decodeBase64Utf8(this.milestonesB64);
    const readyIssuesRaw = hasRawPayload ? this.readyIssues : decodeBase64Utf8(this.readyIssuesB64);
    const prioritiesIssueRaw = hasRawPayload ? this.prioritiesIssue : decodeBase64Utf8(this.prioritiesIssueB64);

    if (!milestonesRaw || !readyIssuesRaw || !prioritiesIssueRaw) {
      this.context.stderr.write("wave dispatch-select payload decode failed; ensure base64 arguments decode to UTF-8 JSON\n");
      return 2;
    }

    const out = selectDispatchWavesFromArgs({ milestonesRaw, readyIssuesRaw, prioritiesIssueRaw, repo: await resolveRepo(this.repo), maxConcurrent });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class WaveCreateReadyCommand extends Command {
  static paths = [["wave", "create-ready"]];
  repo = Option.String("--repo", "");
  selectedWaves = Option.String("--selected-waves", { required: false });
  cooldownMinutes = Option.String("--cooldown-minutes", { required: false });

  async execute() {
    if (this.selectedWaves === undefined) {
      this.context.stderr.write("wave create-ready requires explicit payload input: --selected-waves\n");
      return 2;
    }
    const { createReadyMarkersFromArgs } = await import("../../commands/wave-create-ready.ts");
    const cooldownMinutes = this.cooldownMinutes !== undefined ? Number(this.cooldownMinutes) : undefined;
    const out = createReadyMarkersFromArgs({ repo: await resolveRepo(this.repo), selectedWavesRaw: this.selectedWaves || "[]", cooldownMinutes });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class WaveFindReadyCommand extends Command {
  static paths = [["wave", "find-ready"]];
  repo = Option.String("--repo", "");
  runId = Option.String("--run-id", "");
  workerId = Option.String("--worker-id", { required: false });
  runsDir = Option.String("--runs-dir", ".hatch/runs");
  staleRunMinutes = Option.String("--stale-run-minutes", "20");
  leaseSeconds = Option.String("--lease-seconds", "1200");

  async execute() {
    const { pickReadyWaveFromRepo } = await import("../../commands/wave-find-ready.ts");
    const runId = this.runId;
    const out = pickReadyWaveFromRepo({
      repo: await resolveRepo(this.repo),
      runId,
      workerId: this.workerId !== undefined ? this.workerId : runId,
      runsDir: this.runsDir,
      staleRunMinutes: Number(this.staleRunMinutes),
      leaseSeconds: Number(this.leaseSeconds),
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class WaveLockReadyCommand extends Command {
  static paths = [["wave", "lock-ready"]];
  repo = Option.String("--repo", "");
  issue = Option.String("--issue", "");
  milestoneTitle = Option.String("--milestone-title", "");
  claimToken = Option.String("--claim-token", "");
  claimOwnerId = Option.String("--claim-owner-id", "");
  claimRunId = Option.String("--claim-run-id", "");
  leaseSeconds = Option.String("--lease-seconds", "1200");

  async execute() {
    const { lockReadyWaveIssue } = await import("../../commands/wave-claim.ts");
    const out = lockReadyWaveIssue({ repo: await resolveRepo(this.repo), readyIssueNumber: this.issue, milestoneTitle: this.milestoneTitle, claimToken: this.claimToken, claimOwnerId: this.claimOwnerId, claimRunId: this.claimRunId, leaseSeconds: Number(this.leaseSeconds) });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class WaveHandleReviewFailuresCommand extends Command {
  static paths = [["wave", "handle-review-failures"]];
  repo = Option.String("--repo", "");
  reviewFailures = Option.String("--review-failures", { required: false });
  reviewFailuresB64 = Option.String("--review-failures-b64", { required: false });
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "wave_execute");
  mode = Option.String("--mode", "wave_execute");
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
    } catch (e) {
      this.context.stderr.write(e.message + "\n");
      return 2;
    }
    if (this.reviewFailuresB64 !== undefined && this.reviewFailuresB64.trim() && !reviewFailuresRaw) {
      this.context.stderr.write("wave handle-review-failures payload decode failed; ensure --review-failures-b64 decodes to UTF-8 JSON\n");
      return 2;
    }
    this.context.stdout.write(JSON.stringify(commentReviewFailures({ repo: await resolveRepo(this.repo), reviewFailuresRaw: reviewFailuresRaw || "[]", runId: this.runId, pipeline: this.pipeline, mode: this.mode, quarantineThreshold: Number(this.quarantineThreshold), cooldownHours: Number(this.cooldownHours) })));
    return 0;
  }
}

export class WaveReleaseQuarantineCommand extends Command {
  static paths = [["wave", "release-quarantine"]];
  repo = Option.String("--repo", "");
  now = Option.String("--now", "0");

  async execute() {
    const { releaseWaveQuarantine } = await import("../../commands/wave-handle-review-failures.ts");
    const out = releaseWaveQuarantine({ repo: await resolveRepo(this.repo), nowEpoch: Number(this.now) });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class WaveHandleMergeFailuresCommand extends Command {
  static paths = [["wave", "handle-merge-failures"]];
  repo = Option.String("--repo", "");
  mergeFailures = Option.String("--merge-failures", "[]");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "wave_execute");
  milestoneTitle = Option.String("--milestone-title", "");
  readyIssue = Option.String("--ready-issue", "");

  async execute() {
    const { commentMergeFailures } = await import("../../commands/wave-handle-merge-failures.ts");
    const out = commentMergeFailures({ repo: await resolveRepo(this.repo), mergeFailuresRaw: this.mergeFailures, runId: this.runId, pipeline: this.pipeline, milestoneTitle: this.milestoneTitle, readyIssueNumber: this.readyIssue });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class WaveOpenJudgeFollowupCommand extends Command {
  static paths = [["wave", "open-judge-followup"]];
  repo = Option.String("--repo", "");
  milestoneTitle = Option.String("--milestone-title", "");
  judgeNotes = Option.String("--judge-notes", { required: false });
  judgeNotesB64 = Option.String("--judge-notes-b64", { required: false });
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "wave_execute");

  async execute() {
    const { openJudgeFollowupArtifact } = await import("../../commands/wave-open-judge-followup.ts");
    const jn = resolveB64OrRaw(this.judgeNotes, this.judgeNotesB64, "judge-notes");
    this.context.stdout.write(JSON.stringify(openJudgeFollowupArtifact({ repo: await resolveRepo(this.repo), milestoneTitle: this.milestoneTitle, judgeNotes: jn, runId: this.runId, pipeline: this.pipeline })));
    return 0;
  }
}

export class WaveRequeueAfterJudgeFailureCommand extends Command {
  static paths = [["wave", "requeue-after-judge-failure"]];
  repo = Option.String("--repo", "");
  wave = Option.String("--wave", "");
  milestoneTitle = Option.String("--milestone-title", { required: false });
  milestone = Option.String("--milestone", { required: false });
  judgeContext = Option.String("--judge-context", { required: false });
  judgeContextScopeIdentity = Option.String("--judge-context-scope-identity", "");
  cooldownPolicy = Option.String("--cooldown-policy", { required: false });
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "wave_execute");

  async execute() {
    const { requeueAfterJudgeFailure } = await import("../../commands/wave-sanitize-state.ts");

    const scopeIdentity = String(this.judgeContextScopeIdentity || "").trim();
    const judgeContextObj = {
      judge_context_scope_identity: scopeIdentity || "wave_execute",
    };
    const policyRaw = this.cooldownPolicy !== undefined ? this.cooldownPolicy : "{}";

    const out = requeueAfterJudgeFailure({
      repo: await resolveRepo(this.repo),
      wave: this.wave,
      milestone: this.milestoneTitle || this.milestone || this.wave,
      judgeContext: this.judgeContext !== undefined && this.judgeContext.trim()
        ? this.judgeContext
        : judgeContextObj,
      cooldownPolicy: policyRaw,
      runId: this.runId,
      pipeline: this.pipeline,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class WaveSanitizeStateCommand extends Command {
  static paths = [["wave", "sanitize-state"]];
  repo = Option.String("--repo", "");
  apply = Option.String("--apply", { required: false });
  dryRun = Option.String("--dry-run", { required: false });
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "");
  runsDir = Option.String("--runs-dir", ".hatch/runs");
  staleRunMinutes = Option.String("--stale-run-minutes", "20");

  async execute() {
    const { sanitizeWaveState } = await import("../../commands/wave-sanitize-state.ts");
    const { parseBoolFlag } = await import("../helpers.ts");

    const hasApply = this.apply !== undefined;
    const hasDryRun = this.dryRun !== undefined;
    const apply = hasApply ? parseBoolFlag(this.apply) : false;
    const dryRun = (!hasApply && hasDryRun)
      ? parseBoolFlag(this.dryRun, true)
      : undefined;

    const out = sanitizeWaveState({ repo: await resolveRepo(this.repo), dryRun, apply, runId: this.runId, pipeline: this.pipeline, runsDir: this.runsDir, staleRunMinutes: Number(this.staleRunMinutes) });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class WaveClaimDiagnosticsCommand extends Command {
  static paths = [["wave", "claim-diagnostics"]];
  nowEpochMs = Option.String("--now-epoch-ms", "0");

  async execute() {
    const { runWaveClaimDiagnostics } = await import("../../commands/wave-claim-diagnostics.ts");
    const out = runWaveClaimDiagnostics({ nowEpochMs: Number(this.nowEpochMs) || Date.parse("2026-01-01T01:00:00.000Z") });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class WaveThroughputReportCommand extends Command {
  static paths = [["wave", "throughput-report"]];
  repo = Option.String("--repo", "");
  maxConcurrent = Option.String("--max-concurrent", "1");
  staleClaimMinutes = Option.String("--stale-claim-minutes", "0");

  async execute() {
    const { waveThroughputReport } = await import("../../commands/wave-throughput-report.ts");
    const out = waveThroughputReport({
      repo: await resolveRepo(this.repo),
      maxConcurrentWaves: Number(this.maxConcurrent),
      staleClaimMinutes: Number(this.staleClaimMinutes),
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class WaveClaimReadyCommand extends Command {
  static paths = [["wave", "claim-ready"]];
  repo = Option.String("--repo", "");
  issue = Option.String("--issue", "");
  milestoneTitle = Option.String("--milestone-title", "");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "wave_execute");

  async execute() {
    const { claimReadyWaveIssue } = await import("../../commands/wave-claim.ts");
    const out = claimReadyWaveIssue({ repo: await resolveRepo(this.repo), readyIssueNumber: this.issue, milestoneTitle: this.milestoneTitle, runId: this.runId, pipeline: this.pipeline });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class WaveCheckControlPlaneBlockerCommand extends Command {
  static paths = [["wave", "check-control-plane-blocker"]];
  repo = Option.String("--repo", "");
  issue = Option.String("--issue", "");

  async execute() {
    const { checkControlPlaneBlocker } = await import("../../commands/wave-blocker-check.ts");
    const out = await checkControlPlaneBlocker({
      repo: await resolveRepo(this.repo),
      issue: this.issue,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class WaveCompleteReadyCommand extends Command {
  static paths = [["wave", "complete-ready"]];
  repo = Option.String("--repo", "");
  issue = Option.String("--issue", "");
  milestoneTitle = Option.String("--milestone-title", "");
  claimToken = Option.String("--claim-token", "");
  claimOwnerId = Option.String("--claim-owner-id", "");
  claimRunId = Option.String("--claim-run-id", "");

  async execute() {
    const { completeReadyWaveIssue } = await import("../../commands/wave-claim.ts");
    const out = completeReadyWaveIssue({
      repo: await resolveRepo(this.repo),
      readyIssueNumber: this.issue,
      milestoneTitle: this.milestoneTitle,
      claimToken: this.claimToken,
      claimOwnerId: this.claimOwnerId,
      claimRunId: this.claimRunId,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class WaveReleaseClaimCommand extends Command {
  static paths = [["wave", "release-claim"]];
  repo = Option.String("--repo", "");
  issue = Option.String("--issue", "");
  claimToken = Option.String("--claim-token", { required: false });
  claimOwnerId = Option.String("--claim-owner-id", { required: false });
  claimRunId = Option.String("--claim-run-id", { required: false });
  milestoneTitle = Option.String("--milestone-title", "");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "wave_execute");
  reason = Option.String("--reason", { required: false });
  force = Option.Boolean("--force", false);
  removeLabel = Option.Boolean("--remove-label", false);

  async execute() {
    const ct = this.claimToken;
    const co = this.claimOwnerId;
    const cr = this.claimRunId;

    if (ct !== undefined || co !== undefined || cr !== undefined) {
      const { releaseReadyWaveClaimOps } = await import("../../commands/wave-claim.ts");
      const out = releaseReadyWaveClaimOps({ repo: await resolveRepo(this.repo), readyIssueNumber: this.issue, claimToken: ct || "", claimOwnerId: co || "", claimRunId: cr || "", reason: this.reason || "wave_terminal_release", force: this.force });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    }

    const { releaseReadyWaveClaim } = await import("../../commands/wave-claim.ts");
    const { resolveBoolean } = await import("../../commands/common-resolve-default.ts");
    const out = releaseReadyWaveClaim({ repo: await resolveRepo(this.repo), readyIssueNumber: this.issue, milestoneTitle: this.milestoneTitle, runId: this.runId, pipeline: this.pipeline, reason: this.reason || "released", removeLabel: resolveBoolean(String(this.removeLabel), false) === "true" });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class WaveBlockReadyCommand extends Command {
  static paths = [["wave", "block-ready"]];
  repo = Option.String("--repo", "");
  issue = Option.String("--issue", "");
  milestoneTitle = Option.String("--milestone-title", "");
  reason = Option.String("--reason", "blocked");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "wave_execute");

  async execute() {
    const { blockReadyWaveIssue } = await import("../../commands/wave-block-ready.ts");
    const out = blockReadyWaveIssue({ repo: await resolveRepo(this.repo), readyIssueNumber: this.issue, milestoneTitle: this.milestoneTitle, reason: this.reason, runId: this.runId, pipeline: this.pipeline });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class WaveCheckMergeCandidatesCommand extends Command {
  static paths = [["wave", "check-merge-candidates"]];
  mergeCandidates = Option.String("--merge-candidates", "[]");

  async execute() {
    const { checkMergeCandidates } = await import("../../commands/wave-split-results.ts");
    const out = checkMergeCandidates(this.mergeCandidates);
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class WaveCloseMergedIssuesCommand extends Command {
  static paths = [["wave", "close-merged-issues"]];
  repo = Option.String("--repo", "");
  mergeCandidates = Option.String("--merge-candidates", "[]");
  runId = Option.String("--run-id", "");
  milestoneTitle = Option.String("--milestone-title", "");

  async execute() {
    const { closeMergedIssues } = await import("../../commands/wave-close-merged.ts");
    const out = closeMergedIssues({ repo: await resolveRepo(this.repo), mergeCandidatesRaw: this.mergeCandidates, runId: this.runId, milestoneTitle: this.milestoneTitle });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class WaveBuildWaveMergeResultsCommand extends Command {
  static paths = [["wave", "build-wave-merge-results"]];
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
    const notes = resolveB64OrRaw(this.mergeNotes, this.mergeNotesB64, "merge-notes");
    const out = buildWaveMergeResults({
      mergeCandidatesRaw: this.mergeCandidates,
      mergeStatus: this.mergeStatus,
      pushStatus: this.pushStatus,
      repo: this.repo,
      mergeNotes: notes,
      mergeResolver: this.mergeResolver,
      pathTaken: this.pathTaken,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class WaveDemoTerminalCommand extends Command {
  static paths = [["wave", "demo-terminal"]];
  runId = Option.String("--run-id", "");
  runsDir = Option.String("--runs-dir", ".hatch/runs");
  repo = Option.String("--repo", "");
  milestoneTitle = Option.String("--milestone-title", "");
  readyIssue = Option.String("--ready-issue", "");
  mergedResults = Option.String("--merged-results", { required: false });
  mergedResultsB64 = Option.String("--merged-results-b64", { required: false });
  mergeStdout = Option.String("--merge-stdout", { required: false });
  mergeStdoutB64 = Option.String("--merge-stdout-b64", { required: false });
  mergeStderr = Option.String("--merge-stderr", { required: false });
  mergeStderrB64 = Option.String("--merge-stderr-b64", { required: false });
  issueTitles = Option.String("--issue-titles", { required: false });
  issueTitlesB64 = Option.String("--issue-titles-b64", { required: false });

  async execute() {
    if (!String(this.runId || "").trim()) {
      this.context.stderr.write("wave demo-terminal requires --run-id\n");
      return 2;
    }

    let mergedResultsRaw;
    try {
      mergedResultsRaw = await resolveJsonPayload({
        flag: this.mergedResults,
        flagB64: this.mergedResultsB64,
        flagName: "merged-results",
        allowStdin: true,
      });
    } catch (e) {
      this.context.stderr.write(e.message + "\n");
      return 2;
    }
    if (this.mergedResultsB64 !== undefined && this.mergedResultsB64.trim() && !mergedResultsRaw) {
      this.context.stderr.write("wave demo-terminal payload decode failed; ensure --merged-results-b64 decodes to UTF-8 JSON\n");
      return 2;
    }

    let mergeStdout;
    try {
      mergeStdout = resolveB64OrRaw(this.mergeStdout, this.mergeStdoutB64, "merge-stdout");
    } catch (e) {
      this.context.stderr.write(e.message + "\n");
      return 2;
    }
    if (this.mergeStdoutB64 !== undefined && this.mergeStdoutB64.trim() && !mergeStdout) {
      this.context.stderr.write("wave demo-terminal payload decode failed; ensure --merge-stdout-b64 decodes to UTF-8 text\n");
      return 2;
    }

    let mergeStderr;
    try {
      mergeStderr = resolveB64OrRaw(this.mergeStderr, this.mergeStderrB64, "merge-stderr");
    } catch (e) {
      this.context.stderr.write(e.message + "\n");
      return 2;
    }
    if (this.mergeStderrB64 !== undefined && this.mergeStderrB64.trim() && !mergeStderr) {
      this.context.stderr.write("wave demo-terminal payload decode failed; ensure --merge-stderr-b64 decodes to UTF-8 text\n");
      return 2;
    }

    let issueTitlesRaw;
    try {
      issueTitlesRaw = resolveB64OrRaw(this.issueTitles, this.issueTitlesB64, "issue-titles");
    } catch (e) {
      this.context.stderr.write(e.message + "\n");
      return 2;
    }
    if (this.issueTitlesB64 !== undefined && this.issueTitlesB64.trim() && !issueTitlesRaw) {
      this.context.stderr.write("wave demo-terminal payload decode failed; ensure --issue-titles-b64 decodes to UTF-8 JSON\n");
      return 2;
    }

    const { generateWaveTerminalDemo } = await import("../../commands/wave-demo-terminal.ts");
    const out = generateWaveTerminalDemo({
      runId: this.runId,
      runsDir: this.runsDir,
      repo: await resolveRepo(this.repo),
      milestoneTitle: this.milestoneTitle,
      readyIssueNumber: this.readyIssue,
      mergedResultsRaw: mergedResultsRaw || "[]",
      mergeStdout: mergeStdout || "",
      mergeStderr: mergeStderr || "",
      issueTitlesRaw: issueTitlesRaw || "{}",
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class WaveDemoPublishCommand extends Command {
  static paths = [["wave", "demo-publish"]];
  repo = Option.String("--repo", "");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "wave_execute");
  milestoneTitle = Option.String("--milestone-title", "");
  readyIssue = Option.String("--ready-issue", "");
  demoArtifactPath = Option.String("--demo-artifact-path", "");
  demoArtifactContent = Option.String("--demo-artifact-content", { required: false });
  demoArtifactContentB64 = Option.String("--demo-artifact-content-b64", { required: false });
  demoStrategy = Option.String("--demo-strategy", "terminal");

  async execute() {
    const repo = await resolveRepo(this.repo);
    if (!String(repo || "").trim()) {
      this.context.stderr.write("wave demo-publish requires --repo\n");
      return 2;
    }

    let content;
    try {
      content = resolveB64OrRaw(this.demoArtifactContent, this.demoArtifactContentB64, "demo-artifact-content");
    } catch (e) {
      this.context.stderr.write(e.message + "\n");
      return 2;
    }
    if (this.demoArtifactContentB64 !== undefined && this.demoArtifactContentB64.trim() && !content) {
      this.context.stderr.write("wave demo-publish payload decode failed; ensure --demo-artifact-content-b64 decodes to UTF-8 text\n");
      return 2;
    }
    if (!String(this.demoArtifactPath || "").trim() && !String(content || "").trim()) {
      this.context.stderr.write("wave demo-publish requires --demo-artifact-path or --demo-artifact-content\n");
      return 2;
    }

    const { publishWaveDemoArtifact } = await import("../../commands/wave-demo-publish.ts");
    const out = publishWaveDemoArtifact({
      repo,
      runId: this.runId,
      pipeline: this.pipeline,
      milestoneTitle: this.milestoneTitle,
      readyIssueNumber: this.readyIssue,
      demoArtifactPath: this.demoArtifactPath,
      demoArtifactContent: content || "",
      demoStrategy: this.demoStrategy,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class WaveEnsureLabelsCommand extends Command {
  static paths = [["wave", "ensure-labels"]];
  repo = Option.String("--repo", "");

  async execute() {
    const { waveEnsureLabels } = await import("../../commands/wave-ensure-labels.ts");
    const out = waveEnsureLabels({ repo: await resolveRepo(this.repo) });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class WaveListMilestonesB64Command extends Command {
  static paths = [["wave", "list-milestones-b64"]];
  repo = Option.String("--repo", "");

  async execute() {
    const { waveListMilestonesB64 } = await import("../../commands/wave-list-milestones-b64.ts");
    this.context.stdout.write(waveListMilestonesB64({ repo: await resolveRepo(this.repo) }));
    return 0;
  }
}

export class WaveListReadyIssuesB64Command extends Command {
  static paths = [["wave", "list-ready-issues-b64"]];
  repo = Option.String("--repo", "");

  async execute() {
    const { waveListReadyIssuesB64 } = await import("../../commands/wave-list-ready-issues-b64.ts");
    this.context.stdout.write(waveListReadyIssuesB64({ repo: await resolveRepo(this.repo) }));
    return 0;
  }
}

export class WaveListPrioritiesB64Command extends Command {
  static paths = [["wave", "list-priorities-b64"]];
  repo = Option.String("--repo", "");

  async execute() {
    const { waveListPrioritiesB64 } = await import("../../commands/wave-list-priorities-b64.ts");
    this.context.stdout.write(waveListPrioritiesB64({ repo: await resolveRepo(this.repo) }));
    return 0;
  }
}

export const waveCommands = [
  WaveComplexityEstimateCommand,
  WaveResolveConfigCommand,
  WaveFallbackJudgeCommand,
  WaveEnumerateSlotsCommand,
  WaveFilterReadyIssuesCommand,
  WaveSplitResultsCommand,
  WaveSplitMergeResultsCommand,
  WaveDispatchSelectCommand,
  WaveCreateReadyCommand,
  WaveFindReadyCommand,
  WaveLockReadyCommand,
  WaveHandleReviewFailuresCommand,
  WaveReleaseQuarantineCommand,
  WaveHandleMergeFailuresCommand,
  WaveOpenJudgeFollowupCommand,
  WaveRequeueAfterJudgeFailureCommand,
  WaveSanitizeStateCommand,
  WaveClaimDiagnosticsCommand,
  WaveThroughputReportCommand,
  WaveClaimReadyCommand,
  WaveCheckControlPlaneBlockerCommand,
  WaveCompleteReadyCommand,
  WaveReleaseClaimCommand,
  WaveBlockReadyCommand,
  WaveCheckMergeCandidatesCommand,
  WaveCloseMergedIssuesCommand,
  WaveBuildWaveMergeResultsCommand,
  WaveDemoTerminalCommand,
  WaveDemoPublishCommand,
  WaveEnsureLabelsCommand,
  WaveListMilestonesB64Command,
  WaveListReadyIssuesB64Command,
  WaveListPrioritiesB64Command,
];
