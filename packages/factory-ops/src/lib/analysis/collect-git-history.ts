import { spawnSync } from "node:child_process";

import {
  MissingDataReason,
  addMissingData,
  createCollectorEnvelope,
  finalizeCollectorEnvelope,
  inWindow,
  toArray,
} from "./types.ts";

async function runGit(gitLogFn, repoPath, args) {
  return Promise.resolve(gitLogFn({ repoPath, args }));
}

function parseCommitLines(raw = "") {
  return String(raw || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, committedAt, author, ...subjectParts] = line.split("|");
      return {
        sha: String(sha || "").trim(),
        committed_at: String(committedAt || "").trim(),
        author: String(author || "").trim(),
        subject: String(subjectParts.join("|") || "").trim(),
      };
    })
    .filter((entry) => Boolean(entry.sha));
}

function parseBranchLines(raw = "") {
  return String(raw || "")
    .split("\n")
    .map((line) => line.replace(/^[*+]/, "").trim())
    .filter(Boolean)
    .filter((line) => !line.includes("->"));
}

function isPrimaryBranchRef(branch = "") {
  const normalized = String(branch || "").trim().replace(/^remotes\//, "");
  if (!normalized) return false;
  if (normalized === "main" || normalized === "master") return true;
  return /^[^/]+\/(main|master)$/.test(normalized);
}

export function defaultGitLog({ repoPath = process.cwd(), args = [] } = {}) {
  const proc = spawnSync("git", ["-C", repoPath, ...toArray(args)], { encoding: "utf8" });
  if (proc.status !== 0) {
    const message = String(proc.stderr || proc.stdout || "git command failed").trim();
    throw new Error(`git_command_failed: ${message}`);
  }
  return String(proc.stdout || "");
}

export async function collectGitHistory({
  windowStart,
  windowEnd,
  repoPath = process.cwd(),
  gitLogFn = defaultGitLog,
} = {}) {
  let payload;
  try {
    payload = createCollectorEnvelope({ source: "git_history", windowStart, windowEnd });
  } catch (error) {
    return {
      source: "git_history",
      window: { start: String(windowStart || ""), end: String(windowEnd || "") },
      missing_data: [{ reason: MissingDataReason.WINDOW_INVALID, detail: String(error?.message || error) }],
      commits: [],
      commit_count: 0,
      stray_branches_count: 0,
      stray_branches: [],
    };
  }

  let commitLogRaw = "";
  try {
    commitLogRaw = await runGit(gitLogFn, repoPath, [
      "log",
      `--since=${payload.window.start}`,
      `--until=${payload.window.end}`,
      "--pretty=format:%H|%cI|%an|%s",
    ]);
  } catch (error) {
    addMissingData(payload, MissingDataReason.SOURCE_MISSING, "git log unavailable", {
      error: String(error?.message || error),
    });
    return finalizeCollectorEnvelope({
      ...payload,
      commits: [],
      commit_count: 0,
      stray_branches_count: 0,
      stray_branches: [],
    });
  }

  const commits = parseCommitLines(commitLogRaw)
    .filter((commit) => inWindow(commit.committed_at, payload._windowMs.startMs, payload._windowMs.endMs));

  let branchRaw = "";
  try {
    branchRaw = await runGit(gitLogFn, repoPath, ["branch", "--all", "--no-color", "--merged"]);
  } catch (error) {
    addMissingData(payload, MissingDataReason.COMMAND_FAILED, "git branch --merged failed", {
      error: String(error?.message || error),
    });
  }

  const branches = parseBranchLines(branchRaw);
  const strayBranches = [];

  for (const branch of branches) {
    if (isPrimaryBranchRef(branch)) continue;

    let lastCommitAt = "";
    try {
      lastCommitAt = String(await runGit(gitLogFn, repoPath, ["log", "-1", branch, "--pretty=format:%cI"]) || "").trim();
    } catch (error) {
      addMissingData(payload, MissingDataReason.COMMAND_FAILED, "git log -1 branch failed", {
        branch,
        error: String(error?.message || error),
      });
      continue;
    }

    if (!inWindow(lastCommitAt, payload._windowMs.startMs, payload._windowMs.endMs)) {
      strayBranches.push({ branch, last_commit_at: lastCommitAt || "" });
    }
  }

  return finalizeCollectorEnvelope({
    ...payload,
    commits,
    commit_count: commits.length,
    stray_branches_count: strayBranches.length,
    stray_branches: strayBranches.slice(0, 20),
  });
}
