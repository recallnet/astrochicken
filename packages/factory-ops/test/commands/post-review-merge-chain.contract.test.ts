import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  resolveMergeContext,
  rebaseBranchOnMain,
  attemptDeterministicMerge,
  pushMainBranch,
  verifyPushResolution,
} from "../../src/commands/merge-item-ops.ts";

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Factory env vars that must be absent for isolated e2e push tests.
 * These vars cause mutation guards to enforce the live factory policy against
 * temporary test repos, blocking pushes that should succeed in isolation.
 */
const FACTORY_ENV_KEYS = [
  "HATCH_FACTORY_MUTATION_CONTEXT_JSON",
  "HATCH_FACTORY_REPO_ROLES_JSON",
  "MOTHERSHIP_REPO",
  "HATCH_TARGET_REPO",
  "HATCH_CONTROL_PLANE_REPO",
];

/**
 * Run fn() with factory mutation env vars temporarily cleared.
 * Restores original values on exit.
 */
function withIsolatedEnv(fn) {
  const saved = {};
  for (const key of FACTORY_ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of FACTORY_ENV_KEYS) {
      if (saved[key] !== undefined) {
        process.env[key] = saved[key];
      }
    }
  }
}

function sh(args, cwd) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  const p = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8", env });
  if ((p.status ?? 1) !== 0) throw new Error((p.stderr || p.stdout || "cmd failed").trim());
  return String(p.stdout || "").trim();
}

function initRepo() {
  const repo = mkdtempSync(join(tmpdir(), "taxi-chain-"));
  sh(["git", "init", "-b", "main"], repo);
  sh(["git", "config", "user.email", "taxi@example.com"], repo);
  sh(["git", "config", "user.name", "Hatch"], repo);
  writeFileSync(join(repo, "file.txt"), "base\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "--no-verify", "-m", "base"], repo);
  return repo;
}

function initRepoWithBareRemote() {
  const remote = mkdtempSync(join(tmpdir(), "taxi-chain-remote-"));
  sh(["git", "init", "--bare"], remote);
  sh(["git", "symbolic-ref", "HEAD", "refs/heads/main"], remote);
  const repo = initRepo();
  sh(["git", "remote", "add", "origin", remote], repo);
  sh(["git", "push", "--no-verify", "-u", "origin", "main"], repo);
  return { repo, remote };
}

// ═════════════════════════════════════════════════════════════════
// 1. GRAPH CONTRACT: goal_execute.dot post-review chain guarantees
// ═════════════════════════════════════════════════════════════════

const dotPath = "docs/contracts/workflow-ir/mothership/goal_execute.dot";

test("graph: push_status=pushed MUST route to close_merged_issues (no skipping close)", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /push_gate -> close_merged_issues \[condition="push_status=pushed"\]/,
    "Push success must route to close_merged_issues — no alternative path allowed");
});

test("graph: close_merged_issues → check_main_clean → ... → build_merged_results → handle_merge_failures → merged_results_gate is unbroken", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /close_merged_issues -> check_main_clean/);
  assert.match(dot, /main_clean_gate -> build_merged_results \[condition="clean=true"\]/);
  assert.match(dot, /build_merged_results -> handle_merge_failures/);
  assert.match(dot, /handle_merge_failures -> merged_results_gate/);
});

test("graph: clean_main retry counter uses deterministic increment helper, not raw expr", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /advance_clean_attempt[\s\S]*(?:action_id="common\.increment_counter"[\s\S]*action_value="\$\{main_clean_attempt\}"|prompt="hatch-ops common increment-counter --value '\$\{main_clean_attempt\}'")/);
  assert.doesNotMatch(dot, /advance_clean_attempt[\s\S]*prompt="expr /);
});

test("graph: clean_main prompt explicitly owns post-merge repair work", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /clean_main[\s\S]*label="LLM: repair post-merge main"/);
  assert.match(dot, /clean_main[\s\S]*You own both git-state cleanup after merge\/rebase interruptions and post-merge code\/config repairs/);
  assert.match(dot, /clean_main[\s\S]*pnpm test:strict/);
  assert.match(dot, /clean_main[\s\S]*fix\(merge\): repair post-merge main after goal-\$\{goal_issue_number\}/);
});

