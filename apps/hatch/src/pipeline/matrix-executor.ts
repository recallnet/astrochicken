import { randomUUID } from "node:crypto";
import {
	existsSync as defaultExistsSync,
	mkdirSync as defaultMkdirSync,
	readFileSync as defaultReadFileSync,
	renameSync as defaultRenameSync,
	writeFileSync as defaultWriteFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import { Context, type Outcome, StageStatus } from "./context.js";
import { graphWorkDir, nodeWorkDir, type Graph, type Node } from "./graph.js";
import { loadModelMatrixFile } from "./model-matrix-loader.js";
import { resolveEffectiveModelRoutingForNode } from "./model-matrix-resolution.js";
import {
	toCandidateResultSetJson,
	type CandidateResult,
	type CandidateResultSet,
	type ModelMatrixExecutionStrategy,
} from "./types.js";

export const MATRIX_CANDIDATE_RESULT_SET_CONTEXT_KEY = "matrix_candidate_result_set";

interface MatrixExecutorFileSystem {
	existsSync(path: string): boolean;
	mkdirSync(path: string, options?: { recursive?: boolean }): void;
	readFileSync(path: string, encoding: "utf-8"): string;
	writeFileSync(path: string, content: string): void;
	renameSync(from: string, to: string): void;
}

interface MatrixExecutorDeps {
	fs?: MatrixExecutorFileSystem;
	now?: () => number;
	cwd?: () => string;
	onBackgroundError?: (error: Error) => void;
}

export interface MatrixCandidateExecution {
	candidateName: string;
	isPrimary: boolean;
	strategy: ModelMatrixExecutionStrategy;
	matrixId: string;
}

export interface MatrixExecutorRunArgs {
	graph: Graph;
	node: Node;
	context: Context;
	execute: (node: Node, execution?: MatrixCandidateExecution) => Promise<Outcome>;
	onResultSet?: (resultSet: CandidateResultSet) => void;
}

interface CandidatePlanEntry {
	candidateName: string;
	model: string;
	provider: string | undefined;
}

interface CandidateAttemptResult {
	candidateResult: CandidateResult;
	outcome?: Outcome;
	error?: Error;
}

interface RotationCursorState {
	cursorByNodeAndMatrix: Record<string, number>;
	selectedCandidateName: string;
	storagePath: string;
}

const DEFAULT_FS: MatrixExecutorFileSystem = {
	existsSync: defaultExistsSync,
	mkdirSync: defaultMkdirSync,
	readFileSync: defaultReadFileSync,
	writeFileSync: defaultWriteFileSync,
	renameSync: defaultRenameSync,
};

export class MatrixExecutor {
	private readonly fs: MatrixExecutorFileSystem;
	private readonly now: () => number;
	private readonly cwd: () => string;
	private readonly onBackgroundError: (error: Error) => void;
	private readonly pendingBackground = new Set<Promise<void>>();

	constructor(deps: MatrixExecutorDeps = {}) {
		this.fs = deps.fs ?? DEFAULT_FS;
		this.now = deps.now ?? (() => Date.now());
		this.cwd = deps.cwd ?? (() => process.cwd());
		this.onBackgroundError = deps.onBackgroundError ?? (() => {});
	}

	async run(args: MatrixExecutorRunArgs): Promise<Outcome> {
		const routing = resolveEffectiveModelRoutingForNode(args.graph, args.node);
		if (routing.family !== "model_matrix") {
			return args.execute(args.node);
		}

		const matrixWorkDir = resolveMatrixWorkDir(args.graph, args.node, this.cwd());
		const loadedMatrix = loadModelMatrixFile({
			modelMatrixPath: routing.value,
			workDir: matrixWorkDir,
			source: formatModelMatrixSource(routing.provenance, args.node.id, routing.value),
		});

		const strategy = loadedMatrix.document.strategy as ModelMatrixExecutionStrategy;
		const candidatePlan = buildCandidatePlan(loadedMatrix.document.candidates);
		const primaryCandidate = candidatePlan.find((candidate) =>
			candidate.candidateName === loadedMatrix.document.primary,
		);
		if (!primaryCandidate) {
			throw new Error(
				`[matrix-executor] primary candidate ${JSON.stringify(loadedMatrix.document.primary)} not found in candidates`,
			);
		}

		const matrixId = loadedMatrix.rawPath || loadedMatrix.resolvedPath;
		const comparisonCandidates = candidatePlan.filter((candidate) =>
			candidate.candidateName !== primaryCandidate.candidateName,
		);

		switch (strategy) {
			case "all_sync":
				return this.runAllSync({
					...args,
					strategy,
					matrixId,
					candidatePlan,
					primaryCandidate,
				});
			case "rotate":
				return this.runRotate({
					...args,
					strategy,
					matrixId,
					primaryCandidate,
					comparisonCandidates,
					matrixWorkDir,
				});
			case "shadow":
			default:
				return this.runShadow({
					...args,
					strategy: "shadow",
					matrixId,
					primaryCandidate,
					comparisonCandidates,
				});
		}
	}

	async waitForIdle(): Promise<void> {
		if (this.pendingBackground.size === 0) return;
		await Promise.all([...this.pendingBackground]);
	}

	private async runShadow(args: {
		graph: Graph;
		node: Node;
		context: Context;
		execute: (node: Node, execution?: MatrixCandidateExecution) => Promise<Outcome>;
		onResultSet?: (resultSet: CandidateResultSet) => void;
		strategy: ModelMatrixExecutionStrategy;
		matrixId: string;
		primaryCandidate: CandidatePlanEntry;
		comparisonCandidates: CandidatePlanEntry[];
	}): Promise<Outcome> {
		const primary = await this.executePrimaryCandidate(
			args,
			args.primaryCandidate,
			buildCandidateExecution({
				candidateName: args.primaryCandidate.candidateName,
				isPrimary: true,
				strategy: args.strategy,
				matrixId: args.matrixId,
			}),
		);
		const primaryOutcome = ensurePrimaryOutcome(primary, args.primaryCandidate.candidateName);
		if (args.comparisonCandidates.length === 0) {
			this.writeCandidateResultSet({
				context: args.context,
				nodeId: args.node.id,
				matrixId: args.matrixId,
				strategy: args.strategy,
				primary: args.primaryCandidate.candidateName,
				candidateResults: [primary.candidateResult],
				onResultSet: args.onResultSet,
			});
			return primaryOutcome;
		}

		const background = this.captureBackground(async () => {
			const comparisons = await Promise.all(
				args.comparisonCandidates.map((candidate) =>
					this.executeComparisonCandidate(
						args,
						candidate,
						buildCandidateExecution({
							candidateName: candidate.candidateName,
							isPrimary: false,
							strategy: args.strategy,
							matrixId: args.matrixId,
						}),
					),
				),
			);
			this.writeCandidateResultSet({
				context: args.context,
				nodeId: args.node.id,
				matrixId: args.matrixId,
				strategy: args.strategy,
				primary: args.primaryCandidate.candidateName,
				candidateResults: [primary.candidateResult, ...comparisons.map((entry) => entry.candidateResult)],
				onResultSet: args.onResultSet,
			});
		});
		this.trackBackground(background);
		return primaryOutcome;
	}

	private async runAllSync(args: {
		graph: Graph;
		node: Node;
		context: Context;
		execute: (node: Node, execution?: MatrixCandidateExecution) => Promise<Outcome>;
		onResultSet?: (resultSet: CandidateResultSet) => void;
		strategy: ModelMatrixExecutionStrategy;
		matrixId: string;
		candidatePlan: CandidatePlanEntry[];
		primaryCandidate: CandidatePlanEntry;
	}): Promise<Outcome> {
		const attemptEntries = await Promise.all(
			args.candidatePlan.map(async (candidate) => {
				if (candidate.candidateName === args.primaryCandidate.candidateName) {
					return [
						candidate.candidateName,
						await this.executePrimaryCandidate(
							args,
							candidate,
							buildCandidateExecution({
								candidateName: candidate.candidateName,
								isPrimary: true,
								strategy: args.strategy,
								matrixId: args.matrixId,
							}),
						),
					] as const;
				}
				return [
					candidate.candidateName,
					await this.executeComparisonCandidate(
						args,
						candidate,
						buildCandidateExecution({
							candidateName: candidate.candidateName,
							isPrimary: false,
							strategy: args.strategy,
							matrixId: args.matrixId,
						}),
					),
				] as const;
			}),
		);
		const attempts = new Map(attemptEntries);
		const primaryAttempt = attempts.get(args.primaryCandidate.candidateName);
		if (!primaryAttempt) {
			throw new Error(
				`[matrix-executor] missing primary attempt for ${JSON.stringify(args.primaryCandidate.candidateName)}`,
			);
		}

		this.writeCandidateResultSet({
			context: args.context,
			nodeId: args.node.id,
			matrixId: args.matrixId,
			strategy: args.strategy,
			primary: args.primaryCandidate.candidateName,
			candidateResults: args.candidatePlan.map((candidate) => {
				const attempt = attempts.get(candidate.candidateName);
				if (!attempt) {
					throw new Error(
						`[matrix-executor] missing candidate attempt for ${JSON.stringify(candidate.candidateName)}`,
					);
				}
				return attempt.candidateResult;
			}),
			onResultSet: args.onResultSet,
		});

		return ensurePrimaryOutcome(primaryAttempt, args.primaryCandidate.candidateName);
	}

	private async runRotate(args: {
		graph: Graph;
		node: Node;
		context: Context;
		execute: (node: Node, execution?: MatrixCandidateExecution) => Promise<Outcome>;
		onResultSet?: (resultSet: CandidateResultSet) => void;
		strategy: ModelMatrixExecutionStrategy;
		matrixId: string;
		primaryCandidate: CandidatePlanEntry;
		comparisonCandidates: CandidatePlanEntry[];
		matrixWorkDir: string;
	}): Promise<Outcome> {
		const primary = await this.executePrimaryCandidate(
			args,
			args.primaryCandidate,
			buildCandidateExecution({
				candidateName: args.primaryCandidate.candidateName,
				isPrimary: true,
				strategy: args.strategy,
				matrixId: args.matrixId,
			}),
		);
		const primaryOutcome = ensurePrimaryOutcome(primary, args.primaryCandidate.candidateName);
		if (args.comparisonCandidates.length === 0) {
			this.writeCandidateResultSet({
				context: args.context,
				nodeId: args.node.id,
				matrixId: args.matrixId,
				strategy: args.strategy,
				primary: args.primaryCandidate.candidateName,
				candidateResults: [primary.candidateResult],
				onResultSet: args.onResultSet,
			});
			return primaryOutcome;
		}

		const rotation = this.selectRotateCandidate({
			matrixId: args.matrixId,
			nodeId: args.node.id,
			comparisonCandidates: args.comparisonCandidates,
			context: args.context,
			workDir: args.matrixWorkDir,
		});
		this.persistRotationState(rotation.storagePath, rotation.cursorByNodeAndMatrix);
		const selectedComparison = args.comparisonCandidates.find((candidate) =>
			candidate.candidateName === rotation.selectedCandidateName,
		);
		if (!selectedComparison) {
			throw new Error(
				`[matrix-executor] selected rotate candidate ${JSON.stringify(rotation.selectedCandidateName)} not found`,
			);
		}

		const background = this.captureBackground(async () => {
			const comparison = await this.executeComparisonCandidate(
				args,
				selectedComparison,
				buildCandidateExecution({
					candidateName: selectedComparison.candidateName,
					isPrimary: false,
					strategy: args.strategy,
					matrixId: args.matrixId,
				}),
			);
			this.writeCandidateResultSet({
				context: args.context,
				nodeId: args.node.id,
				matrixId: args.matrixId,
				strategy: args.strategy,
				primary: args.primaryCandidate.candidateName,
				candidateResults: [primary.candidateResult, comparison.candidateResult],
				onResultSet: args.onResultSet,
			});
		});
		this.trackBackground(background);
		return primaryOutcome;
	}

	private async executePrimaryCandidate(
		args: Pick<
			MatrixExecutorRunArgs,
			"node" | "execute"
		>,
		candidate: CandidatePlanEntry,
		execution: MatrixCandidateExecution,
	): Promise<CandidateAttemptResult> {
		const startedAt = this.now();
		const candidateNode = buildCandidateNode(args.node, candidate);
		try {
			const outcome = await args.execute(candidateNode, execution);
			return {
				outcome,
				candidateResult: buildCandidateResult({
					candidate,
					outcome,
					startedAt,
					completedAt: this.now(),
				}),
			};
		} catch (error) {
			const err = asError(error);
			return {
				error: err,
				candidateResult: buildCandidateResultFromError({
					candidate,
					startedAt,
					completedAt: this.now(),
					error: err,
				}),
			};
		}
	}

	private async executeComparisonCandidate(
		args: Pick<
			MatrixExecutorRunArgs,
			"node" | "execute"
		>,
		candidate: CandidatePlanEntry,
		execution: MatrixCandidateExecution,
	): Promise<CandidateAttemptResult> {
		const startedAt = this.now();
		const candidateNode = buildCandidateNode(args.node, candidate);
		try {
			const outcome = await args.execute(candidateNode, execution);
			return {
				outcome,
				candidateResult: buildCandidateResult({
					candidate,
					outcome,
					startedAt,
					completedAt: this.now(),
				}),
			};
		} catch (error) {
			const err = asError(error);
			return {
				error: err,
				candidateResult: buildCandidateResultFromError({
					candidate,
					startedAt,
					completedAt: this.now(),
					error: err,
				}),
			};
		}
	}

	private selectRotateCandidate(args: {
		matrixId: string;
		nodeId: string;
		comparisonCandidates: CandidatePlanEntry[];
		context: Context;
		workDir: string;
	}): RotationCursorState {
		const factoryId = normalizeFactoryId(args.context.get("factory_id") || args.context.get("factory"));
		const storagePath = resolve(
			args.workDir,
			".hatch",
			factoryId || "default",
			"matrix-rotation.json",
		);
		const cursorByNodeAndMatrix = this.loadRotationState(storagePath);
		const rotationKey = `${args.nodeId}::${args.matrixId}`;
		const previousIndex = Number.isInteger(cursorByNodeAndMatrix[rotationKey])
			? cursorByNodeAndMatrix[rotationKey]!
			: -1;
		const nextIndex = (previousIndex + 1) % args.comparisonCandidates.length;
		cursorByNodeAndMatrix[rotationKey] = nextIndex;
		const selectedCandidateName = args.comparisonCandidates[nextIndex]!.candidateName;

		return {
			cursorByNodeAndMatrix,
			selectedCandidateName,
			storagePath,
		};
	}

	private loadRotationState(path: string): Record<string, number> {
		if (!this.fs.existsSync(path)) return {};
		try {
			const raw = this.fs.readFileSync(path, "utf-8");
			const parsed = JSON.parse(raw) as unknown;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				return {};
			}
			const out: Record<string, number> = {};
			for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
				if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
					out[key] = Math.floor(value);
				}
			}
			return out;
		} catch {
			return {};
		}
	}

	private persistRotationState(path: string, state: Record<string, number>): void {
		this.fs.mkdirSync(dirname(path), { recursive: true });
		const tmpPath = `${path}.${randomUUID()}.tmp`;
		this.fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
		this.fs.renameSync(tmpPath, path);
	}

	private writeCandidateResultSet(args: {
		context: Context;
		nodeId: string;
		matrixId: string;
		strategy: ModelMatrixExecutionStrategy;
		primary: string;
		candidateResults: CandidateResult[];
		onResultSet?: (resultSet: CandidateResultSet) => void;
	}): void {
		const completedAt = this.now();
		const resultSet: CandidateResultSet = {
			nodeId: args.nodeId,
			matrixId: args.matrixId,
			strategy: args.strategy,
			primary: args.primary,
			completedAt,
			candidates: args.candidateResults,
		};
		args.context.set(MATRIX_CANDIDATE_RESULT_SET_CONTEXT_KEY, toCandidateResultSetJson(resultSet));
		args.onResultSet?.(resultSet);
	}

	private captureBackground(task: () => Promise<void>): Promise<void> {
		return task().catch((error) => {
			this.onBackgroundError(asError(error));
		});
	}

	private trackBackground(promise: Promise<void>): void {
		this.pendingBackground.add(promise);
		void promise.finally(() => {
			this.pendingBackground.delete(promise);
		});
	}
}

