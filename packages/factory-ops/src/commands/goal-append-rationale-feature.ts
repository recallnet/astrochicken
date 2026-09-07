import { appendRationaleFeature } from "../lib/goal-rationale-doc.ts";

export function appendGoalRationaleFeature({
  approvedFeaturesRaw = "",
  goalIssueRaw = "",
  goalIssueNumber = "",
  executionPath = "",
  understandingRisk = "",
  rationaleRequired = "",
  classificationSignalsRaw = "",
  classificationSignals = null,
} = {}) {
  return appendRationaleFeature({
    approvedFeaturesRaw,
    goalIssueRaw: goalIssueRaw || JSON.stringify({
      number: Number.parseInt(String(goalIssueNumber || ""), 10) || 0,
      title: `Goal ${goalIssueNumber}`,
    }),
    understandingRisk,
    rationaleRequired,
    executionPath,
    classificationSignalsRaw,
    classificationSignals,
  });
}
