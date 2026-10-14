import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateWorkRepo } from "../src/commands/wave-issue-state.ts";

export function registerWaveIssueValidateRepoCases() {
function sh(args, cwd) {
  const p = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  assert.equal(p.status, 0, p.stderr || p.stdout);
  return String(p.stdout || "").trim();
}

test("validateWorkRepo reports valid git worktree", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "wave-issue-validate-repo-"));
  sh(["git", "init", "-b", "main"], repoDir);
  sh(["git", "config", "user.email", "taxi@example.com"], repoDir);
  sh(["git", "config", "user.name", "Hatch"], repoDir);
  writeFileSync(join(repoDir, "README.md"), "base\n", "utf8");
  sh(["git", "add", "README.md"], repoDir);
  sh(["git", "commit", "-m", "base"], repoDir);

  const validRepo = validateWorkRepo({ repo: repoDir });
  assert.equal(validRepo.valid, "true");
  assert.equal(validRepo.reason, "ok");
  assert.ok(String(validRepo.git_root || "").endsWith(repoDir));
});

test("validateWorkRepo reports missing and non-git repo paths", () => {
  const root = mkdtempSync(join(tmpdir(), "wave-issue-validate-repo-missing-"));
  const missingRepo = validateWorkRepo({ repo: join(root, "missing-repo") });
  assert.equal(missingRepo.valid, "false");
  assert.equal(missingRepo.reason, "repo_path_missing");

  const nonGitDir = mkdtempSync(join(tmpdir(), "wave-issue-non-git-dir-"));
  const notGit = validateWorkRepo({ repo: nonGitDir });
  assert.equal(notGit.valid, "false");
  assert.equal(notGit.reason, "repo_not_git_worktree");
});

}
