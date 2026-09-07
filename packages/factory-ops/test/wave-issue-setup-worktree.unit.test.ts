import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { setupWaveIssueWorktree } from "../src/commands/wave-issue-state.ts";

function sh(args, cwd) {
  const r = spawnSync(args[0], args.slice(1), { encoding: "utf8", cwd });
  if (r.status !== 0) throw new Error(`${args.join(" ")}: ${r.stderr || r.stdout}`);
}

function makeRepo(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const repoDir = join(root, "repo");
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(join(root, ".hatch-worktrees", "wave"), { recursive: true });
  sh(["git", "init", "-b", "main"], repoDir);
  sh(["git", "config", "user.email", "taxi@example.com"], repoDir);
  sh(["git", "config", "user.name", "Hatch"], repoDir);
  writeFileSync(join(repoDir, "README.md"), "base\n", "utf8");
  sh(["git", "add", "README.md"], repoDir);
  sh(["git", "commit", "-m", "base"], repoDir);
  return { root, repoDir };
}

test("setupWaveIssueWorktree returns missing_setup_inputs when args are empty", () => {
  assert.equal(setupWaveIssueWorktree({}).setup, "false");
  assert.equal(setupWaveIssueWorktree({}).reason, "missing_setup_inputs");
});

test("setupWaveIssueWorktree returns setup=true when valid worktree already exists", () => {
  const { repoDir, root } = makeRepo("wave-setup-existing-");
  const existing = join(root, ".hatch-worktrees", "wave", "existing");
  sh(["git", "-C", repoDir, "worktree", "add", "-b", "wave/x", existing, "main"], repoDir);
  const out = setupWaveIssueWorktree({ repo: repoDir, branch: "wave/x", worktreeDir: existing });
  assert.equal(out.setup, "true", "existing valid worktree is reusable");
  assert.equal(out.reason, "worktree_exists");
  sh(["git", "-C", repoDir, "worktree", "remove", existing, "--force"], repoDir);
});

test("setupWaveIssueWorktree cleans stale non-git directory and creates real worktree", () => {
  const { repoDir, root } = makeRepo("wave-setup-stale-dir-");
  const stale = join(root, ".hatch-worktrees", "wave", "stale-dir");
  mkdirSync(stale, { recursive: true });
  writeFileSync(join(stale, ".cwd-bootstrap"), "ok", "utf8");
  const out = setupWaveIssueWorktree({ repo: repoDir, branch: "wave/stale-test", worktreeDir: stale });
  assert.equal(out.setup, "true", `expected setup=true, got reason=${out.reason}`);
  assert.equal(out.reason, "created_branch_from_main");
  sh(["git", "-C", repoDir, "worktree", "remove", stale, "--force"], repoDir);
});

test("setupWaveIssueWorktree removes broken symlink and creates real worktree", () => {
  // Regression: a broken symlink (pointing to nonexistent /tmp path) left by a
  // prior crashed run must be removed before git worktree add. If not removed,
  // the pipeline proceeds with an invalid worktree directory causing downstream
  // failures (judge_review_evidence_not_found, unsubstituted template vars).
  const { repoDir, root } = makeRepo("wave-setup-broken-symlink-repo-");
  const worktreeDir = join(root, ".hatch-worktrees", "wave", `broken-symlink-${Date.now()}`);
  symlinkSync("/tmp/nonexistent-placeholder-path-xyz", worktreeDir);
  assert.equal(existsSync(worktreeDir), false, "broken symlink must not resolve via existsSync");
  const result = setupWaveIssueWorktree({ repo: repoDir, branch: "wave/broken-symlink-test", worktreeDir });
  assert.equal(result.setup, "true", `expected setup=true, got reason=${result.reason}`);
  assert.equal(result.reason, "created_branch_from_main");
  assert.equal(existsSync(worktreeDir), true, "worktree path must be a real directory after setup");
  sh(["git", "-C", repoDir, "worktree", "remove", worktreeDir, "--force"], repoDir);
});

test("setupWaveIssueWorktree recovers from stale worktree with immutable-flagged files", () => {
  // Regression: macOS uchg flags on .canonical-checkout prevent rmSync from
  // clearing stale worktree directories. The worktree directory persists,
  // git worktree add fails with "already exists", and every subsequent tick
  // repeats the same failure in a stuck loop.
  const { repoDir, root } = makeRepo("wave-setup-uchg-");
  const worktreeDir = join(root, ".hatch-worktrees", "wave", `uchg-${Date.now()}`);
  mkdirSync(worktreeDir, { recursive: true });
  const flaggedFile = join(worktreeDir, ".canonical-checkout");
  writeFileSync(flaggedFile, "/some/path\n", "utf8");
  // Set immutable flag (macOS uchg) — this is what prevents rmSync from working.
  spawnSync("chflags", ["uchg", flaggedFile], { encoding: "utf8" });
  // Verify the flag is set — rmSync with force should fail on this file.
  const rmTest = spawnSync("rm", [flaggedFile], { encoding: "utf8" });
  if (rmTest.status !== 0) {
    // Flag was set successfully — the real test scenario.
    const result = setupWaveIssueWorktree({ repo: repoDir, branch: "wave/uchg-test", worktreeDir });
    assert.equal(result.setup, "true", `expected setup=true after uchg recovery, got reason=${result.reason}`);
    assert.equal(existsSync(worktreeDir), true, "worktree must be a valid directory after recovery");
    sh(["git", "-C", repoDir, "worktree", "remove", worktreeDir, "--force"], repoDir);
  } else {
    // chflags not supported (Linux CI) — just verify normal stale cleanup works.
    mkdirSync(worktreeDir, { recursive: true });
    writeFileSync(join(worktreeDir, ".canonical-checkout"), "/some/path\n", "utf8");
    const result = setupWaveIssueWorktree({ repo: repoDir, branch: "wave/uchg-test", worktreeDir });
    assert.equal(result.setup, "true", `expected setup=true for stale cleanup, got reason=${result.reason}`);
    sh(["git", "-C", repoDir, "worktree", "remove", worktreeDir, "--force"], repoDir);
  }
});

