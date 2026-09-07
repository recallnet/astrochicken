import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { run, resolvePath } from "./wave-issue-shared.ts";
import { resolveCanonicalCheckoutPath } from "../lib/canonical-worktree.ts";
import { trim } from "../lib/cli-helpers.ts";
import { guardDisposableCleanup, guardGitMutation } from "../lib/git-mutation-guard.ts";
import { bootstrapWorkspace } from "../lib/workspace-package-manager.ts";

function clearImmutableFlags(targetPath) {
  if (!targetPath) return;
  try {
    run(["chflags", "-R", "nouchg", targetPath], targetPath);
  } catch {
    // best-effort on macOS; ignored elsewhere
  }
}

function removeDisposableResidue(targetPath) {
  clearImmutableFlags(targetPath);
  rmSync(targetPath, { recursive: true, force: true });
}

function readGitdirPointer(worktreePath = "") {
  const gitFile = join(String(worktreePath || "").trim(), ".git");
  if (!existsSync(gitFile)) return "";
  try {
    const raw = String(readFileSync(gitFile, "utf8") || "").trim();
    const match = raw.match(/^gitdir:\s*(.+)$/i);
    return String(match?.[1] || "").trim();
  } catch {
    return "";
  }
}

function classifyExistingWorktreePath({ worktreePath = "", expectedBranch = "" } = {}) {
  const worktree = String(worktreePath || "").trim();
  const branchName = String(expectedBranch || "").trim();
  if (!worktree) return { kind: "missing" };

  try {
    lstatSync(worktree);
  } catch {
    return { kind: "missing" };
  }

  if (!existsSync(worktree)) {
    return { kind: "broken_symlink" };
  }

  const gitdirPointer = readGitdirPointer(worktree);
  if (gitdirPointer && !existsSync(gitdirPointer)) {
    return { kind: "dangling_gitdir_pointer", gitdirPointer };
  }

  const gitCheck = run(["git", "-C", worktree, "rev-parse", "--is-inside-work-tree"], worktree);
  if (gitCheck.code === 0 && String(gitCheck.stdout || "").trim() === "true") {
    const currentBranch = String(
      run(["git", "-C", worktree, "rev-parse", "--abbrev-ref", "HEAD"], worktree).stdout || "",
    ).trim();
    if (branchName && currentBranch && currentBranch !== branchName) {
      return { kind: "valid_wrong_branch", currentBranch };
    }
    return { kind: "valid_expected_branch", currentBranch };
  }

  return { kind: "stale_non_git_directory" };
}

