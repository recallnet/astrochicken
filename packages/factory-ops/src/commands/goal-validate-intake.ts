import { trim, parseJson } from "../lib/cli-helpers.ts";
/**
 * goal-validate-intake.mjs
 *
 * Validates that a goal issue is eligible for intake/decompose processing.
 *
 * Eligibility requires:
 *   - Issue state is OPEN
 *   - Issue has the "goal" label
 *
 * This guard prevents goal_intake_decompose from running on closed issues or
 * non-goal issues (e.g. features mislabeled as ready), which causes the pipeline
 * to loop indefinitely (normalize_features gets 0 features, keep_open adds retry
 * comment, next tick re-dispatches — infinite loop).
 */



/**
 * Pure function: validate goal issue eligibility for intake/decompose.
 *
 * @param {object} opts
 * @param {string} opts.goalIssueJson - JSON string of the goal issue (from fetch_issue output_key)
 * @returns {"eligible"|"ineligible:closed"|"ineligible:not_goal"} eligibility result
 */
export function validateGoalIntakeEligibility({ goalIssueJson = "" } = {}) {
  const issue = parseJson(trim(goalIssueJson), {});

  // Check state (GitHub API returns "OPEN" or "CLOSED")
  const state = trim(issue?.state).toUpperCase();
  if (state && state !== "OPEN") {
    return "ineligible:closed";
  }

  // Check labels include "goal"
  const labels = Array.isArray(issue?.labels)
    ? issue.labels.map((l) => trim(typeof l === "string" ? l : l?.name || ""))
    : [];

  if (!labels.includes("goal")) {
    return "ineligible:not_goal";
  }

  return "eligible";
}
