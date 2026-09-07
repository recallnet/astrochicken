import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	gateEvidenceRefForArtifact,
	gateNameForDecision,
	gateOutcomeForDecision,
} from "@recallnet/factory-telemetry";

import { buildGuardEventTelemetry } from "./guard-eventbus.js";
import { readLease } from "./lock.js";
import {
	type GuardCircuitState,
	type GuardCounters,
	type GuardReasonCode,
	type RunGuardState,
	type RunState,
	inferFactoryTelemetryIdentityFromPipelineConfig,
	saveRunState,
	runDir,
} from "./run.js";

import type { EventBus } from "@recallnet/factory-telemetry";

const FACTORY_GUARD_SCHEMA_VERSION = 1;

let scopedFactoryGuardBaseDir = "";

export interface FactoryGuardScopeOptions {
	guardDir?: string;
}

export function configureFactoryGuardScope(options: FactoryGuardScopeOptions = {}): string {
	scopedFactoryGuardBaseDir = options.guardDir || "";
	return factoryGuardDir();
}

function factoryGuardDir(): string {
	if (scopedFactoryGuardBaseDir) return scopedFactoryGuardBaseDir;
	return join(process.cwd(), ".hatch", "guard");
}

function factoryGuardArtifactsRoot(): string {
	return join(factoryGuardDir(), "artifacts");
}

export const COUNTER_KEYS = [
	"tool_calls",
	"llm_calls",
	"review_retry_calls",
	"pipeline_transition_calls",
] as const;

export type GuardCounterKey = (typeof COUNTER_KEYS)[number];

export interface GuardPolicy {
	revision: string;
	factoryScope: string;
	workerPeriod: string;
	lockTimeoutMs: number;
	backoffBaseMs: number;
	backoffCapMs: number;
	terminalOverflowCount: number;
	runLimits: GuardCounters;
	factoryLimits: GuardCounters;
}

export interface FactoryGuardState {
	schemaVersion: number;
	factoryScope: string;
	workerPeriod: string;
	policyRevision: string;
	counters: GuardCounters;
	circuitState: GuardCircuitState;
	reasonCode: GuardReasonCode | "";
	overflowCount: number;
	openedAt: string;
	expiresAt: string;
	terminalAt: string;
	lastDecisionAt: string;
	lastDecisionType: string;
	resetCount: number;
	owner: {
		ownerId: string;
		leaseName: string;
		leaseGeneration: number;
	};
	updatedAt: string;
}

export interface GuardDecision {
	allowed: boolean;
	counter: GuardCounterKey | "";
	reasonCode: GuardReasonCode | "";
	circuitState: GuardCircuitState;
	transition: "none" | "open" | "terminal" | "close" | "reset";
	policyRevision: string;
	threshold: number;
	scope: "run" | "factory" | "none";
	backoffMs: number;
	nextAttemptAt: string;
	runCounters: GuardCounters;
	factoryCounters: GuardCounters;
	ownerId: string;
	leaseName: string;
	leaseGeneration: number;
	gateName?: string;
	gateOutcome?: "pass" | "fail";
	gateEvidenceRef?: string;
}

export interface GuardMutationOptions {
	runState: RunState;
	counter: GuardCounterKey;
	nodeId?: string;
	eventBus?: EventBus;
	context?: Record<string, string>;
	now?: Date;
	reasonCodeOverride?: GuardReasonCode;
}

export interface GuardMetadataContext {
	nodeId: string;
	issueNumber: string;
	branch: string;
	milestoneTitle: string;
}

export interface GuardGateOptions {
	runState: RunState;
	nodeId?: string;
	eventBus?: EventBus;
	context?: Record<string, string>;
	now?: Date;
}

export const DEFAULT_POLICY_REVISION = "guard.v1";
const DEFAULT_LOCK_TIMEOUT_MS = 1000;
const DEFAULT_BACKOFF_BASE_MS = 30_000;
const DEFAULT_BACKOFF_CAP_MS = 30 * 60_000;
const DEFAULT_TERMINAL_OVERFLOW_COUNT = 3;

