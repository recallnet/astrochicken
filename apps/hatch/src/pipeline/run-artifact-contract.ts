import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { assertPathDoesNotRecreateConfiguredRepo } from "../factory/repo-path-health.js";

import { RUN_ALIGNMENT_SUMMARY_FILE, type RunAlignmentSummary } from "./alignment-summary.js";
import type { RunState, RunStatus } from "./run.js";

export const RUN_ARTIFACT_MANIFEST_SCHEMA_VERSION = "hatch.run_artifact_manifest.v1";
export const RUN_ARTIFACT_LIVE_SCHEMA_VERSION = "hatch.run_live.v1";
export const RUN_ARTIFACT_CHECKPOINT_SCHEMA_VERSION = "hatch.run_checkpoint.v1";
export const RUN_ARTIFACT_CONCLUSION_SCHEMA_VERSION = "hatch.run_conclusion.v1";

export const RUN_MANIFEST_FILE = "run-manifest.json";
export const RUN_LIVE_FILE = "run-live.json";
export const RUN_CHECKPOINT_FILE = "run-checkpoint.json";
export const RUN_CONCLUSION_FILE = "run-conclusion.json";

const CONTEXT_KEY_LIMIT = 256;
const ACTIVE_CHILD_SAMPLE_LIMIT = 32;
const LAST_OUTPUT_PREVIEW_LIMIT = 512;

const CONTRACT_OWNER = "apps/hatch/src/pipeline/run-artifact-contract.ts";

const TERMINAL_STATUSES = new Set<RunStatus | "blocked" | "terminal">([
	"completed",
	"failed",
	"suspended",
	"guarded",
	"guarded_terminal",
	"blocked",
	"terminal",
]);

export type RunArtifactSurfaceRole = "canonical" | "compatibility";

export interface RunArtifactSurface {
	key: string;
	file: string;
	role: RunArtifactSurfaceRole;
	owner: string;
	required: boolean;
	description: string;
}

export interface RunManifest {
	schemaVersion: string;
	runId: string;
	factoryId: string;
	pipelineFile: string;
	runDirectory: string;
	generatedAt: string;
	contextKeys: string[];
	discoveryOwner: string;
	artifacts: RunArtifactSurface[];
}

export interface RunLive {
	schemaVersion: string;
	runId: string;
	status: RunStatus;
	currentNode: string;
	startedAt: string;
	updatedAt: string;
	nodeStartedAt: string;
	contextKeys: string[];
	activeChildren: {
		count: number;
		sampleIds: string[];
	};
	recordCount: number;
	lastOutputPreview: string;
	alignmentSummary: {
		file: string;
		exists: boolean;
		status: string;
		terminalAt: string;
	};
}

export interface RunCheckpoint {
	schemaVersion: string;
	runId: string;
	pipelineFile: string;
	status: RunStatus;
	currentNode: string;
	startedAt: string;
	updatedAt: string;
	nodeStartedAt: string;
	counts: {
		completedNodes: number;
		activeChildren: number;
		locksHeld: number;
		records: number;
	};
	guard: {
		circuitState: string;
		reasonCode: string;
		lastDecisionAt: string;
		lastDecisionType: string;
		resetCount: number;
	};
	context: {
		keyCount: number;
		keys: string[];
	};
	lastOutputHash: string;
}

export interface RunConclusion {
	schemaVersion: string;
	runId: string;
	status: RunStatus;
	pipelineFile: string;
	startedAt: string;
	terminalAt: string;
	writtenAt: string;
	manifest: {
		file: string;
		schemaVersion: string;
		checksumSha256: string;
	};
	artifacts: {
		live: string;
		checkpoint: string;
		state: string;
		metadata: string;
		alignmentSummary: string;
	};
}

export interface WriteRunArtifactContractInput {
	state: RunState;
	runDirectory: string;
	now?: Date;
	alignmentSummary?: RunAlignmentSummary | null;
}

export interface RunArtifactContractWriteResult {
	manifest: RunManifest;
	live: RunLive;
	checkpoint: RunCheckpoint;
	conclusion: RunConclusion | null;
}

function assertNonEmpty(value: string, field: string): string {
	const normalized = String(value || "").trim();
	if (!normalized) {
		throw new Error(`run_artifact_contract_invalid:${field}_missing`);
	}
	return normalized;
}

function limitAndSortContextKeys(context: Record<string, string> | undefined): string[] {
	const keys = Object.keys(context || {}).sort((left, right) => left.localeCompare(right));
	return keys.slice(0, CONTEXT_KEY_LIMIT);
}

