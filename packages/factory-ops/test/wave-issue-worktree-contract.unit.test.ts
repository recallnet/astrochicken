import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { initWaveIssueWorktree } from "../src/commands/wave-issue-init.ts";
import { cleanupLegacyWorktree, cleanupWaveIssueWorktree, setupWaveIssueWorktree } from "../src/commands/wave-issue-state.ts";
import { cleanupWaveIssueWorktree as cleanupWaveIssueWorktreeDirect } from "../src/commands/wave-issue-worktree.ts";

function sh(args, cwd) {
  const p = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  assert.equal(p.status, 0, p.stderr || p.stdout);
  return String(p.stdout || "").trim();
}

test("initWaveIssueWorktree defaults branch/worktree/session and exposes legacy compatibility path", () => {
  const out = initWaveIssueWorktree({ issueNumber: "123", repo: "/tmp/repo" });
  assert.equal(out.branch, "wave/123");
  assert.equal(out.worktree_dir, "/tmp/.hatch-worktrees/wave/123");
  assert.equal(out.legacy_worktree_dir, "/tmp/.hatch-worktrees/issue-123");
  assert.match(out.agent_session_id, /^worktree-/);
});

test("initWaveIssueWorktree avoids double-nesting wave/wave/ in worktree path", () => {
  // When the branch starts with the same prefix as the kind root (wave/),
  // the path must NOT double-nest as wave/wave/goal-1940-wave-2.
  // The root .hatch-worktrees/wave/ already groups by kind; the branch
  // should nest under it without repeating the kind prefix.
  const out = initWaveIssueWorktree({
    issueNumber: "1983",
    repo: "/tmp/repo",
    branch: "wave/goal-1940-wave-2",
  });
  assert.equal(out.branch, "wave/goal-1940-wave-2");
  assert.equal(out.worktree_dir, "/tmp/.hatch-worktrees/wave/goal-1940-wave-2");
  assert.doesNotMatch(out.worktree_dir, /wave\/wave\//,
    "worktree path must not contain wave/wave/ double-nesting");
});

test("initWaveIssueWorktree preserves explicit legacy worktree dir override", () => {
  const out = initWaveIssueWorktree({
    issueNumber: "456",
    repo: "/tmp/repo",
    branch: "wave/456",
    worktreeDir: "/tmp/.hatch-worktrees/issue-456",
  });
  assert.equal(out.branch, "wave/456");
  assert.equal(out.worktree_dir, "/tmp/.hatch-worktrees/issue-456");
  assert.equal(out.legacy_worktree_dir, "/tmp/.hatch-worktrees/issue-456");
});

test("setupWaveIssueWorktree rejects cleanup paths outside approved disposable roots", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "wave-issue-unapproved-repo-"));
  sh(["git", "init", "-b", "main"], repoDir);
  sh(["git", "config", "user.email", "taxi@example.com"], repoDir);
  sh(["git", "config", "user.name", "Hatch"], repoDir);
  writeFileSync(join(repoDir, "README.md"), "base\n", "utf8");
  sh(["git", "add", "README.md"], repoDir);
  sh(["git", "commit", "-m", "base"], repoDir);

  const out = setupWaveIssueWorktree({
    repo: repoDir,
    branch: "wave/unsafe",
    worktreeDir: join(repoDir, "scratch", "unsafe"),
  });
  assert.equal(out.setup, "false");
  assert.match(out.reason, /disposable_worktree_path_not_approved/);
});

test("cleanupLegacyWorktree blocks canonical checkout targets", () => {
  const previousCanonical = process.env.HATCH_CANONICAL_CHECKOUT_PATH;
  try {
    process.env.HATCH_CANONICAL_CHECKOUT_PATH = "/tmp/repo";
    const out = cleanupLegacyWorktree({ repo: "/tmp/repo", legacyWorktreeDir: "/tmp/repo" });
    assert.equal(out.removed, "false");
    assert.match(out.reason, /legacy_worktree_missing|canonical_checkout_worktree_remove_blocked|disposable_worktree_path_not_approved/);
  } finally {
    if (previousCanonical === undefined) delete process.env.HATCH_CANONICAL_CHECKOUT_PATH;
    else process.env.HATCH_CANONICAL_CHECKOUT_PATH = previousCanonical;
  }
});

test("cleanupWaveIssueWorktree blocks canonical, repo-root, and unapproved targets", () => {
  const previousCanonical = process.env.HATCH_CANONICAL_CHECKOUT_PATH;
  const repoDir = mkdtempSync(join(tmpdir(), "wave-cleanup-repo-"));
  const scratchDir = join(repoDir, "scratch", "unsafe");
  mkdirSync(scratchDir, { recursive: true });
  try {
    process.env.HATCH_CANONICAL_CHECKOUT_PATH = repoDir;
    const canonical = cleanupWaveIssueWorktree({ repo: repoDir, worktreeDir: repoDir });
    assert.equal(canonical.removed, "false");
    assert.match(canonical.reason, /canonical_checkout_worktree_remove_blocked/);

    process.env.HATCH_CANONICAL_CHECKOUT_PATH = join(repoDir, "canonical-elsewhere");
    const repoRoot = cleanupWaveIssueWorktree({ repo: repoDir, worktreeDir: repoDir });
    assert.equal(repoRoot.removed, "false");
    assert.match(repoRoot.reason, /repo_root_worktree_remove_blocked/);

    const unapproved = cleanupWaveIssueWorktree({ repo: repoDir, worktreeDir: scratchDir });
    assert.equal(unapproved.removed, "false");
    assert.match(unapproved.reason, /disposable_worktree_path_not_approved/);
  } finally {
    if (previousCanonical === undefined) delete process.env.HATCH_CANONICAL_CHECKOUT_PATH;
    else process.env.HATCH_CANONICAL_CHECKOUT_PATH = previousCanonical;
  }
});

test("cleanupWaveIssueWorktree direct export remains wired to the guarded cleanup contract", () => {
  const out = cleanupWaveIssueWorktreeDirect({ repo: "/tmp/repo", worktreeDir: "" });
  assert.equal(out.removed, "false");
  assert.equal(out.reason, "wave_worktree_missing");
});
