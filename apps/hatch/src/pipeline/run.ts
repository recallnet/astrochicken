/**
 * Run state management for hatch pipelines.
 *
 * Every hatch run gets a run directory under .hatch/<factory_id>/runs/<run-id>/
 * (or legacy .hatch/runs/<run-id>/ when no factory scope is resolved) containing:
 *   state.json    — Engine position + context
 *   events.jsonl  — Full event trace
 *   sessions/     — Persistent agent session data
 */

import { randomBytes, createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

import {
	isTerminalRunStatus,
	loadRunAlignmentSummary,
	runAlignmentSummaryPath,
	writeRunAlignmentSummary,
	type RunAlignmentSummary,
} from "./alignment-summary.js";
import { StageStatus, type StageRecord } from "./context.js";
import { writeRunArtifactContract } from "./run-artifact-contract.js";
import { appendRunLifecycleEvents } from "./run-lifecycle.js";
import {
	formatFactoryConfigIssue,
	parseFactoryConfigDocument,
	validateFactoryConfigDocument,
} from "../factory/config-schema.js";
import { assertPathDoesNotRecreateConfiguredRepo } from "../factory/repo-path-health.js";

/** CompletedNode records a node that finished execution. */
export interface CompletedNode {
	id: string;
	completedAt: string;
	outputHash: string;
}

/** Canonical normalized reasons for composite child failures. */
export type ActiveChildFailureReason = "child_failed" | "child_timeout" | "child_aborted";
export interface ActiveChildFailure {
	reason: ActiveChildFailureReason | "";
	childId: string;
	nodeId: string;
	runId: string;
}
export interface ActiveChildExportWriteback {
	status: "pending" | "applied" | "skipped";
	reason: string;
}
export type ActiveChildRole = "coder" | "reviewer" | "manager" | "judge";

/** ActiveChild tracks a running child pipeline (from fan-out or pipeline node). */
export interface ActiveChild {
	childId: string;
	parentNodeId: string;
	childRunId: string;
	childRunDir: string;
	pipelineFile: string;
	role?: ActiveChildRole;
	workerIndex?: number;
	sessionId?: string;
	traceKind?: string;
	branch?: string;
	worktreeDir?: string;
	status: "running" | "completed" | "failed";
	currentNode?: string;
	failure?: ActiveChildFailure;
	exportWriteback?: ActiveChildExportWriteback;
}

/** RunStatus represents the lifecycle state of a run. */
export type RunStatus =
	| "running"
	| "completed"
	| "suspended"
	| "failed"
	| "queued"
	| "guarded"
	| "guarded_terminal";
export const RUN_STATE_SCHEMA_VERSION = 2;
export const RUN_METADATA_SCHEMA_VERSION = 1;
/** Guard counters are persisted per run and per factory scope. */
export interface GuardCounters {
	tool_calls: number;
	llm_calls: number;
	review_retry_calls: number;
	pipeline_transition_calls: number;
}
/** Circuit breaker state for guard policy evaluation. */
export type GuardCircuitState = "closed" | "open" | "terminal";
/** Stable reason codes for guard policy decisions. */
export type GuardReasonCode =
	| "run_tool_budget_exceeded"
	| "run_llm_budget_exceeded"
	| "run_review_retry_budget_exceeded"
	| "run_pipeline_transition_budget_exceeded"
	| "factory_tool_budget_exceeded"
	| "factory_llm_budget_exceeded"
	| "factory_review_retry_budget_exceeded"
	| "factory_pipeline_transition_budget_exceeded"
	| "recursive_reentry_overflow"
	| "guard_lease_unavailable"
	| "guard_reset"
	| "guard_backoff_active"
	| "guard_terminal_state";
export interface GuardDecisionMetadata {
	reasonCode: GuardReasonCode | "";
	nodeId: string;
	issueNumber: string;
	branch: string;
	milestoneTitle: string;
	capturedAt: string;
}
export interface GuardOwnerSnapshot {
	ownerId: string;
	leaseName: string;
	leaseGeneration: number;
}
/** Run-scoped durable guard state. */
export interface RunGuardState {
	policyRevision: string;
	factoryScope: string;
	workerPeriod: string;
	counters: GuardCounters;
	factoryCounters: GuardCounters;
	circuitState: GuardCircuitState;
	reasonCode: GuardReasonCode | "";
	metadata: GuardDecisionMetadata | null;
	overflowCount: number;
	openedAt: string;
	expiresAt: string;
	terminalAt: string;
	lastDecisionAt: string;
	lastDecisionType: string;
	resetCount: number;
	owner: GuardOwnerSnapshot;
}

/** Recovery reason codes for stale run handling. */
export type RunRecoveryReasonCode = "stale_pid" | "stale_heartbeat" | "metadata_missing";

/** RunMetadata captures local heartbeat + recovery info. */
export interface RunMetadata {
	runId: string;
	status: RunStatus;
	pid: number | null;
	heartbeatAt: string;
	updatedAt: string;
	requeueAttempted: boolean;
	reasonCode?: RunRecoveryReasonCode;
}

/** RunState is the persistent state.json structure. */
export interface RunState {
	schemaVersion: number;
	runId: string;
	pipelineFile: string;
	/** Legacy alias retained for compatibility with ops readers. */
	pipeline?: string;
	pid: number;
	status: RunStatus;
	startedAt: string;
	updatedAt: string;
	currentNode: string;
	/** ISO timestamp of when the current node started executing. */
	nodeStartedAt?: string;
	lastOutput: string;
	context: Record<string, string>;
	completedNodes: CompletedNode[];
	activeChildren: Record<string, ActiveChild>;
	locksHeld: string[];
	records: StageRecord[];
	guard: RunGuardState;
}

/** Generate a short run ID. */
export function generateRunId(): string {
	return randomBytes(4).toString("hex");
}

export function createChildId(parentNodeId: string, iteration: string | number): string {
	const node = String(parentNodeId || "").trim();
	const suffix = String(iteration ?? "").trim();
	if (!node && !suffix) return "";
	if (!node) return suffix;
	if (!suffix) return node;
	return `${node}__${suffix}`;
}

let scopedRunsDir = "";
const lifecycleProjectionEmitters = new Map<string, (events: import("./run-lifecycle.js").RunLifecycleEvent[]) => void>();

export interface RunStorageScopeOptions {
	runsDir?: string;
	factoryId?: string;
	pipelineFile?: string;
}

export type FactoryConfigValidationStatus = "valid" | "missing" | "invalid";

export interface FactoryConfigValidation {
	status: FactoryConfigValidationStatus;
	configPath: string;
	issuePath: string;
	message: string;
	warning: string;
}

export interface FactoryConfigTelemetryIdentity {
	factory: string;
	factory_id: string;
	repo: string;
	validation: FactoryConfigValidation;
}

function normalizeFactoryId(value: string): string {
	return String(value || "").trim();
}

function validationWarning(path: string, message: string): string {
	const location = path || "(none)";
	return `[factory-config] status=invalid path=${location} reason=${message}`;
}

function missingFactoryConfigWarning(startDir: string): string {
	return `[factory-config] status=missing search_start=${startDir || "(none)"}`;
}

export function findNearestFactoryConfigPath(pipelineFile: string): string {
	let current = resolve(dirname(pipelineFile));
	let previous = "";
	while (current && current !== previous) {
		const candidate = join(current, "factory.config.json");
		if (existsSync(candidate)) return candidate;
		previous = current;
		current = dirname(current);
	}
	return "";
}

export function inferFactoryTelemetryIdentityFromPipelineConfig(pipelineFile: string): FactoryConfigTelemetryIdentity {
	if (!pipelineFile) {
		return {
			factory: "",
			factory_id: "",
			repo: "",
			validation: {
				status: "missing",
				configPath: "",
				issuePath: "",
				message: "factory config not found",
				warning: missingFactoryConfigWarning(""),
			},
		};
	}

	const startDir = resolve(dirname(pipelineFile));
	const candidate = findNearestFactoryConfigPath(pipelineFile);
	if (!candidate) {
		return {
			factory: "",
			factory_id: "",
			repo: "",
			validation: {
				status: "missing",
				configPath: "",
				issuePath: "",
				message: "factory config not found",
				warning: missingFactoryConfigWarning(startDir),
			},
		};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(candidate, "utf8"));
	} catch (err) {
		const message = `invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
		return {
			factory: "",
			factory_id: "",
			repo: "",
			validation: {
				status: "invalid",
				configPath: candidate,
				issuePath: "(root)",
				message,
				warning: validationWarning(candidate, message),
			},
		};
	}

	const issues = validateFactoryConfigDocument(parsed);
	if (issues.length > 0) {
		const first = issues[0];
		const message = formatFactoryConfigIssue(first);
		return {
			factory: "",
			factory_id: "",
			repo: "",
			validation: {
				status: "invalid",
				configPath: candidate,
				issuePath: first.path,
				message,
				warning: validationWarning(candidate, message),
			},
		};
	}

	const config = parseFactoryConfigDocument(parsed);
	const factoryId = normalizeFactoryId(config.factory_id);
	return {
		factory: factoryId,
		factory_id: factoryId,
		repo: String(config.target_repo || "").trim(),
		validation: {
			status: "valid",
			configPath: candidate,
			issuePath: "",
			message: "",
			warning: "",
		},
	};
}

export function inferFactoryIdFromPipelineConfig(pipelineFile: string): string {
	return inferFactoryTelemetryIdentityFromPipelineConfig(pipelineFile).factory_id;
}

// Legacy fallback path remains .hatch/runs when no factory scope is available.
function resolveDefaultRunsDir(options: RunStorageScopeOptions = {}): string {
	const explicitFactoryId = normalizeFactoryId(options.factoryId || process.env["HATCH_FACTORY_ID"] || "");
	const configFactoryId = normalizeFactoryId(
		options.pipelineFile ? inferFactoryIdFromPipelineConfig(options.pipelineFile) : "",
	);
	const factoryId = explicitFactoryId || configFactoryId;
	const hostBaseDir = String(process.env["HATCH_HOST_BASE_DIR"] || "").trim();
	if (hostBaseDir && factoryId) {
		return resolve(hostBaseDir, factoryId, "runs");
	}
	if (factoryId) {
		return resolve(process.cwd(), ".hatch", factoryId, "runs");
	}
	return resolve(process.cwd(), ".hatch", "runs");
}

export function configureRunStorageScope(options: RunStorageScopeOptions = {}): string {
	const explicitRunsDir = String(options.runsDir || process.env["HATCH_RUNS_DIR"] || "").trim();
	scopedRunsDir = explicitRunsDir || resolveDefaultRunsDir(options);
	assertPathDoesNotRecreateConfiguredRepo(scopedRunsDir, { label: "runs_dir" });
	return scopedRunsDir;
}

/** Get the active runs directory for this process. */
export function runsDir(): string {
	if (!scopedRunsDir) {
		scopedRunsDir = configureRunStorageScope();
	}
	return scopedRunsDir;
}

/** Get the run directory for a specific run ID. */
export function runDir(runId: string): string {
	return join(runsDir(), runId);
}

/** Get the run metadata path for a specific run ID. */
export function runMetadataPath(runId: string): string {
	return join(runDir(runId), "metadata.json");
}

export function createGuardCounters(): GuardCounters {
	return {
		tool_calls: 0,
		llm_calls: 0,
		review_retry_calls: 0,
		pipeline_transition_calls: 0,
	};
}

function inferDefaultGuardFactoryScope(
	pipelineFile: string,
	scope: RunStorageScopeOptions = {},
): string {
	const explicitFactoryId = normalizeFactoryId(scope.factoryId || "");
	if (explicitFactoryId) return explicitFactoryId;
	const envFactoryId = normalizeFactoryId(process.env["HATCH_FACTORY_ID"] || process.env["HATCH_INSTANCE_ID"] || "");
	if (envFactoryId) return envFactoryId;
	const telemetryIdentity = inferFactoryTelemetryIdentityFromPipelineConfig(pipelineFile);
	const inferredFactoryId = normalizeFactoryId(telemetryIdentity.factory_id || telemetryIdentity.factory || "");
	if (inferredFactoryId) return inferredFactoryId;
	const pathMatch = String(pipelineFile || "").match(/(?:^|\/)factories\/([^/]+)\//);
	const pathFactoryId = normalizeFactoryId(pathMatch?.[1] || "");
	if (pathFactoryId) return pathFactoryId;
	return "default";
}

export function createDefaultRunGuardState(runId: string, options: { factoryScope?: string; workerPeriod?: string } = {}): RunGuardState {
	return {
		policyRevision: "guard.v1",
		factoryScope: normalizeFactoryId(options.factoryScope || "") || "default",
		workerPeriod: normalizeFactoryId(options.workerPeriod || "") || "default",
		counters: createGuardCounters(),
		factoryCounters: createGuardCounters(),
		circuitState: "closed",
		reasonCode: "",
		metadata: null,
		overflowCount: 0,
		openedAt: "",
		expiresAt: "",
		terminalAt: "",
		lastDecisionAt: "",
		lastDecisionType: "",
		resetCount: 0,
		owner: {
			ownerId: `run:${runId}`,
			leaseName: "",
			leaseGeneration: 0,
		},
	};
}

/** Create a new run state. */
export function createRunState(runId: string, pipelineFile: string, scope: RunStorageScopeOptions = {}): RunState {
	configureRunStorageScope({ pipelineFile, ...scope });
	const now = new Date().toISOString();
	const factoryScope = inferDefaultGuardFactoryScope(pipelineFile, scope);
	return {
		schemaVersion: RUN_STATE_SCHEMA_VERSION,
		runId,
		pipelineFile,
		pipeline: pipelineFile,
		pid: process.pid,
		status: "running",
		startedAt: now,
		updatedAt: now,
		currentNode: "",
		lastOutput: "",
		context: {},
		completedNodes: [],
		activeChildren: {},
		locksHeld: [],
		records: [],
		guard: createDefaultRunGuardState(runId, { factoryScope }),
	};
}

export interface SaveRunStateOptions {
	now?: Date;
	updatePid?: boolean;
	updateMetadata?: boolean;
}

function readPersistedRunState(statePath: string, fallbackRunId: string): RunState | null {
	if (!existsSync(statePath)) return null;
	try {
		const raw = JSON.parse(readFileSync(statePath, "utf8")) as unknown;
		return migrateRunState(raw, fallbackRunId);
	} catch {
		return null;
	}
}

/** Save run state atomically (write to temp + rename). */
export function saveRunState(state: RunState, options: SaveRunStateOptions = {}): void {
	const dir = runDir(state.runId);
	assertPathDoesNotRecreateConfiguredRepo(dir, { label: "run_state_dir" });
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	const now = options.now ?? new Date();
	const updatePid = options.updatePid ?? true;
	const updateMetadata = options.updateMetadata ?? false;

	state.schemaVersion = RUN_STATE_SCHEMA_VERSION;
	state.pipeline = state.pipelineFile;
	state.guard = normalizeRunGuardState(state.runId, state.guard);
	state.updatedAt = now.toISOString();
	if (updatePid) {
		state.pid = process.pid;
	}

	// Serialize with date conversion for records
	const serializable = {
		...state,
		records: state.records.map((r) => ({
			...r,
			startedAt: r.startedAt instanceof Date ? r.startedAt.toISOString() : r.startedAt,
			endedAt: r.endedAt instanceof Date ? r.endedAt.toISOString() : r.endedAt,
		})),
	};

	const statePath = join(dir, "state.json");
	const previousState = readPersistedRunState(statePath, state.runId);
	const tmpPath = `${statePath}.${randomUUID()}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(serializable, null, 2));
	renameSync(tmpPath, statePath);
	appendRunLifecycleEvents({
		previous: previousState,
		current: state,
		nowIso: state.updatedAt,
		path: lifecycleEventsPath(state.runId),
		onEvents: lifecycleProjectionEmitters.get(state.runId),
	});

	if (updateMetadata) {
		const metadata = buildRunMetadataFromState(state, now);
		saveRunMetadata(metadata, { now, touchUpdatedAt: false });
	}

	let alignmentSummary: RunAlignmentSummary | null = null;
	if (isTerminalRunStatus(state.status)) {
		const terminalAt =
			state.status === "guarded_terminal" && state.guard.terminalAt
				? state.guard.terminalAt
				: now.toISOString();
		alignmentSummary = writeRunAlignmentSummary({
			runId: state.runId,
			runDirectory: dir,
			pipelineFile: state.pipelineFile,
			status: state.status,
			startedAt: state.startedAt,
			terminalAt,
			context: state.context,
			records: state.records,
			now,
		});
	}

	writeRunArtifactContract({
		state,
		runDirectory: dir,
		now,
		alignmentSummary,
	});
}

