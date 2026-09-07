import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActionRegistry, createDefaultActionRegistry } from "../action-registry.js";
import { registerBrainstormActions } from "../action-registry-brainstorm.js";
import { registerDailyLensActions } from "../action-registry-daily-lens.js";
import { registerGoalExecuteActions } from "../action-registry-goal-execute.js";
import { registerGoalIssueActions } from "../action-registry-goal-issue.js";
import { registerGoalRunActions } from "../action-registry-goal-run.js";
import { registerMergeActions } from "../action-registry-merge.js";
import { registerScenarioActions } from "../action-registry-scenarios.js";
import { registerSupervisorActions } from "../action-registry-supervisor.js";
import { registerWaveDispatchActions } from "../action-registry-wave-dispatch.js";
import { registerWaveExecuteActions } from "../action-registry-wave-execute.js";
import { Context, StageStatus } from "../context.js";

import type { Node } from "../graph.js";

const { spawnMock } = vi.hoisted(() => ({
	spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
	spawn: spawnMock,
}));

import { ToolHandler } from "./tool.js";
void registerDailyLensActions; void registerGoalRunActions; void registerSupervisorActions; // maintain export coverage

type MockChildProcess = EventEmitter & {
	stdout: EventEmitter;
	stderr: EventEmitter;
	stdin: {
		on: ReturnType<typeof vi.fn>;
		write: ReturnType<typeof vi.fn>;
		end: ReturnType<typeof vi.fn>;
	};
	kill: ReturnType<typeof vi.fn>;
};

function createMockChildProcess(): MockChildProcess {
	const child = new EventEmitter() as MockChildProcess;
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.stdin = {
		on: vi.fn(),
		write: vi.fn(),
		end: vi.fn(),
	};
	child.kill = vi.fn(() => {
		child.emit("close", null, "SIGTERM");
		return true;
	});
	return child;
}

function mockSpawnSuccess(onCall?: (args: { file: string; argv: string[]; options: any; child: MockChildProcess }) => void): void {
	spawnMock.mockImplementation((file: string, argv: string[], options: any) => {
		const child = createMockChildProcess();
		onCall?.({ file, argv, options, child });
		queueMicrotask(() => {
			child.stdout.emit("data", "ok");
			child.emit("close", 0, null);
		});
		return child;
	});
}

