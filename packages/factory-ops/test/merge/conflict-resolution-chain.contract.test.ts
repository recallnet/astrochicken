import { createBaseGitFixture } from "../helpers/ops-command-fixtures.ts";
import { assertWorkflowEdgeChain as assertEdgeChain, runFixtureCommand as sh } from "../helpers/ops-command-fixtures.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { rebaseBranchOnMain, buildConflictPacket, verifyConflictResolution, emitResolutionFailure } from "../../src/commands/merge-item-ops.ts";
import { resolveMergeWorktreeDir, setupMergeWorktree } from "../../src/commands/merge-worktree.ts";

// ── Helpers ────────────────────────────────────────────────────

function initRepo() {
  return createBaseGitFixture("taxi-conflict-chain-");
}

/** Create a repo with a worktree checked out at a wave branch. */
function initRepoWithWorktree(branchName = "wave/test-wave") {
  const repo = initRepo();
  sh(["git", "branch", branchName], repo);
  const wtDir = mkdtempSync(join(tmpdir(), "taxi-wt-"));
  sh(["git", "worktree", "add", wtDir, branchName], repo);
  return { repo, worktreeDir: wtDir, branch: branchName };
}

/** Create a repo with a conflicting branch. Returns repo and branch. */
function initConflictingRepo(branchName = "wave/test-wave") {
  const repo = initRepo();
  // Create branch with conflicting change
  sh(["git", "checkout", "-b", branchName], repo);
  writeFileSync(join(repo, "file.txt"), "branch-side\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "branch change"], repo);
  // Create divergent main
  sh(["git", "checkout", "main"], repo);
  writeFileSync(join(repo, "file.txt"), "main-side\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "main diverge"], repo);
  return { repo, branch: branchName };
}

const dotPath = "docs/contracts/workflow-ir/mothership/goal_execute.dot";

// ══════════════════════════════════════════════════════════════
// GRAPH CONTRACT TESTS — verify the DOT wiring is correct
// ══════════════════════════════════════════════════════════════

test("graph: rebase-path build_conflict_packet passes --merge-stderr with ${rebase_stderr}", () => {
  const dot = readFileSync(dotPath, "utf8");
  // The rebase-path node (build_conflict_packet) forwards rebase stderr through the typed action contract.
  assert.match(dot, /build_conflict_packet[\s\S]*action_merge_stderr="\$\{rebase_stderr\}"/,
    "rebase-path build_conflict_packet must pass rebase_stderr");
});

test("graph: post-merge-path build_post_merge_packet passes --merge-stderr with ${merge_stderr}", () => {
  const dot = readFileSync(dotPath, "utf8");
  // The post-merge-path node (build_post_merge_packet) forwards merge stderr through the typed action contract.
  assert.match(dot, /build_post_merge_packet[\s\S]*action_merge_stderr="\$\{merge_stderr\}"/,
    "post-merge-path build_post_merge_packet must pass merge_stderr");
});

test("graph: build_conflict_packet passes --worktree-dir with ${merge_worktree_dir}", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /build_conflict_packet[\s\S]*action_worktree_dir="\$\{merge_worktree_dir\}"/);
});

test("graph: rebase_branch outputs rebase_status,rebase_stdout,rebase_stderr", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /rebase_branch[^\]]*outputs="rebase_status,rebase_stdout,rebase_stderr(?:,[^"]+)?"/);
});

test("graph: resolve_conflict node has workdir=${merge_worktree_dir}", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /resolve_conflict[^\]]*workdir="\$\{merge_worktree_dir\}"/);
});

test("graph: verify_resolution passes --merge-worktree-dir ${merge_worktree_dir}", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /verify_resolution[\s\S]*action_merge_worktree_dir="\$\{merge_worktree_dir\}"/);
});

test("graph: conflict-resolution chain finalizes pending merge commits deterministically", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /finalize_merge_commit[\s\S]*action_id="merge\.finalize_commit"/);
  assert.match(dot, /finalize_post_merge_commit[\s\S]*action_id="merge\.finalize_commit"/);
});

