import { checkGoalAlreadyDecomposedWithPackets } from "./goal-check-decomposed.ts";
import { trim } from "../lib/cli-helpers.ts";

export function guardDuplicateGoalDecomposition({
  repo = "",
  repoRoot = "",
  issueNumber = "",
  factoryId = "mothership",
  runId = "",
  pipeline = "goal_run",
  nodeId = "duplicate_decompose_guard",
  listSubIssuesFn,
} = {}) {
  const normalizedIssueNumber = trim(issueNumber);
  if (!normalizedIssueNumber) {
    throw new Error("missing_goal_issue_number");
  }

  const alreadyDecomposed = checkGoalAlreadyDecomposedWithPackets({
    repo: trim(repo),
    issueNumber: normalizedIssueNumber,
    repoRoot: trim(repoRoot),
    factoryId: trim(factoryId) || "mothership",
    listSubIssuesFn,
  });

  if (alreadyDecomposed === "true") {
    const errorParts = [
      `goal_already_decomposed:${normalizedIssueNumber}`,
      "operator_reset_required",
      "use_hatch-ops_goal_admission-reset",
      `factory_id=${trim(factoryId)}`,
      `run_id=${trim(runId)}`,
      `pipeline=${trim(pipeline)}`,
      `node_id=${trim(nodeId)}`,
    ];
    throw new Error(errorParts.join(":"));
  }

  return {
    ok: true,
    goal_issue_number: normalizedIssueNumber,
    already_decomposed: "false",
    factory_id: trim(factoryId),
    run_id: trim(runId),
    pipeline: trim(pipeline),
    node_id: trim(nodeId),
  };
}