function truncate(value: string, max: number): string {
	if (!value || max <= 0) return "";
	return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 3))}...`;
}

function canonicalArtifactSurfaces(): RunArtifactSurface[] {
	return [
		{
			key: "run_manifest",
			file: RUN_MANIFEST_FILE,
			role: "canonical",
			owner: CONTRACT_OWNER,
			required: true,
			description: "Authoritative discovery + ownership contract for per-run artifacts.",
		},
		{
			key: "run_live",
			file: RUN_LIVE_FILE,
			role: "canonical",
			owner: CONTRACT_OWNER,
			required: true,
			description: "Bounded live execution status snapshot for operator reads.",
		},
		{
			key: "run_checkpoint",
			file: RUN_CHECKPOINT_FILE,
			role: "canonical",
			owner: CONTRACT_OWNER,
			required: true,
			description: "Bounded deterministic checkpoint snapshot for non-streaming consumers.",
		},
		{
			key: "run_conclusion",
			file: RUN_CONCLUSION_FILE,
			role: "canonical",
			owner: CONTRACT_OWNER,
			required: false,
			description: "Terminal run summary emitted only after terminal states.",
		},
		{
			key: "run_state",
			file: "state.json",
			role: "compatibility",
			owner: "apps/hatch/src/pipeline/run.ts#saveRunState",
			required: true,
			description: "Compatibility source for full engine state persistence.",
		},
		{
			key: "run_metadata",
			file: "metadata.json",
			role: "compatibility",
			owner: "apps/hatch/src/pipeline/run.ts#saveRunMetadata",
			required: false,
			description: "Compatibility heartbeat + recovery metadata surface.",
		},
		{
			key: "run_alignment_summary",
			file: RUN_ALIGNMENT_SUMMARY_FILE,
			role: "compatibility",
			owner: "apps/hatch/src/pipeline/alignment-summary.ts",
			required: false,
			description: "Terminal alignment summary surface.",
		},
		{
			key: "run_lifecycle_events",
			file: "lifecycle-events.jsonl",
			role: "compatibility",
			owner: "apps/hatch/src/pipeline/run-lifecycle.ts",
			required: false,
			description: "Lifecycle event projection stream.",
		},
		{
			key: "run_events_trace",
			file: "events.jsonl",
			role: "compatibility",
			owner: "apps/hatch/src/cli.ts#createTraceHandler",
			required: false,
			description: "Optional full event bus trace when tracing is enabled.",
		},
	];
}

export function validateCanonicalArtifactSurfaces(
	surfaces: ReadonlyArray<RunArtifactSurface> = canonicalArtifactSurfaces(),
): void {
	for (const surface of surfaces) {
		if (surface.role !== "canonical") continue;
		if (!String(surface.file || "").trim()) {
			throw new Error(`run_artifact_contract_invalid:canonical_artifact_path_missing:${surface.key}`);
		}
	}
}

export function runArtifactPath(runDirectory: string, filename: string): string {
	const dir = assertNonEmpty(runDirectory, "run_directory");
	const file = assertNonEmpty(filename, "artifact_filename");
	return join(dir, file);
}

function writeRunArtifactJsonAtomic(path: string, payload: unknown): void {
	assertPathDoesNotRecreateConfiguredRepo(path, { label: "run_artifact_contract_path" });
	mkdirSync(dirname(path), { recursive: true });
	const tmpPath = `${path}.${randomUUID()}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
	renameSync(tmpPath, path);
}

function inferFactoryId(state: RunState): string {
	const fromContext = String(state.context.factory_id || state.context.factory || "").trim();
	if (fromContext) return fromContext;
	const fromEnv = String(process.env["HATCH_FACTORY_ID"] || "").trim();
	return fromEnv || "unscoped";
}

function checksumSha256(payload: unknown): string {
	const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
	return `sha256:${digest}`;
}

function isTerminalStatus(status: RunStatus): boolean {
	return TERMINAL_STATUSES.has(status);
}

function buildRunArtifactManifest({
	state,
	runDirectory,
	now = new Date(),
}: {
	state: RunState;
	runDirectory: string;
	now?: Date;
}): RunManifest {
	validateCanonicalArtifactSurfaces();
	const runId = assertNonEmpty(state.runId, "run_id");
	const pipelineFile = assertNonEmpty(state.pipelineFile, "pipeline_file");
	const resolvedRunDirectory = assertNonEmpty(runDirectory, "run_directory");
	const contextKeys = limitAndSortContextKeys(state.context);
	return {
		schemaVersion: RUN_ARTIFACT_MANIFEST_SCHEMA_VERSION,
		runId,
		factoryId: inferFactoryId(state),
		pipelineFile,
		runDirectory: resolvedRunDirectory,
		generatedAt: now.toISOString(),
		contextKeys,
		discoveryOwner: CONTRACT_OWNER,
		artifacts: canonicalArtifactSurfaces(),
	};
}

