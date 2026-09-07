import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  WAVE_ORPHAN_REPAIR_SCHEMA_VERSION,
  collectActiveWaveLeases,
  planWaveOrphanStateRepair,
  sanitizeWaveState,
} from "../src/commands/wave-sanitize-state.ts";

function issue(number, title, labels, milestone = "") {
  return {
    number,
    title,
    labels: labels.map((name) => ({ name })),
    milestone: milestone ? { title: milestone } : null,
    state: "OPEN",
  };
}

test("orphan-state plan emits stable schema and stable ordering", () => {
  const openIssues = [
    issue(12, "Wave Ready: goal-1-wave-1", ["ready"], "goal-1-wave-1"),
    issue(10, "Wave Ready: goal-1-wave-1", ["wave-in-progress"], "goal-1-wave-1"),
    issue(11, "Not a marker", ["ready"]),
  ];

  const activeLeases = collectActiveWaveLeases([], { nowEpochMs: Date.parse("2026-01-01T00:01:00.000Z") });

  const a = planWaveOrphanStateRepair({ openIssues, activeLeases });
  const b = planWaveOrphanStateRepair({ openIssues: [...openIssues].reverse(), activeLeases });

  assert.equal(a.schema_version, WAVE_ORPHAN_REPAIR_SCHEMA_VERSION);
  assert.deepEqual(a, b);
  assert.equal(Array.isArray(a.actions), true);
  assert.equal(typeof a.action_count, "number");
});

test("sanitize-state defaults to dry-run safe mode", () => {
  const out = sanitizeWaveState({ repo: "" });
  assert.equal(out.dry_run, true);
});

