/**
 * Goal-scoped build-item: replaces milestone-build-item.mjs.
 *
 * Key change: branches are `goal/${goalNumber}` instead of `wave/${milestoneTitle}`,
 * and session IDs are goal-scoped.
 */

export function buildGoalIssueItem({ issueNumber = "", issueTitle = "" } = {}) {
  return {
    issue_number: String(issueNumber || "").trim(),
    issue_title: String(issueTitle || "").trim(),
  };
}

function sanitizeGoalNumber(goalNumber = "") {
  return String(goalNumber || "0").replace(/[^A-Za-z0-9._-]+/g, "-");
}

/**
 * Build empty branch context for a goal execution.
 *
 * Branch format: goal/${goalNumber}
 * Session format: goal-${goalNumber}
 */
export function emptyGoalBranchContext({ goalNumber = "" } = {}) {
  const safe = sanitizeGoalNumber(goalNumber);
  return {
    branch: `goal/${safe}`,
    worktree_dir: "",
    agent_session_id: `goal-${safe}`,
    reviewer_session_id: `reviewer-goal-${safe}`,
    goal_sessions_dir: `.hatch/goal-sessions/${safe}`,
  };
}

/**
 * Build issue-isolated branch context within a goal execution.
 *
 * Branch format: goal/${goalNumber}-issue-${issueNumber}
 * Used when issues need isolated worktrees within the same goal.
 */
export function buildGoalIssueContext({ goalNumber = "", issueNumber = "" } = {}) {
  const safeGoal = sanitizeGoalNumber(goalNumber);
  const safeIssue = String(issueNumber || "").trim().replace(/[^A-Za-z0-9._-]+/g, "-");
  const issueSuffix = safeIssue || "unknown";
  return {
    branch: `goal/${safeGoal}-issue-${issueSuffix}`,
    worktree_dir: "",
    agent_session_id: `goal-${safeGoal}-issue-${issueSuffix}`,
  };
}
