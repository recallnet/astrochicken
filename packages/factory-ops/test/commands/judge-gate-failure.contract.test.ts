// judge-gate-failure.contract.test.mjs
//
// Behavioral tests for judge gate failure operational consequences.
// When a judge gate FAILS, the factory must:
// 1. Block/close the wave marker (blockReadyWaveIssue)
// 2. Release the wave claim
// 3. Requeue for retry (requeueAfterJudgeFailure)
// 4. Create a followup artifact
// 5. Release the merge lock
//
// These tests exercise the actual functions, not just graph wiring.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Sections A, B, C removed — blockReadyWaveIssue (wave-block-ready.mjs) and
// requeueAfterJudgeFailure (wave-sanitize-executor.mjs) were deleted in goal migration.

// ============================================================================
// D. Graph contracts: judge failure routes (updated to goal_execute.dot)
// ============================================================================

test("goal_execute.dot — judge context gate failure routes to recovery packet and no_merge_exit", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/goal_execute.dot", "utf8");
  assert.match(dot, /judge_context_gate/, "judge_context_gate must exist");
  assert.match(dot, /build_judge_context_recovery_packet/, "context gate failure must route to recovery packet");
  assert.match(dot, /build_judge_context_recovery_packet -> no_merge_exit/, "recovery packet must route to no_merge_exit");
});

test("goal_execute.dot — judge evidence gate failure routes to recovery packet and no_merge_exit", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/goal_execute.dot", "utf8");
  assert.match(dot, /judge_evidence_gate/, "judge_evidence_gate must exist");
  assert.match(dot, /build_judge_evidence_recovery_packet/, "evidence gate failure must route to recovery packet");
  assert.match(dot, /build_judge_evidence_recovery_packet -> no_merge_exit/, "recovery packet must route to no_merge_exit");
});

test("goal_execute.dot — judge pass=false routes to no_merge_exit", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/goal_execute.dot", "utf8");
  assert.match(dot, /judge_pass_gate/, "judge_pass_gate must exist");
  assert.match(dot, /judge_pass_gate -> no_merge_exit \[condition="disposition!=approve"\]/, "judge failure must route to no_merge_exit");
});

test("goal_execute.dot — goal_terminal_path is used for routing", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/goal_execute.dot", "utf8");
  assert.match(dot, /goal_terminal_path/, "goal_terminal_path must be used for routing");
});

test("goal_execute.dot — judge pass routes through final_state_review then release_merge_lock", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/goal_execute.dot", "utf8");
  assert.match(dot, /judge_pass_gate -> final_state_review \[condition="disposition=approve"\]/);
  // final_state_review routes through build_approved_features → set_scenarios_root → write_scenarios → release_merge_lock
  assert.match(dot, /final_state_review -> build_approved_features/);
  assert.match(dot, /write_scenarios -> release_merge_lock/);
  assert.match(dot, /no_merge_exit -> no_merge_finalizer_gate/);
  assert.match(dot, /no_merge_finalizer_gate -> release_merge_lock \[condition="goal_execution_mode!=direct"\]/);
  assert.match(dot, /no_merge_finalizer_gate -> final_state_review_no_merge \[condition="goal_execution_mode=direct"\]/);
});