export function snapshotBranchHead({ worktreeDir = "", existingSnapshot = "" } = {}) {
  // Idempotent: if snapshot already captured for this issue, return it unchanged
  const existing = String(existingSnapshot || "").trim();
  if (existing) return { snapshot_sha: existing };
  const wd = String(worktreeDir || ".").trim();
  const head = run(["git", "-C", wd, "rev-parse", "HEAD"], wd);
  return { snapshot_sha: String(head.stdout || "").trim() };
}
export function revertToSnapshot({ worktreeDir = "", snapshotSha = "" } = {}) {
  const wd = String(worktreeDir || ".").trim();
  const sha = String(snapshotSha || "").trim();
  if (!sha) return { reverted: "false", reason: "no_snapshot_sha" };
  const guard = guardGitMutation({
    operation: "reset_hard",
    targetPath: wd,
    canonicalCheckoutPath: resolveCanonicalCheckoutPath(),
  });
  if (!guard.ok) return { reverted: "false", reason: guard.reason };
  const current = run(["git", "-C", wd, "rev-parse", "HEAD"], wd);
  if (String(current.stdout || "").trim() === sha) {
    return { reverted: "false", reason: "already_at_snapshot" };
  }
  const result = run(["git", "-C", wd, "reset", "--hard", sha], wd);
  if (result.code !== 0) {
    return { reverted: "false", reason: `reset_failed: ${result.stderr}` };
  }
  return { reverted: "true", reason: "reverted_to_snapshot" };
}
export function cleanupLegacyWorktree({ repo = "", legacyWorktreeDir = "" } = {}) {
  const repository = trim(repo);
  const legacy = trim(legacyWorktreeDir);
  if (!repository || !legacy || !existsSync(legacy)) {
    return { removed: "false", reason: "legacy_worktree_missing" };
  }
  const guard = guardDisposableCleanup({
    worktreePath: legacy,
    repoPath: repository,
    canonicalCheckoutPath: resolveCanonicalCheckoutPath(),
    operation: "worktree_remove",
  });
  if (!guard.ok) return { removed: "false", reason: guard.reason };
  const result = run(["git", "-C", repository, "worktree", "remove", legacy, "--force"], repository);
  if (result.code !== 0) {
    return { removed: "false", reason: trim(result.stderr) || "worktree_remove_failed" };
  }
  return { removed: "true", reason: "legacy_worktree_removed" };
}
export function cleanupWaveIssueWorktree({ repo = "", worktreeDir = "" } = {}) {
  const repository = trim(repo);
  const worktree = trim(worktreeDir);
  if (!repository || !worktree || !existsSync(worktree)) {
    return { removed: "false", reason: "wave_worktree_missing" };
  }
  const guard = guardDisposableCleanup({
    worktreePath: worktree,
    repoPath: repository,
    canonicalCheckoutPath: resolveCanonicalCheckoutPath(),
    operation: "worktree_remove",
  });
  if (!guard.ok) return { removed: "false", reason: guard.reason };
  const result = run(["git", "-C", repository, "worktree", "remove", worktree, "--force"], repository);
  if (result.code !== 0) {
    return { removed: "false", reason: trim(result.stderr) || "worktree_remove_failed" };
  }
  return { removed: "true", reason: "wave_worktree_removed" };
}
export function setupWaveIssueWorktree({ repo = "", branch = "", worktreeDir = "" } = {}) {
  const repository = trim(repo);
  const branchName = trim(branch);
  const worktree = trim(worktreeDir);
  if (!repository || !branchName || !worktree) return { setup: "false", reason: "missing_setup_inputs" };
  const guard = guardDisposableCleanup({
    worktreePath: worktree,
    repoPath: repository,
    canonicalCheckoutPath: resolveCanonicalCheckoutPath(),
    operation: "worktree_add",
  });
  if (!guard.ok) return { setup: "false", reason: guard.reason };
  // lstatSync detects broken symlinks (existsSync follows symlinks and returns false for them).
  // A broken symlink from a prior crashed run must be removed before git worktree add.
  const existing = classifyExistingWorktreePath({ worktreePath: worktree, expectedBranch: branchName });
  if (existing.kind === "valid_expected_branch") {
    return { setup: "true", reason: "worktree_exists" };
  }
  if (
    existing.kind === "valid_wrong_branch"
    || existing.kind === "stale_non_git_directory"
    || existing.kind === "dangling_gitdir_pointer"
  ) {
    removeDisposableResidue(worktree);
  } else if (existing.kind === "broken_symlink") {
    removeDisposableResidue(worktree);
  }
  // Prune stale worktree registrations: if a previous run deleted the worktree
  // directory without telling git, the metadata in .git/worktrees/ lingers and
  // git worktree add will fail with "missing but already registered worktree".
  try { run(["git", "-C", repository, "worktree", "prune"], repository); } catch { /* best-effort */ }
  const hasBranch = run(["git", "-C", repository, "show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], repository).code === 0;
  const args = hasBranch
    ? ["git", "-C", repository, "worktree", "add", worktree, branchName]
    : ["git", "-C", repository, "worktree", "add", "-b", branchName, worktree, "main"];
  const result = run(args, repository);
  if (result.code !== 0) return { setup: "false", reason: trim(result.stderr) || "worktree_add_failed" };
  if (!existsSync(worktree)) return { setup: "false", reason: "worktree_dir_missing_after_add" };
  return { setup: "true", reason: hasBranch ? "attached_existing_branch" : "created_branch_from_main" };
}
export function ensureWorktreeToolchain({ repo = "", worktreeDir = "", bootstrapWorkspaceFn = bootstrapWorkspace } = {}) {
  const repository = trim(repo);
  const worktree = trim(worktreeDir);
  if (!repository || !worktree) {
    return { linked: "false", bootstrapped: "false", reason: "missing_toolchain_inputs" };
  }
  const bootstrap = bootstrapWorkspaceFn({ repoRoot: repository, workspaceDir: worktree });
  if (!bootstrap?.ok) {
    return {
      linked: "false",
      bootstrapped: "false",
      reason: trim(bootstrap?.reason) || "worktree_bootstrap_failed",
      install_code: trim(bootstrap?.install_code),
      build_code: trim(bootstrap?.build_code),
    };
  }
  return {
    linked: "false",
    bootstrapped: "true",
    reason: trim(bootstrap.reason) || "workspace_bootstrapped",
    install_code: trim(bootstrap.install_code),
    build_code: trim(bootstrap.build_code),
  };
}

export function validateWorkRepo({ repo = "" } = {}) {
  const repository = resolvePath(repo);
  if (!repository) {
    return { valid: "false", reason: "missing_repo", repo: "" };
  }
  if (!existsSync(repository)) {
    return { valid: "false", reason: "repo_path_missing", repo: repository };
  }

  const inside = run(["git", "-C", repository, "rev-parse", "--is-inside-work-tree"], repository);
  if (inside.code !== 0 || trim(inside.stdout) !== "true") {
    return {
      valid: "false",
      reason: "repo_not_git_worktree",
      repo: repository,
      stderr: trim(inside.stderr || inside.stdout) || "not_a_git_repository",
    };
  }

  const topLevel = run(["git", "-C", repository, "rev-parse", "--show-toplevel"], repository);
  return {
    valid: "true",
    reason: "ok",
    repo: repository,
    git_root: trim(topLevel.stdout) || repository,
  };
}

export function resetStaleBranch({ worktreeDir } = {}) {
  const wd = String(worktreeDir || ".").trim();
  const guard = guardGitMutation({
    operation: "reset_hard",
    targetPath: wd,
    canonicalCheckoutPath: resolveCanonicalCheckoutPath(),
  });
  if (!guard.ok) return { reset: "false", prior_commits: "0", reason: guard.reason };
  const countBefore = run(["git", "-C", wd, "rev-list", "--count", "main..HEAD"], wd);
  const prior = String(countBefore.stdout || "0").trim();
  run(["git", "-C", wd, "reset", "--hard", "main"], wd);
  return { reset: "true", prior_commits: prior, reason: "reset_to_main" };
}