const DEFAULT_RUN_LIMITS: GuardCounters = {
	tool_calls: 1000,
	llm_calls: 400,
	review_retry_calls: 200,
	pipeline_transition_calls: 300,
};

const DEFAULT_FACTORY_LIMITS: GuardCounters = {
	tool_calls: 100_000,
	llm_calls: 40_000,
	review_retry_calls: 20_000,
	pipeline_transition_calls: 30_000,
};

export function createCounters(): GuardCounters {
	return {
		tool_calls: 0,
		llm_calls: 0,
		review_retry_calls: 0,
		pipeline_transition_calls: 0,
	};
}

export function normalizeCounterKey(value: string): GuardCounterKey | null {
	return (COUNTER_KEYS as readonly string[]).includes(value) ? (value as GuardCounterKey) : null;
}

function ensureCounterShape(value: unknown): GuardCounters {
	const base = createCounters();
	if (!value || typeof value !== "object") return base;
	const row = value as Record<string, unknown>;
	return {
		tool_calls: Number(row.tool_calls ?? row.toolCalls ?? 0) || 0,
		llm_calls: Number(row.llm_calls ?? row.llmCalls ?? 0) || 0,
		review_retry_calls: Number(row.review_retry_calls ?? row.reviewRetryCalls ?? 0) || 0,
		pipeline_transition_calls: Number(row.pipeline_transition_calls ?? row.pipelineTransitionCalls ?? 0) || 0,
	};
}

function sanitize(name: string): string {
	return String(name || "default").replace(/[^a-zA-Z0-9._-]/g, "_") || "default";
}

function normalizeGuardScopeCandidate(value: unknown): string {
	const candidate = String(value || "").trim();
	if (!candidate) return "";
	if (candidate.toLowerCase() === "default") return "";
	return candidate;
}

