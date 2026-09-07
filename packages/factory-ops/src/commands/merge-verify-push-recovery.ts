import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import { inspectMergeWorkspaceState } from "./merge-workspace-state.ts";
import { trim } from "../lib/cli-helpers.ts";

function isolatedGitEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  return env;
}

function run(cmd) {
  const p = spawnSync(cmd[0], cmd.slice(1), {
    encoding: "utf8",
    env: isolatedGitEnv(),
  });
  return { code: p.status ?? 1, stdout: String(p.stdout || "").trim(), stderr: String(p.stderr || "").trim() };
}

export function verifyPushRecovery({ repo = "", branch = "main", remote = "origin", mergeWorktreeDir = "" } = {}) {
  const resolvedRepo = String(repo || "").trim();
  const resolvedBranch = String(branch || "main").trim() || "main";
  const resolvedRemote = String(remote || "origin").trim() || "origin";
  const resolvedMergeWorktreeDir = trim(mergeWorktreeDir);
  if (!resolvedRepo) {
    return { resolution_status: "unresolved", resolution_notes: "missing_repo" };
  }

  run(["git", "-C", resolvedRepo, "fetch", resolvedRemote, resolvedBranch]);

  const canonicalState = inspectMergeWorkspaceState({ repo: resolvedRepo });
  if (canonicalState.unmerged) {
    return { resolution_status: "unresolved", resolution_notes: `canonical_unmerged_paths=${canonicalState.unmerged}` };
  }
  if (canonicalState.mergeHeadPresent) {
    return { resolution_status: "unresolved", resolution_notes: "canonical_merge_head_present" };
  }
  if (canonicalState.rebaseApplyPresent || canonicalState.rebaseMergePresent) {
    return { resolution_status: "unresolved", resolution_notes: "canonical_rebase_in_progress" };
  }
  if (canonicalState.dirtyEntries.length > 0) {
    return { resolution_status: "unresolved", resolution_notes: `canonical_dirty=${canonicalState.dirtyEntries.join(",")}` };
  }

  const localHead = run(["git", "-C", resolvedRepo, "rev-parse", resolvedBranch]);
  const remoteHead = run(["git", "-C", resolvedRepo, "rev-parse", `${resolvedRemote}/${resolvedBranch}`]);
  if (localHead.code !== 0 || !trim(localHead.stdout)) {
    return { resolution_status: "unresolved", resolution_notes: `missing_local_head=${resolvedBranch}` };
  }
  if (remoteHead.code !== 0 || !trim(remoteHead.stdout)) {
    return { resolution_status: "unresolved", resolution_notes: `missing_remote_head=${resolvedRemote}/${resolvedBranch}` };
  }
  const fastForwardable = run([
    "git", "-C", resolvedRepo, "merge-base", "--is-ancestor", trim(localHead.stdout), trim(remoteHead.stdout),
  ]);
  if (fastForwardable.code !== 0 && trim(localHead.stdout) !== trim(remoteHead.stdout)) {
    return {
      resolution_status: "unresolved",
      resolution_notes: `canonical_main_not_fast_forwardable_to_${resolvedRemote}/${resolvedBranch}`,
    };
  }

  if (!resolvedMergeWorktreeDir || !existsSync(resolvedMergeWorktreeDir)) {
    return { resolution_status: "unresolved", resolution_notes: "missing_merge_worktree" };
  }

  const mergeState = inspectMergeWorkspaceState({ repo: resolvedMergeWorktreeDir });
  if (mergeState.unmerged) {
    return { resolution_status: "unresolved", resolution_notes: `merge_worktree_unmerged_paths=${mergeState.unmerged}` };
  }
  if (mergeState.mergeHeadPresent) {
    return { resolution_status: "unresolved", resolution_notes: "merge_worktree_merge_head_present" };
  }
  if (mergeState.rebaseApplyPresent || mergeState.rebaseMergePresent) {
    return { resolution_status: "unresolved", resolution_notes: "merge_worktree_rebase_in_progress" };
  }
  if (mergeState.dirtyEntries.length > 0) {
    return { resolution_status: "unresolved", resolution_notes: `merge_worktree_dirty=${mergeState.dirtyEntries.join(",")}` };
  }

  const mergeHead = run(["git", "-C", resolvedMergeWorktreeDir, "rev-parse", "HEAD"]);
  if (mergeHead.code !== 0 || !trim(mergeHead.stdout)) {
    return { resolution_status: "unresolved", resolution_notes: "missing_merge_worktree_head" };
  }
  const descendsFromRemote = run([
    "git", "-C", resolvedRepo, "merge-base", "--is-ancestor", trim(remoteHead.stdout), trim(mergeHead.stdout),
  ]);
  if (descendsFromRemote.code !== 0) {
    return {
      resolution_status: "unresolved",
      resolution_notes: `merge_worktree_head_not_descended_from_${resolvedRemote}/${resolvedBranch}`,
    };
  }

  return {
    resolution_status: "resolved",
    resolution_notes: `push_recovery_ready remote=${resolvedRemote}/${resolvedBranch}`,
  };
}
