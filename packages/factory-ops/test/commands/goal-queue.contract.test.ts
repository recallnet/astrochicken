import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dotPath = "docs/contracts/workflow-ir/capability-goal-decomposition/goal_queue.dot";

test("goal_queue uses b64 payload transport for goal list counting/filtering", () => {
  const dot = readFileSync(dotPath, "utf8");

  assert.match(dot, /typed_action_transport_mode = "enforced"/);
  assert.match(dot, /list_goals[\s\S]*action_runtime="in_process" action_id="goal\.list_ready"/);
  assert.match(dot, /count_goals[\s\S]*action_runtime="in_process" action_id="common\.count_json_items"/);
  assert.match(dot, /count_goals[\s\S]*action_raw_b64="\$\{goal_issues_b64\}"/);
  assert.match(dot, /keep_all[\s\S]*action_runtime="in_process" action_id="goal\.filter_kept_goals"/);
  assert.match(dot, /keep_all[\s\S]*action_issues_b64="\$\{goal_issues_b64\}"/);
  assert.match(dot, /keep_all[\s\S]*action_decisions_b64="W10="/);
});

test("goal_queue evaluates single-goal review skip telemetry and gates directly to keep_all", () => {
  const dot = readFileSync(dotPath, "utf8");

  assert.match(dot, /normalize_labels[\s\S]*action_runtime="in_process" action_id="labels\.normalize_issue_state"/);
  assert.match(dot, /sanitize_governance_overlap[\s\S]*action_runtime="in_process" action_id="governance\.sanitize_overlap"/);
  assert.match(dot, /auto_ready_artifacts[\s\S]*action_runtime="in_process" action_id="goal\.auto_ready_artifacts"/);
  assert.match(dot, /sanitize_goal_duplicates[\s\S]*action_runtime="in_process" action_id="goal\.sanitize_duplicates"/);
  assert.match(dot, /resolve_skip_review_single_goal[\s\S]*action_runtime="in_process" action_id="common\.resolve_boolean"/);
  assert.match(dot, /resolve_skip_review_single_goal[\s\S]*action_value="\$\{skip_review_single_goal\}"/);
  assert.match(dot, /resolve_skip_review_single_goal[\s\S]*action_fallback="false"/);
  assert.match(dot, /evaluate_goal_review_skip[\s\S]*outputs="skip,reason,hatch_ceremony_pipeline,hatch_ceremony_skipped,hatch_ceremony_skip_reason,hatch_ceremony_reason"/);
  assert.match(dot, /evaluate_goal_review_skip[\s\S]*action_runtime="in_process" action_id="ceremony\.goal_review_skip"/);
  assert.match(dot, /evaluate_goal_review_skip[\s\S]*action_goal_count="\$\{goal_count\}"/);
  assert.match(dot, /evaluate_goal_review_skip[\s\S]*action_skip_review_single_goal="\$\{skip_review_single_goal\}"/);
  assert.match(dot, /evaluate_goal_review_skip[\s\S]*action_pipeline="goal_queue"/);
  assert.match(dot, /evaluate_goal_review_skip -> skip_review_gate/);
  assert.match(dot, /skip_review_gate -> keep_all \[condition="skip=true"[^\]]*\]/);
  assert.match(dot, /skip_review_gate -> keep_all \[condition="skip!=true"[^\]]*\]/);
  assert.doesNotMatch(dot, /\breview_goals\b/);
});
