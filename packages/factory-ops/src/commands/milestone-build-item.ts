export function buildMilestoneIssueItem({ issueNumber = "", issueTitle = "" } = {}) {
  return {
    issue_number: String(issueNumber || "").trim(),
    issue_title: String(issueTitle || "").trim(),
  };
}

function sanitizeMilestoneTitle(milestoneTitle = "") {
  return String(milestoneTitle || "wave").replace(/[^A-Za-z0-9._-]+/g, "-");
}

export function emptyMilestoneBranchContext({ milestoneTitle = "" } = {}) {
  const safe = sanitizeMilestoneTitle(milestoneTitle);
  const sessionId = `milestone-${safe}`;
  const reviewerSessionId = `reviewer-${safe}`;
  const waveSessionsDir = `.hatch/wave-sessions/${safe}`;
  return {
    branch: `wave/${safe}`,
    worktree_dir: "",
    agent_session_id: sessionId,
    reviewer_session_id: reviewerSessionId,
    wave_sessions_dir: waveSessionsDir,
  };
}

export function buildMilestoneParallelIssueContext({ milestoneTitle = "", issueNumber = "" } = {}) {
  const safeMilestone = sanitizeMilestoneTitle(milestoneTitle);
  const safeIssue = String(issueNumber || "").trim().replace(/[^A-Za-z0-9._-]+/g, "-");
  const issueSuffix = safeIssue || "unknown";
  return {
    branch: `wave/${safeMilestone}-issue-${issueSuffix}`,
    worktree_dir: "",
    agent_session_id: `milestone-${safeMilestone}-issue-${issueSuffix}`,
  };
}
