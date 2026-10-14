import { createBaseGitFixture } from "../helpers/ops-command-fixtures.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { checkoutMergeWorktreeRef, cleanMergeWorkspaceState, cleanupMergeWorktree, currentMergeWorktreeHead, readMergeWorktreeState, refreshMergeWorktreeBase, resolveMergeBaseRef, resolveMergeWorktreeDir, setupMergeWorktree, writeMergeWorktreeState } from "../../src/commands/merge-worktree.ts";

function sh(args, cwd) {
  const result = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  if ((result.status ?? 1) !== 0) throw new Error((result.stderr || result.stdout || "cmd failed").trim());
  return String(result.stdout || "").trim();
}

function initRepo() {
  return createBaseGitFixture("merge-worktree-");
}

function initRepoWithRemote() {
  const remote = mkdtempSync(join(tmpdir(), "merge-worktree-remote-"));
  sh(["git", "init", "--bare"], remote);
  const repo = initRepo();
  sh(["git", "remote", "add", "origin", remote], repo);
  sh(["git", "push", "-u", "origin", "main"], repo);
  return { repo, remote };
}

test("merge-worktree setup persists state and helper exports read/write deterministic metadata", () => {
  const { repo } = initRepoWithRemote();
  sh(["git", "checkout", "-b", "wave/setup-state"], repo);
  writeFileSync(join(repo, "feature.txt"), "feature\n", "utf8");
  sh(["git", "add", "feature.txt"], repo);
  sh(["git", "commit", "-m", "feat: setup state"], repo);
  const branchHead = sh(["git", "rev-parse", "HEAD"], repo);
  sh(["git", "checkout", "main"], repo);

  const mergeWorktreeDir = resolveMergeWorktreeDir({ repo, branch: "wave/setup-state", runId: "state", pipeline: "merge-test" });
  const setup = setupMergeWorktree({
    repo,
    branch: "wave/setup-state",
    runId: "state",
    pipeline: "merge-test",
    mergeWorktreeDir,
    bootstrapWorkspaceFn: ({ repoRoot, workspaceDir }) => {
      assert.equal(repoRoot, repo);
      assert.equal(workspaceDir, mergeWorktreeDir);
      return { ok: true, reason: "workspace_bootstrapped" };
    },
  });
  assert.equal(setup.setup, "true");
  assert.equal(existsSync(mergeWorktreeDir), true);

  const stateBefore = readMergeWorktreeState({ mergeWorktreeDir });
  assert.equal(stateBefore.branch, "wave/setup-state");
  assert.equal(stateBefore.source_branch_head_sha, branchHead);
  // merge_base_ref is always a pinned SHA (not a symbolic ref like "main").
  const resolvedBase = resolveMergeBaseRef({ repo });
  assert.match(resolvedBase, /^[0-9a-f]{40}$/, "resolveMergeBaseRef must return a pinned SHA");

  writeMergeWorktreeState({ mergeWorktreeDir, patch: { persisted_marker: "ok" } });
  const stateAfter = readMergeWorktreeState({ mergeWorktreeDir });
  assert.equal(stateAfter.persisted_marker, "ok");

  const refreshed = refreshMergeWorktreeBase({ repo, mergeWorktreeDir });
  assert.match(refreshed.merge_base_ref, /^[0-9a-f]{40}$/, "refreshMergeWorktreeBase must return a pinned SHA");
  assert.match(readMergeWorktreeState({ mergeWorktreeDir }).merge_base_ref, /^[0-9a-f]{40}$/);
  assert.equal(currentMergeWorktreeHead({ mergeWorktreeDir }), branchHead);

  const cleanup = cleanupMergeWorktree({ repo, mergeWorktreeDir });
  assert.equal(cleanup.removed, "true");
  assert.equal(existsSync(mergeWorktreeDir), false);
});

test("merge-worktree setup fails closed when workspace bootstrap fails", () => {
  const { repo } = initRepoWithRemote();
  sh(["git", "checkout", "-b", "wave/bootstrap-fail"], repo);
  writeFileSync(join(repo, "feature.txt"), "feature\n", "utf8");
  sh(["git", "add", "feature.txt"], repo);
  sh(["git", "commit", "-m", "feat: bootstrap fail"], repo);
  sh(["git", "checkout", "main"], repo);

  const mergeWorktreeDir = resolveMergeWorktreeDir({ repo, branch: "wave/bootstrap-fail", runId: "bootstrap-fail", pipeline: "merge-test" });
  const setup = setupMergeWorktree({
    repo,
    branch: "wave/bootstrap-fail",
    runId: "bootstrap-fail",
    pipeline: "merge-test",
    mergeWorktreeDir,
    bootstrapWorkspaceFn: () => ({ ok: false, reason: "pnpm build failed" }),
  });
  assert.equal(setup.setup, "false");
  assert.equal(setup.reason, "pnpm build failed");
});

