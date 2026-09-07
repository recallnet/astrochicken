import { Command, Option } from "clipanion";

import { resolveB64OrRaw } from "../helpers.ts";

export class GoalScreenHumanBlockersCommand extends Command {
  static paths = [["goal", "screen-human-blockers"]];
  goalBody = Option.String("--goal-body", { required: false });
  goalBodyB64 = Option.String("--goal-body-b64", { required: false });
  async execute() {
    const { screenGoalForHumanBlockers } = await import("../../commands/goal-human-blocker-screen.ts");
    let body = "";
    try {
      body = resolveB64OrRaw(this.goalBody, this.goalBodyB64, "goal-body");
    } catch {
      body = "";
    }
    const result = screenGoalForHumanBlockers({ goalBody: body });
    this.context.stdout.write(JSON.stringify(result) + "\n");
    return 0;
  }
}

export class GoalLabelCreatedIssuesCommand extends Command {
  static paths = [["goal", "label-created-issues"]];
  repo = Option.String("--repo", { required: true });
  issueUrls = Option.String("--issue-urls", { required: false });
  async execute() {
    const { labelCreatedIssues } = await import("../../commands/goal-label-created-issues.ts");
    const result = labelCreatedIssues({
      repo: this.repo,
      issueUrls: this.issueUrls || "",
    });
    this.context.stdout.write(JSON.stringify(result) + "\n");
    return result.ok ? 0 : 1;
  }
}

export class GoalApplyFeatureBlockersCommand extends Command {
  static paths = [["goal", "apply-feature-blockers"]];
  repo = Option.String("--repo", { required: true });
  goalIssueNumber = Option.String("--goal-issue-number", { required: true });
  featureIssueMap = Option.String("--feature-issue-map", { required: false });
  featureIssueMapB64 = Option.String("--feature-issue-map-b64", { required: false });
  async execute() {
    const { applyFeatureBlockers } = await import("../../commands/goal-apply-feature-blockers.ts");
    let mapJson;
    try {
      mapJson = resolveB64OrRaw(this.featureIssueMap, this.featureIssueMapB64, "feature-issue-map");
    } catch {
      mapJson = "[]";
    }
    const result = applyFeatureBlockers({
      repo: this.repo,
      goalIssueNumber: Number(this.goalIssueNumber || 0),
      featureIssueMap: mapJson,
    });
    this.context.stdout.write(JSON.stringify(result) + "\n");
    return result.ok ? 0 : 1;
  }
}

export const goalBlockerCommands = [
  GoalScreenHumanBlockersCommand,
  GoalLabelCreatedIssuesCommand,
  GoalApplyFeatureBlockersCommand,
];
