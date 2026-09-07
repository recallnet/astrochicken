// Pipeline engine
export {
	parse,
	parseWithAst,
	type DotIdentifierToken,
	type DotAttrEntry,
	type DotAttrList,
	type DotNodeAst,
	type DotParseWithAstResult,
} from "./pipeline/parse.js";
export {
	validate,
	formatValidationError,
	hasValidationErrors,
	VALIDATION_MODES,
	isValidationMode,
	type ValidationError,
	type ValidationMode,
	type ValidationOptions,
} from "./pipeline/validate.js";
export { Engine, HandlerRegistry, expandVariables, type Handler, type EngineOptions } from "./pipeline/engine.js";
export { Context, StageStatus, type Outcome, type StageRecord, type OutcomeUsage } from "./pipeline/context.js";
export {
	canonicalizeIntent,
	computeIntentDigest,
	resolveIntentMetadata,
	type IntentDescriptor,
	type IntentMetadata,
	type IntentKind,
} from "./pipeline/intent.js";
export {
	EventBus,
	STAGE_FINISH_COMPLEXITY_CLASS_KEY,
	STAGE_FINISH_COMPLEXITY_SIGNALS_KEY,
	STAGE_FINISH_COMPLEXITY_REASON_KEY,
	STAGE_FINISH_COMPLEXITY_OTEL_KEY,
	STAGE_FINISH_EXECUTION_PATH_KEY,
	STAGE_FINISH_PATH_TAKEN_KEY,
	STAGE_FINISH_MERGE_RESOLVER_KEY,
	type Event,
	type EventKind,
	type EventHandler,
	type EventData,
	type StageFinishComplexityData,
} from "@recallnet/factory-telemetry";
export { parseCondition, ConditionExpr, type ConditionClause } from "./pipeline/condition.js";
export { parseStylesheet, type Stylesheet, type StyleRule, type Selector } from "./pipeline/stylesheet.js";
export {
	loadStylesheetImports,
	applyGraphStylesheetImports,
	StylesheetImportError,
	MissingStylesheetImportError,
	StylesheetImportParseError,
	CircularStylesheetImportError,
	type StylesheetImportErrorCode,
	type StylesheetImportFileSystem,
	type StylesheetImportErrorDetails,
	type LoadStylesheetImportsArgs,
	type ApplyGraphStylesheetImportsArgs,
	type ApplyGraphStylesheetImportsResult,
} from "./pipeline/stylesheet-imports.js";
export { applyStylesheet, expandGraphVariables } from "./pipeline/transform.js";
export { loadScenarios } from "./pipeline/scenarios.js";
export {
	resolveRoutingPolicyForNode,
	formatRoutingPolicySummary,
	type ResolveRoutingPolicyForNodeArgs,
	type NodeRoutingPolicySummary,
	type FormattedNodeRoutingPolicySummary,
	type NodeRoutingAttemptSummary,
} from "./pipeline/llm-routing-policy.js";
export {
	MODEL_MATRIX_EXECUTION_STRATEGIES,
	CANDIDATE_EXECUTION_STATUSES,
	toCandidateResultSetJson,
	parseCandidateResultSetJson,
	type ModelMatrixExecutionStrategy,
	type CandidateExecutionStatus,
	type CandidateResult,
	type CandidateResultSet,
} from "./pipeline/types.js";
export {
	TOOL_IDENTIFIERS_V1,
	ACTION_IDENTIFIERS_V1,
	GOVERNANCE_KINDS_V1,
	GOVERNANCE_DECISIONS_V1,
	AGENT_IDS_V1,
	AGENT_ROLES_V1,
	DEFAULT_AGENT_IDENTITY_FALLBACK_V1,
	TRUST_PARTICIPATING_HANDLER_TYPES,
	isToolIdentifierV1,
	isActionIdentifierV1,
	isGovernanceKindV1,
	isGovernanceDecisionV1,
	isAgentIdV1,
	isAgentRoleV1,
	isTrustParticipatingHandlerType,
	type ToolIdentifierV1,
	type ActionIdentifierV1,
	type GovernanceKindV1,
	type GovernanceDecisionV1,
	type AgentIdV1,
	type AgentRoleV1,
	type AgentIdentityV1,
} from "./pipeline/governance.js";
export { registerDailyLensActions } from "./pipeline/action-registry-daily-lens.js";
export { registerGoalRunActions } from "./pipeline/action-registry-goal-run.js";
export {
	IDENTITY_MODES,
	DEFAULT_IDENTITY_MODE,
	IRREVERSIBLE_HANDLER_TYPES_V1,
	IDENTITY_RULE_CODES,
	isIdentityMode,
	isIrreversibleHandlerTypeV1,
	type IdentityMode,
	type IdentityRuleCode,
	type IrreversibleHandlerTypeV1,
} from "./pipeline/identity.js";
export {
	DEFAULT_INTENT_PROFILE,
	resolveIntentBinding,
	resolveIntentForNode,
	validateIntentBindings,
	IntentResolutionError,
	type IntentRegistry,
	type IntentDefinition,
	type IntentBinding,
	type ResolvedIntent,
	type IntentData,
	type IntentValidationError,
} from "./pipeline/intent.js";
export {
	INTENT_SCHEMA_VERSION,
	IntentSchemaError,
	parseIntentDocument,
	validateIntentDocument,
	formatIntentSchemaIssues,
	type IntentDocument,
	type IntentProfileDocument,
	type IntentSchemaIssue,
} from "./intent/schema.js";
export {
	IntentLoadError,
	findRepoRoot,
	formatIntentLoadIssues,
	loadIntentRegistry,
	type IntentLoadIssue,
	type IntentRegistryLoadOptions,
} from "./intent/loader.js";
export {
	FACTORY_REGISTRY_SCHEMA_VERSION,
	FactoryRegistryLoadError,
	FactoryRegistrySchemaError,
	formatFactoryRegistryIssues,
	loadFactoryRegistry,
	parseFactoryRegistryDocument,
	validateFactoryRegistryDocument,
	type FactoryRegistry,
	type FactoryRegistryConcurrency,
	type FactoryRegistryConcurrencyDocument,
	type FactoryRegistryDocument,
	type FactoryRegistryFactory,
	type FactoryRegistryFactoryDocument,
	type FactoryRegistryGraph,
	type FactoryRegistryGraphDocument,
	type FactoryRegistryIssue,
	type FactoryRegistryLoadOptions,
} from "./dispatch/registry.js";
export {
	SERVICE_PROFILE_KEYS,
	defaultServiceProfile,
	normalizeServiceProfile,
	validateServiceProfileFields,
	type ServiceProfile,
} from "./factory/service-profile.js";
export {
	planRuntimeRecoverySweepActions,
	scanRuntimeRecoverySweep,
	applyRuntimeRecoverySweep,
	type RecoverySweepAction,
	type RecoverySweepReport,
	type ApplyRecoverySweepResult,
	type RuntimeRecoverySweepScanOptions,
} from "./runs-recovery-sweep.js";