/** Load run state from disk. */
export function loadRunState(runId: string): RunState | null {
	const statePath = join(runDir(runId), "state.json");
	if (!existsSync(statePath)) return null;

	try {
		const data = JSON.parse(readFileSync(statePath, "utf-8")) as unknown;
		const migrated = migrateRunState(data, runId);
		if (!migrated) return null;
		return migrated;
	} catch {
		return null;
	}
}

export interface SaveRunMetadataOptions {
	now?: Date;
	touchUpdatedAt?: boolean;
}

/** Load run metadata from disk. */
export function loadRunMetadata(runId: string): RunMetadata | null {
	const metadataPath = runMetadataPath(runId);
	if (!existsSync(metadataPath)) return null;

	try {
		const data = JSON.parse(readFileSync(metadataPath, "utf-8"));
		if (!isRunMetadata(data)) return null;
		return {
			...data,
			status: canonicalRunStatus(data.status),
		};
	} catch {
		return null;
	}
}

/** Save run metadata atomically (write to temp + rename). */
export function saveRunMetadata(metadata: RunMetadata, options: SaveRunMetadataOptions = {}): void {
	const dir = runDir(metadata.runId);
	assertPathDoesNotRecreateConfiguredRepo(dir, { label: "run_metadata_dir" });
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	const now = options.now ?? new Date();
	if (options.touchUpdatedAt !== false) {
		metadata.updatedAt = now.toISOString();
	}

	const metadataPath = runMetadataPath(metadata.runId);
	const tmpPath = metadataPath + ".tmp";
	writeFileSync(tmpPath, JSON.stringify(metadata, null, 2));
	renameSync(tmpPath, metadataPath);
}

