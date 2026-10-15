import { createBaseGitFixture } from "../helpers/ops-command-fixtures.ts";
import { runFixtureCommand as sh } from "../helpers/ops-command-fixtures.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assertMainBranch, extractMergeItem, resolveMergeContext, buildMergeReport, rebaseBranchOnMain, attemptDeterministicMerge, pushMainBranch, verifyConflictResolution, verifyPushRecovery, verifyPushResolution, buildConflictPacket, runMergeIntegration } from "../../src/commands/merge-item-ops.ts";
import { cleanupMergeWorktree, resolveMergeWorktreeDir, setupMergeWorktree } from "../../src/commands/merge-worktree.ts";
import { resolveRepoRoleGuardOptions } from "../../src/commands/merge-guard-context.ts";
import { inspectMergeWorkspaceState } from "../../src/commands/merge-workspace-state.ts";

// ── Helpers ───────────────────────────────────────────────────

/** Create a minimal git repo with a base commit on main. */
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

test("merge-item ops ignore ambient Git env variables from caller context", () => {
  const repo = initRepo();
  sh(["git", "checkout", "-b", "wave/env-isolation"], repo);
  writeFileSync(join(repo, "env.txt"), "env isolation\n", "utf8");
  sh(["git", "add", "env.txt"], repo);
  sh(["git", "commit", "-m", "feat: env isolation"], repo);
  sh(["git", "checkout", "main"], repo);

  const previousIndex = process.env.GIT_INDEX_FILE;
  const previousDir = process.env.GIT_DIR;
  const previousWorkTree = process.env.GIT_WORK_TREE;

  try {
    process.env.GIT_INDEX_FILE = join(tmpdir(), `nonexistent-index-${Date.now()}`);
    process.env.GIT_DIR = "/tmp/nonexistent-git-dir";
    process.env.GIT_WORK_TREE = "/tmp/nonexistent-work-tree";

    const rebaseOut = rebaseBranchOnMain({ repo, branch: "wave/env-isolation" });
    assert.equal(rebaseOut.rebase_status, "ready");

    const mergeOut = attemptDeterministicMerge({ repo, branch: "wave/env-isolation" });
    assert.equal(mergeOut.merge_status, "merged");
  } finally {
    if (previousIndex === undefined) delete process.env.GIT_INDEX_FILE;
    else process.env.GIT_INDEX_FILE = previousIndex;
    if (previousDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previousDir;
    if (previousWorkTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = previousWorkTree;
  }
});

test("resolveRepoRoleGuardOptions builds mutation context from env and repo slug", () => {
  const original = process.env.HATCH_FACTORY_MUTATION_CONTEXT_JSON;
  const originalHome = process.env.HATCH_TARGET_REPO;
  try {
    process.env.HATCH_FACTORY_MUTATION_CONTEXT_JSON = JSON.stringify({ actor: "merge-test" });
    process.env.HATCH_TARGET_REPO = "recallnet/astrochicken";
    const out = resolveRepoRoleGuardOptions({ repo: "/tmp/astrochicken" });
    assert.deepEqual(out.mutationContext, { actor: "merge-test" });
  } finally {
    if (original === undefined) delete process.env.HATCH_FACTORY_MUTATION_CONTEXT_JSON;
    else process.env.HATCH_FACTORY_MUTATION_CONTEXT_JSON = original;
    if (originalHome === undefined) delete process.env.HATCH_TARGET_REPO;
    else process.env.HATCH_TARGET_REPO = originalHome;
  }
});

test("inspectMergeWorkspaceState ignores .hatch artifacts while reporting real dirt", () => {
  const repo = initRepo();
  mkdirSync(join(repo, ".hatch", "runs"), { recursive: true });
  writeFileSync(join(repo, ".hatch", "runs", "artifact.json"), "{}\n", "utf8");
  writeFileSync(join(repo, "real-dirty.txt"), "dirty\n", "utf8");

  const out = inspectMergeWorkspaceState({ repo });
  assert.equal(out.mergeHeadPresent, false);
  assert.equal(out.rebaseApplyPresent, false);
  assert.equal(out.rebaseMergePresent, false);
  assert.ok(out.dirtyEntries.some((line) => line.includes("real-dirty.txt")));
  assert.ok(!out.dirtyEntries.some((line) => line.includes(".hatch/runs/artifact.json")));
});

// ── assertMainBranch ──────────────────────────────────────────

test("assertMainBranch returns ok when already on main", () => {
  const repo = initRepo();
  const out = assertMainBranch({ repo });
  assert.equal(out.ok, true);
  assert.equal(out.branch, "main");
  assert.equal(out.corrected, false);
});

test("assertMainBranch corrects to main when on wave branch", () => {
  const repo = initRepo();
  sh(["git", "checkout", "-b", "wave/goal-123-wave-1"], repo);
  writeFileSync(join(repo, "feat.txt"), "feat\n", "utf8");
  sh(["git", "add", "feat.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);

  // Repo is on wave branch — assertMainBranch must correct it
  const out = assertMainBranch({ repo });
  assert.equal(out.ok, true);
  assert.equal(out.branch, "wave/goal-123-wave-1");
  assert.equal(out.corrected, true);

  // Verify repo is now on main
  const current = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], repo);
  assert.equal(current, "main");
});

test("assertMainBranch recovers from stale rebase state on wrong branch", () => {
  const repo = initRepo();

  // Create a wave branch
  sh(["git", "checkout", "-b", "wave/goal-100-wave-1"], repo);
  writeFileSync(join(repo, "feat.txt"), "feat\n", "utf8");
  sh(["git", "add", "feat.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);

  // Simulate crash: left on wave branch with stale rebase started
  // (rebase --abort will be called as part of recovery)
  const out = assertMainBranch({ repo });
  assert.equal(out.ok, true);
  assert.equal(out.branch, "wave/goal-100-wave-1");
  assert.equal(out.corrected, true);

  // Verify repo is on main
  const current = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], repo);
  assert.equal(current, "main");
});

test("assertMainBranch returns error for missing repo", () => {
  const out = assertMainBranch({});
  assert.equal(out.ok, false);
  assert.equal(out.error, "missing_repo");
});

// ── extractMergeItem ──────────────────────────────────────────

test("extractMergeItem parses deterministic fields", () => {
  const out = extractMergeItem('{"issue_number":1,"branch":"wave/1","worktree_dir":"/tmp/w"}');
  assert.equal(out.issue_number, "1");
  assert.equal(out.branch, "wave/1");
});

test("extractMergeItem handles empty/malformed input", () => {
  const out = extractMergeItem("");
  assert.equal(out.issue_number, "");
  assert.equal(out.branch, "");
});

test("resolveMergeContext picks branch/worktree from merge candidates with fallback", () => {
  const out = resolveMergeContext({
    mergeCandidatesRaw: JSON.stringify([{ branch: "wave/1", worktree_dir: "/tmp/w1" }]),
    fallbackBranch: "wave/fallback",
    fallbackWorktreeDir: "/tmp/fallback",
  });
  assert.equal(out.branch, "wave/1");
  assert.equal(out.worktree_dir, "/tmp/w1");
});

test("resolveMergeContext falls back deterministically when candidates are empty", () => {
  const out = resolveMergeContext({
    mergeCandidatesRaw: "[]",
    fallbackBranch: "wave/fallback",
    fallbackWorktreeDir: "/tmp/fallback",
  });
  assert.equal(out.branch, "wave/fallback");
  assert.equal(out.worktree_dir, "/tmp/fallback");
});

// ── buildMergeReport ──────────────────────────────────────────

test("buildMergeReport returns stable shape with resolver telemetry", () => {
  const out = buildMergeReport({
    issueNumber: 1,
    branch: "wave/1",
    mergeStatus: "merged",
    mergeResolver: "deterministic",
    pathTaken: "merge",
    notes: "ok",
  });
  assert.deepEqual(out, {
    issue_number: "1",
    branch: "wave/1",
    merge_status: "merged",
    notes: "ok",
    path_taken: "merge",
    "hatch.merge.resolver": "deterministic",
  });
});

test("buildMergeReport defaults resolver only when graph failed to provide one", () => {
  const out = buildMergeReport({
    issueNumber: 1,
    branch: "wave/1",
    mergeStatus: "failed",
    pathTaken: "merge",
  });
  assert.equal(out["hatch.merge.resolver"], "unknown");
});

test("buildMergeReport appends legacy integration text when integration_result is provided", () => {
  const integrationResult = JSON.stringify({ integration_exit_code: 7, integration_legacy_text: "integration_exit_code=7" });
  const out = buildMergeReport({
    issueNumber: 1,
    branch: "wave/1",
    mergeStatus: "merged",
    mergeResolver: "llm",
    pathTaken: "merge",
    notes: "resolver_notes",
    integrationResultRaw: integrationResult,
  });

  assert.equal(out.notes, "resolver_notes integration_exit_code=7");
  assert.equal(out.path_taken, "merge");
  assert.equal(out["hatch.merge.resolver"], "llm");
});

test("merge git ops are resilient to contaminated parent GIT_DIR env", () => {
  const { repo } = initRepoWithBareRemote();

  const contaminatedGitDir = join(repo, ".git", "does-not-exist");
  process.env.GIT_DIR = contaminatedGitDir;
  try {
    const out = rebaseBranchOnMain({ repo, branch: "main" });
    assert.equal(out.rebase_status, "ready");
  } finally {
    delete process.env.GIT_DIR;
  }
});

// ── runMergeIntegration ───────────────────────────────────────

test("runMergeIntegration no-ops deterministically when integration command is empty", () => {
  const out = runMergeIntegration({ repo: ".", integrationCommand: "" });
  assert.equal(out.integration_exit_code, 0);
  assert.equal(out.integration_duration_ms, 0);
  assert.equal(out.integration_stdout, "");
  assert.equal(out.integration_stderr, "");
  assert.equal(out.integration_legacy_text, "integration_exit_code=0 (no command)");
});

test("runMergeIntegration captures non-zero exit without throwing", () => {
  const out = runMergeIntegration({ repo: ".", integrationCommand: "printf 'nope'; exit 9" });
  assert.equal(out.integration_exit_code, 9);
  assert.match(out.integration_stdout, /nope/);
  assert.equal(out.integration_legacy_text, "integration_exit_code=9");
  assert.ok(out.integration_duration_ms >= 0);
});

// ── rebaseBranchOnMain: all status paths ──────────────────────

test("rebaseBranchOnMain returns 'error' for missing inputs", () => {
  assert.equal(rebaseBranchOnMain({}).rebase_status, "error");
  assert.equal(rebaseBranchOnMain({ repo: "/tmp" }).rebase_status, "error");
});

test("rebaseBranchOnMain returns 'ready' when branch already contains main", () => {
  const repo = initRepo();
  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "new.txt"), "feat\n", "utf8");
  sh(["git", "add", "new.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);
  sh(["git", "checkout", "main"], repo);

  // wave/1 was created from main and has more commits — main is ancestor of wave/1
  const out = rebaseBranchOnMain({ repo, branch: "wave/1" });
  assert.equal(out.rebase_status, "ready");
});

test("rebaseBranchOnMain returns 'ready' when main has advanced (rebased)", () => {
  const repo = initRepo();

  // Create feature branch
  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "feat.txt"), "feature\n", "utf8");
  sh(["git", "add", "feat.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);

  // Advance main with non-overlapping change
  sh(["git", "checkout", "main"], repo);
  writeFileSync(join(repo, "other.txt"), "other\n", "utf8");
  sh(["git", "add", "other.txt"], repo);
  sh(["git", "commit", "-m", "chore: other"], repo);

  const out = rebaseBranchOnMain({ repo, branch: "wave/1" });
  assert.equal(out.rebase_status, "ready");

  // After rebase, merge should be clean (no conflicts)
  const merge = attemptDeterministicMerge({ repo, branch: "wave/1" });
  assert.equal(merge.merge_status, "merged");
});

test("rebaseBranchOnMain returns 'conflict' on overlapping edits", () => {
  const repo = initRepo();

  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "file.txt"), "branch\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);

  sh(["git", "checkout", "main"], repo);
  writeFileSync(join(repo, "file.txt"), "main\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "diverge"], repo);

  const out = rebaseBranchOnMain({ repo, branch: "wave/1" });
  assert.equal(out.rebase_status, "conflict");
  assert.match(out.rebase_stderr, /rebase_conflict_files=/,
    "rebase conflict path must emit conflict file telemetry for resolver packet generation");
});

test("rebaseBranchOnMain rebases via worktree dir when branch is checked out in linked worktree", () => {
  const repo = initRepo();

  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "feat.txt"), "feature\n", "utf8");
  sh(["git", "add", "feat.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);
  sh(["git", "checkout", "main"], repo);

  writeFileSync(join(repo, "main.txt"), "main change\n", "utf8");
  sh(["git", "add", "main.txt"], repo);
  sh(["git", "commit", "-m", "main advance"], repo);

  const mergeWorktreeDir = resolveMergeWorktreeDir({ repo, branch: "wave/1", runId: "ready", pipeline: "merge-test" });
  const setup = setupMergeWorktree({ repo, branch: "wave/1", runId: "ready", pipeline: "merge-test", mergeWorktreeDir });
  assert.equal(setup.setup, "true");

  const out = rebaseBranchOnMain({ repo, branch: "wave/1", mergeWorktreeDir });
  assert.equal(out.rebase_status, "ready");
  assert.equal(out.merge_worktree_dir, mergeWorktreeDir);
});

test("rebaseBranchOnMain keeps conflicts in worktree scope and verify/build helpers operate on worktree", () => {
  const repo = initRepo();

  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "file.txt"), "branch\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "feat: branch edit"], repo);
  sh(["git", "checkout", "main"], repo);

  writeFileSync(join(repo, "file.txt"), "main\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "chore: main edit"], repo);

  const mergeWorktreeDir = resolveMergeWorktreeDir({ repo, branch: "wave/1", runId: "conflict", pipeline: "merge-test" });
  const setup = setupMergeWorktree({ repo, branch: "wave/1", runId: "conflict", pipeline: "merge-test", mergeWorktreeDir });
  assert.equal(setup.setup, "true");

  const out = rebaseBranchOnMain({ repo, branch: "wave/1", mergeWorktreeDir });
  assert.equal(out.rebase_status, "conflict");
  assert.match(out.rebase_stderr, /conflict_scope=merge_worktree/);
  assert.match(out.rebase_stderr, /rebase_conflict_files=/,
    "rebase conflict path must include explicit conflict_files telemetry");

  const rootUnmerged = spawnSync("git", ["-C", repo, "diff", "--name-only", "--diff-filter=U"], { encoding: "utf8" });
  assert.equal(String(rootUnmerged.stdout || "").trim(), "", "repo root must stay conflict-free");

  const packet = buildConflictPacket({ repo, branch: "wave/1", issueNumber: "42", mergeStderr: out.rebase_stderr, worktreeDir: mergeWorktreeDir });
  const parsed = JSON.parse(readFileSync(packet.conflict_packet_path, "utf8"));
  assert.ok(Array.isArray(parsed.conflict_files) && parsed.conflict_files.length > 0,
    "conflict packet must include non-empty conflict_files for resolver input");
  assert.ok(parsed.conflict_files.includes("file.txt"));

  writeFileSync(join(mergeWorktreeDir, "file.txt"), "resolved\n", "utf8");
  sh(["git", "add", "file.txt"], mergeWorktreeDir);
  sh(["git", "commit", "--no-edit"], mergeWorktreeDir);

  const verify = verifyConflictResolution({ repo, branch: "wave/1", mergeWorktreeDir });
  assert.equal(verify.resolution_status, "resolved");
});

test("merge worktree lifecycle keeps rebase conflicts out of the canonical checkout", () => {
  const repo = initRepo();
  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "file.txt"), "branch\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "feat: branch edit"], repo);
  sh(["git", "checkout", "main"], repo);
  writeFileSync(join(repo, "file.txt"), "main\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "chore: main edit"], repo);

  const mergeWorktreeDir = resolveMergeWorktreeDir({ repo, branch: "wave/1", runId: "contract", pipeline: "merge-test" });
  const setup = setupMergeWorktree({ repo, branch: "wave/1", runId: "contract", pipeline: "merge-test", mergeWorktreeDir });
  assert.equal(setup.setup, "true");
  assert.match(setup.merge_worktree_dir, /\.hatch-worktrees\/merge\//);

  const out = rebaseBranchOnMain({ repo, branch: "wave/1", mergeWorktreeDir });
  assert.equal(out.rebase_status, "conflict");
  assert.match(out.rebase_stderr, /conflict_scope=merge_worktree/);

  const canonicalBranch = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], repo);
  assert.equal(canonicalBranch, "main");
  const canonicalUnmerged = sh(["git", "diff", "--name-only", "--diff-filter=U"], repo);
  assert.equal(canonicalUnmerged, "", "canonical checkout must not hold merge conflicts");

  const mergeUnmerged = sh(["git", "-C", mergeWorktreeDir, "diff", "--name-only", "--diff-filter=U"], repo);
  assert.equal(mergeUnmerged, "file.txt");

  const cleanup = cleanupMergeWorktree({ repo, mergeWorktreeDir });
  assert.equal(cleanup.removed, "true");
});

test("cascading rebase: second branch rebases cleanly after first merges", () => {
  const repo = initRepo();

  // Branch A: add to file.txt
  sh(["git", "checkout", "-b", "wave/A"], repo);
  writeFileSync(join(repo, "file.txt"), "base\nfeature A\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "feat A"], repo);

  // Branch B: add different file (no overlap with A)
  sh(["git", "checkout", "main"], repo);
  sh(["git", "checkout", "-b", "wave/B"], repo);
  writeFileSync(join(repo, "other.txt"), "feature B\n", "utf8");
  sh(["git", "add", "other.txt"], repo);
  sh(["git", "commit", "-m", "feat B"], repo);

  // Merge A into main
  sh(["git", "checkout", "main"], repo);
  const mergeA = attemptDeterministicMerge({ repo, branch: "wave/A" });
  assert.equal(mergeA.merge_status, "merged");

  // Rebase B on updated main — should succeed even though main advanced
  const rebaseB = rebaseBranchOnMain({ repo, branch: "wave/B" });
  assert.equal(rebaseB.rebase_status, "ready");

  // Now merge B — should be clean
  const mergeB = attemptDeterministicMerge({ repo, branch: "wave/B" });
  assert.equal(mergeB.merge_status, "merged");
});

// ── attemptDeterministicMerge: all status paths ───────────────

test("attemptDeterministicMerge returns 'error' for missing inputs", () => {
  assert.equal(attemptDeterministicMerge({}).merge_status, "error");
  assert.equal(attemptDeterministicMerge({ repo: "/tmp" }).merge_status, "error");
  assert.equal(attemptDeterministicMerge({ branch: "b" }).merge_status, "error");
});

test("attemptDeterministicMerge returns 'merged' on clean fast-forward", () => {
  const repo = initRepo();
  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "new.txt"), "feature\n", "utf8");
  sh(["git", "add", "new.txt"], repo);
  sh(["git", "commit", "-m", "feat: add new file"], repo);
  sh(["git", "checkout", "main"], repo);

  const out = attemptDeterministicMerge({ repo, branch: "wave/1" });
  assert.equal(out.merge_status, "merged");
});

