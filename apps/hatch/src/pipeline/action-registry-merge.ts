import { StageStatus, type Context, type Outcome } from "./context.js";
import { expandVariables } from "./engine.js";
import type { Node } from "./graph.js";
import type { ActionExecutionRequest, ActionExecutor, ActionRegistry } from "./action-registry.js";
// @ts-ignore JS-owned merge capability action owners
import * as mergeActionOwners from "../../../../packages/capability-merge/src/in-process-action-owners.mjs";

const {
	acquireMergeLock,
	assertMainBranch,
	assertMainClean,
	attemptDeterministicMerge,
	buildConflictPacket,
	buildGoalScopedMergeMessage,
	buildMergeReport,
	cleanupMergeWorktree,
	emitResolutionFailure,
	extractMergeItem,
	finalizeMergeCommit,
	pushMainBranch,
	rebaseBranchOnMain,
	releaseMergeLock,
	resolveMergeContext,
	runMergeIntegration,
	setupMergeWorktree,
	verifyPushRecovery,
	verifyConflictResolution,
} = mergeActionOwners as {
	acquireMergeLock: (options?: Record<string, unknown>) => unknown;
	assertMainBranch: (options?: Record<string, unknown>) => unknown;
	assertMainClean: (options?: Record<string, unknown>) => unknown;
	attemptDeterministicMerge: (options?: Record<string, unknown>) => unknown;
	buildConflictPacket: (options?: Record<string, unknown>) => unknown;
	buildGoalScopedMergeMessage: (options?: Record<string, unknown>) => unknown;
	buildMergeReport: (options?: Record<string, unknown>) => unknown;
	cleanupMergeWorktree: (options?: Record<string, unknown>) => unknown;
	emitResolutionFailure: (options?: Record<string, unknown>) => unknown;
	extractMergeItem: (raw?: string) => unknown;
	finalizeMergeCommit: (options?: Record<string, unknown>) => unknown;
	pushMainBranch: (options?: Record<string, unknown>) => unknown;
	rebaseBranchOnMain: (options?: Record<string, unknown>) => unknown;
	releaseMergeLock: (options?: Record<string, unknown>) => unknown;
	resolveMergeContext: (options?: Record<string, unknown>) => unknown;
	runMergeIntegration: (options?: Record<string, unknown>) => unknown;
	setupMergeWorktree: (options?: Record<string, unknown>) => unknown;
	verifyPushRecovery: (options?: Record<string, unknown>) => unknown;
	verifyConflictResolution: (options?: Record<string, unknown>) => unknown;
};

function expandAttr(node: Node, ctx: Context, key: string): string {
	return expandVariables(String(node.attrs[key] || ""), ctx).trim();
}

function decodeBase64Attr(node: Node, ctx: Context, key: string) {
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

class ExtractMergeItemAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(extractMergeItem(expandAttr(request.node, request.ctx, "action_merge_item") || request.input));
	}
}

class SetupMergeWorktreeAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(setupMergeWorktree({
			repo: expandAttr(request.node, request.ctx, "action_repo") || request.workDir,
			branch: expandAttr(request.node, request.ctx, "action_branch"),
			issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline"),
			mergeWorktreeDir: expandAttr(request.node, request.ctx, "action_merge_worktree_dir"),
		}));
	}
}

class RebaseOnMainAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(rebaseBranchOnMain({
			repo: expandAttr(request.node, request.ctx, "action_repo") || request.workDir,
			branch: expandAttr(request.node, request.ctx, "action_branch"),
			worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
			mergeWorktreeDir: expandAttr(request.node, request.ctx, "action_merge_worktree_dir"),
		}));
	}
}

class AssertMainBranchAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(assertMainBranch({
			repo: expandAttr(request.node, request.ctx, "action_repo") || request.workDir,
		}));
	}
}

class AssertMainCleanAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(assertMainClean({
			repo: expandAttr(request.node, request.ctx, "action_repo") || request.workDir,
		}));
	}
}

class AcquireMergeLockAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(acquireMergeLock({
			repo: expandAttr(request.node, request.ctx, "action_repo") || request.workDir,
		}));
	}
}

class ReleaseMergeLockAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(releaseMergeLock({
			repo: expandAttr(request.node, request.ctx, "action_repo") || request.workDir,
		}));
	}
}

class BuildGoalMergeCommitMessageAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(buildGoalScopedMergeMessage({
			milestoneTitle: expandAttr(request.node, request.ctx, "action_milestone_title"),
			goalIssueNumber: expandAttr(request.node, request.ctx, "action_goal_issue_number"),
			goalIssueTitle: expandAttr(request.node, request.ctx, "action_goal_issue_title"),
			mergeCandidatesRaw: expandAttr(request.node, request.ctx, "action_merge_candidates_raw"),
		}));
	}
}

class ResolveMergeContextAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(resolveMergeContext({
			mergeCandidatesRaw: expandAttr(request.node, request.ctx, "action_merge_candidates"),
			fallbackBranch: expandAttr(request.node, request.ctx, "action_fallback_branch"),
			fallbackWorktreeDir: expandAttr(request.node, request.ctx, "action_fallback_worktree_dir"),
		}));
	}
}

class AttemptDeterministicMergeAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(attemptDeterministicMerge({
			repo: expandAttr(request.node, request.ctx, "action_repo") || request.workDir,
			branch: expandAttr(request.node, request.ctx, "action_branch"),
			mergeWorktreeDir: expandAttr(request.node, request.ctx, "action_merge_worktree_dir"),
			branchHeadSha: expandAttr(request.node, request.ctx, "action_branch_head_sha"),
			commitMessage: expandAttr(request.node, request.ctx, "action_commit_message"),
		}));
	}
}

class BuildConflictPacketAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(buildConflictPacket({
			repo: expandAttr(request.node, request.ctx, "action_repo") || request.workDir,
			branch: expandAttr(request.node, request.ctx, "action_branch"),
			issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
			mergeCandidates: expandAttr(request.node, request.ctx, "action_merge_candidates"),
			mergeStderr: expandAttr(request.node, request.ctx, "action_merge_stderr"),
			worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline"),
			nodeId: expandAttr(request.node, request.ctx, "action_node_id"),
			targetRepo: expandAttr(request.node, request.ctx, "action_target_repo"),
			controlPlaneRepo: expandAttr(request.node, request.ctx, "action_control_plane_repo"),
		}));
	}
}

class FinalizeMergeCommitAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(finalizeMergeCommit({
			repo: expandAttr(request.node, request.ctx, "action_repo") || request.workDir,
			worktreeDir: expandAttr(request.node, request.ctx, "action_merge_worktree_dir")
				|| expandAttr(request.node, request.ctx, "action_worktree_dir"),
			expectedBranch: expandAttr(request.node, request.ctx, "action_expected_branch"),
			commitMessage: expandAttr(request.node, request.ctx, "action_commit_message"),
		}));
	}
}

class VerifyMergeResolutionAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(verifyConflictResolution({
			repo: expandAttr(request.node, request.ctx, "action_repo") || request.workDir,
			branch: expandAttr(request.node, request.ctx, "action_branch"),
			worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
			mergeWorktreeDir: expandAttr(request.node, request.ctx, "action_merge_worktree_dir"),
		}));
	}
}

class RunMergeIntegrationAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(runMergeIntegration({
			repo: expandAttr(request.node, request.ctx, "action_repo") || request.workDir,
			mergeWorktreeDir: expandAttr(request.node, request.ctx, "action_merge_worktree_dir"),
			worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
			integrationCommand: decodeBase64Attr(request.node, request.ctx, "action_integration_command_b64"),
		}));
	}
}

class CleanupMergeWorktreeAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(cleanupMergeWorktree({
			repo: expandAttr(request.node, request.ctx, "action_repo") || request.workDir,
			mergeWorktreeDir: expandAttr(request.node, request.ctx, "action_merge_worktree_dir"),
		}));
	}
}

class PushMainBranchAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(pushMainBranch({
			repo: expandAttr(request.node, request.ctx, "action_repo") || request.workDir,
			branch: expandAttr(request.node, request.ctx, "action_branch") || "main",
			remote: expandAttr(request.node, request.ctx, "action_remote") || "origin",
			mergeWorktreeDir: expandAttr(request.node, request.ctx, "action_merge_worktree_dir"),
			mergedHeadSha: expandAttr(request.node, request.ctx, "action_merged_head_sha"),
		}));
	}
}

class VerifyPushRecoveryAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(verifyPushRecovery({
			repo: expandAttr(request.node, request.ctx, "action_repo") || request.workDir,
			branch: expandAttr(request.node, request.ctx, "action_branch") || "main",
			remote: expandAttr(request.node, request.ctx, "action_remote") || "origin",
			mergeWorktreeDir: expandAttr(request.node, request.ctx, "action_merge_worktree_dir"),
		}));
	}
}

class EmitResolutionFailureAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(emitResolutionFailure({
			recurrenceKey: expandAttr(request.node, request.ctx, "action_recurrence_key"),
			resolutionNotes: expandAttr(request.node, request.ctx, "action_resolution_notes"),
			resolutionCheck: expandAttr(request.node, request.ctx, "action_resolution_check"),
			branch: expandAttr(request.node, request.ctx, "action_branch"),
			issue: expandAttr(request.node, request.ctx, "action_issue_number"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			runsDir: expandAttr(request.node, request.ctx, "action_runs_dir"),
		}));
	}
}

class BuildMergeReportAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(buildMergeReport({
			issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
			branch: expandAttr(request.node, request.ctx, "action_branch"),
			mergeStatus: expandAttr(request.node, request.ctx, "action_merge_status"),
			mergeResolver: expandAttr(request.node, request.ctx, "action_merge_resolver"),
			pathTaken: expandAttr(request.node, request.ctx, "action_path_taken"),
			notes: decodeBase64Attr(request.node, request.ctx, "action_notes_b64"),
			integrationResultRaw: expandAttr(request.node, request.ctx, "action_integration_result"),
		}));
	}
}

export function registerMergeActions(registry: ActionRegistry): void {
	registry.register("merge.extract_item", new ExtractMergeItemAction());
	registry.register("merge.acquire_lock", new AcquireMergeLockAction());
	registry.register("merge.assert_main_branch", new AssertMainBranchAction());
	registry.register("merge.assert_main_clean", new AssertMainCleanAction());
	registry.register("merge.build_commit_message", new BuildGoalMergeCommitMessageAction());
	registry.register("merge.setup_worktree", new SetupMergeWorktreeAction());
	registry.register("merge.resolve_context", new ResolveMergeContextAction());
	registry.register("merge.rebase_on_main", new RebaseOnMainAction());
	registry.register("merge.attempt_deterministic", new AttemptDeterministicMergeAction());
	registry.register("merge.build_conflict_packet", new BuildConflictPacketAction());
	registry.register("merge.emit_resolution_failure", new EmitResolutionFailureAction());
	registry.register("merge.finalize_commit", new FinalizeMergeCommitAction());
	registry.register("merge.push_main_branch", new PushMainBranchAction());
	registry.register("merge.release_lock", new ReleaseMergeLockAction());
	registry.register("merge.verify_push_recovery", new VerifyPushRecoveryAction());
	registry.register("merge.verify_resolution", new VerifyMergeResolutionAction());
	registry.register("merge.run_integration", new RunMergeIntegrationAction());
	registry.register("merge.cleanup_worktree", new CleanupMergeWorktreeAction());
	registry.register("merge.build_report", new BuildMergeReportAction());
}