test("graph: full edge chain stamps llm provenance before conflict resolution", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /rebase_gate -> set_resolution_source_llm \[condition="rebase_status!=ready"\]/);
  assertEdgeChain(dot, ["set_resolution_source_llm", "build_conflict_packet", "resolve_conflict", "finalize_merge_commit", "finalize_gate"]);
  assert.match(dot, /finalize_gate -> verify_resolution \[condition="finalize_status=ok"\]/);
  assert.match(dot, /finalize_gate -> retry_resolve_conflict \[condition="finalize_status!=ok"\]/);
  assert.match(dot, /retry_resolve_conflict -> verify_resolution/);
  assert.match(dot, /verify_resolution -> resolution_gate/);
  assert.match(dot, /resolution_gate -> emit_resolution_failure \[condition="resolution_status!=resolved"\]/);
  assert.match(dot, /emit_resolution_failure -> set_goal_merge_failed/);
});

test("graph: resolution_gate routes to merge_branch on resolved, emit_resolution_failure on unresolved", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /resolution_gate -> merge_branch \[condition="resolution_status=resolved"\]/);
  assert.match(dot, /resolution_gate -> emit_resolution_failure \[condition="resolution_status!=resolved"\]/);
  assert.match(dot, /emit_resolution_failure -> set_goal_merge_failed/);
  assert.doesNotMatch(dot, /(^|\n)\s*resolution_gate -> set_goal_merge_failed \[condition="resolution_status!=resolved"\]/m);
});

test("graph: build_conflict_packet outputs conflict_packet_path", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /build_conflict_packet[^\]]*outputs="conflict_packet_path(?:,[^"]+)?"/);
});

test("graph: resolve_conflict receives ${conflict_packet_path} in prompt", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /resolve_conflict[^\]]*\$\{conflict_packet_path\}/);
});

test("graph: resolve_conflict uses merge_resolver role class with timeout", () => {
  const dot = readFileSync(dotPath, "utf8");
  const sharedRoles = readFileSync("factories/_shared/roles.stylesheet", "utf8");
  assert.match(dot, /resolve_conflict[^\]]*class="merge_resolver"/);
  assert.match(sharedRoles, /\.merge_resolver[\s\S]*type = "stack\.manager_loop"/);
  assert.match(dot, /resolve_conflict[^\]]*timeout="45m"/);
});

test("graph: rebase_gate routes to deterministic resolver provenance on ready", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /rebase_gate -> set_resolution_source_deterministic \[condition="rebase_status=ready"\]/);
  assert.match(dot, /set_resolution_source_deterministic -> merge_branch/);
});

// ══════════════════════════════════════════════════════════════
// INTEGRATION TESTS — real git repos, chained operations
// ══════════════════════════════════════════════════════════════

test("integration: rebaseBranchOnMain(conflict) → buildConflictPacket produces non-empty conflict_files", () => {
  const { repo, branch } = initConflictingRepo();

  // Step 1: rebase (will conflict)
  const rebaseOut = rebaseBranchOnMain({ repo, branch });
  assert.equal(rebaseOut.rebase_status, "conflict");

  // Step 2: build conflict packet from the conflicted state
  const packetOut = buildConflictPacket({
    repo,
    branch,
    issueNumber: "100",
    mergeStderr: rebaseOut.rebase_stderr,
  });
  assert.ok(packetOut.conflict_packet_path);

  const packet = JSON.parse(readFileSync(packetOut.conflict_packet_path, "utf8"));
  assert.ok(packet.conflict_files.length > 0,
    "conflict_files must be non-empty after rebase conflict — this is the bug that starved the LLM resolver");
  assert.ok(packet.conflict_files.includes("file.txt"));
});

