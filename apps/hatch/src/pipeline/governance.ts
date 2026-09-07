export const TOOL_IDENTIFIERS_V1 = ["shell", "python", "http"] as const;
export type ToolIdentifierV1 = (typeof TOOL_IDENTIFIERS_V1)[number];

export const ACTION_IDENTIFIERS_V1 = [
	"context.capture",
	"common.encode_base64",
	"common.count_json_items",
	"common.count_feature_objects",
	"common.resolve_default",
	"common.resolve_boolean",
	"common.resolve_gh_repo",
	"common.load_agent_guidance_context",
	"common.resolve_capability_coding_skills_path",
	"common.resolve_capability_brainstorming_skills_path",
	"common.resolve_capability_merge_skills_path",
	"common.resolve_capability_goal_decomposition_skills_path",
	"common.resolve_intent_stack",
	"common.resolve_factory_config",
	"brainstorm.build_intake_context",
	"brainstorm.load_context",
	"brainstorm.check_output",
	"brainstorm.loop_guard",
	"brainstorm.post_turn_comment",
	"brainstorm.bump_round",
	"brainstorm.close_issue",
	"scenario.validate_scope",
	"scenario.ensure_structure",
	"scenario.validate_payload",
	"scenario.save",
	"common.normalize_approved",
	"common.increment_counter",
	"common.build_retry_signal",
	"common.inspect_json",
	"common.inspect_json_pair",
	"common.fallback_issue_spec_bundle",
	"common.normalize_feature_issue_spec_bundle",
	"common.validate_issue_spec_draft",
	"common.create_issue",
	"common.update_issue",
	"common.normalize_decision",
	"common.normalize_issue_urls",
	"file.write",
	"file.delete",
	"git.commit",
	"issue.create",
	"labels.normalize_issue_state",
	"labels.ensure_factory",
	"governance.sanitize_overlap",
	"ceremony.goal_review_skip",
	"ceremony.decompose_auto_approve",
	"ceremony.classify_milestone",
	"ceremony.build_milestone_batch",
	"goal.validate_intake",
	"goal.parse_external_bug_report",
	"goal.persist_hard_plan_artifact",
	"goal.validate_planning_artifact",
	"goal.attach_planning_artifacts",
	"goal.mark_planned",
	"goal.auto_ready_artifacts",
	"goal.sanitize_duplicates",
	"goal.list_ready",
	"goal.validate_approved_features",
	"goal.emit_fallback_defect",
	"goal.fallback_feature_pair",
	"goal.normalize_approved_features",
	"goal.validate_decisions",
	"goal.apply_decisions",
	"goal.filter_kept_goals",
	"goal.decompose_backpressure",
	"goal.limit_kept",
	"goal.sweep_completed",
	"goal.ensure_execution_paths",
	"goal.add_sub_issue",
	"goal.fetch_goal_issue",
	"goal.inspect_hard_state",
	"goal.inspect_run_admission",
	"goal.materialize_approved_plan",
	"goal.post_retry_comment",
	"goal.count_decompose_attempts",
	"goal.exhaust_decompose_retries",
	"goal.post_decompose_attempt",
	"goal.append_rationale_feature",
	"goal.persist_decomposition_packet",
	"goal.label_created_issues",
	"goal.apply_feature_blockers",
	"goal.compute_close_condition",
	"goal.mark_dispatched",
	"goal.build_admission_failure",
	"goal.check_already_decomposed",
	"goal.guard_duplicate_decompose",
	"triage.normalize_issue_urls",
	"triage.zip_features_to_issues",
	"triage.resolve_feature_dependencies",
	"judge.build_evidence_contract",
	"judge.build_context_contract",
	"judge.validate_context_contract",
	"judge.validate_evidence_contract",
	"judge.build_recovery_packet",
	"release.build_report_context",
	"release.publish_report",
	"release.emit_narrative_document",
	"release.shaping_followup",
	"release.build_slack_blocks",
	"release.post_to_slack",
	"release.update_dedup_cursor",
	"daily_lens.prepare",
	"daily_lens.finalize",
	"daily_lens.generate_followup_candidates",
	"milestone.sweep_empty",
	"wave.release_quarantine",
	"artifact.release_manifest",
	"artifact.emit_disposition_feedback",
	"factory.recovery_sweep",
	"factory.publish_control_plane_manifest",
	"factory.stamp_contract_hash",
	"factory.review_metrics",
	"supervisor.state_snapshot",
	"supervisor.open_bug_gate",
	"supervisor.action_item_gate",
	"supervisor.tick_idle_check",
	"supervisor.health_check",
	"supervisor.external_factory_lifecycle",
	"triage.apply_rejected_upstream",
	"supervisor.managed_load_context",
	"supervisor.managed_control_state_gate",
	"supervisor.upstream_bug_gate",
	"supervisor.managed_action_item_gate",
	"supervisor.managed_health_classifier",
	"supervisor.managed_intake_selector",
	"supervisor.managed_failure_classifier",
	"supervisor.managed_persist_state",
	"supervisor.managed_emit_run_summary",
	"supervisor.tick_idle_cursor_update",
	"supervisor.close_stale_merge_followups",
	"artifact.ingest",
	"factory.resolve_tracking_issue",
	"factory.acquire_lease",
	"factory.release_lease",
	"merge.extract_item",
	"merge.acquire_lock",
	"merge.assert_main_branch",
	"merge.assert_main_clean",
	"merge.build_commit_message",
	"merge.resolve_context",
	"merge.setup_worktree",
	"merge.rebase_on_main",
	"merge.attempt_deterministic",
	"merge.build_conflict_packet",
	"merge.emit_resolution_failure",
	"merge.finalize_commit",
	"merge.push_main_branch",
	"merge.release_lock",
	"merge.verify_push_recovery",
	"merge.verify_resolution",
	"merge.run_integration",
	"merge.cleanup_worktree",
	"merge.build_report",
	"coding.extract_issue_item",
	"coding.resolve_goal_number_from_milestone",
	"coding.init_wave_issue_worktree",
	"coding.setup_wave_issue_worktree",
	"coding.set_issue_context",
	"coding.fetch_issue_body",
	"coding.estimate_issue_complexity",
	"coding.cleanup_legacy_worktree",
	"coding.ensure_worktree_toolchain",
	"coding.inspect_existing_commits",
	"coding.decide_existing_reuse_with_notes",
	"coding.reset_stale_branch",
	"coding.resolve_execution_mode",
	"coding.build_impl_result",
	"coding.resolve_max_review_attempts",
	"coding.init_review_attempt",
	"coding.next_review_attempt",
	"coding.snapshot_branch_head",
	"coding.commit_local",
	"coding.inspect_branch_changes",
	"coding.write_review_evidence",
	"coding.build_review_context",
	"coding.validate_review_context",
	"coding.verify_visual_refinement_evidence",
	"coding.emit_review_verdict_telemetry",
	"coding.should_retry_review",
	"coding.send_review_message",
	"coding.build_failed_result",
	"coding.build_approved_result",
	"coding.build_infra_failure_result",
	"coding.cleanup_wave_issue_worktree",
	"coding.resolve_review_route",
	"software.resolve_execution_config",
	"software.resolve_wave_config",
	"software.list_executable_goals",
	"software.seed_goal_state",
	"software.seed_milestone_state",
	"software.resolve_goal_execution_path",
	"software.empty_goal_branch_context",
	"software.empty_milestone_branch_context",
	"software.build_goal_execution_plan",
	"software.pick_goal_plan_issue",
	"software.pick_next_milestone_issue",
	"software.advance_plan_index",
	"software.accumulate_goal_result",
	"software.accumulate_milestone_result",
	"software.accumulate_milestone_batch",
	"software.build_milestone_parallel_context",
	"software.goal_postmortem",
	"software.milestone_postmortem",
	"software.split_goal_results",
	"software.split_wave_results",
	"software.handle_goal_review_failures",
	"software.handle_wave_review_failures",
	"software.check_merge_candidates",
	"software.check_wave_merge_candidates",
	"software.build_goal_merge_results",
	"software.build_wave_merge_results",
	"software.classify_wave_demo_strategy",
	"software.generate_wave_terminal_demo",
	"software.publish_wave_demo_artifact",
	"software.handle_goal_merge_failures",
	"software.handle_wave_merge_failures",
	"software.close_merged_issues",
	"software.close_wave_merged_issues",
	"software.fallback_judge",
	"software.fallback_wave_judge",
	"software.reconcile_goal_final_state",
	"software.resolve_goal_final_state",
	"wave.sanitize_state",
	"wave.find_ready",
	"wave.check_control_plane_blocker",
	"wave.lock_ready",
	"wave.release_claim",
	"wave.complete_ready",
	"wave.block_ready",
	"wave.requeue_after_judge_failure",
	"wave.finalize_terminal_claim",
	"wave.list_milestones_b64",
	"wave.list_ready_issues_b64",
	"wave.list_priorities_b64",
	"wave.dispatch_select",
	"wave.create_ready_markers",
	"wave.open_judge_followup",
] as const;
export type ActionIdentifierV1 = (typeof ACTION_IDENTIFIERS_V1)[number];

