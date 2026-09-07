import { spawnSync } from "node:child_process";

import { resolveCanonicalCheckoutPath } from "../lib/canonical-worktree.ts";
import { trim, gh } from "../lib/cli-helpers.ts";
import { guardDisposableCleanup } from "../lib/git-mutation-guard.ts";


function run(args, cwd) {
  const p = spawnSync(args[0], args.slice(1), { encoding: "utf8", cwd });
  return { code: p.status ?? 1, stdout: String(p.stdout || "").trim(), stderr: String(p.stderr || "").trim() };
}

/**
 * Force-reset a branch by deleting the remote branch and removing the local worktree.
 * Then reopen the issue with `ready` label so it gets re-queued for a fresh build.
 */
export function forceResetBranch({ repo, branch, issueNumber } = {}) {
  const r = String(repo || "").trim();
  const b = String(branch || "").trim();
  const issue = String(issueNumber || "").trim();
  if (!r || !b) return { ok: false, error: "missing_repo_or_branch" };

  const actions = [];

  // Delete remote branch
  const del = run(["git", "push", "origin", "--delete", b]);
  actions.push({ action: "delete_remote_branch", branch: b, ok: del.code === 0, detail: del.code === 0 ? "" : del.stderr });

  // Remove local worktree if it exists
  const wtList = run(["git", "worktree", "list", "--porcelain"]);
  const worktrees = String(wtList.stdout || "").split(/\n/).filter((l) => l.startsWith("worktree ")).map((l) => l.replace("worktree ", ""));
  const matchingWt = worktrees.find((wt) => wt.includes(b.replace(/\//g, "-")));
  if (matchingWt) {
    const canonicalPath = resolveCanonicalCheckoutPath();
    const cleanupGuard = guardDisposableCleanup({
      worktreePath: matchingWt,
      repoPath: matchingWt,
      canonicalCheckoutPath: canonicalPath,
      operation: "force_reset_worktree_remove",
    });
    if (cleanupGuard.blocked) {
      actions.push({ action: "remove_worktree", path: matchingWt, ok: false, blocked: true, reason: cleanupGuard.reason });
    } else {
      run(["git", "worktree", "remove", matchingWt, "--force"]);
      actions.push({ action: "remove_worktree", path: matchingWt, ok: true });
    }
  }

  // Reopen issue with ready label if issue number provided
  if (issue) {
    const reopen = gh(["issue", "reopen", issue, "--repo", r]);
    actions.push({ action: "reopen_issue", issue, ok: reopen.ok });
    const addLabel = gh(["issue", "edit", issue, "--repo", r, "--add-label", "ready", "--remove-label", "quarantined"]);
    actions.push({ action: "relabel_issue", issue, ok: addLabel.ok });
    gh(["issue", "comment", issue, "--repo", r, "--body", `Branch \`${b}\` force-reset by supervisor. Issue re-queued for fresh build.`]);
  }

  return { ok: true, actions };
}

/**
 * Force-close a give-up issue as not-planned with an explanatory comment.
 */
export function forceCloseGiveUp({ repo, issueNumber, reason } = {}) {
  const r = String(repo || "").trim();
  const issue = String(issueNumber || "").trim();
  if (!r || !issue) return { ok: false, error: "missing_repo_or_issue" };

  const reasonText = String(reason || "Supervisor determined this issue cannot be completed in its current form.").trim();
  const comment = gh(["issue", "comment", issue, "--repo", r, "--body", `Supervisor force-close: ${reasonText}`]);
  const close = gh(["issue", "close", issue, "--repo", r, "--reason", "not planned"]);

  return {
    ok: close.ok,
    issue_number: issue,
    commented: comment.ok,
    closed: close.ok,
    reason: reasonText,
  };
}
