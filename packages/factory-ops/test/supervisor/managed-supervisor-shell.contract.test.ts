import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dotPath = "docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot";

function readDot() {
  return readFileSync(dotPath, "utf8");
}

test("managed supervisor shell graph exists with deterministic shell flow", () => {
  const dot = readDot();
  assert.match(dot, /digraph managed_supervisor/);
  assert.match(dot, /start -> load_context -> manifest_gate/);
  assert.match(dot, /snapshot_state -> check_control_state/);
  assert.match(dot, /check_control_state -> control_state_gate/);
  assert.match(dot, /control_state_gate -> classify_paused \[condition="should_run!=true"\]/);
  assert.match(dot, /control_state_gate -> evaluate_upstream_blockers \[condition="should_run=true"\]/);
  assert.match(dot, /evaluate_upstream_blockers -> upstream_gate/);
  assert.match(dot, /upstream_gate -> set_failure_classification_infrastructure \[condition="has_open_upstream_bugs=true"\]/);
  assert.match(dot, /set_failure_classification_infrastructure -> set_failure_reason_upstream/);
  assert.match(dot, /set_failure_reason_upstream -> classify_blocked_platform/);
  assert.match(dot, /classify_blocked_platform -> set_empty_domain_result/);
  assert.match(dot, /upstream_gate -> evaluate_action_items \[condition="has_open_upstream_bugs!=true"\]/);
  assert.match(dot, /evaluate_action_items -> action_item_gate/);
  assert.match(dot, /action_item_gate -> set_failure_classification_local \[condition="has_action_items=true"\]/);
  assert.match(dot, /set_failure_classification_local -> set_failure_reason_action_items/);
  assert.match(dot, /set_failure_reason_action_items -> classify_blocked_local/);
  assert.match(dot, /classify_blocked_local -> set_empty_domain_result/);
  assert.match(dot, /action_item_gate -> select_intake \[condition="has_action_items!=true"\]/);
  assert.match(dot, /select_intake -> intake_gate/);
  assert.match(dot, /intake_gate -> run_domain_graph \[condition="has_issue=true"\]/);
  assert.match(dot, /run_domain_graph -> classify_domain_failure/);
  assert.match(dot, /classify_domain_failure -> domain_failure_gate/);
  assert.match(dot, /classify_degraded -> persist_lifecycle_state/);
  assert.match(dot, /classify_active -> persist_lifecycle_state/);
  assert.match(dot, /set_empty_domain_result -> persist_lifecycle_state/);
  assert.match(dot, /persist_lifecycle_state -> emit_run_summary/);
  assert.match(dot, /emit_run_summary -> done/);
});

test("managed supervisor blocked and paused paths halt before domain graph", () => {
  const dot = readDot();
  assert.match(dot, /classify_paused -> classify_paused_failure/);
  assert.match(dot, /classify_paused_failure -> set_empty_domain_result/);
  assert.match(dot, /classify_blocked_platform -> set_empty_domain_result/);
  assert.match(dot, /classify_blocked_local -> set_empty_domain_result/);
  assert.match(dot, /set_empty_domain_result -> persist_lifecycle_state/);
  assert.match(dot, /persist_lifecycle_state -> emit_run_summary/);

  assert.match(dot, /control_state_gate -> classify_paused \[condition="should_run!=true"\]/);
  assert.match(dot, /intake_gate -> run_domain_graph \[condition="has_issue=true"\]/);
});

test("managed supervisor shell includes upstream bug gate label contract and telemetry summary node", () => {
  const dot = readDot();
  assert.match(dot, /action_id="supervisor\.managed_control_state_gate"/);
  assert.match(dot, /action_id="supervisor\.upstream_bug_gate"/);
  assert.match(dot, /action_label_filters="\[\\"managed-factory-bug\\",\\"kind:\$\{kind_id\}\\"\]"/);
  assert.match(dot, /action_id="supervisor\.managed_action_item_gate"/);
  assert.match(dot, /action_id="supervisor\.managed_persist_state"/);
  assert.match(dot, /action_factory_id="\$\{factory_id\}"/);
  assert.match(dot, /action_instance_id="\$\{instance_id\}"/);
  assert.match(dot, /action_unresolved_actions="\$\{action_item_count\}"/);
  assert.match(dot, /action_queue_depth="\$\{action_item_count\}"/);
  assert.match(dot, /action_oldest_work_age_seconds="0"/);
  assert.match(dot, /action_latest_incidents="\[\]"/);
  assert.match(dot, /action_id="supervisor\.managed_emit_run_summary"/);
});