test("wave orchestration paths call sanitize-state with explicit apply mode and bounded staleness", () => {
  const dispatchDot = readFileSync("docs/contracts/workflow-ir/mothership/wave_dispatch.dot", "utf8");
  const executeDot = readFileSync("docs/contracts/workflow-ir/mothership/wave_execute.dot", "utf8");
  const supervisorDot = readFileSync("docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot", "utf8");
  const releaseDot = readFileSync("docs/contracts/workflow-ir/capability-release-reporting/release_report_flow.dot", "utf8");

  assert.match(dispatchDot, /sanitize_state[\s\S]*action_id="wave\.sanitize_state"[\s\S]*action_apply="true"/);
  assert.match(executeDot, /sanitize_state[\s\S]*action_id="wave\.sanitize_state"[\s\S]*action_apply="true"/);
  assert.match(supervisorDot, /recovery_sweep_runtime/);
  assert.match(supervisorDot, /recovery_sweep_runtime[\s\S]*action_id="factory\.recovery_sweep"[\s\S]*action_apply="true"/);

  assert.match(dispatchDot, /sanitize_state[\s\S]*action_stale_run_minutes="\$\{stale_run_minutes\}"/);
  assert.match(executeDot, /sanitize_state[\s\S]*action_stale_run_minutes="\$\{stale_run_minutes\}"/);
  assert.match(supervisorDot, /recovery_sweep_runtime[\s\S]*action_stale_minutes="20"/);
  assert.match(supervisorDot, /bug_fast_resolution_gate -> recovery_sweep_runtime \[condition="has_open_bugs!=true"\]/);
  assert.match(supervisorDot, /recovery_sweep_runtime -> list_ready_goals -> count_ready_goals -> goal_gate/);
  // External lifecycle gate now sits between review metrics and idle gate.
  assert.match(supervisorDot, /emit_review_metrics_summary -> evaluate_external_factory_lifecycle -> external_lifecycle_gate/);
  assert.match(supervisorDot, /external_lifecycle_gate -> evaluate_tick_idle \[condition="lifecycle_state!=rejected_upstream"\]/);
  assert.match(supervisorDot, /apply_rejected_upstream -> evaluate_tick_idle/);
  assert.match(supervisorDot, /evaluate_tick_idle -> tick_idle_gate/);
  assert.match(supervisorDot, /tick_idle_gate -> supervisor_health/);
  assert.match(supervisorDot, /supervisor_health -> snapshot_state/);
  assert.match(supervisorDot, /snapshot_state -> set_date/);
  assert.match(supervisorDot, /set_date -> evaluate_action_item_gate/);
  assert.match(supervisorDot, /evaluate_action_item_gate -> action_item_gate/);
  assert.match(supervisorDot, /action_item_gate -> load_supervisor_review_task_prompt \[condition="has_action_items=true"\]/);
  assert.match(supervisorDot, /load_supervisor_review_task_prompt -> supervisor_review/);
  assert.match(supervisorDot, /action_item_gate -> update_tick_idle_cursor \[condition="has_action_items!=true"\]/);
  assert.match(supervisorDot, /supervisor_review -> update_tick_idle_cursor/);
  assert.match(releaseDot, /start -> build_release_report_context -> load_release_narrator_skill -> release_narrator -> narrative_delivery_gate/);
  assert.match(releaseDot, /narrative_delivery_gate -> done \[condition="delivery_decision=skip"\]/);
  assert.match(releaseDot, /narrative_delivery_gate -> encode_release_report_context \[condition="delivery_decision!=skip"\]/);
  assert.match(releaseDot, /encode_release_report_context -> encode_release_narrative/);
  assert.match(releaseDot, /encode_release_narrative -> publish_release_report/);
  assert.match(releaseDot, /publish_release_report -> emit_release_narrative_document/);
  assert.match(releaseDot, /emit_release_narrative_document -> create_shaping_followup_issue/);
  assert.match(releaseDot, /emit_release_narrative_document[\s\S]*governance="reversible"[\s\S]*action_runtime="in_process"[\s\S]*action_id="release\.emit_narrative_document"/);
  assert.match(releaseDot, /create_shaping_followup_issue -> build_release_slack_blocks \[condition="delivery_decision=slack_and_issue"\]/);
  assert.match(releaseDot, /build_release_slack_blocks -> encode_release_slack_payload/);
  assert.match(releaseDot, /encode_release_slack_payload -> post_release_to_slack/);
  assert.match(releaseDot, /post_release_to_slack -> update_release_dedup_cursor/);
  assert.match(releaseDot, /update_release_dedup_cursor -> done/);
});

test("wave_execute uses durable GitHub lock/release commands for in-flight ownership", () => {
  const executeDot = readFileSync("docs/contracts/workflow-ir/mothership/wave_execute.dot", "utf8");
  assert.match(executeDot, /find_ready_wave[\s\S]*action_id="wave\.find_ready"/);
  assert.match(executeDot, /lock_wave[\s\S]*action_id="wave\.lock_ready"/);
  assert.match(executeDot, /release_claim_on_lock_fail[\s\S]*action_id="wave\.release_claim"/);
  assert.match(executeDot, /unlock_ready_issue[\s\S]*action_id="wave\.block_ready"[\s\S]*action_run_id="\$\{__run_id\}"/);
});

test("sanitize-state resolves active leases from durable GitHub source", () => {
  const src = readFileSync("packages/factory-ops/src/commands/wave-sanitize-state.ts", "utf8");
  assert.match(src, /collectActiveWaveLeasesFromRepo\(/);
  assert.doesNotMatch(src, /readAllRunStates\(/);
});

test("orphan-feature fix handled by supervisor LLM via action_items (not dedicated node)", () => {
  const supervisorDot = readFileSync("docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot", "utf8");
  // Orphan features are now surfaced in state_snapshot action_items
  // and handled by supervisor_review LLM (no dedicated fix_orphan_features node)
  assert.doesNotMatch(supervisorDot, /fix_orphan_features/);
  assert.match(supervisorDot, /supervisor_review/);
  assert.match(supervisorDot, /snapshot_state/);
});