test("graph: merged_count!=0 MUST route to judge (no skipping judge after merge)", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /merged_results_gate -> judge \[condition="merged_count!=0"\]/,
    "Non-zero merged count must route to judge — merged work cannot skip judging");
});

test("graph: merge_gate handles all attemptDeterministicMerge status values", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /merge_gate -> set_goal_merged \[condition="merge_status=merged"\]/);
  assert.match(dot, /merge_gate -> set_goal_already_merged \[condition="merge_status=already_merged"\]/);
  // conflict + error fall through to the LLM recovery path; already_merged must not
  assert.match(dot, /merge_gate -> build_post_merge_packet \[condition="merge_status!=merged && merge_status!=already_merged"\]/);
});

test("graph: post-merge failure routes through LLM resolver before giving up", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /build_post_merge_packet -> resolve_post_merge/);
  assert.match(dot, /resolve_post_merge -> finalize_post_merge_commit/);
  assert.match(dot, /finalize_post_merge_commit -> finalize_post_merge_gate/);
  assert.match(dot, /finalize_post_merge_gate -> verify_post_merge_resolution \[condition="finalize_status=ok"\]/);
  assert.match(dot, /finalize_post_merge_gate -> retry_resolve_post_merge \[condition="finalize_status!=ok"\]/);
  assert.match(dot, /retry_resolve_post_merge -> verify_post_merge_resolution/);
  assert.match(dot, /post_merge_resolution_gate -> set_goal_merged \[condition="resolution_status=resolved"\]/);
  assert.match(dot, /post_merge_resolution_gate -> set_goal_merge_failed \[condition="resolution_status!=resolved"\]/);
});

test("graph: merge resolver source is explicit before merge result reporting", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /rebase_gate -> set_resolution_source_deterministic \[condition="rebase_status=ready"\]/);
  assert.match(dot, /rebase_gate -> set_resolution_source_llm \[condition="rebase_status!=ready"\]/);
  assert.match(dot, /set_resolution_source_deterministic -> merge_branch/);
  assert.match(dot, /set_resolution_source_llm -> build_conflict_packet/);
  assert.match(dot, /build_conflict_packet -> resolve_conflict/);
  assert.match(dot, /resolve_conflict -> finalize_merge_commit/);
  assert.match(dot, /finalize_merge_commit -> finalize_gate/);
  assert.match(dot, /finalize_gate -> verify_resolution \[condition="finalize_status=ok"\]/);
  assert.match(dot, /finalize_gate -> retry_resolve_conflict \[condition="finalize_status!=ok"\]/);
  assert.match(dot, /retry_resolve_conflict -> verify_resolution/);
  assert.match(dot, /resolution_gate -> emit_resolution_failure \[condition="resolution_status!=resolved"\]/);
  assert.match(dot, /emit_resolution_failure -> set_goal_merge_failed/);
});

test("graph: push failure verifies recovered state and escalates unresolved retries to supervisor before failing", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /push_gate -> build_push_failure_packet \[condition="push_status!=pushed"\]/);
  assert.match(dot, /build_push_failure_packet -> resolve_push_failure/);
  assert.match(dot, /resolve_push_failure -> verify_push_recovery/);
  assert.match(dot, /verify_push_recovery -> push_recovery_gate/);
  assert.match(dot, /push_recovery_gate -> retry_push_main \[condition="resolution_status=resolved"\]/);
  assert.match(dot, /push_recovery_gate -> supervisor_push_recovery \[condition="resolution_status!=resolved"\]/);
  assert.match(dot, /supervisor_push_recovery -> verify_retry_push_recovery/);
  assert.match(dot, /verify_retry_push_recovery -> retry_push_recovery_gate/);
  assert.match(dot, /retry_push_recovery_gate -> retry_push_main \[condition="resolution_status=resolved"\]/);
  assert.match(dot, /retry_push_recovery_gate -> set_goal_merge_failed \[condition="resolution_status!=resolved"\]/);
  assert.match(dot, /retry_push_main -> retry_push_gate/);
  assert.match(dot, /retry_push_gate -> close_merged_issues \[condition="push_status=pushed"\]/);
  assert.match(dot, /retry_push_gate -> set_goal_merge_failed \[condition="push_status!=pushed"\]/);
  assert.match(dot, /set_goal_merge_failed -> cleanup_failed_merge/);
  assert.match(dot, /cleanup_failed_merge -> check_main_clean/);
});

