import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const dotPath = join(repoRoot, "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot");
const releaseFlowPath = join(repoRoot, "docs/contracts/workflow-ir/capability-release-reporting/release_report_flow.dot");
const goalIssueExecutePath = join(repoRoot, "docs/contracts/workflow-ir/mothership/goal_issue_execute.dot");

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertNodeHasAttributes(dot, nodeId, attributes) {
  const nodeMatch = dot.match(new RegExp(`${escapeRegex(nodeId)} \\[(.*?)\\]`, "s"));
  assert.ok(nodeMatch, `expected node ${nodeId} to exist`);
  const nodeBody = nodeMatch[1];
  for (const attribute of attributes) {
    assert.match(nodeBody, new RegExp(escapeRegex(attribute)));
  }
}

function assertHasPath(dot, pathNodes) {
  const simple = pathNodes.map((nodeId) => escapeRegex(nodeId)).join(" -> ");
  if (new RegExp(simple).test(dot)) {
    return;
  }

  for (let index = 0; index < pathNodes.length - 1; index += 1) {
    const edgePattern = `${escapeRegex(pathNodes[index])} -> ${escapeRegex(pathNodes[index + 1])}`;
    assert.match(dot, new RegExp(edgePattern));
  }
}

// NOTE:
// Wave-execution topology shape (required nodes/edges/ownership + forbidden
// legacy topology) is enforced by parser-based contract tests in:
// apps/hatch/src/pipeline/supervisor-wave-topology-contract.test.ts
// Keep this file focused on non-overlapping supervisor contracts.

test("supervisor tick gates goal decomposition on backlog capacity", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /set_max_concurrent_goals_pre/);
  assert.match(dot, /goal_decompose_backpressure/);
  assert.match(dot, /goal_decompose_gate/);
  assert.match(dot, /goal_decompose_backpressure[\s\S]*action_runtime="in_process" action_id="goal\.decompose_backpressure"/);
  assert.match(dot, /goal_decompose_gate -> keep_all_goals \[condition="decompose_allowed=true"\]/);
  assert.match(dot, /goal_decompose_gate -> set_release_sha \[condition="decompose_allowed!=true"\]/);
});

