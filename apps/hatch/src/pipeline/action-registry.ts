import { StageStatus, type Context, type Outcome } from "./context.js";
import { expandVariables } from "./engine.js";
import { buildGitHubMutationContext } from "./github-mutation-context.js";
import { registerMergeActions } from "./action-registry-merge.js";
import { registerBrainstormActions } from "./action-registry-brainstorm.js";
import { registerScenarioActions } from "./action-registry-scenarios.js";
import { registerDailyLensActions } from "./action-registry-daily-lens.js";
import { registerGoalExecuteActions } from "./action-registry-goal-execute.js";
import { registerGoalIssueActions } from "./action-registry-goal-issue.js";
import { registerGoalRunActions } from "./action-registry-goal-run.js";
import { registerSupervisorActions } from "./action-registry-supervisor.js";
import { registerWaveDispatchActions } from "./action-registry-wave-dispatch.js";
import { registerWaveExecuteActions } from "./action-registry-wave-execute.js";
// @ts-ignore JS-owned goal decomposition capability action owners
import * as goalDecompositionActionOwners from "../../../../packages/capability-goal-decomposition/src/in-process-action-owners.mjs";
// @ts-ignore JS-owned release capability action owners
import * as releaseActionOwners from "../../../../packages/capability-release-reporting/src/in-process-action-owners.mjs";
// @ts-ignore JS-owned product judge capability action owners
import * as productJudgeActionOwners from "../../../../packages/capability-product-judge/src/in-process-action-owners.mjs";
// @ts-ignore JS-owned artifact-ingestion capability action owners
import * as artifactIngestionActionOwners from "../../../../packages/capability-artifact-ingestion/src/in-process-action-owners.mjs";
// @ts-ignore JS-owned coding capability action owners
import * as codingActionOwners from "../../../../packages/capability-coding/src/in-process-action-owners.mjs";
// @ts-ignore JS-owned software-development capability action owners
import * as softwareDevelopmentActionOwners from "../../../../packages/capability-software-development/src/in-process-action-owners.mjs";
// @ts-ignore JS-owned shared issue-url normalization owner
import { normalizeIssueUrlArray } from "@hatch/factory-core/issue-url-normalization";
// @ts-ignore JS-owned OCI artifact publication
import { publishOciArtifact } from "@hatch/factory-core/oci-artifact-registry";

