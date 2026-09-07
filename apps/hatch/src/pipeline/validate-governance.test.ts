import { describe, expect, it } from "vitest";

import { IDENTITY_RULE_CODES } from "./identity.js";
import { parse } from "./parse.js";
import { validate, formatValidationError } from "./validate.js";

describe("identity/governance validation", () => {
	it("defaults to legacy mode", () => {
		const graph = parse(`
	digraph legacy_default {
		start [shape=Mdiamond]
		runner [type="tool" governance="reversible"]
		done [shape=Msquare]

		start -> runner -> done
	}
		`);

		const errors = validate(graph);

		expect(errors).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: IDENTITY_RULE_CODES.TOOL_ID_REQUIRED }),
				expect.objectContaining({ code: IDENTITY_RULE_CODES.ACTION_ID_REQUIRED }),
			]),
		);
	});

	it("enforces stricter tool/action identity requirements in strict mode", () => {
		const graph = parse(`
	digraph strict_identity {
		start [shape=Mdiamond]
		runner [type="tool" governance="reversible"]
		done [shape=Msquare]

		start -> runner -> done
	}
		`);

		const legacyErrors = validate(graph, { identityMode: "legacy" });
		const strictErrors = validate(graph, { identityMode: "strict" });

		expect(legacyErrors).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ nodeId: "runner", code: IDENTITY_RULE_CODES.TOOL_ID_REQUIRED }),
				expect.objectContaining({ nodeId: "runner", code: IDENTITY_RULE_CODES.ACTION_ID_REQUIRED }),
			]),
		);

		expect(strictErrors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ rule: "tool_ids", nodeId: "runner", code: IDENTITY_RULE_CODES.TOOL_ID_REQUIRED }),
				expect.objectContaining({ rule: "action_ids", nodeId: "runner", code: IDENTITY_RULE_CODES.ACTION_ID_REQUIRED }),
			]),
		);
	});

	it("flags invalid identity attributes for trust participants and emits stable codes", () => {
		const graph = parse(`
	digraph invalid_identity {
		start [shape=Mdiamond]
		bad [type="tool" tool_id="bash" action_id="issue.close" governance="maybe" governance_decision="maybe"]
		non_trust [label="noop" tool_id="bash" action_id="issue.close" governance="maybe" governance_decision="maybe"]
		done [shape=Msquare]

		start -> bad -> done
		start -> non_trust -> done
	}
		`);

		const errors = validate(graph, { identityMode: "legacy" });

		expect(errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ rule: "tool_ids", nodeId: "bad", code: IDENTITY_RULE_CODES.TOOL_ID_INVALID }),
				expect.objectContaining({ rule: "action_ids", nodeId: "bad", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ rule: "governance_kind", nodeId: "bad", code: IDENTITY_RULE_CODES.GOVERNANCE_KIND_INVALID }),
				expect.objectContaining({
					rule: "governance_decision",
					nodeId: "bad",
					code: IDENTITY_RULE_CODES.GOVERNANCE_DECISION_INVALID,
				}),
			]),
		);

		expect(errors).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ nodeId: "non_trust", rule: "tool_ids" }),
				expect.objectContaining({ nodeId: "non_trust", rule: "action_ids" }),
				expect.objectContaining({ nodeId: "non_trust", rule: "governance_kind" }),
			]),
		);
	});

	it("accepts common.normalize_issue_urls as a valid in-process action identifier", () => {
		const graph = parse(`
	digraph valid_action_id {
		start [shape=Mdiamond]
		runner [type="tool" action_runtime="in_process" action_id="common.normalize_issue_urls" governance="reversible" tool_id="shell"]
		done [shape=Msquare]

		start -> runner -> done
	}
		`);

		const errors = validate(graph, { identityMode: "legacy" });
		expect(errors).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ nodeId: "runner", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
			]),
		);
	});

	it("accepts goal decomposition action identifiers for opted-in issue materialization graphs", () => {
		const graph = parse(`
	digraph valid_goal_decomposition_actions {
		start [shape=Mdiamond]
		resolve [type="tool" action_runtime="in_process" action_id="common.resolve_intent_stack" governance="reversible" tool_id="shell"]
		validate [type="tool" action_runtime="in_process" action_id="common.validate_issue_spec_draft" governance="reversible" tool_id="shell"]
		create [type="tool" action_runtime="in_process" action_id="common.create_issue" governance="irreversible" tool_id="shell"]
		link [type="tool" action_runtime="in_process" action_id="goal.add_sub_issue" governance="irreversible" tool_id="shell"]
		done [shape=Msquare]

		start -> resolve -> validate -> create -> link -> done
	}
		`);

		const errors = validate(graph, { identityMode: "legacy" });
		expect(errors).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ nodeId: "resolve", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "validate", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "create", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "link", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
			]),
		);
	});

	it("accepts merge action identifiers for opted-in merge graphs", () => {
		const graph = parse(`
	digraph valid_merge_actions {
		start [shape=Mdiamond]
		extract [type="tool" action_runtime="in_process" action_id="merge.extract_item" governance="reversible" tool_id="shell"]
		setup [type="tool" action_runtime="in_process" action_id="merge.setup_worktree" governance="irreversible" tool_id="shell"]
		rebase [type="tool" action_runtime="in_process" action_id="merge.rebase_on_main" governance="irreversible" tool_id="shell"]
		attempt [type="tool" action_runtime="in_process" action_id="merge.attempt_deterministic" governance="irreversible" tool_id="shell"]
		packet [type="tool" action_runtime="in_process" action_id="merge.build_conflict_packet" governance="irreversible" tool_id="shell"]
		finalize [type="tool" action_runtime="in_process" action_id="merge.finalize_commit" governance="irreversible" tool_id="shell"]
		verify [type="tool" action_runtime="in_process" action_id="merge.verify_resolution" governance="reversible" tool_id="shell"]
		integration [type="tool" action_runtime="in_process" action_id="merge.run_integration" governance="irreversible" tool_id="shell"]
		cleanup [type="tool" action_runtime="in_process" action_id="merge.cleanup_worktree" governance="irreversible" tool_id="shell"]
		report [type="tool" action_runtime="in_process" action_id="merge.build_report" governance="irreversible" tool_id="shell"]
		done [shape=Msquare]

		start -> extract -> setup -> rebase -> attempt -> packet -> finalize -> verify -> integration -> cleanup -> report -> done
	}
		`);

		const errors = validate(graph, { identityMode: "legacy" });
		expect(errors).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ nodeId: "extract", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "setup", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "rebase", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "attempt", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "packet", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "finalize", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "verify", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "integration", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "cleanup", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "report", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
			]),
		);
	});

	it("accepts wave dispatch and factory lease action identifiers for opted-in wave dispatch graphs", () => {
		const graph = parse(`
	digraph valid_wave_dispatch_actions {
		start [shape=Mdiamond]
		repo [type="tool" action_runtime="in_process" action_id="common.resolve_gh_repo" governance="reversible" tool_id="shell"]
		factory [type="tool" action_runtime="in_process" action_id="common.resolve_default" governance="reversible" tool_id="shell"]
		tracking [type="tool" action_runtime="in_process" action_id="factory.resolve_tracking_issue" governance="reversible" tool_id="shell"]
		acquire [type="tool" action_runtime="in_process" action_id="factory.acquire_lease" governance="reversible" tool_id="shell"]
		labels [type="tool" action_runtime="in_process" action_id="labels.ensure_factory" governance="irreversible" tool_id="shell"]
		sanitize [type="tool" action_runtime="in_process" action_id="wave.sanitize_state" governance="irreversible" tool_id="shell"]
		milestones [type="tool" action_runtime="in_process" action_id="wave.list_milestones_b64" governance="reversible" tool_id="shell"]
		ready [type="tool" action_runtime="in_process" action_id="wave.list_ready_issues_b64" governance="reversible" tool_id="shell"]
		priorities [type="tool" action_runtime="in_process" action_id="wave.list_priorities_b64" governance="reversible" tool_id="shell"]
		decide [type="tool" action_runtime="in_process" action_id="wave.dispatch_select" governance="reversible" tool_id="shell"]
		create [type="tool" action_runtime="in_process" action_id="wave.create_ready_markers" governance="irreversible" tool_id="shell"]
		release [type="tool" action_runtime="in_process" action_id="factory.release_lease" governance="reversible" tool_id="shell"]
		done [shape=Msquare]

		start -> repo -> factory -> tracking -> acquire -> labels -> sanitize -> milestones -> ready -> priorities -> decide -> create -> release -> done
	}
		`);

		const errors = validate(graph, { identityMode: "legacy" });
		expect(errors).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ nodeId: "tracking", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "acquire", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "labels", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "sanitize", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "milestones", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "ready", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "priorities", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "decide", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "create", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "release", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
			]),
		);
	});

	it("accepts wave execute action identifiers for opted-in wave execution graphs", () => {
		const graph = parse(`
	digraph valid_wave_execute_actions {
		start [shape=Mdiamond]
		config [type="tool" action_runtime="in_process" action_id="software.resolve_wave_config" governance="reversible" tool_id="shell"]
		find [type="tool" action_runtime="in_process" action_id="wave.find_ready" governance="reversible" tool_id="shell"]
		blocker [type="tool" action_runtime="in_process" action_id="wave.check_control_plane_blocker" governance="reversible" tool_id="shell"]
		lock [type="tool" action_runtime="in_process" action_id="wave.lock_ready" governance="irreversible" tool_id="shell"]
		seed [type="tool" action_runtime="in_process" action_id="software.seed_milestone_state" governance="reversible" tool_id="shell"]
		branch [type="tool" action_runtime="in_process" action_id="software.empty_milestone_branch_context" governance="reversible" tool_id="shell"]
		next [type="tool" action_runtime="in_process" action_id="software.pick_next_milestone_issue" governance="reversible" tool_id="shell"]
		accumulate [type="tool" action_runtime="in_process" action_id="software.accumulate_milestone_result" governance="irreversible" tool_id="shell"]
		postmortem [type="tool" action_runtime="in_process" action_id="software.milestone_postmortem" governance="irreversible" tool_id="shell"]
		split [type="tool" action_runtime="in_process" action_id="software.split_wave_results" governance="reversible" tool_id="shell"]
		reviews [type="tool" action_runtime="in_process" action_id="software.handle_wave_review_failures" governance="irreversible" tool_id="shell"]
		candidates [type="tool" action_runtime="in_process" action_id="software.check_wave_merge_candidates" governance="reversible" tool_id="shell"]
		close [type="tool" action_runtime="in_process" action_id="software.close_wave_merged_issues" governance="irreversible" tool_id="shell"]
		results [type="tool" action_runtime="in_process" action_id="software.build_wave_merge_results" governance="irreversible" tool_id="shell"]
		demo [type="tool" action_runtime="in_process" action_id="software.classify_wave_demo_strategy" governance="reversible" tool_id="shell"]
		terminal [type="tool" action_runtime="in_process" action_id="software.generate_wave_terminal_demo" governance="reversible" tool_id="shell"]
		publish [type="tool" action_runtime="in_process" action_id="software.publish_wave_demo_artifact" governance="reversible" tool_id="shell"]
		failures [type="tool" action_runtime="in_process" action_id="software.handle_wave_merge_failures" governance="irreversible" tool_id="shell"]
		judge [type="tool" action_runtime="in_process" action_id="software.fallback_wave_judge" governance="irreversible" tool_id="shell"]
		complete [type="tool" action_runtime="in_process" action_id="wave.complete_ready" governance="irreversible" tool_id="shell"]
		block [type="tool" action_runtime="in_process" action_id="wave.block_ready" governance="irreversible" tool_id="shell"]
		requeue [type="tool" action_runtime="in_process" action_id="wave.requeue_after_judge_failure" governance="irreversible" tool_id="shell"]
		finalize [type="tool" action_runtime="in_process" action_id="wave.finalize_terminal_claim" governance="irreversible" tool_id="shell"]
		final_state [type="tool" action_runtime="in_process" action_id="software.resolve_goal_final_state" governance="irreversible" tool_id="shell"]
		followup [type="tool" action_runtime="in_process" action_id="wave.open_judge_followup" governance="irreversible" tool_id="shell"]
		done [shape=Msquare]

		start -> config -> find -> blocker -> lock -> seed -> branch -> next -> accumulate -> postmortem -> split -> reviews -> candidates -> close -> results -> demo -> terminal -> publish -> failures -> judge -> complete -> block -> requeue -> finalize -> final_state -> followup -> done
	}
		`);

		const errors = validate(graph, { identityMode: "legacy" });
		expect(errors).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
			]),
		);
	});

	it("accepts goal batch action identifiers for opted-in decomposition review graphs", () => {
		const graph = parse(`
	digraph valid_goal_batch_actions {
		start [shape=Mdiamond]
		count [type="tool" action_runtime="in_process" action_id="common.count_json_items" governance="reversible" tool_id="shell"]
		toggle [type="tool" action_runtime="in_process" action_id="common.resolve_boolean" governance="reversible" tool_id="shell"]
		ceremony [type="tool" action_runtime="in_process" action_id="ceremony.goal_review_skip" governance="reversible" tool_id="shell"]
		validate [type="tool" action_runtime="in_process" action_id="goal.validate_decisions" governance="reversible" tool_id="shell"]
		apply [type="tool" action_runtime="in_process" action_id="goal.apply_decisions" governance="irreversible" tool_id="shell"]
		filter [type="tool" action_runtime="in_process" action_id="goal.filter_kept_goals" governance="irreversible" tool_id="shell"]
		done [shape=Msquare]

		start -> count -> toggle -> ceremony -> validate -> apply -> filter -> done
	}
		`);

		const errors = validate(graph, { identityMode: "legacy" });
		expect(errors).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ nodeId: "count", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "toggle", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "ceremony", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "validate", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "apply", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "filter", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
			]),
		);
	});

	it("accepts goal queue action identifiers for opted-in decomposition queue graphs", () => {
		const graph = parse(`
	digraph valid_goal_queue_actions {
		start [shape=Mdiamond]
		labels [type="tool" action_runtime="in_process" action_id="labels.normalize_issue_state" governance="reversible" tool_id="shell"]
		governance [type="tool" action_runtime="in_process" action_id="governance.sanitize_overlap" governance="irreversible" tool_id="shell"]
		artifacts [type="tool" action_runtime="in_process" action_id="goal.auto_ready_artifacts" governance="irreversible" tool_id="shell"]
		dupes [type="tool" action_runtime="in_process" action_id="goal.sanitize_duplicates" governance="irreversible" tool_id="shell"]
		list [type="tool" action_runtime="in_process" action_id="goal.list_ready" governance="reversible" tool_id="shell"]
		done [shape=Msquare]

		start -> labels -> governance -> artifacts -> dupes -> list -> done
	}
		`);

		const errors = validate(graph, { identityMode: "legacy" });
		expect(errors).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ nodeId: "labels", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "governance", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "artifacts", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "dupes", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "list", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
			]),
		);
	});

	it("accepts goal intake decomposition action identifiers for opted-in intake graphs", () => {
		const graph = parse(`
	digraph valid_goal_intake_actions {
		start [shape=Mdiamond]
		intake [type="tool" action_runtime="in_process" action_id="goal.validate_intake" governance="reversible" tool_id="shell"]
		bug [type="tool" action_runtime="in_process" action_id="goal.parse_external_bug_report" governance="reversible" tool_id="shell"]
		intent [type="tool" action_runtime="in_process" action_id="common.resolve_intent_stack" governance="reversible" tool_id="shell"]
		count [type="tool" action_runtime="in_process" action_id="common.count_feature_objects" governance="reversible" tool_id="shell"]
		ceremony [type="tool" action_runtime="in_process" action_id="ceremony.decompose_auto_approve" governance="reversible" tool_id="shell"]
		normalize [type="tool" action_runtime="in_process" action_id="common.normalize_approved" governance="reversible" tool_id="shell"]
		validate [type="tool" action_runtime="in_process" action_id="goal.validate_approved_features" governance="reversible" tool_id="shell"]
		retry [type="tool" action_runtime="in_process" action_id="common.build_retry_signal" governance="reversible" tool_id="shell"]
		inspect [type="tool" action_runtime="in_process" action_id="common.inspect_json_pair" governance="irreversible" tool_id="shell"]
		emit [type="tool" action_runtime="in_process" action_id="goal.emit_fallback_defect" governance="irreversible" tool_id="shell"]
		fallback [type="tool" action_runtime="in_process" action_id="goal.fallback_feature_pair" governance="irreversible" tool_id="shell"]
		finalize [type="tool" action_runtime="in_process" action_id="goal.normalize_approved_features" governance="irreversible" tool_id="shell"]
		done [shape=Msquare]

		start -> intake -> bug -> intent -> count -> ceremony -> normalize -> validate -> retry -> inspect -> emit -> fallback -> finalize -> done
	}
		`);

		const errors = validate(graph, { identityMode: "legacy" });
		expect(errors).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ nodeId: "intake", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "bug", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "intent", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "count", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "ceremony", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "normalize", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "validate", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "retry", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "inspect", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "emit", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "fallback", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "finalize", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
			]),
		);
	});

	it("accepts goal hard-plan action identifiers for opted-in planning graphs", () => {
		const graph = parse(`
	digraph valid_goal_hard_plan_actions {
		start [shape=Mdiamond]
		encode [type="tool" action_runtime="in_process" action_id="common.encode_base64" governance="reversible" tool_id="shell"]
		persist [type="tool" action_runtime="in_process" action_id="goal.persist_hard_plan_artifact" governance="irreversible" tool_id="shell"]
		validate [type="tool" action_runtime="in_process" action_id="goal.validate_planning_artifact" governance="reversible" tool_id="shell"]
		attach [type="tool" action_runtime="in_process" action_id="goal.attach_planning_artifacts" governance="irreversible" tool_id="shell"]
		mark [type="tool" action_runtime="in_process" action_id="goal.mark_planned" governance="irreversible" tool_id="shell"]
		done [shape=Msquare]

		start -> encode -> persist -> validate -> attach -> mark -> done
	}
		`);

		const errors = validate(graph, { identityMode: "legacy" });
		expect(errors).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ nodeId: "encode", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "persist", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "validate", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "attach", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "mark", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
			]),
		);
	});

	it("accepts product judge action identifiers for opted-in judge graphs", () => {
		const graph = parse(`
	digraph valid_product_judge_actions {
		start [shape=Mdiamond]
		build_evidence [type="tool" action_runtime="in_process" action_id="judge.build_evidence_contract" governance="irreversible" tool_id="shell"]
		build_context [type="tool" action_runtime="in_process" action_id="judge.build_context_contract" governance="irreversible" tool_id="shell"]
		validate_context [type="tool" action_runtime="in_process" action_id="judge.validate_context_contract" governance="irreversible" tool_id="shell"]
		validate_evidence [type="tool" action_runtime="in_process" action_id="judge.validate_evidence_contract" governance="irreversible" tool_id="shell"]
		build_packet [type="tool" action_runtime="in_process" action_id="judge.build_recovery_packet" governance="irreversible" tool_id="shell"]
		open_followup [type="tool" action_runtime="in_process" action_id="wave.open_judge_followup" governance="irreversible" tool_id="shell"]
		done [shape=Msquare]

		start -> build_evidence -> build_context -> validate_context -> validate_evidence -> build_packet -> open_followup -> done
	}
		`);

		const errors = validate(graph, { identityMode: "legacy" });
		expect(errors).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ nodeId: "build_evidence", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "build_context", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "validate_context", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "validate_evidence", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "build_packet", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "open_followup", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
			]),
		);
	});

	it("accepts artifact and software handoff action identifiers for opted-in graphs", () => {
		const graph = parse(`
	digraph valid_handoff_actions {
		start [shape=Mdiamond]
		resolve_default [type="tool" action_runtime="in_process" action_id="common.resolve_default" governance="reversible" tool_id="shell"]
		resolve_repo [type="tool" action_runtime="in_process" action_id="common.resolve_gh_repo" governance="reversible" tool_id="shell"]
		resolve_coding [type="tool" action_runtime="in_process" action_id="common.resolve_capability_coding_skills_path" governance="reversible" tool_id="shell"]
		resolve_merge [type="tool" action_runtime="in_process" action_id="common.resolve_capability_merge_skills_path" governance="reversible" tool_id="shell"]
		resolve_decomp [type="tool" action_runtime="in_process" action_id="common.resolve_capability_goal_decomposition_skills_path" governance="reversible" tool_id="shell"]
		fetch_goal [type="tool" action_runtime="in_process" action_id="goal.fetch_goal_issue" governance="irreversible" tool_id="shell"]
		ingest [type="tool" action_runtime="in_process" action_id="artifact.ingest" governance="irreversible" tool_id="shell"]
		resolve_exec [type="tool" action_runtime="in_process" action_id="software.resolve_execution_config" governance="reversible" tool_id="shell"]
		list_exec [type="tool" action_runtime="in_process" action_id="software.list_executable_goals" governance="reversible" tool_id="shell"]
		done [shape=Msquare]

		start -> resolve_default -> resolve_repo -> resolve_coding -> resolve_merge -> resolve_decomp -> fetch_goal -> ingest -> resolve_exec -> list_exec -> done
	}
		`);

		const errors = validate(graph, { identityMode: "legacy" });
		expect(errors).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ nodeId: "resolve_default", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "resolve_repo", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "resolve_coding", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "resolve_merge", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "resolve_decomp", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "fetch_goal", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "ingest", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "resolve_exec", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "list_exec", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
			]),
		);
	});

	it("accepts goal-execute action identifiers for opted-in execution graphs", () => {
		const graph = parse(`
	digraph valid_goal_execute_actions {
		start [shape=Mdiamond]
		seed [type="tool" action_runtime="in_process" action_id="software.seed_goal_state" governance="reversible" tool_id="shell"]
		resolve_path [type="tool" action_runtime="in_process" action_id="software.resolve_goal_execution_path" governance="reversible" tool_id="shell"]
		branch [type="tool" action_runtime="in_process" action_id="software.empty_goal_branch_context" governance="reversible" tool_id="shell"]
		plan [type="tool" action_runtime="in_process" action_id="software.build_goal_execution_plan" governance="reversible" tool_id="shell"]
		pick [type="tool" action_runtime="in_process" action_id="software.pick_goal_plan_issue" governance="reversible" tool_id="shell"]
		advance [type="tool" action_runtime="in_process" action_id="software.advance_plan_index" governance="reversible" tool_id="shell"]
		accumulate [type="tool" action_runtime="in_process" action_id="software.accumulate_goal_result" governance="irreversible" tool_id="shell"]
		postmortem [type="tool" action_runtime="in_process" action_id="software.goal_postmortem" governance="irreversible" tool_id="shell"]
		split [type="tool" action_runtime="in_process" action_id="software.split_goal_results" governance="reversible" tool_id="shell"]
		review_failures [type="tool" action_runtime="in_process" action_id="software.handle_goal_review_failures" governance="irreversible" tool_id="shell"]
		check_candidates [type="tool" action_runtime="in_process" action_id="software.check_merge_candidates" governance="reversible" tool_id="shell"]
		build_results [type="tool" action_runtime="in_process" action_id="software.build_goal_merge_results" governance="irreversible" tool_id="shell"]
		handle_failures [type="tool" action_runtime="in_process" action_id="software.handle_goal_merge_failures" governance="irreversible" tool_id="shell"]
		close [type="tool" action_runtime="in_process" action_id="software.close_merged_issues" governance="irreversible" tool_id="shell"]
		fallback [type="tool" action_runtime="in_process" action_id="software.fallback_judge" governance="irreversible" tool_id="shell"]
		final_state [type="tool" action_runtime="in_process" action_id="software.reconcile_goal_final_state" governance="irreversible" tool_id="shell"]
		acquire_lock [type="tool" action_runtime="in_process" action_id="merge.acquire_lock" governance="reversible" tool_id="shell"]
		assert_clean [type="tool" action_runtime="in_process" action_id="merge.assert_main_clean" governance="reversible" tool_id="shell"]
		build_commit [type="tool" action_runtime="in_process" action_id="merge.build_commit_message" governance="reversible" tool_id="shell"]
		resolve_merge [type="tool" action_runtime="in_process" action_id="merge.resolve_context" governance="reversible" tool_id="shell"]
		emit_failure [type="tool" action_runtime="in_process" action_id="merge.emit_resolution_failure" governance="reversible" tool_id="shell"]
		push [type="tool" action_runtime="in_process" action_id="merge.push_main_branch" governance="irreversible" tool_id="shell"]
		release [type="tool" action_runtime="in_process" action_id="merge.release_lock" governance="reversible" tool_id="shell"]
		cleanup_goal [type="tool" action_runtime="in_process" action_id="coding.cleanup_wave_issue_worktree" governance="irreversible" tool_id="shell"]
		done [shape=Msquare]

		start -> seed -> resolve_path -> branch -> plan -> pick -> advance -> accumulate -> postmortem -> split -> review_failures -> check_candidates -> build_results -> handle_failures -> close -> fallback -> final_state -> acquire_lock -> assert_clean -> build_commit -> resolve_merge -> emit_failure -> push -> release -> cleanup_goal -> done
	}
		`);

		const errors = validate(graph, { identityMode: "legacy" });
		expect(errors).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ nodeId: "seed", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "resolve_path", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "branch", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "plan", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "pick", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "advance", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "accumulate", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "postmortem", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "split", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "review_failures", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "check_candidates", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "build_results", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "handle_failures", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "close", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "fallback", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "final_state", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "acquire_lock", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "assert_clean", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "build_commit", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "resolve_merge", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "emit_failure", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "push", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "release", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "cleanup_goal", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
			]),
		);
	});

	it("accepts coding execution action identifiers for opted-in issue execution graphs", () => {
		const graph = parse(`
	digraph valid_coding_execution_actions {
		start [shape=Mdiamond]
		extract [type="tool" action_runtime="in_process" action_id="coding.extract_issue_item" governance="irreversible" tool_id="shell"]
		resolve [type="tool" action_runtime="in_process" action_id="coding.resolve_goal_number_from_milestone" governance="reversible" tool_id="shell"]
		init [type="tool" action_runtime="in_process" action_id="coding.init_wave_issue_worktree" governance="reversible" tool_id="shell"]
		setup [type="tool" action_runtime="in_process" action_id="coding.setup_wave_issue_worktree" governance="irreversible" tool_id="shell"]
		begin [type="tool" action_runtime="in_process" action_id="coding.init_review_attempt" governance="reversible" tool_id="shell"]
		next [type="tool" action_runtime="in_process" action_id="coding.next_review_attempt" governance="reversible" tool_id="shell"]
		snapshot [type="tool" action_runtime="in_process" action_id="coding.snapshot_branch_head" governance="reversible" tool_id="shell"]
		commit [type="tool" action_runtime="in_process" action_id="coding.commit_local" governance="irreversible" tool_id="shell"]
		inspect [type="tool" action_runtime="in_process" action_id="coding.inspect_branch_changes" governance="reversible" tool_id="shell"]
		evidence [type="tool" action_runtime="in_process" action_id="coding.write_review_evidence" governance="irreversible" tool_id="shell"]
		context [type="tool" action_runtime="in_process" action_id="coding.build_review_context" governance="reversible" tool_id="shell"]
		validate [type="tool" action_runtime="in_process" action_id="coding.validate_review_context" governance="reversible" tool_id="shell"]
		route [type="tool" action_runtime="in_process" action_id="coding.resolve_review_route" governance="irreversible" tool_id="shell"]
		done [shape=Msquare]

		start -> extract -> resolve -> init -> setup -> begin -> next -> snapshot -> commit -> inspect -> evidence -> context -> validate -> route -> done
	}
		`);

		const errors = validate(graph, { identityMode: "legacy" });
		expect(errors).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ nodeId: "extract", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "resolve", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "init", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "setup", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "begin", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "next", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "snapshot", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "commit", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "inspect", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "evidence", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "context", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "validate", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "route", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
			]),
		);
	});

	it("accepts goal-issue action identifiers for opted-in goal issue execution graphs", () => {
		const graph = parse(`
	digraph valid_goal_issue_actions {
		start [shape=Mdiamond]
		guidance [type="tool" action_runtime="in_process" action_id="common.load_agent_guidance_context" governance="reversible" tool_id="shell"]
		set_issue [type="tool" action_runtime="in_process" action_id="coding.set_issue_context" governance="irreversible" tool_id="shell"]
		fetch [type="tool" action_runtime="in_process" action_id="coding.fetch_issue_body" governance="reversible" tool_id="shell"]
		estimate [type="tool" action_runtime="in_process" action_id="coding.estimate_issue_complexity" governance="reversible" tool_id="shell"]
		cleanup [type="tool" action_runtime="in_process" action_id="coding.cleanup_legacy_worktree" governance="irreversible" tool_id="shell"]
		toolchain [type="tool" action_runtime="in_process" action_id="coding.ensure_worktree_toolchain" governance="irreversible" tool_id="shell"]
		existing [type="tool" action_runtime="in_process" action_id="coding.inspect_existing_commits" governance="reversible" tool_id="shell"]
		reuse [type="tool" action_runtime="in_process" action_id="coding.decide_existing_reuse_with_notes" governance="reversible" tool_id="shell"]
		reset [type="tool" action_runtime="in_process" action_id="coding.reset_stale_branch" governance="irreversible" tool_id="shell"]
		mode [type="tool" action_runtime="in_process" action_id="coding.resolve_execution_mode" governance="reversible" tool_id="shell"]
		impl [type="tool" action_runtime="in_process" action_id="coding.build_impl_result" governance="reversible" tool_id="shell"]
		max_review [type="tool" action_runtime="in_process" action_id="coding.resolve_max_review_attempts" governance="reversible" tool_id="shell"]
		assert_main [type="tool" action_runtime="in_process" action_id="merge.assert_main_branch" governance="irreversible" tool_id="shell"]
		visual [type="tool" action_runtime="in_process" action_id="coding.verify_visual_refinement_evidence" governance="reversible" tool_id="shell"]
		telemetry [type="tool" action_runtime="in_process" action_id="coding.emit_review_verdict_telemetry" governance="reversible" tool_id="shell"]
		retry [type="tool" action_runtime="in_process" action_id="coding.should_retry_review" governance="reversible" tool_id="shell"]
		message [type="tool" action_runtime="in_process" action_id="coding.send_review_message" governance="irreversible" tool_id="shell"]
		failed [type="tool" action_runtime="in_process" action_id="coding.build_failed_result" governance="irreversible" tool_id="shell"]
		approved [type="tool" action_runtime="in_process" action_id="coding.build_approved_result" governance="irreversible" tool_id="shell"]
		infra [type="tool" action_runtime="in_process" action_id="coding.build_infra_failure_result" governance="irreversible" tool_id="shell"]
		done [shape=Msquare]

		start -> guidance -> set_issue -> fetch -> estimate -> cleanup -> toolchain -> existing -> reuse -> reset -> mode -> impl -> max_review -> assert_main -> visual -> telemetry -> retry -> message -> failed -> approved -> infra -> done
	}
		`);

		const errors = validate(graph, { identityMode: "legacy" });
		expect(errors).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ nodeId: "guidance", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "set_issue", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "fetch", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "estimate", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "cleanup", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "toolchain", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "existing", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "reuse", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "reset", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "mode", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "impl", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "max_review", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "assert_main", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "visual", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "telemetry", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "retry", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "message", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "failed", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "approved", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
				expect.objectContaining({ nodeId: "infra", code: IDENTITY_RULE_CODES.ACTION_ID_INVALID }),
			]),
		);
	});

	it("honors graph identity_mode when no override is passed", () => {
		const graph = parse(`
	digraph graph_mode {
		identity_mode = "strict"
		start [shape=Mdiamond]
		runner [type="tool" governance="reversible"]
		done [shape=Msquare]

		start -> runner -> done
	}
		`);

		const errors = validate(graph);

		expect(errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ nodeId: "runner", code: IDENTITY_RULE_CODES.TOOL_ID_REQUIRED }),
				expect.objectContaining({ nodeId: "runner", code: IDENTITY_RULE_CODES.ACTION_ID_REQUIRED }),
			]),
		);
	});

	it("reports invalid graph identity_mode with stable code", () => {
		const graph = parse(`
	digraph bad_graph_mode {
		identity_mode = "ultra"
		start [shape=Mdiamond]
		runner [type="tool" governance="reversible"]
		done [shape=Msquare]

		start -> runner -> done
	}
		`);

		const errors = validate(graph);
		expect(errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ rule: "identity_mode", code: IDENTITY_RULE_CODES.MODE_INVALID }),
			]),
		);
	});

	it("enforces strict trust telemetry contract to avoid heuristic fallbacks", () => {
		const graph = parse(`
	digraph strict_trust_contract {
		identity_mode = "strict"
		start [shape=Mdiamond]
		runner [type="tool" governance="reversible" tool_id="shell" action_id="file.write" agent_id="tool.shell" agent_version="1.0.0"]
		judge [type="codergen" trust_partition="judge" trust_domain="judge" trust_role="mothership.local.judge"]
		done [shape=Msquare]

		start -> runner -> judge -> done
	}
		`);

		const errors = validate(graph);
		expect(errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					rule: "trust_partition",
					nodeId: "runner",
					code: IDENTITY_RULE_CODES.TRUST_PARTITION_REQUIRED,
				}),
				expect.objectContaining({
					rule: "trust_domain",
					nodeId: "runner",
					code: IDENTITY_RULE_CODES.TRUST_DOMAIN_REQUIRED,
				}),
				expect.objectContaining({
					rule: "trust_role",
					nodeId: "runner",
					code: IDENTITY_RULE_CODES.TRUST_ROLE_REQUIRED,
				}),
			]),
		);
	});

	it("fails strict mode when explicit trust attrs disagree with derived partition/domain/role", () => {
		const graph = parse(`
	digraph strict_trust_mismatch {
		identity_mode = "strict"
		start [shape=Mdiamond]
		runner [type="codergen" trust_partition="builder" trust_domain="judge" trust_role="mothership.local.judge" judge="true"]
		done [shape=Msquare]

		start -> runner -> done
	}
		`);

		const errors = validate(graph);
		expect(errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					rule: "trust_partition",
					nodeId: "runner",
					code: IDENTITY_RULE_CODES.TRUST_PARTITION_MISMATCH,
				}),
				expect.objectContaining({
					rule: "trust_domain",
					nodeId: "runner",
					code: IDENTITY_RULE_CODES.TRUST_DOMAIN_ROLE_MISMATCH,
				}),
				expect.objectContaining({
					rule: "trust_role",
					nodeId: "runner",
					code: IDENTITY_RULE_CODES.TRUST_DOMAIN_ROLE_MISMATCH,
				}),
			]),
		);
	});

	it("formats identity diagnostics with machine-readable codes", () => {
		const graph = parse(`
	digraph strict_identity_formatting {
		identity_mode = "strict"
		start [shape=Mdiamond]
		runner [type="tool" governance="reversible"]
		done [shape=Msquare]

		start -> runner -> done
	}
		`);

		const errors = validate(graph);
		const formatted = errors.map((error) => formatValidationError(error));

		expect(formatted).toEqual(
			expect.arrayContaining([
				expect.stringContaining(`[tool_ids:${IDENTITY_RULE_CODES.TOOL_ID_REQUIRED}]`),
				expect.stringContaining(`[action_ids:${IDENTITY_RULE_CODES.ACTION_ID_REQUIRED}]`),
			]),
		);
	});
});
