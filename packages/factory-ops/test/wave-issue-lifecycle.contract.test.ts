import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { accumulateMilestoneResult } from "../src/commands/milestone-accumulate.ts";
import { computeNextMilestoneIssue } from "../src/commands/milestone-next-issue.ts";
import { decideExistingReuse, resetStaleBranch, buildImplResult, buildInfraFailureImplResult } from "../src/commands/wave-issue-state.ts";
import { splitWaveImplResults } from "../src/commands/wave-split-results.ts";

// ──────────────────────────────────────────────────────────
// These tests codify the required behaviors for the
// wave issue execution lifecycle. They test pipeline
// contracts and ops command behaviors that must hold
// for the factory to make forward progress.
// ──────────────────────────────────────────────────────────

test("wave_issue_execute: init/build use shared branch/worktree/session from milestone context", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/wave_issue_execute.dot", "utf8");

  // Init must accept pre-seeded shared context keys, not allocate per-issue branch/worktree.
  assert.match(dot, /wave-issue (run --op )?init --issue '\$\{issue_number\}' --repo '\$\{repo\}' --branch '\$\{branch\}' --worktree-dir '\$\{worktree_dir\}' --agent-session-id '\$\{agent_session_id\}'/);

  // Agent execution must stay in same branch/session.
  assert.match(dot, /build \[class="coder"/);
  assert.match(dot, /branch="\$\{branch\}"/);
  assert.match(dot, /session_id="\$\{agent_session_id\}"/);
});

test("wave_issue_execute: complexity routing fans in to the existing init path", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/wave_issue_execute.dot", "utf8");

  assert.match(
    dot,
    /start -> set_issue_context -> fetch_issue -> resolve_goal_number -> fetch_goal_issue -> load_intent_stack -> estimate_complexity -> complexity_gate/,
  );
  assert.match(dot, /route_high_complexity -> init/);
  assert.match(dot, /route_medium_complexity -> init/);
  assert.match(dot, /route_default_complexity -> init/);
  assert.match(dot, /init -> cleanup_legacy -> setup -> setup_gate/);
  assert.match(dot, /setup_gate -> ensure_toolchain \[condition="setup=true"\]/);
});