function migrateRunState(value: unknown, fallbackRunId: string): RunState | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as Record<string, unknown>;

	const runId = typeof raw.runId === "string" && raw.runId.trim() ? raw.runId : fallbackRunId;
	const pipelineFile =
		typeof raw.pipelineFile === "string" && raw.pipelineFile.trim()
			? raw.pipelineFile
			: typeof raw.pipeline === "string" && raw.pipeline.trim()
				? raw.pipeline
				: "";
	if (!pipelineFile) return null;

	const nowIso = new Date().toISOString();
	const status = canonicalRunStatus(raw.status);
	const guard = normalizeRunGuardState(runId, raw.guard as Partial<RunGuardState> | undefined);
	const records = Array.isArray(raw.records)
		? raw.records.map((r) => {
			const record = r as Record<string, unknown>;
			return {
				nodeId: String(record.nodeId || ""),
				status: (record.status as StageStatus) || StageStatus.Failed,
				outcome: record.outcome as StageRecord["outcome"],
				startedAt: new Date(String(record.startedAt || nowIso)),
				endedAt: record.endedAt ? new Date(String(record.endedAt)) : undefined,
				attempt: Number(record.attempt ?? 1) || 1,
			} satisfies StageRecord;
		})
		: [];

	return {
		schemaVersion: RUN_STATE_SCHEMA_VERSION,
		runId,
		pipelineFile,
		pipeline: pipelineFile,
		pid: Number(raw.pid ?? process.pid) || process.pid,
		status,
		startedAt: String(raw.startedAt || nowIso),
		updatedAt: String(raw.updatedAt || nowIso),
		currentNode: String(raw.currentNode || ""),
		lastOutput: String(raw.lastOutput || ""),
		context: normalizeStringRecord(raw.context),
		completedNodes: normalizeCompletedNodes(raw.completedNodes),
		activeChildren: normalizeActiveChildren(raw.activeChildren),
		locksHeld: normalizeStringList(raw.locksHeld),
		records,
		guard,
	};
}