function resolveDefaultFactoryScope(runState: RunState, runContext: Record<string, string> | undefined): string {
	const candidates = [
		runContext?.["factory_id"],
		runContext?.["factory"],
		runContext?.["instance_id"],
		runState.context?.["factory_id"],
		runState.context?.["factory"],
		runState.context?.["instance_id"],
		process.env["HATCH_FACTORY_ID"],
		process.env["HATCH_INSTANCE_ID"],
		runState.guard.factoryScope,
	];
	for (const candidate of candidates) {
		const normalized = normalizeGuardScopeCandidate(candidate);
		if (normalized) return normalized;
	}
	const telemetryIdentity = inferFactoryTelemetryIdentityFromPipelineConfig(runState.pipelineFile || runState.pipeline || "");
	const inferredFactoryId = normalizeGuardScopeCandidate(telemetryIdentity.factory_id || telemetryIdentity.factory);
	if (inferredFactoryId) return inferredFactoryId;
	const pathMatch = String(runState.pipelineFile || runState.pipeline || "").match(/(?:^|\/)factories\/([^/]+)\//);
	return normalizeGuardScopeCandidate(pathMatch?.[1] || "") || "default";
}

function resolveDefaultWorkerPeriod(runState: RunState, runContext: Record<string, string> | undefined): string {
	const candidates = [
		runContext?.["worker_period"],
		runContext?.["guard_worker_period"],
		runState.context?.["worker_period"],
		runState.context?.["guard_worker_period"],
		process.env["HATCH_GUARD_WORKER_PERIOD"],
		runState.guard.workerPeriod,
	];
	for (const candidate of candidates) {
		const normalized = normalizeGuardScopeCandidate(candidate);
		if (normalized) return normalized;
	}
	return "default";
}

export function factoryKey(scope: string, workerPeriod: string): string {
	return `${sanitize(scope)}.${sanitize(workerPeriod)}`;
}

function factoryStatePath(scope: string, workerPeriod: string): string {
	return join(factoryGuardDir(), `${factoryKey(scope, workerPeriod)}.json`);
}

function factoryEventsPath(scope: string, workerPeriod: string): string {
	return join(factoryGuardDir(), `${factoryKey(scope, workerPeriod)}.events.jsonl`);
}

function guardArtifactsDir(runId: string): string {
	return join(runDir(runId), "guard");
}

function guardEventsPath(runId: string): string {
	return join(runDir(runId), "guard-events.jsonl");
}

function ensureDirs(runId: string): void {
	if (!existsSync(guardArtifactsDir(runId))) mkdirSync(guardArtifactsDir(runId), { recursive: true });
	if (!existsSync(factoryGuardDir())) mkdirSync(factoryGuardDir(), { recursive: true });
	if (!existsSync(factoryGuardArtifactsRoot())) mkdirSync(factoryGuardArtifactsRoot(), { recursive: true });
}

export function nowIso(now: Date): string {
	return now.toISOString();
}

function parseIso(value: string): number {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function isOpenAndActive(state: { circuitState: GuardCircuitState; expiresAt: string }, now: Date): boolean {
	if (state.circuitState !== "open") return false;
	const expires = parseIso(state.expiresAt);
	if (!Number.isFinite(expires)) return true;
	return now.getTime() < expires;
}

function hasOpenExpired(state: { circuitState: GuardCircuitState; expiresAt: string }, now: Date): boolean {
	if (state.circuitState !== "open") return false;
	const expires = parseIso(state.expiresAt);
	if (!Number.isFinite(expires)) return false;
	return now.getTime() >= expires;
}

function resolveNumber(
	context: Record<string, string> | undefined,
	keys: string[],
	envKey: string,
	fallback: number,
): number {
	for (const key of keys) {
		const raw = context?.[key];
		if (raw === undefined) continue;
		const n = Number(raw);
		if (Number.isFinite(n) && n >= 0) return n;
	}
	const envRaw = process.env[envKey];
	if (envRaw !== undefined) {
		const n = Number(envRaw);
		if (Number.isFinite(n) && n >= 0) return n;
	}
	return fallback;
}

export function resolvePolicy(runState: RunState, context: Record<string, string> | undefined): GuardPolicy {
	const runContext = context ?? runState.context;
	const revision = String(
		runContext["guard_policy_revision"] ||
			process.env["HATCH_GUARD_POLICY_REVISION"] ||
			runState.guard.policyRevision ||
			DEFAULT_POLICY_REVISION,
	);
	const explicitFactoryScope = normalizeGuardScopeCandidate(
		runContext["guard_factory_scope"] || process.env["HATCH_GUARD_FACTORY_SCOPE"],
	);
	const explicitWorkerPeriod = normalizeGuardScopeCandidate(
		runContext["guard_worker_period"] || process.env["HATCH_GUARD_WORKER_PERIOD"],
	);
	const factoryScope = explicitFactoryScope || resolveDefaultFactoryScope(runState, runContext);
	const workerPeriod = explicitWorkerPeriod || resolveDefaultWorkerPeriod(runState, runContext);

	const lockTimeoutMs = resolveNumber(runContext, ["guard_lock_timeout_ms"], "HATCH_GUARD_LOCK_TIMEOUT_MS", DEFAULT_LOCK_TIMEOUT_MS);
	const backoffBaseMs = resolveNumber(runContext, ["guard_backoff_base_ms"], "HATCH_GUARD_BACKOFF_BASE_MS", DEFAULT_BACKOFF_BASE_MS);
	const backoffCapMs = resolveNumber(runContext, ["guard_backoff_cap_ms"], "HATCH_GUARD_BACKOFF_CAP_MS", DEFAULT_BACKOFF_CAP_MS);
	const terminalOverflowCount = Math.max(
		1,
		Math.floor(
			resolveNumber(
				runContext,
				["guard_terminal_overflow_count"],
				"HATCH_GUARD_TERMINAL_OVERFLOW_COUNT",
				DEFAULT_TERMINAL_OVERFLOW_COUNT,
			),
		),
	);

	const runLimits: GuardCounters = {
		tool_calls: resolveNumber(runContext, ["guard_run_max_tool_calls"], "HATCH_GUARD_RUN_MAX_TOOL_CALLS", DEFAULT_RUN_LIMITS.tool_calls),
		llm_calls: resolveNumber(runContext, ["guard_run_max_llm_calls"], "HATCH_GUARD_RUN_MAX_LLM_CALLS", DEFAULT_RUN_LIMITS.llm_calls),
		review_retry_calls: resolveNumber(
			runContext,
			["guard_run_max_review_retry_calls"],
			"HATCH_GUARD_RUN_MAX_REVIEW_RETRY_CALLS",
			DEFAULT_RUN_LIMITS.review_retry_calls,
		),
		pipeline_transition_calls: resolveNumber(
			runContext,
			["guard_run_max_pipeline_transition_calls"],
			"HATCH_GUARD_RUN_MAX_PIPELINE_TRANSITION_CALLS",
			DEFAULT_RUN_LIMITS.pipeline_transition_calls,
		),
	};

	const factoryLimits: GuardCounters = {
		tool_calls: resolveNumber(
			runContext,
			["guard_factory_max_tool_calls"],
			"HATCH_GUARD_FACTORY_MAX_TOOL_CALLS",
			DEFAULT_FACTORY_LIMITS.tool_calls,
		),
		llm_calls: resolveNumber(
			runContext,
			["guard_factory_max_llm_calls"],
			"HATCH_GUARD_FACTORY_MAX_LLM_CALLS",
			DEFAULT_FACTORY_LIMITS.llm_calls,
		),
		review_retry_calls: resolveNumber(
			runContext,
			["guard_factory_max_review_retry_calls"],
			"HATCH_GUARD_FACTORY_MAX_REVIEW_RETRY_CALLS",
			DEFAULT_FACTORY_LIMITS.review_retry_calls,
		),
		pipeline_transition_calls: resolveNumber(
			runContext,
			["guard_factory_max_pipeline_transition_calls"],
			"HATCH_GUARD_FACTORY_MAX_PIPELINE_TRANSITION_CALLS",
			DEFAULT_FACTORY_LIMITS.pipeline_transition_calls,
		),
	};

	return {
		revision,
		factoryScope,
		workerPeriod,
		lockTimeoutMs,
		backoffBaseMs,
		backoffCapMs,
		terminalOverflowCount,
		runLimits,
		factoryLimits,
	};
}

function createFactoryGuardState(policy: GuardPolicy, ownerId: string, now: Date): FactoryGuardState {
	return {
		schemaVersion: FACTORY_GUARD_SCHEMA_VERSION,
		factoryScope: policy.factoryScope,
		workerPeriod: policy.workerPeriod,
		policyRevision: policy.revision,
		counters: createCounters(),
		circuitState: "closed",
		reasonCode: "",
		overflowCount: 0,
		openedAt: "",
		expiresAt: "",
		terminalAt: "",
		lastDecisionAt: nowIso(now),
		lastDecisionType: "initialized",
		resetCount: 0,
		owner: {
			ownerId,
			leaseName: "",
			leaseGeneration: 0,
		},
		updatedAt: nowIso(now),
	};
}

function normalizeFactoryGuardState(value: unknown, policy: GuardPolicy, ownerId: string, now: Date): FactoryGuardState {
	if (!value || typeof value !== "object") return createFactoryGuardState(policy, ownerId, now);
	const raw = value as Record<string, unknown>;
	const ownerRaw = raw.owner as Record<string, unknown> | undefined;
	const circuit = canonicalCircuitState(raw.circuitState);
	return {
		schemaVersion: FACTORY_GUARD_SCHEMA_VERSION,
		factoryScope: String(raw.factoryScope || policy.factoryScope),
		workerPeriod: String(raw.workerPeriod || policy.workerPeriod),
		policyRevision: String(raw.policyRevision || policy.revision),
		counters: ensureCounterShape(raw.counters),
		circuitState: circuit,
		reasonCode: typeof raw.reasonCode === "string" ? (raw.reasonCode as GuardReasonCode) : "",
		overflowCount: Number(raw.overflowCount ?? 0) || 0,
		openedAt: String(raw.openedAt || ""),
		expiresAt: String(raw.expiresAt || ""),
		terminalAt: String(raw.terminalAt || ""),
		lastDecisionAt: String(raw.lastDecisionAt || ""),
		lastDecisionType: String(raw.lastDecisionType || ""),
		resetCount: Number(raw.resetCount ?? 0) || 0,
		owner: {
			ownerId: String(ownerRaw?.ownerId || ownerId),
			leaseName: String(ownerRaw?.leaseName || ""),
			leaseGeneration: Number(ownerRaw?.leaseGeneration ?? 0) || 0,
		},
		updatedAt: String(raw.updatedAt || nowIso(now)),
	};
}

function canonicalCircuitState(value: unknown): GuardCircuitState {
	const raw = String(value || "").toLowerCase();
	if (raw === "open" || raw === "circuit_open") return "open";
	if (raw === "terminal" || raw === "tripped" || raw === "circuit_terminal") return "terminal";
	return "closed";
}

export function loadFactoryGuardState(policy: GuardPolicy, ownerId: string, now: Date): FactoryGuardState {
	const path = factoryStatePath(policy.factoryScope, policy.workerPeriod);
	if (!existsSync(path)) return createFactoryGuardState(policy, ownerId, now);
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		return normalizeFactoryGuardState(parsed, policy, ownerId, now);
	} catch {
		return createFactoryGuardState(policy, ownerId, now);
	}
}

export function saveFactoryGuardState(policy: GuardPolicy, state: FactoryGuardState): void {
	if (!existsSync(factoryGuardDir())) mkdirSync(factoryGuardDir(), { recursive: true });
	const path = factoryStatePath(policy.factoryScope, policy.workerPeriod);
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, JSON.stringify(state, null, 2));
	renameSync(tmp, path);
}