test("wave_issue_execute: review_notes must flow from review output to builder on retry", () => {
  // When the reviewer returns revise with notes, the retry loop must
  // update the review_notes context variable so the builder can act on
  // the feedback. The review node outputs review_verdict, review_notes,
  // and review_reason_codes via output_format="json" +
  // outputs="review_verdict,review_notes,review_reason_codes".
  // On retry, ${review_notes} should contain the reviewer's latest feedback.
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/wave_issue_execute.dot", "utf8");

  // The review node inherits reviewer contract via role class.
  assert.match(dot, /review\s*\[class="reviewer"/, "review node must use reviewer role class");
  const sharedRoles = readFileSync("factories/_shared/roles.stylesheet", "utf8");
  assert.match(sharedRoles, /\.reviewer[\s\S]*outputs = "review_verdict,review_notes,review_reason_codes"/, "reviewer role must define review_notes + review_reason_codes outputs");

  // The build node references ${review_notes} in its prompt
  assert.match(dot, /Reviewer notes.*\$\{review_notes\}/, "build prompt must reference review_notes");
});

test("wave_issue_execute: build prompt gives parent goal context but scopes implementation to the current issue", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/wave_issue_execute.dot", "utf8");

  assert.match(dot, /working inside wave \$\{milestone_title\} on a shared wave branch and shared coding session/i);
  assert.match(dot, /Parent goal: #\$\{goal_issue_number\}/);
  assert.match(dot, /Parent goal issue JSON:\\n\$\{goal_issue\}/);
  assert.match(dot, /Do not implement the whole goal in this pass\. Implement only the current issue first\./);
  assert.match(dot, /Current implementation issue #\$\{issue_number\}: \$\{issue_title\}/);
});

test("wave_issue_execute: build timeout is extended for long-running coding work", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/wave_issue_execute.dot", "utf8");
  assert.match(dot, /build\s*\[class="coder"[\s\S]*timeout="300m"/);
});

test("wave_issue_execute: revise verdict must not reuse existing commits blindly", () => {
  // When an issue got "revise" on the prior attempt, reusing the same
  // commits without modification guarantees the same revise verdict.
  // The pipeline must either:
  // (a) NOT reuse existing commits when prior verdict was revise, or
  // (b) Pass review_notes to the builder to make meaningful changes
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/wave_issue_execute.dot", "utf8");

  // existing_gate routes to set_max_review_attempts when reuse=true,
  // which goes to build with review_notes already set by decide_existing_reuse.
  assert.match(
    dot,
    /existing_gate.*set_max_review_attempts.*condition.*reuse_existing_commits=true/s,
    "existing_gate routes to set_max_review_attempts on reuse"
  );
  assert.match(
    dot,
    /revise_attempt -> send_review_message -> bump_revise -> should_retry_review/,
    "revise path must send reviewer feedback back to the builder before retry budgeting"
  );
});

test("milestone_execute: completed/processed seeded from GitHub state", () => {
  // milestone_execute must seed completed_issues and processed_issues
  // from GitHub (closed issues in milestone) instead of hardcoding [].
  // This prevents re-processing of already-done issues across supervisor ticks.
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/milestone_execute.dot", "utf8");

  // Should use seed-state ops command, NOT hardcoded echo '[]'
  assert.match(dot, /seed_state.*milestone (run --op )?seed-state/s, "must use seed-state ops command");
  assert.match(dot, /outputs="completed_issues,processed_issues"/, "must output both completed and processed");
  assert.doesNotMatch(dot, /init_completed.*echo '\[\]'/, "must NOT hardcode completed_issues as []");
  assert.doesNotMatch(dot, /init_processed.*echo '\[\]'/, "must NOT hardcode processed_issues as []");
});

test("computeNextMilestoneIssue: skips issues already in processed set", () => {
  const issues = [
    { number: 100, title: "Feature A" },
    { number: 101, title: "Feature B" },
    { number: 102, title: "Feature C" },
  ];

  // First call: should return #100
  const r1 = computeNextMilestoneIssue({ milestoneTitle: "wave-1", completed: [], processed: [], issues });
  assert.equal(r1.has_next, true);
  assert.equal(r1.next_issue_number, "100");

  // After processing #100 (revise): should return #101
  const r2 = computeNextMilestoneIssue({ milestoneTitle: "wave-1", completed: [], processed: ["100"], issues });
  assert.equal(r2.has_next, true);
  assert.equal(r2.next_issue_number, "101");

  // After processing #100 (revise) and #101 (approve): should return #102
  const r3 = computeNextMilestoneIssue({ milestoneTitle: "wave-1", completed: ["101"], processed: ["100", "101"], issues });
  assert.equal(r3.has_next, true);
  assert.equal(r3.next_issue_number, "102");

  // After all processed: should return has_next=false
  const r4 = computeNextMilestoneIssue({ milestoneTitle: "wave-1", completed: ["101"], processed: ["100", "101", "102"], issues });
  assert.equal(r4.has_next, false);
  assert.equal(r4.no_next_reason, "none_pending");
});

test("accumulateMilestoneResult: revise items go to processed but not completed", () => {
  // Revise result: should be in processed but NOT completed
  const r1 = accumulateMilestoneResult({
    implResultsRaw: "[]",
    completedRaw: "[]",
    processedRaw: "[]",
    itemRaw: JSON.stringify({ issue_number: "100", review_failed: "true", review_notes: "needs tests" }),
  });
  assert.deepEqual(r1.processed_issues, ["100"]);
  assert.deepEqual(r1.completed_issues, []);
  assert.equal(r1.impl_results.length, 1);

  // Approve result: should be in both processed AND completed
  const r2 = accumulateMilestoneResult({
    implResultsRaw: JSON.stringify(r1.impl_results),
    completedRaw: JSON.stringify(r1.completed_issues),
    processedRaw: JSON.stringify(r1.processed_issues),
    itemRaw: JSON.stringify({ issue_number: "101", review_failed: "false", review_notes: "looks good" }),
  });
  assert.deepEqual(r2.processed_issues, ["100", "101"]);
  assert.deepEqual(r2.completed_issues, ["101"]);
  assert.equal(r2.impl_results.length, 2);
});

test("decideExistingReuse: returns true when no issue/worktree provided (backward compat)", () => {
  const result = decideExistingReuse({ branch: "wave/100", existingCommits: "3" });
  assert.equal(result, "true", "without issue/worktree falls back to commit-count check");
});

test("decideExistingReuse: returns false for zero commits", () => {
  assert.equal(decideExistingReuse({ branch: "wave/100", existingCommits: "0" }), "false");
  assert.equal(decideExistingReuse({ branch: "wave/100" }), "false");
});

test("decideExistingReuse: returns false for milestone branches", () => {
  assert.equal(decideExistingReuse({ branch: "milestone/goal-1", existingCommits: "5" }), "false");
});

test("wave_issue_execute: stale branch with wrong-scope commits gets reset", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/wave_issue_execute.dot", "utf8");

  // decide_existing_reuse passes --issue and --worktree-dir for scope checking
  assert.match(dot, /decide-existing-reuse[^\n]*--issue/, "decide_existing_reuse must pass --issue");
  assert.match(dot, /decide-existing-reuse[^\n]*--worktree-dir/, "decide_existing_reuse must pass --worktree-dir");

  // existing_gate routes to reset_stale_branch on reuse=reset
  assert.match(dot, /existing_gate\s*->\s*reset_stale_branch\s*\[condition="reuse_existing_commits=reset"\]/, "reset path must exist");
  assert.match(dot, /reset_stale_branch\s*->\s*resolve_mode/, "reset must continue to resolve_mode for fresh build");
});

test("wave_issue_execute: approve and revise paths use separate bump nodes", () => {
  // CRITICAL: approve and revise paths must NOT share a bump node.
  // When they share bump_review_attempt, the engine takes the first declared
  // outgoing edge for that node — which routes revise verdicts down the
  // approve/merge path instead of the retry path.
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/wave_issue_execute.dot", "utf8");

  // approve path: approve_attempt -> bump_approve -> report_approved (deferred merge)
  assert.match(dot, /approve_attempt\s*->\s*bump_approve/, "approve path must use bump_approve");
  assert.match(dot, /bump_approve\s*->\s*report_approved/, "bump_approve must lead to report_approved");
  assert.match(dot, /retry_gate\s*->\s*report_retry_failed\s*\[condition="retry_review!=true"\]/, "retry exhaustion must fail closed via report_retry_failed");
  assert.match(dot, /build\s*->\s*report_build_failed\s*\[condition="outcome=fail"\]/, "build infrastructure failure must fail closed via report_build_failed");
  assert.doesNotMatch(dot, /emit_review_fallback_defect/, "emit_review_fallback_defect must not exist (preemptive fallback defect removed)");

  // revise path: revise_attempt -> send_review_message -> bump_revise -> should_retry_review
  assert.match(dot, /revise_attempt\s*->\s*(send_review_message\s*->\s*)?bump_revise/, "revise path must use bump_revise");
  assert.match(dot, /bump_revise\s*->\s*should_retry_review/, "bump_revise must lead to should_retry_review");

  // Must NOT have shared bump_review_attempt in edges
  assert.doesNotMatch(dot, /->\s*bump_review_attempt\s*->/, "must NOT use shared bump_review_attempt in edges");
});

test("buildImplResult: merged flag propagates correctly", () => {
  const merged = buildImplResult({
    issueNumber: "100",
    branch: "wave/100",
    worktreeDir: "/tmp/wave/100",
    reviewFailed: false,
    reviewNotes: "approved",
    merged: true,
  });
  assert.equal(merged.merged, "true");

  const notMerged = buildImplResult({
    issueNumber: "101",
    branch: "wave/101",
    worktreeDir: "/tmp/wave/101",
    reviewFailed: false,
    reviewNotes: "approved",
  });
  assert.equal(notMerged.merged, "false");
});

test("buildInfraFailureImplResult sets disposition=infra_failure and review_failed=true", () => {
  const result = buildInfraFailureImplResult({ issueNumber: "42", branch: "wave/test", worktreeDir: "/tmp/wt", reason: "worktree_add_failed" });
  assert.equal(result.disposition, "infra_failure");
  assert.equal(result.review_failed, "true");
  assert.equal(result.issue_number, "42");
  assert.match(result.review_notes, /worktree_add_failed/);
});

test("splitWaveImplResults skips disposition=infra_failure from both buckets", () => {
  const items = JSON.stringify([
    { issue_number: "1", review_failed: "true", disposition: "infra_failure", review_notes: "setup failed" },
    { issue_number: "2", review_failed: "true", disposition: "", review_notes: "review rejected" },
    { issue_number: "3", review_failed: "false", disposition: "", review_notes: "approved" },
  ]);
  const { merge_candidates, review_failures } = splitWaveImplResults(items);
  // infra_failure must not appear in either bucket
  assert.equal(review_failures.length, 1, "only review rejection in failures");
  assert.equal(review_failures[0].issue_number, "2");
  assert.equal(merge_candidates.length, 1, "approved item in merge candidates");
  assert.equal(merge_candidates[0].issue_number, "3");
});
