export const MODEL_MATRIX_SCHEMA_VERSION = "matrix/v1" as const;

export type ModelMatrixSchemaVersion = typeof MODEL_MATRIX_SCHEMA_VERSION;

export const MODEL_MATRIX_STRATEGIES = ["shadow", "all_sync", "rotate"] as const;

export type ModelMatrixStrategy = (typeof MODEL_MATRIX_STRATEGIES)[number];

export const MODEL_MATRIX_WEIGHT_SUM_EPSILON = 1e-9;

export interface ModelMatrixCandidateInput {
	model: string;
	provider?: string;
}

export interface ModelMatrixJudgeDimensionInput {
	name: string;
	weight: number;
}

export interface ModelMatrixJudgeInput {
	model: string;
	provider?: string;
	dimensions: ModelMatrixJudgeDimensionInput[];
	scale: [number, number];
}

export interface ModelMatrixDocumentInput {
	schema_version: ModelMatrixSchemaVersion;
	candidates: Record<string, ModelMatrixCandidateInput>;
	primary: string;
	strategy?: ModelMatrixStrategy;
	judge?: ModelMatrixJudgeInput;
}

export interface ModelMatrixCandidate {
	model: string;
	provider?: string;
}

export interface ModelMatrixJudgeDimension {
	name: string;
	weight: number;
}

export interface ModelMatrixJudge {
	model: string;
	provider?: string;
	dimensions: ModelMatrixJudgeDimension[];
	scale: [number, number];
}

export interface ModelMatrixDocument {
	schema_version: ModelMatrixSchemaVersion;
	candidates: Record<string, ModelMatrixCandidate>;
	primary: string;
	strategy: ModelMatrixStrategy;
	judge?: ModelMatrixJudge;
}

export const MODEL_MATRIX_VALIDATION_CODES = {
	ROOT_INVALID_TYPE: "model_matrix.root.invalid_type",
	SCHEMA_VERSION_INVALID: "model_matrix.schema_version.invalid",
	CANDIDATES_REQUIRED: "model_matrix.candidates.required",
	CANDIDATES_INVALID_TYPE: "model_matrix.candidates.invalid_type",
	CANDIDATES_MIN_COUNT: "model_matrix.candidates.min_count",
	CANDIDATE_KEY_INVALID: "model_matrix.candidate.key.invalid",
	CANDIDATE_INVALID_TYPE: "model_matrix.candidate.invalid_type",
	CANDIDATE_MODEL_REQUIRED: "model_matrix.candidate.model.required",
	CANDIDATE_PROVIDER_INVALID: "model_matrix.candidate.provider.invalid",
	PRIMARY_REQUIRED: "model_matrix.primary.required",
	PRIMARY_UNKNOWN: "model_matrix.primary.unknown",
	STRATEGY_INVALID: "model_matrix.strategy.invalid",
	JUDGE_INVALID_TYPE: "model_matrix.judge.invalid_type",
	JUDGE_MODEL_REQUIRED: "model_matrix.judge.model.required",
	JUDGE_PROVIDER_INVALID: "model_matrix.judge.provider.invalid",
	JUDGE_DIMENSIONS_REQUIRED: "model_matrix.judge.dimensions.required",
	JUDGE_DIMENSIONS_INVALID_TYPE: "model_matrix.judge.dimensions.invalid_type",
	JUDGE_DIMENSION_INVALID_TYPE: "model_matrix.judge.dimension.invalid_type",
	JUDGE_DIMENSION_NAME_REQUIRED: "model_matrix.judge.dimension.name.required",
	JUDGE_DIMENSION_WEIGHT_INVALID: "model_matrix.judge.dimension.weight.invalid",
	JUDGE_WEIGHT_SUM_INVALID: "model_matrix.judge.weights.sum.invalid",
	JUDGE_SCALE_REQUIRED: "model_matrix.judge.scale.required",
	JUDGE_SCALE_INVALID: "model_matrix.judge.scale.invalid",
	JUDGE_SCALE_RANGE_INVALID: "model_matrix.judge.scale.range.invalid",
} as const;

export type ModelMatrixValidationCode = (typeof MODEL_MATRIX_VALIDATION_CODES)[keyof typeof MODEL_MATRIX_VALIDATION_CODES];

export interface ModelMatrixValidationIssue {
	code: ModelMatrixValidationCode;
	path: string;
	message: string;
}

export class ModelMatrixValidationError extends Error {
	readonly issues: ModelMatrixValidationIssue[];
	readonly source?: string;

	constructor(issues: ModelMatrixValidationIssue[], source?: string) {
		super(formatModelMatrixValidationErrorMessage(issues, source));
		this.name = "ModelMatrixValidationError";
		this.issues = issues;
		this.source = source;
	}
}