function resolveMatrixWorkDir(graph: Graph, node: Node, defaultCwd: string): string {
	const nodeDir = normalizeWorkDir(nodeWorkDir(node));
	if (nodeDir) return nodeDir;
	const graphDir = normalizeWorkDir(graphWorkDir(graph));
	if (graphDir) return graphDir;
	return defaultCwd;
}

function normalizeWorkDir(value: string): string {
	return String(value || "").trim();
}

function formatModelMatrixSource(
	provenance: "node" | "graph" | "none",
	nodeId: string,
	value: string,
): string {
	if (provenance === "node") {
		return `node ${JSON.stringify(nodeId)} model_matrix=${JSON.stringify(value)}`;
	}
	if (provenance === "graph") {
		return `graph model_matrix=${JSON.stringify(value)}`;
	}
	return `model_matrix=${JSON.stringify(value)}`;
}

function buildCandidateExecution(args: {
	candidateName: string;
	isPrimary: boolean;
	strategy: ModelMatrixExecutionStrategy;
	matrixId: string;
}): MatrixCandidateExecution {
	return {
		candidateName: args.candidateName,
		isPrimary: args.isPrimary,
		strategy: args.strategy,
		matrixId: args.matrixId,
	};
}

function buildCandidatePlan(candidates: Record<string, { model: string; provider?: string }>): CandidatePlanEntry[] {
	return Object.entries(candidates).map(([candidateName, definition]) => ({
		candidateName,
		model: String(definition.model || "").trim(),
		provider: normalizeOptionalProvider(definition.provider),
	}));
}