import type { Node } from "./graph.js";
const {
	addSubIssue,
	attachPlanningArtifacts,
	applyGoalDecisions,
	autoReadyArtifactGoals,
	buildRetrySignal,
	countFeatureObjects,
	countJsonItems,
	createGitHubIssueFromSpec,
	decomposeAutoApproveDecision,
	emitAndPersistFallbackDefectSignal,
	fallbackFeaturePair,
	fallbackIssueSpecBundle,
	filterKeptGoals,
	incrementCounter,
	inspectJson,
	inspectJsonPair,
	listReadyGoals,
	markGoalPlanned,
	normalizeApproved,
	normalizeApprovedFeatures,
	normalizeDecision,
	normalizeIssueLabels,
	normalizeFeatureIssueSpecBundle,
	parseExternalBugReport,
	persistHardPlanningArtifact,
	resolveCapabilityCodingSkillsPath,
	resolveCapabilityGoalDecompositionSkillsPath,
	resolveCapabilityMergeSkillsPath,
	resolveFactoryConfigValue,
	resolveDefault,
	resolveGhRepo,
	resolveBoolean,
	resolveIntentStack,
	sanitizeGoalDuplicates,
	sanitizeGovernanceOverlap,
	shouldSkipGoalReview,
	updateGitHubIssueFromSpec,
	validateApprovedFeatures,
	validateGoalIntakeEligibility,
	validateGoalDecisions,
	validateIssueSpecDraft,
	validatePlanningArtifact,
} = goalDecompositionActionOwners as {
	addSubIssue: (options?: Record<string, unknown>) => unknown;
	attachPlanningArtifacts: (options?: Record<string, unknown>) => unknown;
	applyGoalDecisions: (options?: Record<string, unknown>) => unknown;
	autoReadyArtifactGoals: (options?: Record<string, unknown>) => unknown;
	buildRetrySignal: (options?: Record<string, unknown>) => string;
	countFeatureObjects: (raw?: string) => string;
	countJsonItems: (raw?: string) => string;
	createGitHubIssueFromSpec: (options?: Record<string, unknown>) => unknown;
	decomposeAutoApproveDecision: (options?: Record<string, unknown>) => unknown;
	emitAndPersistFallbackDefectSignal: (options?: Record<string, unknown>) => unknown;
	fallbackFeaturePair: (options?: Record<string, unknown>) => string;
	fallbackIssueSpecBundle: (issueSpecRaw?: string, featureRaw?: string) => string;
	filterKeptGoals: (options?: Record<string, unknown>) => unknown;
	incrementCounter: (value?: string) => string;
	inspectJson: (raw?: string, filePath?: string) => string;
	inspectJsonPair: (primaryRaw?: string, secondaryRaw?: string) => string;
	listReadyGoals: (options?: Record<string, unknown>) => unknown;
	markGoalPlanned: (options?: Record<string, unknown>) => unknown;
	normalizeApproved: (value?: string) => string;
	normalizeApprovedFeatures: (options?: Record<string, unknown>) => string;
	normalizeDecision: (value?: string) => string;
	normalizeIssueLabels: (options?: Record<string, unknown>) => Promise<unknown>;
	normalizeFeatureIssueSpecBundle: (issueSpecRaw?: string, featureRaw?: string) => string;
	parseExternalBugReport: (options?: Record<string, unknown>) => unknown;
	persistHardPlanningArtifact: (options?: Record<string, unknown>) => unknown;
	resolveCapabilityCodingSkillsPath: (options?: Record<string, unknown>) => string;
	resolveCapabilityGoalDecompositionSkillsPath: (options?: Record<string, unknown>) => string;
	resolveCapabilityMergeSkillsPath: (options?: Record<string, unknown>) => string;
	resolveFactoryConfigValue: (options?: Record<string, unknown>) => string;
	resolveDefault: (value?: string, fallback?: string) => string;
	resolveGhRepo: (raw?: string, options?: Record<string, unknown>) => string;
	resolveBoolean: (value?: string, fallback?: boolean) => string;
	resolveIntentStack: (options?: Record<string, unknown>) => unknown;
	sanitizeGoalDuplicates: (options?: Record<string, unknown>) => unknown;
	sanitizeGovernanceOverlap: (options?: Record<string, unknown>) => unknown;
	shouldSkipGoalReview: (options?: Record<string, unknown>) => unknown;
	updateGitHubIssueFromSpec: (options?: Record<string, unknown>) => unknown;
	validateApprovedFeatures: (options?: Record<string, unknown>) => string;
	validateGoalIntakeEligibility: (options?: Record<string, unknown>) => string;
	validateGoalDecisions: (options?: Record<string, unknown>) => unknown;
	validateIssueSpecDraft: (issueSpecRaw?: string, featureRaw?: string) => string;
	validatePlanningArtifact: (options?: Record<string, unknown>) => unknown;
};
const {
	buildAndPersistJudgeContextContract,
	buildAndPersistJudgeEvidenceContract,
	buildJudgeRecoveryPacket,
	openJudgeFollowupArtifact,
	validateJudgeContextCompleteness,
	validateJudgeEvidenceCompleteness,
} = productJudgeActionOwners as {
	buildAndPersistJudgeContextContract: (options?: Record<string, unknown>) => unknown;
	buildAndPersistJudgeEvidenceContract: (options?: Record<string, unknown>) => unknown;
	buildJudgeRecoveryPacket: (options?: Record<string, unknown>) => unknown;
	openJudgeFollowupArtifact: (options?: Record<string, unknown>) => unknown;
	validateJudgeContextCompleteness: (options?: Record<string, unknown>) => unknown;
	validateJudgeEvidenceCompleteness: (options?: Record<string, unknown>) => unknown;
};
const {
	ingestArtifactIssues,
} = artifactIngestionActionOwners as {
	ingestArtifactIssues: (options?: Record<string, unknown>) => Promise<unknown>;
};
const {
	buildAndPersistReviewerContextContract,
	commitLocalIssueWorktree,
	extractIssueItem,
	initReviewAttempt,
	initWaveIssueWorktree,
	inspectBranchChanges,
	nextReviewAttempt,
	resolveGoalNumberFromMilestoneTitle,
	resolveReviewRoute,
	setupWaveIssueWorktree,
	snapshotBranchHead,
	validateReviewContextCompleteness,
	writeReviewEvidence,
} = codingActionOwners as {
	buildAndPersistReviewerContextContract: (options?: Record<string, unknown>) => unknown;
	commitLocalIssueWorktree: (options?: Record<string, unknown>) => string;
	extractIssueItem: (raw?: string) => unknown;
	initReviewAttempt: () => string;
	initWaveIssueWorktree: (options?: Record<string, unknown>) => unknown;
	inspectBranchChanges: (options?: Record<string, unknown>) => unknown;
	nextReviewAttempt: (attemptRaw?: string) => string;
	resolveGoalNumberFromMilestoneTitle: (title?: string) => string;
	resolveReviewRoute: (options?: Record<string, unknown>) => unknown;
	setupWaveIssueWorktree: (options?: Record<string, unknown>) => unknown;
	snapshotBranchHead: (options?: Record<string, unknown>) => unknown;
	validateReviewContextCompleteness: (options?: Record<string, unknown>) => unknown;
	writeReviewEvidence: (options?: Record<string, unknown>) => unknown;
};
const {
	fetchGoalIssue,
	listExecutableGoals,
	resolveWaveConfig,
} = softwareDevelopmentActionOwners as {
	fetchGoalIssue: (options?: Record<string, unknown>) => unknown;
	listExecutableGoals: (options?: Record<string, unknown>) => unknown;
	resolveWaveConfig: (options?: Record<string, unknown>) => unknown;
};
const {
	buildReleaseReportContext,
	buildReleaseSlackBlocksPayload,
	emitReleaseNarrativeDocument,
	postReleaseToSlack,
	publishReleaseReportIssue,
	runReleaseShapingFollowup,
	updateReleaseDedupCursorFromDelivery,
	updateTickIdleCursor,
} = releaseActionOwners as {
	buildReleaseReportContext: (options?: Record<string, unknown>) => Promise<unknown>;
	buildReleaseSlackBlocksPayload: (options?: Record<string, unknown>) => unknown;
	emitReleaseNarrativeDocument: (options?: Record<string, unknown>) => Promise<unknown>;
	postReleaseToSlack: (options?: Record<string, unknown>) => Promise<unknown>;
	publishReleaseReportIssue: (options?: Record<string, unknown>) => unknown;
	runReleaseShapingFollowup: (options?: Record<string, unknown>) => Promise<unknown>;
	updateReleaseDedupCursorFromDelivery: (options?: Record<string, unknown>) => unknown;
	updateTickIdleCursor: (options?: Record<string, unknown>) => unknown;
};

export interface ActionExecutionRequest {
	signal: AbortSignal;
	node: Node;
	ctx: Context;
	input: string;
	workDir: string;
	env: Record<string, string>;
}

export interface ActionExecutor {
	execute(request: ActionExecutionRequest): Promise<Outcome>;
}

export class ActionRegistry {
	private actions = new Map<string, ActionExecutor>();

	register(actionId: string, action: ActionExecutor): void {
		this.actions.set(actionId, action);
	}

	get(actionId: string): ActionExecutor | undefined {
		return this.actions.get(actionId);
	}
}

function expandAttr(node: Node, ctx: Context, key: string): string {
	return expandVariables(String(node.attrs[key] || ""), ctx).trim();
}

function parseJsonAttr(node: Node, ctx: Context, key: string, fallback: unknown = {}) { const raw = expandAttr(node, ctx, key); return raw ? JSON.parse(raw) : fallback; }
function decodeBase64Attr(node: Node, ctx: Context, key: string) { const raw = expandAttr(node, ctx, key); return raw ? Buffer.from(raw, "base64").toString("utf8") : ""; }

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

class ContextCaptureAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const actionKey = String(request.node.attrs["action_key"] || "").trim();
		if (!actionKey) {
			throw new Error(`action "${String(request.node.attrs["action_id"] || "")}" requires action_key`);
		}

		const actionValue = String(request.node.attrs["action_value"] || "");
		const value = actionValue || request.input;
		return textOutcome(value, { [actionKey]: value });
	}
}

class EncodeBase64Action implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const raw = expandAttr(request.node, request.ctx, "action_value") || request.input;
		return textOutcome(Buffer.from(raw, "utf8").toString("base64"));
	}
}

class CountJsonItemsAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const raw = decodeBase64Attr(request.node, request.ctx, "action_raw_b64")
			|| expandAttr(request.node, request.ctx, "action_raw")
			|| request.input;
		return textOutcome(countJsonItems(raw));
	}
}

class CountFeatureObjectsAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const raw = decodeBase64Attr(request.node, request.ctx, "action_raw_b64")
			|| expandAttr(request.node, request.ctx, "action_raw")
			|| request.input;
		return textOutcome(countFeatureObjects(raw));
	}
}

class ResolveDefaultAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const value = expandAttr(request.node, request.ctx, "action_value");
		const fallback = expandAttr(request.node, request.ctx, "action_fallback");
		return textOutcome(resolveDefault(value, fallback));
	}
}

class ResolveBooleanAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const value = expandAttr(request.node, request.ctx, "action_value");
		const fallback = expandAttr(request.node, request.ctx, "action_fallback");
		return textOutcome(resolveBoolean(value, fallback === "true"));
	}
}

class ResolveFactoryConfigAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(resolveFactoryConfigValue({
			key: expandAttr(request.node, request.ctx, "action_key"),
			fallback: expandAttr(request.node, request.ctx, "action_fallback"),
			configPath: expandAttr(request.node, request.ctx, "action_config_path")
				|| (expandAttr(request.node, request.ctx, "action_factory_root")
					? `${expandAttr(request.node, request.ctx, "action_factory_root")}/factory.config.json`
					: ""),
			env: request.env,
		}));
	}
}

class ResolveGhRepoAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(resolveGhRepo(expandAttr(request.node, request.ctx, "action_gh_repo"), {
			cwd: request.workDir,
			processEnv: request.env,
		}));
	}
}

class ResolveCapabilityCodingSkillsPathAction implements ActionExecutor {
	async execute(): Promise<Outcome> {
		return textOutcome(resolveCapabilityCodingSkillsPath());
	}
}

class ResolveCapabilityMergeSkillsPathAction implements ActionExecutor {
	async execute(): Promise<Outcome> {
		return textOutcome(resolveCapabilityMergeSkillsPath());
	}
}

class ResolveCapabilityGoalDecompositionSkillsPathAction implements ActionExecutor {
	async execute(): Promise<Outcome> {
		return textOutcome(resolveCapabilityGoalDecompositionSkillsPath());
	}
}

class NormalizeIssueUrlsAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const raw = expandAttr(request.node, request.ctx, "action_value") || request.input;
		return textOutcome(normalizeIssueUrlArray(raw || "[]"));
	}
}

class ResolveIntentStackAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const result = resolveIntentStack({
			factoryRoot: expandAttr(request.node, request.ctx, "action_factory_root"),
			configPath: expandAttr(request.node, request.ctx, "action_config_path"),
			platformIntentPath: expandAttr(request.node, request.ctx, "action_platform_intent_path"),
			factoryIntentPath: expandAttr(request.node, request.ctx, "action_factory_intent_path"),
			workIntent: expandAttr(request.node, request.ctx, "action_work_intent"),
		});
		return textOutcome(JSON.stringify(result));
	}
}

class NormalizeApprovedAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(normalizeApproved(expandAttr(request.node, request.ctx, "action_value") || request.input));
	}
}

class IncrementCounterAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(incrementCounter(expandAttr(request.node, request.ctx, "action_value") || request.input));
	}
}

class BuildRetrySignalAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(buildRetrySignal({
			decomposeParseStatus: expandAttr(request.node, request.ctx, "action_decompose_parse_status"),
			decomposeParseError: expandAttr(request.node, request.ctx, "action_decompose_parse_error"),
			decomposeAttempts: expandAttr(request.node, request.ctx, "action_decompose_attempts"),
		}));
	}
}

class InspectJsonAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(JSON.parse(inspectJson(
			expandAttr(request.node, request.ctx, "action_raw"),
			expandAttr(request.node, request.ctx, "action_file_path"),
		)));
	}
}

class InspectJsonPairAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(JSON.parse(inspectJsonPair(
			expandAttr(request.node, request.ctx, "action_primary"),
			expandAttr(request.node, request.ctx, "action_secondary"),
		)));
	}
}

class FallbackIssueSpecBundleAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(
			fallbackIssueSpecBundle(
				expandAttr(request.node, request.ctx, "action_issue_spec"),
				expandAttr(request.node, request.ctx, "action_feature"),
			),
		);
	}
}

class NormalizeFeatureIssueSpecBundleAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(
			normalizeFeatureIssueSpecBundle(
				decodeBase64Attr(request.node, request.ctx, "action_issue_spec_b64"),
				expandAttr(request.node, request.ctx, "action_feature"),
			),
		);
	}
}

class ValidateIssueSpecDraftAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(
			validateIssueSpecDraft(
				expandAttr(request.node, request.ctx, "action_issue_spec"),
				expandAttr(request.node, request.ctx, "action_feature"),
			),
		);
	}
}

class CreateIssueAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const factoryId = expandAttr(request.node, request.ctx, "action_factory_id") || String(request.ctx.get("factory_id") || "");
		const runId = expandAttr(request.node, request.ctx, "action_run_id") || String(request.ctx.get("__run_id") || "");
		return jsonOutcome(
			createGitHubIssueFromSpec({
				repo: expandAttr(request.node, request.ctx, "action_repo"),
				issueSpecRaw: decodeBase64Attr(request.node, request.ctx, "action_issue_spec_b64"),
				factoryId,
				runId,
				mutationContext: buildGitHubMutationContext(request, { factoryId, runId }),
				repoRoot: request.workDir,
			}),
		);
	}
}

class UpdateIssueAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const factoryId = expandAttr(request.node, request.ctx, "action_factory_id") || String(request.ctx.get("factory_id") || "");
		const runId = expandAttr(request.node, request.ctx, "action_run_id") || String(request.ctx.get("__run_id") || "");
		return jsonOutcome(
			updateGitHubIssueFromSpec({
				repo: expandAttr(request.node, request.ctx, "action_repo"),
				issueUrl: expandAttr(request.node, request.ctx, "action_issue_url"),
				issueSpecRaw: decodeBase64Attr(request.node, request.ctx, "action_issue_spec_b64"),
				factoryId,
				runId,
				mutationContext: buildGitHubMutationContext(request, { factoryId, runId }),
			}),
		);
	}
}

class AddSubIssueAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const factoryId = expandAttr(request.node, request.ctx, "action_factory_id") || String(request.ctx.get("factory_id") || "");
		const runId = expandAttr(request.node, request.ctx, "action_run_id") || String(request.ctx.get("__run_id") || "");
		return jsonOutcome(
			addSubIssue({
				repo: expandAttr(request.node, request.ctx, "action_repo"),
				parentNumber: expandAttr(request.node, request.ctx, "action_parent"),
				childNumber: expandAttr(request.node, request.ctx, "action_child"),
				factoryId,
				runId,
				mutationContext: buildGitHubMutationContext(request, { factoryId, runId }),
				repoRoot: request.workDir,
			}),
		);
	}
}

class FetchGoalIssueAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(fetchGoalIssue({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			goalNumber: expandAttr(request.node, request.ctx, "action_goal_number"),
		}));
	}
}

class ExtractIssueItemAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(extractIssueItem(expandAttr(request.node, request.ctx, "action_issue_item") || request.input));
	}
}

class ResolveGoalNumberFromMilestoneAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(resolveGoalNumberFromMilestoneTitle(expandAttr(request.node, request.ctx, "action_milestone_title") || request.input));
	}
}

class InitWaveIssueWorktreeAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(initWaveIssueWorktree({
			issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
			repo: expandAttr(request.node, request.ctx, "action_repo") || request.workDir,
			branch: expandAttr(request.node, request.ctx, "action_branch"),
			worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
			agentSessionId: expandAttr(request.node, request.ctx, "action_agent_session_id"),
		}));
	}
}

class SetupWaveIssueWorktreeAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(setupWaveIssueWorktree({
			repo: expandAttr(request.node, request.ctx, "action_repo") || request.workDir,
			branch: expandAttr(request.node, request.ctx, "action_branch"),
			worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
		}));
	}
}

class InitReviewAttemptAction implements ActionExecutor {
	async execute(): Promise<Outcome> {
		return textOutcome(initReviewAttempt());
	}
}

class NextReviewAttemptAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(nextReviewAttempt(expandAttr(request.node, request.ctx, "action_attempt") || request.input));
	}
}

class SnapshotBranchHeadAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(snapshotBranchHead({
			worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
			existingSnapshot: expandAttr(request.node, request.ctx, "action_existing_snapshot"),
		}));
	}
}

class CommitLocalIssueWorktreeAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(commitLocalIssueWorktree({
			worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
			issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
			issueTitle: expandAttr(request.node, request.ctx, "action_issue_title"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
		}));
	}
}

class InspectBranchChangesAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(inspectBranchChanges({
			worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
		}));
	}
}

class WriteReviewEvidenceAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(writeReviewEvidence({
			worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
			repo: expandAttr(request.node, request.ctx, "action_repo") || request.workDir,
			issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
			branch: expandAttr(request.node, request.ctx, "action_branch"),
			reviewQaCommand: expandAttr(request.node, request.ctx, "action_review_qa_command"),
			integrationCommand: expandAttr(request.node, request.ctx, "action_integration_command"),
			snapshotSha: expandAttr(request.node, request.ctx, "action_snapshot_sha"),
			builderNotesB64: expandAttr(request.node, request.ctx, "action_builder_notes_b64"),
		}));
	}
}

class BuildReviewContextAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(buildAndPersistReviewerContextContract({
			worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
			issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
			branch: expandAttr(request.node, request.ctx, "action_branch"),
			reviewEvidencePath: expandAttr(request.node, request.ctx, "action_review_evidence_path"),
			repoPolicyPath: expandAttr(request.node, request.ctx, "action_repo_policy_path"),
			skillPolicyPath: expandAttr(request.node, request.ctx, "action_skill_policy_path"),
		}));
	}
}

class ValidateReviewContextAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(validateReviewContextCompleteness({
			reviewContextPath: expandAttr(request.node, request.ctx, "action_review_context_path"),
			reviewContextSha256: expandAttr(request.node, request.ctx, "action_review_context_sha256"),
			reviewContextValid: expandAttr(request.node, request.ctx, "action_review_context_valid"),
			reviewContextError: expandAttr(request.node, request.ctx, "action_review_context_error"),
		}));
	}
}

class ResolveReviewRouteAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(resolveReviewRoute({
			reviewVerdictRaw: expandAttr(request.node, request.ctx, "action_verdict"),
			reviewContextGatePass: expandAttr(request.node, request.ctx, "action_review_context_gate_pass"),
			reviewContextGateCode: expandAttr(request.node, request.ctx, "action_review_context_gate_code"),
			reviewContextError: expandAttr(request.node, request.ctx, "action_review_context_error"),
			reviewContextPath: expandAttr(request.node, request.ctx, "action_review_context_path"),
		}));
	}
}

class NormalizeDecisionAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(normalizeDecision(expandAttr(request.node, request.ctx, "action_value") || request.input));
	}
}

class NormalizeIssueStateLabelsAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(await normalizeIssueLabels({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			state: expandAttr(request.node, request.ctx, "action_state") || "open",
		}));
	}
}

class SanitizeGovernanceOverlapAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(sanitizeGovernanceOverlap({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline"),
		}));
	}
}

class AutoReadyArtifactGoalsAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(autoReadyArtifactGoals({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
		}));
	}
}

class SanitizeGoalDuplicatesAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(sanitizeGoalDuplicates({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline"),
		}));
	}
}

class ListReadyGoalsAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(listReadyGoals({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id") || String(request.ctx.get("factory_id") || ""),
		}));
	}
}

class GoalReviewSkipAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(shouldSkipGoalReview({
			goalCount: expandAttr(request.node, request.ctx, "action_goal_count"),
			skipReviewSingleGoal: expandAttr(request.node, request.ctx, "action_skip_review_single_goal"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline"),
		}));
	}
}

class DecomposeAutoApproveAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(decomposeAutoApproveDecision({
			features: expandAttr(request.node, request.ctx, "action_features"),
			decomposeAutoApprove: expandAttr(request.node, request.ctx, "action_decompose_auto_approve"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline"),
		}));
	}
}

class ValidateGoalIntakeAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(validateGoalIntakeEligibility({
			goalIssueJson: expandAttr(request.node, request.ctx, "action_goal_issue_json") || request.input,
		}));
	}
}

class ParseExternalBugReportAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(parseExternalBugReport({
			goalIssueRaw: expandAttr(request.node, request.ctx, "action_goal_issue_json") || request.input,
		}));
	}
}

class PersistHardPlanArtifactAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(persistHardPlanningArtifact({
			repoRoot: request.workDir,
			goalIssueNumber: expandAttr(request.node, request.ctx, "action_goal_issue_number"),
			goalIssueRaw: decodeBase64Attr(request.node, request.ctx, "action_goal_issue_b64"),
			goalContextRaw: decodeBase64Attr(request.node, request.ctx, "action_goal_context_b64"),
			approvedFeaturesRaw: decodeBase64Attr(request.node, request.ctx, "action_approved_features_b64"),
			factoryRequestGoalGraphRaw: decodeBase64Attr(request.node, request.ctx, "action_factory_request_goal_graph_b64"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline"),
			nodeId: expandAttr(request.node, request.ctx, "action_node_id"),
			targetRepo: expandAttr(request.node, request.ctx, "action_target_repo"),
			controlPlaneRepo: expandAttr(request.node, request.ctx, "action_control_plane_repo"),
		}));
	}
}

class ValidatePlanningArtifactAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(validatePlanningArtifact({
			packetPath: expandAttr(request.node, request.ctx, "action_packet_path"),
		}));
	}
}

class AttachPlanningArtifactsAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(attachPlanningArtifacts({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			goalIssueNumber: expandAttr(request.node, request.ctx, "action_goal_issue_number"),
			planningArtifactPath: expandAttr(request.node, request.ctx, "action_planning_artifact_path"),
			planningPacketId: expandAttr(request.node, request.ctx, "action_planning_packet_id"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			summary: expandAttr(request.node, request.ctx, "action_summary"),
		}));
	}
}

class MarkGoalPlannedAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(markGoalPlanned({
			repoRoot: request.workDir,
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			goalIssueNumber: expandAttr(request.node, request.ctx, "action_goal_issue_number"),
			goalExecutionPath: expandAttr(request.node, request.ctx, "action_goal_execution_path"),
			goalRoutingStateRaw: expandAttr(request.node, request.ctx, "action_goal_routing_state"),
			planningArtifactPath: expandAttr(request.node, request.ctx, "action_planning_artifact_path"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline"),
			nodeId: expandAttr(request.node, request.ctx, "action_node_id"),
			targetRepo: expandAttr(request.node, request.ctx, "action_target_repo"),
			controlPlaneRepo: expandAttr(request.node, request.ctx, "action_control_plane_repo"),
		}));
	}
}

class BuildJudgeEvidenceContractAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(buildAndPersistJudgeEvidenceContract({
			judgeKind: expandAttr(request.node, request.ctx, "action_judge_kind"),
			judgeContextRaw: expandAttr(request.node, request.ctx, "action_judge_context_raw")
				|| Buffer.from(expandAttr(request.node, request.ctx, "action_judge_context_b64"), "base64").toString("utf8"),
			worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
			requireQaMarkers: expandAttr(request.node, request.ctx, "action_require_qa_markers"),
			subjectId: expandAttr(request.node, request.ctx, "action_subject_id"),
		}));
	}
}

class BuildJudgeContextContractAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(buildAndPersistJudgeContextContract({
			judgeKind: expandAttr(request.node, request.ctx, "action_judge_kind"),
			judgeContextRaw: expandAttr(request.node, request.ctx, "action_judge_context_raw")
				|| Buffer.from(expandAttr(request.node, request.ctx, "action_judge_context_b64"), "base64").toString("utf8"),
			scenarioSelector: expandAttr(request.node, request.ctx, "action_scenario_selector"),
			scenarioContext: expandAttr(request.node, request.ctx, "action_scenario_context"),
			scope: expandAttr(request.node, request.ctx, "action_scope"),
			scenarioRegistryRoot: expandAttr(request.node, request.ctx, "action_scenario_registry_root"),
			objectiveId: expandAttr(request.node, request.ctx, "action_objective_id"),
			judgeRubric: expandAttr(request.node, request.ctx, "action_judge_rubric"),
			judgeEvidencePath: expandAttr(request.node, request.ctx, "action_judge_evidence_path"),
			judgeEvidenceSha256: expandAttr(request.node, request.ctx, "action_judge_evidence_sha256"),
			subjectId: expandAttr(request.node, request.ctx, "action_subject_id"),
			issueNumber: expandAttr(request.node, request.ctx, "action_issue_number"),
			goalNumber: expandAttr(request.node, request.ctx, "action_goal_number"),
			milestoneTitle: expandAttr(request.node, request.ctx, "action_milestone_title"),
			ghRepo: expandAttr(request.node, request.ctx, "action_gh_repo"),
			judgeContextScopeIdentity: expandAttr(request.node, request.ctx, "action_judge_context_scope_identity"),
			worktreeDir: expandAttr(request.node, request.ctx, "action_worktree_dir"),
		}));
	}
}

class ValidateJudgeContextContractAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(validateJudgeContextCompleteness({
			judgeContextPath: expandAttr(request.node, request.ctx, "action_judge_context_path"),
			judgeContextSha256: expandAttr(request.node, request.ctx, "action_judge_context_sha256"),
			judgeContextValid: expandAttr(request.node, request.ctx, "action_judge_context_valid"),
			judgeContextError: expandAttr(request.node, request.ctx, "action_judge_context_error"),
			judgeKind: expandAttr(request.node, request.ctx, "action_judge_kind"),
			judgeContextRaw: expandAttr(request.node, request.ctx, "action_judge_context_raw")
				|| Buffer.from(expandAttr(request.node, request.ctx, "action_judge_context_b64"), "base64").toString("utf8"),
			scenarioSelector: expandAttr(request.node, request.ctx, "action_scenario_selector"),
			scenarioContext: expandAttr(request.node, request.ctx, "action_scenario_context"),
			scope: expandAttr(request.node, request.ctx, "action_scope"),
			scenarioRegistryRoot: expandAttr(request.node, request.ctx, "action_scenario_registry_root"),
			objectiveId: expandAttr(request.node, request.ctx, "action_objective_id"),
			judgeRubric: expandAttr(request.node, request.ctx, "action_judge_rubric"),
			judgeEvidencePath: expandAttr(request.node, request.ctx, "action_judge_evidence_path"),
			judgeEvidenceSha256: expandAttr(request.node, request.ctx, "action_judge_evidence_sha256"),
			judgeContextScopeIdentity: expandAttr(request.node, request.ctx, "action_judge_context_scope_identity"),
		}));
	}
}

class ValidateJudgeEvidenceContractAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(validateJudgeEvidenceCompleteness({
			judgeKind: expandAttr(request.node, request.ctx, "action_judge_kind"),
			judgeContextRaw: expandAttr(request.node, request.ctx, "action_judge_context_raw")
				|| Buffer.from(expandAttr(request.node, request.ctx, "action_judge_context_b64"), "base64").toString("utf8"),
			judgeEvidencePath: expandAttr(request.node, request.ctx, "action_judge_evidence_path"),
			judgeEvidenceSha256: expandAttr(request.node, request.ctx, "action_judge_evidence_sha256"),
			judgeEvidenceValid: expandAttr(request.node, request.ctx, "action_judge_evidence_valid"),
			judgeEvidenceError: expandAttr(request.node, request.ctx, "action_judge_evidence_error"),
			requireQaMarkers: expandAttr(request.node, request.ctx, "action_require_qa_markers"),
		}));
	}
}

class BuildJudgeRecoveryPacketAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(buildJudgeRecoveryPacket({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			packetType: expandAttr(request.node, request.ctx, "action_packet_type"),
			judgeKind: expandAttr(request.node, request.ctx, "action_judge_kind"),
			milestoneTitle: expandAttr(request.node, request.ctx, "action_milestone_title"),
			readyIssueNumber: expandAttr(request.node, request.ctx, "action_ready_issue_number"),
			gateCode: expandAttr(request.node, request.ctx, "action_gate_code"),
			routeCode: expandAttr(request.node, request.ctx, "action_route_code"),
			errorText: expandAttr(request.node, request.ctx, "action_error_text"),
			judgeContextPath: expandAttr(request.node, request.ctx, "action_judge_context_path"),
			judgeEvidencePath: expandAttr(request.node, request.ctx, "action_judge_evidence_path"),
			scenarioRegistryRoot: expandAttr(request.node, request.ctx, "action_scenario_registry_root"),
			judgeContextScopeIdentity: expandAttr(request.node, request.ctx, "action_judge_context_scope_identity"),
			branch: expandAttr(request.node, request.ctx, "action_branch"),
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

class OpenJudgeFollowupAction implements ActionExecutor {
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

class ValidateApprovedFeaturesAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(validateApprovedFeatures({
			approved: expandAttr(request.node, request.ctx, "action_approved"),
			approvedFeaturesRaw: expandAttr(request.node, request.ctx, "action_approved_features"),
		}));
	}
}

class EmitFallbackDefectAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(emitAndPersistFallbackDefectSignal({
			fallbackNode: expandAttr(request.node, request.ctx, "action_fallback_node"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			triggerReason: expandAttr(request.node, request.ctx, "action_trigger_reason"),
			approved: expandAttr(request.node, request.ctx, "action_approved"),
			decomposeParseStatus: expandAttr(request.node, request.ctx, "action_decompose_parse_status"),
			preNormalizeFeatureCount: expandAttr(request.node, request.ctx, "action_pre_normalize_feature_count"),
			postNormalizeFeatureCount: expandAttr(request.node, request.ctx, "action_post_normalize_feature_count"),
			issuesCreated: expandAttr(request.node, request.ctx, "action_issues_created"),
			goalIssueNumber: expandAttr(request.node, request.ctx, "action_goal_issue_number"),
		}));
	}
}

class FallbackFeaturePairAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(fallbackFeaturePair({
			primaryRaw: expandAttr(request.node, request.ctx, "action_primary"),
			secondaryRaw: expandAttr(request.node, request.ctx, "action_secondary"),
		}));
	}
}

class NormalizeApprovedFeaturesAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return textOutcome(normalizeApprovedFeatures({
			approvedFeaturesRaw: expandAttr(request.node, request.ctx, "action_approved_features"),
			goalIssueRaw: expandAttr(request.node, request.ctx, "action_goal_issue_json") || request.input,
			goalNumber: expandAttr(request.node, request.ctx, "action_goal_number"),
			runId: expandAttr(request.node, request.ctx, "action_run_id"),
			approved: expandAttr(request.node, request.ctx, "action_approved"),
			decomposeParseStatus: expandAttr(request.node, request.ctx, "action_decompose_parse_status"),
			pipeline: expandAttr(request.node, request.ctx, "action_pipeline"),
		}));
	}
}

class ValidateGoalDecisionsAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(validateGoalDecisions({
			goalIssuesRaw: expandAttr(request.node, request.ctx, "action_goal_issues"),
			decisionsRaw: expandAttr(request.node, request.ctx, "action_decisions"),
		}));
	}
}

class ApplyGoalDecisionsAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(applyGoalDecisions({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			decisionsRaw: decodeBase64Attr(request.node, request.ctx, "action_decisions_b64"),
		}));
	}
}

class FilterKeptGoalsAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(filterKeptGoals({
			issuesRaw: decodeBase64Attr(request.node, request.ctx, "action_issues_b64")
				|| expandAttr(request.node, request.ctx, "action_issues"),
			decisionsRaw: decodeBase64Attr(request.node, request.ctx, "action_decisions_b64")
				|| expandAttr(request.node, request.ctx, "action_decisions"),
		}));
	}
}

class ReleaseBuildReportContextAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const result = await buildReleaseReportContext({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			repoPath: expandAttr(request.node, request.ctx, "action_repo_path") || request.workDir,
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
		});
		return jsonOutcome(result);
	}
}

class ArtifactIngestAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const result = await ingestArtifactIssues({
			controlPlaneRepo: expandAttr(request.node, request.ctx, "action_control_plane_repo"),
			sourceRepos: expandAttr(request.node, request.ctx, "action_source_repos"),
			trustedSourceRepos: expandAttr(request.node, request.ctx, "action_trusted_source_repos"),
			trustedFactoryIds: expandAttr(request.node, request.ctx, "action_trusted_factory_ids"),
			max: expandAttr(request.node, request.ctx, "action_max"),
			dryRun: expandAttr(request.node, request.ctx, "action_dry_run"),
		});
		return jsonOutcome(result);
	}
}

class ResolveExecutionConfigAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(resolveWaveConfig({
			integrationCommand: expandAttr(request.node, request.ctx, "action_integration_command"),
			reviewQaCommand: expandAttr(request.node, request.ctx, "action_review_qa_command"),
			stalledWaveMinutes: expandAttr(request.node, request.ctx, "action_stale_run_minutes"),
		}));
	}
}

class ListExecutableGoalsAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		return jsonOutcome(listExecutableGoals({
			repo: expandAttr(request.node, request.ctx, "action_repo"),
			// @context:regression !critical The managed domain must pass repoRoot through
			// exactly like the CLI path. Dropping it made graph-driven executable-goal
			// selection diverge from `hatch-ops goal list-executable`, which can stall
			// dispatch even when the CLI shows ready executable goals.
			repoRoot: expandAttr(request.node, request.ctx, "action_repo_root") || request.workDir,
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id") || String(request.ctx.get("factory_id") || ""),
			runsDir: expandAttr(request.node, request.ctx, "action_runs_dir"),
			maxConcurrent: expandAttr(request.node, request.ctx, "action_max_concurrent"),
		}));
	}
}

class ReleasePublishReportAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const context = JSON.parse(decodeBase64Attr(request.node, request.ctx, "action_context_b64") || "{}");
		const narrative = JSON.parse(decodeBase64Attr(request.node, request.ctx, "action_narrative_b64") || "{}");
		const repo = expandAttr(request.node, request.ctx, "action_repo");
		return jsonOutcome(publishReleaseReportIssue({ repo, context, narrative }));
	}
}
class ReleaseEmitNarrativeDocumentAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const context = JSON.parse(decodeBase64Attr(request.node, request.ctx, "action_context_b64") || "{}");
		const narrative = JSON.parse(decodeBase64Attr(request.node, request.ctx, "action_narrative_b64") || "{}");
		const parseBoolean = (raw: string): boolean | undefined => (raw === "true" ? true : (raw === "false" ? false : undefined));
		const ociRegistryRepository = expandAttr(request.node, request.ctx, "action_oci_registry_repository");
		return jsonOutcome(await emitReleaseNarrativeDocument({
			context, narrative,
			issueUrl: expandAttr(request.node, request.ctx, "action_issue_url"),
			repoPath: expandAttr(request.node, request.ctx, "action_repo_path") || request.workDir,
			outputDir: expandAttr(request.node, request.ctx, "action_output_dir"),
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			taxonomy: parseJsonAttr(request.node, request.ctx, "action_taxonomy", []),
			category: expandAttr(request.node, request.ctx, "action_category"),
			tags: parseJsonAttr(request.node, request.ctx, "action_tags", []),
			topics: parseJsonAttr(request.node, request.ctx, "action_topics", []),
			publishable: parseBoolean(expandAttr(request.node, request.ctx, "action_publishable")),
			containsInternalOnly: parseBoolean(expandAttr(request.node, request.ctx, "action_contains_internal_only")),
			internalOnlySections: parseJsonAttr(request.node, request.ctx, "action_internal_only_sections", []),
			runId: expandAttr(request.node, request.ctx, "action_run_id") || String(request.ctx.get("__run_id") || ""),
			workflowId: expandAttr(request.node, request.ctx, "action_workflow_id") || "release_report_flow",
			workflowSourceRevision: expandAttr(request.node, request.ctx, "action_workflow_source_revision"),
			correlationId: expandAttr(request.node, request.ctx, "action_correlation_id"),
			ociRegistryRepository,
			ociSubjectArtifactRef: expandAttr(request.node, request.ctx, "action_oci_subject_artifact_ref"),
			publishOciArtifactFn: ociRegistryRepository ? (publishOciArtifact as (plan: unknown) => unknown) : null,
			applyOciArtifactTrustFn: ociRegistryRepository ? ((opts: Record<string, unknown>) => opts) : null,
			ociTrustKeyId: expandAttr(request.node, request.ctx, "action_oci_trust_key_id"),
			provenanceBuilderId: expandAttr(request.node, request.ctx, "action_provenance_builder_id"),
		}));
	}
}

class ReleaseShapingFollowupAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const context = JSON.parse(decodeBase64Attr(request.node, request.ctx, "action_context_b64") || "{}");
		const narrative = JSON.parse(decodeBase64Attr(request.node, request.ctx, "action_narrative_b64") || "{}");
		const result = await runReleaseShapingFollowup({
			context,
			narrative,
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			repoPath: expandAttr(request.node, request.ctx, "action_repo_path") || request.workDir,
		});
		return jsonOutcome(result);
	}
}

class ReleaseBuildSlackBlocksAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const context = JSON.parse(decodeBase64Attr(request.node, request.ctx, "action_context_b64") || "{}");
		const narrative = JSON.parse(decodeBase64Attr(request.node, request.ctx, "action_narrative_b64") || "{}");
		const reportIssueUrl = expandAttr(request.node, request.ctx, "action_report_issue_url");
		return textOutcome(JSON.stringify(buildReleaseSlackBlocksPayload({ context, narrative, reportIssueUrl })));
	}
}

class ReleasePostToSlackAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const context = JSON.parse(decodeBase64Attr(request.node, request.ctx, "action_context_b64") || "{}");
		const payload = JSON.parse(decodeBase64Attr(request.node, request.ctx, "action_payload_b64") || "{}");
		const result = await postReleaseToSlack({ context, payload, env: request.env });
		return jsonOutcome(result);
	}
}

class ReleaseUpdateDedupCursorAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const context = JSON.parse(decodeBase64Attr(request.node, request.ctx, "action_context_b64") || "{}");
		const result = updateReleaseDedupCursorFromDelivery({
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			rootDir: request.workDir,
			reportContext: context,
			deliveryStatus: expandAttr(request.node, request.ctx, "action_delivery_status"),
		});
		return jsonOutcome(result);
	}
}

class SupervisorTickIdleCursorUpdateAction implements ActionExecutor {
	async execute(request: ActionExecutionRequest): Promise<Outcome> {
		const result = updateTickIdleCursor({
			factoryId: expandAttr(request.node, request.ctx, "action_factory_id"),
			rootDir: request.workDir,
		});
		return jsonOutcome(result);
	}
}

