import { waveComplexityEstimate } from "./wave-complexity-estimate.ts";
import { run, commitSubjectMatchesIssue, isSharedWaveBranch } from "./wave-issue-shared.ts";
export { buildReviewEvidenceScopeDiagnostics } from "./wave-issue-shared.ts";
export { isSharedWaveBranch } from "./wave-issue-shared.ts";

export function inspectExistingCommits({ worktreeDir } = {}) {
  const count = run(["git", "-C", String(worktreeDir || "."), "rev-list", "--count", "main..HEAD"]);
  return { existing_commits: count.stdout || "0" };
}
function buildLatestIssueChangeSummary({ commitsAhead = "0", changedFiles = [] } = {}) {
  const commits = Number.parseInt(String(commitsAhead || "0").trim(), 10);
  const normalizedCommits = Number.isFinite(commits) && commits >= 0 ? commits : 0;
  const files = Array.isArray(changedFiles)
    ? changedFiles.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  if (files.length === 0) return `commits_ahead=${normalizedCommits}; changed_files=[]`;
  const previewLimit = 10;
  const preview = files.slice(0, previewLimit);
  const overflow = files.length - preview.length;
  const overflowSuffix = overflow > 0 ? ` (+${overflow} more)` : "";
  return `commits_ahead=${normalizedCommits}; changed_files=[${preview.join(", ")}]${overflowSuffix}`;
}

export function inspectBranchChanges({ worktreeDir } = {}) {
  const wd = String(worktreeDir || ".");
  const count = run(["git", "-C", wd, "rev-list", "--count", "main..HEAD"]);
  const files = run(["git", "-C", wd, "diff", "--name-only", "main...HEAD"]);
  const commitsAhead = count.stdout || "0";
  const changedFiles = String(files.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return {
    commits_ahead: commitsAhead,
    changed_files: changedFiles,
    latest_issue_change_summary: buildLatestIssueChangeSummary({ commitsAhead, changedFiles }),
  };
}
export function resolveExecutionMode(modeRaw = "") {
  const mode = String(modeRaw || "").trim().toLowerCase();
  return mode || "full";
}
export function estimateWaveIssueComplexity({ issueTitle = "", issueBody = "" } = {}) {
  return waveComplexityEstimate({ issueTitle, issueBody });
}

export function decideExistingReuse({ branch = "", existingCommits = "0", issueNumber = "", worktreeDir = "" } = {}) {
  const b = String(branch || "").trim();
  const existing = String(existingCommits || "0").trim();
  if (b.startsWith("milestone/")) return "false";
  if (!existing || existing === "0") return "false";
  // Commits exist — check if they reference this issue
  const issue = String(issueNumber || "").trim();
  const wd = String(worktreeDir || "").trim();
  if (issue && wd) {
    const subjects = run(["git", "-C", wd, "log", "main..HEAD", "--format=%s"], wd);
    const lines = String(subjects.stdout || "").split(/\r?\n/).filter(Boolean);
    const matchesIssue = lines.some((line) => commitSubjectMatchesIssue(issue, line));
    if (!matchesIssue) {
      // Shared wave branches carry commits from prior issues — never reset them
      if (isSharedWaveBranch(b)) return "false";
      return "reset"; // per-issue branch with stale commits
    }
  }
  return "true";
}
