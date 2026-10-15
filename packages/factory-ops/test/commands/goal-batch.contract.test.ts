import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dotPath = "docs/contracts/workflow-ir/capability-goal-decomposition/goal_batch.dot";

test("goal_batch commandizes count/apply/filter via ops CLI with b64 payload transport", () => {
  const dot = readFileSync(dotPath, "utf8");

  assert.match(dot, /typed_action_transport_mode = "enforced"/);
  assert.match(dot, /count_goals[\s\S]*action_runtime="in_process" action_id="common\.count_json_items"/);
  assert.match(dot, /count_goals[\s\S]*action_raw_b64="\$\{goal_issues_b64\}"/);
  assert.match(dot, /apply_decisions[\s\S]*action_runtime="in_process" action_id="goal\.apply_decisions"/);
  assert.match(dot, /apply_decisions[\s\S]*action_decisions_b64="\$\{decisions_b64\}"/);
  assert.match(dot, /filter_kept[\s\S]*action_runtime="in_process" action_id="goal\.filter_kept_goals"/);
  assert.match(dot, /filter_kept[\s\S]*action_issues_b64="\$\{goal_issues_b64\}"/);
  assert.match(dot, /filter_kept[\s\S]*action_decisions_b64="\$\{decisions_b64\}"/);
});

test("goal_batch bypasses review_goals for single-goal ticks via deterministic ceremony helper", () => {
  const dot = readFileSync(dotPath, "utf8");

  assert.match(dot, /resolve_skip_review_single_goal[\s\S]*action_runtime="in_process" action_id="common\.resolve_boolean"/);
  assert.match(dot, /resolve_skip_review_single_goal[\s\S]*action_value="\$\{skip_review_single_goal\}"/);
  assert.match(dot, /resolve_skip_review_single_goal[\s\S]*action_fallback="false"/);
  assert.match(dot, /evaluate_goal_review_skip[\s\S]*outputs="skip,reason,goal_count,hatch_ceremony_pipeline,hatch_ceremony_skipped,hatch_ceremony_skip_reason,hatch_ceremony_reason"/);
  assert.match(dot, /evaluate_goal_review_skip[\s\S]*action_runtime="in_process" action_id="ceremony\.goal_review_skip"/);
  assert.match(dot, /evaluate_goal_review_skip[\s\S]*action_goal_count="\$\{goal_count\}"/);
  assert.match(dot, /evaluate_goal_review_skip[\s\S]*action_skip_review_single_goal="\$\{skip_review_single_goal\}"/);
  assert.match(dot, /evaluate_goal_review_skip[\s\S]*action_pipeline="goal_batch"/);
  assert.match(dot, /skip_review_gate -> init_skip_decisions \[condition="skip=true"\]/);
  assert.match(dot, /skip_review_gate -> review_goals \[condition="skip!=true"\]/);
  assert.match(dot, /init_skip_decisions -> filter_kept/);
});

test("goal_batch validates and repairs llm decisions before irreversible goal mutations", () => {
  const dot = readFileSync(dotPath, "utf8");

  assert.match(dot, /validate_decisions/);
  assert.match(dot, /validate_decisions[\s\S]*action_runtime="in_process" action_id="goal\.validate_decisions"/);
  assert.match(dot, /validate_decisions[\s\S]*action_goal_issues="\$\{goal_issues\}"/);
  assert.match(dot, /validate_decisions[\s\S]*action_decisions="\$\{review_result\}"/);
  assert.match(dot, /repair_decisions/);
  assert.match(dot, /fallback_decisions/);
  assert.match(dot, /review_goals -> validate_decisions/);
  assert.match(dot, /validate_decisions -> decisions_gate/);
  assert.match(dot, /decisions_gate -> apply_decisions \[condition="ok=true"/);
  assert.match(dot, /decisions_gate -> repair_decisions \[condition="ok!=true"/);
});

test("goal_batch uses dedicated goal_batch_reviewer role for review and repair", () => {
  const dot = readFileSync(dotPath, "utf8");
  const reviewNode = dot.match(/review_goals\s*\[[\s\S]*?\]/)?.[0] || "";
  const repairNode = dot.match(/repair_decisions\s*\[[\s\S]*?\]/)?.[0] || "";

  assert.match(reviewNode, /class="goal_batch_reviewer"/);
  assert.match(repairNode, /class="goal_batch_reviewer"/);
  assert.doesNotMatch(reviewNode, /class="knowledge_worker"/);
  assert.doesNotMatch(repairNode, /class="knowledge_worker"/);
});

test("goal_batch contains no inline python heredoc", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.doesNotMatch(dot, /python3\s+-\s*<<'PY'/);
});