function buildCandidateNode(node: Node, candidate: CandidatePlanEntry): Node {
	const attrs: Record<string, string> = {
		...node.attrs,
		model_matrix: "",
		llm_model: candidate.model,
	};
	if (candidate.provider) {
		attrs["llm_provider"] = candidate.provider;
	}
	return {
		...node,
		attrs,
	};
}

function buildCandidateResult(args: {
	candidate: CandidatePlanEntry;
	outcome: Outcome;
	startedAt: number;
	completedAt: number;
}): CandidateResult {
	const succeeded = args.outcome.status === StageStatus.Completed;
	const usage = args.outcome.usage;
	const candidateProvider = normalizeOptionalString(args.candidate.provider);
	return {
		candidateName: args.candidate.candidateName,
		model: args.candidate.model,
		provider: candidateProvider,
		status: succeeded ? "success" : "failed",
		output: args.outcome.output || "",
		error: succeeded ? null : normalizeOptionalString(args.outcome.error),
		latencyMs: normalizeLatency(args.outcome.durationMs, args.startedAt, args.completedAt),
		completedAt: args.completedAt,
		inputTokens: normalizeOptionalNumber(usage?.inputTokens),
		outputTokens: normalizeOptionalNumber(usage?.outputTokens),
		totalTokens: normalizeOptionalNumber(usage?.totalTokens),
		costUsd: null,
		ttftMs: null,
	};
}

