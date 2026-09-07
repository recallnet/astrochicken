import { decomposeAutoApproveDecision, shouldSkipGoalReview } from "../../../packages/factory-ops/src/commands/ceremony-heuristics.ts";
import { createGitHubIssueFromSpec, updateGitHubIssueFromSpec } from "../../../packages/factory-ops/src/commands/common-create-issue.ts";
import {
	buildRetrySignal,
	countFeatureObjects,
	countJsonItems,
	fallbackJson,
	fallbackJsonPair,
	fallbackIssueSpecBundle,
	incrementCounter,
	inspectJson,
	inspectJsonPair,
	normalizeApproved,
	normalizeDecision,
	normalizeFeatureIssueSpecBundle,
	resolveCapabilityCodingSkillsPath,
	resolveCapabilityGoalDecompositionSkillsPath,
	resolveCapabilityMergeSkillsPath,
	resolveFactoryConfigValue,
	resolveDefault,
	resolveBoolean,
	validateIssueSpecDraft,
} from "../../../packages/factory-ops/src/commands/common-resolve-default.ts";
import { resolveGhRepo } from "../../../packages/factory-ops/src/commands/common-resolve-gh-repo.ts";
import { resolveIntentStack } from "../../../packages/factory-ops/src/commands/common-resolve-intent-stack.ts";
import { appendGoalRationaleFeature } from "../../../packages/factory-ops/src/commands/goal-append-rationale-feature.ts";
import { applyFeatureBlockers } from "../../../packages/factory-ops/src/commands/goal-apply-feature-blockers.ts";
import { autoReadyArtifactGoals } from "../../../packages/factory-ops/src/commands/goal-auto-ready-artifacts.ts";
import { buildFallbackFeatures } from "../../../packages/factory-ops/src/commands/goal-build-fallback-features.ts";
import { checkGoalAlreadyDecomposedWithPackets } from "../../../packages/factory-ops/src/commands/goal-check-decomposed.ts";
import { persistGoalDecompositionLedger } from "../../../packages/factory-ops/src/commands/goal-decomposition-packet.ts";
import { guardDuplicateGoalDecomposition } from "../../../packages/factory-ops/src/commands/goal-duplicate-decompose-guard.ts";
import { resolveGoalExecutionPath } from "../../../packages/factory-ops/src/commands/goal-execution-path.ts";
import { emitAndPersistFallbackDefectSignal } from "../../../packages/factory-ops/src/commands/goal-fallback-defect.ts";
import { materializeApprovedHardPlan } from "../../../packages/factory-ops/src/commands/goal-hard-plan-materialize.ts";
import {
	attachPlanningArtifacts,
	markGoalPlanned,
	persistHardPlanningArtifact,
	validatePlanningArtifact,
} from "../../../packages/factory-ops/src/commands/goal-hard-planning.ts";
import { inspectHardGoalState } from "../../../packages/factory-ops/src/commands/goal-hard-state.ts";
import { labelCreatedIssues } from "../../../packages/factory-ops/src/commands/goal-label-created-issues.ts";
import { parseExternalBugReport } from "../../../packages/factory-ops/src/commands/goal-parse-external-bug-report.ts";
import {
	applyGoalDecisions,
	computeGoalRunCloseCondition,
	countDecomposeAttemptsFromGitHub,
	filterKeptGoals,
	listReadyGoals,
} from "../../../packages/factory-ops/src/commands/goal-queue-ops.ts";
import { buildGoalRunAdmissionFailure, inspectGoalRunAdmission } from "../../../packages/factory-ops/src/commands/goal-run-admission.ts";
import { exhaustDecomposeRetries, markGoalDispatched, postDecomposeAttemptMarker, postGoalRetryComment } from "../../../packages/factory-ops/src/commands/goal-run-state.ts";
import { sanitizeGoalDuplicates } from "../../../packages/factory-ops/src/commands/goal-sanitize-duplicates.ts";
import { addSubIssue } from "../../../packages/factory-ops/src/commands/goal-sub-issues.ts";
import { validateGoalDecisions } from "../../../packages/factory-ops/src/commands/goal-validate-decisions.ts";
import { validateGoalIntakeEligibility } from "../../../packages/factory-ops/src/commands/goal-validate-intake.ts";
import { sanitizeGovernanceOverlap } from "../../../packages/factory-ops/src/commands/governance-sanitize-overlap.ts";
import { normalizeIssueLabels } from "../../../packages/factory-ops/src/commands/labels-normalize.ts";
import { normalizeIssueUrls } from "../../../packages/factory-ops/src/commands/triage-normalize-issues.ts";
import { resolveFeatureDependencies } from "../../../packages/factory-ops/src/commands/triage-resolve-feature-dependencies.ts";
import { zipFeaturesToIssues } from "../../../packages/factory-ops/src/commands/triage-zip-features.ts";