export function validateModelMatrixDocument(value: unknown): ModelMatrixValidationIssue[] {
	return validateAndNormalizeModelMatrixDocument(value).issues;
}

export function parseModelMatrixDocument(
	value: unknown,
	opts?: { source?: string },
): ModelMatrixDocument {
	const { issues, normalized } = validateAndNormalizeModelMatrixDocument(value);
	if (issues.length > 0 || !normalized) {
		throw new ModelMatrixValidationError(issues, opts?.source);
	}
	return normalized;
}

function validateAndNormalizeModelMatrixDocument(
	value: unknown,
): { issues: ModelMatrixValidationIssue[]; normalized?: ModelMatrixDocument } {
	const issues: ModelMatrixValidationIssue[] = [];
	if (!isPlainObject(value)) {
		issues.push({
			code: MODEL_MATRIX_VALIDATION_CODES.ROOT_INVALID_TYPE,
			path: "",
			message: "model matrix document must be an object",
		});
		return { issues };
	}

	const root = value as Record<string, unknown>;
	const schemaVersion = parseSchemaVersion(root["schema_version"], issues);
	const candidatesResult = parseCandidates(root["candidates"], issues);
	const primary = parsePrimary(root["primary"], candidatesResult.keys, issues);
	const strategy = parseStrategy(root["strategy"], issues);
	const judge = parseJudge(root["judge"], issues);

	if (issues.length > 0 || !schemaVersion || !candidatesResult.normalized || !primary || !strategy) {
		return { issues };
	}

	const normalized: ModelMatrixDocument = {
		schema_version: schemaVersion,
		candidates: candidatesResult.normalized,
		primary,
		strategy,
	};

	if (judge) {
		normalized.judge = judge;
	}

	return { issues, normalized };
}

function parseSchemaVersion(
	value: unknown,
	issues: ModelMatrixValidationIssue[],
): ModelMatrixSchemaVersion | undefined {
	if (typeof value !== "string" || value.trim() !== MODEL_MATRIX_SCHEMA_VERSION) {
		issues.push({
			code: MODEL_MATRIX_VALIDATION_CODES.SCHEMA_VERSION_INVALID,
			path: "schema_version",
			message: `schema_version must be "${MODEL_MATRIX_SCHEMA_VERSION}"`,
		});
		return undefined;
	}
	return MODEL_MATRIX_SCHEMA_VERSION;
}

function parseCandidates(
	value: unknown,
	issues: ModelMatrixValidationIssue[],
): {
	keys: string[];
	normalized?: Record<string, ModelMatrixCandidate>;
} {
	if (value === undefined) {
		issues.push({
			code: MODEL_MATRIX_VALIDATION_CODES.CANDIDATES_REQUIRED,
			path: "candidates",
			message: "candidates is required",
		});
		return { keys: [] };
	}
	if (!isPlainObject(value)) {
		issues.push({
			code: MODEL_MATRIX_VALIDATION_CODES.CANDIDATES_INVALID_TYPE,
			path: "candidates",
			message: "candidates must be an object",
		});
		return { keys: [] };
	}

	const candidates = value as Record<string, unknown>;
	const entries = Object.entries(candidates);
	if (entries.length < 2) {
		issues.push({
			code: MODEL_MATRIX_VALIDATION_CODES.CANDIDATES_MIN_COUNT,
			path: "candidates",
			message: "candidates must define at least 2 entries",
		});
	}

	const normalized: Record<string, ModelMatrixCandidate> = {};
	const sortedEntries = [...entries].sort(([left], [right]) => left.localeCompare(right));
	for (const [candidateKey, candidateValue] of sortedEntries) {
		const candidatePath = `candidates.${candidateKey}`;
		if (candidateKey.trim() === "") {
			issues.push({
				code: MODEL_MATRIX_VALIDATION_CODES.CANDIDATE_KEY_INVALID,
				path: candidatePath,
				message: "candidate key must be a non-empty string",
			});
			continue;
		}
		if (!isPlainObject(candidateValue)) {
			issues.push({
				code: MODEL_MATRIX_VALIDATION_CODES.CANDIDATE_INVALID_TYPE,
				path: candidatePath,
				message: "candidate must be an object",
			});
			continue;
		}

		const candidateRecord = candidateValue as Record<string, unknown>;
		const model = normalizeNonEmptyString(candidateRecord["model"]);
		if (!model) {
			issues.push({
				code: MODEL_MATRIX_VALIDATION_CODES.CANDIDATE_MODEL_REQUIRED,
				path: `${candidatePath}.model`,
				message: "model must be a non-empty string",
			});
		}

		let provider: string | undefined;
		if (candidateRecord["provider"] !== undefined) {
			provider = normalizeNonEmptyString(candidateRecord["provider"]);
			if (!provider) {
				issues.push({
					code: MODEL_MATRIX_VALIDATION_CODES.CANDIDATE_PROVIDER_INVALID,
					path: `${candidatePath}.provider`,
					message: "provider must be a non-empty string when provided",
				});
			}
		}

		if (model) {
			normalized[candidateKey] = {
				model,
				...(provider ? { provider } : {}),
			};
		}
	}

	if (issues.length > 0) {
		return { keys: entries.map(([key]) => key) };
	}

	const orderedNormalized: Record<string, ModelMatrixCandidate> = {};
	for (const [candidateKey] of entries) {
		orderedNormalized[candidateKey] = normalized[candidateKey]!;
	}

	return {
		keys: entries.map(([key]) => key),
		normalized: orderedNormalized,
	};
}