export function createDefaultActionRegistry(): ActionRegistry {
	const registry = new ActionRegistry();
	registry.register("context.capture", new ContextCaptureAction());
	registry.register("common.encode_base64", new EncodeBase64Action());
	registry.register("common.count_json_items", new CountJsonItemsAction());
	registry.register("common.count_feature_objects", new CountFeatureObjectsAction());
	registry.register("common.resolve_default", new ResolveDefaultAction());
	registry.register("common.resolve_boolean", new ResolveBooleanAction());
	registry.register("common.resolve_gh_repo", new ResolveGhRepoAction());
	registry.register("common.resolve_capability_coding_skills_path", new ResolveCapabilityCodingSkillsPathAction());
	registry.register("common.resolve_capability_merge_skills_path", new ResolveCapabilityMergeSkillsPathAction());
	registry.register("common.resolve_capability_goal_decomposition_skills_path", new ResolveCapabilityGoalDecompositionSkillsPathAction());
	registry.register("common.resolve_factory_config", new ResolveFactoryConfigAction());
	registry.register("common.resolve_intent_stack", new ResolveIntentStackAction());
	registry.register("common.normalize_approved", new NormalizeApprovedAction());
	registry.register("common.increment_counter", new IncrementCounterAction());
	registry.register("common.build_retry_signal", new BuildRetrySignalAction());
	registry.register("common.inspect_json", new InspectJsonAction());
	registry.register("common.inspect_json_pair", new InspectJsonPairAction());
	registry.register("common.fallback_issue_spec_bundle", new FallbackIssueSpecBundleAction());
	registry.register("common.normalize_feature_issue_spec_bundle", new NormalizeFeatureIssueSpecBundleAction());
	registry.register("common.validate_issue_spec_draft", new ValidateIssueSpecDraftAction());
	registry.register("common.create_issue", new CreateIssueAction());
	registry.register("common.update_issue", new UpdateIssueAction());
	registry.register("common.normalize_decision", new NormalizeDecisionAction());
	registry.register("common.normalize_issue_urls", new NormalizeIssueUrlsAction());
	registry.register("labels.normalize_issue_state", new NormalizeIssueStateLabelsAction());
	registry.register("governance.sanitize_overlap", new SanitizeGovernanceOverlapAction());
	registry.register("ceremony.goal_review_skip", new GoalReviewSkipAction());
	registry.register("ceremony.decompose_auto_approve", new DecomposeAutoApproveAction());
	registry.register("goal.validate_intake", new ValidateGoalIntakeAction());
	registry.register("goal.parse_external_bug_report", new ParseExternalBugReportAction());
	registry.register("goal.persist_hard_plan_artifact", new PersistHardPlanArtifactAction());
	registry.register("goal.validate_planning_artifact", new ValidatePlanningArtifactAction());
	registry.register("goal.attach_planning_artifacts", new AttachPlanningArtifactsAction());
	registry.register("goal.mark_planned", new MarkGoalPlannedAction());
	registry.register("goal.auto_ready_artifacts", new AutoReadyArtifactGoalsAction());
	registry.register("goal.sanitize_duplicates", new SanitizeGoalDuplicatesAction());
	registry.register("goal.list_ready", new ListReadyGoalsAction());
	registry.register("goal.validate_approved_features", new ValidateApprovedFeaturesAction());
	registry.register("goal.emit_fallback_defect", new EmitFallbackDefectAction());
	registry.register("goal.fallback_feature_pair", new FallbackFeaturePairAction());
	registry.register("goal.normalize_approved_features", new NormalizeApprovedFeaturesAction());
	registry.register("goal.validate_decisions", new ValidateGoalDecisionsAction());
	registry.register("goal.apply_decisions", new ApplyGoalDecisionsAction());
	registry.register("goal.filter_kept_goals", new FilterKeptGoalsAction());
	registry.register("goal.add_sub_issue", new AddSubIssueAction());
	registry.register("goal.fetch_goal_issue", new FetchGoalIssueAction());
	registerBrainstormActions(registry);
	registerScenarioActions(registry);
	registerDailyLensActions(registry);
	registerMergeActions(registry);
	registerGoalExecuteActions(registry);
	registerGoalIssueActions(registry);
	registerGoalRunActions(registry);
	registerSupervisorActions(registry);
	registerWaveDispatchActions(registry);
	registerWaveExecuteActions(registry);
	registry.register("coding.extract_issue_item", new ExtractIssueItemAction());
	registry.register("coding.resolve_goal_number_from_milestone", new ResolveGoalNumberFromMilestoneAction());
	registry.register("coding.init_wave_issue_worktree", new InitWaveIssueWorktreeAction());
	registry.register("coding.setup_wave_issue_worktree", new SetupWaveIssueWorktreeAction());
	registry.register("coding.init_review_attempt", new InitReviewAttemptAction());
	registry.register("coding.next_review_attempt", new NextReviewAttemptAction());
	registry.register("coding.snapshot_branch_head", new SnapshotBranchHeadAction());
	registry.register("coding.commit_local", new CommitLocalIssueWorktreeAction());
	registry.register("coding.inspect_branch_changes", new InspectBranchChangesAction());
	registry.register("coding.write_review_evidence", new WriteReviewEvidenceAction());
	registry.register("coding.build_review_context", new BuildReviewContextAction());
	registry.register("coding.validate_review_context", new ValidateReviewContextAction());
	registry.register("coding.resolve_review_route", new ResolveReviewRouteAction());
	registry.register("judge.build_evidence_contract", new BuildJudgeEvidenceContractAction());
	registry.register("judge.build_context_contract", new BuildJudgeContextContractAction());
	registry.register("judge.validate_context_contract", new ValidateJudgeContextContractAction());
	registry.register("judge.validate_evidence_contract", new ValidateJudgeEvidenceContractAction());
	registry.register("judge.build_recovery_packet", new BuildJudgeRecoveryPacketAction());
	registry.register("release.build_report_context", new ReleaseBuildReportContextAction());
	registry.register("release.publish_report", new ReleasePublishReportAction());
	registry.register("release.emit_narrative_document", new ReleaseEmitNarrativeDocumentAction());
	registry.register("release.shaping_followup", new ReleaseShapingFollowupAction());
	registry.register("release.build_slack_blocks", new ReleaseBuildSlackBlocksAction());
	registry.register("release.post_to_slack", new ReleasePostToSlackAction());
	registry.register("release.update_dedup_cursor", new ReleaseUpdateDedupCursorAction());
	registry.register("supervisor.tick_idle_cursor_update", new SupervisorTickIdleCursorUpdateAction());
	registry.register("artifact.ingest", new ArtifactIngestAction());
	registry.register("software.resolve_execution_config", new ResolveExecutionConfigAction());
	registry.register("software.list_executable_goals", new ListExecutableGoalsAction());
	registry.register("wave.open_judge_followup", new OpenJudgeFollowupAction());
	return registry;
}
