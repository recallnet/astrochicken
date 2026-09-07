import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dotPath = "docs/contracts/workflow-ir/mothership/goal_issue_execute.dot";

function loadDot() {
  return readFileSync(dotPath, "utf8");
}

test("goal_issue_execute opts into enforced typed action transport", () => {
  const dot = loadDot();
  assert.match(dot, /typed_action_transport_mode = "enforced"/);
});

test("goal_issue_execute routes deterministic goal-issue transport through typed actions", () => {
  const dot = loadDot();

  assert.match(dot, /set_issue_context[\s\S]*action_runtime="in_process" action_id="coding\.set_issue_context"/);
  assert.match(dot, /fetch_issue[\s\S]*action_runtime="in_process" action_id="coding\.fetch_issue_body"/);
  assert.match(dot, /fetch_goal_issue[\s\S]*action_runtime="in_process" action_id="goal\.fetch_goal_issue"/);
  assert.match(dot, /load_intent_stack[\s\S]*action_runtime="in_process" action_id="common\.resolve_intent_stack"/);
  assert.match(dot, /load_agent_guidance_context[\s\S]*action_runtime="in_process" action_id="common\.load_agent_guidance_context"/);
  assert.match(dot, /estimate_complexity[\s\S]*action_runtime="in_process" action_id="coding\.estimate_issue_complexity"/);
  assert.match(dot, /cleanup_legacy[\s\S]*action_runtime="in_process" action_id="coding\.cleanup_legacy_worktree"/);
  assert.match(dot, /ensure_toolchain[\s\S]*action_runtime="in_process" action_id="coding\.ensure_worktree_toolchain"/);
  assert.match(dot, /inspect_existing[\s\S]*action_runtime="in_process" action_id="coding\.inspect_existing_commits"/);
  assert.match(dot, /decide_existing_reuse[\s\S]*action_runtime="in_process" action_id="coding\.decide_existing_reuse_with_notes"/);
  assert.match(dot, /reset_stale_branch[\s\S]*action_runtime="in_process" action_id="coding\.reset_stale_branch"/);
  assert.match(dot, /resolve_mode[\s\S]*action_runtime="in_process" action_id="coding\.resolve_execution_mode"/);
  assert.match(dot, /smoke_skip[\s\S]*action_runtime="in_process" action_id="coding\.build_impl_result"/);
  assert.match(dot, /set_max_review_attempts[\s\S]*action_runtime="in_process" action_id="coding\.resolve_max_review_attempts"/);
  assert.match(dot, /snapshot_head[\s\S]*action_runtime="in_process" action_id="coding\.snapshot_branch_head"/);
  assert.match(dot, /assert_main_after_build[\s\S]*action_runtime="in_process" action_id="merge\.assert_main_branch"/);
  assert.match(dot, /commit_push[\s\S]*action_runtime="in_process" action_id="coding\.commit_local"/);
  assert.match(dot, /inspect_changes[\s\S]*action_runtime="in_process" action_id="coding\.inspect_branch_changes"/);
  assert.match(dot, /encode_builder_output[\s\S]*action_runtime="in_process" action_id="common\.encode_base64"/);
  assert.match(dot, /write_review_evidence[\s\S]*action_runtime="in_process" action_id="coding\.write_review_evidence"/);
  assert.match(dot, /build_review_context[\s\S]*action_runtime="in_process" action_id="coding\.build_review_context"/);
  assert.match(dot, /validate_review_context[\s\S]*action_runtime="in_process" action_id="coding\.validate_review_context"/);
  assert.match(dot, /enforce_visual_refinement_evidence[\s\S]*action_runtime="in_process" action_id="coding\.verify_visual_refinement_evidence"/);
  assert.match(dot, /resolve_review_route[\s\S]*action_runtime="in_process" action_id="coding\.resolve_review_route"/);
  assert.match(dot, /emit_review_verdict_telemetry[\s\S]*action_runtime="in_process" action_id="coding\.emit_review_verdict_telemetry"/);
  assert.match(dot, /bump_approve[\s\S]*action_runtime="in_process" action_id="coding\.next_review_attempt"/);
  assert.match(dot, /bump_revise[\s\S]*action_runtime="in_process" action_id="coding\.next_review_attempt"/);
  assert.match(dot, /should_retry_review[\s\S]*action_runtime="in_process" action_id="coding\.should_retry_review"/);
  assert.match(dot, /send_review_message[\s\S]*action_runtime="in_process" action_id="coding\.send_review_message"/);
  assert.match(dot, /report_build_failed[\s\S]*action_runtime="in_process" action_id="coding\.build_failed_result"/);
  assert.match(dot, /report_retry_failed[\s\S]*action_runtime="in_process" action_id="coding\.build_failed_result"/);
  assert.match(dot, /report_approved[\s\S]*action_runtime="in_process" action_id="coding\.build_approved_result"/);
});

test("goal_issue_execute no longer shells into repo-internal goal-issue/common/merge transport for deterministic nodes", () => {
  const dot = loadDot();

  assert.doesNotMatch(dot, /hatch-ops goal-issue /);
  assert.doesNotMatch(dot, /hatch-ops common load-agent-guidance-context/);
  assert.doesNotMatch(dot, /hatch-ops common resolve-intent-stack/);
  assert.doesNotMatch(dot, /hatch-ops merge run --op assert-main-branch/);
});