export function computeBackoffMs(policy: GuardPolicy, overflowCount: number): number {
	if (overflowCount <= 0) return 0;
	const exp = Math.max(0, overflowCount - 1);
	return Math.min(policy.backoffCapMs, policy.backoffBaseMs * 2 ** exp);
}

export function mapReason(scope: "run" | "factory", counter: GuardCounterKey): GuardReasonCode {
	const prefix = scope === "run" ? "run" : "factory";
	if (counter === "tool_calls") return `${prefix}_tool_budget_exceeded` as GuardReasonCode;
	if (counter === "llm_calls") return `${prefix}_llm_budget_exceeded` as GuardReasonCode;
	if (counter === "review_retry_calls") return `${prefix}_review_retry_budget_exceeded` as GuardReasonCode;
	if (counter === "pipeline_transition_calls") return `${prefix}_pipeline_transition_budget_exceeded` as GuardReasonCode;
	return "recursive_reentry_overflow";
}

function appendJsonl(path: string, payload: unknown): void {
	appendFileSync(path, `${JSON.stringify(payload)}\n`);
}

function compactStamp(now: Date): string {
	return now.toISOString().replace(/[:.]/g, "-");
}

function decisionKind(decision: GuardDecision): "guard.decision" | "guard.transition" {
	return decision.transition === "none" ? "guard.decision" : "guard.transition";
}

