import { describe, expect, it } from "vitest";

import {
	MODEL_MATRIX_SCHEMA_VERSION,
	MODEL_MATRIX_STRATEGIES,
	MODEL_MATRIX_VALIDATION_CODES,
	MODEL_MATRIX_WEIGHT_SUM_EPSILON,
	ModelMatrixValidationError,
	parseModelMatrixDocument,
	validateModelMatrixDocument,
} from "./model-matrix-schema.js";

function makeValidMatrix(): Record<string, unknown> {
	return {
		schema_version: "matrix/v1",
		candidates: {
			fast: { model: "openai/gpt-4o-mini", provider: "openrouter" },
			balanced: { model: "openai/gpt-5.3-codex", provider: "openrouter" },
		},
		primary: "balanced",
		strategy: "all_sync",
		judge: {
			model: "anthropic/claude-sonnet-4-6",
			provider: "openrouter",
			dimensions: [
				{ name: "accuracy", weight: 0.5 },
				{ name: "completeness", weight: 0.5 },
			],
			scale: [1, 10],
		},
	};
}

function findIssue(issues: ReturnType<typeof validateModelMatrixDocument>, code: string, path?: string) {
	return issues.find((issue) => issue.code === code && (path === undefined || issue.path === path));
}

describe("model-matrix-schema", () => {
	it("exports stable schema and strategy constants", () => {
		expect(MODEL_MATRIX_SCHEMA_VERSION).toBe("matrix/v1");
		expect(MODEL_MATRIX_STRATEGIES).toEqual(["shadow", "all_sync", "rotate"]);
		expect(MODEL_MATRIX_WEIGHT_SUM_EPSILON).toBeGreaterThan(0);
	});

	it("parses a valid full matrix and normalizes string values", () => {
		const parsed = parseModelMatrixDocument({
			schema_version: "matrix/v1",
			candidates: {
				fast: { model: " openai/gpt-4o-mini ", provider: " openrouter " },
				balanced: { model: " openai/gpt-5.3-codex ", provider: " openrouter " },
			},
			primary: " balanced ",
			strategy: " rotate ",
			judge: {
				model: " anthropic/claude-sonnet-4-6 ",
				provider: " openrouter ",
				dimensions: [
					{ name: " accuracy ", weight: 0.7 },
					{ name: " completeness ", weight: 0.3 },
				],
				scale: [1, 10],
			},
		});

		expect(parsed.strategy).toBe("rotate");
		expect(parsed.primary).toBe("balanced");
		expect(parsed.candidates.fast).toEqual({
			model: "openai/gpt-4o-mini",
			provider: "openrouter",
		});
		expect(parsed.candidates.balanced).toEqual({
			model: "openai/gpt-5.3-codex",
			provider: "openrouter",
		});
		expect(parsed.judge).toEqual({
			model: "anthropic/claude-sonnet-4-6",
			provider: "openrouter",
			dimensions: [
				{ name: "accuracy", weight: 0.7 },
				{ name: "completeness", weight: 0.3 },
			],
			scale: [1, 10],
		});
	});

	it("accepts valid config without judge and defaults strategy to shadow", () => {
		const parsed = parseModelMatrixDocument({
			schema_version: "matrix/v1",
			candidates: {
				fast: { model: "openai/gpt-4o-mini" },
				balanced: { model: "openai/gpt-5.3-codex" },
			},
			primary: "fast",
		});

		expect(parsed.strategy).toBe("shadow");
		expect(parsed.judge).toBeUndefined();
	});

	it("accepts primary='judge'", () => {
		const parsed = parseModelMatrixDocument({
			schema_version: "matrix/v1",
			candidates: {
				fast: { model: "openai/gpt-4o-mini" },
				balanced: { model: "openai/gpt-5.3-codex" },
			},
			primary: "judge",
		});

		expect(parsed.primary).toBe("judge");
	});

	it("reports invalid schema version", () => {
		const issues = validateModelMatrixDocument({
			...makeValidMatrix(),
			schema_version: "matrix/v0",
		});
		const issue = findIssue(issues, MODEL_MATRIX_VALIDATION_CODES.SCHEMA_VERSION_INVALID, "schema_version");
		expect(issue?.message).toContain('schema_version must be "matrix/v1"');
	});

	it("reports missing candidates and fewer-than-2 candidates", () => {
		const missingIssues = validateModelMatrixDocument({
			schema_version: "matrix/v1",
			primary: "fast",
		});
		expect(findIssue(missingIssues, MODEL_MATRIX_VALIDATION_CODES.CANDIDATES_REQUIRED, "candidates")).toBeTruthy();

		const minIssues = validateModelMatrixDocument({
			schema_version: "matrix/v1",
			candidates: { fast: { model: "openai/gpt-4o-mini" } },
			primary: "fast",
		});
		expect(findIssue(minIssues, MODEL_MATRIX_VALIDATION_CODES.CANDIDATES_MIN_COUNT, "candidates")).toBeTruthy();
	});

	it("reports candidate model path-specific errors", () => {
		const issues = validateModelMatrixDocument({
			schema_version: "matrix/v1",
			candidates: {
				fast: { provider: "openrouter" },
				balanced: { model: "openai/gpt-5.3-codex" },
			},
			primary: "balanced",
		});

		const issue = findIssue(
			issues,
			MODEL_MATRIX_VALIDATION_CODES.CANDIDATE_MODEL_REQUIRED,
			"candidates.fast.model",
		);
		expect(issue?.message).toBe("model must be a non-empty string");
	});

	it("reports unknown primary", () => {
		const issues = validateModelMatrixDocument({
			...makeValidMatrix(),
			primary: "frontier",
		});
		const issue = findIssue(issues, MODEL_MATRIX_VALIDATION_CODES.PRIMARY_UNKNOWN, "primary");
		expect(issue?.message).toContain('primary must match a candidate key or "judge"');
	});

	it("reports invalid strategy", () => {
		const issues = validateModelMatrixDocument({
			...makeValidMatrix(),
			strategy: "invalid",
		});
		const issue = findIssue(issues, MODEL_MATRIX_VALIDATION_CODES.STRATEGY_INVALID, "strategy");
		expect(issue?.message).toContain("strategy must be one of");
	});

	it("reports malformed judge dimensions and scale with deterministic paths", () => {
		const issues = validateModelMatrixDocument({
			...makeValidMatrix(),
			judge: {
				model: "anthropic/claude-sonnet-4-6",
				dimensions: [
					{ name: "", weight: 0.5 },
					{ name: "accuracy", weight: "bad" },
				],
				scale: [10, 1],
			},
		});

		expect(findIssue(issues, MODEL_MATRIX_VALIDATION_CODES.JUDGE_DIMENSION_NAME_REQUIRED, "judge.dimensions[0].name")).toBeTruthy();
		expect(findIssue(issues, MODEL_MATRIX_VALIDATION_CODES.JUDGE_DIMENSION_WEIGHT_INVALID, "judge.dimensions[1].weight")).toBeTruthy();
		expect(findIssue(issues, MODEL_MATRIX_VALIDATION_CODES.JUDGE_SCALE_RANGE_INVALID, "judge.scale")).toBeTruthy();
	});

	it("enforces weight sum with tolerance edge behavior", () => {
		const validNearBoundary = validateModelMatrixDocument({
			schema_version: "matrix/v1",
			candidates: {
				fast: { model: "openai/gpt-4o-mini" },
				balanced: { model: "openai/gpt-5.3-codex" },
			},
			primary: "fast",
			judge: {
				model: "anthropic/claude-sonnet-4-6",
				dimensions: [
					{ name: "a", weight: 0.5 },
					{ name: "b", weight: 0.5 + MODEL_MATRIX_WEIGHT_SUM_EPSILON / 2 },
					{ name: "c", weight: -MODEL_MATRIX_WEIGHT_SUM_EPSILON / 2 },
				],
				scale: [1, 10],
			},
		});
		expect(findIssue(validNearBoundary, MODEL_MATRIX_VALIDATION_CODES.JUDGE_WEIGHT_SUM_INVALID)).toBeUndefined();

		const invalidNearBoundary = validateModelMatrixDocument({
			schema_version: "matrix/v1",
			candidates: {
				fast: { model: "openai/gpt-4o-mini" },
				balanced: { model: "openai/gpt-5.3-codex" },
			},
			primary: "fast",
			judge: {
				model: "anthropic/claude-sonnet-4-6",
				dimensions: [
					{ name: "a", weight: 0.6 },
					{ name: "b", weight: 0.4 + MODEL_MATRIX_WEIGHT_SUM_EPSILON * 2 },
				],
				scale: [1, 10],
			},
		});
		expect(findIssue(invalidNearBoundary, MODEL_MATRIX_VALIDATION_CODES.JUDGE_WEIGHT_SUM_INVALID, "judge.dimensions")).toBeTruthy();
	});

	it("throws ModelMatrixValidationError with source and stable issue codes", () => {
		expect(() =>
			parseModelMatrixDocument(
				{
					schema_version: "matrix/v1",
					candidates: {
						fast: { model: "openai/gpt-4o-mini" },
					},
					primary: "fast",
				},
				{ source: "config/model-matrix.json" },
			),
		).toThrow(ModelMatrixValidationError);

		try {
			parseModelMatrixDocument(
				{
					schema_version: "matrix/v1",
					candidates: {
						fast: { model: "openai/gpt-4o-mini" },
					},
					primary: "fast",
				},
				{ source: "config/model-matrix.json" },
			);
		} catch (error) {
			expect(error).toBeInstanceOf(ModelMatrixValidationError);
			const validationError = error as ModelMatrixValidationError;
			expect(validationError.source).toBe("config/model-matrix.json");
			expect(validationError.issues[0]?.code).toBe(MODEL_MATRIX_VALIDATION_CODES.CANDIDATES_MIN_COUNT);
			expect(validationError.message).toContain("config/model-matrix.json");
			expect(validationError.message).toContain(MODEL_MATRIX_VALIDATION_CODES.CANDIDATES_MIN_COUNT);
		}
	});
});