test("setupWaveIssueWorktree recovers from deleted-but-registered worktree (stale git metadata)", () => {
  // Regression: when a worktree directory is deleted (e.g. by cleanup_goal_worktree
  // from a previous run) but git still has its registration in .git/worktrees/,
  // `git worktree add` fails with:
  //   fatal: '<path>' is a missing but already registered worktree;
  //   use 'add -f' to override, or 'prune' or 'move' to clear/fix.
  // The fix: call `git worktree prune` before attempting `git worktree add`.
  const { repoDir, root } = makeRepo("wave-setup-stale-registration-");
  const worktreeDir = join(root, ".hatch-worktrees", "wave", `stale-reg-${Date.now()}`);

  // Step 1: Create a real worktree so git registers it
  sh(["git", "-C", repoDir, "worktree", "add", "-b", "wave/stale-reg", worktreeDir, "main"], repoDir);
  assert.equal(existsSync(worktreeDir), true, "worktree should exist after add");

  // Step 2: Delete the directory WITHOUT telling git (simulates crash/external cleanup)
  rmSync(worktreeDir, { recursive: true, force: true });
  assert.equal(existsSync(worktreeDir), false, "worktree dir should be gone");

  // Step 3: Verify git still thinks it's registered (the bug scenario)
  const listResult = spawnSync("git", ["-C", repoDir, "worktree", "list"], { encoding: "utf8" });
  assert.ok(listResult.stdout.includes(worktreeDir), "git should still list the stale worktree");

  // Step 4: setupWaveIssueWorktree should recover by pruning stale registrations
  const result = setupWaveIssueWorktree({ repo: repoDir, branch: "wave/stale-reg", worktreeDir });
  assert.equal(result.setup, "true", `expected setup=true, got reason=${result.reason}`);
  assert.equal(existsSync(worktreeDir), true, "worktree directory must exist after recovery");

  // Cleanup
  sh(["git", "-C", repoDir, "worktree", "remove", worktreeDir, "--force"], repoDir);
});

test("setupWaveIssueWorktree recovers from dangling checkout with dead .git worktree pointer", () => {
  const { repoDir, root } = makeRepo("wave-setup-dead-gitdir-");
  const worktreeDir = join(root, ".hatch-worktrees", "wave", `dead-gitdir-${Date.now()}`);

  sh(["git", "-C", repoDir, "worktree", "add", "-b", "wave/dead-gitdir", worktreeDir, "main"], repoDir);
  const gitFile = join(worktreeDir, ".git");
  const gitdirLine = String(spawnSync("cat", [gitFile], { encoding: "utf8" }).stdout || "").trim();
  const gitdirPath = gitdirLine.replace(/^gitdir:\s*/, "");

  assert.equal(existsSync(worktreeDir), true, "worktree checkout should exist after add");
  assert.equal(existsSync(gitdirPath), true, "git worktree metadata should exist after add");

  rmSync(gitdirPath, { recursive: true, force: true });
  assert.equal(existsSync(gitdirPath), false, "worktree metadata should be gone to simulate dangling checkout");
  assert.equal(existsSync(worktreeDir), true, "checkout directory remains behind as residue");

  const result = setupWaveIssueWorktree({ repo: repoDir, branch: "wave/dead-gitdir", worktreeDir });
  assert.equal(result.setup, "true", `expected setup=true after dead gitdir recovery, got reason=${result.reason}`);
  assert.equal(existsSync(worktreeDir), true, "worktree directory must exist after recovery");

  const gitCheck = spawnSync("git", ["-C", worktreeDir, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  assert.equal(gitCheck.status, 0, gitCheck.stderr || gitCheck.stdout);
  assert.equal(String(gitCheck.stdout || "").trim(), "true");

  sh(["git", "-C", repoDir, "worktree", "remove", worktreeDir, "--force"], repoDir);
});

test("setupWaveIssueWorktree creates branch from main when branch does not exist", () => {
  const { repoDir, root } = makeRepo("wave-setup-new-branch-repo-");
  const worktreeDir = join(root, ".hatch-worktrees", "wave", `new-branch-${Date.now()}`);
  const result = setupWaveIssueWorktree({ repo: repoDir, branch: "wave/new-branch-test", worktreeDir });
  assert.equal(result.setup, "true");
  assert.equal(result.reason, "created_branch_from_main");
  assert.equal(existsSync(worktreeDir), true);
  sh(["git", "-C", repoDir, "worktree", "remove", worktreeDir, "--force"], repoDir);
});
