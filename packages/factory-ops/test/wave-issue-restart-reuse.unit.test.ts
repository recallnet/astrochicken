import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  decideExistingReuse,
  decideExistingReuseWithNotes,
  inspectExistingCommits,
  setupWaveIssueWorktree,
} from "../src/commands/wave-issue-state.ts";

function sh(args, cwd) {
  const p = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  assert.equal(p.status, 0, p.stderr || p.stdout);
  return String(p.stdout || "").trim();
}

test("decideExistingReuse reuses a shared wave worktree when the current issue already has committed work", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "wave-issue-restart-reuse-"));
  const repoDir = join(rootDir, "repo");
  const worktreeDir = join(rootDir, ".hatch-worktrees", "wave", "goal-610-wave-1");
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(join(rootDir, ".hatch-worktrees", "wave"), { recursive: true });
  sh(["git", "init", "-b", "main"], repoDir);
  sh(["git", "config", "user.email", "taxi@example.com"], repoDir);
  sh(["git", "config", "user.name", "Hatch"], repoDir);
  writeFileSync(join(repoDir, "README.md"), "base\n", "utf8");
  sh(["git", "add", "README.md"], repoDir);
  sh(["git", "commit", "-m", "base"], repoDir);

  sh(["git", "checkout", "-b", "wave/goal-610-wave-1"], repoDir);
  writeFileSync(join(repoDir, "issue-609.txt"), "prior issue\n", "utf8");
  sh(["git", "add", "issue-609.txt"], repoDir);
  sh(["git", "commit", "-m", "feat: prior issue work (#609)"], repoDir);
  writeFileSync(join(repoDir, "issue-610.txt"), "completed issue\n", "utf8");
  sh(["git", "add", "issue-610.txt"], repoDir);
  sh(["git", "commit", "-m", "feat: complete current issue (#610)"], repoDir);
  sh(["git", "checkout", "main"], repoDir);

  const setup = setupWaveIssueWorktree({
    repo: repoDir,
    branch: "wave/goal-610-wave-1",
    worktreeDir,
  });
  assert.equal(setup.setup, "true");
  assert.equal(setup.reason, "attached_existing_branch");

  const existing = inspectExistingCommits({ worktreeDir });
  assert.equal(existing.existing_commits, "2");

  const reuse = decideExistingReuse({
    branch: "wave/goal-610-wave-1",
    existingCommits: existing.existing_commits,
    issueNumber: "610",
    worktreeDir,
  });
  assert.equal(reuse, "true");

  const withNotes = decideExistingReuseWithNotes({
    branch: "wave/goal-610-wave-1",
    existingCommits: existing.existing_commits,
    issueNumber: "610",
    worktreeDir,
  });
  assert.equal(withNotes.reuse_existing_commits, "true");
  assert.match(withNotes.review_notes, /Existing commits already present on branch/);
  assert.match(withNotes.review_notes, /running review without new implementation/);
});