export const GOVERNANCE_KINDS_V1 = ["reversible", "irreversible"] as const;
export type GovernanceKindV1 = (typeof GOVERNANCE_KINDS_V1)[number];

export const GOVERNANCE_DECISIONS_V1 = ["allow", "review", "deny"] as const;
export type GovernanceDecisionV1 = (typeof GOVERNANCE_DECISIONS_V1)[number];

/**
 * Stable v1 agent identity taxonomy for trust/policy contracts.
 *
 * These values intentionally do not affect runtime dispatch. They are metadata
 * consumed by governance/trust systems and resolved via graph accessors.
 */
export const AGENT_IDS_V1 = [
	"unknown",
	"tool.shell",
	"tool.python",
	"tool.http",
	"tool.generic",
	"stack.manager_loop",
	"agent.worktree",
	"agent.kw",
] as const;
export type AgentIdV1 = (typeof AGENT_IDS_V1)[number];

export const AGENT_ROLES_V1 = [
	"unknown",
	"tool.operator",
	"manager.supervisor",
	"worktree.implementer",
	"knowledge.researcher",
] as const;
export type AgentRoleV1 = (typeof AGENT_ROLES_V1)[number];

export interface AgentIdentityV1 {
	agentId: AgentIdV1;
	agentRole: AgentRoleV1;
}

