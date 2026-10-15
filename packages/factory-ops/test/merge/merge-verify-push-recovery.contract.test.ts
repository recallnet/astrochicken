import { createBaseGitFixture } from "../helpers/ops-command-fixtures.ts";
import { runFixtureCommand as sh } from "../helpers/ops-command-fixtures.ts";
import assert from "node:assert/strict";

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { attemptDeterministicMerge, rebaseBranchOnMain } from "../../src/commands/merge-item-ops.ts";
import { verifyPushRecovery } from "../../src/commands/merge-verify-push-recovery.ts";
import { resolveMergeWorktreeDir, setupMergeWorktree } from "../../src/commands/merge-worktree.ts";

function initRepo() {
  return createBaseGitFixture("taxi-merge-");
}

function initRepoWithBareRemote() {
  const remote = mkdtempSync(join(tmpdir(), "taxi-merge-remote-"));
  sh(["git", "init", "--bare", "-b", "main"], remote);
  const repo = initRepo();
  sh(["git", "remote", "add", "origin", remote], repo);
  sh(["git", "push", "-u", "origin", "main"], repo);
  return { repo, remote };
}

test("verifyPushRecovery fails closed when canonical main cannot fast-forward to origin/main", () => {
  const { repo, remote } = initRepoWithBareRemote();

  sh(["git", "checkout", "-b", "wave/push-recovery"], repo);
  writeFileSync(join(repo, "feature.txt"), "feature\n", "utf8");
  sh(["git", "add", "feature.txt"], repo);
  sh(["git", "commit", "-m", "feature work"], repo);
  sh(["git", "checkout", "main"], repo);

  const mergeWorktreeDir = resolveMergeWorktreeDir({ repo, branch: "wave/push-recovery", runId: "verify", pipeline: "merge-test" });
  const setup = setupMergeWorktree({ repo, branch: "wave/push-recovery", runId: "verify", pipeline: "merge-test", mergeWorktreeDir });
  assert.equal(setup.setup, "true");

  const rebase = rebaseBranchOnMain({ repo, branch: "wave/push-recovery", mergeWorktreeDir });
  assert.equal(rebase.rebase_status, "ready");

  const merge = attemptDeterministicMerge({
    repo,
    branch: "wave/push-recovery",
    mergeWorktreeDir,
    branchHeadSha: rebase.merge_branch_head_sha,
  });
  assert.equal(merge.merge_status, "merged");

  const other = mkdtempSync(join(tmpdir(), "taxi-merge-other-"));
  sh(["git", "clone", remote, other], process.cwd());
  sh(["git", "config", "user.email", "taxi@example.com"], other);
  sh(["git", "config", "user.name", "Hatch"], other);
  writeFileSync(join(other, "file.txt"), "remote advance\n", "utf8");
  sh(["git", "add", "file.txt"], other);
  sh(["git", "commit", "-m", "remote advance"], other);
  sh(["git", "push", "origin", "main"], other);

  writeFileSync(join(repo, "file.txt"), "local divergent edit\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "local divergent edit"], repo);

  const verify = verifyPushRecovery({ repo, branch: "main", remote: "origin", mergeWorktreeDir });
  assert.equal(verify.resolution_status, "unresolved");
  assert.match(verify.resolution_notes, /canonical_main_not_fast_forwardable_to_origin\/main/);
});