test("graph: both merged and already_merged converge at push_main_branch", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /set_goal_merged -> push_main_branch/);
  assert.match(dot, /set_goal_already_merged -> push_main_branch/);
  assert.match(dot, /push_main_branch[\s\S]*(?:action_id="merge\.push_main_branch"[\s\S]*action_repo="\$\{repo\}"[\s\S]*action_branch="main"[\s\S]*action_remote="origin"[\s\S]*action_merge_worktree_dir="\$\{merge_worktree_dir\}"|push-main --repo '\$\{repo\}' --branch 'main' --remote 'origin' --merge-worktree-dir '\$\{merge_worktree_dir\}')/);
});

test("graph: merge and post-merge conflict agents use merge worktree cwd, never canonical repo cwd", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /resolve_conflict[\s\S]*workdir="\$\{merge_worktree_dir\}"/);
  assert.match(dot, /retry_resolve_conflict[\s\S]*workdir="\$\{merge_worktree_dir\}"/);
  assert.match(dot, /resolve_post_merge[\s\S]*workdir="\$\{merge_worktree_dir\}"/);
  assert.match(dot, /retry_resolve_post_merge[\s\S]*workdir="\$\{merge_worktree_dir\}"/);
  // Ensure resolve_post_merge node itself uses merge worktree, not canonical repo.
  // Use non-greedy match within the node definition (up to next ']') to avoid
  // matching clean_main's workdir="${repo}" which legitimately runs on canonical checkout.
  assert.doesNotMatch(dot, /resolve_post_merge[^[\]]*workdir="\$\{repo\}"/);
});

test("graph: no path from push success that bypasses close_merged_issues", () => {
  const dot = readFileSync(dotPath, "utf8");
  const pushGateEdges = (dot.match(/(?<!\w)push_gate\s*->\s*\S+/g) || []);
  for (const edge of pushGateEdges) {
    assert.match(edge, /close_merged_issues|build_push_failure_packet/,
      `push_gate has unexpected edge: ${edge}`);
  }
  const retryPushGateEdges = (dot.match(/retry_push_gate\s*->\s*\S+/g) || []);
  assert.ok(retryPushGateEdges.length > 0, "retry_push_gate must have outgoing edges");
  for (const edge of retryPushGateEdges) {
    assert.match(edge, /close_merged_issues|set_goal_merge_failed/,
      `retry_push_gate has unexpected edge: ${edge}`);
  }
});

test("graph: merge_candidates_gate=false routes to no_merge_exit without merge attempt", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /merge_candidates_gate -> no_merge_exit \[condition="has_merge_candidates=false"\]/);
});

test("graph: final_state_review runs in direct mode when goal_execution_mode is direct", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /final_state_review\s*\[[^\]]*action_id="software\.reconcile_goal_final_state"/);
  assert.match(dot, /final_state_review\s*\[[^\]]*action_repo="\$\{gh_repo\}"/);
  assert.match(dot, /final_state_review\s*\[[^\]]*action_goal_number="\$\{goal_issue_number\}"/);
  assert.match(dot, /final_state_review\s*\[[^\]]*action_runs_dir="\$\{runs_dir\}"/);
  assert.match(dot, /final_state_review\s*\[[^\]]*action_mode="\$\{goal_execution_mode\}"/);
  assert.match(dot, /final_state_review\s*\[[^\]]*action_direct_goal_result="\$\{goal_merge_status\}"/);
  assert.match(dot, /no_merge_exit -> no_merge_finalizer_gate/);
  assert.match(dot, /no_merge_finalizer_gate -> final_state_review_no_merge \[condition="goal_execution_mode=direct"\]/);
  assert.match(dot, /no_merge_finalizer_gate -> release_merge_lock \[condition="goal_execution_mode!=direct"\]/);
  assert.match(dot, /final_state_review_no_merge\s*\[[^\]]*action_runs_dir="\$\{runs_dir\}"/);
  assert.match(dot, /final_state_review_no_merge -> release_merge_lock/);
});