function normalizeStringRecord(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object") return {};
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		out[k] = typeof v === "string" ? v : JSON.stringify(v);
	}
	return out;
}

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((item) => String(item)).filter((item) => item.length > 0);
}

function normalizeCompletedNodes(value: unknown): CompletedNode[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => {
			const row = entry as Record<string, unknown>;
			const id = String(row.id || "");
			if (!id) return null;
			return {
				id,
				completedAt: String(row.completedAt || ""),
				outputHash: String(row.outputHash || ""),
			} satisfies CompletedNode;
		})
		.filter((entry): entry is CompletedNode => entry !== null);
}

function normalizeActiveChildren(value: unknown): Record<string, ActiveChild> {
	if (!value || typeof value !== "object") return {};
	const out: Record<string, ActiveChild> = {};
	for (const [entryKey, row] of Object.entries(value as Record<string, unknown>)) {
		if (!row || typeof row !== "object") continue;
		const child = row as Record<string, unknown>;
		const status = canonicalChildStatus(child.status);
		const childRunDir = String(child.childRunDir || child.child_run_dir || "");
		const childRunId = normalizeChildRunId(child.childRunId ?? child.child_run_id, childRunDir);
		const parentNodeId = normalizeParentNodeId(child.parentNodeId ?? child.parent_node_id, entryKey, childRunId);
		const resolvedChildId = normalizeChildEntryId(child.childId ?? child.child_id, entryKey, parentNodeId, childRunId);

		const failureRaw = child.failure && typeof child.failure === "object"
			? (child.failure as Record<string, unknown>)
			: null;
		const failure = failureRaw
			? {
				reason: canonicalChildFailureReason(failureRaw.reason),
				childId: String(failureRaw.childId || resolvedChildId),
				nodeId: String(failureRaw.nodeId || ""),
				runId: String(failureRaw.runId || childRunId),
			}
			: undefined;
		const exportWritebackRaw = child.exportWriteback && typeof child.exportWriteback === "object"
			? (child.exportWriteback as Record<string, unknown>)
			: null;
		const exportWriteback = exportWritebackRaw
			? {
				status: canonicalChildExportWritebackStatus(exportWritebackRaw.status),
				reason: String(exportWritebackRaw.reason || ""),
			}
			: undefined;
		const role = canonicalActiveChildRole(child.role);
		const workerIndex = normalizeWorkerIndex(child.workerIndex ?? child.worker_index);
		const childEntry: ActiveChild = {
			childId: resolvedChildId,
			parentNodeId,
			childRunId,
			childRunDir,
			pipelineFile: String(child.pipelineFile || ""),
			role: role || undefined,
			workerIndex,
			sessionId: child.sessionId || child.session_id ? String(child.sessionId || child.session_id) : undefined,
			traceKind: child.traceKind || child.trace_kind ? String(child.traceKind || child.trace_kind) : role || undefined,
			branch: child.branch || child.branch_name ? String(child.branch || child.branch_name) : undefined,
			worktreeDir: child.worktreeDir || child.worktree_dir ? String(child.worktreeDir || child.worktree_dir) : undefined,
			status,
			currentNode: child.currentNode ? String(child.currentNode) : undefined,
			failure,
			exportWriteback,
		};
		if (!childEntry.traceKind) childEntry.traceKind = role || "run";
		if (!childEntry.childId) childEntry.childId = resolvedChildId || entryKey;
		out[childEntry.childId] = childEntry;
	}
	return out;
}

