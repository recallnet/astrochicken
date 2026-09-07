import { Command, Option } from "clipanion";

import { decodeBase64Utf8 } from "../helpers.ts";

// -- milestone resolve-goal-number --
export class MilestoneResolveGoalNumberCommand extends Command {
  static paths = [["milestone", "resolve-goal-number"]];
  milestoneTitle = Option.String("--milestone-title", "");

  async execute() {
    const { resolveGoalNumberFromMilestoneTitle } = await import("../../commands/milestone-resolve-goal-number.ts");
    const out = resolveGoalNumberFromMilestoneTitle(this.milestoneTitle);
    this.context.stdout.write(String(out));
    return 0;
  }
}

// -- milestone fetch-goal-issue --
export class MilestoneFetchGoalIssueCommand extends Command {
  static paths = [["milestone", "fetch-goal-issue"]];
  repo = Option.String("--repo", "");
  goalNumber = Option.String("--goal-number", "");

  async execute() {
    const { fetchGoalIssue } = await import("../../commands/milestone-fetch-goal-issue.ts");
    const out = fetchGoalIssue({ repo: this.repo, goalNumber: this.goalNumber });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- milestone next-issue --
export class MilestoneNextIssueCommand extends Command {
  static paths = [["milestone", "next-issue"]];
  repo = Option.String("--repo", ".");
  milestoneTitle = Option.String("--milestone-title", "");
  completedRaw = Option.String("--completed", "[]");
  processedRaw = Option.String("--processed", "[]");
  candidateLimit = Option.String("--candidate-limit", "3");

  async execute() {
    const { pickNextMilestoneIssueFromArgs } = await import("../../commands/milestone-next-issue.ts");
    const out = pickNextMilestoneIssueFromArgs({
      repo: this.repo,
      milestoneTitle: this.milestoneTitle,
      completedRaw: this.completedRaw,
      processedRaw: this.processedRaw,
      candidateLimit: Number(this.candidateLimit),
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- milestone accumulate --
export class MilestoneAccumulateCommand extends Command {
  static paths = [["milestone", "accumulate"]];
  implResultsRaw = Option.String("--impl-results", "[]");
  completedRaw = Option.String("--completed", "[]");
  processedRaw = Option.String("--processed", "[]");
  itemRaw = Option.String("--item", "{}");
  fallbackIssueNumber = Option.String("--issue-number", "");
  issueTitle = Option.String("--issue-title", { required: false });
  issueTitleB64 = Option.String("--issue-title-b64", { required: false });

  async execute() {
    const { accumulateMilestoneResult } = await import("../../commands/milestone-accumulate.ts");
    const fallbackIssueTitle = this.issueTitleB64 !== undefined
      ? decodeBase64Utf8(this.issueTitleB64)
      : (this.issueTitle ?? "");
    const out = accumulateMilestoneResult({
      implResultsRaw: this.implResultsRaw,
      completedRaw: this.completedRaw,
      processedRaw: this.processedRaw,
      itemRaw: this.itemRaw,
      fallbackIssueNumber: this.fallbackIssueNumber,
      fallbackIssueTitle,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class MilestoneAccumulateBatchCommand extends Command {
  static paths = [["milestone", "accumulate-batch"]];
  implResultsRaw = Option.String("--impl-results", "[]");
  completedRaw = Option.String("--completed", "[]");
  processedRaw = Option.String("--processed", "[]");
  itemsRaw = Option.String("--items", "[]");

  async execute() {
    const { accumulateMilestoneBatchResults } = await import("../../commands/milestone-accumulate.ts");
    const out = accumulateMilestoneBatchResults({
      implResultsRaw: this.implResultsRaw,
      completedRaw: this.completedRaw,
      processedRaw: this.processedRaw,
      itemsRaw: this.itemsRaw,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- milestone postmortem --
export class MilestonePostmortemCommand extends Command {
  static paths = [["milestone", "postmortem"]];
  repo = Option.String("--repo", ".");
  issue = Option.String("--issue", "");
  branch = Option.String("--branch", "");
  reviewNotes = Option.String("--review-notes", { required: false });
  reviewNotesB64 = Option.String("--review-notes-b64", { required: false });
  worktreeDir = Option.String("--worktree-dir", "");
  reviewEvidencePath = Option.String("--review-evidence-path", "");

  async execute() {
    const { analyzeGiveUp } = await import("../../commands/milestone-postmortem.ts");
    const reviewNotes = this.reviewNotesB64 !== undefined
      ? decodeBase64Utf8(this.reviewNotesB64)
      : (this.reviewNotes ?? "");
    const out = analyzeGiveUp({
      repo: this.repo,
      issueNumber: this.issue,
      branch: this.branch,
      reviewNotes,
      worktreeDir: this.worktreeDir,
      reviewEvidencePath: this.reviewEvidencePath,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- milestone qa-infra-triage --
export class MilestoneQaInfraTriageCommand extends Command {
  static paths = [["milestone", "qa-infra-triage"]];
  repo = Option.String("--repo", ".");
  issue = Option.String("--issue", "");
  branch = Option.String("--branch", "");
  reviewEvidencePath = Option.String("--review-evidence-path", "");

  async execute() {
    const { triageQaInfrastructure } = await import("../../commands/milestone-qa-infra-triage.ts");
    const out = triageQaInfrastructure({
      repo: this.repo,
      issueNumber: this.issue,
      branch: this.branch,
      reviewEvidencePath: this.reviewEvidencePath,
    });
    this.context.stderr.write(
      `[milestone] qa_infra_triage ok=${out.ok ? "true" : "false"} issue=${out.issue_number || ""} scenario=${out.judge_context_scenario || ""} rerun_count=${out.qa_rerun_count || "0"} comment_posted=${out.comment_posted ? "true" : "false"} comment_post_error=${out.comment_post_error || ""}\n`,
    );
    this.context.stdout.write(JSON.stringify(out));
    return Number(out.exit_code || (out.ok ? 0 : 2));
  }
}

// -- milestone empty-branch-context --
export class MilestoneEmptyBranchContextCommand extends Command {
  static paths = [["milestone", "empty-branch-context"]];
  milestoneTitle = Option.String("--milestone-title", "");

  async execute() {
    const { emptyMilestoneBranchContext } = await import("../../commands/milestone-build-item.ts");
    const out = emptyMilestoneBranchContext({ milestoneTitle: this.milestoneTitle });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- milestone seed-state --
export class MilestoneSeedStateCommand extends Command {
  static paths = [["milestone", "seed-state"]];
  repo = Option.String("--repo", ".");
  milestoneTitle = Option.String("--milestone-title", "");
  runsDir = Option.String("--runs-dir", "");

  async execute() {
    const { seedMilestoneState } = await import("../../commands/milestone-seed-state.ts");
    const out = seedMilestoneState({
      milestoneTitle: this.milestoneTitle,
      runsDir: this.runsDir,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- milestone build-item --
export class MilestoneBuildItemCommand extends Command {
  static paths = [["milestone", "build-item"]];
  issueNumber = Option.String("--issue-number", "");
  issueTitle = Option.String("--issue-title", "");

  async execute() {
    const { buildMilestoneIssueItem } = await import("../../commands/milestone-build-item.ts");
    const out = buildMilestoneIssueItem({ issueNumber: this.issueNumber, issueTitle: this.issueTitle });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

// -- milestone build-parallel-context --
export class MilestoneBuildParallelContextCommand extends Command {
  static paths = [["milestone", "build-parallel-context"]];
  milestoneTitle = Option.String("--milestone-title", "");
  issueNumber = Option.String("--issue-number", "");

  async execute() {
    const { buildMilestoneParallelIssueContext } = await import("../../commands/milestone-build-item.ts");
    const out = buildMilestoneParallelIssueContext({
      milestoneTitle: this.milestoneTitle,
      issueNumber: this.issueNumber,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class MilestoneSweepEmptyCommand extends Command {
  static paths = [["milestone", "sweep-empty"]];
  repo = Option.String("--repo", "recallnet/astrochicken");

  async execute() {
    const { sweepEmptyMilestones } = await import("../../commands/milestone-sweep-empty.ts");
    const out = sweepEmptyMilestones({ repo: this.repo });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export const milestoneCommands = [
  MilestoneResolveGoalNumberCommand,
  MilestoneFetchGoalIssueCommand,
  MilestoneNextIssueCommand,
  MilestoneAccumulateCommand,
  MilestoneAccumulateBatchCommand,
  MilestonePostmortemCommand,
  MilestoneQaInfraTriageCommand,
  MilestoneEmptyBranchContextCommand,
  MilestoneSeedStateCommand,
  MilestoneBuildItemCommand,
  MilestoneBuildParallelContextCommand,
  MilestoneSweepEmptyCommand,
];
