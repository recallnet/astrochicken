import { Command, Option } from "clipanion";

import { resolveB64OrRaw, resolveJsonPayload } from "../helpers.ts";

export class BrainstormNextIssueCommand extends Command {
  static paths = [["brainstorm", "next-issue"]];

  repo = Option.String("--repo", "");
  label = Option.String("--label", "brainstorm");
  factoryId = Option.String("--factory-id", "");
  rootDir = Option.String("--root-dir", ".");

  async execute() {
    const { nextBrainstormIssue } = await import("../../commands/brainstorm-next-issue.ts");
    try {
      const out = nextBrainstormIssue({
        repo: this.repo,
        label: this.label,
        factoryId: this.factoryId,
        rootDir: this.rootDir,
      });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      return 2;
    }
  }
}

export class BrainstormLoadContextCommand extends Command {
  static paths = [["brainstorm", "load-context"]];

  factoryId = Option.String("--factory-id", "");
  rootDir = Option.String("--root-dir", ".");
  brainstormIssueNumber = Option.String("--brainstorm-issue-number", "");
  brainstormIssueBody = Option.String("--brainstorm-issue-body", { required: false });
  brainstormIssueBodyB64 = Option.String("--brainstorm-issue-body-b64", { required: false });
  intentStack = Option.String("--intent-stack", { required: false });
  intentStackB64 = Option.String("--intent-stack-b64", { required: false });
  shippedGoalsSinceLast = Option.String("--shipped-goals-since-last", { required: false });
  shippedGoalsSinceLastB64 = Option.String("--shipped-goals-since-last-b64", { required: false });
  scenarioHoldouts = Option.String("--scenario-holdouts", { required: false });
  scenarioHoldoutsB64 = Option.String("--scenario-holdouts-b64", { required: false });
  openBacklogSummary = Option.String("--open-backlog-summary", { required: false });
  openBacklogSummaryB64 = Option.String("--open-backlog-summary-b64", { required: false });

  async execute() {
    const { loadBrainstormContext } = await import("../../commands/brainstorm-load-context.ts");
    try {
      const out = loadBrainstormContext({
        factoryId: this.factoryId,
        rootDir: this.rootDir,
        brainstormIssueNumber: this.brainstormIssueNumber,
        brainstormIssueBody: resolveB64OrRaw(this.brainstormIssueBody, this.brainstormIssueBodyB64, "brainstorm-issue-body"),
        intentStackRaw: resolveB64OrRaw(this.intentStack, this.intentStackB64, "intent-stack"),
        shippedGoalsSinceLastRaw: resolveB64OrRaw(this.shippedGoalsSinceLast, this.shippedGoalsSinceLastB64, "shipped-goals-since-last"),
        scenarioHoldoutsRaw: resolveB64OrRaw(this.scenarioHoldouts, this.scenarioHoldoutsB64, "scenario-holdouts"),
        openBacklogSummary: resolveB64OrRaw(this.openBacklogSummary, this.openBacklogSummaryB64, "open-backlog-summary"),
      });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      return 2;
    }
  }
}

export class BrainstormIntakeContextCommand extends Command {
  static paths = [["brainstorm", "intake-context"]];

  repo = Option.String("--repo", "");
  factoryId = Option.String("--factory-id", "");
  rootDir = Option.String("--root-dir", ".");
  intakeJson = Option.String("--intake-json", "");

