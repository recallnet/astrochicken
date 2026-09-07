import { StageStatus, type Context, type Outcome } from "./context.js";
import { expandVariables } from "./engine.js";
import type { Node } from "./graph.js";
import type { ActionExecutionRequest, ActionExecutor, ActionRegistry } from "./action-registry.js";
// @ts-ignore JS-owned wave-dispatch capability action owners
import * as waveActionOwners from "../../../../packages/capability-wave-dispatch/src/in-process-action-owners.mjs";
// @ts-ignore JS-owned software-development capability action owners
import * as softwareActionOwners from "../../../../packages/capability-software-development/src/in-process-action-owners.mjs";

const {
	blockReadyWaveIssue,
	checkControlPlaneBlocker,
	completeReadyWaveIssue,
	lockReadyWaveIssue,
	openJudgeFollowupArtifact,
	pickReadyWaveFromRepo,
	requeueAfterJudgeFailure,
	releaseReadyWaveClaimOps,
	sanitizeWaveState,
} = waveActionOwners as {
	blockReadyWaveIssue: (options?: Record<string, unknown>) => unknown;
	checkControlPlaneBlocker: (options?: Record<string, unknown>) => Promise<unknown> | unknown;
	completeReadyWaveIssue: (options?: Record<string, unknown>) => unknown;
	lockReadyWaveIssue: (options?: Record<string, unknown>) => unknown;
	openJudgeFollowupArtifact: (options?: Record<string, unknown>) => unknown;
	pickReadyWaveFromRepo: (options?: Record<string, unknown>) => unknown;
	requeueAfterJudgeFailure: (options?: Record<string, unknown>) => unknown;
	releaseReadyWaveClaimOps: (options?: Record<string, unknown>) => unknown;
	sanitizeWaveState: (options?: Record<string, unknown>) => unknown;
};

const {
	accumulateMilestoneBatchResults,
	accumulateMilestoneResult,
	analyzeGiveUp,
	buildMilestoneParallelBatch,
	buildMilestoneParallelIssueContext,
	buildWaveMergeResults,
	checkMergeCandidates,
	classifyMilestoneIssueComplexity,
	classifyWaveDemoStrategy,
	closeMergedIssues,
	commentMergeFailures,
	commentReviewFailures,
	emptyMilestoneBranchContext,
	fallbackJudgeDecision,
	generateWaveTerminalDemo,
	pickNextMilestoneIssueFromArgs,
	publishWaveDemoArtifact,
	reconcileGoalFinalState,
	resolveWaveConfig,
	seedMilestoneState,
	splitWaveImplResultsFromSources,
} = softwareActionOwners as {
	accumulateMilestoneBatchResults: (options?: Record<string, unknown>) => unknown;
	accumulateMilestoneResult: (options?: Record<string, unknown>) => unknown;
	analyzeGiveUp: (options?: Record<string, unknown>) => unknown;
	buildMilestoneParallelBatch: (options?: Record<string, unknown>) => unknown;
	buildMilestoneParallelIssueContext: (options?: Record<string, unknown>) => unknown;
	buildWaveMergeResults: (options?: Record<string, unknown>) => unknown;
	checkMergeCandidates: (raw?: string) => unknown;
	classifyMilestoneIssueComplexity: (options?: Record<string, unknown>) => unknown;
	classifyWaveDemoStrategy: (options?: Record<string, unknown>) => unknown;
	closeMergedIssues: (options?: Record<string, unknown>) => unknown;
	commentMergeFailures: (options?: Record<string, unknown>) => unknown;
	commentReviewFailures: (options?: Record<string, unknown>) => unknown;
	emptyMilestoneBranchContext: (options?: Record<string, unknown>) => unknown;
	fallbackJudgeDecision: (options?: Record<string, unknown>) => unknown;
	generateWaveTerminalDemo: (options?: Record<string, unknown>) => unknown;
	pickNextMilestoneIssueFromArgs: (options?: Record<string, unknown>) => unknown;
	publishWaveDemoArtifact: (options?: Record<string, unknown>) => unknown;
	reconcileGoalFinalState: (options?: Record<string, unknown>) => Promise<unknown>;
	resolveWaveConfig: (options?: Record<string, unknown>) => unknown;
	seedMilestoneState: (options?: Record<string, unknown>) => unknown;
	splitWaveImplResultsFromSources: (options?: Record<string, unknown>) => unknown;
};

