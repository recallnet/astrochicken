import { Command, Option } from "clipanion";

import { resolveB64OrRaw, resolveJsonPayload } from "../helpers.ts";

async function resolveRepoOrExit(command, rawRepo = "") {
  try {
    const { resolveGhRepo } = await import("../../commands/common-resolve-gh-repo.ts");
    return resolveGhRepo(rawRepo);
  } catch (error) {
    command.context.stderr.write(String(error?.message || error) + "\n");
    return "";
  }
}

export class GoalPersistHardPlanArtifactCommand extends Command {
  static paths = [["goal", "persist-hard-plan-artifact"]];
  repoRoot = Option.String("--repo-root", ".");
  goalIssue = Option.String("--goal-issue", { required: false });
  goalIssueB64 = Option.String("--goal-issue-b64", { required: false });
  goalContext = Option.String("--goal-context", { required: false });
  goalContextB64 = Option.String("--goal-context-b64", { required: false });
  approvedFeatures = Option.String("--approved-features", { required: false });
  approvedFeaturesB64 = Option.String("--approved-features-b64", { required: false });
  factoryRequestGoalGraph = Option.String("--factory-request-goal-graph", { required: false });
  factoryRequestGoalGraphB64 = Option.String("--factory-request-goal-graph-b64", { required: false });
  reviewNotes = Option.String("--review-notes", "");
  reviewNotesB64 = Option.String("--review-notes-b64", { required: false });
  goalIssueNumber = Option.String("--goal-issue-number", "");
  factoryId = Option.String("--factory-id", "mothership");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "goal_hard_plan");
  nodeId = Option.String("--node-id", "persist_hard_plan_packet");
  targetRepo = Option.String("--target-repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");

  async execute() {
    const { persistHardPlanningArtifact } = await import("../../commands/goal-hard-planning.ts");

    let goalIssueRaw;
    let goalContextRaw;
    let approvedFeaturesRaw;
    let factoryRequestGoalGraphRaw;
    let reviewNotesRaw;
    try {
      goalIssueRaw = await resolveJsonPayload({
        flag: this.goalIssue,
        flagB64: this.goalIssueB64,
        flagName: "goal-issue",
        allowStdin: false,
      });
      goalContextRaw = await resolveJsonPayload({
        flag: this.goalContext,
        flagB64: this.goalContextB64,
        flagName: "goal-context",
        allowStdin: false,
      });
      approvedFeaturesRaw = await resolveJsonPayload({
        flag: this.approvedFeatures,
        flagB64: this.approvedFeaturesB64,
        flagName: "approved-features",
        allowStdin: false,
      });
      factoryRequestGoalGraphRaw = await resolveJsonPayload({
        flag: this.factoryRequestGoalGraph,
        flagB64: this.factoryRequestGoalGraphB64,
        flagName: "factory-request-goal-graph",
        allowStdin: false,
      });
      reviewNotesRaw = resolveB64OrRaw(this.reviewNotes, this.reviewNotesB64, "review-notes");
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }

    try {
      const out = persistHardPlanningArtifact({
        repoRoot: this.repoRoot,
        goalIssueNumber: this.goalIssueNumber,
        goalIssueRaw: goalIssueRaw || "",
        goalContextRaw: goalContextRaw || "",
        approvedFeaturesRaw: approvedFeaturesRaw || "[]",
        factoryRequestGoalGraphRaw: factoryRequestGoalGraphRaw || "",
        reviewNotes: reviewNotesRaw || "",
        factoryId: this.factoryId,
        runId: this.runId,
        pipeline: this.pipeline,
        nodeId: this.nodeId,
        targetRepo: this.targetRepo,
        controlPlaneRepo: this.controlPlaneRepo,
      });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 1;
    }
  }
}

export class GoalValidatePlanningArtifactCommand extends Command {
  static paths = [["goal", "validate-planning-artifact"]];
  packetPath = Option.String("--packet-path", "");

  async execute() {
    const { validatePlanningArtifact } = await import("../../commands/goal-hard-planning.ts");
    try {
      const out = validatePlanningArtifact({ packetPath: this.packetPath });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 1;
    }
  }
}