function normalizeChildRunId(value: unknown, childRunDir: string): string {
	const explicit = String(value || "").trim();
	if (explicit) return explicit;
	if (!childRunDir) return "";
	const trimmed = childRunDir.endsWith("/") ? childRunDir.slice(0, -1) : childRunDir;
	const parts = trimmed.split("/");
	return parts[parts.length - 1] || "";
}

function normalizeParentNodeId(value: unknown, entryKey: string, childRunId: string): string {
	const explicit = String(value || "").trim();
	if (explicit) return explicit;
	const key = String(entryKey || "").trim();
	if (!key) return "";
	if (childRunId && key.endsWith(`__${childRunId}`)) {
		return key.slice(0, Math.max(0, key.length - (`__${childRunId}`).length));
	}
	return key;
}

function normalizeChildEntryId(
	value: unknown,
	entryKey: string,
	parentNodeId: string,
	childRunId: string,
): string {
	const explicit = String(value || "").trim();
	if (explicit) return explicit;
	if (parentNodeId && childRunId) return createChildId(parentNodeId, childRunId);
	return String(entryKey || "").trim() || parentNodeId;
}

function normalizeWorkerIndex(value: unknown): number | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) return undefined;
	return Math.floor(parsed);
}

function canonicalActiveChildRole(value: unknown): ActiveChildRole | "" {
	const raw = String(value || "").trim().toLowerCase();
	if (raw === "coder") return "coder";
	if (raw === "reviewer") return "reviewer";
	if (raw === "manager") return "manager";
	if (raw === "judge") return "judge";
	return "";
}

