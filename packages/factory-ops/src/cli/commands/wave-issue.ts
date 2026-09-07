import { Command, Option } from "clipanion";

import { resolveB64OrRaw, resolveJsonPayload } from "../helpers.ts";

function writeJsonLine(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function parseCsvOrJsonArray(raw = "") {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry ?? "").trim()).filter(Boolean);
      }
    } catch {
      // Fall through to CSV parsing.
    }
  }
  return text.split(",").map((entry) => entry.trim()).filter(Boolean);
}

export class WaveIssueExtractCommand extends Command {
  static paths = [["wave-issue", "extract"]];
  item = Option.String("--item", { required: false });
  itemB64 = Option.String("--item-b64", { required: false });

  async execute() {
    const { extractIssueItem } = await import("../../commands/wave-issue-extract.ts");
    let itemPayload;
    try {
      itemPayload = await resolveJsonPayload({
        flag: this.item,
        flagB64: this.itemB64,
        flagName: "item",
        allowStdin: true,
      });
    } catch (e) {
      this.context.stderr.write(e.message + "\n");
      return 2;
    }
    if (this.itemB64 !== undefined && this.itemB64.trim() && !itemPayload) {
      this.context.stderr.write("wave-issue extract payload decode failed; ensure --item-b64 decodes to UTF-8 JSON\n");
      return 2;
    }
    const out = extractIssueItem(itemPayload || "{}");
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class WaveIssueFetchBodyCommand extends Command {
  static paths = [["wave-issue", "fetch-body"]];
  repo = Option.String("--repo", "");
  issue = Option.String("--issue", "");

  async execute() {
    const { fetchIssueBody } = await import("../../commands/wave-issue-fetch-body.ts");
    const out = fetchIssueBody({ repo: this.repo, issueNumber: this.issue });
    this.context.stdout.write(String(out));
    return 0;
  }
}

export class WaveIssueEstimateComplexityCommand extends Command {
  static paths = [["wave-issue", "estimate-complexity"]];
  issueTitle = Option.String("--issue-title", { required: false });
  issueTitleB64 = Option.String("--issue-title-b64", { required: false });
  issueBody = Option.String("--issue-body", { required: false });
  issueBodyB64 = Option.String("--issue-body-b64", { required: false });
  issueNumber = Option.String("--issue-number", { required: false });
  repo = Option.String("--repo", { required: false });

  async execute() {
    const { estimateWaveIssueComplexity } = await import("../../commands/wave-issue-state.ts");
    let title = resolveB64OrRaw(this.issueTitle, this.issueTitleB64, "issue-title");
    let body = resolveB64OrRaw(this.issueBody, this.issueBodyB64, "issue-body");
    if ((!title || !body) && this.issueNumber && this.repo) {
      const { ghJson } = await import("../../lib/cli-helpers.ts");
      const issue = ghJson(["issue", "view", this.issueNumber, "--repo", this.repo, "--json", "title,body"], null);
      if (issue && typeof issue === "object") {
        if (!title) title = issue.title || "";
        if (!body) body = issue.body || "";
      }
    }
    this.context.stdout.write(JSON.stringify(estimateWaveIssueComplexity({ issueTitle: title, issueBody: body })));
    return 0;
  }
}

export class WaveIssueInitCommand extends Command {
  static paths = [["wave-issue", "init"]];
  issue = Option.String("--issue", "");
  repo = Option.String("--repo", "");
  branch = Option.String("--branch", "");
  worktreeDir = Option.String("--worktree-dir", "");
  agentSessionId = Option.String("--agent-session-id", "");

  async execute() {
    const { initWaveIssueWorktree } = await import("../../commands/wave-issue-init.ts");
    const out = initWaveIssueWorktree({ issueNumber: this.issue, repo: this.repo, branch: this.branch, worktreeDir: this.worktreeDir, agentSessionId: this.agentSessionId });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class WaveIssueInspectExistingCommand extends Command {
  static paths = [["wave-issue", "inspect-existing"]];
  worktreeDir = Option.String("--worktree-dir", "");

  async execute() {
    const { inspectExistingCommits } = await import("../../commands/wave-issue-state.ts");
    this.context.stdout.write(JSON.stringify(inspectExistingCommits({ worktreeDir: this.worktreeDir })));
    return 0;
  }
}

export class WaveIssueInspectChangesCommand extends Command {
  static paths = [["wave-issue", "inspect-changes"]];
  worktreeDir = Option.String("--worktree-dir", "");

  async execute() {
    const { inspectBranchChanges } = await import("../../commands/wave-issue-state.ts");
    this.context.stdout.write(JSON.stringify(inspectBranchChanges({ worktreeDir: this.worktreeDir })));
    return 0;
  }
}

export class WaveIssueResolveModeCommand extends Command {
  static paths = [["wave-issue", "resolve-mode"]];
  mode = Option.String("--mode", "");

  async execute() {
    const { resolveExecutionMode } = await import("../../commands/wave-issue-state.ts");
    this.context.stdout.write(resolveExecutionMode(this.mode));
    return 0;
  }
}

export class WaveIssueDecideExistingReuseWithNotesCommand extends Command {
  static paths = [["wave-issue", "decide-existing-reuse-with-notes"]];
  branch = Option.String("--branch", "");
  existingCommits = Option.String("--existing-commits", "0");
  issue = Option.String("--issue", "");
  worktreeDir = Option.String("--worktree-dir", "");

  async execute() {
    const { decideExistingReuseWithNotes } = await import("../../commands/wave-issue-state.ts");
    this.context.stdout.write(JSON.stringify(decideExistingReuseWithNotes({ branch: this.branch, existingCommits: this.existingCommits, issueNumber: this.issue, worktreeDir: this.worktreeDir })));
    return 0;
  }
}

export class WaveIssueSetIssueContextCommand extends Command {
  static paths = [["wave-issue", "set-issue-context"]];
  issueNumber = Option.String("--issue-number", "");
  issueTitle = Option.String("--issue-title", { required: false });
  issueTitleB64 = Option.String("--issue-title-b64", { required: false });

  async execute() {
    const issTitle = resolveB64OrRaw(this.issueTitle, this.issueTitleB64, "issue-title");
    this.context.stdout.write(JSON.stringify({ issue_number: String(this.issueNumber), issue_title: String(issTitle) }));
    return 0;
  }
}

export class WaveIssueCleanupLegacyCommand extends Command {
  static paths = [["wave-issue", "cleanup-legacy-worktree"]];
  repo = Option.String("--repo", "");
  legacyWorktreeDir = Option.String("--legacy-worktree-dir", "");

  async execute() {
    const { cleanupLegacyWorktree } = await import("../../commands/wave-issue-state.ts");
    this.context.stdout.write(JSON.stringify(cleanupLegacyWorktree({ repo: this.repo, legacyWorktreeDir: this.legacyWorktreeDir })));
    return 0;
  }
}

export class WaveIssueCleanupWorktreeCommand extends Command {
  static paths = [["wave-issue", "cleanup-worktree"]];
  repo = Option.String("--repo", "");
  worktreeDir = Option.String("--worktree-dir", "");

  async execute() {
    const { cleanupWaveIssueWorktree } = await import("../../commands/wave-issue-state.ts");
    this.context.stdout.write(JSON.stringify(cleanupWaveIssueWorktree({ repo: this.repo, worktreeDir: this.worktreeDir })));
    return 0;
  }
}

export class WaveIssueSetupWorktreeCommand extends Command {
  static paths = [["wave-issue", "setup-worktree"]];
  repo = Option.String("--repo", "");
  branch = Option.String("--branch", "");
  worktreeDir = Option.String("--worktree-dir", "");

  async execute() {
    const { setupWaveIssueWorktree } = await import("../../commands/wave-issue-state.ts");
    this.context.stdout.write(JSON.stringify(setupWaveIssueWorktree({ repo: this.repo, branch: this.branch, worktreeDir: this.worktreeDir })));
    return 0;
  }
}

export class WaveIssueEnsureToolchainCommand extends Command {
  static paths = [["wave-issue", "ensure-toolchain"]];
  repo = Option.String("--repo", "");
  worktreeDir = Option.String("--worktree-dir", "");

  async execute() {
    const { ensureWorktreeToolchain } = await import("../../commands/wave-issue-state.ts");
    this.context.stdout.write(JSON.stringify(ensureWorktreeToolchain({ repo: this.repo, worktreeDir: this.worktreeDir })));
    return 0;
  }
}

export class WaveIssueResolveMaxReviewAttemptsCommand extends Command {
  static paths = [["wave-issue", "resolve-max-review-attempts"]];
  maxReviewAttempts = Option.String("--max-review-attempts", "");

  async execute() {
    const { resolveMaxReviewAttemptsWithInit } = await import("../../commands/wave-issue-state.ts");
    this.context.stdout.write(JSON.stringify(resolveMaxReviewAttemptsWithInit(this.maxReviewAttempts)));
    return 0;
  }
}

export class WaveIssueResetStaleBranchCommand extends Command {
  static paths = [["wave-issue", "reset-stale-branch"]];
  worktreeDir = Option.String("--worktree-dir", "");

  async execute() {
    const { resetStaleBranch } = await import("../../commands/wave-issue-state.ts");
    this.context.stdout.write(JSON.stringify(resetStaleBranch({ worktreeDir: this.worktreeDir })));
    return 0;
  }
}

export class WaveIssueNextReviewAttemptCommand extends Command {
  static paths = [["wave-issue", "next-review-attempt"]];
  attempt = Option.String("--attempt", "0");

  async execute() {
    const { nextReviewAttempt } = await import("../../commands/wave-issue-state.ts");
    this.context.stdout.write(nextReviewAttempt(this.attempt));
    return 0;
  }
}

export class WaveIssueShouldRetryReviewCommand extends Command {
  static paths = [["wave-issue", "should-retry-review"]];
  reviewVerdict = Option.String("--review-verdict", "");
  attempt = Option.String("--attempt", "0");
  maxAttempts = Option.String("--max-attempts", "3");

  async execute() {
    const { shouldRetryReview } = await import("../../commands/wave-issue-state.ts");
    this.context.stdout.write(shouldRetryReview({ reviewVerdict: this.reviewVerdict, attempt: this.attempt, maxAttempts: this.maxAttempts }));
    return 0;
  }
}

export class WaveIssueSendReviewMessageCommand extends Command {
  static paths = [["wave-issue", "send-review-message"]];
  verdict = Option.String("--verdict", "");
  issue = Option.String("--issue", "");
  issueTitle = Option.String("--issue-title", { required: false });
  issueTitleB64 = Option.String("--issue-title-b64", { required: false });
  agentSessionId = Option.String("--agent-session-id", "");

  async execute() {
    const { sendReviewMessage } = await import("../../commands/review-messenger.ts");
    const title = resolveB64OrRaw(this.issueTitle, this.issueTitleB64, "issue-title");
    this.context.stdout.write(JSON.stringify(sendReviewMessage({ verdictRaw: this.verdict, issueNumber: this.issue, issueTitle: title, agentSessionId: this.agentSessionId })));
    return 0;
  }
}

export class WaveIssueCommitLocalCommand extends Command {
  static paths = [["wave-issue", "commit-local"]];
  worktreeDir = Option.String("--worktree-dir", "");
  repo = Option.String("--repo", "");
  issueNumber = Option.String("--issue-number", "");
  issueTitle = Option.String("--issue-title", { required: false });
  issueTitleB64 = Option.String("--issue-title-b64", { required: false });
  runId = Option.String("--run-id", "");

  async execute() {
    const { execFileSync } = await import("node:child_process");
    const { existsSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const opsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    if (!this.worktreeDir || !existsSync(this.worktreeDir)) {
      throw new Error(`commit-local: worktree directory does not exist: ${this.worktreeDir}`);
    }
    const gitFile = join(this.worktreeDir, ".git");
    if (!existsSync(gitFile)) {
      throw new Error(`commit-local: worktree is not a git repository (missing .git): ${this.worktreeDir}`);
    }
    const title = resolveB64OrRaw(this.issueTitle, this.issueTitleB64, "issue-title");
    execFileSync(join(opsRoot, "scripts", "commit_helper.sh"), [
      "--issue-number", this.issueNumber,
      "--title", title,
      "--run-id", this.runId,
    ], {
      cwd: this.worktreeDir,
      encoding: "utf8",
      stdio: "pipe",
    });
    this.context.stdout.write("committed");
    return 0;
  }
}

export class WaveIssueImplResultCommand extends Command {
  static paths = [["wave-issue", "impl-result"]];
  issue = Option.String("--issue", "");
  branch = Option.String("--branch", "");
  worktreeDir = Option.String("--worktree-dir", "");
  reviewFailed = Option.String("--review-failed", "false");
  reviewNotes = Option.String("--review-notes", { required: false });
  reviewNotesB64 = Option.String("--review-notes-b64", { required: false });
  disposition = Option.String("--disposition", "");
  decisionConfidence = Option.String("--decision-confidence", "");
  decisionEvidence = Option.String("--decision-evidence", "");
  zeroDeltaRetry = Option.String("--zero-delta-retry", "");
  zeroDeltaRetryCount = Option.String("--zero-delta-retry-count", "");
  merged = Option.String("--merged", "false");
  reviewEvidencePath = Option.String("--review-evidence-path", "");

  async execute() {
    const { buildImplResult } = await import("../../commands/wave-issue-state.ts");
    const rn = resolveB64OrRaw(this.reviewNotes, this.reviewNotesB64, "review-notes");
    const out = buildImplResult({
      issueNumber: this.issue,
      branch: this.branch,
      worktreeDir: this.worktreeDir,
      reviewFailed: this.reviewFailed === "true",
      reviewNotes: rn,
      disposition: this.disposition,
      decisionConfidence: this.decisionConfidence,
      decisionEvidence: this.decisionEvidence,
      zeroDeltaRetry: this.zeroDeltaRetry,
      zeroDeltaRetryCount: this.zeroDeltaRetryCount,
      merged: this.merged === "true",
      reviewEvidencePath: this.reviewEvidencePath,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class WaveIssueBuildApprovedResultCommand extends Command {
  static paths = [["wave-issue", "build-approved-result"]];
  issue = Option.String("--issue", "");
  branch = Option.String("--branch", "");
  worktreeDir = Option.String("--worktree-dir", "");
  reviewAttempt = Option.String("--review-attempt", "");
  maxReviewAttempts = Option.String("--max-review-attempts", "");
  reviewNotes = Option.String("--review-notes", { required: false });
  reviewNotesB64 = Option.String("--review-notes-b64", { required: false });
  zeroDeltaRetry = Option.String("--zero-delta-retry", "");
  zeroDeltaRetryCount = Option.String("--zero-delta-retry-count", "");
  reviewEvidencePath = Option.String("--review-evidence-path", "");

  async execute() {
    const { buildApprovedImplResult } = await import("../../commands/wave-issue-state.ts");
    const reviewNotes = resolveB64OrRaw(this.reviewNotes, this.reviewNotesB64, "review-notes");
    this.context.stdout.write(JSON.stringify(buildApprovedImplResult({
      issueNumber: this.issue,
      branch: this.branch,
      worktreeDir: this.worktreeDir,
      reviewAttempt: this.reviewAttempt,
      maxReviewAttempts: this.maxReviewAttempts,
      reviewNotes,
      reviewEvidencePath: this.reviewEvidencePath,
      zeroDeltaRetry: this.zeroDeltaRetry,
      zeroDeltaRetryCount: this.zeroDeltaRetryCount,
    })));
    return 0;
  }
}

export class WaveIssueBuildFailedResultCommand extends Command {
  static paths = [["wave-issue", "build-failed-result"]];
  issue = Option.String("--issue", "");
  branch = Option.String("--branch", "");
  worktreeDir = Option.String("--worktree-dir", "");
  reviewAttempt = Option.String("--review-attempt", "");
  maxReviewAttempts = Option.String("--max-review-attempts", "");
  reviewNotes = Option.String("--review-notes", { required: false });
  reviewNotesB64 = Option.String("--review-notes-b64", { required: false });
  zeroDeltaRetry = Option.String("--zero-delta-retry", "");
  zeroDeltaRetryCount = Option.String("--zero-delta-retry-count", "");
  reviewEvidencePath = Option.String("--review-evidence-path", "");

  async execute() {
    const { buildFailedImplResult } = await import("../../commands/wave-issue-state.ts");
    const reviewNotes = resolveB64OrRaw(this.reviewNotes, this.reviewNotesB64, "review-notes");
    this.context.stdout.write(JSON.stringify(buildFailedImplResult({
      issueNumber: this.issue,
      branch: this.branch,
      worktreeDir: this.worktreeDir,
      reviewAttempt: this.reviewAttempt,
      maxReviewAttempts: this.maxReviewAttempts,
      reviewNotes,
      reviewEvidencePath: this.reviewEvidencePath,
      zeroDeltaRetry: this.zeroDeltaRetry,
      zeroDeltaRetryCount: this.zeroDeltaRetryCount,
    })));
    return 0;
  }
}

export class WaveIssueInfraFailureResultCommand extends Command {
  static paths = [["wave-issue", "infra-failure-result"]];
  issue = Option.String("--issue", "");
  branch = Option.String("--branch", "");
  worktreeDir = Option.String("--worktree-dir", "");
  reason = Option.String("--reason", "");

  async execute() {
    const { buildInfraFailureImplResult } = await import("../../commands/wave-issue-state.ts");
    this.context.stdout.write(JSON.stringify(buildInfraFailureImplResult({
      issueNumber: this.issue,
      branch: this.branch,
      worktreeDir: this.worktreeDir,
      reason: this.reason,
    })));
    return 0;
  }
}

export class WaveIssueWriteReviewEvidenceCommand extends Command {
  static paths = [["wave-issue", "write-review-evidence"]];
  worktreeDir = Option.String("--worktree-dir", "");
  repo = Option.String("--repo", "");
  issue = Option.String("--issue", "");
  branch = Option.String("--branch", "");
  reviewQaCommand = Option.String("--review-qa-command", "");
  integrationCommand = Option.String("--integration-command", "");
  snapshotSha = Option.String("--snapshot-sha", "");
  builderNotesB64 = Option.String("--builder-notes-b64", "");

  async execute() {
    const { writeReviewEvidence } = await import("../../commands/wave-issue-state.ts");
    this.context.stdout.write(JSON.stringify(writeReviewEvidence({
      worktreeDir: this.worktreeDir,
      repo: this.repo,
      issueNumber: this.issue,
      branch: this.branch,
      reviewQaCommand: this.reviewQaCommand,
      integrationCommand: this.integrationCommand,
      snapshotSha: this.snapshotSha,
      builderNotesB64: this.builderNotesB64,
    })));
    return 0;
  }
}

export class WaveIssueBuildReviewContextCommand extends Command {
  static paths = [["wave-issue", "build-review-context"]];
  worktreeDir = Option.String("--worktree-dir", "");
  issue = Option.String("--issue", "");
  branch = Option.String("--branch", "");
  reviewEvidencePath = Option.String("--review-evidence-path", "");
  repoPolicyPath = Option.String("--repo-policy-path", "");
  skillPolicyPath = Option.String("--skill-policy-path", "");

  async execute() {
    const { buildAndPersistReviewerContextContract } = await import("../../commands/reviewer-context-contract.ts");
    this.context.stdout.write(JSON.stringify(buildAndPersistReviewerContextContract({ worktreeDir: this.worktreeDir, issueNumber: this.issue, branch: this.branch, reviewEvidencePath: this.reviewEvidencePath, repoPolicyPath: this.repoPolicyPath, skillPolicyPath: this.skillPolicyPath })));
    return 0;
  }
}

export class WaveIssueValidateReviewContextCommand extends Command {
  static paths = [["wave-issue", "validate-review-context"]];
  reviewContextPath = Option.String("--review-context-path", "");
  reviewContextSha256 = Option.String("--review-context-sha256", "");
  reviewContextValid = Option.String("--review-context-valid", "");
  reviewContextError = Option.String("--review-context-error", "");

  async execute() {
    const { validateReviewContextCompleteness } = await import("../../commands/reviewer-context-contract.ts");
    this.context.stdout.write(JSON.stringify(validateReviewContextCompleteness({ reviewContextPath: this.reviewContextPath, reviewContextSha256: this.reviewContextSha256, reviewContextValid: this.reviewContextValid, reviewContextError: this.reviewContextError })));
    return 0;
  }
}

export class WaveIssueResolveReviewRouteCommand extends Command {
  static paths = [["wave-issue", "resolve-review-route"]];
  verdict = Option.String("--verdict", "");
  reviewContextGatePass = Option.String("--review-context-gate-pass", "");
  reviewContextGateCode = Option.String("--review-context-gate-code", "");
  reviewContextError = Option.String("--review-context-error", "");
  reviewContextPath = Option.String("--review-context-path", "");

  async execute() {
    const { resolveReviewRoute } = await import("../../commands/wave-review-route.ts");
    this.context.stdout.write(JSON.stringify(resolveReviewRoute({ reviewVerdictRaw: this.verdict, reviewContextGatePass: this.reviewContextGatePass, reviewContextGateCode: this.reviewContextGateCode, reviewContextError: this.reviewContextError, reviewContextPath: this.reviewContextPath })));
    return 0;
  }
}

export class WaveIssueEmitReviewVerdictTelemetryCommand extends Command {
  static paths = [["wave-issue", "emit-review-verdict-telemetry"]];
  factoryId = Option.String("--factory-id", { required: true });
  runId = Option.String("--run-id", { required: true });
  issueNumber = Option.String("--issue", { required: true });
  milestone = Option.String("--milestone", { required: false, fallback: "" });
  verdict = Option.String("--verdict", { required: true });
  retryAttempt = Option.String("--retry-attempt", { required: true });
  maxReviewAttempts = Option.String("--max-review-attempts", { required: true });
  issueLabels = Option.String("--issue-labels", { required: false, fallback: "" });
  runsDir = Option.String("--runs-dir", { required: false, fallback: "" });

  async execute() {
    const { emitReviewVerdictTelemetry } = await import("../../commands/wave-issue-review-telemetry.ts");
    const out = await emitReviewVerdictTelemetry({
      factoryId: this.factoryId,
      runId: this.runId,
      issueNumber: Number(this.issueNumber),
      milestone: this.milestone,
      verdictRaw: this.verdict,
      retryAttempt: Number(this.retryAttempt),
      maxReviewAttempts: Number(this.maxReviewAttempts),
      issueLabels: this.issueLabels
        ? parseCsvOrJsonArray(this.issueLabels)
        : [],
      runsDir: this.runsDir,
    });
    writeJsonLine(this.context.stdout, out);
    return 0;
  }
}

export class WaveIssueSnapshotHeadCommand extends Command {
  static paths = [["wave-issue", "snapshot-head"]];
  worktreeDir = Option.String("--worktree-dir", "");
  existingSnapshot = Option.String("--existing-snapshot", "");

  async execute() {
    const { snapshotBranchHead } = await import("../../commands/wave-issue-state.ts");
    this.context.stdout.write(JSON.stringify(snapshotBranchHead({ worktreeDir: this.worktreeDir, existingSnapshot: this.existingSnapshot })));
    return 0;
  }
}

export const waveIssueCommands = [
  WaveIssueExtractCommand,
  WaveIssueFetchBodyCommand,
  WaveIssueEstimateComplexityCommand,
  WaveIssueInitCommand,
  WaveIssueInspectExistingCommand,
  WaveIssueInspectChangesCommand,
  WaveIssueResolveModeCommand,
  WaveIssueDecideExistingReuseWithNotesCommand,
  WaveIssueSetIssueContextCommand,
  WaveIssueCleanupLegacyCommand,
  WaveIssueCleanupWorktreeCommand,
  WaveIssueSetupWorktreeCommand,
  WaveIssueEnsureToolchainCommand,
  WaveIssueResolveMaxReviewAttemptsCommand,
  WaveIssueResetStaleBranchCommand,
  WaveIssueNextReviewAttemptCommand,
  WaveIssueShouldRetryReviewCommand,
  WaveIssueSendReviewMessageCommand,
  WaveIssueCommitLocalCommand,
  WaveIssueImplResultCommand,
  WaveIssueBuildApprovedResultCommand,
  WaveIssueBuildFailedResultCommand,
  WaveIssueInfraFailureResultCommand,
  WaveIssueWriteReviewEvidenceCommand,
  WaveIssueBuildReviewContextCommand,
  WaveIssueValidateReviewContextCommand,
  WaveIssueResolveReviewRouteCommand,
  WaveIssueEmitReviewVerdictTelemetryCommand,
  WaveIssueSnapshotHeadCommand,
];