export class GoalAttachPlanningArtifactsCommand extends Command {
  static paths = [["goal", "attach-planning-artifacts"]];
  repo = Option.String("--repo", "");
  goalIssueNumber = Option.String("--goal-issue-number", "");
  planningArtifactPath = Option.String("--planning-artifact-path", "");
  planningPacketId = Option.String("--planning-packet-id", "");
  runId = Option.String("--run-id", "");
  summary = Option.String("--summary", "");

  async execute() {
    const { attachPlanningArtifacts } = await import("../../commands/goal-hard-planning.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;

    try {
      const out = attachPlanningArtifacts({
        repo,
        goalIssueNumber: this.goalIssueNumber,
        planningArtifactPath: this.planningArtifactPath,
        planningPacketId: this.planningPacketId,
        runId: this.runId,
        summary: this.summary,
      });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 1;
    }
  }
}

export class GoalMarkPlannedCommand extends Command {
  static paths = [["goal", "mark-planned"]];
  repoRoot = Option.String("--repo-root", ".");
  repo = Option.String("--repo", "");
  goalIssueNumber = Option.String("--goal-issue-number", "");
  goalExecutionPath = Option.String("--goal-execution-path", "");
  goalRoutingState = Option.String("--goal-routing-state", "{}");
  goalRoutingStateB64 = Option.String("--goal-routing-state-b64", { required: false });
  planningArtifactPath = Option.String("--planning-artifact-path", "");
  factoryId = Option.String("--factory-id", "mothership");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "goal_hard_plan");
  nodeId = Option.String("--node-id", "mark_planned");
  targetRepo = Option.String("--target-repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");

  async execute() {
    const { markGoalPlanned } = await import("../../commands/goal-hard-planning.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;

    let goalRoutingStateRaw = this.goalRoutingState;
    if (this.goalRoutingStateB64 !== undefined) {
      try {
        goalRoutingStateRaw = Buffer.from(this.goalRoutingStateB64, "base64").toString("utf8");
      } catch (error) {
        this.context.stderr.write(String(error?.message || error) + "\n");
        return 2;
      }
    }

    try {
      const out = markGoalPlanned({
        repoRoot: this.repoRoot,
        repo,
        goalIssueNumber: this.goalIssueNumber,
        goalExecutionPath: this.goalExecutionPath,
        goalRoutingStateRaw,
        planningArtifactPath: this.planningArtifactPath,
        factoryId: this.factoryId,
        runId: this.runId,
        pipeline: this.pipeline,
        nodeId: this.nodeId,
        targetRepo: this.targetRepo,
        controlPlaneRepo: this.controlPlaneRepo,
      });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 1;
    }
  }
}

export class GoalMaterializeApprovedPlanCommand extends Command {
  static paths = [["goal", "materialize-approved-plan"]];
  repoRoot = Option.String("--repo-root", ".");
  repo = Option.String("--repo", "");
  goalNumber = Option.String("--goal-number", "");
  planPacket = Option.String("--plan-packet", "");
  planningArtifactPath = Option.String("--planning-artifact-path", "");
  factoryId = Option.String("--factory-id", "mothership");
  runId = Option.String("--run-id", "");
  targetRepo = Option.String("--target-repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");

  async execute() {
    const { materializeApprovedHardPlan } = await import("../../commands/goal-hard-plan-materialize.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;

    try {
      const out = materializeApprovedHardPlan({
        repoRoot: this.repoRoot,
        repo,
        goalNumber: this.goalNumber,
        planPacketId: this.planPacket,
        planningArtifactPath: this.planningArtifactPath,
        factoryId: this.factoryId,
        runId: this.runId,
        targetRepo: this.targetRepo,
        controlPlaneRepo: this.controlPlaneRepo,
      });
      this.context.stdout.write(JSON.stringify(out));
      return 0;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 1;
    }
  }
}

export const goalHardPlanningCommands = [
  GoalPersistHardPlanArtifactCommand,
  GoalValidatePlanningArtifactCommand,
  GoalAttachPlanningArtifactsCommand,
  GoalMarkPlannedCommand,
  GoalMaterializeApprovedPlanCommand,
];
