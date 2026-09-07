import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { finalizeMergeCommit } from "../../src/commands/merge-item-ops.ts";

// ── Helpers ───────────────────────────────────────────────────

function sh(args, cwd) {
  const p = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  if ((p.status ?? 1) !== 0) throw new Error((p.stderr || p.stdout || "cmd failed").trim());
  return String(p.stdout || "").trim();
}

function initRepo() {
  const repo = mkdtempSync(join(tmpdir(), "taxi-finalize-"));
  sh(["git", "init", "-b", "main"], repo);
  sh(["git", "config", "user.email", "taxi@example.com"], repo);
  sh(["git", "config", "user.name", "Hatch"], repo);
  writeFileSync(join(repo, "file.txt"), "base\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "base"], repo);
  return repo;
}

/** Create a conflicting merge state: main and branch both modify the same file. */
function setupConflictingMerge(repo) {
  // Branch with a change
  sh(["git", "checkout", "-b", "wave/test"], repo);
  writeFileSync(join(repo, "file.txt"), "branch change\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "branch change"], repo);

  // Main with a conflicting change
  sh(["git", "checkout", "main"], repo);
  writeFileSync(join(repo, "file.txt"), "main change\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "main change"], repo);

  // Attempt merge — will conflict
  spawnSync("git", ["merge", "--no-ff", "wave/test"], { cwd: repo, encoding: "utf8" });
}

// ── Tests ────────────────────────────────────────────────────

test("finalizeMergeCommit — returns ok when no MERGE_HEAD present", () => {
  const repo = initRepo();
  const out = finalizeMergeCommit({ repo });
  assert.equal(out.finalize_status, "ok");
  assert.equal(out.finalize_reason, "no_merge_head");
});

test("finalizeMergeCommit — auto-commits when MERGE_HEAD present and conflicts resolved", () => {
  const repo = initRepo();
  setupConflictingMerge(repo);

  // Resolve the conflict manually
  writeFileSync(join(repo, "file.txt"), "resolved content\n", "utf8");
  sh(["git", "add", "file.txt"], repo);

  // MERGE_HEAD should exist, conflicts resolved, but no commit yet
  const mh = spawnSync("git", ["-C", repo, "rev-parse", "-q", "--verify", "MERGE_HEAD"], { encoding: "utf8" });
  assert.equal(mh.status, 0, "MERGE_HEAD should exist before finalize");

  const out = finalizeMergeCommit({ repo });
  assert.equal(out.finalize_status, "ok");
  assert.equal(out.finalize_reason, "merge_committed");

  // Verify MERGE_HEAD is gone
  const mh2 = spawnSync("git", ["-C", repo, "rev-parse", "-q", "--verify", "MERGE_HEAD"], { encoding: "utf8" });
  assert.notEqual(mh2.status, 0, "MERGE_HEAD should be gone after finalize");
});

test("finalizeMergeCommit — returns needs_retry when unmerged paths remain", () => {
  const repo = initRepo();
  setupConflictingMerge(repo);

  // Don't resolve — leave conflict markers
  const out = finalizeMergeCommit({ repo });
  assert.equal(out.finalize_status, "needs_retry");
  assert.equal(out.finalize_reason, "unmerged_paths");
});

test("finalizeMergeCommit — returns needs_retry when conflict markers remain in staged files", () => {
  const repo = initRepo();
  setupConflictingMerge(repo);

  // "Resolve" but leave conflict markers in the file
  writeFileSync(join(repo, "file.txt"), "<<<<<<< HEAD\nmain\n=======\nbranch\n>>>>>>> wave/test\n", "utf8");
  sh(["git", "add", "file.txt"], repo);

  const out = finalizeMergeCommit({ repo });
  assert.equal(out.finalize_status, "needs_retry");
  assert.equal(out.finalize_reason, "conflict_markers_remain");
  assert.equal(out.finalize_detail, "file.txt");
});

test("finalizeMergeCommit — returns needs_retry when on wrong branch", () => {
  const repo = initRepo();
  sh(["git", "checkout", "-b", "wave/wrong"], repo);

  const out = finalizeMergeCommit({ repo, expectedBranch: "main" });
  // After switching to main, no MERGE_HEAD → ok
  assert.equal(out.finalize_status, "ok");
  assert.equal(out.finalize_reason, "no_merge_head");

  // Verify we're on main now
  const branch = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], repo);
  assert.equal(branch, "main");
});

test("finalizeMergeCommit — returns needs_retry when expectedBranch checkout fails", () => {
  const repo = initRepo();
  const out = finalizeMergeCommit({ repo, expectedBranch: "nonexistent-branch" });
  assert.equal(out.finalize_status, "needs_retry");
  assert.equal(out.finalize_reason, "wrong_branch");
  assert.ok(out.finalize_detail.includes("nonexistent-branch"));
});

test("finalizeMergeCommit — returns ok with no_repo when empty", () => {
  const out = finalizeMergeCommit({});
  assert.equal(out.finalize_status, "ok");
  assert.equal(out.finalize_reason, "no_repo");
});

test("finalizeMergeCommit — works with worktreeDir parameter", () => {
  const repo = initRepo();
  // worktreeDir takes priority over repo
  const out = finalizeMergeCommit({ repo: "/nonexistent", worktreeDir: repo });
  assert.equal(out.finalize_status, "ok");
  assert.equal(out.finalize_reason, "no_merge_head");
});

test("finalizeMergeCommit — uses commitMessage for merge commit when provided", () => {
  const repo = initRepo();
  setupConflictingMerge(repo);

  // Resolve the conflict
  writeFileSync(join(repo, "file.txt"), "resolved content\n", "utf8");
  sh(["git", "add", "file.txt"], repo);

  const msg = "feat(goal-42): Test goal (#42)\n\nCloses #100, #101";
  const out = finalizeMergeCommit({ repo, commitMessage: msg });
  assert.equal(out.finalize_status, "ok");
  assert.equal(out.finalize_reason, "merge_committed");

  // Verify the commit message
  const log = sh(["git", "log", "-1", "--format=%s"], repo);
  assert.equal(log, "feat(goal-42): Test goal (#42)");
});

test("finalizeMergeCommit — uses --no-edit when commitMessage is empty", () => {
  const repo = initRepo();
  setupConflictingMerge(repo);

  // Resolve the conflict
  writeFileSync(join(repo, "file.txt"), "resolved content\n", "utf8");
  sh(["git", "add", "file.txt"], repo);

  const out = finalizeMergeCommit({ repo, commitMessage: "" });
  assert.equal(out.finalize_status, "ok");
  assert.equal(out.finalize_reason, "merge_committed");

  // Verify the default merge message (from --no-edit)
  const log = sh(["git", "log", "-1", "--format=%s"], repo);
  assert.ok(log.includes("Merge"), "default merge message should contain 'Merge'");
});

test("finalizeMergeCommit — does NOT use --no-verify, allows hooks to run", () => {
  const repo = initRepo();
  setupConflictingMerge(repo);

  // Resolve the conflict
  writeFileSync(join(repo, "file.txt"), "resolved content\n", "utf8");
  sh(["git", "add", "file.txt"], repo);

  // Spy on runFn to capture the commit args
  const calls = [];
  const spyRunFn = (args) => {
    calls.push(args);
    const p = spawnSync(args[0], args.slice(1), { encoding: "utf8" });
    return { code: p.status ?? 1, stdout: p.stdout || "", stderr: p.stderr || "" };
  };

  const out = finalizeMergeCommit({ repo, runFn: spyRunFn });
  assert.equal(out.finalize_status, "ok");
  assert.equal(out.finalize_reason, "merge_committed");

  // Find the commit call — must NOT contain --no-verify
  const commitCall = calls.find((c) => c.includes("commit"));
  assert.ok(commitCall, "should have called git commit");
  assert.ok(!commitCall.includes("--no-verify"), "merge commit must NOT use --no-verify — hooks must run");
});

test("finalizeMergeCommit — reports hook_failed when commit fails due to hooks", () => {
  const repo = initRepo();
  setupConflictingMerge(repo);

  // Resolve the conflict
  writeFileSync(join(repo, "file.txt"), "resolved content\n", "utf8");
  sh(["git", "add", "file.txt"], repo);

  // Mock runFn to simulate a hook failure on commit
  const spyRunFn = (args) => {
    if (args.includes("commit")) {
      return {
        code: 1,
        stdout: "",
        stderr: "[pre-commit] failed (full log: .hook-logs/pre-commit.log)\nrun-gates.mjs exited with code 1",
      };
    }
    const p = spawnSync(args[0], args.slice(1), { encoding: "utf8" });
    return { code: p.status ?? 1, stdout: p.stdout || "", stderr: p.stderr || "" };
  };

  const out = finalizeMergeCommit({ repo, runFn: spyRunFn });
  assert.equal(out.finalize_status, "needs_retry");
  assert.equal(out.finalize_reason, "hook_failed", "must distinguish hook failures from generic commit failures");
  assert.ok(out.finalize_detail.includes("[pre-commit]"), "must pass through hook stderr");
});
