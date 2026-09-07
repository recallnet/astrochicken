import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

function trim(value = "") {
  return String(value || "").trim();
}

function parseIsoMs(value = "") {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function execGit(args = [], cwd = ".") {
  const result = spawnSync(args[0], args.slice(1), {
    cwd,
    encoding: "utf8",
  });
  return {
    code: result.status ?? 1,
    stdout: trim(result.stdout),
    stderr: trim(result.stderr),
  };
}

function parseStatusPaths(raw = "") {
  return String(raw || "")
    .split(/\r?\n/u)
    .map((line) => trim(line))
    .filter(Boolean)
    .map((line) => trim(line.replace(/^[ MADRCU?!]{1,2}\s+/u, "")))
    .filter(Boolean);
}

export function inspectActiveRunGitSignals({
  worktreeDir = "",
  snapshotSha = "",
  startedAt = "",
  now = Date.now(),
  execGitFn = execGit,
} = {}) {
  const resolvedWorktreeDir = trim(worktreeDir);
  if (!resolvedWorktreeDir) {
    return {
      status: "unknown",
      reason: "missing_worktree_dir",
      no_git_delta_since_start: false,
      worktree_clean: null,
      commits_ahead: null,
      issue_commits_since_snapshot: null,
      issue_changed_files: [],
      head_commit_sha: "",
      head_commit_at: "",
    };
  }

  if (!existsSync(resolvedWorktreeDir)) {
    return {
      status: "unknown",
      reason: "worktree_dir_missing",
      no_git_delta_since_start: false,
      worktree_clean: null,
      commits_ahead: null,
      issue_commits_since_snapshot: null,
      issue_changed_files: [],
      head_commit_sha: "",
      head_commit_at: "",
    };
  }

  const statusResult = execGitFn(["git", "-C", resolvedWorktreeDir, "status", "--short"], resolvedWorktreeDir);
  const headResult = execGitFn(["git", "-C", resolvedWorktreeDir, "show", "-s", "--format=%H%x09%cI", "HEAD"], resolvedWorktreeDir);
  const aheadResult = execGitFn(["git", "-C", resolvedWorktreeDir, "rev-list", "--count", "main..HEAD"], resolvedWorktreeDir);
  const diffResult = trim(snapshotSha)
    ? execGitFn(["git", "-C", resolvedWorktreeDir, "diff", "--name-only", `${trim(snapshotSha)}...HEAD`], resolvedWorktreeDir)
    : { code: 0, stdout: "", stderr: "" };
  const issueCommitsResult = trim(snapshotSha)
    ? execGitFn(["git", "-C", resolvedWorktreeDir, "rev-list", "--count", `${trim(snapshotSha)}..HEAD`], resolvedWorktreeDir)
    : { code: 0, stdout: "0", stderr: "" };

  const [headCommitSha, headCommitAt] = String(headResult.stdout || "").split("\t");
  const startedMs = parseIsoMs(startedAt);
  const headCommitMs = parseIsoMs(headCommitAt);
  const worktreeClean = trim(statusResult.stdout) === "";
  const commitsAhead = Number.parseInt(trim(aheadResult.stdout), 10);
  const issueCommitsSinceSnapshot = Number.parseInt(trim(issueCommitsResult.stdout), 10);
  const issueChangedFiles = String(diffResult.stdout || "")
    .split(/\r?\n/u)
    .map((entry) => trim(entry))
    .filter(Boolean);
  const dirtyPaths = parseStatusPaths(statusResult.stdout);

  const dirtyWorktree = !worktreeClean;
  const committedSinceStart = startedMs > 0 && headCommitMs > startedMs;
  const gitDeltaSinceStart = dirtyWorktree || committedSinceStart;
  const safeNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const ageMs = startedMs > 0 ? Math.max(0, safeNow - startedMs) : 0;
  const noGitDeltaSinceStart = startedMs > 0 && ageMs >= (15 * 60 * 1000) && !gitDeltaSinceStart;

  let status = "unknown";
  if (dirtyWorktree) status = "dirty";
  else if (committedSinceStart) status = "committed_since_start";
  else if (startedMs > 0) status = "no_delta_since_start";

  return {
    status,
    reason: noGitDeltaSinceStart ? "no_git_delta_since_start" : status,
    no_git_delta_since_start: noGitDeltaSinceStart,
    worktree_clean: worktreeClean,
    commits_ahead: Number.isFinite(commitsAhead) ? commitsAhead : null,
    issue_commits_since_snapshot: Number.isFinite(issueCommitsSinceSnapshot) ? issueCommitsSinceSnapshot : null,
    issue_changed_files: issueChangedFiles.length > 0 ? issueChangedFiles : dirtyPaths,
    head_commit_sha: trim(headCommitSha),
    head_commit_at: trim(headCommitAt),
  };
}