export {
	FACTORY_CONFIG_SCHEMA_VERSION,
	FACTORY_KIND_EXECUTION_MODES,
	FACTORY_INSTALLATION_WORKSPACE_MODES,
	formatFactoryConfigIssue,
	parseFactoryConfigDocument,
	validateFactoryConfigDocument,
	parseFactoryKindDefinitionDocument,
	validateFactoryKindDefinitionDocument,
	parseFactoryInstanceManifestDocument,
	validateFactoryInstanceManifestDocument,
	parseFactoryServiceRegistryDocument,
	validateFactoryServiceRegistryDocument,
	parseFactoryInstallationManifestDocument,
	validateFactoryInstallationManifestDocument,
	loadPolicyPackDocuments,
	validatePolicyPackContract,
	formatPolicyPackIssue,
	getFactoryIsolationConfig,
	assertFactoryIsolationContext,
	resolveFactoryRuntimePaths,
	type FactoryKindExecutionMode,
	type FactoryInstallationWorkspaceMode,
	type FactoryConfigDocument,
	type FactoryKindCapabilityDocument,
	type FactoryKindDefinitionDocument,
	type FactoryInstanceTargetRepoDocument,
	type FactoryDestinationRouteDocument,
	type FactoryInstanceManifestDocument,
	type FactoryServiceRegistryInstanceRecordDocument,
	type FactoryServiceRegistryDocument,
	type FactoryInstallationManifestDocument,
	type FactoryConfigDispatchDocument,
	type FactoryConfigIssue,
	type FactoryConfigPipelineDocument,
	type FactoryConfigScenariosDocument,
	type FactoryConfigSkillsDocument,
	type FactoryConfigTrustDocument,
	type FactoryConfigCapabilitiesDocument,
	type FactoryConfigGoalDecompositionDocument,
	type FactoryConfigGoalDecompositionTimeoutsDocument,
	type FactoryPolicyPackConfigDocument,
	type PolicyPackDocuments,
	type PolicyPackIssue,
	type PolicyPackMetadataDocument,
	type FactoryIsolationDocument,
	type FactoryIsolationConfig,
	type FactoryIsolationAuthDocument,
	type FactoryIsolationAuthGithubDocument,
	type FactoryIsolationValueDocument,
	type FactoryIsolationPathsDocument,
	type FactoryRuntimePathDefaults,
	type FactoryRuntimePaths,
	type AssertFactoryIsolationContextArgs,
} from "./factory/config-schema.js";
export {
	findNearestFactoryConfigPath,
	normalizeFactoryContext,
	formatFactoryContextHeaderLines,
	resolveFactoryContext,
	FACTORY_CONTEXT_MODE_CONFLICT_ERROR_CODE,
	type FactoryContext,
	type ResolveFactoryContextOptions,
} from "./factory/context-resolver.js";
export { buildGitHubMutationContext } from "./pipeline/github-mutation-context.js";
export {
	FACTORY_MODES,
	FACTORY_MODE_CONFLICT_ERROR_CODE,
	MODE_SOURCE_PRECEDENCE,
	deriveModeFromConfig,
	resolveModeSources,
	ModeConflictError,
	type FactoryMode,
	type ModeSource,
	type ModeSourcePrecedence,
	type ManagedOverlay,
	type ContextArtifacts,
} from "./factory/mode.js";
export {
	FACTORY_INSTANCE_ID_PREFIX,
	FACTORY_INSTALLATION_ID_PREFIX,
	FACTORY_INSTANCE_ID_REGEX,
	FACTORY_INSTALLATION_ID_REGEX,
	FACTORY_STABLE_ID_PAYLOAD_REGEX,
	GRANDFATHERED_MOTHERSHIP_INSTANCE_ID,
	generateFactoryInstanceId,
	generateFactoryInstallationId,
	isValidFactoryInstanceId,
	isValidFactoryInstallationId,
} from "./factory/identity.js";
export {
	formatControlPlaneGateSection,
	formatManagedStateLine,
	formatRuntimeDriftSection,
	formatActiveRunTreeRows,
	formatTickStageLine,
	presentFactoryStatus,
	presentFactoryActiveSummary,
	presentTickStatus,
	renderFactoryPresentation,
	type FactoryPresentation,
	type FactoryStatusLike,
	type FactoryActiveSummaryLike,
	type TickStatusLike,
	type ActiveRunLike,
} from "./factory/status-presenter.js";
export {
	FACTORY_CONFORMANCE_PHASES,
	runFactoryConformanceHarness,
	type FactoryConformancePhase,
	type FactoryConformancePhaseResult,
	type FactoryConformanceHarnessResult,
	type FactoryConformanceFirstFailure,
	type FactoryConformancePhaseEvent,
	type FactoryConformanceCommandRequest,
	type FactoryConformanceCommandResult,
	type FactoryConformanceCommandRunner,
	type RunFactoryConformanceHarnessOptions,
} from "./factory/conformance-harness.js";
export { dispatchTick, runDispatchLoop, type DispatchLoopOptions } from "./dispatch/loop.js";
export { checkOutputConstraints, checkOutputFormat, type ConstraintResult } from "./pipeline/constraints.js";
export {
	DECISION_RECORD_SCHEMA_VERSION,
	DECISION_RECORD_COUNT_KEY,
	DECISION_RECORD_SEQ_KEY,
	decisionsDir,
	listDecisionArtifacts,
	isDecisionArtifactEligible,
	initializeDecisionArtifactCounter,
	emitDecisionArtifact,
	type DecisionArtifactRecord,
	type DecisionArtifactWriteResult,
	type EmitDecisionArtifactArgs,
	type DecisionObjectiveIdSource,
	type DecisionMarker,
	type JudgeVerdict,
} from "./pipeline/decision-artifacts.js";
export { saveCheckpoint, loadCheckpoint, defaultCheckpointPath, type Checkpoint } from "./pipeline/checkpoint.js";
export { createTraceHandler, defaultTracePath, formatTrace, type TraceEntry } from "./pipeline/trace.js";
export {
	bindLangfuseLifecycleTelemetry,
	setLangfuseLifecycleEmitter,
	getLangfuseLifecycleEmitter,
	LANGFUSE_FLUSH_EVENT_KIND,
	LANGFUSE_RETRY_EVENT_KIND,
	LANGFUSE_HEARTBEAT_FLUSH_EVERY_FLAG,
	LANGFUSE_FLUSH_TIMEOUT_MS_FLAG,
	LANGFUSE_RETRY_TIMEOUT_MS_FLAG,
	type LangfuseLifecycleEmitter,
	type LangfuseLifecycleBinding,
	type LangfuseFlushRequest,
	type LangfuseRetryRequest,
	type BindLangfuseLifecycleTelemetryArgs,
} from "@recallnet/factory-telemetry";
export {
	LANGFUSE_GENERATION_EVENT_KIND,
	LANGFUSE_SESSION_EVENT_KIND,
	LANGFUSE_PROMPT_TEXT_FLAG,
	bindLangfuseSessionTelemetry,
	computeLangfusePromptHash,
	isLangfusePromptTextEnabled,
	langfuseNodeContextKey,
	nextLangfuseAttemptIndex,
	readLangfuseSessionContext,
	recordLangfuseSessionContext,
	resolveLangfuseTraceId,
	usageFromAssistantMessage,
	emitLangfuseGenerationEvent,
	emitLangfuseSessionEvent,
	type LangfuseUsageMetrics,
	type LangfuseGenerationEventArgs,
	type LangfuseSessionContextView,
	type LangfuseSessionEventArgs,
} from "@recallnet/factory-telemetry";
export { persistLifecycleContextFromEngine, type LifecycleStateEngineView } from "./pipeline/lifecycle-persistence.js";
export {
	mapEventToLangfuseSpan,
	createLangfuseSpanHandler,
	type LangfuseSpanRecord,
	type LangfuseSpanSink,
} from "@recallnet/factory-telemetry";
export {
	deriveQualitySignal,
	buildQualitySignalEventData,
	type QualitySignal,
	type QualitySignalInput,
} from "@recallnet/factory-telemetry";
export {
	createLangfuseTelemetry,
	resolveLangfuseConfigFromEnv,
	collectFactoryContext,
	type LangfuseTelemetry,
	type LangfuseTelemetryConfig,
	type LangfuseTelemetryStats,
	type SessionTelemetryEvent,
	type LangfuseSpanEnvelope,
	type LangfuseTelemetryTransport,
} from "@recallnet/factory-telemetry";
export {
	estimateComplexity,
	complexityTelemetryData,
	type ComplexityEstimate,
} from "./complexity/estimate.js";
export {
	COMPLEXITY_OTEL_CLASS_KEY,
	normalizeComplexityInput,
	type ComplexityClass as SignalComplexityClass,
	type ComplexityEstimateInput,
	type ComplexitySignal,
} from "./complexity/signals.js";
export {
	DEFAULT_COMPLEXITY_CLASS,
	DEFAULT_COMPLEXITY_REASON,
	DEFAULT_COMPLEXITY_OTEL_KEY,
	resolveComplexityTelemetry,
	complexityTelemetryEventData,
	extractComplexityDimensions,
	type ComplexityTelemetry,
} from "./complexity/telemetry.js";
export { ThreadStore, type ThreadMessage } from "./pipeline/threads.js";
export {
	acquireLock,
	isLocked,
	sweepLeases,
	readLease,
	lockDirPath,
	leasePath,
	leaseArtifactsDirPath,
	leaseEventsPath,
	type LeaseStatus,
	type LeaseStaleReason,
	type LeaseRecord,
	type LeaseEventType,
	type LeaseEventRecord,
	type AcquireLockOptions,
	type LeaseSweepOptions,
	type LeaseSweepEntry,
	type LeaseSweepResult,
} from "./pipeline/lock.js";
export { WatchLoop, parseTriggerArgs, type TriggerConfig } from "./pipeline/watch.js";
export {
	generateRunId,
	createRunState,
	saveRunState,
	loadRunState,
	listRuns,
	findRecoverableRun,
	recoverStaleRuns,
	isStaleRun,
	isPidAlive,
	runMetadataPath,
	loadRunMetadata,
	saveRunMetadata,
	cleanupRun,
	sessionsDir,
	eventsPath,
	runAlignmentSummaryFilePath,
	readRunAlignmentSummary,
	RUN_STATE_SCHEMA_VERSION,
	RUN_METADATA_SCHEMA_VERSION,
	createGuardCounters,
	createDefaultRunGuardState,
	type RunState,
	type RunStatus,
	type RunMetadata,
	type RunRecoveryReasonCode,
	type RunRecoveryAction,
	type RunRecoveryResult,
	type CompletedNode,
	type ActiveChild,
	type GuardCounters,
	type GuardCircuitState,
	type GuardReasonCode,
	type RunGuardState,
	type GuardOwnerSnapshot,
} from "./pipeline/run.js";