test("graph: close_merged_issues node has correct outputs", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /close_merged_issues[\s\S]*?outputs="closed_count,failed_count"/);
});

test("graph: build_merged_results node outputs merged_count for merged_results_gate routing", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /build_merged_results[\s\S]*?outputs="merged_results,merge_failures,merged_count,failed_count"/);
});

// ═════════════════════════════════════════════════════════════════
// 2. END-TO-END GIT CHAIN: goal branch → rebase → merge → push
// ═════════════════════════════════════════════════════════════════

test("e2e: shared goal branch with multiple issue commits merges and pushes cleanly", () => {
  const { repo, remote } = initRepoWithBareRemote();

  sh(["git", "checkout", "-b", "goal/1"], repo);
  writeFileSync(join(repo, "feature-100.txt"), "issue 100 work\n", "utf8");
  sh(["git", "add", "feature-100.txt"], repo);
  sh(["git", "commit", "--no-verify", "-m", "feat(goal-1): implement feature A (Closes #100)"], repo);
  writeFileSync(join(repo, "feature-101.txt"), "issue 101 work\n", "utf8");
  sh(["git", "add", "feature-101.txt"], repo);
  sh(["git", "commit", "--no-verify", "-m", "feat(goal-1): implement feature B (Closes #101)"], repo);
  sh(["git", "checkout", "main"], repo);

  // Isolate from live factory env to prevent mutation policy from blocking git ops on temp repo.
  const rebaseOut = withIsolatedEnv(() => rebaseBranchOnMain({ repo, branch: "goal/1" }));
  assert.equal(rebaseOut.rebase_status, "ready");

  const mergeOut = withIsolatedEnv(() => attemptDeterministicMerge({ repo, branch: "goal/1" }));
  assert.equal(mergeOut.merge_status, "merged");

  const pushOut = withIsolatedEnv(() => pushMainBranch({ repo, branch: "main", remote: "origin" }));
  assert.equal(pushOut.push_status, "pushed");

  const verifyOut = verifyPushResolution({ repo, branch: "main", remote: "origin" });
  assert.equal(verifyOut.resolution_status, "resolved");

  const logMain = sh(["git", "-C", repo, "log", "--oneline", "main"], repo);
  assert.match(logMain, /feat\(goal-1\)/);
});

test("e2e: rebase-then-merge succeeds when main has advanced", () => {
  const { repo, remote } = initRepoWithBareRemote();

  sh(["git", "checkout", "-b", "goal/2"], repo);
  writeFileSync(join(repo, "goal-feature.txt"), "goal work\n", "utf8");
  sh(["git", "add", "goal-feature.txt"], repo);
  sh(["git", "commit", "--no-verify", "-m", "feat(goal-2): goal feature (Closes #200)"], repo);

  sh(["git", "checkout", "main"], repo);
  writeFileSync(join(repo, "hotfix.txt"), "hotfix\n", "utf8");
  sh(["git", "add", "hotfix.txt"], repo);
  sh(["git", "commit", "--no-verify", "-m", "fix: hotfix on main"], repo);
  sh(["git", "push", "--no-verify", "origin", "main"], repo);

  // Isolate from live factory env to prevent mutation policy from blocking git ops on temp repo.
  const rebaseOut = withIsolatedEnv(() => rebaseBranchOnMain({ repo, branch: "goal/2" }));
  assert.equal(rebaseOut.rebase_status, "ready");

  const mergeOut = withIsolatedEnv(() => attemptDeterministicMerge({ repo, branch: "goal/2" }));
  assert.equal(mergeOut.merge_status, "merged");

  const pushOut = withIsolatedEnv(() => pushMainBranch({ repo, branch: "main", remote: "origin" }));
  assert.equal(pushOut.push_status, "pushed");

  const verifyOut = verifyPushResolution({ repo, branch: "main", remote: "origin" });
  assert.equal(verifyOut.resolution_status, "resolved");
});