function canonicalChildStatus(value: unknown): ActiveChild["status"] {
	const raw = String(value || "").toLowerCase();
	if (raw === "completed") return "completed";
	if (raw === "failed") return "failed";
	return "running";
}

function canonicalChildFailureReason(value: unknown): ActiveChildFailureReason | "" {
	const raw = String(value || "").trim();
	if (raw === "child_failed") return "child_failed";
	if (raw === "child_timeout") return "child_timeout";
	if (raw === "child_aborted") return "child_aborted";
	return "";
}

function canonicalChildExportWritebackStatus(value: unknown): ActiveChildExportWriteback["status"] {
	const raw = String(value || "").toLowerCase();
	if (raw === "applied") return "applied";
	if (raw === "skipped") return "skipped";
	return "pending";
}

function normalizeGuardCounters(value: unknown): GuardCounters {
	const base = createGuardCounters();
	if (!value || typeof value !== "object") return base;
	const row = value as Record<string, unknown>;
	return {
		tool_calls: Number(row.tool_calls ?? row.toolCalls ?? 0) || 0,
		llm_calls: Number(row.llm_calls ?? row.llmCalls ?? 0) || 0,
		review_retry_calls: Number(row.review_retry_calls ?? row.reviewRetryCalls ?? 0) || 0,
		pipeline_transition_calls: Number(row.pipeline_transition_calls ?? row.pipelineTransitionCalls ?? 0) || 0,
	};
}

function normalizeGuardDecisionMetadata(value: unknown): GuardDecisionMetadata | null {
	if (!value || typeof value !== "object") return null;
	const row = value as Record<string, unknown>;
	const reasonRaw = typeof row.reasonCode === "string" ? row.reasonCode : "";
	return {
		reasonCode: (reasonRaw as GuardReasonCode) || "",
		nodeId: typeof row.nodeId === "string" ? row.nodeId : "",
		issueNumber: typeof row.issueNumber === "string" ? row.issueNumber : "",
		branch: typeof row.branch === "string" ? row.branch : "",
		milestoneTitle: typeof row.milestoneTitle === "string" ? row.milestoneTitle : "",
		capturedAt: typeof row.capturedAt === "string" ? row.capturedAt : "",
	};
}

