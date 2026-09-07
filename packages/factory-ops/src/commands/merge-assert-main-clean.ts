import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Check if the canonical checkout is clean: no untracked files, no modified
 * tracked files, no partial git state (bisect, rebase, merge in progress).
 * Returns a diagnostic object the graph can route on.
 */
export function assertMainClean({ repo = "" } = {}) {
  const resolvedRepo = String(repo || "").trim();
  if (!resolvedRepo) {
    return { clean: false, untracked_count: 0, modified_count: 0, untracked_files: [], modified_files: [], partial_state: "none", error: "missing_repo" };
  }

  // Check current branch — canonical checkout must be on main.
  const branchResult = spawnSync("git", ["-C", resolvedRepo, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", timeout: 10_000 });
  const branch = String(branchResult.stdout || "").trim() || "unknown";

  // Detect partial git state (bisect, rebase, merge)
  const gitDirResult = spawnSync("git", ["-C", resolvedRepo, "rev-parse", "--git-dir"], { encoding: "utf8", timeout: 10_000 });
  const gitDir = String(gitDirResult.stdout || "").trim();
  const absGitDir = gitDir.startsWith("/") ? gitDir : join(resolvedRepo, gitDir);
  let partialState = "none";
  if (branch !== "main") {
    partialState = "wrong_branch";
  }
  if (existsSync(join(absGitDir, "BISECT_LOG"))) {
    partialState = "bisect";
  } else if (existsSync(join(absGitDir, "rebase-merge")) || existsSync(join(absGitDir, "rebase-apply"))) {
    partialState = "rebase";
  } else if (existsSync(join(absGitDir, "MERGE_HEAD"))) {
    partialState = "merge";
  }

  // Get porcelain status.
  // Use spawnSync directly (not the module-level run() which trims stdout,
  // corrupting the leading-space status codes in porcelain output).
  const status = spawnSync("git", ["-C", resolvedRepo, "status", "--porcelain"], { encoding: "utf8", timeout: 30_000 });
  const lines = String(status.stdout || "").split("\n").filter((l) => l.length > 0);

  // Porcelain format: XY<space>filename — first 3 chars are status, rest is path.
  // Filter out .hatch/ and .hatch-worktrees/ and .hook-logs/ directories.
  const ignorePrefixes = [".hatch/", ".hatch-worktrees/", ".hook-logs/"];
  const relevant = lines.filter((l) => {
    const file = l.slice(3);
    return !ignorePrefixes.some((p) => file.startsWith(p));
  });

  const untracked = relevant.filter((l) => l.startsWith("??"));
  const modified = relevant.filter((l) => !l.startsWith("??"));

  const untrackedFiles = untracked.map((l) => l.slice(3));
  const modifiedFiles = modified.map((l) => l.slice(3));

  const clean = partialState === "none" && untracked.length === 0 && modified.length === 0;

  return {
    clean,
    branch,
    untracked_count: untracked.length,
    modified_count: modified.length,
    untracked_files: untrackedFiles,
    modified_files: modifiedFiles,
    partial_state: partialState,
    error: "",
  };
}