test("e2e: push auto-heals when remote advanced during merge", () => {
  const { repo, remote } = initRepoWithBareRemote();

  sh(["git", "checkout", "-b", "goal/3"], repo);
  writeFileSync(join(repo, "goal-3.txt"), "goal 3 work\n", "utf8");
  sh(["git", "add", "goal-3.txt"], repo);
  sh(["git", "commit", "--no-verify", "-m", "feat(goal-3): goal 3 feature (Closes #300)"], repo);
  sh(["git", "checkout", "main"], repo);

  // Isolate from live factory env to prevent mutation policy from blocking git ops on temp repo.
  const mergeOut = withIsolatedEnv(() => attemptDeterministicMerge({ repo, branch: "goal/3" }));
  assert.equal(mergeOut.merge_status, "merged");

  // Meanwhile, remote main advances with non-overlapping change
  const other = mkdtempSync(join(tmpdir(), "taxi-chain-other-"));
  sh(["git", "clone", "--branch", "main", remote, other], process.cwd());
  sh(["git", "config", "user.email", "taxi@example.com"], other);
  sh(["git", "config", "user.name", "Hatch"], other);
  writeFileSync(join(other, "remote-change.txt"), "remote advance\n", "utf8");
  sh(["git", "add", "remote-change.txt"], other);
  sh(["git", "commit", "--no-verify", "-m", "chore: remote advance"], other);
  sh(["git", "push", "--no-verify", "origin", "main"], other);

  // Isolate from live factory env to prevent mutation policy from blocking push to temp repo.
  const pushOut = withIsolatedEnv(() => pushMainBranch({ repo, branch: "main", remote: "origin" }));
  assert.equal(pushOut.push_status, "pushed", "push must auto-heal when remote advanced non-conflictingly");

  const verifyOut = verifyPushResolution({ repo, branch: "main", remote: "origin" });
  assert.equal(verifyOut.resolution_status, "resolved");
});

test("e2e: push reports conflict when remote has overlapping changes", () => {
  const { repo, remote } = initRepoWithBareRemote();

  sh(["git", "checkout", "-b", "goal/conflict"], repo);
  writeFileSync(join(repo, "file.txt"), "goal change\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "--no-verify", "-m", "feat: goal conflicting change"], repo);
  sh(["git", "checkout", "main"], repo);

  // Isolate from live factory env to prevent mutation policy from blocking git ops on temp repo.
  const mergeOut = withIsolatedEnv(() => attemptDeterministicMerge({ repo, branch: "goal/conflict" }));
  assert.equal(mergeOut.merge_status, "merged");

  const other = mkdtempSync(join(tmpdir(), "taxi-chain-other2-"));
  sh(["git", "clone", "--branch", "main", remote, other], process.cwd());
  sh(["git", "config", "user.email", "taxi@example.com"], other);
  sh(["git", "config", "user.name", "Hatch"], other);
  writeFileSync(join(other, "file.txt"), "conflicting remote change\n", "utf8");
  sh(["git", "add", "file.txt"], other);
  sh(["git", "commit", "--no-verify", "-m", "chore: remote conflicting change"], other);
  sh(["git", "push", "--no-verify", "origin", "main"], other);

  // Isolate from live factory env to prevent mutation policy from blocking push to temp repo.
  const pushOut = withIsolatedEnv(() => pushMainBranch({ repo, branch: "main", remote: "origin" }));
  assert.equal(pushOut.push_status, "conflict",
    "overlapping remote changes must produce 'conflict', not 'error'");
});