export function normalizeRunGuardState(runId: string, guard: Partial<RunGuardState> | undefined): RunGuardState {
	const defaults = createDefaultRunGuardState(runId);
	if (!guard || typeof guard !== "object") return defaults;

	const owner = guard.owner;
	return {
		policyRevision: typeof guard.policyRevision === "string" ? guard.policyRevision : defaults.policyRevision,
		factoryScope: typeof guard.factoryScope === "string" && guard.factoryScope ? guard.factoryScope : defaults.factoryScope,
		workerPeriod: typeof guard.workerPeriod === "string" && guard.workerPeriod ? guard.workerPeriod : defaults.workerPeriod,
		counters: normalizeGuardCounters(guard.counters),
		factoryCounters: normalizeGuardCounters(guard.factoryCounters),
		circuitState: canonicalCircuitState(guard.circuitState),
		reasonCode: typeof guard.reasonCode === "string" ? (guard.reasonCode as GuardReasonCode) : defaults.reasonCode,
		metadata: normalizeGuardDecisionMetadata(guard.metadata),
		overflowCount: Number(guard.overflowCount ?? 0) || 0,
		openedAt: typeof guard.openedAt === "string" ? guard.openedAt : "",
		expiresAt: typeof guard.expiresAt === "string" ? guard.expiresAt : "",
		terminalAt: typeof guard.terminalAt === "string" ? guard.terminalAt : "",
		lastDecisionAt: typeof guard.lastDecisionAt === "string" ? guard.lastDecisionAt : "",
		lastDecisionType: typeof guard.lastDecisionType === "string" ? guard.lastDecisionType : "",
		resetCount: Number(guard.resetCount ?? 0) || 0,
		owner: {
			ownerId: typeof owner?.ownerId === "string" && owner.ownerId ? owner.ownerId : defaults.owner.ownerId,
			leaseName: typeof owner?.leaseName === "string" ? owner.leaseName : "",
			leaseGeneration: Number(owner?.leaseGeneration ?? 0) || 0,
		},
	};
}

function canonicalCircuitState(value: unknown): GuardCircuitState {
	const raw = String(value || "").toLowerCase();
	if (raw === "open" || raw === "circuit_open") return "open";
	if (raw === "terminal" || raw === "tripped" || raw === "circuit_terminal") return "terminal";
	return "closed";
}

function canonicalRunStatus(value: unknown): RunStatus {
	const raw = String(value || "").toLowerCase();
	if (raw === "running") return "running";
	if (raw === "completed") return "completed";
	if (raw === "suspended") return "suspended";
	if (raw === "failed") return "failed";
	if (raw === "queued") return "queued";
	if (raw === "guarded" || raw === "blocked" || raw === "circuit_open" || raw === "guard_open") return "guarded";
	if (raw === "guarded_terminal" || raw === "terminal" || raw === "circuit_terminal" || raw === "guard_terminal") {
		return "guarded_terminal";
	}
	return "failed";
}

function isRunMetadata(value: unknown): value is RunMetadata {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	if (typeof record.runId !== "string") return false;
	if (typeof record.status !== "string") return false;
	const pid = record.pid;
	if (pid !== null && typeof pid !== "number") return false;
	if (typeof record.heartbeatAt !== "string") return false;
	if (typeof record.updatedAt !== "string") return false;
	if (typeof record.requeueAttempted !== "boolean") return false;
	if (record.reasonCode !== undefined && typeof record.reasonCode !== "string") return false;
	return true;
}

function isRunStatus(value: string): value is RunStatus {
	return canonicalRunStatus(value) === value;
}

function buildRunMetadataFromState(state: RunState, now: Date): RunMetadata {
	const previous = loadRunMetadata(state.runId);
	return {
		runId: state.runId,
		status: state.status,
		pid: state.status === "running" ? state.pid : null,
		heartbeatAt: now.toISOString(),
		updatedAt: now.toISOString(),
		requeueAttempted: previous?.requeueAttempted ?? false,
		reasonCode: previous?.reasonCode,
	};
}

/** List all runs, newest first. */
export function listRuns(): RunState[] {
	const dir = runsDir();
	if (!existsSync(dir)) return [];

	const runs: RunState[] = [];
	for (const entry of readdirSync(dir)) {
		const state = loadRunState(entry);
		if (state) runs.push(state);
	}

	// Sort newest first
	runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
	return runs;
}

/** Check if a PID is still alive. */
export function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** Detect if a run is stale (status=running but PID is dead). */
export function isStaleRun(state: RunState): boolean {
	return state.status === "running" && !isPidAlive(state.pid);
}

/** Find the most recent incomplete run for recovery. */
export function findRecoverableRun(): RunState | null {
	const runs = listRuns();
	for (const run of runs) {
		if (run.status === "suspended" || isStaleRun(run)) {
			return run;
		}
	}
	return null;
}

export interface RecoverStaleRunsOptions {
	ttlMs: number;
	now?: Date;
}

export type RunRecoveryAction = "requeued" | "failed";

export interface RunRecoveryResult {
	runId: string;
	action: RunRecoveryAction;
	status: RunStatus;
	reasonCode: RunRecoveryReasonCode;
}