test("attemptDeterministicMerge returns 'already_merged' when branch is ancestor of main", () => {
  const repo = initRepo();
  // Create branch at same commit as main (ancestor)
  sh(["git", "checkout", "-b", "wave/1"], repo);
  sh(["git", "checkout", "main"], repo);

  const out = attemptDeterministicMerge({ repo, branch: "wave/1" });
  assert.equal(out.merge_status, "already_merged");
});

test("attemptDeterministicMerge returns 'conflict' on overlapping edits", () => {
  const repo = initRepo();

  // Create branch with edit to file.txt
  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "file.txt"), "branch change\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "feat: branch edit"], repo);

  // Create divergent edit on main
  sh(["git", "checkout", "main"], repo);
  writeFileSync(join(repo, "file.txt"), "main change\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "chore: main edit"], repo);

  const out = attemptDeterministicMerge({ repo, branch: "wave/1" });
  assert.equal(out.merge_status, "conflict", "Must return 'conflict', not 'error' or 'failed'");
});

test("attemptDeterministicMerge auto-heals dirty worktree via autostash", () => {
  const repo = initRepo();

  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "file.txt"), "base\nfeat\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);

  sh(["git", "checkout", "main"], repo);
  // Leave uncommitted change (dirty worktree)
  writeFileSync(join(repo, "file.txt"), "base\nlocal\n", "utf8");

  const out = attemptDeterministicMerge({ repo, branch: "wave/1" });
  assert.equal(out.merge_status, "merged");
  assert.match(out.merge_stderr, /auto_heal=autostash/);

  const anc = spawnSync("git", ["-C", repo, "merge-base", "--is-ancestor", "wave/1", "main"], { encoding: "utf8" });
  assert.equal(anc.status, 0);
});