test("integration: rebaseBranchOnMain(conflict) with merge worktree → buildConflictPacket has correct files", () => {
  const { repo, branch } = initConflictingRepo("wave/wt-conflict");
  const mergeWorktreeDir = resolveMergeWorktreeDir({ repo, branch, runId: "conflict-chain", pipeline: "goal-execute" });
  assert.equal(setupMergeWorktree({ repo, branch, runId: "conflict-chain", pipeline: "goal-execute", mergeWorktreeDir }).setup, "true");

  const rebaseOut = rebaseBranchOnMain({ repo, branch, mergeWorktreeDir });
  assert.equal(rebaseOut.rebase_status, "conflict");

  const packetOut = buildConflictPacket({
    repo,
    branch,
    issueNumber: "101",
    mergeStderr: rebaseOut.rebase_stderr,
    worktreeDir: mergeWorktreeDir,
  });

  const packet = JSON.parse(readFileSync(packetOut.conflict_packet_path, "utf8"));
  assert.ok(packet.conflict_files.length > 0,
    "merge worktree conflict must produce non-empty conflict_files");
  assert.ok(packet.conflict_files.includes("file.txt"));
  assert.equal(packet.worktree_dir, mergeWorktreeDir);
});

test("integration: full chain rebase(conflict) → packet → manual resolve → verify → resolved", () => {
  const { repo, branch } = initConflictingRepo("wave/full-chain");

  // Rebase
  const rebaseOut = rebaseBranchOnMain({ repo, branch });
  assert.equal(rebaseOut.rebase_status, "conflict");

  // Build packet
  const packetOut = buildConflictPacket({
    repo,
    branch,
    issueNumber: "102",
    mergeStderr: rebaseOut.rebase_stderr,
  });
  const packet = JSON.parse(readFileSync(packetOut.conflict_packet_path, "utf8"));
  assert.ok(packet.conflict_files.length > 0);

  // Manually resolve the conflict (simulating what the LLM resolver does)
  writeFileSync(join(repo, "file.txt"), "resolved content\n", "utf8");
  sh(["git", "-C", repo, "add", "file.txt"], repo);
  sh(["git", "-C", repo, "commit", "--no-edit"], repo);

  // Now merge main with the resolved branch
  sh(["git", "-C", repo, "checkout", "main"], repo);
  sh(["git", "-C", repo, "merge", "--no-ff", branch], repo);

  // Verify resolution
  const verifyOut = verifyConflictResolution({ repo, branch });
  assert.equal(verifyOut.resolution_status, "resolved");
});

test("integration: packet always has branch_commits when conflict_files is non-empty", () => {
  const { repo, branch } = initConflictingRepo();

  const rebaseOut = rebaseBranchOnMain({ repo, branch });
  const packetOut = buildConflictPacket({
    repo,
    branch,
    issueNumber: "103",
    mergeStderr: rebaseOut.rebase_stderr,
  });
  const packet = JSON.parse(readFileSync(packetOut.conflict_packet_path, "utf8"));

  assert.ok(packet.conflict_files.length > 0, "precondition: conflict files exist");
  assert.ok(packet.branch_commits.length > 0,
    "branch_commits must be populated when conflicts exist — the LLM needs commit context");
  assert.ok(packet.main_commits_touching_conflicts.length > 0,
    "main_commits_touching_conflicts must be populated when conflicts exist");
});

// ══════════════════════════════════════════════════════════════
// UNIT TESTS — buildConflictPacket fallback behavior
// ══════════════════════════════════════════════════════════════

test("unit: buildConflictPacket uses stderr fallback when git diff finds no UU files", () => {
  // Clean repo — no merge state, so git diff --diff-filter=U returns nothing
  const repo = initRepo();
  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "extra.txt"), "new\n", "utf8");
  sh(["git", "add", "extra.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);
  sh(["git", "checkout", "main"], repo);

  // Provide stderr that contains rebase_conflict_files
  const fakeStderr = "CONFLICT (content): Merge conflict in foo.txt\nrebase_conflict_files=foo.txt,bar.txt\nSome other output";

  const out = buildConflictPacket({
    repo,
    branch: "wave/1",
    issueNumber: "200",
    mergeStderr: fakeStderr,
  });
  const packet = JSON.parse(readFileSync(out.conflict_packet_path, "utf8"));

  assert.deepEqual(packet.conflict_files, ["foo.txt", "bar.txt"],
    "Must fall back to rebase_conflict_files from stderr when UU detection returns empty");
});