export function validateApprovedFeatures({ approved = "", approvedFeaturesRaw = "" } = {}) {
	if (normalizeApproved(approved) !== "true") return normalizeApproved(approved);
	return countFeatureObjects(approvedFeaturesRaw) === "0" ? "false" : "true";
}

export function fallbackFeaturePair({ primaryRaw = "", secondaryRaw = "" } = {}) {
	const candidate = fallbackJsonPair(primaryRaw, secondaryRaw);
	return countFeatureObjects(candidate) === "0" ? "[]" : candidate;
}

export function normalizeApprovedFeatures({
	approvedFeaturesRaw = "",
	goalIssueRaw = "",
	goalNumber = "",
	runId = "",
	approved = "",
	decomposeParseStatus = "",
	pipeline = "goal_intake_decompose",
} = {}) {
	const approvedObjectCount = countFeatureObjects(approvedFeaturesRaw);
	if (approvedObjectCount === "0") {
		emitAndPersistFallbackDefectSignal({
			fallbackNode: "normalize_features",
			pipeline,
			runId,
			triggerReason: "feature_count_zero_after_normalize",
			approved,
			decomposeParseStatus,
			postNormalizeFeatureCount: approvedObjectCount,
			issuesCreated: "0",
			goalIssueNumber: goalNumber,
		});
		return buildFallbackFeatures({
			goalIssueRaw,
			goalNumber,
		});
	}

	return fallbackJson(approvedFeaturesRaw, "", { goalNumber });
}

export {
	addSubIssue,
	checkGoalAlreadyDecomposedWithPackets,
	applyGoalDecisions,
	applyFeatureBlockers,
	appendGoalRationaleFeature,
	autoReadyArtifactGoals,
	buildRetrySignal,
	buildGoalRunAdmissionFailure,
	computeGoalRunCloseCondition,
	countFeatureObjects,
	countDecomposeAttemptsFromGitHub,
	countJsonItems,
	createGitHubIssueFromSpec,
	decomposeAutoApproveDecision,
	emitAndPersistFallbackDefectSignal,
	exhaustDecomposeRetries,
	fallbackJsonPair,
	fallbackIssueSpecBundle,
	filterKeptGoals,
	guardDuplicateGoalDecomposition,
	incrementCounter,
	inspectHardGoalState,
	inspectJson,
	inspectJsonPair,
	inspectGoalRunAdmission,
	labelCreatedIssues,
	listReadyGoals,
	attachPlanningArtifacts,
	markGoalPlanned,
	markGoalDispatched,
	materializeApprovedHardPlan,
	normalizeApproved,
	normalizeDecision,
	normalizeIssueLabels,
	normalizeIssueUrls,
	normalizeFeatureIssueSpecBundle,
	parseExternalBugReport,
	persistGoalDecompositionLedger,
	persistHardPlanningArtifact,
	postDecomposeAttemptMarker,
	postGoalRetryComment,
	resolveCapabilityCodingSkillsPath,
	resolveCapabilityGoalDecompositionSkillsPath,
	resolveCapabilityMergeSkillsPath,
	resolveFactoryConfigValue,
	resolveDefault,
	resolveGhRepo,
	resolveBoolean,
	resolveIntentStack,
	resolveFeatureDependencies,
	resolveGoalExecutionPath,
	sanitizeGoalDuplicates,
	sanitizeGovernanceOverlap,
	shouldSkipGoalReview,
	updateGitHubIssueFromSpec,
	validateGoalIntakeEligibility,
	validateGoalDecisions,
	validateIssueSpecDraft,
	validatePlanningArtifact,
	zipFeaturesToIssues,
};
