import {
	MODEL_MATRIX_STRATEGIES,
	type ModelMatrixStrategy,
} from "./model-matrix-schema.js";

export type ModelMatrixExecutionStrategy = ModelMatrixStrategy;

export const MODEL_MATRIX_EXECUTION_STRATEGIES = MODEL_MATRIX_STRATEGIES;

export const CANDIDATE_EXECUTION_STATUSES = ["success", "failed"] as const;

export type CandidateExecutionStatus = (typeof CANDIDATE_EXECUTION_STATUSES)[number];

export interface CandidateResult {
	candidateName: string;
	model: string;
	provider: string | null;
	status: CandidateExecutionStatus;
	output: string;
	error: string | null;
	latencyMs: number | null;
	completedAt: number;
	inputTokens: number | null;
	outputTokens: number | null;
	totalTokens: number | null;
	costUsd: number | null;
	ttftMs: number | null;
}

export interface CandidateResultSet {
	nodeId: string;
	matrixId: string;
	strategy: ModelMatrixExecutionStrategy;
	primary: string;
	candidates: CandidateResult[];
	completedAt: number;
}

const EXECUTION_STRATEGY_SET = new Set<string>(MODEL_MATRIX_EXECUTION_STRATEGIES);
const EXECUTION_STATUS_SET = new Set<string>(CANDIDATE_EXECUTION_STATUSES);

export function toCandidateResultSetJson(resultSet: CandidateResultSet): string {
	const normalized = normalizeCandidateResultSet(resultSet);
	return JSON.stringify(normalized, null, 2);
}