test("unit: buildConflictPacket with empty everything produces empty conflict_files (no crash)", () => {
  const repo = initRepo();
  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "extra.txt"), "new\n", "utf8");
  sh(["git", "add", "extra.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);
  sh(["git", "checkout", "main"], repo);

  const out = buildConflictPacket({
    repo,
    branch: "wave/1",
    issueNumber: "201",
    mergeStderr: "",
  });
  const packet = JSON.parse(readFileSync(out.conflict_packet_path, "utf8"));

  assert.deepEqual(packet.conflict_files, [],
    "Empty repo + empty stderr → empty conflict_files (graceful degradation)");
  assert.ok(packet.branch_commits.length > 0, "Branch commits should still be captured");
});

test("unit: buildConflictPacket stores worktree_dir it was given", () => {
  const repo = initRepo();
  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "extra.txt"), "new\n", "utf8");
  sh(["git", "add", "extra.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);
  sh(["git", "checkout", "main"], repo);

  // Start a merge to get conflict state
  const fakeStderr = "rebase_conflict_files=x.txt";
  const out = buildConflictPacket({
    repo,
    branch: "wave/1",
    issueNumber: "202",
    mergeStderr: fakeStderr,
    worktreeDir: "/tmp/my-worktree",
  });

  // worktreeDir doesn't exist so git commands fall back to repo, but packet should store it
  const packet = JSON.parse(readFileSync(out.conflict_packet_path, "utf8"));
  assert.equal(packet.worktree_dir, "/tmp/my-worktree",
    "Packet must preserve the worktree_dir for downstream nodes (resolve_conflict workdir)");
});

test("unit: buildConflictPacket stderr fallback handles single file", () => {
  const repo = initRepo();
  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "a.txt"), "new\n", "utf8");
  sh(["git", "add", "a.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);
  sh(["git", "checkout", "main"], repo);

  const out = buildConflictPacket({
    repo,
    branch: "wave/1",
    issueNumber: "203",
    mergeStderr: "rebase_conflict_files=only-one.txt",
  });
  const packet = JSON.parse(readFileSync(out.conflict_packet_path, "utf8"));
  assert.deepEqual(packet.conflict_files, ["only-one.txt"]);
});

test("unit: buildConflictPacket stderr fallback ignores empty rebase_conflict_files value", () => {
  const repo = initRepo();
  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "a.txt"), "new\n", "utf8");
  sh(["git", "add", "a.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);
  sh(["git", "checkout", "main"], repo);

  const out = buildConflictPacket({
    repo,
    branch: "wave/1",
    issueNumber: "204",
    mergeStderr: "rebase_conflict_files=",
  });
  const packet = JSON.parse(readFileSync(out.conflict_packet_path, "utf8"));
  assert.deepEqual(packet.conflict_files, [],
    "Empty value after rebase_conflict_files= should produce empty array");
});

test("unit: buildConflictPacket prefers UU detection over stderr fallback", () => {
  const { repo, branch } = initConflictingRepo("wave/prefer-uu");

  // Start a merge that actually conflicts (leaves UU files in repo)
  spawnSync("git", ["-C", repo, "merge", "--no-ff", branch], { encoding: "utf8" });

  const out = buildConflictPacket({
    repo,
    branch,
    issueNumber: "205",
    mergeStderr: "rebase_conflict_files=decoy.txt",
  });
  const packet = JSON.parse(readFileSync(out.conflict_packet_path, "utf8"));

  // UU detection finds file.txt, should NOT use stderr fallback
  assert.ok(packet.conflict_files.includes("file.txt"),
    "UU detection should find the actual conflict file");
  assert.ok(!packet.conflict_files.includes("decoy.txt"),
    "stderr fallback should NOT be used when UU detection succeeds");
});