/**
 * Deterministic default for unresolved identity values.
 *
 * Resolver order (implemented in graph.ts):
 * 1) explicit valid attrs (agent_id / agent_role)
 * 2) trust-participant fallback mapping
 * 3) DEFAULT_AGENT_IDENTITY_FALLBACK_V1
 */
export const DEFAULT_AGENT_IDENTITY_FALLBACK_V1: AgentIdentityV1 = {
	agentId: "unknown",
	agentRole: "unknown",
};

export const TRUST_PARTICIPATING_HANDLER_TYPES = ["tool", "stack.manager_loop", "agent.worktree", "agent.kw"] as const;

const TOOL_IDENTIFIERS_V1_SET = new Set<string>(TOOL_IDENTIFIERS_V1);
const ACTION_IDENTIFIERS_V1_SET = new Set<string>(ACTION_IDENTIFIERS_V1);
const GOVERNANCE_KINDS_V1_SET = new Set<string>(GOVERNANCE_KINDS_V1);
const GOVERNANCE_DECISIONS_V1_SET = new Set<string>(GOVERNANCE_DECISIONS_V1);
const AGENT_IDS_V1_SET = new Set<string>(AGENT_IDS_V1);
const AGENT_ROLES_V1_SET = new Set<string>(AGENT_ROLES_V1);
const TRUST_PARTICIPATING_HANDLER_TYPES_SET = new Set<string>(TRUST_PARTICIPATING_HANDLER_TYPES);

export function isToolIdentifierV1(value: string): value is ToolIdentifierV1 {
	return TOOL_IDENTIFIERS_V1_SET.has(value);
}

export function isActionIdentifierV1(value: string): value is ActionIdentifierV1 {
	return ACTION_IDENTIFIERS_V1_SET.has(value);
}

export function isGovernanceKindV1(value: string): value is GovernanceKindV1 {
	return GOVERNANCE_KINDS_V1_SET.has(value);
}

export function isGovernanceDecisionV1(value: string): value is GovernanceDecisionV1 {
	return GOVERNANCE_DECISIONS_V1_SET.has(value);
}

export function isAgentIdV1(value: string): value is AgentIdV1 {
	return AGENT_IDS_V1_SET.has(value);
}

export function isAgentRoleV1(value: string): value is AgentRoleV1 {
	return AGENT_ROLES_V1_SET.has(value);
}

export function isTrustParticipatingHandlerType(value: string): value is (typeof TRUST_PARTICIPATING_HANDLER_TYPES)[number] {
	return TRUST_PARTICIPATING_HANDLER_TYPES_SET.has(value);
}