export function parseCandidateResultSetJson(raw: string): CandidateResultSet {
	if (typeof raw !== "string") {
		throw contractError(`expected raw payload to be a string, got ${typeof raw}`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw contractError(`invalid JSON payload: ${reason}`);
	}

	return normalizeCandidateResultSet(parsed);
}

function normalizeCandidateResultSet(value: unknown): CandidateResultSet {
	const root = expectObject(value, "candidate result set");
	const nodeId = parseRequiredNonEmptyString(root["nodeId"], "nodeId");
	const matrixId = parseRequiredNonEmptyString(root["matrixId"], "matrixId");
	const strategy = parseExecutionStrategy(root["strategy"], "strategy");
	const primary = parseRequiredNonEmptyString(root["primary"], "primary");
	const completedAt = parseRequiredNonNegativeNumber(root["completedAt"], "completedAt");
	const candidates = parseCandidates(root["candidates"], completedAt);

	if (!candidates.some((candidate) => candidate.candidateName === primary)) {
		throw contractError(`primary must reference a candidateName in candidates, got "${primary}"`);
	}

	return {
		nodeId,
		matrixId,
		strategy,
		primary,
		candidates,
		completedAt,
	};
}

function parseCandidates(value: unknown, defaultCompletedAt: number): CandidateResult[] {
	if (!Array.isArray(value)) {
		throw contractError("candidates must be an array");
	}
	if (value.length === 0) {
		throw contractError("candidates must include at least one candidate result");
	}

	const normalized = value.map((entry, index) =>
		normalizeCandidateResult(entry, `candidates[${index}]`, defaultCompletedAt),
	);

	const ordered = [...normalized].sort(compareCandidates);
	assertUniqueCandidateNames(ordered);
	return ordered;
}

function normalizeCandidateResult(
	value: unknown,
	path: string,
	defaultCompletedAt: number,
): CandidateResult {
	const root = expectObject(value, path);
	const candidateName = parseRequiredNonEmptyString(root["candidateName"], `${path}.candidateName`);
	const model = parseRequiredNonEmptyString(root["model"], `${path}.model`);
	const provider = parseOptionalString(root["provider"], `${path}.provider`);
	const status = parseExecutionStatus(root["status"], `${path}.status`);
	const output = parseRequiredString(root["output"], `${path}.output`);
	const completedAt = parseOptionalNonNegativeNumberOrDefault(
		root["completedAt"],
		`${path}.completedAt`,
		defaultCompletedAt,
	);

	const normalizedError = status === "failed"
		? parseOptionalString(root["error"], `${path}.error`)
		: null;

	return {
		candidateName,
		model,
		provider,
		status,
		output,
		error: normalizedError,
		latencyMs: parseOptionalNonNegativeNumber(root["latencyMs"], `${path}.latencyMs`),
		completedAt,
		inputTokens: parseOptionalNonNegativeNumber(root["inputTokens"], `${path}.inputTokens`),
		outputTokens: parseOptionalNonNegativeNumber(root["outputTokens"], `${path}.outputTokens`),
		totalTokens: parseOptionalNonNegativeNumber(root["totalTokens"], `${path}.totalTokens`),
		costUsd: parseOptionalNonNegativeNumber(root["costUsd"], `${path}.costUsd`),
		ttftMs: parseOptionalNonNegativeNumber(root["ttftMs"], `${path}.ttftMs`),
	};
}

function assertUniqueCandidateNames(candidates: CandidateResult[]): void {
	const seen = new Set<string>();
	for (const candidate of candidates) {
		if (seen.has(candidate.candidateName)) {
			throw contractError(`candidateName values must be unique, duplicate "${candidate.candidateName}"`);
		}
		seen.add(candidate.candidateName);
	}
}

function compareCandidates(left: CandidateResult, right: CandidateResult): number {
	const nameComparison = left.candidateName.localeCompare(right.candidateName);
	if (nameComparison !== 0) return nameComparison;
	const modelComparison = left.model.localeCompare(right.model);
	if (modelComparison !== 0) return modelComparison;
	return (left.provider || "").localeCompare(right.provider || "");
}

function parseExecutionStrategy(value: unknown, path: string): ModelMatrixExecutionStrategy {
	if (typeof value !== "string" || !EXECUTION_STRATEGY_SET.has(value)) {
		throw contractError(
			`${path} must be one of: ${MODEL_MATRIX_EXECUTION_STRATEGIES.join(", ")}`,
		);
	}
	return value as ModelMatrixExecutionStrategy;
}

function parseExecutionStatus(value: unknown, path: string): CandidateExecutionStatus {
	if (typeof value !== "string" || !EXECUTION_STATUS_SET.has(value)) {
		throw contractError(
			`${path} must be one of: ${CANDIDATE_EXECUTION_STATUSES.join(", ")}`,
		);
	}
	return value as CandidateExecutionStatus;
}

function parseRequiredString(value: unknown, path: string): string {
	if (typeof value !== "string") {
		throw contractError(`${path} must be a string`);
	}
	return value;
}

function parseRequiredNonEmptyString(value: unknown, path: string): string {
	if (typeof value !== "string") {
		throw contractError(`${path} must be a non-empty string`);
	}
	const normalized = value.trim();
	if (!normalized) {
		throw contractError(`${path} must be a non-empty string`);
	}
	return normalized;
}

function parseOptionalString(value: unknown, path: string): string | null {
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value !== "string") {
		throw contractError(`${path} must be a string when provided`);
	}
	const normalized = value.trim();
	return normalized === "" ? null : normalized;
}

function parseRequiredNonNegativeNumber(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw contractError(`${path} must be a non-negative finite number`);
	}
	return value;
}

function parseOptionalNonNegativeNumber(
	value: unknown,
	path: string,
	defaultValue: number | null = null,
): number | null {
	if (value === undefined || value === null) {
		return defaultValue;
	}
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw contractError(`${path} must be a non-negative finite number when provided`);
	}
	return value;
}

function parseOptionalNonNegativeNumberOrDefault(
	value: unknown,
	path: string,
	defaultValue: number,
): number {
	const parsed = parseOptionalNonNegativeNumber(value, path, defaultValue);
	if (parsed === null) {
		return defaultValue;
	}
	return parsed;
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw contractError(`${path} must be an object`);
	}
	return value as Record<string, unknown>;
}

function contractError(message: string): Error {
	return new Error(`[candidate-result-set] ${message}`);
}
