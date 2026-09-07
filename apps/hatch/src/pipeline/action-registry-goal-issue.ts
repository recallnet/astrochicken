import { StageStatus, type Context, type Outcome } from "./context.js";
import { expandVariables } from "./engine.js";
import type { Node } from "./graph.js";
import type { ActionExecutionRequest, ActionExecutor, ActionRegistry } from "./action-registry.js";
// @ts-ignore JS-owned coding capability action owners
import * as codingActionOwners from "../../../../packages/capability-coding/src/in-process-action-owners.mjs";
// @ts-ignore JS-owned merge capability action owners
import * as mergeActionOwners from "../../../../packages/capability-merge/src/in-process-action-owners.mjs";

const {
  buildApprovedImplResult,
  buildFailedImplResult,
  buildInfraFailureImplResult,
  buildWaveIssueImplResult,
  cleanupLegacyWorktree,
  decideExistingReuseWithNotes,
  emitReviewVerdictTelemetry,
  ensureWorktreeToolchain,
  estimateWaveIssueComplexity,
  fetchIssueBody,
  inspectExistingCommits,
  loadAgentGuidanceContext,
  resetStaleBranch,
  resolveExecutionMode,
  resolveMaxReviewAttemptsWithInit,
  sendReviewMessage,
  shouldRetryReview,
  verifyVisualRefinementEvidence,
} = codingActionOwners as {
  buildApprovedImplResult: (options?: Record<string, unknown>) => unknown;
  buildFailedImplResult: (options?: Record<string, unknown>) => unknown;
  buildInfraFailureImplResult: (options?: Record<string, unknown>) => unknown;
  buildWaveIssueImplResult: (options?: Record<string, unknown>) => unknown;
  cleanupLegacyWorktree: (options?: Record<string, unknown>) => unknown;
  decideExistingReuseWithNotes: (options?: Record<string, unknown>) => unknown;
  emitReviewVerdictTelemetry: (options?: Record<string, unknown>) => Promise<unknown>;
  ensureWorktreeToolchain: (options?: Record<string, unknown>) => unknown;
  estimateWaveIssueComplexity: (options?: Record<string, unknown>) => unknown;
  fetchIssueBody: (options?: Record<string, unknown>) => string;
  inspectExistingCommits: (options?: Record<string, unknown>) => unknown;
  loadAgentGuidanceContext: (options?: Record<string, unknown>) => unknown;
  resetStaleBranch: (options?: Record<string, unknown>) => unknown;
  resolveExecutionMode: (mode?: string) => string;
  resolveMaxReviewAttemptsWithInit: (maxRaw?: string) => unknown;
  sendReviewMessage: (options?: Record<string, unknown>) => unknown;
  shouldRetryReview: (options?: Record<string, unknown>) => string;
  verifyVisualRefinementEvidence: (options?: Record<string, unknown>) => unknown;
};

const {
  assertMainBranch,
} = mergeActionOwners as {
  assertMainBranch: (options?: Record<string, unknown>) => unknown;
};

function expandAttr(node: Node, ctx: Context, key: string): string {
  return expandVariables(String(node.attrs[key] || ""), ctx).trim();
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

class LoadAgentGuidanceContextAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(loadAgentGuidanceContext({
      repoRoot: expandAttr(request.node, request.ctx, "action_repo_root") || request.workDir,
      agentsPath: expandAttr(request.node, request.ctx, "action_agents_path"),
      agentLearningsPath: expandAttr(request.node, request.ctx, "action_agent_learnings_path"),
      agentsMaxChars: expandAttr(request.node, request.ctx, "action_agents_max_chars"),
      learningsMaxChars: expandAttr(request.node, request.ctx, "action_learnings_max_chars"),
      learningsEntryCount: expandAttr(request.node, request.ctx, "action_learnings_entry_count"),
    }));
  }
}

class SetIssueContextAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome({
      issue_number: expandAttr(request.node, request.ctx, "action_issue_number"),
      issue_title: expandAttr(request.node, request.ctx, "action_issue_title"),
    });
  }
}

class FetchIssueBodyAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return textOutcome(fetchIssueBody({
      repo: expandAttr(request.node, request.ctx, "action_repo"),
      issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
    }));
  }
}

class EstimateIssueComplexityAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(estimateWaveIssueComplexity({
      issueTitle: expandAttr(request.node, request.ctx, "action_issue_title"),
      issueBody: expandAttr(request.node, request.ctx, "action_issue_body"),
    }));
  }
}

class CleanupLegacyWorktreeAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(cleanupLegacyWorktree({
      repo: expandAttr(request.node, request.ctx, "action_repo"),
      legacyWorktreeDir: expandAttr(request.node, request.ctx, "action_legacy_worktree_dir"),
    }));
  }
}

class EnsureWorktreeToolchainAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(ensureWorktreeToolchain({
      repo: expandAttr(request.node, request.ctx, "action_repo"),
      worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
    }));
  }
}

class InspectExistingCommitsAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(inspectExistingCommits({
      worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
    }));
  }
}

class DecideExistingReuseWithNotesAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(decideExistingReuseWithNotes({
      branch: expandAttr(request.node, request.ctx, "action_branch"),
      existingCommits: expandAttr(request.node, request.ctx, "action_existing_commits"),
      issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
      worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
    }));
  }
}

class ResetStaleBranchAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(resetStaleBranch({
      worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
    }));
  }
}

class ResolveExecutionModeAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return textOutcome(resolveExecutionMode(expandAttr(request.node, request.ctx, "action_mode")));
  }
}

class BuildImplResultAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return textOutcome(JSON.stringify(buildWaveIssueImplResult({
      issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
      branch: expandAttr(request.node, request.ctx, "action_branch"),
      worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
      reviewFailed: expandAttr(request.node, request.ctx, "action_review_failed"),
      reviewNotes: expandAttr(request.node, request.ctx, "action_review_notes"),
      reviewEvidencePath: expandAttr(request.node, request.ctx, "action_review_evidence_path"),
      zeroDeltaRetry: expandAttr(request.node, request.ctx, "action_zero_delta_retry"),
      zeroDeltaRetryCount: expandAttr(request.node, request.ctx, "action_zero_delta_retry_count"),
      merged: expandAttr(request.node, request.ctx, "action_merged"),
    })));
  }
}

class ResolveMaxReviewAttemptsAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(resolveMaxReviewAttemptsWithInit(expandAttr(request.node, request.ctx, "action_max_review_attempts")));
  }
}

class AssertMainBranchAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(assertMainBranch({
      repo: expandAttr(request.node, request.ctx, "action_repo"),
    }));
  }
}

class VerifyVisualRefinementEvidenceAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return jsonOutcome(verifyVisualRefinementEvidence({
      repo: expandAttr(request.node, request.ctx, "action_repo"),
      issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
      reviewContextPath: expandAttr(request.node, request.ctx, "action_review_context_path"),
      reviewEvidencePath: expandAttr(request.node, request.ctx, "action_review_evidence_path"),
      reviewContextGatePass: expandAttr(request.node, request.ctx, "action_review_context_gate_pass"),
      reviewContextGateCode: expandAttr(request.node, request.ctx, "action_review_context_gate_code"),
      scenarioRoot: expandAttr(request.node, request.ctx, "action_scenario_root"),
      factoryRoot: expandAttr(request.node, request.ctx, "action_factory_root"),
    }));
  }
}

class EmitReviewVerdictTelemetryAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    const issueLabelsRaw = expandAttr(request.node, request.ctx, "action_issue_labels");
    const issueLabels = issueLabelsRaw
      ? issueLabelsRaw.split(",").map((entry) => entry.trim()).filter(Boolean)
      : [];
    return textOutcome(JSON.stringify(await emitReviewVerdictTelemetry({
      factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
      runId: expandAttr(request.node, request.ctx, "action_run_id"),
      issueNumber: Number(expandAttr(request.node, request.ctx, "action_issue_number")),
      milestone: expandAttr(request.node, request.ctx, "action_milestone"),
      verdictRaw: expandAttr(request.node, request.ctx, "action_verdict"),
      retryAttempt: Number(expandAttr(request.node, request.ctx, "action_retry_attempt") || 0),
      maxReviewAttempts: Number(expandAttr(request.node, request.ctx, "action_max_review_attempts") || 0),
      issueLabels,
      runsDir: expandAttr(request.node, request.ctx, "action_runs_dir"),
    })));
  }
}

class ShouldRetryReviewAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return textOutcome(shouldRetryReview({
      reviewVerdict: expandAttr(request.node, request.ctx, "action_review_verdict"),
      attempt: expandAttr(request.node, request.ctx, "action_attempt"),
      maxAttempts: expandAttr(request.node, request.ctx, "action_max_attempts"),
    }));
  }
}

class SendReviewMessageAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return textOutcome(JSON.stringify(sendReviewMessage({
      verdictRaw: expandAttr(request.node, request.ctx, "action_verdict"),
      issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
      issueTitle: expandAttr(request.node, request.ctx, "action_issue_title"),
      agentSessionId: expandAttr(request.node, request.ctx, "action_agent_session_id"),
    })));
  }
}

class BuildFailedResultAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return textOutcome(JSON.stringify(buildFailedImplResult({
      issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
      branch: expandAttr(request.node, request.ctx, "action_branch"),
      worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
      reviewAttempt: expandAttr(request.node, request.ctx, "action_review_attempt"),
      maxReviewAttempts: expandAttr(request.node, request.ctx, "action_max_review_attempts"),
      reviewNotes: expandAttr(request.node, request.ctx, "action_review_notes"),
      reviewEvidencePath: expandAttr(request.node, request.ctx, "action_review_evidence_path"),
      zeroDeltaRetry: expandAttr(request.node, request.ctx, "action_zero_delta_retry"),
      zeroDeltaRetryCount: expandAttr(request.node, request.ctx, "action_zero_delta_retry_count"),
    })));
  }
}

class BuildApprovedResultAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return textOutcome(JSON.stringify(buildApprovedImplResult({
      issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
      branch: expandAttr(request.node, request.ctx, "action_branch"),
      worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
      reviewAttempt: expandAttr(request.node, request.ctx, "action_review_attempt"),
      maxReviewAttempts: expandAttr(request.node, request.ctx, "action_max_review_attempts"),
      reviewNotes: expandAttr(request.node, request.ctx, "action_review_notes"),
      reviewEvidencePath: expandAttr(request.node, request.ctx, "action_review_evidence_path"),
      zeroDeltaRetry: expandAttr(request.node, request.ctx, "action_zero_delta_retry"),
      zeroDeltaRetryCount: expandAttr(request.node, request.ctx, "action_zero_delta_retry_count"),
    })));
  }
}

class BuildInfraFailureResultAction implements ActionExecutor {
  async execute(request: ActionExecutionRequest): Promise<Outcome> {
    return textOutcome(JSON.stringify(buildInfraFailureImplResult({
      issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
      branch: expandAttr(request.node, request.ctx, "action_branch"),
      worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
      reason: expandAttr(request.node, request.ctx, "action_reason"),
    })));
  }
}

export function registerGoalIssueActions(registry: ActionRegistry): void {
  registry.register("common.load_agent_guidance_context", new LoadAgentGuidanceContextAction());
  registry.register("merge.assert_main_branch", new AssertMainBranchAction());
  registry.register("coding.set_issue_context", new SetIssueContextAction());
  registry.register("coding.fetch_issue_body", new FetchIssueBodyAction());
  registry.register("coding.estimate_issue_complexity", new EstimateIssueComplexityAction());
  registry.register("coding.cleanup_legacy_worktree", new CleanupLegacyWorktreeAction());
  registry.register("coding.ensure_worktree_toolchain", new EnsureWorktreeToolchainAction());
  registry.register("coding.inspect_existing_commits", new InspectExistingCommitsAction());
  registry.register("coding.decide_existing_reuse_with_notes", new DecideExistingReuseWithNotesAction());
  registry.register("coding.reset_stale_branch", new ResetStaleBranchAction());
  registry.register("coding.resolve_execution_mode", new ResolveExecutionModeAction());
  registry.register("coding.build_impl_result", new BuildImplResultAction());
  registry.register("coding.resolve_max_review_attempts", new ResolveMaxReviewAttemptsAction());
  registry.register("coding.verify_visual_refinement_evidence", new VerifyVisualRefinementEvidenceAction());
  registry.register("coding.emit_review_verdict_telemetry", new EmitReviewVerdictTelemetryAction());
  registry.register("coding.should_retry_review", new ShouldRetryReviewAction());
  registry.register("coding.send_review_message", new SendReviewMessageAction());
  registry.register("coding.build_failed_result", new BuildFailedResultAction());
  registry.register("coding.build_approved_result", new BuildApprovedResultAction());
  registry.register("coding.build_infra_failure_result", new BuildInfraFailureResultAction());
}