describe("ToolHandler", () => {
	beforeEach(() => {
		spawnMock.mockReset();
	});

	it("provides the default in-process action registry", () => {
		const registry = createDefaultActionRegistry();
		expect(registry.get("context.capture")).toBeDefined();
		expect(registry.get("common.normalize_issue_urls")).toBeDefined();
		expect(registry.get("common.resolve_intent_stack")).toBeDefined();
		expect(registry.get("common.count_json_items")).toBeDefined();
		expect(registry.get("common.count_feature_objects")).toBeDefined();
		expect(registry.get("common.resolve_default")).toBeDefined();
		expect(registry.get("common.resolve_boolean")).toBeDefined();
		expect(registry.get("common.resolve_gh_repo")).toBeDefined();
		expect(registry.get("common.load_agent_guidance_context")).toBeDefined();
		expect(registry.get("common.resolve_capability_coding_skills_path")).toBeDefined();
		expect(registry.get("common.resolve_capability_brainstorming_skills_path")).toBeDefined();
		expect(registry.get("common.resolve_capability_merge_skills_path")).toBeDefined();
		expect(registry.get("common.resolve_capability_goal_decomposition_skills_path")).toBeDefined();
		expect(registry.get("common.resolve_factory_config")).toBeDefined();
		expect(registry.get("brainstorm.build_intake_context")).toBeDefined();
		expect(registry.get("brainstorm.load_context")).toBeDefined();
		expect(registry.get("brainstorm.check_output")).toBeDefined();
		expect(registry.get("brainstorm.loop_guard")).toBeDefined();
		expect(registry.get("brainstorm.post_turn_comment")).toBeDefined();
		expect(registry.get("brainstorm.bump_round")).toBeDefined();
		expect(registry.get("brainstorm.close_issue")).toBeDefined();
		expect(registry.get("scenario.validate_scope")).toBeDefined();
		expect(registry.get("scenario.ensure_structure")).toBeDefined();
		expect(registry.get("scenario.validate_payload")).toBeDefined();
		expect(registry.get("scenario.save")).toBeDefined();
		expect(registry.get("common.normalize_approved")).toBeDefined();
		expect(registry.get("common.increment_counter")).toBeDefined();
		expect(registry.get("common.build_retry_signal")).toBeDefined();
		expect(registry.get("common.inspect_json")).toBeDefined();
		expect(registry.get("common.inspect_json_pair")).toBeDefined();
		expect(registry.get("common.validate_issue_spec_draft")).toBeDefined();
		expect(registry.get("common.create_issue")).toBeDefined();
		expect(registry.get("labels.normalize_issue_state")).toBeDefined();
		expect(registry.get("labels.ensure_factory")).toBeDefined();
		expect(registry.get("governance.sanitize_overlap")).toBeDefined();
		expect(registry.get("ceremony.goal_review_skip")).toBeDefined();
		expect(registry.get("ceremony.decompose_auto_approve")).toBeDefined();
		expect(registry.get("goal.validate_intake")).toBeDefined();
		expect(registry.get("goal.parse_external_bug_report")).toBeDefined();
		expect(registry.get("goal.persist_hard_plan_artifact")).toBeDefined();
		expect(registry.get("goal.validate_planning_artifact")).toBeDefined();
		expect(registry.get("goal.attach_planning_artifacts")).toBeDefined();
		expect(registry.get("goal.mark_planned")).toBeDefined();
		expect(registry.get("judge.build_evidence_contract")).toBeDefined();
		expect(registry.get("judge.build_context_contract")).toBeDefined();
		expect(registry.get("judge.validate_context_contract")).toBeDefined();
		expect(registry.get("judge.validate_evidence_contract")).toBeDefined();
		expect(registry.get("judge.build_recovery_packet")).toBeDefined();
		expect(registry.get("goal.auto_ready_artifacts")).toBeDefined();
		expect(registry.get("goal.sanitize_duplicates")).toBeDefined();
		expect(registry.get("goal.list_ready")).toBeDefined();
		expect(registry.get("goal.validate_approved_features")).toBeDefined();
		expect(registry.get("goal.emit_fallback_defect")).toBeDefined();
		expect(registry.get("goal.fallback_feature_pair")).toBeDefined();
		expect(registry.get("goal.normalize_approved_features")).toBeDefined();
		expect(registry.get("goal.validate_decisions")).toBeDefined();
		expect(registry.get("goal.apply_decisions")).toBeDefined();
		expect(registry.get("goal.filter_kept_goals")).toBeDefined();
		expect(registry.get("goal.decompose_backpressure")).toBeDefined();
		expect(registry.get("goal.limit_kept")).toBeDefined();
		expect(registry.get("goal.sweep_completed")).toBeDefined();
		expect(registry.get("goal.ensure_execution_paths")).toBeDefined();
		expect(registry.get("goal.add_sub_issue")).toBeDefined();
		expect(registry.get("goal.fetch_goal_issue")).toBeDefined();
		expect(registry.get("goal.inspect_hard_state")).toBeDefined();
		expect(registry.get("goal.inspect_run_admission")).toBeDefined();
		expect(registry.get("goal.materialize_approved_plan")).toBeDefined();
		expect(registry.get("goal.post_retry_comment")).toBeDefined();
		expect(registry.get("goal.count_decompose_attempts")).toBeDefined();
		expect(registry.get("goal.exhaust_decompose_retries")).toBeDefined();
		expect(registry.get("goal.post_decompose_attempt")).toBeDefined();
		expect(registry.get("goal.append_rationale_feature")).toBeDefined();
		expect(registry.get("goal.persist_decomposition_packet")).toBeDefined();
		expect(registry.get("goal.label_created_issues")).toBeDefined();
		expect(registry.get("goal.apply_feature_blockers")).toBeDefined();
		expect(registry.get("goal.compute_close_condition")).toBeDefined();
		expect(registry.get("goal.mark_dispatched")).toBeDefined();
		expect(registry.get("goal.build_admission_failure")).toBeDefined();
		expect(registry.get("goal.guard_duplicate_decompose")).toBeDefined();
		expect(registry.get("triage.normalize_issue_urls")).toBeDefined();
		expect(registry.get("triage.zip_features_to_issues")).toBeDefined();
		expect(registry.get("triage.resolve_feature_dependencies")).toBeDefined();
		expect(registry.get("daily_lens.prepare")).toBeDefined();
		expect(registry.get("daily_lens.finalize")).toBeDefined();
		expect(registry.get("daily_lens.generate_followup_candidates")).toBeDefined();
		expect(registry.get("milestone.sweep_empty")).toBeDefined();
		expect(registry.get("wave.release_quarantine")).toBeDefined();
		expect(registry.get("artifact.ingest")).toBeDefined();
		expect(registry.get("artifact.release_manifest")).toBeDefined();
		expect(registry.get("artifact.emit_disposition_feedback")).toBeDefined();
		expect(registry.get("factory.resolve_tracking_issue")).toBeDefined();
		expect(registry.get("factory.recovery_sweep")).toBeDefined();
		expect(registry.get("factory.acquire_lease")).toBeDefined();
		expect(registry.get("factory.release_lease")).toBeDefined();
		expect(registry.get("factory.publish_control_plane_manifest")).toBeDefined();
		expect(registry.get("factory.stamp_contract_hash")).toBeDefined();
		expect(registry.get("factory.review_metrics")).toBeDefined();
		expect(registry.get("merge.extract_item")).toBeDefined();
		expect(registry.get("merge.acquire_lock")).toBeDefined();
		expect(registry.get("merge.setup_worktree")).toBeDefined();
		expect(registry.get("merge.resolve_context")).toBeDefined();
		expect(registry.get("merge.rebase_on_main")).toBeDefined();
		expect(registry.get("merge.attempt_deterministic")).toBeDefined();
		expect(registry.get("merge.assert_main_branch")).toBeDefined();
		expect(registry.get("merge.assert_main_clean")).toBeDefined();
		expect(registry.get("merge.build_commit_message")).toBeDefined();
		expect(registry.get("merge.build_conflict_packet")).toBeDefined();
		expect(registry.get("merge.emit_resolution_failure")).toBeDefined();
		expect(registry.get("merge.finalize_commit")).toBeDefined();
		expect(registry.get("merge.push_main_branch")).toBeDefined();
		expect(registry.get("merge.verify_push_recovery")).toBeDefined();
		expect(registry.get("merge.release_lock")).toBeDefined();
		expect(registry.get("merge.verify_resolution")).toBeDefined();
		expect(registry.get("merge.run_integration")).toBeDefined();
		expect(registry.get("merge.cleanup_worktree")).toBeDefined();
		expect(registry.get("merge.build_report")).toBeDefined();
		expect(registry.get("coding.extract_issue_item")).toBeDefined();
		expect(registry.get("coding.resolve_goal_number_from_milestone")).toBeDefined();
		expect(registry.get("coding.init_wave_issue_worktree")).toBeDefined();
		expect(registry.get("coding.setup_wave_issue_worktree")).toBeDefined();
		expect(registry.get("coding.set_issue_context")).toBeDefined();
		expect(registry.get("coding.fetch_issue_body")).toBeDefined();
		expect(registry.get("coding.estimate_issue_complexity")).toBeDefined();
		expect(registry.get("coding.cleanup_legacy_worktree")).toBeDefined();
		expect(registry.get("coding.ensure_worktree_toolchain")).toBeDefined();
		expect(registry.get("coding.inspect_existing_commits")).toBeDefined();
		expect(registry.get("coding.decide_existing_reuse_with_notes")).toBeDefined();
		expect(registry.get("coding.reset_stale_branch")).toBeDefined();
		expect(registry.get("coding.resolve_execution_mode")).toBeDefined();
		expect(registry.get("coding.build_impl_result")).toBeDefined();
		expect(registry.get("coding.resolve_max_review_attempts")).toBeDefined();
		expect(registry.get("coding.init_review_attempt")).toBeDefined();
		expect(registry.get("coding.next_review_attempt")).toBeDefined();
		expect(registry.get("coding.snapshot_branch_head")).toBeDefined();
		expect(registry.get("coding.commit_local")).toBeDefined();
		expect(registry.get("coding.inspect_branch_changes")).toBeDefined();
		expect(registry.get("coding.write_review_evidence")).toBeDefined();
		expect(registry.get("coding.build_review_context")).toBeDefined();
		expect(registry.get("coding.validate_review_context")).toBeDefined();
		expect(registry.get("coding.verify_visual_refinement_evidence")).toBeDefined();
		expect(registry.get("coding.emit_review_verdict_telemetry")).toBeDefined();
		expect(registry.get("coding.should_retry_review")).toBeDefined();
		expect(registry.get("coding.send_review_message")).toBeDefined();
		expect(registry.get("coding.build_failed_result")).toBeDefined();
		expect(registry.get("coding.build_approved_result")).toBeDefined();
		expect(registry.get("coding.build_infra_failure_result")).toBeDefined();
		expect(registry.get("coding.cleanup_wave_issue_worktree")).toBeDefined();
		expect(registry.get("coding.resolve_review_route")).toBeDefined();
		expect(registry.get("software.resolve_execution_config")).toBeDefined();
		expect(registry.get("software.resolve_wave_config")).toBeDefined();
		expect(registry.get("software.list_executable_goals")).toBeDefined();
		expect(registry.get("software.seed_goal_state")).toBeDefined();
		expect(registry.get("software.seed_milestone_state")).toBeDefined();
		expect(registry.get("software.resolve_goal_execution_path")).toBeDefined();
		expect(registry.get("software.empty_goal_branch_context")).toBeDefined();
		expect(registry.get("software.empty_milestone_branch_context")).toBeDefined();
		expect(registry.get("software.build_goal_execution_plan")).toBeDefined();
		expect(registry.get("software.pick_goal_plan_issue")).toBeDefined();
		expect(registry.get("software.pick_next_milestone_issue")).toBeDefined();
		expect(registry.get("software.advance_plan_index")).toBeDefined();
		expect(registry.get("software.accumulate_goal_result")).toBeDefined();
		expect(registry.get("software.accumulate_milestone_result")).toBeDefined();
		expect(registry.get("software.accumulate_milestone_batch")).toBeDefined();
		expect(registry.get("software.build_milestone_parallel_context")).toBeDefined();
		expect(registry.get("ceremony.classify_milestone")).toBeDefined();
		expect(registry.get("ceremony.build_milestone_batch")).toBeDefined();
		expect(registry.get("software.goal_postmortem")).toBeDefined();
		expect(registry.get("software.milestone_postmortem")).toBeDefined();
		expect(registry.get("software.split_goal_results")).toBeDefined();
		expect(registry.get("software.split_wave_results")).toBeDefined();
		expect(registry.get("software.handle_goal_review_failures")).toBeDefined();
		expect(registry.get("software.handle_wave_review_failures")).toBeDefined();
		expect(registry.get("software.check_merge_candidates")).toBeDefined();
		expect(registry.get("software.check_wave_merge_candidates")).toBeDefined();
		expect(registry.get("software.build_goal_merge_results")).toBeDefined();
		expect(registry.get("software.build_wave_merge_results")).toBeDefined();
		expect(registry.get("software.classify_wave_demo_strategy")).toBeDefined();
		expect(registry.get("software.generate_wave_terminal_demo")).toBeDefined();
		expect(registry.get("software.publish_wave_demo_artifact")).toBeDefined();
		expect(registry.get("software.handle_goal_merge_failures")).toBeDefined();
		expect(registry.get("software.handle_wave_merge_failures")).toBeDefined();
		expect(registry.get("software.close_merged_issues")).toBeDefined();
		expect(registry.get("software.close_wave_merged_issues")).toBeDefined();
		expect(registry.get("software.fallback_judge")).toBeDefined();
		expect(registry.get("software.fallback_wave_judge")).toBeDefined();
		expect(registry.get("software.reconcile_goal_final_state")).toBeDefined();
		expect(registry.get("software.resolve_goal_final_state")).toBeDefined();
		expect(registry.get("supervisor.state_snapshot")).toBeDefined();
		expect(registry.get("supervisor.open_bug_gate")).toBeDefined();
		expect(registry.get("supervisor.action_item_gate")).toBeDefined();
		expect(registry.get("supervisor.tick_idle_check")).toBeDefined();
		expect(registry.get("supervisor.health_check")).toBeDefined();
		expect(registry.get("supervisor.external_factory_lifecycle")).toBeDefined();
		expect(registry.get("triage.apply_rejected_upstream")).toBeDefined();
		expect(registry.get("supervisor.managed_load_context")).toBeDefined();
		expect(registry.get("supervisor.managed_control_state_gate")).toBeDefined();
		expect(registry.get("supervisor.upstream_bug_gate")).toBeDefined();
		expect(registry.get("supervisor.managed_action_item_gate")).toBeDefined();
		expect(registry.get("supervisor.managed_health_classifier")).toBeDefined();
		expect(registry.get("supervisor.managed_intake_selector")).toBeDefined();
		expect(registry.get("supervisor.managed_failure_classifier")).toBeDefined();
		expect(registry.get("supervisor.managed_persist_state")).toBeDefined();
		expect(registry.get("supervisor.managed_emit_run_summary")).toBeDefined();
		expect(registry.get("wave.sanitize_state")).toBeDefined();
		expect(registry.get("wave.find_ready")).toBeDefined();
		expect(registry.get("wave.check_control_plane_blocker")).toBeDefined();
		expect(registry.get("wave.lock_ready")).toBeDefined();
		expect(registry.get("wave.release_claim")).toBeDefined();
		expect(registry.get("wave.complete_ready")).toBeDefined();
		expect(registry.get("wave.block_ready")).toBeDefined();
		expect(registry.get("wave.requeue_after_judge_failure")).toBeDefined();
		expect(registry.get("wave.finalize_terminal_claim")).toBeDefined();
		expect(registry.get("wave.list_milestones_b64")).toBeDefined();
		expect(registry.get("wave.list_ready_issues_b64")).toBeDefined();
		expect(registry.get("wave.list_priorities_b64")).toBeDefined();
		expect(registry.get("wave.dispatch_select")).toBeDefined();
		expect(registry.get("wave.create_ready_markers")).toBeDefined();
		expect(registry.get("wave.open_judge_followup")).toBeDefined();
	});

	it("registerMergeActions registers the merge action slice explicitly", () => {
		const registry = new ActionRegistry();

		registerMergeActions(registry);

		expect(registry.get("merge.extract_item")).toBeDefined();
		expect(registry.get("merge.acquire_lock")).toBeDefined();
		expect(registry.get("merge.assert_main_branch")).toBeDefined();
		expect(registry.get("merge.assert_main_clean")).toBeDefined();
		expect(registry.get("merge.build_commit_message")).toBeDefined();
		expect(registry.get("merge.resolve_context")).toBeDefined();
		expect(registry.get("merge.setup_worktree")).toBeDefined();
		expect(registry.get("merge.rebase_on_main")).toBeDefined();
		expect(registry.get("merge.attempt_deterministic")).toBeDefined();
		expect(registry.get("merge.build_conflict_packet")).toBeDefined();
		expect(registry.get("merge.emit_resolution_failure")).toBeDefined();
		expect(registry.get("merge.finalize_commit")).toBeDefined();
		expect(registry.get("merge.push_main_branch")).toBeDefined();
		expect(registry.get("merge.verify_push_recovery")).toBeDefined();
		expect(registry.get("merge.release_lock")).toBeDefined();
		expect(registry.get("merge.verify_resolution")).toBeDefined();
		expect(registry.get("merge.run_integration")).toBeDefined();
		expect(registry.get("merge.cleanup_worktree")).toBeDefined();
		expect(registry.get("merge.build_report")).toBeDefined();
	});

	it("registerBrainstormActions registers the brainstorm action slice explicitly", () => {
		const registry = new ActionRegistry();

		registerBrainstormActions(registry);

		expect(registry.get("common.resolve_capability_brainstorming_skills_path")).toBeDefined();
		expect(registry.get("brainstorm.build_intake_context")).toBeDefined();
		expect(registry.get("brainstorm.load_context")).toBeDefined();
		expect(registry.get("brainstorm.check_output")).toBeDefined();
		expect(registry.get("brainstorm.loop_guard")).toBeDefined();
		expect(registry.get("brainstorm.post_turn_comment")).toBeDefined();
		expect(registry.get("brainstorm.bump_round")).toBeDefined();
		expect(registry.get("brainstorm.close_issue")).toBeDefined();
	});

	it("registerScenarioActions registers the scenario action slice explicitly", () => {
		const registry = new ActionRegistry();

		registerScenarioActions(registry);

		expect(registry.get("scenario.validate_scope")).toBeDefined();
		expect(registry.get("scenario.ensure_structure")).toBeDefined();
		expect(registry.get("scenario.validate_payload")).toBeDefined();
		expect(registry.get("scenario.save")).toBeDefined();
	});

	it("registerGoalExecuteActions registers the goal-execute action slice explicitly", () => {
		const registry = new ActionRegistry();

		registerGoalExecuteActions(registry);

		expect(registry.get("software.seed_goal_state")).toBeDefined();
		expect(registry.get("software.resolve_goal_execution_path")).toBeDefined();
		expect(registry.get("software.empty_goal_branch_context")).toBeDefined();
		expect(registry.get("software.build_goal_execution_plan")).toBeDefined();
		expect(registry.get("software.pick_goal_plan_issue")).toBeDefined();
		expect(registry.get("software.advance_plan_index")).toBeDefined();
		expect(registry.get("software.accumulate_goal_result")).toBeDefined();
		expect(registry.get("software.goal_postmortem")).toBeDefined();
		expect(registry.get("software.split_goal_results")).toBeDefined();
		expect(registry.get("software.handle_goal_review_failures")).toBeDefined();
		expect(registry.get("software.check_merge_candidates")).toBeDefined();
		expect(registry.get("software.build_goal_merge_results")).toBeDefined();
		expect(registry.get("software.handle_goal_merge_failures")).toBeDefined();
		expect(registry.get("software.close_merged_issues")).toBeDefined();
		expect(registry.get("software.fallback_judge")).toBeDefined();
		expect(registry.get("software.reconcile_goal_final_state")).toBeDefined();
		expect(registry.get("coding.cleanup_wave_issue_worktree")).toBeDefined();
	});

	it("registerWaveDispatchActions registers the wave-dispatch action slice explicitly", () => {
		const registry = new ActionRegistry();

		registerWaveDispatchActions(registry);

		expect(registry.get("factory.resolve_tracking_issue")).toBeDefined();
		expect(registry.get("factory.acquire_lease")).toBeDefined();
		expect(registry.get("factory.release_lease")).toBeDefined();
		expect(registry.get("labels.ensure_factory")).toBeDefined();
		expect(registry.get("wave.sanitize_state")).toBeDefined();
		expect(registry.get("wave.list_milestones_b64")).toBeDefined();
		expect(registry.get("wave.list_ready_issues_b64")).toBeDefined();
		expect(registry.get("wave.list_priorities_b64")).toBeDefined();
		expect(registry.get("wave.dispatch_select")).toBeDefined();
		expect(registry.get("wave.create_ready_markers")).toBeDefined();
	});

	it("registerWaveExecuteActions registers the wave-execute action slice explicitly", () => {
		const registry = new ActionRegistry();

		registerWaveExecuteActions(registry);

		expect(registry.get("software.resolve_wave_config")).toBeDefined();
		expect(registry.get("wave.find_ready")).toBeDefined();
		expect(registry.get("wave.check_control_plane_blocker")).toBeDefined();
		expect(registry.get("wave.lock_ready")).toBeDefined();
		expect(registry.get("wave.release_claim")).toBeDefined();
		expect(registry.get("software.seed_milestone_state")).toBeDefined();
		expect(registry.get("software.empty_milestone_branch_context")).toBeDefined();
		expect(registry.get("software.pick_next_milestone_issue")).toBeDefined();
		expect(registry.get("software.accumulate_milestone_result")).toBeDefined();
		expect(registry.get("software.milestone_postmortem")).toBeDefined();
		expect(registry.get("ceremony.classify_milestone")).toBeDefined();
		expect(registry.get("ceremony.build_milestone_batch")).toBeDefined();
		expect(registry.get("software.accumulate_milestone_batch")).toBeDefined();
		expect(registry.get("software.build_milestone_parallel_context")).toBeDefined();
		expect(registry.get("software.split_wave_results")).toBeDefined();
		expect(registry.get("software.handle_wave_review_failures")).toBeDefined();
		expect(registry.get("software.check_wave_merge_candidates")).toBeDefined();
		expect(registry.get("software.close_wave_merged_issues")).toBeDefined();
		expect(registry.get("software.build_wave_merge_results")).toBeDefined();
		expect(registry.get("software.classify_wave_demo_strategy")).toBeDefined();
		expect(registry.get("software.generate_wave_terminal_demo")).toBeDefined();
		expect(registry.get("software.publish_wave_demo_artifact")).toBeDefined();
		expect(registry.get("software.handle_wave_merge_failures")).toBeDefined();
		expect(registry.get("software.fallback_wave_judge")).toBeDefined();
		expect(registry.get("wave.complete_ready")).toBeDefined();
		expect(registry.get("wave.block_ready")).toBeDefined();
		expect(registry.get("wave.requeue_after_judge_failure")).toBeDefined();
		expect(registry.get("wave.finalize_terminal_claim")).toBeDefined();
		expect(registry.get("software.resolve_goal_final_state")).toBeDefined();
		expect(registry.get("wave.open_judge_followup")).toBeDefined();
	});

	it("registerGoalIssueActions registers the goal-issue action slice explicitly", () => {
		const registry = new ActionRegistry();

		registerGoalIssueActions(registry);

		expect(registry.get("common.load_agent_guidance_context")).toBeDefined();
		expect(registry.get("merge.assert_main_branch")).toBeDefined();
		expect(registry.get("coding.set_issue_context")).toBeDefined();
		expect(registry.get("coding.fetch_issue_body")).toBeDefined();
		expect(registry.get("coding.estimate_issue_complexity")).toBeDefined();
		expect(registry.get("coding.cleanup_legacy_worktree")).toBeDefined();
		expect(registry.get("coding.ensure_worktree_toolchain")).toBeDefined();
		expect(registry.get("coding.inspect_existing_commits")).toBeDefined();
		expect(registry.get("coding.decide_existing_reuse_with_notes")).toBeDefined();
		expect(registry.get("coding.reset_stale_branch")).toBeDefined();
		expect(registry.get("coding.resolve_execution_mode")).toBeDefined();
		expect(registry.get("coding.build_impl_result")).toBeDefined();
		expect(registry.get("coding.resolve_max_review_attempts")).toBeDefined();
		expect(registry.get("coding.verify_visual_refinement_evidence")).toBeDefined();
		expect(registry.get("coding.emit_review_verdict_telemetry")).toBeDefined();
		expect(registry.get("coding.should_retry_review")).toBeDefined();
		expect(registry.get("coding.send_review_message")).toBeDefined();
		expect(registry.get("coding.build_failed_result")).toBeDefined();
		expect(registry.get("coding.build_approved_result")).toBeDefined();
		expect(registry.get("coding.build_infra_failure_result")).toBeDefined();
	});

	it("merges process env, shared env, then node env without mutating process.env", async () => {
		const processOnlyKey = "TOOL_TEST_PROCESS_ONLY";
		const overrideKey = "TOOL_TEST_OVERRIDE";
		const originalProcessOnly = process.env[processOnlyKey];
		const originalOverride = process.env[overrideKey];

		process.env[processOnlyKey] = "process-only";
		process.env[overrideKey] = "process-value";

		let capturedOptions: any;
		mockSpawnSuccess(({ options }) => {
			capturedOptions = options;
		});

		try {
			const handler = new ToolHandler(".", undefined, {
				FACTORY_REPO: "/repo-root",
				FACTORY_CONFIG_PATH: "/repo-root/factory.config.json",
				HATCH_PIPELINE_FILE: "/repo-root/factory.dot",
				[overrideKey]: "shared-value",
				SHARED_ONLY: "shared-only",
			});
			const node: Node = {
				id: "tool_env",
				attrs: {
					prompt: "echo ok",
					env: JSON.stringify({
						[overrideKey]: "node-value",
						NODE_ONLY: "node-only",
						FACTORY_REPO: "/node-repo",
					}),
				},
			};

			await handler.execute(new AbortController().signal, node, new Context(), "");

			expect(capturedOptions.env[processOnlyKey]).toBe("process-only");
			expect(capturedOptions.env.SHARED_ONLY).toBe("shared-only");
			expect(capturedOptions.env.NODE_ONLY).toBe("node-only");
			expect(capturedOptions.env[overrideKey]).toBe("node-value");
			expect(capturedOptions.env.FACTORY_REPO).toBe("/node-repo");
			expect(process.env[overrideKey]).toBe("process-value");
		} finally {
			if (originalProcessOnly === undefined) delete process.env[processOnlyKey];
			else process.env[processOnlyKey] = originalProcessOnly;
			if (originalOverride === undefined) delete process.env[overrideKey];
			else process.env[overrideKey] = originalOverride;
		}
	});

	it("fails fast when node env is invalid JSON", async () => {
		const handler = new ToolHandler();
		const node: Node = {
			id: "bad_env",
			attrs: {
				prompt: "echo ok",
				env: "{not-json}",
			},
		};

		await expect(handler.execute(new AbortController().signal, node, new Context(), "")).rejects.toThrow(
			/tool handler: node "bad_env" has invalid env JSON/,
		);
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("fails fast when node env is not a JSON object", async () => {
		const handler = new ToolHandler();
		const node: Node = {
			id: "bad_env_type",
			attrs: {
				prompt: "echo ok",
				env: "[]",
			},
		};

		await expect(handler.execute(new AbortController().signal, node, new Context(), "")).rejects.toThrow(
			/tool handler: node "bad_env_type" env must be a JSON object/,
		);
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("keeps canonical hatch-ops commands unchanged", async () => {
		let capturedCommand = "";
		mockSpawnSuccess(({ argv }) => {
			capturedCommand = argv[1];
		});

		const handler = new ToolHandler();
		const node: Node = {
			id: "canonical_hatch_ops",
			attrs: {
				prompt: "hatch-ops wave split-results --fallback '{}'",
			},
		};

		await handler.execute(new AbortController().signal, node, new Context(), "");
		expect(capturedCommand).toContain("hatch-ops wave split-results --fallback '{}'");
	});

	it("routes tool context placeholders through HATCH_VAR env vars", async () => {
		let capturedCommand = "";
		let capturedEnv: Record<string, string> = {};
		mockSpawnSuccess(({ argv, options }) => {
			capturedCommand = argv[1];
			capturedEnv = options.env;
		});

		const ctx = new Context({
			tool_eval_notes: "bad' ; $(echo pwned)\nnext-line",
			id: "42",
		});
		const handler = new ToolHandler();
		const node: Node = {
			id: "safe_substitution",
			attrs: {
				prompt: "hatch-ops wave split-results --notes '${tool_eval_notes}' --id ${id}",
			},
		};

		await handler.execute(new AbortController().signal, node, ctx, "");

		expect(capturedCommand).toBe('hatch-ops wave split-results --notes "${HATCH_VAR_TOOL_EVAL_NOTES}" --id "${HATCH_VAR_ID}"');
		expect(capturedCommand).not.toContain("bad' ;");
		expect(capturedEnv.HATCH_VAR_TOOL_EVAL_NOTES).toBe("bad' ; $(echo pwned)\nnext-line");
		expect(capturedEnv.HATCH_VAR_ID).toBe("42");
	});

	it("prepends repo-local CLI bins to PATH for tool commands", async () => {
		const repoRoot = mkdtempSync(join(tmpdir(), "hatch-tool-path-"));
		mkdirSync(join(repoRoot, ".git"));
		mkdirSync(join(repoRoot, "scripts", "bin"), { recursive: true });
		mkdirSync(join(repoRoot, "node_modules", ".bin"), { recursive: true });
		writeFileSync(join(repoRoot, "scripts", "bin", "hatch-ops"), "#!/bin/sh\n");

		let capturedEnv: Record<string, string> = {};
		mockSpawnSuccess(({ options }) => {
			capturedEnv = options.env;
		});

		const handler = new ToolHandler(".", undefined, {
			FACTORY_REPO: repoRoot,
			PATH: "/usr/bin:/bin",
		});
		const node: Node = {
			id: "canonical_hatch_ops_path",
			attrs: {
				prompt: "hatch-ops doctor relink-cli",
			},
		};

		await handler.execute(new AbortController().signal, node, new Context(), "");

		expect(capturedEnv.PATH).toBe(
			`${join(repoRoot, "scripts", "bin")}:${join(repoRoot, "node_modules", ".bin")}:/usr/bin:/bin`,
		);
	});

	it("breaks out of single quotes for env var expansion when ${key} is inside a single-quoted string", async () => {
		let capturedCommand = "";
		let capturedEnv: Record<string, string> = {};
		mockSpawnSuccess(({ argv, options }) => {
			capturedCommand = argv[1];
			capturedEnv = options.env;
		});

		const ctx = new Context({ __run_id: "abc123" });
		const handler = new ToolHandler();
		const node: Node = {
			id: "single_quote_expansion",
			attrs: {
				prompt: "hatch-ops factory publish-control-plane-manifest --manifest-path '.hatch/runs/${__run_id}/artifacts/release-manifest.json'",
			},
		};

		await handler.execute(new AbortController().signal, node, ctx, "");

		expect(capturedCommand).toBe(
			`hatch-ops factory publish-control-plane-manifest --manifest-path '.hatch/runs/'"\${HATCH_VAR_RUN_ID}"'/artifacts/release-manifest.json'`,
		);
		expect(capturedEnv.HATCH_VAR_RUN_ID).toBe("abc123");
	});

	it("breaks out of single quotes for directly-quoted env var tokens inside single-quoted JSON strings", async () => {
		let capturedCommand = "";
		let capturedEnv: Record<string, string> = {};
		mockSpawnSuccess(({ argv, options }) => {
			capturedCommand = argv[1];
			capturedEnv = options.env;
		});

		const ctx = new Context({ has_issue: "true", selected_issue_number: "2294" });
		const handler = new ToolHandler();
		const node: Node = {
			id: "double_in_single_quote_expansion",
			attrs: {
				prompt: `hatch-ops common resolve-default --value '{"has_issue":"\${has_issue}","selected_issue_number":"\${selected_issue_number}"}' --fallback '{}'`,
			},
		};

		await handler.execute(new AbortController().signal, node, ctx, "");

		// The "key" tokens are inside JSON double quotes which are themselves
		// inside a single-quoted shell string.  The handler must break out of
		// the single-quote context so the shell can expand the env vars while
		// preserving the consumed JSON double quotes as literal chars inside SQ.
		expect(capturedEnv.HATCH_VAR_HAS_ISSUE).toBe("true");
		expect(capturedEnv.HATCH_VAR_SELECTED_ISSUE_NUMBER).toBe("2294");
		// The expected shell idiom for "has_issue":"${has_issue}" inside SQ is:
		//   "has_issue":"  '  "${HATCH_VAR_HAS_ISSUE}"  '  "
		//   ^^^^^^^^^^^^  ^  ^^^^^^^^^^^^^^^^^^^^^^^   ^  ^
		//   SQ literal   end   DQ env ref            begin SQ literal (JSON closing ")
		expect(capturedCommand).toBe(
			`hatch-ops common resolve-default --value '{"has_issue":"'"\${HATCH_VAR_HAS_ISSUE}"'","selected_issue_number":"'"\${HATCH_VAR_SELECTED_ISSUE_NUMBER}"'"}' --fallback '{}'`,
		);
	});

	it("generates stable env names for dotted context keys", async () => {
		let capturedCommand = "";
		let capturedEnv: Record<string, string> = {};
		mockSpawnSuccess(({ argv, options }) => {
			capturedCommand = argv[1];
			capturedEnv = options.env;
		});

		const ctx = new Context({
			payload: JSON.stringify({ notes: "structured note" }),
		});
		const handler = new ToolHandler();
		const node: Node = {
			id: "dotted_substitution",
			attrs: {
				prompt: "echo ${payload.notes}",
			},
		};

		await handler.execute(new AbortController().signal, node, ctx, "");

		expect(capturedCommand).toBe('echo "${HATCH_VAR_PAYLOAD_NOTES}"');
		expect(capturedEnv.HATCH_VAR_PAYLOAD_NOTES).toBe("structured note");
	});

	it("emits progress ticks for spawn/stdout/stderr/close milestones", async () => {
		const child = createMockChildProcess();
		spawnMock.mockImplementation(() => {
			queueMicrotask(() => {
				child.stdout.emit("data", "chunk-out");
				child.stderr.emit("data", "chunk-err");
				child.emit("close", 0, null);
			});
			return child;
		});

		const reportProgress = vi.fn();
		const handler = new ToolHandler();
		const outcome = await handler.execute(
			new AbortController().signal,
			{ id: "tool_progress", attrs: { prompt: "echo ok" } } as Node,
			new Context(),
			"",
			{ reportProgress },
		);

		expect(outcome.status).toBe(StageStatus.Completed);
		expect(outcome.output).toContain("chunk-out");
		expect(reportProgress.mock.calls.length).toBeGreaterThanOrEqual(4);
	});

	it("kills spawned process when aborted", async () => {
		const child = createMockChildProcess();
		spawnMock.mockImplementation(() => child);

		const handler = new ToolHandler();
		const ac = new AbortController();
		const promise = handler.execute(
			ac.signal,
			{ id: "tool_abort", attrs: { prompt: "sleep 10" } } as Node,
			new Context(),
			"",
			{ reportProgress: vi.fn() },
		);

		ac.abort();
		const outcome = await promise;

		expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		expect(outcome.status).toBe(StageStatus.Failed);
		expect(outcome.error).toContain("signal SIGTERM");
	});

	it("executes registered in-process actions without shelling out", async () => {
		const actionRegistry = new ActionRegistry();
		actionRegistry.register("context.capture", {
			async execute({ input }) {
				return {
					status: StageStatus.Completed,
					output: input,
					contextUpdates: { captured_value: input },
				};
			},
		});

		const handler = new ToolHandler(".", undefined, {}, actionRegistry);
		const node: Node = {
			id: "in_process_action",
			attrs: {
				type: "tool",
				action_runtime: "in_process",
				action_id: "context.capture",
			},
		};

		const outcome = await handler.execute(new AbortController().signal, node, new Context(), "typed-value");
		expect(outcome).toMatchObject({
			status: StageStatus.Completed,
			output: "typed-value",
			contextUpdates: { captured_value: "typed-value" },
		});
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("executes default normalize issue urls action without shelling out", async () => {
		const handler = new ToolHandler(".", undefined, {}, createDefaultActionRegistry());
		const node: Node = {
			id: "normalize_issue_urls",
			attrs: {
				type: "tool",
				action_runtime: "in_process",
				action_id: "common.normalize_issue_urls",
				action_value: JSON.stringify([
					"https://github.com/recallnet/astrochicken/issues/10 ",
					"https://github.com/recallnet/astrochicken/issues/10",
					"",
				]),
			},
		};

		const outcome = await handler.execute(new AbortController().signal, node, new Context(), "");
		expect(outcome).toMatchObject({
			status: StageStatus.Completed,
			output: JSON.stringify(["https://github.com/recallnet/astrochicken/issues/10"]),
		});
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("executes default normalize decision action without shelling out", async () => {
		const handler = new ToolHandler(".", undefined, {}, createDefaultActionRegistry());
		const node: Node = {
			id: "normalize_decision",
			attrs: {
				type: "tool",
				action_runtime: "in_process",
				action_id: "common.normalize_decision",
				action_value: "approved",
			},
		};

		const outcome = await handler.execute(new AbortController().signal, node, new Context(), "");
		expect(outcome).toMatchObject({
			status: StageStatus.Completed,
			output: "approved",
		});
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("executes default count json items action without shelling out", async () => {
		const handler = new ToolHandler(".", undefined, {}, createDefaultActionRegistry());
		const node: Node = {
			id: "count_json_items",
			attrs: {
				type: "tool",
				action_runtime: "in_process",
				action_id: "common.count_json_items",
				action_raw_b64: Buffer.from(JSON.stringify([{ number: 1 }, { number: 2 }]), "utf8").toString("base64"),
			},
		};

		const outcome = await handler.execute(new AbortController().signal, node, new Context(), "");
		expect(outcome).toMatchObject({
			status: StageStatus.Completed,
			output: "2",
		});
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("executes default goal filter action without shelling out", async () => {
		const handler = new ToolHandler(".", undefined, {}, createDefaultActionRegistry());
		const node: Node = {
			id: "goal_filter_kept",
			attrs: {
				type: "tool",
				action_runtime: "in_process",
				action_id: "goal.filter_kept_goals",
				action_issues_b64: Buffer.from(JSON.stringify([{ number: 1 }, { number: 2 }]), "utf8").toString("base64"),
				action_decisions_b64: Buffer.from(JSON.stringify([{ issue_number: 1, decision: "keep" }, { issue_number: 2, decision: "close" }]), "utf8").toString("base64"),
			},
		};

		const outcome = await handler.execute(new AbortController().signal, node, new Context(), "");
		expect(outcome).toMatchObject({
			status: StageStatus.Completed,
			output: JSON.stringify([1]),
		});
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("executes default goal intake validation without shelling out", async () => {
		const handler = new ToolHandler(".", undefined, {}, createDefaultActionRegistry());
		const node: Node = {
			id: "validate_goal_intake",
			attrs: {
				type: "tool",
				action_runtime: "in_process",
				action_id: "goal.validate_intake",
				action_goal_issue_json: '{"state":"OPEN","labels":[{"name":"goal"}]}',
			},
		};

		const outcome = await handler.execute(new AbortController().signal, node, new Context(), "");
		expect(outcome).toMatchObject({
			status: StageStatus.Completed,
			output: "eligible",
		});
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("executes default approved-feature validation without shelling out", async () => {
		const handler = new ToolHandler(".", undefined, {}, createDefaultActionRegistry());
		const node: Node = {
			id: "validate_approved_features",
			attrs: {
				type: "tool",
				action_runtime: "in_process",
				action_id: "goal.validate_approved_features",
				action_approved: "true",
				action_approved_features: '[{"name":"A","acceptance_criteria":["x"]}]',
			},
		};

		const outcome = await handler.execute(new AbortController().signal, node, new Context(), "");
		expect(outcome).toMatchObject({
			status: StageStatus.Completed,
			output: "true",
		});
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("fails when an in-process action is not registered", async () => {
		const handler = new ToolHandler(".", undefined, {}, new ActionRegistry());
		const node: Node = {
			id: "missing_action",
			attrs: {
				type: "tool",
				action_runtime: "in_process",
				action_id: "context.capture",
			},
		};

		await expect(handler.execute(new AbortController().signal, node, new Context(), "typed-value")).rejects.toThrow(
			/unregistered in-process action_id "context.capture"/,
		);
		expect(spawnMock).not.toHaveBeenCalled();
	});
});