function buildCandidateResultFromError(args: {
	candidate: CandidatePlanEntry;
	startedAt: number;
	completedAt: number;
	error: Error;
}): CandidateResult {
	return {
		candidateName: args.candidate.candidateName,
		model: args.candidate.model,
		provider: normalizeOptionalString(args.candidate.provider),
		status: "failed",
		output: "",
		error: normalizeOptionalString(args.error.message) || args.error.message,
		latencyMs: Math.max(0, args.completedAt - args.startedAt),
		completedAt: args.completedAt,
		inputTokens: null,
		outputTokens: null,
		totalTokens: null,
		costUsd: null,
		ttftMs: null,
	};
}

function normalizeOptionalString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	return normalized ? normalized : null;
}

function normalizeOptionalProvider(value: unknown): string | undefined {
	const normalized = normalizeOptionalString(value);
	return normalized ?? undefined;
}

function normalizeOptionalNumber(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return null;
	}
	return value;
}

function normalizeLatency(durationMs: number | undefined, startedAt: number, completedAt: number): number | null {
	if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0) {
		return durationMs;
	}
	return Math.max(0, completedAt - startedAt);
}

function ensurePrimaryOutcome(result: CandidateAttemptResult, candidateName: string): Outcome {
	if (result.error) {
		throw result.error;
	}
	if (!result.outcome) {
		throw new Error(
			`[matrix-executor] primary outcome missing for ${JSON.stringify(candidateName)}`,
		);
	}
	return result.outcome;
}

function asError(error: unknown): Error {
	if (error instanceof Error) return error;
	return new Error(String(error));
}

function normalizeFactoryId(value: string): string {
	return String(value || "").trim();
}
