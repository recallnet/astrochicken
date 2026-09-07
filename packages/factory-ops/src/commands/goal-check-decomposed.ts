import { checkGoalAlreadyDecomposedByPacket } from "./goal-decomposition-packet.ts";
import { listGoalSubIssues } from "./goal-sub-issues.ts";

/**
 * Pure function: check if a goal already has decomposed sub-issues.
 * @param {object} opts
 * @param {string|number} opts.issueNumber - Goal issue number
 * @param {Array<{state?: string}>} opts.subIssues - Goal sub-issues
 * @returns {"true"|"false"}
 */
export function checkGoalAlreadyDecomposed({ issueNumber, subIssues = [] } = {}) {
  if (!Array.isArray(subIssues) || subIssues.length === 0) return "false";
  // A goal with ANY sub-issues (open or closed) is already decomposed.
  // Previously this only checked for open sub-issues, which caused an
  // unbounded re-decomposition loop: all sub-issues close → guard resets →
  // LLM re-decomposes from scratch → new issues created → denominator grows.
  return "true";
}

/**
 * IO wrapper: fetch sub-issues from GitHub and check.
 * @param {object} opts
 * @param {string} opts.repo - GitHub repo (owner/name)
 * @param {string|number} opts.issueNumber - Goal issue number
 * @param {Function} [opts.listSubIssuesFn] - DI for testing
 * @returns {"true"|"false"}
 */
export function checkGoalAlreadyDecomposedFromGitHub({ repo, issueNumber, listSubIssuesFn = listGoalSubIssues } = {}) {
  if (!repo || !issueNumber) return "false";
  const subIssues = listSubIssuesFn({ repo, goalNumber: issueNumber });
  if (!Array.isArray(subIssues) || subIssues.length === 0) return "false";
  return checkGoalAlreadyDecomposed({ issueNumber, subIssues });
}

export function checkGoalAlreadyDecomposedWithPackets({
  repo,
  issueNumber,
  repoRoot = "",
  factoryId = "mothership",
  listSubIssuesFn,
} = {}) {
  const packetDecision = checkGoalAlreadyDecomposedByPacket({
    repo: repoRoot,
    factoryId,
    issueNumber,
  });
  if (packetDecision === "true") {
    return "true";
  }
  return checkGoalAlreadyDecomposedFromGitHub({ repo, issueNumber, listSubIssuesFn });
}
