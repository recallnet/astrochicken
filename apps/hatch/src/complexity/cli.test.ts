import { describe, expect, it } from "vitest";

import { runComplexityEstimateCommand } from "./cli.js";

const DETERMINISTIC_CLI_ARGS = [
	"estimate",
	"--issue-title",
	"Refactor exports",
	"--issue-body",
	"Small update. Add tests.",
	"--changed-files",
	"src/index.ts",
	"--estimated-lines-added",
	"8",
	"--estimated-lines-deleted",
	"2",
	"--estimated-file-count",
	"1",
	"--dependency-count",
	"0",
	"--blocked-by-count",
	"0",
	"--blocks-count",
	"0",
	"--qa-command",
	"npm test",
] as const;

describe("runComplexityEstimateCommand", () => {
	it("returns strict complexity-estimate payload contract", () => {
		const result = runComplexityEstimateCommand([...DETERMINISTIC_CLI_ARGS]);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(Object.keys(result.payload).sort()).toEqual([
			"complexity_class",
			"otel_dimension_key",
			"reason",
			"score",
			"signals",
		]);
		expect(result.payload.complexity_class).toBe("low");
		expect(result.payload.signals.diff_size).toEqual(
			expect.objectContaining({
				value: "small",
				reason: "line_change_total=10",
				score: 0,
				_reason: "line_change_total=10",
				_score: 0,
				_unknown: false,
			}),
		);
	});

	it("is byte-stable across repeated estimate runs with identical metadata", () => {
		const resultA = runComplexityEstimateCommand([...DETERMINISTIC_CLI_ARGS]);
		const resultB = runComplexityEstimateCommand([...DETERMINISTIC_CLI_ARGS]);
		expect(resultA.ok).toBe(true);
		expect(resultB.ok).toBe(true);
		if (!resultA.ok || !resultB.ok) return;

		const contractA = JSON.stringify({
			complexity_class: resultA.payload.complexity_class,
			signals: resultA.payload.signals,
			reason: resultA.payload.reason,
			score: resultA.payload.score,
			otel_dimension_key: resultA.payload.otel_dimension_key,
		});
		const contractB = JSON.stringify({
			complexity_class: resultB.payload.complexity_class,
			signals: resultB.payload.signals,
			reason: resultB.payload.reason,
			score: resultB.payload.score,
			otel_dimension_key: resultB.payload.otel_dimension_key,
		});
		expect(contractA).toBe(contractB);
	});

	it("fails closed to high with deterministic ambiguity reason when metadata is missing", () => {
		const result = runComplexityEstimateCommand(["estimate", "--issue-title", "", "--issue-body", ""]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.payload.complexity_class).toBe("high");
		expect(result.payload.reason).toBe(
			"class=high;score=6;top=diff_size:unknown(missing_line_estimate)|dependency_pressure:unknown(missing_dependency_metadata)|qa_signal:missing(missing_qa_command)",
		);
		expect(result.payload.signals.diff_size?.value).toBe("unknown");
		expect(result.payload.signals.diff_size?._unknown).toBe(true);
		expect(result.payload.signals.dependency_pressure?._unknown).toBe(true);
	});

	it("supports relationship list flags as deterministic estimator inputs", () => {
		const result = runComplexityEstimateCommand([
			"estimate",
			"--issue-body",
			"Touches 2 files",
			"--dependencies",
			"#10,#11",
			"--blocked-by",
			"#12",
			"--blocks",
			"#13",
		]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.payload.signals.dependency_pressure?.value).toBe("high");
		expect(result.payload.signals.dependency_pressure?.reason).toBe("dependency_total=4");
	});
});