  async execute() {
    const { buildBrainstormContextFromShellIntake } = await import("../../commands/brainstorm-intake-context.ts");
    const out = buildBrainstormContextFromShellIntake({
      repo: this.repo,
      factoryId: this.factoryId,
      rootDir: this.rootDir,
      intakeJson: this.intakeJson,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export class BrainstormBumpRoundCommand extends Command {
  static paths = [["brainstorm", "bump-round"]];

  round = Option.String("--round", "0");
  maxRounds = Option.String("--max-rounds", "10");

  async execute() {
    const { bumpBrainstormRound } = await import("../../commands/brainstorm-bump-round.ts");
    try {
      const out = bumpBrainstormRound({
        round: this.round,
        maxRounds: this.maxRounds,
      });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      return 2;
    }
  }
}

export class BrainstormCheckOutputCommand extends Command {
  static paths = [["brainstorm", "check-output"]];

  agentOutput = Option.String("--agent-output", { required: false });
  agentOutputB64 = Option.String("--agent-output-b64", { required: false });
  source = Option.String("--source", "unknown");

  async execute() {
    const { checkBrainstormOutput } = await import("../../commands/brainstorm-check-output.ts");
    try {
      const out = checkBrainstormOutput({
        agentOutput: resolveB64OrRaw(this.agentOutput, this.agentOutputB64, "agent-output"),
        source: this.source,
      });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      return 2;
    }
  }
}

export class BrainstormCreateGoalCommand extends Command {
  static paths = [["brainstorm", "create-goal"]];

  repo = Option.String("--repo", "");
  destinationsJson = Option.String("--destinations-json", { required: false });
  destinationsJsonB64 = Option.String("--destinations-json-b64", { required: false });
  brainstormIssueNumber = Option.String("--brainstorm-issue-number", "");
  seedPrompt = Option.String("--seed-prompt", { required: false });
  seedPromptB64 = Option.String("--seed-prompt-b64", { required: false });
  finalRound = Option.String("--final-round", "");
  finalReport = Option.String("--final-report", { required: false });
  finalReportB64 = Option.String("--final-report-b64", { required: false });

  async execute() {
    const { createBrainstormGoalIssue } = await import("../../commands/brainstorm-create-goal.ts");
    try {
      const out = createBrainstormGoalIssue({
        repo: this.repo,
        destinationsJson: resolveB64OrRaw(this.destinationsJson, this.destinationsJsonB64, "destinations-json"),
        brainstormIssueNumber: this.brainstormIssueNumber,
        seedPrompt: resolveB64OrRaw(this.seedPrompt, this.seedPromptB64, "seed-prompt"),
        finalRound: this.finalRound,
        finalReportRaw: resolveB64OrRaw(this.finalReport, this.finalReportB64, "final-report"),
      });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      return 2;
    }
  }
}

export class BrainstormCloseIssueCommand extends Command {
  static paths = [["brainstorm", "close-issue"]];

  repo = Option.String("--repo", "");
  brainstormIssueNumber = Option.String("--brainstorm-issue-number", "");
  factoryId = Option.String("--factory-id", "");
  rootDir = Option.String("--root-dir", ".");
  nextCursor = Option.String("--next-cursor", { required: false });
  nextCursorB64 = Option.String("--next-cursor-b64", { required: false });

  async execute() {
    const { closeBrainstormIssue } = await import("../../commands/brainstorm-close-issue.ts");
    try {
      const nextCursorPayload = await resolveJsonPayload({
        flag: this.nextCursor,
        flagB64: this.nextCursorB64,
        flagName: "next-cursor",
        allowStdin: false,
      });
      const out = closeBrainstormIssue({
        repo: this.repo,
        brainstormIssueNumber: this.brainstormIssueNumber,
        factoryId: this.factoryId,
        rootDir: this.rootDir,
        nextCursorRaw: nextCursorPayload,
      });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      return 2;
    }
  }
}

export class BrainstormPostTurnCommentCommand extends Command {
  static paths = [["brainstorm", "post-turn-comment"]];

  repo = Option.String("--repo", "");
  issueNumber = Option.String("--issue-number", "");
  source = Option.String("--source", "unknown");
  round = Option.String("--round", "0");
  agentOutput = Option.String("--agent-output", { required: false });
  agentOutputB64 = Option.String("--agent-output-b64", { required: false });
  isFinal = Option.String("--is-final", "false");
  runId = Option.String("--run-id", { required: false });
  langfuseProjectUrl = Option.String("--langfuse-project-url", { required: false });

  async execute() {
    const { postBrainstormTurnComment } = await import("../../commands/brainstorm-post-turn-comment.ts");
    try {
      const out = postBrainstormTurnComment({
        repo: this.repo,
        issueNumber: this.issueNumber,
        source: this.source,
        round: this.round,
        agentOutput: resolveB64OrRaw(this.agentOutput, this.agentOutputB64, "agent-output"),
        isFinal: this.isFinal,
        runId: this.runId || "",
        langfuseProjectUrl: this.langfuseProjectUrl || "",
      });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      return 2;
    }
  }
}

export class BrainstormLoopGuardCommand extends Command {
  static paths = [["brainstorm", "loop-guard"]];

  source = Option.String("--source", "unknown");
  conversationalOutput = Option.String("--conversational-output", { required: false });
  conversationalOutputB64 = Option.String("--conversational-output-b64", { required: false });
  previousEmptyBlueCount = Option.String("--previous-empty-blue-count", "0");
  emptyBlueThreshold = Option.String("--empty-blue-threshold", "2");

  async execute() {
    const { applyBrainstormLoopGuard } = await import("../../commands/brainstorm-loop-guard.ts");
    try {
      const out = applyBrainstormLoopGuard({
        source: this.source,
        conversationalOutput: resolveB64OrRaw(this.conversationalOutput, this.conversationalOutputB64, "conversational-output") ?? "",
        previousEmptyBlueCount: this.previousEmptyBlueCount,
        emptyBlueThreshold: this.emptyBlueThreshold,
      });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      this.context.stderr.write(`${String(error?.message || error)}\n`);
      return 2;
    }
  }
}

export const brainstormCommands = [
  BrainstormNextIssueCommand,
  BrainstormLoadContextCommand,
  BrainstormIntakeContextCommand,
  BrainstormBumpRoundCommand,
  BrainstormCheckOutputCommand,
  BrainstormLoopGuardCommand,
  BrainstormPostTurnCommentCommand,
  BrainstormCreateGoalCommand,
  BrainstormCloseIssueCommand,
];
