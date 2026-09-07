import { Command, Option } from "clipanion";

import { resolveJsonPayload } from "../helpers.ts";

async function resolveRepoOrExit(command, rawRepo = "") {
  try {
    const { resolveGhRepo } = await import("../../commands/common-resolve-gh-repo.ts");
    return resolveGhRepo(rawRepo);
  } catch (error) {
    command.context.stderr.write(String(error?.message || error) + "\n");
    return "";
  }
}

export class GoalHardPlanAttachCommand extends Command {
  static paths = [["goal", "hard-plan", "attach"]];
  repo = Option.String("--repo", "");
  repoRoot = Option.String("--repo-root", ".");
  goal = Option.String("--goal", "");
  planId = Option.String("--plan-id", "");
  summary = Option.String("--summary", "");
  summaryPath = Option.String("--summary-path", { required: false });
  artifactRefs = Option.String("--artifact-refs", { required: false });
  artifactRefsB64 = Option.String("--artifact-refs-b64", { required: false });
  artifactRefsPath = Option.String("--artifact-refs-path", { required: false });
  planMetadata = Option.String("--plan-metadata", { required: false });
  planMetadataB64 = Option.String("--plan-metadata-b64", { required: false });
  planMetadataPath = Option.String("--plan-metadata-path", { required: false });
  attachedBy = Option.String("--attached-by", "");
  factoryId = Option.String("--factory-id", "mothership");
  runId = Option.String("--run-id", "");
  pipeline = Option.String("--pipeline", "goal_run");
  nodeId = Option.String("--node-id", "goal_hard_plan_attach");
  targetRepo = Option.String("--target-repo", "");
  controlPlaneRepo = Option.String("--control-plane-repo", "");
  holdForHumanReview = Option.String("--hold-for-human-review", "true");

  async execute() {
    const { attachGoalHardPlanPacket } = await import("../../commands/goal-hard-plan-packet.ts");
    const repo = await resolveRepoOrExit(this, this.repo);
    if (!repo) return 2;

    let artifactRefsRaw = "";
    let planMetadataRaw = "";
    try {
      artifactRefsRaw = await resolveJsonPayload({
        flag: this.artifactRefs,
        flagB64: this.artifactRefsB64,
        flagName: "artifact-refs",
        allowStdin: false,
      }) || "";
      planMetadataRaw = await resolveJsonPayload({
        flag: this.planMetadata,
        flagB64: this.planMetadataB64,
        flagName: "plan-metadata",
        allowStdin: false,
      }) || "";
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }

    try {
      const out = attachGoalHardPlanPacket({
        repoRoot: this.repoRoot,
        repo,
        goalNumber: this.goal,
        planId: this.planId,
        summary: this.summary,
        summaryPath: this.summaryPath || "",
        artifactRefsRaw,
        artifactRefsPath: this.artifactRefsPath || "",
        planMetadataRaw,
        planMetadataPath: this.planMetadataPath || "",
        attachedBy: this.attachedBy,
        factoryId: this.factoryId,
        runId: this.runId,
        pipeline: this.pipeline,
        nodeId: this.nodeId,
        targetRepo: this.targetRepo,
        controlPlaneRepo: this.controlPlaneRepo,
        holdForHumanReview: String(this.holdForHumanReview || "").trim().toLowerCase() !== "false",
      });
      this.context.stdout.write(JSON.stringify(out));
      return out.ok ? 0 : 1;
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 1;
    }
  }
}

export class GoalHardPlanInspectCommand extends Command {
  static paths = [["goal", "hard-plan", "inspect"]];
  repoRoot = Option.String("--repo-root", ".");
  goal = Option.String("--goal", "");
  factoryId = Option.String("--factory-id", "mothership");

  async execute() {
    const { inspectGoalHardPlanPacketAttachment } = await import("../../commands/goal-hard-plan-packet.ts");
    const out = inspectGoalHardPlanPacketAttachment({
      repoRoot: this.repoRoot,
      goalNumber: this.goal,
      factoryId: this.factoryId,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export const goalHardPlanCommands = [
  GoalHardPlanAttachCommand,
  GoalHardPlanInspectCommand,
];
