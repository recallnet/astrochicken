import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { resolveCanonicalCheckoutPath, resolveDisposableWorktreeRoot } from "../lib/canonical-worktree.ts";
import { trim } from "../lib/cli-helpers.ts";
import { guardDisposableCleanup } from "../lib/git-mutation-guard.ts";
import { bootstrapWorkspace } from "../lib/workspace-package-manager.ts";

function run(args, cwd) {
  const p = spawnSync(args[0], args.slice(1), { encoding: "utf8", cwd });
  return { code: p.status ?? 1, stdout: String(p.stdout || "").trim(), stderr: String(p.stderr || "").trim() };
}

const MERGE_WORKTREE_STATE_SCHEMA = "merge_worktree_state/v1";

function sanitizeSegment(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function resolveWorktreeGitDir(mergeWorktreeDir = "") {
  const dir = trim(mergeWorktreeDir);
  if (!dir) return "";
  const gitDir = run(["git", "-C", dir, "rev-parse", "--git-dir"], dir);
  if (gitDir.code !== 0) return "";
  return path.resolve(dir, String(gitDir.stdout || "").trim());
}

function resolveStatePath(mergeWorktreeDir = "") {
  const gitDir = resolveWorktreeGitDir(mergeWorktreeDir);
  return gitDir ? path.join(gitDir, "hatch-merge-worktree-state.json") : "";
}

function readStateFile(statePath = "") {
  if (!statePath || !existsSync(statePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStateFile(statePath = "", value = {}) {
  if (!statePath) return {};
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return value;
}

function ensureDisposableMergePath({ repo = "", mergeWorktreeDir = "" } = {}) {
  const guard = guardDisposableCleanup({
    worktreePath: mergeWorktreeDir,
    repoPath: repo,
    canonicalCheckoutPath: resolveCanonicalCheckoutPath(),
    operation: "worktree_add",
    enforceMutationContext: true,
  });
  if (!guard.ok) return guard;
  return { ok: true, reason: "", classification: guard.classification };
}

function existingPathType(candidatePath = "") {
  try {
    const stat = lstatSync(candidatePath);
    if (stat.isSymbolicLink()) return "symlink";
    if (stat.isDirectory()) return "directory";
    if (stat.isFile()) return "file";
    return "other";
  } catch {
    return "";
  }
}

function isGitWorktree(candidatePath = "") {
  if (!candidatePath || !existsSync(candidatePath)) return false;
  const inside = run(["git", "-C", candidatePath, "rev-parse", "--is-inside-work-tree"], candidatePath);
  return inside.code === 0 && trim(inside.stdout) === "true";
}

export function resolveMergeWorktreeDir({
  repo = "",
  branch = "",
  issueNumber = "",
  runId = "",
  pipeline = "merge",
  mergeWorktreeDir = "",
} = {}) {
  const explicit = trim(mergeWorktreeDir);
  if (explicit) return explicit;
  const repository = trim(repo);
  const root = resolveDisposableWorktreeRoot({ repoPath: repository, kind: "merge" });
  const parts = [
    sanitizeSegment(path.basename(repository)) || "repo",
    sanitizeSegment(pipeline) || "merge",
    sanitizeSegment(issueNumber) || sanitizeSegment(branch) || "main",
    sanitizeSegment(runId) || "session",
  ].filter(Boolean);
  return root ? path.join(root, parts.join("-")) : "";
}

export function readMergeWorktreeState({ mergeWorktreeDir = "" } = {}) {
  const resolvedDir = trim(mergeWorktreeDir);
  const statePath = resolveStatePath(resolvedDir);
  const parsed = readStateFile(statePath);
  return {
    state_path: statePath,
    ...parsed,
  };
}

export function writeMergeWorktreeState({ mergeWorktreeDir = "", patch = {} } = {}) {
  const resolvedDir = trim(mergeWorktreeDir);
  const statePath = resolveStatePath(resolvedDir);
  const previous = readStateFile(statePath);
  const next = {
    schema_version: MERGE_WORKTREE_STATE_SCHEMA,
    ...previous,
    ...patch,
    merge_worktree_dir: resolvedDir,
  };
  writeStateFile(statePath, next);
  return { state_path: statePath, ...next };
}

export function cleanMergeWorkspaceState({ mergeWorktreeDir = "" } = {}) {
  const dir = trim(mergeWorktreeDir);
  if (!dir) return { ok: false, reason: "missing_merge_worktree_dir" };
  run(["git", "-C", dir, "merge", "--abort"], dir);
  run(["git", "-C", dir, "rebase", "--abort"], dir);
  return { ok: true, reason: "" };
}

export function currentMergeWorktreeHead({ mergeWorktreeDir = "" } = {}) {
  const dir = trim(mergeWorktreeDir);
  const out = run(["git", "-C", dir, "rev-parse", "HEAD"], dir);
  return out.code === 0 ? trim(out.stdout) : "";
}

export function resolveMergeBaseRef({ repo = "", remote = "origin" } = {}) {
  const repository = trim(repo) || ".";
  const remoteName = trim(remote) || "origin";
  const remoteMain = `${remoteName}/main`;
  const hasRemote = run(["git", "-C", repository, "show-ref", "--verify", "--quiet", `refs/remotes/${remoteMain}`], repository).code === 0;
  // Pick the further-ahead of origin/main and local main so the rebase
  // targets the true tip — covers both remote pushes and local commits.
  let symbolicRef = "main";
  if (hasRemote) {
    const localAhead = run(["git", "-C", repository, "merge-base", "--is-ancestor", remoteMain, "main"], repository);
    if (localAhead.code !== 0) {
      const remoteAhead = run(["git", "-C", repository, "merge-base", "--is-ancestor", "main", remoteMain], repository);
      // Diverged or remote ahead — prefer remote as canonical base
      if (remoteAhead.code === 0) symbolicRef = remoteMain;
      else symbolicRef = remoteMain;
    }
  }
  // Pin to SHA so concurrent merges to main don't cause false verification failures.
  const sha = trim(run(["git", "-C", repository, "rev-parse", symbolicRef], repository).stdout);
  return sha || symbolicRef;
}

export function refreshMergeWorktreeBase({ repo = "", mergeWorktreeDir = "", remote = "origin" } = {}) {
  const repository = trim(repo);
  const dir = trim(mergeWorktreeDir);
  const remoteName = trim(remote) || "origin";
  if (!repository || !dir) return { merge_base_ref: "main" };
  run(["git", "-C", repository, "fetch", remoteName, "main"], repository);
  const mergeBaseRef = resolveMergeBaseRef({ repo: repository, remote: remoteName });
  writeMergeWorktreeState({ mergeWorktreeDir: dir, patch: { merge_base_ref: mergeBaseRef } });
  return { merge_base_ref: mergeBaseRef };
}

export function checkoutMergeWorktreeRef({ mergeWorktreeDir = "", ref = "" } = {}) {
  const dir = trim(mergeWorktreeDir);
  const targetRef = trim(ref);
  if (!dir || !targetRef) return { code: 1, stdout: "", stderr: "missing worktree or ref" };
  cleanMergeWorkspaceState({ mergeWorktreeDir: dir });
  const checkout = run(["git", "-C", dir, "checkout", "--detach", targetRef], dir);
  if (checkout.code !== 0) return checkout;
  return run(["git", "-C", dir, "reset", "--hard", targetRef], dir);
}

export function setupMergeWorktree({
  repo = "",
  branch = "",
  issueNumber = "",
  runId = "",
  pipeline = "merge",
  mergeWorktreeDir = "",
  remote = "origin",
  bootstrapWorkspaceFn = bootstrapWorkspace,
} = {}) {
  const repository = trim(repo);
  const branchName = trim(branch);
  const resolvedDir = resolveMergeWorktreeDir({ repo: repository, branch: branchName, issueNumber, runId, pipeline, mergeWorktreeDir });
  if (!repository || !branchName || !resolvedDir) {
    return { setup: "false", reason: "missing_setup_inputs", merge_worktree_dir: resolvedDir };
  }

  const guard = ensureDisposableMergePath({ repo: repository, mergeWorktreeDir: resolvedDir });
  if (!guard.ok) {
    return { setup: "false", reason: guard.reason, merge_worktree_dir: resolvedDir };
  }

  run(["git", "-C", repository, "fetch", trim(remote) || "origin", "main"], repository);

  const branchHead = run(["git", "-C", repository, "rev-parse", branchName], repository);
  if (branchHead.code !== 0 || !trim(branchHead.stdout)) {
    return { setup: "false", reason: trim(branchHead.stderr) || "branch_not_found", merge_worktree_dir: resolvedDir };
  }

  const pathType = existingPathType(resolvedDir);
  if (pathType === "directory" && isGitWorktree(resolvedDir)) {
    const bootstrap = bootstrapWorkspaceFn({ repoRoot: repository, workspaceDir: resolvedDir, requiredArtifacts: [] });
    if (!bootstrap?.ok) {
      return {
        setup: "false",
        reason: trim(bootstrap?.reason) || "merge_worktree_bootstrap_failed",
        merge_worktree_dir: resolvedDir,
      };
    }
    const state = writeMergeWorktreeState({
      mergeWorktreeDir: resolvedDir,
      patch: {
        branch: branchName,
        issue_number: trim(issueNumber),
        run_id: trim(runId),
        pipeline: trim(pipeline) || "merge",
        source_branch_head_sha: trim(branchHead.stdout),
        merge_base_ref: resolveMergeBaseRef({ repo: repository, remote }),
      },
    });
    return {
      setup: "true",
      reason: "merge_worktree_exists",
      merge_worktree_dir: resolvedDir,
      merge_base_ref: state.merge_base_ref,
      merge_branch_head_sha: state.source_branch_head_sha,
    };
  }

  if (pathType) {
    rmSync(resolvedDir, { recursive: true, force: true });
  }

  mkdirSync(path.dirname(resolvedDir), { recursive: true });
  const add = run(["git", "-C", repository, "worktree", "add", "--detach", resolvedDir, branchName], repository);
  if (add.code !== 0) {
    return { setup: "false", reason: trim(add.stderr) || "worktree_add_failed", merge_worktree_dir: resolvedDir };
  }
  const bootstrap = bootstrapWorkspaceFn({ repoRoot: repository, workspaceDir: resolvedDir, requiredArtifacts: [] });
  if (!bootstrap?.ok) {
    return {
      setup: "false",
      reason: trim(bootstrap?.reason) || "merge_worktree_bootstrap_failed",
      merge_worktree_dir: resolvedDir,
    };
  }

  const state = writeMergeWorktreeState({
    mergeWorktreeDir: resolvedDir,
    patch: {
      branch: branchName,
      issue_number: trim(issueNumber),
      run_id: trim(runId),
      pipeline: trim(pipeline) || "merge",
      source_branch_head_sha: trim(branchHead.stdout),
      merge_base_ref: resolveMergeBaseRef({ repo: repository, remote }),
    },
  });
  return {
    setup: "true",
    reason: "created_merge_worktree",
    merge_worktree_dir: resolvedDir,
    merge_base_ref: state.merge_base_ref,
    merge_branch_head_sha: state.source_branch_head_sha,
  };
}

export function cleanupMergeWorktree({ repo = "", mergeWorktreeDir = "" } = {}) {
  const repository = trim(repo);
  const resolvedDir = trim(mergeWorktreeDir);
  if (!repository || !resolvedDir || !existsSync(resolvedDir)) {
    return { removed: "false", reason: "merge_worktree_missing", merge_worktree_dir: resolvedDir };
  }
  const guard = guardDisposableCleanup({
    worktreePath: resolvedDir,
    repoPath: repository,
    canonicalCheckoutPath: resolveCanonicalCheckoutPath(),
    operation: "worktree_remove",
    enforceMutationContext: true,
  });
  if (!guard.ok) {
    return { removed: "false", reason: guard.reason, merge_worktree_dir: resolvedDir };
  }
  const result = run(["git", "-C", repository, "worktree", "remove", resolvedDir, "--force"], repository);
  if (result.code !== 0) {
    return { removed: "false", reason: trim(result.stderr) || "worktree_remove_failed", merge_worktree_dir: resolvedDir };
  }
  return { removed: "true", reason: "merge_worktree_removed", merge_worktree_dir: resolvedDir };
}