function parsePrimary(
	value: unknown,
	candidateKeys: string[],
	issues: ModelMatrixValidationIssue[],
): string | undefined {
	const primary = normalizeNonEmptyString(value);
	if (!primary) {
		issues.push({
			code: MODEL_MATRIX_VALIDATION_CODES.PRIMARY_REQUIRED,
			path: "primary",
			message: "primary must be a non-empty string",
		});
		return undefined;
	}

	if (primary !== "judge" && !candidateKeys.includes(primary)) {
		issues.push({
			code: MODEL_MATRIX_VALIDATION_CODES.PRIMARY_UNKNOWN,
			path: "primary",
			message: `primary must match a candidate key or "judge", got "${primary}"`,
		});
	}

	return primary;
}

function parseStrategy(
	value: unknown,
	issues: ModelMatrixValidationIssue[],
): ModelMatrixStrategy | undefined {
	if (value === undefined) {
		return "shadow";
	}

	const strategy = normalizeNonEmptyString(value);
	if (!strategy || !isModelMatrixStrategy(strategy)) {
		issues.push({
			code: MODEL_MATRIX_VALIDATION_CODES.STRATEGY_INVALID,
			path: "strategy",
			message: `strategy must be one of: ${MODEL_MATRIX_STRATEGIES.join(", ")}`,
		});
		return undefined;
	}
	return strategy;
}