test("managed supervisor intake selector is target_repo-first and emits shell-owned intake_json", () => {
  const dot = readDot();
  assert.match(dot, /select_intake[\s\S]*outputs="has_issue,selected_issue_number,selected_issue_title,selected_issue_body,intake_json,parse_error"/);
  assert.match(dot, /action_id="supervisor\.managed_intake_selector"/);
  assert.match(dot, /action_repo="\$\{target_repo\}" action_intake_json="\$\{intake_json\}"/);
  assert.doesNotMatch(dot, /--label 'hatch:intake'/);
});

test("managed supervisor routes to domain graph when open bugs exist even without goal intake", () => {
  const dot = readDot();

  // 1. evaluate_open_bug_gate node must exist with the supervisor.open_bug_gate action
  assert.match(dot, /evaluate_open_bug_gate\s*\[/, "evaluate_open_bug_gate node must exist");
  assert.match(dot, /action_id="supervisor\.open_bug_gate"/, "must use supervisor.open_bug_gate action");

  // 2. open_bug_gate decision diamond must exist
  assert.match(dot, /open_bug_gate\s*\[.*shape="diamond"/, "open_bug_gate decision node must exist");

  // 3. When intake is empty, route to evaluate_open_bug_gate (not directly to idle)
  assert.match(
    dot,
    /intake_gate -> evaluate_open_bug_gate \[condition="has_issue!=true"\]/,
    "no-intake path must route to evaluate_open_bug_gate",
  );

  // 4. The old direct idle path from intake_gate must NOT exist
  assert.doesNotMatch(
    dot,
    /intake_gate -> set_failure_classification_none/,
    "intake_gate must not route directly to idle classification",
  );

  // 5. open_bug_gate routes to run_domain_graph when bugs exist
  assert.match(
    dot,
    /open_bug_gate -> run_domain_graph \[condition="has_open_bugs=true"\]/,
    "open bugs must route to domain graph for bug_fast processing",
  );

  // 6. open_bug_gate routes to sweep before idle when no bugs
  // @context:regression !critical The sweep must run on the idle path so completed
  // goals get closed even when no dispatchable sub-issues remain. Without this,
  // goals with all sub-issues done stay open forever because the domain graph
  // (which contains the other sweep) only runs when intake finds work.
  assert.match(
    dot,
    /open_bug_gate -> sweep_completed_goals_on_idle \[condition="has_open_bugs!=true"\]/,
    "no bugs must route to sweep before idle classification",
  );
  assert.match(
    dot,
    /sweep_completed_goals_on_idle -> close_stale_merge_followups_on_idle/,
    "sweep must feed into merge followup cleanup",
  );
  assert.match(
    dot,
    /close_stale_merge_followups_on_idle -> classify_idle/,
    "merge followup cleanup must feed into idle classification",
  );
  assert.match(
    dot,
    /close_stale_merge_followups_on_idle\s*\[.*action_id="supervisor\.close_stale_merge_followups"/,
    "idle-path merge followup cleanup must use supervisor.close_stale_merge_followups action",
  );
  assert.match(
    dot,
    /sweep_completed_goals_on_idle\s*\[.*action_id="goal\.sweep_completed"/,
    "idle-path sweep must use goal.sweep_completed action",
  );

  assert.doesNotMatch(
    dot,
    /open_bug_gate -> set_failure_classification_local \[condition="has_open_bugs!=true"\]/,
    "no-bug path must not reuse the local action-item failure branch",
  );

  // 7. evaluate_open_bug_gate feeds into open_bug_gate
  assert.match(
    dot,
    /evaluate_open_bug_gate -> open_bug_gate/,
    "evaluate_open_bug_gate must feed into open_bug_gate decision",
  );
});