test("event: emitResolutionFailure writes ndjson telemetry with required fields", () => {
  const root = mkdtempSync(join(tmpdir(), "merge-failure-events-"));
  const runsDir = join(root, ".hatch", "mothership", "runs");
  mkdirSync(runsDir, { recursive: true });

  const out = emitResolutionFailure({
    recurrenceKey: "goal_execute::set_resolution_source_llm::merge_conflict_llm_resolution",
    resolutionNotes: "resolver failed to clear conflicts",
    resolutionCheck: "Unmerged paths remain: file.txt",
    branch: "wave/goal-1730-wave-1",
    issue: "1748",
    runId: "run-1748",
    factoryId: "mothership",
    runsDir,
  });

  const eventsPath = join(root, ".hatch", "mothership", "events", "merge_conflict_resolution_failures.ndjson");
  const lines = readFileSync(eventsPath, "utf8").trim().split(/\r?\n/).filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]);

  assert.equal(out.event, "merge_conflict_llm_resolution_failure");
  assert.equal(last.event, "merge_conflict_llm_resolution_failure");
  assert.equal(last.recurrence_key, "goal_execute::set_resolution_source_llm::merge_conflict_llm_resolution");
  assert.equal(last.resolution_notes, "resolver failed to clear conflicts");
  assert.equal(last.resolution_check, "Unmerged paths remain: file.txt");
  assert.equal(last.branch, "wave/goal-1730-wave-1");
  assert.equal(last.issue, "1748");
  assert.equal(last.run_id, "run-1748");
  assert.equal(last.factory_id, "mothership");
  assert.match(String(last.timestamp || ""), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

// ══════════════════════════════════════════════════════════════
// GRAPH CONTRACT: post-merge resolution must set merge status
// ══════════════════════════════════════════════════════════════

test("graph: post_merge_resolution_gate routes through set_goal_merged on resolved (goal_execute)", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/goal_execute.dot", "utf8");
  // After successful post-merge conflict resolution, the graph must set
  // goal_merge_status before pushing. Without this, build_merged_results
  // sees an empty status and classifies the merge as failed.
  assert.match(dot,
    /post_merge_resolution_gate -> set_goal_merged \[condition="resolution_status=resolved"\]/,
    "post_merge_resolution_gate must route to set_goal_merged on resolved, not directly to push_main_branch");
  assert.doesNotMatch(dot,
    /post_merge_resolution_gate -> push_main_branch \[condition="resolution_status=resolved"\]/,
    "post_merge_resolution_gate must NOT route directly to push_main_branch (bypasses merge status)");
});

test("graph: post_merge_resolution_gate routes through set_wave_merged on resolved (wave_execute)", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/wave_execute.dot", "utf8");
  assert.match(dot,
    /post_merge_resolution_gate -> set_wave_merged \[condition="resolution_status=resolved"\]/,
    "post_merge_resolution_gate must route to set_wave_merged on resolved, not directly to push_main_branch");
  assert.doesNotMatch(dot,
    /post_merge_resolution_gate -> push_main_branch \[condition="resolution_status=resolved"\]/,
    "post_merge_resolution_gate must NOT route directly to push_main_branch (bypasses merge status)");
});

test("cli: hatch-ops merge run-count command is registered and exposes recurrence-key flag", () => {
  const cliPath = join(process.cwd(), "packages", "factory-ops", "src", "cli.ts");
  const out = spawnSync("node", [cliPath, "merge", "run-count", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(out.status, 0);
  const output = `${out.stdout || ""}\n${out.stderr || ""}`;
  assert.match(output, /--recurrence-key/);
  assert.match(output, /--lookback-hours/);
  assert.match(output, /--factory-id/);
});
