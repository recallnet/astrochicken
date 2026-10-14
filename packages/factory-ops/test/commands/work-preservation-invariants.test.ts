import { runFixtureCommand as sh } from "../helpers/ops-command-fixtures.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { attemptDeterministicMerge, buildConflictPacket, verifyConflictResolution } from "../../src/commands/merge-item-ops.ts";

function initRepo() {
  const repo = mkdtempSync(join(tmpdir(), "taxi-invariant-"));
  sh(["git", "init", "-b", "main"], repo);
  sh(["git", "config", "user.email", "taxi@example.com"], repo);
  sh(["git", "config", "user.name", "Hatch"], repo);
  sh(["git", "commit", "--allow-empty", "-m", "base"], repo);
  return repo;
}

test("invariant: conflict packet must carry non-empty conflict_files before resolver", () => {
  const repo = initRepo();

  sh(["git", "checkout", "-b", "wave/1"], repo);
  sh(["bash", "-lc", "echo branch > file.txt"], repo);
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);

  sh(["git", "checkout", "main"], repo);
  sh(["bash", "-lc", "echo main > file.txt"], repo);
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "diverge"], repo);

  spawnSync("git", ["-C", repo, "merge", "--no-ff", "wave/1"], { encoding: "utf8" });

  const out = buildConflictPacket({ repo, branch: "wave/1", issueNumber: "560", mergeStderr: "conflict" });
  const packet = JSON.parse(readFileSync(out.conflict_packet_path, "utf8"));
  assert.equal(packet.schema_version, "merge_conflict_packet/v1");
  assert.equal(packet.packet_type, "merge_conflict_packet");
  assert.ok(Array.isArray(packet.conflict_files));
  assert.ok(packet.conflict_files.length > 0, "conflict packet must never be empty on conflict path");
});

test("invariant: worktree conflicts persist packets outside the disposable worktree", () => {
  const repo = initRepo();
  const worktree = join(repo, "worktree-1");

  sh(["git", "checkout", "-b", "wave/1"], repo);
  sh(["git", "checkout", "main"], repo);
  sh(["git", "worktree", "add", worktree, "wave/1"], repo);
  sh(["bash", "-lc", "echo branch > file.txt"], worktree);
  sh(["git", "-C", worktree, "add", "file.txt"], worktree);
  sh(["git", "-C", worktree, "commit", "-m", "feat"], worktree);

  sh(["git", "-C", repo, "checkout", "main"], repo);
  sh(["bash", "-lc", "echo main > file.txt"], repo);
  sh(["git", "-C", repo, "add", "file.txt"], repo);
  sh(["git", "-C", repo, "commit", "-m", "diverge"], repo);

  const out = buildConflictPacket({
    repo,
    branch: "wave/1",
    issueNumber: "561",
    mergeStderr: "rebase_conflict_files=file.txt",
    worktreeDir: worktree,
    factoryId: "mothership",
    runId: "run-preserve",
  });

  assert.match(out.conflict_packet_path, new RegExp(`^${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.doesNotMatch(
    out.conflict_packet_path,
    new RegExp(`^${worktree.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.hatch/`),
  );
});

test("invariant: merged status implies branch ancestor of main", () => {
  const repo = initRepo();

  sh(["git", "checkout", "-b", "wave/1"], repo);
  sh(["bash", "-lc", "echo feat > feat.txt"], repo);
  sh(["git", "add", "feat.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);
  sh(["git", "checkout", "main"], repo);

  const merge = attemptDeterministicMerge({ repo, branch: "wave/1" });
  assert.equal(merge.merge_status, "merged");

  const anc = spawnSync("git", ["-C", repo, "merge-base", "--is-ancestor", "wave/1", "main"], { encoding: "utf8" });
  assert.equal(anc.status, 0);
});

test("invariant: unresolved conflict must not report resolved", () => {
  const repo = initRepo();

  sh(["git", "checkout", "-b", "wave/1"], repo);
  sh(["bash", "-lc", "echo branch > file.txt"], repo);
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);
  sh(["git", "checkout", "main"], repo);
  sh(["bash", "-lc", "echo main > file.txt"], repo);
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "diverge"], repo);

  spawnSync("git", ["-C", repo, "merge", "--no-ff", "wave/1"], { encoding: "utf8" });
  const verify = verifyConflictResolution({ repo, branch: "wave/1" });
  assert.equal(verify.resolution_status, "unresolved");
});
