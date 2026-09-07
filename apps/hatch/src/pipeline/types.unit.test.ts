import { describe, expect, it } from "vitest";

import {
	MODEL_MATRIX_STRATEGIES,
	type ModelMatrixStrategy,
} from "./model-matrix-schema.js";
import {
	CANDIDATE_EXECUTION_STATUSES,
	MODEL_MATRIX_EXECUTION_STRATEGIES,
	parseCandidateResultSetJson,
	toCandidateResultSetJson,
	type CandidateResultSet,
} from "./types.js";

describe("candidate result set contract", () => {
	it("round-trips deterministic payloads via JSON helpers", () => {
		const payload: CandidateResultSet = {
			nodeId: "evaluate_models",
			matrixId: "matrix/reviewer",
			strategy: "shadow",
			primary: "alpha",
			completedAt: 1712784000000,
			candidates: [
				{
					candidateName: "beta",
					model: "gpt-4.1",
					provider: "openai",
					status: "success",
					output: "beta output",
					error: null,
					latencyMs: 91,
					completedAt: 1712784000000,
					inputTokens: 10,
					outputTokens: 12,
					totalTokens: 22,
					costUsd: 0.0042,
					ttftMs: 34,
				},
				{
					candidateName: "alpha",
					model: "claude-sonnet-4-5",
					provider: "anthropic",
					status: "success",
					output: "alpha output",
					error: null,
					latencyMs: 84,
					completedAt: 1712784000000,
					inputTokens: 9,
					outputTokens: 8,
					totalTokens: 17,
					costUsd: 0.0039,
					ttftMs: 29,
				},
			],
		};

		const firstJson = toCandidateResultSetJson(payload);
		const parsed = parseCandidateResultSetJson(firstJson);
		const secondJson = toCandidateResultSetJson(parsed);

		expect(parsed.candidates.map((candidate) => candidate.candidateName)).toEqual([
			"alpha",
			"beta",
		]);
		expect(parsed.primary).toBe("alpha");
		expect(secondJson).toBe(firstJson);
	});

	it("normalizes missing optional usage/cost metrics to null defaults", () => {
		const parsed = parseCandidateResultSetJson(
			JSON.stringify({
				nodeId: "n1",
				matrixId: "m1",
				strategy: "all_sync",
				primary: "primary",
				completedAt: 1712784100000,
				candidates: [
					{
						candidateName: "primary",
						model: "gpt-5.3-codex",
						status: "success",
						output: "ok",
					},
				],
			}),
		);

		const candidate = parsed.candidates[0]!;
		expect(candidate.provider).toBeNull();
		expect(candidate.error).toBeNull();
		expect(candidate.latencyMs).toBeNull();
		expect(candidate.completedAt).toBe(1712784100000);
		expect(candidate.inputTokens).toBeNull();
		expect(candidate.outputTokens).toBeNull();
		expect(candidate.totalTokens).toBeNull();
		expect(candidate.costUsd).toBeNull();
		expect(candidate.ttftMs).toBeNull();
	});

	it("normalizes failed candidate failure payload", () => {
		const parsed = parseCandidateResultSetJson(
			JSON.stringify({
				nodeId: "n2",
				matrixId: "m2",
				strategy: "rotate",
				primary: "primary",
				completedAt: 1712784200000,
				candidates: [
					{
						candidateName: "primary",
						model: "model-a",
						status: "failed",
						output: "",
						error: " timeout contacting provider ",
						latencyMs: 100,
						completedAt: 1712784200000,
					},
				],
			}),
		);

		expect(parsed.candidates[0]?.status).toBe("failed");
		expect(parsed.candidates[0]?.error).toBe("timeout contacting provider");
	});

	it("rejects invalid JSON payloads and invalid required shapes", () => {
		expect(() => parseCandidateResultSetJson("{"))
			.toThrow(/\[candidate-result-set\] invalid JSON payload:/);
		expect(() =>
			parseCandidateResultSetJson(
				JSON.stringify({
					nodeId: "n3",
					matrixId: "m3",
					strategy: "shadow",
					primary: "primary",
					completedAt: 10,
					candidates: [
						{
							candidateName: "primary",
							model: "model-a",
							status: "success",
							output: "ok",
							latencyMs: -1,
						},
					],
				}),
			),
		).toThrow(/candidates\[0\]\.latencyMs must be a non-negative finite number when provided/);
	});

	it("keeps execution strategy literals aligned with model-matrix schema", () => {
		expect(MODEL_MATRIX_EXECUTION_STRATEGIES).toEqual(MODEL_MATRIX_STRATEGIES);

		const supported = new Set<ModelMatrixStrategy>(MODEL_MATRIX_STRATEGIES);
		expect(CANDIDATE_EXECUTION_STATUSES).toEqual(["success", "failed"]);

		for (const strategy of MODEL_MATRIX_EXECUTION_STRATEGIES) {
			expect(supported.has(strategy)).toBe(true);
		}
	});
});
