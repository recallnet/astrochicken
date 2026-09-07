import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { inspectActiveRunGitSignals } from "../../src/lib/active-run-git-signals.ts";

function run(args, cwd) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd,
    encoding: "utf8",
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(String(result.stderr || result.stdout || "command_failed"));
  }
  return String(result.stdout || "").trim();
}

function makeRepo(prefix = "active-run-git-signals-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  run(["git", "init", "-b", "main"], dir);
  run(["git", "config", "user.name", "Test User"], dir);
  run(["git", "config", "user.email", "test@example.com"], dir);
  writeFileSync(join(dir, "file.txt"), "base\n", "utf8");
  run(["git", "add", "file.txt"], dir);
  run(["git", "commit", "-m", "base"], dir);
  return dir;
}

test("inspectActiveRunGitSignals flags long-running issue slice with no git delta since start", () => {
  const repo = makeRepo();
  const head = run(["git", "show", "-s", "--format=%H", "HEAD"], repo);
  const headCommitAt = run(["git", "show", "-s", "--format=%cI", "HEAD"], repo);
  const startedAt = new Date(Date.parse(headCommitAt) + 1000).toISOString();
  const now = Date.parse(startedAt) + (20 * 60 * 1000);

  const result = inspectActiveRunGitSignals({
    worktreeDir: repo,
    snapshotSha: head,
    startedAt,
    now,
  });

  assert.equal(result.status, "no_delta_since_start");
  assert.equal(result.no_git_delta_since_start, true);
  assert.equal(result.worktree_clean, true);
  assert.equal(result.issue_commits_since_snapshot, 0);
  assert.deepEqual(result.issue_changed_files, []);
});

test("inspectActiveRunGitSignals treats dirty worktree as active git progress", () => {
  const repo = makeRepo("active-run-git-signals-dirty-");
  const head = run(["git", "show", "-s", "--format=%H", "HEAD"], repo);
  writeFileSync(join(repo, "file.txt"), "base\nnext\n", "utf8");

  const result = inspectActiveRunGitSignals({
    worktreeDir: repo,
    snapshotSha: head,
    startedAt: new Date(Date.now() - (20 * 60 * 1000)).toISOString(),
    now: Date.now(),
  });

  assert.equal(result.status, "dirty");
  assert.equal(result.no_git_delta_since_start, false);
  assert.equal(result.worktree_clean, false);
  assert.deepEqual(result.issue_changed_files, ["file.txt"]);
});
