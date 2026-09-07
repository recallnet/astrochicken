import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assertMainClean } from "../../src/commands/merge-item-ops.ts";

/**
 * Helper: create a temporary git repo on branch "main" with one commit.
 */
function makeTestRepo() {
  const dir = mkdtempSync(join(tmpdir(), "assert-main-clean-"));
  const run = (args) => spawnSync(args[0], args.slice(1), { cwd: dir, encoding: "utf8", timeout: 10_000 });
  run(["git", "init", "-b", "main"]);
  run(["git", "config", "user.email", "test@test.com"]);
  run(["git", "config", "user.name", "Test"]);
  writeFileSync(join(dir, "README.md"), "# test\n");
  run(["git", "add", "."]);
  run(["git", "commit", "-m", "init"]);
  return { dir, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ── Clean state ──────────────────────────────────────────────────────

test("assertMainClean returns clean=true for a clean repo on main", () => {
  const { dir, cleanup } = makeTestRepo();
  try {
    const result = assertMainClean({ repo: dir });
    assert.equal(result.clean, true);
    assert.equal(result.untracked_count, 0);
    assert.equal(result.modified_count, 0);
    assert.equal(result.partial_state, "none");
  } finally {
    cleanup();
  }
});

// ── Untracked files ──────────────────────────────────────────────────

test("assertMainClean detects untracked files", () => {
  const { dir, cleanup } = makeTestRepo();
  try {
    writeFileSync(join(dir, "stray-file.mjs"), "// leftover\n");
    writeFileSync(join(dir, "another-stray.mjs"), "// leftover\n");
    const result = assertMainClean({ repo: dir });
    assert.equal(result.clean, false);
    assert.equal(result.untracked_count, 2);
    assert.ok(result.untracked_files.includes("stray-file.mjs"));
    assert.ok(result.untracked_files.includes("another-stray.mjs"));
  } finally {
    cleanup();
  }
});

// ── Modified tracked files ───────────────────────────────────────────

test("assertMainClean detects modified tracked files", () => {
  const { dir, cleanup } = makeTestRepo();
  try {
    writeFileSync(join(dir, "README.md"), "# modified\n");
    const result = assertMainClean({ repo: dir });
    assert.equal(result.clean, false);
    assert.equal(result.modified_count, 1);
    assert.ok(result.modified_files.includes("README.md"));
  } finally {
    cleanup();
  }
});

// ── Staged but uncommitted files ─────────────────────────────────────

test("assertMainClean detects staged but uncommitted files", () => {
  const { dir, run, cleanup } = makeTestRepo();
  try {
    writeFileSync(join(dir, "staged.mjs"), "// staged\n");
    run(["git", "add", "staged.mjs"]);
    const result = assertMainClean({ repo: dir });
    assert.equal(result.clean, false);
    // staged files show up in modified or untracked counts
    assert.ok(result.modified_count > 0 || result.untracked_count > 0);
  } finally {
    cleanup();
  }
});

// ── Partial bisect state ─────────────────────────────────────────────

test("assertMainClean detects bisect in progress", () => {
  const { dir, run, cleanup } = makeTestRepo();
  try {
    run(["git", "bisect", "start"]);
    const result = assertMainClean({ repo: dir });
    assert.equal(result.clean, false);
    assert.equal(result.partial_state, "bisect");
  } finally {
    cleanup();
  }
});

// ── Partial rebase state ─────────────────────────────────────────────

test("assertMainClean detects rebase in progress", () => {
  const { dir, run, cleanup } = makeTestRepo();
  try {
    // Create a rebase-in-progress state by creating a conflicting branch
    run(["git", "checkout", "-b", "conflict-branch"]);
    writeFileSync(join(dir, "README.md"), "# conflict branch\n");
    run(["git", "add", "."]);
    run(["git", "commit", "-m", "branch change"]);
    run(["git", "checkout", "main"]);
    writeFileSync(join(dir, "README.md"), "# main change\n");
    run(["git", "add", "."]);
    run(["git", "commit", "-m", "main change"]);
    // This rebase will conflict
    run(["git", "checkout", "conflict-branch"]);
    run(["git", "rebase", "main"]);
    // Now we're in rebase state with conflicts — switch context to check
    const result = assertMainClean({ repo: dir });
    assert.equal(result.clean, false);
    assert.equal(result.partial_state, "rebase");
  } finally {
    cleanup();
  }
});

// ── Partial merge state ──────────────────────────────────────────────

test("assertMainClean detects merge in progress", () => {
  const { dir, run, cleanup } = makeTestRepo();
  try {
    run(["git", "checkout", "-b", "merge-branch"]);
    writeFileSync(join(dir, "README.md"), "# merge branch\n");
    run(["git", "add", "."]);
    run(["git", "commit", "-m", "merge change"]);
    run(["git", "checkout", "main"]);
    writeFileSync(join(dir, "README.md"), "# main change\n");
    run(["git", "add", "."]);
    run(["git", "commit", "-m", "main change"]);
    // This merge will conflict, leaving merge state
    run(["git", "merge", "merge-branch"]);
    const result = assertMainClean({ repo: dir });
    assert.equal(result.clean, false);
    assert.equal(result.partial_state, "merge");
  } finally {
    cleanup();
  }
});

// ── Combined dirty state ─────────────────────────────────────────────

test("assertMainClean reports both untracked and modified together", () => {
  const { dir, cleanup } = makeTestRepo();
  try {
    writeFileSync(join(dir, "README.md"), "# modified\n");
    writeFileSync(join(dir, "stray.mjs"), "// untracked\n");
    const result = assertMainClean({ repo: dir });
    assert.equal(result.clean, false);
    assert.equal(result.untracked_count, 1);
    assert.equal(result.modified_count, 1);
  } finally {
    cleanup();
  }
});

// ── Wrong branch ────────────────────────────────────────────────────

test("assertMainClean reports clean=false when on a feature branch", () => {
  const { dir, run, cleanup } = makeTestRepo();
  try {
    run(["git", "checkout", "-b", "goal/2332"]);
    const result = assertMainClean({ repo: dir });
    assert.equal(result.clean, false, "should be dirty when not on main");
    assert.equal(result.branch, "goal/2332");
    assert.equal(result.partial_state, "wrong_branch");
  } finally {
    cleanup();
  }
});

test("assertMainClean reports branch=main when on main", () => {
  const { dir, cleanup } = makeTestRepo();
  try {
    const result = assertMainClean({ repo: dir });
    assert.equal(result.clean, true);
    assert.equal(result.branch, "main");
  } finally {
    cleanup();
  }
});

// ── Missing repo ─────────────────────────────────────────────────────

test("assertMainClean returns error for missing repo", () => {
  const result = assertMainClean({ repo: "" });
  assert.equal(result.clean, false);
  assert.equal(result.error, "missing_repo");
});

// ── Ignores .hatch directories ───────────────────────────────────────

test("assertMainClean ignores .hatch and .hatch-worktrees directories", () => {
  const { dir, cleanup } = makeTestRepo();
  try {
    mkdirSync(join(dir, ".hatch"), { recursive: true });
    writeFileSync(join(dir, ".hatch", "state.json"), "{}");
    mkdirSync(join(dir, ".hatch-worktrees"), { recursive: true });
    writeFileSync(join(dir, ".hatch-worktrees", "temp"), "x");
    const result = assertMainClean({ repo: dir });
    assert.equal(result.clean, true);
    assert.equal(result.untracked_count, 0);
  } finally {
    cleanup();
  }
});
