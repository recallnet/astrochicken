import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const IGNORED_STATUS_PREFIXES = [".hatch/", ".hatch-worktrees/", ".hook-logs/"];

export function inspectMergeWorkspaceState({ repo = "" } = {}) {
  const resolvedRepo = String(repo || "").trim();
  if (!resolvedRepo) {
    return {
      unmerged: "",
      mergeHeadPresent: false,
      rebaseApplyPresent: false,
      rebaseMergePresent: false,
      dirtyEntries: [],
    };
  }

  const unmerged = String(
    spawnSync("git", ["-C", resolvedRepo, "diff", "--name-only", "--diff-filter=U"], { encoding: "utf8" }).stdout || "",
  ).trim();
  const mergeHead = spawnSync("git", ["-C", resolvedRepo, "rev-parse", "-q", "--verify", "MERGE_HEAD"], { encoding: "utf8" });
  const gitDirOut = spawnSync("git", ["-C", resolvedRepo, "rev-parse", "--git-dir"], { encoding: "utf8" });
  const gitDirRaw = String(gitDirOut.stdout || "").trim();
  const gitDir = gitDirRaw ? (isAbsolute(gitDirRaw) ? gitDirRaw : join(resolvedRepo, gitDirRaw)) : "";
  const porcelain = String(
    spawnSync("git", ["-C", resolvedRepo, "status", "--porcelain"], { encoding: "utf8" }).stdout || "",
  );

  const dirtyEntries = porcelain
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const file = line.slice(3);
      return !IGNORED_STATUS_PREFIXES.some((prefix) => file.startsWith(prefix));
    });

  return {
    unmerged,
    mergeHeadPresent: mergeHead.status === 0 && Boolean(String(mergeHead.stdout || "").trim()),
    rebaseApplyPresent: gitDir ? existsSync(join(gitDir, "rebase-apply")) : false,
    rebaseMergePresent: gitDir ? existsSync(join(gitDir, "rebase-merge")) : false,
    dirtyEntries,
  };
}