function parseJudge(
	value: unknown,
	issues: ModelMatrixValidationIssue[],
): ModelMatrixJudge | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!isPlainObject(value)) {
		issues.push({
			code: MODEL_MATRIX_VALIDATION_CODES.JUDGE_INVALID_TYPE,
			path: "judge",
			message: "judge must be an object when provided",
		});
		return undefined;
	}

	const judge = value as Record<string, unknown>;
	const model = normalizeNonEmptyString(judge["model"]);
	if (!model) {
		issues.push({
			code: MODEL_MATRIX_VALIDATION_CODES.JUDGE_MODEL_REQUIRED,
			path: "judge.model",
			message: "judge.model must be a non-empty string",
		});
	}

	let provider: string | undefined;
	if (judge["provider"] !== undefined) {
		provider = normalizeNonEmptyString(judge["provider"]);
		if (!provider) {
			issues.push({
				code: MODEL_MATRIX_VALIDATION_CODES.JUDGE_PROVIDER_INVALID,
				path: "judge.provider",
				message: "judge.provider must be a non-empty string when provided",
			});
		}
	}

	let dimensions: ModelMatrixJudgeDimension[] | undefined;
	if (judge["dimensions"] === undefined) {
		issues.push({
			code: MODEL_MATRIX_VALIDATION_CODES.JUDGE_DIMENSIONS_REQUIRED,
			path: "judge.dimensions",
			message: "judge.dimensions is required",
		});
	} else if (!Array.isArray(judge["dimensions"])) {
		issues.push({
			code: MODEL_MATRIX_VALIDATION_CODES.JUDGE_DIMENSIONS_INVALID_TYPE,
			path: "judge.dimensions",
			message: "judge.dimensions must be an array",
		});
	} else {
		const rawDimensions = judge["dimensions"] as unknown[];
		if (rawDimensions.length === 0) {
			issues.push({
				code: MODEL_MATRIX_VALIDATION_CODES.JUDGE_DIMENSIONS_REQUIRED,
				path: "judge.dimensions",
				message: "judge.dimensions must include at least one dimension",
			});
		}
		dimensions = [];
		let weightSum = 0;
		let sawWeightError = false;
		for (let index = 0; index < rawDimensions.length; index += 1) {
			const dimensionPath = `judge.dimensions[${index}]`;
			const dimensionValue = rawDimensions[index];
			if (!isPlainObject(dimensionValue)) {
				issues.push({
					code: MODEL_MATRIX_VALIDATION_CODES.JUDGE_DIMENSION_INVALID_TYPE,
					path: dimensionPath,
					message: "judge dimension must be an object",
				});
				sawWeightError = true;
				continue;
			}
			const dimension = dimensionValue as Record<string, unknown>;
			const dimensionName = normalizeNonEmptyString(dimension["name"]);
			if (!dimensionName) {
				issues.push({
					code: MODEL_MATRIX_VALIDATION_CODES.JUDGE_DIMENSION_NAME_REQUIRED,
					path: `${dimensionPath}.name`,
					message: "dimension name must be a non-empty string",
				});
			}

			const weightValue = dimension["weight"];
			const validWeight = typeof weightValue === "number"
				&& Number.isFinite(weightValue)
				&& weightValue >= 0
				&& weightValue <= 1;
			if (!validWeight) {
				issues.push({
					code: MODEL_MATRIX_VALIDATION_CODES.JUDGE_DIMENSION_WEIGHT_INVALID,
					path: `${dimensionPath}.weight`,
					message: "dimension weight must be a finite number between 0 and 1",
				});
				sawWeightError = true;
			}

			if (dimensionName && validWeight) {
				weightSum += weightValue;
				dimensions.push({
					name: dimensionName,
					weight: weightValue,
				});
			}
		}

		if (!sawWeightError && Math.abs(weightSum - 1) > MODEL_MATRIX_WEIGHT_SUM_EPSILON) {
			issues.push({
				code: MODEL_MATRIX_VALIDATION_CODES.JUDGE_WEIGHT_SUM_INVALID,
				path: "judge.dimensions",
				message: `dimension weights must sum to 1.0 ± ${MODEL_MATRIX_WEIGHT_SUM_EPSILON}, got ${formatNumber(weightSum)}`,
			});
		}
	}

	let scale: [number, number] | undefined;
	if (judge["scale"] === undefined) {
		issues.push({
			code: MODEL_MATRIX_VALIDATION_CODES.JUDGE_SCALE_REQUIRED,
			path: "judge.scale",
			message: "judge.scale is required",
		});
	} else if (!Array.isArray(judge["scale"])) {
		issues.push({
			code: MODEL_MATRIX_VALIDATION_CODES.JUDGE_SCALE_INVALID,
			path: "judge.scale",
			message: "judge.scale must be a [min,max] tuple",
		});
	} else {
		const scaleValue = judge["scale"] as unknown[];
		if (scaleValue.length !== 2) {
			issues.push({
				code: MODEL_MATRIX_VALIDATION_CODES.JUDGE_SCALE_INVALID,
				path: "judge.scale",
				message: "judge.scale must contain exactly 2 numeric bounds",
			});
		} else {
			const min = scaleValue[0];
			const max = scaleValue[1];
			if (typeof min !== "number" || !Number.isFinite(min)) {
				issues.push({
					code: MODEL_MATRIX_VALIDATION_CODES.JUDGE_SCALE_INVALID,
					path: "judge.scale[0]",
					message: "judge.scale[0] must be a finite number",
				});
			}
			if (typeof max !== "number" || !Number.isFinite(max)) {
				issues.push({
					code: MODEL_MATRIX_VALIDATION_CODES.JUDGE_SCALE_INVALID,
					path: "judge.scale[1]",
					message: "judge.scale[1] must be a finite number",
				});
			}
			if (typeof min === "number" && Number.isFinite(min) && typeof max === "number" && Number.isFinite(max)) {
				if (min >= max) {
					issues.push({
						code: MODEL_MATRIX_VALIDATION_CODES.JUDGE_SCALE_RANGE_INVALID,
						path: "judge.scale",
						message: `judge.scale requires min < max, got [${formatNumber(min)}, ${formatNumber(max)}]`,
					});
				} else {
					scale = [min, max];
				}
			}
		}
	}

	if (!model || !dimensions || !scale) {
		return undefined;
	}

	return {
		model,
		...(provider ? { provider } : {}),
		dimensions,
		scale,
	};
}

function isModelMatrixStrategy(value: string): value is ModelMatrixStrategy {
	return (MODEL_MATRIX_STRATEGIES as readonly string[]).includes(value);
}

function normalizeNonEmptyString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized === "" ? undefined : normalized;
}

function formatNumber(value: number): string {
	return Number(value.toPrecision(15)).toString();
}

function formatModelMatrixValidationErrorMessage(
	issues: ModelMatrixValidationIssue[],
	source?: string,
): string {
	const heading = source
		? `[model-matrix] invalid model matrix document (${source})`
		: "[model-matrix] invalid model matrix document";
	if (issues.length === 0) {
		return heading;
	}
	return `${heading}\n${issues.map((issue) => `- ${issue.path || "(root)"}: [${issue.code}] ${issue.message}`).join("\n")}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