function expandAttr(node: Node, ctx: Context, key: string): string {
	return expandVariables(String(node.attrs[key] || ""), ctx).trim();
}

function decodeBase64Attr(node: Node, ctx: Context, key: string) {
	const raw = expandAttr(node, ctx, key);
	return raw ? Buffer.from(raw, "base64").toString("utf8") : "";
}

function parseJsonAttr(node: Node, ctx: Context, key: string, fallback: unknown = {}) {
	const raw = expandAttr(node, ctx, key);
	if (!raw) return fallback;
	return JSON.parse(raw);
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

class ResolveWaveConfigAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(resolveWaveConfig({
			integrationCommand: expandAttr(request.node, request.ctx, "action_integration_command"),
			reviewQaCommand: expandAttr(request.node, request.ctx, "action_review_qa_command"),
			stalledWaveMinutes: expandAttr(request.node, request.ctx, "action_stalled_wave_minutes"),
		}));
	}
}

class FindReadyWaveAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(pickReadyWaveFromRepo({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			workerId: expandAttr(request.node, request.ctx, "action_worker_id"),
			runsDir: expandAttr(request.node, request.ctx, "action_runs_dir"),
			staleRunMinutes: Number(expandAttr(request.node, request.ctx, "action_stale_run_minutes") || 20),
		}));
	}
}

class CheckControlPlaneBlockerAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(await checkControlPlaneBlocker({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			issue: expandAttr(request.node, request.ctx, "action_issue"),
		}));
	}
}

class LockReadyWaveAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(lockReadyWaveIssue({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			readyIssueNumber: expandAttr(request.node, request.ctx, "action_ready_issue_number"),
			milestoneTitle: expandAttr(request.node, request.ctx, "action_milestone_title"),
			claimToken: expandAttr(request.node, request.ctx, "action_claim_token"),
			claimOwnerId: expandAttr(request.node, request.ctx, "action_claim_owner_id"),
			claimRunId: expandAttr(request.node, request.ctx, "action_claim_run_id"),
		}));
	}
}

class ReleaseWaveClaimAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(releaseReadyWaveClaimOps({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			readyIssueNumber: expandAttr(request.node, request.ctx, "action_ready_issue_number"),
			claimToken: expandAttr(request.node, request.ctx, "action_claim_token"),
			claimOwnerId: expandAttr(request.node, request.ctx, "action_claim_owner_id"),
			claimRunId: expandAttr(request.node, request.ctx, "action_claim_run_id"),
			reason: expandAttr(request.node, request.ctx, "action_reason"),
			force: expandAttr(request.node, request.ctx, "action_force") === "true",
		}));
	}
}

class SeedMilestoneStateAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(seedMilestoneState({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			milestoneTitle: expandAttr(request.node, request.ctx, "action_milestone_title"),
		}));
	}
}

class EmptyMilestoneBranchContextAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(emptyMilestoneBranchContext({
			milestoneTitle: expandAttr(request.node, request.ctx, "action_milestone_title"),
		}));
	}
}

class PickNextMilestoneIssueAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(pickNextMilestoneIssueFromArgs({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			milestoneTitle: expandAttr(request.node, request.ctx, "action_milestone_title"),
			completedRaw: expandAttr(request.node, request.ctx, "action_completed"),
			processedRaw: expandAttr(request.node, request.ctx, "action_processed"),
			candidateLimit: 3,
		}));
	}
}

class AccumulateMilestoneResultAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(accumulateMilestoneResult({
			implResultsRaw: expandAttr(request.node, request.ctx, "action_impl_results"),
			completedRaw: expandAttr(request.node, request.ctx, "action_completed"),
			processedRaw: expandAttr(request.node, request.ctx, "action_processed"),
			itemRaw: expandAttr(request.node, request.ctx, "action_item"),
			fallbackIssueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
			fallbackIssueTitle: expandAttr(request.node, request.ctx, "action_issue_title"),
		}));
	}
}

class MilestonePostmortemAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(analyzeGiveUp({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
			branch: expandAttr(request.node, request.ctx, "action_branch"),
			reviewNotes: expandAttr(request.node, request.ctx, "action_review_notes"),
			worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
			reviewEvidencePath: expandAttr(request.node, request.ctx, "action_review_evidence_path"),
		}));
	}
}

class ClassifyMilestoneAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(classifyMilestoneIssueComplexity({
			complexityClass: expandAttr(request.node, request.ctx, "action_complexity_class"),
			milestoneParallelLowEnabled: expandAttr(request.node, request.ctx, "action_milestone_parallel_low_enabled"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline") || "milestone_execute",
		}));
	}
}

class BuildMilestoneBatchAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(buildMilestoneParallelBatch({
			issues: expandAttr(request.node, request.ctx, "action_issues_b64")
				? Buffer.from(expandAttr(request.node, request.ctx, "action_issues_b64"), "base64").toString("utf8")
				: expandAttr(request.node, request.ctx, "action_issues"),
			maxParallel: expandAttr(request.node, request.ctx, "action_max_parallel"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline") || "milestone_execute",
		}));
	}
}

class AccumulateMilestoneBatchAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(accumulateMilestoneBatchResults({
			implResultsRaw: expandAttr(request.node, request.ctx, "action_impl_results"),
			completedRaw: expandAttr(request.node, request.ctx, "action_completed"),
			processedRaw: expandAttr(request.node, request.ctx, "action_processed"),
			itemsRaw: expandAttr(request.node, request.ctx, "action_items"),
		}));
	}
}

class BuildMilestoneParallelContextAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(buildMilestoneParallelIssueContext({
			milestoneTitle: expandAttr(request.node, request.ctx, "action_milestone_title"),
			issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
		}));
	}
}

class SplitWaveResultsAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(splitWaveImplResultsFromSources({
			runId: "",
			runsDir: expandAttr(request.node, request.ctx, "action_runs_dir") || ".hatch/runs",
			fallbackRaw: expandAttr(request.node, request.ctx, "action_fallback"),
		}));
	}
}

class HandleWaveReviewFailuresAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(commentReviewFailures({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			reviewFailuresRaw: expandAttr(request.node, request.ctx, "action_review_failures"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline"),
			quarantineThreshold: Number(expandAttr(request.node, request.ctx, "action_quarantine_threshold") || 0),
			cooldownHours: Number(expandAttr(request.node, request.ctx, "action_cooldown_hours") || 0),
		}));
	}
}

class CheckWaveMergeCandidatesAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(checkMergeCandidates(expandAttr(request.node, request.ctx, "action_merge_candidates")));
	}
}

class CloseWaveMergedIssuesAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(closeMergedIssues({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			mergeCandidatesRaw: expandAttr(request.node, request.ctx, "action_merge_candidates"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id") || String(request.ctx.get("factory_id") || ""),
			milestoneTitle: expandAttr(request.node, request.ctx, "action_milestone_title"),
			repoRoot: request.workDir,
		}));
	}
}

class BuildWaveMergeResultsAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(buildWaveMergeResults({
			mergeCandidatesRaw: expandAttr(request.node, request.ctx, "action_merge_candidates"),
			mergeStatus: expandAttr(request.node, request.ctx, "action_merge_status"),
			mergeNotes: decodeBase64Attr(request.node, request.ctx, "action_merge_notes_b64")
				|| expandAttr(request.node, request.ctx, "action_merge_notes"),
			mergeResolver: expandAttr(request.node, request.ctx, "action_merge_resolver"),
			pathTaken: expandAttr(request.node, request.ctx, "action_path_taken"),
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id") || String(request.ctx.get("factory_id") || ""),
			runId: expandAttr(request.node, request.ctx, "action_run_id") || String(request.ctx.get("__run_id") || ""),
		}));
	}
}

class ClassifyWaveDemoStrategyAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(classifyWaveDemoStrategy({
			mergedResultsRaw: expandAttr(request.node, request.ctx, "action_merged_results"),
			issueMetadataRaw: expandAttr(request.node, request.ctx, "action_issue_metadata"),
			demoStrategy: expandAttr(request.node, request.ctx, "action_demo_strategy"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline") || "wave_execute",
		}));
	}
}

class GenerateWaveTerminalDemoAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(generateWaveTerminalDemo({
			runId: expandAttr(request.node, request.ctx, "action_run_id") || String(request.ctx.get("__run_id") || ""),
			runsDir: expandAttr(request.node, request.ctx, "action_runs_dir") || ".hatch/runs",
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			milestoneTitle: expandAttr(request.node, request.ctx, "action_milestone_title"),
			readyIssueNumber: expandAttr(request.node, request.ctx, "action_ready_issue_number"),
			mergedResultsRaw: expandAttr(request.node, request.ctx, "action_merged_results"),
			mergeStdout: expandAttr(request.node, request.ctx, "action_merge_stdout"),
			mergeStderr: expandAttr(request.node, request.ctx, "action_merge_stderr"),
			issueTitlesRaw: expandAttr(request.node, request.ctx, "action_issue_titles"),
		}));
	}
}

class PublishWaveDemoArtifactAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(publishWaveDemoArtifact({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			runId: expandAttr(request.node, request.ctx, "action_run_id") || String(request.ctx.get("__run_id") || ""),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline") || "wave_execute",
			milestoneTitle: expandAttr(request.node, request.ctx, "action_milestone_title"),
			readyIssueNumber: expandAttr(request.node, request.ctx, "action_ready_issue_number"),
			demoArtifactPath: expandAttr(request.node, request.ctx, "action_demo_artifact_path"),
			demoArtifactContent: expandAttr(request.node, request.ctx, "action_demo_artifact_content"),
			demoStrategy: expandAttr(request.node, request.ctx, "action_demo_strategy"),
		}));
	}
}

class HandleWaveMergeFailuresAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(commentMergeFailures({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			mergeFailuresRaw: expandAttr(request.node, request.ctx, "action_merge_failures"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline"),
			milestoneTitle: expandAttr(request.node, request.ctx, "action_milestone_title"),
			readyIssueNumber: expandAttr(request.node, request.ctx, "action_ready_issue_number"),
		}));
	}
}

class FallbackWaveJudgeAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(fallbackJudgeDecision({
			verdictRaw: expandAttr(request.node, request.ctx, "action_verdict") || request.input,
			error: expandAttr(request.node, request.ctx, "action_error"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			runId: expandAttr(request.node, request.ctx, "action_run_id") || String(request.ctx.get("__run_id") || ""),
			workflowId: expandAttr(request.node, request.ctx, "action_pipeline") || "wave_execute",
			capabilityId: "wave_execution",
		}));
	}
}

class CompleteReadyWaveAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(completeReadyWaveIssue({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			readyIssueNumber: expandAttr(request.node, request.ctx, "action_ready_issue_number"),
			milestoneTitle: expandAttr(request.node, request.ctx, "action_milestone_title"),
			claimToken: expandAttr(request.node, request.ctx, "action_claim_token"),
			claimOwnerId: expandAttr(request.node, request.ctx, "action_claim_owner_id"),
			claimRunId: expandAttr(request.node, request.ctx, "action_claim_run_id"),
		}));
	}
}

class BlockReadyWaveAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(blockReadyWaveIssue({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			readyIssueNumber: expandAttr(request.node, request.ctx, "action_ready_issue_number"),
			milestoneTitle: expandAttr(request.node, request.ctx, "action_milestone_title"),
			reason: expandAttr(request.node, request.ctx, "action_reason"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline"),
		}));
	}
}

class RequeueAfterJudgeFailureAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(requeueAfterJudgeFailure({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			wave: expandAttr(request.node, request.ctx, "action_wave"),
			milestone: expandAttr(request.node, request.ctx, "action_milestone"),
			judgeContext: parseJsonAttr(request.node, request.ctx, "action_judge_context", {}),
			cooldownPolicy: parseJsonAttr(request.node, request.ctx, "action_cooldown_policy", {}),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline"),
		}));
	}
}

class FinalizeTerminalClaimAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		releaseReadyWaveClaimOps({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			readyIssueNumber: expandAttr(request.node, request.ctx, "action_ready_issue_number"),
			claimToken: expandAttr(request.node, request.ctx, "action_claim_token"),
			claimOwnerId: expandAttr(request.node, request.ctx, "action_claim_owner_id"),
			claimRunId: expandAttr(request.node, request.ctx, "action_claim_run_id"),
			reason: expandAttr(request.node, request.ctx, "action_reason"),
			force: false,
		});
		const terminalPath = expandAttr(request.node, request.ctx, "action_terminal_path");
		return textOutcome(terminalPath, { wave_terminal_path: terminalPath });
	}
}

class ResolveGoalFinalStateAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const goalNumber = expandAttr(request.node, request.ctx, "action_goal_number");
		if (!goalNumber) {
			return jsonOutcome({});
		}
		// @context:integration Goal final-state needs the control-plane checkout for packet lookup
		// and the live runs_dir for the active-run guard, even when older graphs only pass gh_repo.
		return jsonOutcome(await reconcileGoalFinalState({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			repoRoot: expandAttr(request.node, request.ctx, "action_repo_root") || request.workDir,
			goalNumber,
			runsDir: expandAttr(request.node, request.ctx, "action_runs_dir") || request.ctx.get("runs_dir"),
		}));
	}
}

class OpenWaveJudgeFollowupAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(openJudgeFollowupArtifact({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			milestoneTitle: expandAttr(request.node, request.ctx, "action_milestone_title"),
			judgeNotes: expandAttr(request.node, request.ctx, "action_judge_notes"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline"),
		}));
	}
}

export function registerWaveExecuteActions(registry: ActionRegistry): void {
	registry.register("software.resolve_wave_config", new ResolveWaveConfigAction());
	registry.register("wave.find_ready", new FindReadyWaveAction());
	registry.register("wave.check_control_plane_blocker", new CheckControlPlaneBlockerAction());
	registry.register("wave.lock_ready", new LockReadyWaveAction());
	registry.register("wave.release_claim", new ReleaseWaveClaimAction());
	registry.register("software.seed_milestone_state", new SeedMilestoneStateAction());
	registry.register("software.empty_milestone_branch_context", new EmptyMilestoneBranchContextAction());
	registry.register("software.pick_next_milestone_issue", new PickNextMilestoneIssueAction());
	registry.register("software.accumulate_milestone_result", new AccumulateMilestoneResultAction());
	registry.register("software.milestone_postmortem", new MilestonePostmortemAction());
	registry.register("software.split_wave_results", new SplitWaveResultsAction());
	registry.register("software.handle_wave_review_failures", new HandleWaveReviewFailuresAction());
	registry.register("software.check_wave_merge_candidates", new CheckWaveMergeCandidatesAction());
	registry.register("software.close_wave_merged_issues", new CloseWaveMergedIssuesAction());
	registry.register("software.build_wave_merge_results", new BuildWaveMergeResultsAction());
	registry.register("software.classify_wave_demo_strategy", new ClassifyWaveDemoStrategyAction());
	registry.register("software.generate_wave_terminal_demo", new GenerateWaveTerminalDemoAction());
	registry.register("software.publish_wave_demo_artifact", new PublishWaveDemoArtifactAction());
	registry.register("software.handle_wave_merge_failures", new HandleWaveMergeFailuresAction());
	registry.register("software.fallback_wave_judge", new FallbackWaveJudgeAction());
	registry.register("wave.complete_ready", new CompleteReadyWaveAction());
	registry.register("wave.block_ready", new BlockReadyWaveAction());
	registry.register("wave.requeue_after_judge_failure", new RequeueAfterJudgeFailureAction());
	registry.register("wave.finalize_terminal_claim", new FinalizeTerminalClaimAction());
	registry.register("software.resolve_goal_final_state", new ResolveGoalFinalStateAction());
	registry.register("wave.open_judge_followup", new OpenWaveJudgeFollowupAction());
	registry.register("ceremony.classify_milestone", new ClassifyMilestoneAction());
	registry.register("ceremony.build_milestone_batch", new BuildMilestoneBatchAction());
	registry.register("software.accumulate_milestone_batch", new AccumulateMilestoneBatchAction());
	registry.register("software.build_milestone_parallel_context", new BuildMilestoneParallelContextAction());
}