export {
	RUN_ALIGNMENT_SUMMARY_SCHEMA_VERSION,
	RUN_ALIGNMENT_COUNTER_TAXONOMY_VERSION,
	RUN_ALIGNMENT_SUMMARY_FILE,
	isTerminalRunStatus,
	runAlignmentSummaryPath,
	runAlignmentSummaryPathFromRunDir,
	loadRunAlignmentSummary,
	writeRunAlignmentSummary,
	deriveAlignmentCountersFromDecisionRecords,
	type TerminalRunStatus,
	type RunAlignmentCounters,
	type ObjectiveAlignmentCounters,
	type RunAlignmentSummary,
	type WriteRunAlignmentSummaryInput,
	type AlignmentDecisionCounterRecord,
	type AlignmentCounterDerivation,
} from "./pipeline/alignment-summary.js";

export {
	guardCounterForHandlerType,
	guardCounterForTransition,
	evaluateGuardGate,
	incrementGuardCounter,
	statusForGuardDecision,
	resetGuardBudgets,
	type GuardCounterKey,
	type GuardDecision,
	type GuardResetOptions,
	type GuardResetResult,
} from "./pipeline/guard.js";

// Graph types
export type { Graph, Node, Edge, ComplexityClass as GraphComplexityClass } from "./pipeline/graph.js";
export {
	shapeToHandlerType,
	nodeHandlerType,
	nodePrompt,
	nodeLLMModel,
	nodeLLMProvider,
	nodeWorkDir,
	nodeScenarios,
	nodeOutputFormat,
	nodeOutputKey,
	graphWorkDir,
	graphModelStylesheet,
	graphIdentityMode,
	graphIdentityModeRaw,
	graphIntentRef,
	graphIntentProfile,
	graphIntentPatches,
	graphComplexityClass,
	nodeIntentRef,
	nodeIntentProfile,
	nodeIntentPatches,
	nodeComplexityClass,
	parseComplexityClass,
	nodeToolId,
	nodeActionId,
	nodeGovernance,
	nodeGovernanceDecision,
	nodeTrustParticipates,
	nodeAgentId,
	nodeAgentRole,
	nodeTrustPartition,
	nodeTrustDomain,
	nodeTrustRole,
	nodeTrustPartitionKey,
	nodeOutputs,
	outgoingEdges,
	incomingEdges,
	edgeInputKey,
} from "./pipeline/graph.js";

// Handlers
export { registerAll, type HandlerConfig } from "./pipeline/handler/register.js";
export { CodergenHandler, type CodergenConfig } from "./pipeline/handler/codergen.js";
export { ManagerLoopHandler, type ManagerConfig } from "./pipeline/handler/manager.js";
export { ToolHandler } from "./pipeline/handler/tool.js";
export { HumanHandler, ConsoleInterviewer, AutoApproveInterviewer, type Interviewer } from "./pipeline/handler/human.js";
export { StartHandler } from "./pipeline/handler/start.js";
export { ExitHandler } from "./pipeline/handler/exit.js";
export { ConditionalHandler } from "./pipeline/handler/conditional.js";
export { ParallelHandler, FanInHandler } from "./pipeline/handler/parallel.js";
export { AssertHandler } from "./pipeline/handler/assert.js";
export { PipelineHandler } from "./pipeline/handler/pipeline.js";
export { DynamicFanOutHandler, DynamicFanInHandler } from "./pipeline/handler/fan_out_dynamic.js";
export { WorktreeAgentHandler, KnowledgeWorkerHandler } from "./pipeline/handler/worktree.js";

// Server
export { createServer } from "./server/server.js";
