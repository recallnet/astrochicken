import { Command, Option } from "clipanion";

import { parseBoolFlag } from "../helpers.ts";

export class ResearchApproveStageCommand extends Command {
  static paths = [["research", "approve-stage"]];
  hypothesisId = Option.String("--hypothesis-id", "");
  stage = Option.String("--stage", "");
  approved = Option.String("--approved", "");
  reviewerId = Option.String("--reviewer-id", "");
  reviewerNote = Option.String("--reviewer-note", "");
  approvalsDir = Option.String("--approvals-dir", ".hatch/research/approvals");

  async execute() {
    const { approveResearchStage } = await import("../../commands/research-approve-stage.ts");
    const out = approveResearchStage({
      hypothesisId: this.hypothesisId,
      stage: this.stage,
      approved: this.approved,
      reviewerId: this.reviewerId,
      reviewerNote: this.reviewerNote,
      approvalsDir: this.approvalsDir,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class ResearchSetStageLabelCommand extends Command {
  static paths = [["research", "set-stage-label"]];
  repo = Option.String("--repo", "");
  hypothesisIssue = Option.String("--hypothesis-issue", "");
  stage = Option.String("--stage", "");

  async execute() {
    const { setResearchStageLabel } = await import("../../commands/research-stage-label.ts");
    const out = setResearchStageLabel({
      repo: this.repo,
      hypothesisIssue: this.hypothesisIssue,
      stage: this.stage,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class ResearchSetApprovalLabelCommand extends Command {
  static paths = [["research", "set-approval-label"]];
  repo = Option.String("--repo", "");
  hypothesisIssue = Option.String("--hypothesis-issue", "");
  approved = Option.String("--approved", "");
  approvalContext = Option.String("--approval-context", "{}");

  async execute() {
    const { setResearchApprovalLabel } = await import("../../commands/research-stage-label.ts");
    let parsedContext = {};
    try {
      const raw = String(this.approvalContext || "{}").trim() || "{}";
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        parsedContext = parsed;
      } else {
        const out = {
          ok: false,
          code: "invalid_approval_context",
          error: "--approval-context must be a JSON object",
        };
        this.context.stdout.write(JSON.stringify(out));
        return 1;
      }
    } catch (error) {
      const out = {
        ok: false,
        code: "invalid_approval_context",
        error: String(error?.message || error || "invalid_approval_context"),
      };
      this.context.stdout.write(JSON.stringify(out));
      return 1;
    }

    const out = setResearchApprovalLabel({
      repo: this.repo,
      hypothesisIssue: this.hypothesisIssue,
      approved: this.approved,
      approvalContext: parsedContext,
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export class ResearchStatusCommand extends Command {
  static paths = [["research", "status"]];
  hypothesisId = Option.String("--hypothesis-id", "");
  runsDir = Option.String("--runs-dir", ".hatch/research/runs");
  repo = Option.String("--repo", "");
  hypothesisIssue = Option.String("--hypothesis-issue", "");
  runId = Option.String("--run-id", "");
  useGithub = Option.String("--use-github", "false");

  async execute() {
    const { researchStatus } = await import("../../commands/research-status.ts");
    const out = researchStatus({
      hypothesisId: this.hypothesisId,
      runsDir: this.runsDir,
      repo: this.repo,
      hypothesisIssue: this.hypothesisIssue,
      runId: this.runId,
      useGithub: parseBoolFlag(this.useGithub, false),
    });
    this.context.stdout.write(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
}

export const researchCommands = [
  ResearchApproveStageCommand,
  ResearchSetStageLabelCommand,
  ResearchSetApprovalLabelCommand,
  ResearchStatusCommand,
];