test("supervisor tick enforces execution-path metadata before goal_run fan-out", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /ensure_goal_execution_path\s*\[type="tool" governance="reversible"/);
  assert.match(dot, /ensure_goal_execution_path[\s\S]*action_runtime="in_process" action_id="goal\.ensure_execution_paths"/);
  assert.match(dot, /outputs="goal_execution_path_count,goal_execution_path_records,goal_execution_paths"/);
  assert.match(dot, /keep_all_goals -> set_max_goal_runs_per_tick/);
  assert.match(dot, /set_max_goal_runs_per_tick -> limit_kept_goals/);
  assert.match(dot, /limit_kept_goals -> ensure_goal_execution_path/);
  assert.match(dot, /ensure_goal_execution_path -> set_capability_goal_decomposition_skills/);
  assert.match(dot, /set_capability_goal_decomposition_skills -> fan_out_goal_run/);

  const goalRunDot = readFileSync(join(repoRoot, "docs/contracts/workflow-ir/capability-goal-decomposition/goal_run.dot"), "utf8");
  assert.match(goalRunDot, /resolve_execution_path \[type="tool" governance="reversible" action_runtime="in_process" action_id="software\.resolve_goal_execution_path"/);
  assertNodeHasAttributes(goalRunDot, "resolve_execution_path", [
    'action_repo="${repo}"',
    'action_goal_issue_number="${issue_number}"',
    'action_goal_execution_paths="${goal_execution_paths}"',
    'action_factory_id="${factory_id}"',
  ]);
  assert.match(goalRunDot, /resolve_hard_goal_state \[type="tool" governance="reversible" action_runtime="in_process" action_id="goal\.inspect_hard_state"/);
  assertNodeHasAttributes(goalRunDot, "resolve_hard_goal_state", [
    'action_repo="${gh_repo}"',
    'action_repo_root="${repo}"',
    'action_goal_issue_number="${issue_number}"',
    'action_goal_execution_path="${goal_execution_path}"',
    'action_goal_routing_state="${goal_routing_state}"',
    'action_factory_id="${factory_id}"',
  ]);
  assert.match(goalRunDot, /admission_check \[type="tool" governance="reversible" action_runtime="in_process" action_id="goal\.inspect_run_admission"/);
  assertNodeHasAttributes(goalRunDot, "admission_check", [
    'action_repo_root="${repo}"',
    'action_goal_issue_number="${issue_number}"',
    'action_goal_execution_path="${goal_execution_path}"',
    'action_goal_routing_state="${goal_routing_state}"',
    'action_factory_id="${factory_id}"',
    'action_hard_goal="${hard_goal}"',
    'action_hard_goal_state="${hard_goal_state}"',
    'action_hard_goal_state_reason="${hard_goal_state_reason}"',
  ]);
  assertHasPath(goalRunDot, ["start", "resolve_execution_path", "resolve_hard_goal_state", "admission_check", "admission_gate"]);
  assert.match(goalRunDot, /duplicate_decompose_guard \[type="tool" governance="irreversible" action_runtime="in_process" action_id="goal\.guard_duplicate_decompose"/);
  assertNodeHasAttributes(goalRunDot, "duplicate_decompose_guard", [
    'action_repo="${gh_repo}"',
    'action_issue_number="${issue_number}"',
    'action_repo_root="${repo}"',
    'action_factory_id="${factory_id}"',
    'action_run_id="${__run_id}"',
    'action_pipeline="goal_run"',
    'action_node_id="duplicate_decompose_guard"',
  ]);
});

test("supervisor tick has bug fast-route gate before normal tick work", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /load_intent_stack/);
  assert.match(dot, /snapshot_state_fast/);
  assert.match(dot, /evaluate_open_bug_gate_fast/);
  // action_id="supervisor.open_bug_gate"
  assert.match(dot, /bug_fast_gate/);
  assert.match(dot, /fast_route_telemetry_open/);
  assert.match(dot, /fast_route_telemetry_clear/);
  assert.match(dot, /supervisor_review_bug_fast/);
  assert.match(dot, /bug_fast_gate -> fast_route_telemetry_open \[condition="has_open_bugs=true"\]/);
  assert.match(dot, /fast_route_telemetry_open -> set_date_fast/);
  assert.match(dot, /bug_fast_resolution_gate -> done \[condition="has_open_bugs=true"\]/);
  assert.match(dot, /bug_fast_gate -> fast_route_telemetry_clear \[condition="has_open_bugs!=true"\]/);
  assert.match(dot, /fast_route_telemetry_clear -> recovery_sweep_runtime/);
  assert.match(dot, /Intent stack JSON:/);
  assert.doesNotMatch(dot, /bug_fast_gate -> set_date_fast \[condition="has_open_bugs=true"\]/);
  assert.doesNotMatch(dot, /bug_fast_gate -> recovery_sweep_runtime \[condition="has_open_bugs!=true"\]/);
  assert.match(dot, /evaluate_open_bug_gate_fast[\s\S]*action_runtime="in_process" action_id="supervisor\.open_bug_gate"/);
});

test("supervisor tick uses one factory-scoped persistent supervisor session across bug-fast and review paths", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /supervisor_review_bug_fast\s*\[[\s\S]*session_id="supervisor-\$\{factory_id\}"/);
  assert.match(dot, /supervisor_review\s*\[[\s\S]*session_id="supervisor-\$\{factory_id\}"/);
  assert.doesNotMatch(dot, /resolve_conflict\s*\[[\s\S]*session_id="supervisor-\$\{factory_id\}"/);
});

test("supervisor tick emits release manifest but does not own hot-path dispatch", () => {
  const dot = readFileSync(dotPath, "utf8");
  const releaseDot = readFileSync(releaseFlowPath, "utf8");

  // Release manifest path is automatic in supervisor flow
  assert.match(dot, /set_source_repos/);
  assert.match(dot, /set_source_repos[\s\S]*action_runtime="in_process" action_id="common\.resolve_default"/);
  assert.match(dot, /set_release_sha/);
  // Release SHA must resolve from main branch explicitly (not HEAD, which can drift if agents switch branches)
  assert.match(dot, /git rev-parse main/);
  assert.match(dot, /release_manifest/);
  assert.match(dot, /release_manifest[\s\S]*action_runtime="in_process" action_id="artifact\.release_manifest"/);
  assert.match(dot, /set_release_sha -> release_manifest/);
  assert.match(dot, /release_manifest -> sync_release_manifest/);
  assert.match(dot, /sync_release_manifest -> emit_disposition_feedback/);
  assert.match(dot, /emit_disposition_feedback -> emit_review_metrics_summary/);
  assert.match(dot, /sync_release_manifest \[type="tool"/);
  // action_id="artifact.emit_disposition_feedback"
  assert.match(dot, /emit_disposition_feedback \[type="tool" governance="irreversible"/);
  assert.match(dot, /emit_disposition_feedback[\s\S]*action_runtime="in_process" action_id="artifact\.emit_disposition_feedback"/);

  // Hot-path dispatch and goal execution have moved to the reactor.
  assert.doesNotMatch(dot, /list_executable_goals/);
  assert.doesNotMatch(dot, /set_max_concurrent_waves_for_goal_execute/);
  assert.doesNotMatch(dot, /goal_execute_gate/);
  assert.doesNotMatch(dot, /stamp_factory_contract_hash/);
  assert.doesNotMatch(dot, /spawn_goal_execute/);
  assert.doesNotMatch(dot, /goal_execute\.dot/);

  // Wave dispatch nodes removed
  assert.doesNotMatch(dot, /sanitize_dispatch_state/);
  assert.doesNotMatch(dot, /list_dispatch_milestones/);
  assert.doesNotMatch(dot, /decide_wave_dispatch/);
  assert.doesNotMatch(dot, /spawn_wave_runs/);
  assert.doesNotMatch(dot, /detect_stalled_wave/);

  // Downstream flow: metrics → lifecycle → tick idle → supervisor review → done
  assert.match(dot, /emit_review_metrics_summary -> evaluate_external_factory_lifecycle/);
  assert.match(dot, /evaluate_external_factory_lifecycle -> external_lifecycle_gate/);
  assert.match(dot, /external_lifecycle_gate -> evaluate_tick_idle \[condition="lifecycle_state!=rejected_upstream"\]/);
  assert.match(dot, /apply_rejected_upstream -> evaluate_tick_idle/);
  assert.match(dot, /evaluate_tick_idle[\s\S]*action_runtime="in_process" action_id="supervisor\.tick_idle_check"/);
  assert.match(dot, /evaluate_tick_idle -> tick_idle_gate/);
  assert.match(dot, /tick_idle_gate -> update_tick_idle_cursor \[condition="tick_idle=true"\]/);
  assert.match(dot, /tick_idle_gate -> supervisor_health \[condition="tick_idle!=true"\]/);
  assert.match(dot, /supervisor_health[\s\S]*action_runtime="in_process" action_id="supervisor\.health_check"/);
  assert.match(dot, /update_tick_idle_cursor -> done/);
  assert.match(dot, /supervisor_health -> snapshot_state/);
  assert.match(dot, /snapshot_state -> set_date/);
  assert.match(dot, /set_date -> evaluate_action_item_gate/);
  assert.match(dot, /evaluate_action_item_gate -> action_item_gate/);
  assert.match(dot, /action_item_gate -> load_supervisor_review_task_prompt \[condition="has_action_items=true"\]/);
  assert.match(dot, /load_supervisor_review_task_prompt -> supervisor_review/);

  // Release report removed from supervisor tick — now a daily scheduled job
  assert.doesNotMatch(dot, /set_release_reporting_repo/);
  assert.doesNotMatch(dot, /run_release_report_flow/);
  // Both no-action-items and supervisor_review route to update_tick_idle_cursor -> done
  assert.match(dot, /action_item_gate -> update_tick_idle_cursor \[condition="has_action_items!=true"\]/);
  assert.match(dot, /supervisor_review -> update_tick_idle_cursor/);

  // release_report_flow.dot is still valid but decoupled from supervisor tick
  assertHasPath(releaseDot, ["start", "build_release_report_context", "load_release_narrator_skill", "release_narrator", "narrative_delivery_gate"]);
  assert.doesNotMatch(releaseDot, /update_tick_idle_cursor/);
  assert.match(releaseDot, /update_release_dedup_cursor -> done/);
  assert.match(releaseDot, /narrative_delivery_gate -> done \[condition="delivery_decision=skip"\]/);
  assert.match(releaseDot, /create_shaping_followup_issue -> build_release_slack_blocks \[condition="delivery_decision=slack_and_issue"\]/);
  assertHasPath(releaseDot, ["build_release_slack_blocks", "encode_release_slack_payload", "post_release_to_slack", "update_release_dedup_cursor"]);
});

test("dispatch reactor reconciles completed goals before executable-goal selection", () => {
  const dispatchDot = readFileSync(join(repoRoot, "factories/mothership/graphs/factory_dispatch_reactor.dot"), "utf8");
  const dot = readFileSync(dotPath, "utf8");
  const sweepCompletedActionId = 'action_id="goal.sweep_completed"';
  assert.doesNotMatch(dot, /sweep_completed_goals/);
  assert.ok(dispatchDot.includes(sweepCompletedActionId));
  assert.match(dispatchDot, /sweep_completed_goals[\s\S]*action_runtime="in_process" action_id="goal\.sweep_completed"/);
  assert.match(dispatchDot, /sanitize_goal_duplicates -> sweep_completed_goals/);
  assert.match(dispatchDot, /sweep_completed_goals -> release_quarantine/);
  assert.match(dispatchDot, /release_quarantine -> set_max_concurrent_waves_for_goal_execute/);
});

test("dispatch reactor releases expired quarantined issues before executable-goal selection", () => {
  const dispatchDot = readFileSync(join(repoRoot, "factories/mothership/graphs/factory_dispatch_reactor.dot"), "utf8");
  const dot = readFileSync(dotPath, "utf8");
  const releaseQuarantineActionId = 'action_id="wave.release_quarantine"';
  assert.doesNotMatch(dot, /release_quarantine \[type="tool" governance="irreversible"/);
  assert.ok(dispatchDot.includes(releaseQuarantineActionId));
  assert.match(dispatchDot, /release_quarantine[\s\S]*action_runtime="in_process" action_id="wave\.release_quarantine"/);
  assert.match(dispatchDot, /sweep_completed_goals -> release_quarantine/);
  assert.match(dispatchDot, /release_quarantine -> set_max_concurrent_waves_for_goal_execute/);
});

test("supervisor tick does not list executable goals for dispatch", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.doesNotMatch(dot, /list_executable_goals \[type="tool"/);
  assert.doesNotMatch(dot, /set_max_concurrent_waves_for_goal_execute \[type="tool" governance="reversible"/);
  assert.doesNotMatch(dot, /software\.list_executable_goals/);
  assert.doesNotMatch(dot, /emit_disposition_feedback -> set_max_concurrent_waves_for_goal_execute -> list_executable_goals -> goal_execute_gate/);
});

test("supervisor tick routes rejected upstream lifecycle to apply-rejected-upstream", () => {
  const dot = readFileSync(dotPath, "utf8");
  // action_id="triage.apply_rejected_upstream"
  assert.match(dot, /evaluate_external_factory_lifecycle/);
  assert.match(dot, /evaluate_external_factory_lifecycle[\s\S]*action_runtime="in_process" action_id="supervisor\.external_factory_lifecycle"/);
  assert.match(dot, /external_lifecycle_gate/);
  assert.match(dot, /external_lifecycle_gate -> apply_rejected_upstream \[condition="lifecycle_state=rejected_upstream"\]/);
  assert.match(dot, /apply_rejected_upstream \[type="tool" governance="irreversible"/);
  assert.match(dot, /apply_rejected_upstream[\s\S]*action_runtime="in_process" action_id="triage\.apply_rejected_upstream"/);
});

test("goal issue execute asserts canonical checkout on main after build", () => {
  const dot = readFileSync(goalIssueExecutePath, "utf8");
  const typedActionId = 'action_id="merge.assert_main_branch"';
  // Post-build canonical checkout protection: the build agent (GPT-5.3 Codex)
  // can switch the canonical checkout away from main during execution.
  // Successful builds must route through assert_main_after_build before commit_push.
  // Build failures should fail closed via report_build_failed without reaching commit_push.
  assert.match(dot, /assert_main_after_build/);
  assert.ok(dot.includes(typedActionId));
  assert.match(dot, /assert_main_after_build[\s\S]*action_runtime="in_process" action_id="merge\.assert_main_branch"[\s\S]*action_repo="\$\{repo\}"/);
  assert.match(dot, /build -> assert_main_after_build \[condition="outcome=success"\]/);
  assert.match(dot, /build -> report_build_failed \[condition="outcome!=success"\]/);
  assert.match(dot, /assert_main_after_build -> commit_push \[condition="ok=true"\]/);
  assert.match(dot, /assert_main_after_build -> report_build_failed \[condition="ok!=true"\]/);
  // Build must NOT route directly to commit_push.
  // (anchor with whitespace to avoid matching assert_main_after_build -> commit_push)
  assert.doesNotMatch(dot, /\s+build -> commit_push/);
  // Goal issue execution must load shared AGENTS/AGENT-LEARNINGS guidance before complexity routing.
  assert.match(dot, /load_agent_guidance_context\s*\[type="tool" governance="reversible"/);
  assert.match(dot, /load_agent_guidance_context[\s\S]*action_runtime="in_process" action_id="common\.load_agent_guidance_context"[\s\S]*action_repo_root="\$\{repo\}"/);
  assert.match(dot, /start -> set_issue_context/);
  assert.match(dot, /set_issue_context -> fetch_issue/);
  assert.match(dot, /fetch_issue -> fetch_goal_issue/);
  assert.match(dot, /fetch_goal_issue -> load_intent_stack/);
  assert.match(dot, /load_intent_stack -> load_agent_guidance_context/);
  assert.match(dot, /load_agent_guidance_context -> estimate_complexity/);
  assert.match(dot, /estimate_complexity -> complexity_gate/);
  assert.match(dot, /AGENTS\.md excerpt \(repo governance contract\):\\n\$\{agents_excerpt\}/);
  assert.match(dot, /AGENT-LEARNINGS\.md excerpt \(recent proven lessons\):\\n\$\{agent_learnings_excerpt\}/);
});

test("state snapshot includes persisted_packet_action_items key", () => {
  const source = readFileSync(
    join(repoRoot, "packages/factory-ops/src/commands/supervisor-state-snapshot.ts"),
    "utf8",
  );
  assert.match(source, /persisted_packet_action_items:\s+persistedPacketActionItems/);
  assert.match(source, /packet_coverage_summary:\s*\{/);
});
