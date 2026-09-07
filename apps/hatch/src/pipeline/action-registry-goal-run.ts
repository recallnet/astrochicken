import { StageStatus, type Context, type Outcome } from "./context.js";
import { expandVariables } from "./engine.js";
import type { Node } from "./graph.js";
import type { ActionExecutionRequest, ActionExecutor, ActionRegistry } from "./action-registry.js";
// @ts-ignore JS-owned goal decomposition capability action owners
import * as goalDecompositionActionOwners from "../../../../packages/capability-goal-decomposition/src/in-process-action-owners.mjs";

const {
	appendGoalRationaleFeature,
	applyFeatureBlockers,
	buildGoalRunAdmissionFailure,
	checkGoalAlreadyDecomposedWithPackets,
	computeGoalRunCloseCondition,
	countDecomposeAttemptsFromGitHub,
	exhaustDecomposeRetries,
	guardDuplicateGoalDecomposition,
	inspectGoalRunAdmission,
	inspectHardGoalState,
	labelCreatedIssues,
	markGoalDispatched,
	materializeApprovedHardPlan,
	normalizeIssueUrls,
	persistGoalDecompositionLedger,
	postDecomposeAttemptMarker,
	postGoalRetryComment,
	resolveFeatureDependencies,
	zipFeaturesToIssues,
} = goalDecompositionActionOwners as {
	appendGoalRationaleFeature: (options?: Record<string, unknown>) => unknown;
	applyFeatureBlockers: (options?: Record<string, unknown>) => unknown;
	buildGoalRunAdmissionFailure: (options?: Record<string, unknown>) => unknown;
	checkGoalAlreadyDecomposedWithPackets: (options?: Record<string, unknown>) => string;
	computeGoalRunCloseCondition: (options?: Record<string, unknown>) => string;
	countDecomposeAttemptsFromGitHub: (options?: Record<string, unknown>) => string;
	exhaustDecomposeRetries: (options?: Record<string, unknown>) => unknown;
	guardDuplicateGoalDecomposition: (options?: Record<string, unknown>) => unknown;
	inspectGoalRunAdmission: (options?: Record<string, unknown>) => unknown;
	inspectHardGoalState: (options?: Record<string, unknown>) => unknown;
	labelCreatedIssues: (options?: Record<string, unknown>) => unknown;
	markGoalDispatched: (options?: Record<string, unknown>) => unknown;
	materializeApprovedHardPlan: (options?: Record<string, unknown>) => unknown;
	normalizeIssueUrls: (raw?: string) => unknown;
	persistGoalDecompositionLedger: (options?: Record<string, unknown>) => unknown;
	postDecomposeAttemptMarker: (options?: Record<string, unknown>) => unknown;
	postGoalRetryComment: (options?: Record<string, unknown>) => unknown;
	resolveFeatureDependencies: (options?: Record<string, unknown>) => unknown;
	zipFeaturesToIssues: (options?: Record<string, unknown>) => unknown;
};

function expandAttr(node: Node, ctx: Context, key: string): string {
	return expandVariables(String(node.attrs[key] || ""), ctx).trim();
}

function decodeBase64Attr(node: Node, ctx: Context, key: string): string {
	const raw = expandAttr(node, ctx, key);
	return raw ? Buffer.from(raw, "base64").toString("utf8") : "";
}

function jsonOutcome(value: unknown, contextUpdates: Record<string, string> = {}): Outcome {
	return {
		status: StageStatus.Completed,
		output: JSON.stringify(value),
		contextUpdates,
	};
}

function textOutcome(value: string, contextUpdates: Record<string, string> = {}): Outcome {
	return {
		status: StageStatus.Completed,
		output: value,
		contextUpdates,
	};
}

class InspectHardGoalStateAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(inspectHardGoalState({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			repoRoot: expandAttr(request.node, request.ctx, "action_repo_root") || request.workDir,
			goalIssueNumber: expandAttr(request.node, request.ctx, "action_goal_issue_number"),
			goalExecutionPath: expandAttr(request.node, request.ctx, "action_goal_execution_path"),
			goalRoutingStateRaw: expandAttr(request.node, request.ctx, "action_goal_routing_state"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
		}));
	}
}

class InspectGoalRunAdmissionAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(inspectGoalRunAdmission({
			repo: expandAttr(request.node, request.ctx, "action_repo_root") || request.workDir,
			goalIssueNumber: expandAttr(request.node, request.ctx, "action_goal_issue_number"),
			goalExecutionPath: expandAttr(request.node, request.ctx, "action_goal_execution_path"),
			goalRoutingStateRaw: expandAttr(request.node, request.ctx, "action_goal_routing_state"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			hardGoal: expandAttr(request.node, request.ctx, "action_hard_goal"),
			hardGoalState: expandAttr(request.node, request.ctx, "action_hard_goal_state"),
			hardGoalStateReason: expandAttr(request.node, request.ctx, "action_hard_goal_state_reason"),
			readyLabelPresent: expandAttr(request.node, request.ctx, "action_ready_label_present"),
			awaitingHumanLabelPresent: expandAttr(request.node, request.ctx, "action_awaiting_human_label_present"),
			hardPlanPacketPresent: expandAttr(request.node, request.ctx, "action_hard_plan_packet_present"),
			hardPlanPacketId: expandAttr(request.node, request.ctx, "action_hard_plan_packet_id"),
			hardPlanPacketPath: expandAttr(request.node, request.ctx, "action_hard_plan_packet_path"),
			hardPlanCommentMarker: expandAttr(request.node, request.ctx, "action_hard_plan_comment_marker"),
			hardPlanCommentId: expandAttr(request.node, request.ctx, "action_hard_plan_comment_id"),
			hardPlanCommentUrl: expandAttr(request.node, request.ctx, "action_hard_plan_comment_url"),
			hardPlanArtifactCount: expandAttr(request.node, request.ctx, "action_hard_plan_artifact_count"),
			hardPlanArtifactRefsRaw: expandAttr(request.node, request.ctx, "action_hard_plan_artifact_refs"),
		}));
	}
}

class MaterializeApprovedPlanAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(materializeApprovedHardPlan({
			repoRoot: expandAttr(request.node, request.ctx, "action_repo_root") || request.workDir,
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			goalNumber: expandAttr(request.node, request.ctx, "action_goal_number"),
			planPacketId: expandAttr(request.node, request.ctx, "action_plan_packet_id"),
			planningArtifactPath: expandAttr(request.node, request.ctx, "action_planning_artifact_path"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			targetRepo: expandAttr(request.node, request.ctx, "action_target_repo"),
			controlPlaneRepo: expandAttr(request.node, request.ctx, "action_control_plane_repo"),
		}));
	}
}

class GoalPostRetryCommentAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(postGoalRetryComment({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
			approvedFeatureCount: expandAttr(request.node, request.ctx, "action_approved_feature_count"),
			issueCount: expandAttr(request.node, request.ctx, "action_issue_count"),
			decomposeApproved: expandAttr(request.node, request.ctx, "action_decompose_approved"),
			decomposeAttempts: expandAttr(request.node, request.ctx, "action_decompose_attempts"),
			decomposeParseStatus: expandAttr(request.node, request.ctx, "action_decompose_parse_status"),
			decomposeParseSource: expandAttr(request.node, request.ctx, "action_decompose_parse_source"),
		}));
	}
}

class CountDecomposeAttemptsAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(countDecomposeAttemptsFromGitHub({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
		}));
	}
}

class ExhaustDecomposeRetriesAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(exhaustDecomposeRetries({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
			decomposeRetryCount: expandAttr(request.node, request.ctx, "action_decompose_retry_count"),
		}));
	}
}

class PostDecomposeAttemptAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(postDecomposeAttemptMarker({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
			decomposeAttemptNumber: expandAttr(request.node, request.ctx, "action_decompose_attempt_number"),
		}));
	}
}

class AppendRationaleFeatureAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(appendGoalRationaleFeature({
			approvedFeaturesRaw: expandAttr(request.node, request.ctx, "action_approved_features"),
			goalIssueRaw: expandAttr(request.node, request.ctx, "action_goal_issue"),
			goalIssueNumber: expandAttr(request.node, request.ctx, "action_goal_issue_number"),
			executionPath: expandAttr(request.node, request.ctx, "action_execution_path"),
			understandingRisk: expandAttr(request.node, request.ctx, "action_understanding_risk"),
			rationaleRequired: expandAttr(request.node, request.ctx, "action_rationale_required"),
		}));
	}
}

class PersistGoalDecompositionPacketAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(persistGoalDecompositionLedger({
			repo: expandAttr(request.node, request.ctx, "action_repo_root") || request.workDir,
			goalIssueRaw: decodeBase64Attr(request.node, request.ctx, "action_goal_issue_b64"),
			goalContextRaw: decodeBase64Attr(request.node, request.ctx, "action_goal_context_b64"),
			approvedFeaturesRaw: decodeBase64Attr(request.node, request.ctx, "action_approved_features_b64"),
			issueUrlsRaw: decodeBase64Attr(request.node, request.ctx, "action_issue_urls_b64"),
			goalIssueNumber: expandAttr(request.node, request.ctx, "action_goal_issue_number"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline"),
			nodeId: expandAttr(request.node, request.ctx, "action_node_id"),
			targetRepo: expandAttr(request.node, request.ctx, "action_target_repo"),
			controlPlaneRepo: expandAttr(request.node, request.ctx, "action_control_plane_repo"),
		}));
	}
}

class NormalizeIssueUrlsAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(normalizeIssueUrls(expandAttr(request.node, request.ctx, "action_issue_urls") || request.input));
	}
}

class ZipFeaturesToIssuesAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(zipFeaturesToIssues({
			featuresRaw: expandAttr(request.node, request.ctx, "action_approved_features"),
			issueIndexRaw: expandAttr(request.node, request.ctx, "action_normalized_issues"),
		}));
	}
}

class ResolveFeatureDependenciesAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(resolveFeatureDependencies({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			featureIssueMapRaw: expandAttr(request.node, request.ctx, "action_feature_issue_map"),
		}));
	}
}

class LabelCreatedIssuesAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(labelCreatedIssues({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			issueUrlsRaw: expandAttr(request.node, request.ctx, "action_issue_urls"),
		}));
	}
}

class ApplyFeatureBlockersAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(applyFeatureBlockers({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			goalIssueNumber: expandAttr(request.node, request.ctx, "action_goal_issue_number"),
			featureIssueMap: expandAttr(request.node, request.ctx, "action_feature_issue_map"),
		}));
	}
}

class ComputeCloseConditionAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(computeGoalRunCloseCondition({
			issueCount: expandAttr(request.node, request.ctx, "action_issue_count"),
			approvedFeatureCount: expandAttr(request.node, request.ctx, "action_approved_feature_count"),
		}));
	}
}

class MarkGoalDispatchedAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(markGoalDispatched({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
		}));
	}
}

class BuildAdmissionFailureAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(buildGoalRunAdmissionFailure({
			goalIssueNumber: expandAttr(request.node, request.ctx, "action_goal_issue_number"),
			goalAdmissionDecision: expandAttr(request.node, request.ctx, "action_goal_admission_decision"),
			goalAdmissionReason: expandAttr(request.node, request.ctx, "action_goal_admission_reason"),
			goalAdmissionErrorCode: expandAttr(request.node, request.ctx, "action_goal_admission_error_code"),
			decompositionPacketPresent: expandAttr(request.node, request.ctx, "action_decomposition_packet_present"),
			planningLocked: expandAttr(request.node, request.ctx, "action_planning_locked"),
		}));
	}
}

class CheckAlreadyDecomposedAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(checkGoalAlreadyDecomposedWithPackets({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
			repoRoot: expandAttr(request.node, request.ctx, "action_repo_root") || request.workDir,
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
		}));
	}
}

class GuardDuplicateDecomposeAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(guardDuplicateGoalDecomposition({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			repoRoot: expandAttr(request.node, request.ctx, "action_repo_root") || request.workDir,
			issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline"),
			nodeId: expandAttr(request.node, request.ctx, "action_node_id"),
		}));
	}
}

export function registerGoalRunActions(registry: ActionRegistry): void {
	registry.register("goal.inspect_hard_state", new InspectHardGoalStateAction());
	registry.register("goal.inspect_run_admission", new InspectGoalRunAdmissionAction());
	registry.register("goal.materialize_approved_plan", new MaterializeApprovedPlanAction());
	registry.register("goal.post_retry_comment", new GoalPostRetryCommentAction());
	registry.register("goal.count_decompose_attempts", new CountDecomposeAttemptsAction());
	registry.register("goal.exhaust_decompose_retries", new ExhaustDecomposeRetriesAction());
	registry.register("goal.post_decompose_attempt", new PostDecomposeAttemptAction());
	registry.register("goal.append_rationale_feature", new AppendRationaleFeatureAction());
	registry.register("goal.persist_decomposition_packet", new PersistGoalDecompositionPacketAction());
	registry.register("triage.normalize_issue_urls", new NormalizeIssueUrlsAction());
	registry.register("triage.zip_features_to_issues", new ZipFeaturesToIssuesAction());
	registry.register("triage.resolve_feature_dependencies", new ResolveFeatureDependenciesAction());
	registry.register("goal.label_created_issues", new LabelCreatedIssuesAction());
	registry.register("goal.apply_feature_blockers", new ApplyFeatureBlockersAction());
	registry.register("goal.compute_close_condition", new ComputeCloseConditionAction());
	registry.register("goal.mark_dispatched", new MarkGoalDispatchedAction());
	registry.register("goal.build_admission_failure", new BuildAdmissionFailureAction());
	registry.register("goal.check_already_decomposed", new CheckAlreadyDecomposedAction());
	registry.register("goal.guard_duplicate_decompose", new GuardDuplicateDecomposeAction());
}