function buildRunLive({
	state,
	now,
	alignmentSummary,
}: {
	state: RunState;
	now: Date;
	alignmentSummary: RunAlignmentSummary | null;
}): RunLive {
	const contextKeys = limitAndSortContextKeys(state.context);
	const childIds = Object.keys(state.activeChildren || {}).sort((left, right) => left.localeCompare(right));
	return {
		schemaVersion: RUN_ARTIFACT_LIVE_SCHEMA_VERSION,
		runId: state.runId,
		status: state.status,
		currentNode: String(state.currentNode || ""),
		startedAt: String(state.startedAt || ""),
		updatedAt: String(state.updatedAt || now.toISOString()),
		nodeStartedAt: String(state.nodeStartedAt || ""),
		contextKeys,
		activeChildren: {
			count: childIds.length,
			sampleIds: childIds.slice(0, ACTIVE_CHILD_SAMPLE_LIMIT),
		},
		recordCount: Array.isArray(state.records) ? state.records.length : 0,
		lastOutputPreview: truncate(String(state.lastOutput || ""), LAST_OUTPUT_PREVIEW_LIMIT),
		alignmentSummary: {
			file: RUN_ALIGNMENT_SUMMARY_FILE,
			exists: Boolean(alignmentSummary),
			status: String(alignmentSummary?.status || ""),
			terminalAt: String(alignmentSummary?.terminal_at || ""),
		},
	};
}

function buildRunCheckpoint(state: RunState): RunCheckpoint {
	const contextKeys = limitAndSortContextKeys(state.context);
	return {
		schemaVersion: RUN_ARTIFACT_CHECKPOINT_SCHEMA_VERSION,
		runId: state.runId,
		pipelineFile: state.pipelineFile,
		status: state.status,
		currentNode: String(state.currentNode || ""),
		startedAt: String(state.startedAt || ""),
		updatedAt: String(state.updatedAt || ""),
		nodeStartedAt: String(state.nodeStartedAt || ""),
		counts: {
			completedNodes: Array.isArray(state.completedNodes) ? state.completedNodes.length : 0,
			activeChildren: Object.keys(state.activeChildren || {}).length,
			locksHeld: Array.isArray(state.locksHeld) ? state.locksHeld.length : 0,
			records: Array.isArray(state.records) ? state.records.length : 0,
		},
		guard: {
			circuitState: String(state.guard?.circuitState || ""),
			reasonCode: String(state.guard?.reasonCode || ""),
			lastDecisionAt: String(state.guard?.lastDecisionAt || ""),
			lastDecisionType: String(state.guard?.lastDecisionType || ""),
			resetCount: Number(state.guard?.resetCount || 0),
		},
		context: {
			keyCount: Object.keys(state.context || {}).length,
			keys: contextKeys,
		},
		lastOutputHash: checksumSha256(String(state.lastOutput || "")),
	};
}

function buildRunConclusion({
	state,
	now,
	manifest,
}: {
	state: RunState;
	now: Date;
	manifest: RunManifest;
}): RunConclusion {
	return {
		schemaVersion: RUN_ARTIFACT_CONCLUSION_SCHEMA_VERSION,
		runId: state.runId,
		status: state.status,
		pipelineFile: state.pipelineFile,
		startedAt: String(state.startedAt || ""),
		terminalAt: String(state.updatedAt || now.toISOString()),
		writtenAt: now.toISOString(),
		manifest: {
			file: RUN_MANIFEST_FILE,
			schemaVersion: manifest.schemaVersion,
			checksumSha256: checksumSha256(manifest),
		},
		artifacts: {
			live: RUN_LIVE_FILE,
			checkpoint: RUN_CHECKPOINT_FILE,
			state: "state.json",
			metadata: "metadata.json",
			alignmentSummary: RUN_ALIGNMENT_SUMMARY_FILE,
		},
	};
}

export function writeRunArtifactContract(input: WriteRunArtifactContractInput): RunArtifactContractWriteResult {
	const now = input.now ?? new Date();
	const runDirectory = assertNonEmpty(input.runDirectory, "run_directory");
	const manifest = buildRunArtifactManifest({
		state: input.state,
		runDirectory,
		now,
	});
	const live = buildRunLive({
		state: input.state,
		now,
		alignmentSummary: input.alignmentSummary ?? null,
	});
	const checkpoint = buildRunCheckpoint(input.state);

	writeRunArtifactJsonAtomic(runArtifactPath(runDirectory, RUN_LIVE_FILE), live);
	writeRunArtifactJsonAtomic(runArtifactPath(runDirectory, RUN_CHECKPOINT_FILE), checkpoint);

	let conclusion: RunConclusion | null = null;
	if (isTerminalStatus(input.state.status)) {
		conclusion = buildRunConclusion({ state: input.state, now, manifest });
		writeRunArtifactJsonAtomic(runArtifactPath(runDirectory, RUN_CONCLUSION_FILE), conclusion);
	}
	writeRunArtifactJsonAtomic(runArtifactPath(runDirectory, RUN_MANIFEST_FILE), manifest);

	return {
		manifest,
		live,
		checkpoint,
		conclusion,
	};
}