function writeDecisionArtifact(
	runState: RunState,
	policy: GuardPolicy,
	decision: GuardDecision,
	nodeId: string,
	now: Date,
): string {
	const fileName = `${compactStamp(now)}.${sanitize(nodeId || "unknown")}.${sanitize(decision.counter || "none")}.${sanitize(
		decision.transition,
	)}.json`;
	const path = join(guardArtifactsDir(runState.runId), fileName);
	writeFileSync(
		path,
		JSON.stringify(
			{
				schemaVersion: 1,
				ts: nowIso(now),
				runId: runState.runId,
				nodeId,
				policyRevision: policy.revision,
				factoryScope: policy.factoryScope,
				workerPeriod: policy.workerPeriod,
				decision,
				guard_metadata: runState.guard.metadata ?? null,
			},
			null,
			2,
		),
	);
	return path;
}

export function emitDecision(
	runState: RunState,
	policy: GuardPolicy,
	decision: GuardDecision,
	nodeId: string,
	now: Date,
	eventBus?: EventBus,
	eventContext?: Record<string, string>,
): string {
	ensureDirs(runState.runId);
	const artifactPath = writeDecisionArtifact(runState, policy, decision, nodeId, now);
	decision.gateName = decision.gateName || gateNameForDecision(decision);
	decision.gateOutcome = decision.gateOutcome || gateOutcomeForDecision(decision);
	decision.gateEvidenceRef = decision.gateEvidenceRef || gateEvidenceRefForArtifact({
		runState,
		nodeId,
		artifactPath,
		decision,
		nowIso: nowIso(now),
	});
	const kind = decisionKind(decision);
	const payload = {
		schemaVersion: 1,
		ts: nowIso(now),
		runId: runState.runId,
		nodeId,
		kind,
		policyRevision: policy.revision,
		factoryScope: policy.factoryScope,
		workerPeriod: policy.workerPeriod,
		artifactPath,
		decision,
		guard_metadata: runState.guard.metadata ?? null,
	};
	appendJsonl(guardEventsPath(runState.runId), payload);
	appendJsonl(factoryEventsPath(policy.factoryScope, policy.workerPeriod), payload);

	if (eventBus) {
		const telemetry = buildGuardEventTelemetry({
			runState,
			decision,
			nodeId,
			kind,
			artifactPath,
			policyRevision: policy.revision,
			factoryScope: policy.factoryScope,
			workerPeriod: policy.workerPeriod,
			eventContext,
		});
		eventBus.emit({
			kind,
			nodeId,
			traceId: telemetry.traceId,
			message: decision.reasonCode,
			data: telemetry.data,
		});
	}

	const factoryArtifact = join(
		factoryGuardArtifactsRoot(),
		`${compactStamp(now)}.${sanitize(policy.factoryScope)}.${sanitize(policy.workerPeriod)}.${sanitize(runState.runId)}.json`,
	);
	writeFileSync(factoryArtifact, JSON.stringify(payload, null, 2));

	return artifactPath;
}

export function finalizeOpenToClosed(state: RunGuardState | FactoryGuardState, now: Date): boolean {
	if (!hasOpenExpired(state, now)) return false;
	state.circuitState = "closed";
	state.reasonCode = "";
	state.openedAt = "";
	state.expiresAt = "";
	state.lastDecisionAt = nowIso(now);
	state.lastDecisionType = "expiry_release";
	return true;
}

export function snapshotOwner(runState: RunState, leaseName: string): { ownerId: string; leaseName: string; leaseGeneration: number } {
	const lease = readLease(leaseName);
	return {
		ownerId: runState.guard.owner.ownerId,
		leaseName,
		leaseGeneration: lease?.generation ?? 0,
	};
}

export function persistRunGuard(runState: RunState, policy: GuardPolicy): void {
	runState.guard.policyRevision = policy.revision;
	runState.guard.factoryScope = policy.factoryScope;
	runState.guard.workerPeriod = policy.workerPeriod;
	saveRunState(runState, { updateMetadata: true });
}
