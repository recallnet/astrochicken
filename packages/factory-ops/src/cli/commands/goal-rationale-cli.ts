import { Command, Option } from "clipanion";

import { resolveJsonPayload } from "../helpers.ts";

export class GoalAppendRationaleFeatureCommand extends Command {
  static paths = [["goal", "append-rationale-feature"]];
  approvedFeatures = Option.String("--approved-features", { required: false });
  approvedFeaturesB64 = Option.String("--approved-features-b64", { required: false });
  goalIssue = Option.String("--goal-issue", { required: false });
  goalIssueB64 = Option.String("--goal-issue-b64", { required: false });
  goalIssueNumber = Option.String("--goal-issue-number", "");
  executionPath = Option.String("--execution-path", "");
  understandingRisk = Option.String("--understanding-risk", "");
  rationaleRequired = Option.String("--rationale-required", "");
  classificationSignals = Option.String("--classification-signals", { required: false });
  classificationSignalsB64 = Option.String("--classification-signals-b64", { required: false });

  async execute() {
    const { appendGoalRationaleFeature } = await import("../../commands/goal-append-rationale-feature.ts");
    let approvedFeaturesRaw = "";
    let goalIssueRaw = "";
    let classificationSignalsRaw = "";
    try {
      approvedFeaturesRaw = await resolveJsonPayload({
        flag: this.approvedFeatures,
        flagB64: this.approvedFeaturesB64,
        flagName: "approved-features",
        allowStdin: false,
      }) || "";
      goalIssueRaw = await resolveJsonPayload({
        flag: this.goalIssue,
        flagB64: this.goalIssueB64,
        flagName: "goal-issue",
        allowStdin: false,
      }) || "";
      classificationSignalsRaw = await resolveJsonPayload({
        flag: this.classificationSignals,
        flagB64: this.classificationSignalsB64,
        flagName: "classification-signals",
        allowStdin: false,
      }) || "";
    } catch (error) {
      this.context.stderr.write(String(error?.message || error) + "\n");
      return 2;
    }

    const { parseJson } = await import("../../lib/cli-helpers.ts");
    const parsedClassificationSignals = parseJson(classificationSignalsRaw || "", null);
    const out = appendGoalRationaleFeature({
      approvedFeaturesRaw,
      goalIssueRaw,
      goalIssueNumber: this.goalIssueNumber,
      executionPath: this.executionPath,
      understandingRisk: this.understandingRisk,
      rationaleRequired: this.rationaleRequired,
      classificationSignalsRaw,
      classificationSignals: parsedClassificationSignals,
    });
    this.context.stdout.write(JSON.stringify(out));
    return 0;
  }
}

export const goalRationaleCommands = [
  GoalAppendRationaleFeatureCommand,
];