/** Recover stale running runs based on local metadata. */
export function recoverStaleRuns(options: RecoverStaleRunsOptions): RunRecoveryResult[] {
	const now = options.now ?? new Date();
	const results: RunRecoveryResult[] = [];
	const runs = listRuns();

	for (const run of runs) {
		if (run.status !== "running") continue;

		const metadata = loadRunMetadata(run.runId);
		if (!isRecoveryCandidate(run, metadata, options.ttlMs, now)) continue;

		if (!metadata) {
			const reasonCode: RunRecoveryReasonCode = "metadata_missing";
			run.status = "failed";
			saveRunState(run, { now, updatePid: false, updateMetadata: false });
			saveRunMetadata(
				{
					runId: run.runId,
					status: "failed",
					pid: null,
					heartbeatAt: now.toISOString(),
					updatedAt: now.toISOString(),
					requeueAttempted: false,
					reasonCode,
				},
				{ now, touchUpdatedAt: false },
			);
			results.push({ runId: run.runId, action: "failed", status: "failed", reasonCode });
			continue;
		}

		const staleReason = determineStaleReason(metadata, options.ttlMs, now);
		if (!staleReason) continue;

		if (!metadata.requeueAttempted) {
			run.status = "queued";
			saveRunState(run, { now, updatePid: false, updateMetadata: false });
			metadata.status = "queued";
			metadata.pid = null;
			metadata.requeueAttempted = true;
			metadata.reasonCode = staleReason;
			saveRunMetadata(metadata, { now });
			results.push({ runId: run.runId, action: "requeued", status: "queued", reasonCode: staleReason });
			continue;
		}

		run.status = "failed";
		saveRunState(run, { now, updatePid: false, updateMetadata: false });
		metadata.status = "failed";
		metadata.pid = null;
		metadata.reasonCode = staleReason;
		saveRunMetadata(metadata, { now });
		results.push({ runId: run.runId, action: "failed", status: "failed", reasonCode: staleReason });
	}

	return results;
}

function isRecoveryCandidate(run: RunState, metadata: RunMetadata | null, ttlMs: number, now: Date): boolean {
	const updatedAt = metadata?.updatedAt ?? run.updatedAt;
	return isTimestampExpired(updatedAt, ttlMs, now);
}

function determineStaleReason(metadata: RunMetadata, ttlMs: number, now: Date): RunRecoveryReasonCode | null {
	if (metadata.pid !== null && !isPidAlive(metadata.pid)) {
		return "stale_pid";
	}

	return isTimestampExpired(metadata.heartbeatAt, ttlMs, now) ? "stale_heartbeat" : null;
}

function isTimestampExpired(value: string, ttlMs: number, now: Date): boolean {
	const timestamp = Date.parse(value);
	if (Number.isNaN(timestamp)) return true;
	return now.getTime() - timestamp >= ttlMs;
}

/** Get the sessions directory for a run. */
export function sessionsDir(runId: string): string {
	return join(runDir(runId), "sessions");
}

/** Get the events trace path for a run. */
export function eventsPath(runId: string): string {
	return join(runDir(runId), "events.jsonl");
}

export function lifecycleEventsPath(runId: string): string {
	return join(runDir(runId), "lifecycle-events.jsonl");
}

export function setLifecycleProjectionEmitter(
	runId: string,
	emitter: ((events: import("./run-lifecycle.js").RunLifecycleEvent[]) => void) | null,
): void {
	const key = String(runId || "").trim();
	if (!key) return;
	if (!emitter) {
		lifecycleProjectionEmitters.delete(key);
		return;
	}
	lifecycleProjectionEmitters.set(key, emitter);
}

export function clearLifecycleProjectionEmitters(): void {
	lifecycleProjectionEmitters.clear();
}

/** Get the ticks directory for a run. */
export function ticksDir(runId: string): string {
	return join(runDir(runId), "ticks");
}

/** List tick artifact filenames for a run (sorted ascending). */
export function listTickArtifacts(runId: string): string[] {
	const dir = ticksDir(runId);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.startsWith("tick-") && name.endsWith(".json"))
		.sort((a, b) => a.localeCompare(b));
}

/** Resolve the latest tick artifact path (by filename sort). */
export function latestTickArtifact(runId: string): string | null {
	const entries = listTickArtifacts(runId);
	if (entries.length === 0) return null;
	return join(ticksDir(runId), entries[entries.length - 1]);
}

/** Clean up a run directory. */
export function cleanupRun(runId: string): void {
	const dir = runDir(runId);
	if (existsSync(dir)) {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Simple SHA-256 hash of a string (for output_hash). */
export function hashOutput(output: string): string {
	return "sha256:" + createHash("sha256").update(output).digest("hex").substring(0, 16);
}

export function runAlignmentSummaryFilePath(runId: string): string {
	return runAlignmentSummaryPath(runId);
}

export function readRunAlignmentSummary(runId: string): RunAlignmentSummary | null {
	return loadRunAlignmentSummary(runId);
}
