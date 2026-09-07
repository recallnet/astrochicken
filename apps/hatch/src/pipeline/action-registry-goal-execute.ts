import { StageStatus, type Context, type Outcome } from "./context.js";
import { expandVariables } from "./engine.js";
import type { Node } from "./graph.js";
import type { ActionExecutionRequest, ActionExecutor, ActionRegistry } from "./action-registry.js";
// @ts-ignore JS-owned software-development capability action owners
import * as softwareActionOwners from "../../../../packages/capability-software-development/src/in-process-action-owners.mjs";
// @ts-ignore JS-owned coding capability action owners
import * as codingActionOwners from "../../../../packages/capability-coding/src/in-process-action-owners.mjs";

const {
  accumulateMilestoneResult,
  analyzeGiveUp,
  buildExecutionPlanFromGoal,
  buildWaveMergeResults,
  checkMergeCandidates,
  closeMergedIssues,
  commentMergeFailures,
  commentReviewFailures,
  emptyGoalBranchContext,
  fallbackJudgeDecision,
  pickPlanIssue,
  reconcileGoalFinalState,
  resolveGoalExecutionPath,
  seedGoalState,
  splitWaveImplResultsFromSources,
} = softwareActionOwners as {
  accumulateMilestoneResult: (options?: Record<string, unknown>) => unknown;
  analyzeGiveUp: (options?: Record<string, unknown>) => unknown;
  buildExecutionPlanFromGoal: (options?: Record<string, unknown>) => unknown;
  buildWaveMergeResults: (options?: Record<string, unknown>) => unknown;
  checkMergeCandidates: (raw?: string) => unknown;
  closeMergedIssues: (options?: Record<string, unknown>) => unknown;
  commentMergeFailures: (options?: Record<string, unknown>) => unknown;
  commentReviewFailures: (options?: Record<string, unknown>) => unknown;
  emptyGoalBranchContext: (options?: Record<string, unknown>) => unknown;
  fallbackJudgeDecision: (options?: Record<string, unknown>) => unknown;
  pickPlanIssue: (options?: Record<string, unknown>) => unknown;
  reconcileGoalFinalState: (options?: Record<string, unknown>) => Promise<unknown>;
  resolveGoalExecutionPath: (options?: Record<string, unknown>) => unknown;
  seedGoalState: (options?: Record<string, unknown>) => unknown;
  splitWaveImplResultsFromSources: (options?: Record<string, unknown>) => unknown;
};

const {
  cleanupWaveIssueWorktree,
} = codingActionOwners as {
  cleanupWaveIssueWorktree: (options?: Record<string, unknown>) => unknown;
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

function textOutcome(value: string, contextUpdates: Record<string, string> = {}): Outcome {
  return {
    status: StageStatus.Completed,
    output: value,
    contextUpdates,
  };
}

class SeedGoalStateAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(seedGoalState({
      repo: expandAttr(request.node, request.ctx, "action_repo"),
      goalNumber: expandAttr(request.node, request.ctx, "action_goal_number"),
      runsDir: expandAttr(request.node, request.ctx, "action_runs_dir"),
    }));
  }
}

class ResolveGoalExecutionPathAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(resolveGoalExecutionPath({
      repo: expandAttr(request.node, request.ctx, "action_repo"),
      goalIssueNumber: expandAttr(request.node, request.ctx, "action_goal_issue_number"),
      factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
      goalExecutionPathsRaw: expandAttr(request.node, request.ctx, "action_goal_execution_paths"),
    }));
  }
}

class EmptyGoalBranchContextAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(emptyGoalBranchContext({
      goalNumber: expandAttr(request.node, request.ctx, "action_goal_number"),
    }));
  }
}

class BuildGoalExecutionPlanAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(buildExecutionPlanFromGoal({
      repo: expandAttr(request.node, request.ctx, "action_repo"),
      goalNumber: expandAttr(request.node, request.ctx, "action_goal_number"),
      completedIssues: JSON.parse(expandAttr(request.node, request.ctx, "action_completed_issues") || "[]"),
      directExecution: expandAttr(request.node, request.ctx, "action_direct_execution"),
      directExecutionPath: expandAttr(request.node, request.ctx, "action_direct_execution_path"),
      goalRoutingState: expandAttr(request.node, request.ctx, "action_goal_routing_state"),
      goalExecutionPathVersion: expandAttr(request.node, request.ctx, "action_goal_execution_path_version"),
      goalExecutionPathPacketId: expandAttr(request.node, request.ctx, "action_goal_execution_path_packet_id"),
    }));
  }
}

class PickGoalPlanIssueAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(pickPlanIssue({
      executionPlanRaw: expandAttr(request.node, request.ctx, "action_execution_plan"),
      planIndex: Number(expandAttr(request.node, request.ctx, "action_plan_index") || 0),
    }));
  }
}

class AdvancePlanIndexAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    const idx = Number.parseInt(expandAttr(request.node, request.ctx, "action_plan_index") || "0", 10) || 0;
    return textOutcome(String(idx + 1), { plan_index: String(idx + 1) });
  }
}

class AccumulateGoalResultAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(accumulateMilestoneResult({
      implResultsRaw: expandAttr(request.node, request.ctx, "action_impl_results"),
      completedRaw: expandAttr(request.node, request.ctx, "action_completed"),
      processedRaw: expandAttr(request.node, request.ctx, "action_processed"),
      itemRaw: expandAttr(request.node, request.ctx, "action_item"),
      fallbackIssueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
      fallbackIssueTitle: expandAttr(request.node, request.ctx, "action_issue_title"),
      consecutiveFailCountRaw: expandAttr(request.node, request.ctx, "action_consecutive_fail_count"),
    }));
  }
}

class GoalPostmortemAction implements ActionExecutor {
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

class SplitGoalResultsAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(splitWaveImplResultsFromSources({
      runId: "",
      runsDir: expandAttr(request.node, request.ctx, "action_runs_dir") || ".hatch/runs",
      fallbackRaw: expandAttr(request.node, request.ctx, "action_fallback"),
    }));
  }
}

class HandleGoalReviewFailuresAction implements ActionExecutor {
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

class CheckMergeCandidatesAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(checkMergeCandidates(expandAttr(request.node, request.ctx, "action_merge_candidates")));
  }
}

class BuildGoalMergeResultsAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(buildWaveMergeResults({
      mergeCandidatesRaw: expandAttr(request.node, request.ctx, "action_merge_candidates"),
      mergeStatus: expandAttr(request.node, request.ctx, "action_merge_status"),
      mergeNotes: decodeBase64Attr(request.node, request.ctx, "action_merge_notes_b64")
        || expandAttr(request.node, request.ctx, "action_merge_notes"),
      mergeResolver: expandAttr(request.node, request.ctx, "action_merge_resolver"),
      pathTaken: expandAttr(request.node, request.ctx, "action_path_taken"),
      pushStatus: expandAttr(request.node, request.ctx, "action_push_status"),
      repo: expandAttr(request.node, request.ctx, "action_repo"),
      factoryId: expandAttr(request.node, request.ctx, "action_factory_id") || String(request.ctx.get("factory_id") || ""),
      runId: expandAttr(request.node, request.ctx, "action_run_id") || String(request.ctx.get("__run_id") || ""),
    }));
  }
}

class HandleGoalMergeFailuresAction implements ActionExecutor {
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

class CloseMergedIssuesAction implements ActionExecutor {
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

class FallbackJudgeAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(fallbackJudgeDecision({
      verdictRaw: expandAttr(request.node, request.ctx, "action_verdict"),
      error: expandAttr(request.node, request.ctx, "action_error"),
      factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
      runId: expandAttr(request.node, request.ctx, "action_run_id") || String(request.ctx.get("__run_id") || ""),
      workflowId: expandAttr(request.node, request.ctx, "action_pipeline") || "goal_execute",
      capabilityId: "goal_execution",
    }));
  }
}

class ReconcileGoalFinalStateAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(await reconcileGoalFinalState({
      repo: expandAttr(request.node, request.ctx, "action_repo"),
      goalNumber: expandAttr(request.node, request.ctx, "action_goal_number"),
      mode: expandAttr(request.node, request.ctx, "action_mode"),
      directGoalResult: expandAttr(request.node, request.ctx, "action_direct_goal_result"),
      directGoalOutcomeNotes: expandAttr(request.node, request.ctx, "action_direct_goal_outcome_notes"),
      runId: expandAttr(request.node, request.ctx, "action_run_id"),
      runsDir: expandAttr(request.node, request.ctx, "action_runs_dir"),
    }));
  }
}

class CleanupGoalWorktreeAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(cleanupWaveIssueWorktree({
      repo: expandAttr(request.node, request.ctx, "action_repo"),
      worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
    }));
  }
}

export function registerGoalExecuteActions(registry: ActionRegistry): void {
  registry.register("software.seed_goal_state", new SeedGoalStateAction());
  registry.register("software.resolve_goal_execution_path", new ResolveGoalExecutionPathAction());
  registry.register("software.empty_goal_branch_context", new EmptyGoalBranchContextAction());
  registry.register("software.build_goal_execution_plan", new BuildGoalExecutionPlanAction());
  registry.register("software.pick_goal_plan_issue", new PickGoalPlanIssueAction());
  registry.register("software.advance_plan_index", new AdvancePlanIndexAction());
  registry.register("software.accumulate_goal_result", new AccumulateGoalResultAction());
  registry.register("software.goal_postmortem", new GoalPostmortemAction());
  registry.register("software.split_goal_results", new SplitGoalResultsAction());
  registry.register("software.handle_goal_review_failures", new HandleGoalReviewFailuresAction());
  registry.register("software.check_merge_candidates", new CheckMergeCandidatesAction());
  registry.register("software.build_goal_merge_results", new BuildGoalMergeResultsAction());
  registry.register("software.handle_goal_merge_failures", new HandleGoalMergeFailuresAction());
  registry.register("software.close_merged_issues", new CloseMergedIssuesAction());
  registry.register("software.fallback_judge", new FallbackJudgeAction());
  registry.register("software.reconcile_goal_final_state", new ReconcileGoalFinalStateAction());
  registry.register("coding.cleanup_wave_issue_worktree", new CleanupGoalWorktreeAction());
}
