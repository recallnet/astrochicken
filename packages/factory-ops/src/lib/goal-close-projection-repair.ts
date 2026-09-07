function trim(value = "") {
  return String(value || "").trim();
}

export function repairCanonicalGoalCloseProjection({
  goalNumber = "",
  readGoalIssueFn,
  projectionTarget,
} = {}) {
  const normalizedGoalNumber = trim(goalNumber);
  if (!normalizedGoalNumber) {
    return {
      closedGoal: false,
      skippedGoalClosureReason: "goal_close_projection_repair_unavailable",
    };
  }

  const goalIssue = typeof readGoalIssueFn === "function"
    ? readGoalIssueFn({ goalNumber: normalizedGoalNumber })
    : {};
  const goalState = trim(goalIssue?.state).toLowerCase();
  if (goalState === "closed") {
    return {
      closedGoal: true,
      skippedGoalClosureReason: "",
    };
  }

  // @context:integration !critical Canonical lifecycle now owns goal closure truth, but
  // the operator surface still lives on GitHub. When canonical state says closed and
  // GitHub still shows OPEN, repair the projection here instead of falsely reporting
  // success and leaving the visible goal stranded.
  const repairedClose = projectionTarget?.issueClose({
    number: normalizedGoalNumber,
    reason: "completed",
  });

  if (repairedClose?.ok) {
    return {
      closedGoal: true,
      skippedGoalClosureReason: "",
    };
  }

  return {
    closedGoal: false,
    skippedGoalClosureReason: "goal_close_projection_repair_failed",
  };
}