test("merge-worktree setup bootstraps target repos without hatch runtime artifact requirements", () => {
  const { repo } = initRepoWithRemote();
  sh(["git", "checkout", "-b", "wave/bootstrap-target"], repo);
  writeFileSync(join(repo, "feature.txt"), "feature\n", "utf8");
  sh(["git", "add", "feature.txt"], repo);
  sh(["git", "commit", "-m", "feat: bootstrap target"], repo);
  sh(["git", "checkout", "main"], repo);

  const mergeWorktreeDir = resolveMergeWorktreeDir({ repo, branch: "wave/bootstrap-target", runId: "bootstrap-target", pipeline: "merge-test" });
  let bootstrapArgs = null;
  const setup = setupMergeWorktree({
    repo,
    branch: "wave/bootstrap-target",
    runId: "bootstrap-target",
    pipeline: "merge-test",
    mergeWorktreeDir,
    bootstrapWorkspaceFn: (args) => {
      bootstrapArgs = args;
      return { ok: true, reason: "workspace_bootstrapped" };
    },
  });
  assert.equal(setup.setup, "true");
  assert.deepEqual(bootstrapArgs, {
    repoRoot: repo,
    workspaceDir: mergeWorktreeDir,
    requiredArtifacts: [],
  });
});

test("merge-worktree helpers reset detached heads and abort in-progress merge state", () => {
  const { repo } = initRepoWithRemote();
  sh(["git", "checkout", "-b", "wave/merge-clean"], repo);
  writeFileSync(join(repo, "file.txt"), "branch\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "feat: branch change"], repo);
  const branchHead = sh(["git", "rev-parse", "HEAD"], repo);
  sh(["git", "checkout", "main"], repo);
  writeFileSync(join(repo, "file.txt"), "main\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "feat: main change"], repo);
  const mainHead = sh(["git", "rev-parse", "HEAD"], repo);

  const mergeWorktreeDir = resolveMergeWorktreeDir({ repo, branch: "wave/merge-clean", runId: "clean", pipeline: "merge-test" });
  assert.equal(setupMergeWorktree({
    repo,
    branch: "wave/merge-clean",
    runId: "clean",
    pipeline: "merge-test",
    mergeWorktreeDir,
    bootstrapWorkspaceFn: () => ({ ok: true, reason: "workspace_bootstrapped" }),
  }).setup, "true");

  const conflict = spawnSync("git", ["-C", mergeWorktreeDir, "merge", "--no-ff", "main"], { encoding: "utf8" });
  assert.notEqual(conflict.status, 0);
  assert.equal(existsSync(join(mergeWorktreeDir, ".git")), true);
  assert.equal(readFileSync(join(mergeWorktreeDir, "file.txt"), "utf8").includes("<<<<<<<"), true);

  const cleaned = cleanMergeWorkspaceState({ mergeWorktreeDir });
  assert.equal(cleaned.ok, true);
  assert.equal(spawnSync("git", ["-C", mergeWorktreeDir, "rev-parse", "-q", "--verify", "MERGE_HEAD"], { encoding: "utf8" }).status, 1);

  const checkout = checkoutMergeWorktreeRef({ mergeWorktreeDir, ref: mainHead });
  assert.equal(checkout.code, 0);
  assert.equal(currentMergeWorktreeHead({ mergeWorktreeDir }), mainHead);

  const restore = checkoutMergeWorktreeRef({ mergeWorktreeDir, ref: branchHead });
  assert.equal(restore.code, 0);
  assert.equal(currentMergeWorktreeHead({ mergeWorktreeDir }), branchHead);

  const cleanup = cleanupMergeWorktree({ repo, mergeWorktreeDir });
  assert.equal(cleanup.removed, "true");
});

test("resolveMergeBaseRef pins SHA so concurrent main advances do not invalidate verification", () => {
  const { repo } = initRepoWithRemote();
  const baseRef = resolveMergeBaseRef({ repo });
  assert.match(baseRef, /^[0-9a-f]{40}$/, "must be a SHA, not a symbolic ref");

  // Advance main with a new commit (simulating a concurrent merge from another goal)
  writeFileSync(join(repo, "concurrent.txt"), "concurrent change\n", "utf8");
  sh(["git", "add", "concurrent.txt"], repo);
  sh(["git", "commit", "-m", "concurrent: advance main"], repo);
  const newMain = sh(["git", "rev-parse", "main"], repo);
  assert.notEqual(baseRef, newMain, "main should have advanced");

  // The pinned SHA is still valid for ancestor checks against merge commits
  // based on the original main — this is the TOCTOU fix.
  const ancestorCheck = spawnSync("git", ["-C", repo, "merge-base", "--is-ancestor", baseRef, newMain], { encoding: "utf8" });
  assert.equal(ancestorCheck.status, 0, "original pinned SHA must be ancestor of advanced main");
});