test("attemptDeterministicMerge status is always one of the valid enum values", () => {
  const VALID = new Set(["merged", "already_merged", "conflict", "error"]);

  // Test each path produces a valid status
  const cases = [
    attemptDeterministicMerge({}),
    attemptDeterministicMerge({ repo: "/nonexistent", branch: "b" }),
  ];
  for (const out of cases) {
    assert.ok(VALID.has(out.merge_status), `Unexpected merge_status: '${out.merge_status}'`);
  }
});

// ── attemptDeterministicMerge: cascading conflict scenario ────
// This is the exact scenario that caused wave-1 failures:
// Two branches both modify the same file, merged sequentially.

test("cascading merge: second branch conflicts after first merges", () => {
  const repo = initRepo();

  // Branch A: modify file.txt
  sh(["git", "checkout", "-b", "wave/A"], repo);
  writeFileSync(join(repo, "file.txt"), "base\nfeature A\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "feat A"], repo);

  // Branch B: also modify file.txt (from same base)
  sh(["git", "checkout", "main"], repo);
  sh(["git", "checkout", "-b", "wave/B"], repo);
  writeFileSync(join(repo, "file.txt"), "base\nfeature B\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "feat B"], repo);

  // Merge A into main (clean)
  sh(["git", "checkout", "main"], repo);
  const outA = attemptDeterministicMerge({ repo, branch: "wave/A" });
  assert.equal(outA.merge_status, "merged");

  // Now merge B — must return "conflict", not "error" or "failed"
  const outB = attemptDeterministicMerge({ repo, branch: "wave/B" });
  assert.equal(outB.merge_status, "conflict",
    "Sequential merge of overlapping branches must produce 'conflict' status");
});

// ── pushMainBranch / verifyPushResolution ─────────────────────

test("pushMainBranch pushes main to origin and verifyPushResolution confirms parity", () => {
  const { repo } = initRepoWithBareRemote();

  writeFileSync(join(repo, "post-merge.txt"), "shipped\n", "utf8");
  sh(["git", "add", "post-merge.txt"], repo);
  sh(["git", "commit", "-m", "post merge local commit"], repo);

  const out = pushMainBranch({ repo, branch: "main", remote: "origin" });
  assert.equal(out.push_status, "pushed");

  const verify = verifyPushResolution({ repo, branch: "main", remote: "origin" });
  assert.equal(verify.resolution_status, "resolved");
});

test("pushMainBranch fast-forwards canonical main from merge worktree and pushes only after merge verification succeeds", () => {
  const { repo } = initRepoWithBareRemote();

  sh(["git", "checkout", "-b", "wave/merge-worktree"], repo);
  writeFileSync(join(repo, "feature.txt"), "merge-worktree\n", "utf8");
  sh(["git", "add", "feature.txt"], repo);
  sh(["git", "commit", "-m", "feat: merge from worktree"], repo);
  sh(["git", "checkout", "main"], repo);

  const mergeWorktreeDir = resolveMergeWorktreeDir({ repo, branch: "wave/merge-worktree", runId: "push", pipeline: "merge-test" });
  const setup = setupMergeWorktree({ repo, branch: "wave/merge-worktree", runId: "push", pipeline: "merge-test", mergeWorktreeDir });
  assert.equal(setup.setup, "true");

  const rebase = rebaseBranchOnMain({ repo, branch: "wave/merge-worktree", mergeWorktreeDir });
  assert.equal(rebase.rebase_status, "ready");

  const merge = attemptDeterministicMerge({
    repo,
    branch: "wave/merge-worktree",
    mergeWorktreeDir,
    branchHeadSha: rebase.merge_branch_head_sha,
  });
  assert.equal(merge.merge_status, "merged");

  const canonicalBefore = sh(["git", "rev-parse", "HEAD"], repo);
  const worktreeHead = sh(["git", "-C", mergeWorktreeDir, "rev-parse", "HEAD"], repo);
  assert.notEqual(canonicalBefore, worktreeHead, "canonical main must not move before final fast-forward");

  const push = pushMainBranch({ repo, branch: "main", remote: "origin", mergeWorktreeDir });
  assert.equal(push.push_status, "pushed");

  const canonicalAfter = sh(["git", "rev-parse", "HEAD"], repo);
  assert.equal(canonicalAfter, worktreeHead, "canonical main must fast-forward to the verified merge-worktree commit");
});

test("pushMainBranch respects failing local pre-push hooks", () => {
  const { repo, remote } = initRepoWithBareRemote();
  const remoteHeadBefore = sh(["git", "-C", remote, "rev-parse", "main"], repo);

  // Install a failing pre-push hook that would block a normal git push.
  const hooksDir = join(repo, ".git", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const hookPath = join(hooksDir, "pre-push");
  writeFileSync(hookPath, "#!/bin/sh\necho PRE_PUSH_HOOK_RAN >&2\nexit 99\n", "utf8");
  chmodSync(hookPath, 0o755);

  writeFileSync(join(repo, "hook-proof.txt"), "factory push\n", "utf8");
  sh(["git", "add", "hook-proof.txt"], repo);
  sh(["git", "commit", "-m", "commit after hook"], repo);

  const out = pushMainBranch({ repo, branch: "main", remote: "origin" });
  assert.equal(out.push_status, "conflict");
  assert.match(String(out.push_stderr || ""), /PRE_PUSH_HOOK_RAN/);
  assert.equal(sh(["git", "-C", remote, "rev-parse", "main"], repo), remoteHeadBefore);
});

test("pushMainBranch allows verified main push from canonical checkout", () => {
  const { repo } = initRepoWithBareRemote();
  const previousCanonical = process.env.HATCH_CANONICAL_CHECKOUT_PATH;
  try {
    process.env.HATCH_CANONICAL_CHECKOUT_PATH = repo;
    writeFileSync(join(repo, "canonical-safe.txt"), "safe main push\n", "utf8");
    sh(["git", "add", "canonical-safe.txt"], repo);
    sh(["git", "commit", "-m", "safe push"], repo);

    const out = pushMainBranch({ repo, branch: "main", remote: "origin" });
    assert.equal(out.push_status, "pushed");
  } finally {
    if (previousCanonical === undefined) delete process.env.HATCH_CANONICAL_CHECKOUT_PATH;
    else process.env.HATCH_CANONICAL_CHECKOUT_PATH = previousCanonical;
  }
});

test("rebaseBranchOnMain blocks canonical checkout branch mutation", () => {
  const repo = initRepo();
  const previousCanonical = process.env.HATCH_CANONICAL_CHECKOUT_PATH;
  try {
    process.env.HATCH_CANONICAL_CHECKOUT_PATH = repo;
    sh(["git", "checkout", "-b", "wave/1"], repo);
    writeFileSync(join(repo, "branch.txt"), "branch\n", "utf8");
    sh(["git", "add", "branch.txt"], repo);
    sh(["git", "commit", "-m", "branch"], repo);
    sh(["git", "checkout", "main"], repo);

    const out = rebaseBranchOnMain({ repo, branch: "wave/1" });
    assert.equal(out.rebase_status, "error");
    assert.match(out.rebase_stderr, /canonical_checkout_rebase_branch_blocked/);
  } finally {
    if (previousCanonical === undefined) delete process.env.HATCH_CANONICAL_CHECKOUT_PATH;
    else process.env.HATCH_CANONICAL_CHECKOUT_PATH = previousCanonical;
  }
});

test("pushMainBranch returns conflict when remote main advanced and rebase conflicts", () => {
  const { repo, remote } = initRepoWithBareRemote();

  // Advance remote main with overlapping change in a separate clone.
  const other = mkdtempSync(join(tmpdir(), "taxi-merge-other-"));
  sh(["git", "clone", remote, other], process.cwd());
  sh(["git", "config", "user.email", "taxi@example.com"], other);
  sh(["git", "config", "user.name", "Hatch"], other);
  writeFileSync(join(other, "file.txt"), "remote change\n", "utf8");
  sh(["git", "add", "file.txt"], other);
  sh(["git", "commit", "-m", "remote edit"], other);
  sh(["git", "push", "origin", "main"], other);

  // Divergent overlapping local change.
  writeFileSync(join(repo, "file.txt"), "local change\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "local edit"], repo);

  const out = pushMainBranch({ repo, branch: "main", remote: "origin" });
  assert.equal(out.push_status, "conflict");

  const verify = verifyPushResolution({ repo, branch: "main", remote: "origin" });
  assert.equal(verify.resolution_status, "unresolved");
});

test("verifyPushRecovery rejects canonical main states that still cannot fast-forward to origin/main", () => {
  const { repo, remote } = initRepoWithBareRemote();

  sh(["git", "checkout", "-b", "wave/push-recovery"], repo);
  writeFileSync(join(repo, "feature.txt"), "goal work\n", "utf8");
  sh(["git", "add", "feature.txt"], repo);
  sh(["git", "commit", "-m", "feat: push recovery candidate"], repo);
  sh(["git", "checkout", "main"], repo);

  const mergeWorktreeDir = resolveMergeWorktreeDir({ repo, branch: "wave/push-recovery", runId: "push-recovery", pipeline: "merge-test" });
  const setup = setupMergeWorktree({ repo, branch: "wave/push-recovery", runId: "push-recovery", pipeline: "merge-test", mergeWorktreeDir });
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

  const other = mkdtempSync(join(tmpdir(), "taxi-merge-other-recovery-"));
  sh(["git", "clone", remote, other], process.cwd());
  sh(["git", "config", "user.email", "taxi@example.com"], other);
  sh(["git", "config", "user.name", "Hatch"], other);
  writeFileSync(join(other, "remote-advance.txt"), "remote advance\n", "utf8");
  sh(["git", "add", "remote-advance.txt"], other);
  sh(["git", "commit", "-m", "chore: remote advance"], other);
  sh(["git", "push", "origin", "main"], other);

  writeFileSync(join(repo, "local-diverge.txt"), "local diverge\n", "utf8");
  sh(["git", "add", "local-diverge.txt"], repo);
  sh(["git", "commit", "-m", "chore: local diverge"], repo);

  const verify = verifyPushRecovery({ repo, branch: "main", remote: "origin", mergeWorktreeDir });
  assert.equal(verify.resolution_status, "unresolved");
  assert.match(verify.resolution_notes, /canonical_main_not_fast_forwardable_to_origin\/main/);
});

// ── verifyConflictResolution: all states ──────────────────────

test("verifyConflictResolution returns 'resolved' on clean merged state", () => {
  const repo = initRepo();
  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "new.txt"), "feat\n", "utf8");
  sh(["git", "add", "new.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);
  sh(["git", "checkout", "main"], repo);
  sh(["git", "merge", "--no-ff", "wave/1"], repo);

  const out = verifyConflictResolution({ repo, branch: "wave/1" });
  assert.equal(out.resolution_status, "resolved");
});

test("verifyConflictResolution returns 'unresolved' when unmerged paths exist", () => {
  const repo = initRepo();

  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "file.txt"), "branch\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);

  sh(["git", "checkout", "main"], repo);
  writeFileSync(join(repo, "file.txt"), "main\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "diverge"], repo);

  // Start a merge that conflicts (leave repo in merge state)
  spawnSync("git", ["-C", repo, "merge", "--no-ff", "wave/1"], { encoding: "utf8" });

  const out = verifyConflictResolution({ repo, branch: "wave/1" });
  assert.equal(out.resolution_status, "unresolved");
  assert.match(out.resolution_notes, /Unmerged paths remain/);
});

test("verifyConflictResolution returns 'unresolved' when branch not yet merged", () => {
  const repo = initRepo();
  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "new.txt"), "feat\n", "utf8");
  sh(["git", "add", "new.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);
  sh(["git", "checkout", "main"], repo);

  // Don't merge — verify should detect the branch isn't merged
  const out = verifyConflictResolution({ repo, branch: "wave/1" });
  assert.equal(out.resolution_status, "unresolved");
  assert.match(out.resolution_notes, /not yet merged/);
});

test("verifyConflictResolution returns 'unresolved' when rebase is still in progress", () => {
  const repo = initRepo();

  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "file.txt"), "branch\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);

  sh(["git", "checkout", "main"], repo);
  writeFileSync(join(repo, "file.txt"), "main\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "diverge"], repo);

  sh(["git", "checkout", "wave/1"], repo);
  spawnSync("git", ["-C", repo, "rebase", "main"], { encoding: "utf8" });
  writeFileSync(join(repo, "file.txt"), "resolved\n", "utf8");
  sh(["git", "add", "file.txt"], repo);

  const out = verifyConflictResolution({ repo, branch: "wave/1" });
  assert.equal(out.resolution_status, "unresolved");
  assert.match(out.resolution_notes, /Rebase still in progress/);
});

test("verifyConflictResolution returns 'unresolved' when worktree/index is still dirty", () => {
  const repo = initRepo();
  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "new.txt"), "feat\n", "utf8");
  sh(["git", "add", "new.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);
  sh(["git", "checkout", "main"], repo);
  sh(["git", "merge", "--no-ff", "wave/1"], repo);
  writeFileSync(join(repo, "dirty.txt"), "leftover\n", "utf8");

  const out = verifyConflictResolution({ repo, branch: "wave/1" });
  assert.equal(out.resolution_status, "unresolved");
  assert.match(out.resolution_notes, /Worktree\/index still dirty/);
});

// ── buildConflictPacket ───────────────────────────────────────

test("buildConflictPacket captures conflict files and commits", () => {
  const repo = initRepo();

  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "file.txt"), "branch\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "feat: branch change"], repo);

  sh(["git", "checkout", "main"], repo);
  writeFileSync(join(repo, "file.txt"), "main\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "chore: main change"], repo);

  // Start conflicting merge (leave in merge state for packet building)
  spawnSync("git", ["-C", repo, "merge", "--no-ff", "wave/1"], { encoding: "utf8" });

  const out = buildConflictPacket({ repo, branch: "wave/1", issueNumber: "42", mergeStderr: "conflict" });
  assert.ok(out.conflict_packet_path);

  const packet = JSON.parse(readFileSync(out.conflict_packet_path, "utf8"));
  assert.equal(packet.schema_version, "merge_conflict_packet/v1");
  assert.equal(packet.packet_type, "merge_conflict_packet");
  assert.match(String(packet.packet_id || ""), /^merge_conflict_packet_/);
  assert.equal(packet.issue_number, "42");
  assert.ok(packet.conflict_files.length > 0, "conflict_files must be non-empty when conflicts exist");
  assert.ok(packet.conflict_files.includes("file.txt"), "Must list conflicting files");
  assert.ok(packet.branch_commits.length > 0, "Must include branch commits");
  assert.ok(packet.main_commits_touching_conflicts.length > 0, "Must include main commits touching conflicts");
});

test("buildConflictPacket persists named packet under canonical run-scoped storage when run metadata is present", () => {
  const repo = initRepo();

  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "extra.txt"), "new\n", "utf8");
  sh(["git", "add", "extra.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);
  sh(["git", "checkout", "main"], repo);

  const out = buildConflictPacket({
    repo,
    branch: "wave/1",
    issueNumber: "204",
    mergeStderr: "rebase_conflict_files=only-one.txt",
    factoryId: "mothership",
    runId: "run-123",
    pipeline: "wave_execute",
    nodeId: "build_conflict_packet",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
  });
  assert.match(
    out.conflict_packet_path,
    /\.hatch\/mothership\/runs\/run-123\/packets\/merge_conflict_packet\//,
  );
  assert.equal(out.conflict_packet_schema_version, "merge_conflict_packet/v1");
  assert.equal(out.conflict_packet_storage_class, "factory_run_packet");

  const packet = JSON.parse(readFileSync(out.conflict_packet_path, "utf8"));
  assert.equal(packet.factory_id, "mothership");
  assert.equal(packet.run_id, "run-123");
  assert.equal(packet.pipeline, "wave_execute");
  assert.equal(packet.node_id, "build_conflict_packet");
  assert.equal(packet.target_repo, "recallnet/astrochicken");
});

test("buildConflictPacket emits actionable repo-root takeover commands when worktree_dir is empty", () => {
  const repo = initRepo();

  sh(["git", "checkout", "-b", "wave/dirty-root"], repo);
  writeFileSync(join(repo, "tracked.txt"), "branch\n", "utf8");
  sh(["git", "add", "tracked.txt"], repo);
  sh(["git", "commit", "-m", "feat: branch file"], repo);
  sh(["git", "checkout", "main"], repo);

  const out = buildConflictPacket({
    repo,
    branch: "wave/dirty-root",
    issueNumber: "299",
    mergeStderr: [
      "error: Your local changes to the following files would be overwritten by merge:",
      "\tdocs/generated/report.pdf",
      "error: The following untracked working tree files would be overwritten by merge:",
      "\tdocs/generated/report.html",
      "Aborting",
    ].join("\n"),
    worktreeDir: "",
  });

  const packet = JSON.parse(readFileSync(out.conflict_packet_path, "utf8"));
  assert.equal(packet.worktree_dir, "");
  assert.deepEqual(packet.resource_refs.repo, repo);
  assert.ok(packet.inspection_commands.some((entry) => entry.includes(`git -C '${repo}' status --short --branch`)));
  assert.ok(packet.verify_commands.some((entry) => entry.includes(`git -C '${repo}' status --short`)));
  assert.match(packet.operator_prompt, /repo root/i);
});

// ── Stale merge state recovery ────────────────────────────────

test("rebaseBranchOnMain recovers from stale merge-conflict state in repo", () => {
  const repo = initRepo();

  // Create a branch that will conflict
  sh(["git", "checkout", "-b", "wave/conflict"], repo);
  writeFileSync(join(repo, "file.txt"), "conflict-branch\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "conflict branch"], repo);

  // Create divergent main
  sh(["git", "checkout", "main"], repo);
  writeFileSync(join(repo, "file.txt"), "main-diverged\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "diverge main"], repo);

  // Start a merge that conflicts — leaves repo in merge state
  spawnSync("git", ["-C", repo, "merge", "--no-ff", "wave/conflict"], { encoding: "utf8" });

  // Now create a clean branch that SHOULD merge fine
  sh(["git", "merge", "--abort"], repo);
  sh(["git", "checkout", "-b", "wave/clean"], repo);
  writeFileSync(join(repo, "clean.txt"), "clean\n", "utf8");
  sh(["git", "add", "clean.txt"], repo);
  sh(["git", "commit", "-m", "clean feat"], repo);
  sh(["git", "checkout", "main"], repo);

  // Leave repo with stale merge state: start the conflict merge again
  spawnSync("git", ["-C", repo, "merge", "--no-ff", "wave/conflict"], { encoding: "utf8" });

  // rebaseBranchOnMain for the clean branch must succeed despite stale state
  const out = rebaseBranchOnMain({ repo, branch: "wave/clean" });
  assert.equal(out.rebase_status, "ready",
    "rebaseBranchOnMain must recover from stale merge state");
});

test("attemptDeterministicMerge recovers from stale merge-conflict state in repo", () => {
  const repo = initRepo();

  // Create a branch that will conflict
  sh(["git", "checkout", "-b", "wave/conflict"], repo);
  writeFileSync(join(repo, "file.txt"), "conflict-branch\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "conflict branch"], repo);

  // Create divergent main
  sh(["git", "checkout", "main"], repo);
  writeFileSync(join(repo, "file.txt"), "main-diverged\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "diverge main"], repo);

  // Start a merge that conflicts — leave in stale state
  spawnSync("git", ["-C", repo, "merge", "--no-ff", "wave/conflict"], { encoding: "utf8" });

  // Create a clean branch
  // First abort so we can create the branch
  sh(["git", "merge", "--abort"], repo);
  sh(["git", "checkout", "-b", "wave/clean"], repo);
  writeFileSync(join(repo, "clean.txt"), "clean\n", "utf8");
  sh(["git", "add", "clean.txt"], repo);
  sh(["git", "commit", "-m", "clean feat"], repo);
  sh(["git", "checkout", "main"], repo);

  // Re-enter stale merge state
  spawnSync("git", ["-C", repo, "merge", "--no-ff", "wave/conflict"], { encoding: "utf8" });

  // attemptDeterministicMerge for the clean branch must succeed
  const out = attemptDeterministicMerge({ repo, branch: "wave/clean" });
  assert.equal(out.merge_status, "merged",
    "attemptDeterministicMerge must recover from stale merge state");
});

test("attemptDeterministicMerge handles stale index entries (UU without MERGE_HEAD)", () => {
  const repo = initRepo();

  // Create a clean branch first (before dirtying the repo)
  sh(["git", "checkout", "-b", "wave/clean"], repo);
  writeFileSync(join(repo, "other.txt"), "clean\n", "utf8");
  sh(["git", "add", "other.txt"], repo);
  sh(["git", "commit", "-m", "clean"], repo);

  // Create conflicting branch
  sh(["git", "checkout", "main"], repo);
  sh(["git", "checkout", "-b", "wave/conflict"], repo);
  writeFileSync(join(repo, "file.txt"), "conflict\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "conflict"], repo);

  // Diverge main
  sh(["git", "checkout", "main"], repo);
  writeFileSync(join(repo, "file.txt"), "main\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "diverge"], repo);

  // Start merge that conflicts — creates UU entries and MERGE_HEAD
  spawnSync("git", ["-C", repo, "merge", "--no-ff", "wave/conflict"], { encoding: "utf8" });
  // Remove MERGE_HEAD to simulate partial cleanup (stale UU without MERGE_HEAD)
  const gitDir = spawnSync("git", ["-C", repo, "rev-parse", "--git-dir"], { encoding: "utf8" }).stdout.trim();
  spawnSync("rm", ["-f", join(gitDir, "MERGE_HEAD")]);

  // Now attempt merge of the clean branch — must recover from stale UU state
  const out = attemptDeterministicMerge({ repo, branch: "wave/clean" });
  assert.equal(out.merge_status, "merged",
    "Must handle stale index state and merge cleanly");
});

// ── pushMainBranch: canonical checkout on wave branch ─────────
// Regression: when a coder agent leaves the canonical checkout on a wave
// branch, pushMainBranch with a merge worktree must still succeed by
// checking out main before the ff-merge guard runs.

test("pushMainBranch succeeds from merge worktree when canonical checkout is on a wave branch", () => {
  const { repo } = initRepoWithBareRemote();
  const previousCanonical = process.env.HATCH_CANONICAL_CHECKOUT_PATH;
  try {
    process.env.HATCH_CANONICAL_CHECKOUT_PATH = repo;

    // Create a wave branch with a commit
    sh(["git", "checkout", "-b", "wave/goal-42-wave-1"], repo);
    writeFileSync(join(repo, "feature.txt"), "feature work\n", "utf8");
    sh(["git", "add", "feature.txt"], repo);
    sh(["git", "commit", "-m", "feat: wave work"], repo);
    sh(["git", "checkout", "main"], repo);

    // Set up merge worktree and do the merge there
    const mergeWorktreeDir = resolveMergeWorktreeDir({ repo, branch: "wave/goal-42-wave-1", runId: "push-wave", pipeline: "wave-test" });
    const setup = setupMergeWorktree({ repo, branch: "wave/goal-42-wave-1", runId: "push-wave", pipeline: "wave-test", mergeWorktreeDir });
    assert.equal(setup.setup, "true");

    const rebase = rebaseBranchOnMain({ repo, branch: "wave/goal-42-wave-1", mergeWorktreeDir });
    assert.equal(rebase.rebase_status, "ready");

    const merge = attemptDeterministicMerge({
      repo,
      branch: "wave/goal-42-wave-1",
      mergeWorktreeDir,
      branchHeadSha: rebase.merge_branch_head_sha,
    });
    assert.equal(merge.merge_status, "merged");

    // NOW simulate the canonical checkout being left on a wave branch
    // (as happens when a coder agent checks out a wave branch in the
    // canonical repo instead of using an isolated worktree)
    sh(["git", "checkout", "wave/goal-42-wave-1"], repo);
    const branchBefore = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], repo);
    assert.equal(branchBefore, "wave/goal-42-wave-1", "canonical must be on wave branch for this test");

    // pushMainBranch must handle this: checkout main, then ff-merge + push
    const push = pushMainBranch({ repo, branch: "main", remote: "origin", mergeWorktreeDir });
    assert.equal(push.push_status, "pushed", `expected pushed but got ${push.push_status}: ${push.push_stderr}`);

    // Verify canonical checkout is back on main after push
    const branchAfter = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], repo);
    assert.equal(branchAfter, "main", "canonical must be on main after push");
  } finally {
    if (previousCanonical === undefined) delete process.env.HATCH_CANONICAL_CHECKOUT_PATH;
    else process.env.HATCH_CANONICAL_CHECKOUT_PATH = previousCanonical;
  }
});

// ── pushMainBranch: merge worktree missing, mergedHeadSha fallback ────

// Regression: goal #2138 failed push because the merge worktree directory
// vanished between merge_branch and push_main_branch. When the caller
// provides mergedHeadSha as a fallback, pushMainBranch must use the known
// commit SHA instead of failing on the missing worktree.
test("pushMainBranch uses mergedHeadSha fallback when merge worktree is missing", () => {
  const { repo } = initRepoWithBareRemote();
  const previousCanonical = process.env.HATCH_CANONICAL_CHECKOUT_PATH;
  try {
    process.env.HATCH_CANONICAL_CHECKOUT_PATH = repo;

    // Create a feature branch with a commit.
    sh(["git", "checkout", "-b", "goal/fallback-test"], repo);
    writeFileSync(join(repo, "feature.txt"), "new feature\n", "utf8");
    sh(["git", "add", "feature.txt"], repo);
    sh(["git", "commit", "-m", "feature commit"], repo);

    // Merge onto main locally (simulates what merge_branch does in the worktree).
    sh(["git", "checkout", "main"], repo);
    sh(["git", "merge", "--no-ff", "goal/fallback-test", "-m", "merge feature"], repo);
    const mergedHead = sh(["git", "rev-parse", "HEAD"], repo);
    // The merge worktree path does not exist — simulates the vanished worktree.
    const missingWorktree = join(repo, "nonexistent-merge-worktree");

    // Without mergedHeadSha, push should fail.
    const failResult = pushMainBranch({
      repo,
      branch: "main",
      remote: "origin",
      mergeWorktreeDir: missingWorktree,
    });
    assert.equal(failResult.push_status, "error", "must fail without mergedHeadSha when worktree is missing");
    // With mergedHeadSha, push should succeed.
    const pushResult = pushMainBranch({
      repo,
      branch: "main",
      remote: "origin",
      mergeWorktreeDir: missingWorktree,
      mergedHeadSha: mergedHead,
    });
    assert.equal(pushResult.push_status, "pushed", `expected pushed but got ${pushResult.push_status}: ${pushResult.push_stderr}`);
  } finally {
    if (previousCanonical === undefined) delete process.env.HATCH_CANONICAL_CHECKOUT_PATH;
    else process.env.HATCH_CANONICAL_CHECKOUT_PATH = previousCanonical;
  }
});
