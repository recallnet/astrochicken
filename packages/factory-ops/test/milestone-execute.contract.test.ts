import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dotPath = "docs/contracts/workflow-ir/mothership/milestone_execute.dot";
const parallelItemPath = "docs/contracts/workflow-ir/mothership/milestone_execute_parallel_item.dot";

test("milestone_execute loops deterministically and exits when no next issue", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /pipeline="factories\/mothership\/graphs\/wave_issue_execute\.dot"/);
  assert.match(dot, /gate -> done \[condition="has_next!=true"\]/);
  assert.match(dot, /gate -> estimate_next_issue_complexity \[condition="has_next=true"\]/);
  assert.match(dot, /execute_issue -> accumulate -> postmortem_gate/);
  assert.match(dot, /collect_parallel_batch -> accumulate_parallel/);
  assert.match(dot, /accumulate_parallel -> postmortem_gate/);
  assert.match(dot, /postmortem_gate -> next_issue \[condition="last_review_failed!=true"\]/);
  // make_issue_item and init_results removed
  assert.doesNotMatch(dot, /make_issue_item/);
  assert.doesNotMatch(dot, /init_results/);
});

test("milestone_execute keeps shared conveyor context while parallel children isolate branch/session", () => {
  const dot = readFileSync(dotPath, "utf8");
  const parallelDot = readFileSync(parallelItemPath, "utf8");

  // Single conveyor context seeded once per milestone.
  assert.match(dot, /init_branch \[type="tool"/);
  assert.match(dot, /action_id="software\.empty_milestone_branch_context"/);
  assert.match(dot, /action_milestone_title="\$\{milestone_title\}"/);
  assert.match(dot, /outputs="branch,worktree_dir,agent_session_id,wave_sessions_dir"/);

  // Sequential path still inherits shared context.
  assert.match(dot, /execute_issue \[type="pipeline"/);
  assert.match(dot, /inherit_context="true"/);
  assert.match(dot, /export_keys="impl_result"/);

  // Parallel children must derive per-issue isolated branch/session before execution.
  assert.match(parallelDot, /isolate_parallel_context \[type="tool"/);
  assert.match(parallelDot, /outputs="branch,worktree_dir,agent_session_id"/);
  assert.match(parallelDot, /action_id="software\.build_milestone_parallel_context"/);
  assert.match(parallelDot, /action_milestone_title="\$\{milestone_title\}"/);
  assert.match(parallelDot, /action_issue_number="\$\{next_issue_number\}"/);
  assert.match(parallelDot, /start -> extract_parallel_issue -> isolate_parallel_context -> execute_issue -> done/);
  assert.doesNotMatch(parallelDot, /start -> extract_parallel_issue -> execute_issue -> done/);

  // Accumulator must keep branch/worktree context alive across loop iterations.
  assert.match(dot, /outputs="impl_results,completed_issues,processed_issues,last_review_failed,last_review_notes,last_issue_number,last_branch,branch,worktree_dir,last_review_evidence_path"/);
});

test("milestone_execute classifies complexity and routes low issues through bounded parallel batches", () => {
  const dot = readFileSync(dotPath, "utf8");

  assert.match(dot, /resolve_parallel_low_enabled[\s\S]*action_id="common\.resolve_boolean"/);
  assert.match(dot, /resolve_parallel_low_enabled[\s\S]*action_value="\$\{milestone_parallel_low_enabled\}"/);
  assert.match(dot, /resolve_parallel_low_enabled[\s\S]*action_fallback="false"/);
  assert.match(dot, /resolve_max_parallel_low[\s\S]*action_id="common\.resolve_default"/);
  assert.match(dot, /resolve_max_parallel_low[\s\S]*action_value="\$\{max_parallel_low\}"/);
  assert.match(dot, /resolve_max_parallel_low[\s\S]*action_fallback="3"/);
  assert.match(dot, /estimate_next_issue_complexity[\s\S]*action_id="coding\.estimate_issue_complexity"/);
  assert.match(dot, /estimate_next_issue_complexity[\s\S]*action_issue_title="\$\{next_issue_title\}"/);
  assert.match(dot, /classify_next_issue_complexity[\s\S]*outputs="complexity_class,run_parallel_batch,reason,hatch_ceremony_pipeline,hatch_ceremony_skipped,hatch_ceremony_skip_reason,hatch_ceremony_reason"/);
  assert.match(dot, /classify_next_issue_complexity[\s\S]*action_id="ceremony\.classify_milestone"/);
  assert.match(dot, /classify_next_issue_complexity[\s\S]*action_complexity_class="\$\{complexity_class\}"/);
  assert.match(dot, /build_parallel_batch[\s\S]*outputs="batch_issues,batch_size,reason,hatch_ceremony_pipeline,hatch_ceremony_skipped,hatch_ceremony_skip_reason,hatch_ceremony_reason"/);
  assert.match(dot, /next_issue[\s\S]*outputs="has_next,next_issue_number,next_issue_title,remaining_count,blocked_count,no_next_reason,ordered_candidate_issues,ordered_candidate_issues_b64"/);
  assert.match(dot, /next_issue[\s\S]*action_id="software\.pick_next_milestone_issue"/);
  assert.match(dot, /build_parallel_batch[\s\S]*action_id="ceremony\.build_milestone_batch"/);
  assert.match(dot, /build_parallel_batch[\s\S]*action_issues_b64="\$\{ordered_candidate_issues_b64\}"/);
  assert.match(dot, /execute_parallel_batch \[type="fan_out.dynamic"/);
  assert.match(dot, /template="factories\/mothership\/graphs\/milestone_execute_parallel_item\.dot"/);
  assert.match(dot, /max_concurrency="3"/);
  assert.match(dot, /accumulate_parallel[\s\S]*action_id="software\.accumulate_milestone_batch"/);
  assert.match(dot, /accumulate_parallel[\s\S]*action_items="\$\{parallel_impl_results\}"/);
});

test("milestone_execute_parallel_item uses typed action transport for issue extraction", () => {
  const dot = readFileSync(parallelItemPath, "utf8");
  assert.match(dot, /extract_parallel_issue[\s\S]*action_id="coding\.extract_issue_item"/);
  assert.match(dot, /action_issue_item="\$\{parallel_issue\}"/);
  assert.doesNotMatch(dot, /hatch-ops wave-issue extract/);
});

test("milestone_execute no longer shells into repo-internal CLI transport for deterministic nodes", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.doesNotMatch(dot, /prompt="hatch-ops /);
});

test("milestone_execute_parallel_item no longer shells into repo-internal CLI transport", () => {
  const dot = readFileSync(parallelItemPath, "utf8");
  assert.doesNotMatch(dot, /prompt="hatch-ops /);
});
