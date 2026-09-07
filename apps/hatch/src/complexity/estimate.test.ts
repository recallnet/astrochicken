import { describe, expect, it } from "vitest";

import { estimateComplexity, complexityTelemetryData } from "./estimate.js";
import { COMPLEXITY_OTEL_CLASS_KEY } from "./signals.js";

const DETERMINISTIC_FIXTURE = {
	issue_title: "Simple refactor",
	issue_body: "No external side effects",
	estimated_lines_added: 50,
	estimated_lines_deleted: 0,
	estimated_file_count: 3,
	changed_files: ["src/a.ts", "src/b.ts", "src/c.ts"],
	dependency_count: 1,
	blocked_by_count: 0,
	blocks_count: 0,
	qa_command: "npm test",
} as const;

describe("estimateComplexity", () => {
	it("classifies low complexity when signals are small and QA exists", () => {
		const estimate = estimateComplexity({
			issue_title: "Update exports",
			issue_body: "Small refactor",
			estimated_lines_added: 12,
			estimated_lines_deleted: 1,
			estimated_file_count: 1,
			changed_files: ["src/index.ts"],
			qa_command: "npm test -- --runInBand",
			dependency_count: 0,
			blocked_by_count: 0,
			blocks_count: 0,
		});

		expect(estimate.complexity_class).toBe("low");
		expect(estimate.otel_dimension_key).toBe(COMPLEXITY_OTEL_CLASS_KEY);
		expect(estimate.reason).toContain("class=low");
		expect(estimate.signals.diff_size?.value).toBe("small");
		expect(estimate.signals.diff_size?._unknown).toBe(false);
	});

	it("is byte-stable for contract fields across repeated runs with identical metadata", () => {
		const estimateA = estimateComplexity(DETERMINISTIC_FIXTURE);
		const estimateB = estimateComplexity(DETERMINISTIC_FIXTURE);

		const contractA = JSON.stringify({
			complexity_class: estimateA.complexity_class,
			signals: estimateA.signals,
			reason: estimateA.reason,
			score: estimateA.score,
			otel_dimension_key: estimateA.otel_dimension_key,
		});
		const contractB = JSON.stringify({
			complexity_class: estimateB.complexity_class,
			signals: estimateB.signals,
			reason: estimateB.reason,
			score: estimateB.score,
			otel_dimension_key: estimateB.otel_dimension_key,
		});

		expect(contractA).toBe(contractB);
		expect(estimateA.signals.dependency_pressure).toMatchObject({
			value: "moderate",
			reason: "dependency_total=1",
			score: 1,
			_reason: "dependency_total=1",
			_score: 1,
			_unknown: false,
		});
	});

	it("fails safe to high with deterministic reason when metadata is ambiguous", () => {
		const estimate = estimateComplexity({
			issue_title: "",
			issue_body: "",
		});
		expect(estimate.complexity_class).toBe("high");
		expect(estimate.reason).toBe(
			"class=high;score=6;top=diff_size:unknown(missing_line_estimate)|dependency_pressure:unknown(missing_dependency_metadata)|qa_signal:missing(missing_qa_command)",
		);
		expect(estimate.signals.diff_size).toMatchObject({
			value: "unknown",
			reason: "missing_line_estimate",
			score: 2,
			_reason: "missing_line_estimate",
			_score: 2,
			_unknown: true,
		});
		expect(estimate.signals.qa_signal?._unknown).toBe(true);
	});

	it("raises class for sensitive paths and side effects", () => {
		const estimate = estimateComplexity({
			issue_title: "Deploy auth migration",
			issue_body: "Includes production migration and external API changes",
			estimated_lines_added: 80,
			estimated_lines_deleted: 40,
			changed_files: ["infra/terraform/main.tf", "src/auth/guard.ts"],
			estimated_file_count: 5,
			dependency_count: 3,
			blocked_by_count: 1,
			blocks_count: 1,
		});

		expect(estimate.complexity_class).toBe("high");
		expect(estimate.signals.sensitive_paths?.value).toBe("true");
		expect(estimate.signals.side_effect_keywords?.value).toBe("true");
	});

	it("keeps reason format deterministic with class/score/top fields", () => {
		const estimate = estimateComplexity(DETERMINISTIC_FIXTURE);

		expect(estimate.reason).toMatch(/^class=(low|medium|high);score=-?\d+;top=[^|]+\|[^|]+\|[^|]+$/);
		expect(estimate.reason).toContain("class=medium");
		expect(estimate.reason).toContain("score=2");
		const [firstTop] = estimate.reason.split("top=")[1].split("|");
		expect(firstTop).toContain("dependency_pressure:moderate");
	});
});

describe("complexityTelemetryData", () => {
	it("serializes event payload keys", () => {
		const estimate = estimateComplexity({
			issue_title: "Small export patch",
			issue_body: "No external side effects",
			estimated_lines_added: 5,
			estimated_lines_deleted: 1,
			estimated_file_count: 1,
			changed_files: ["src/a.ts"],
			qa_command: "npm test",
			dependency_count: 0,
			blocked_by_count: 0,
			blocks_count: 0,
		});

		const data = complexityTelemetryData(estimate);
		expect(data.complexity_class).toBe("low");
		expect(data.complexity_otel_key).toBe(COMPLEXITY_OTEL_CLASS_KEY);
		expect(data[COMPLEXITY_OTEL_CLASS_KEY]).toBe("low");
		expect(() => JSON.parse(data.complexity_signals)).not.toThrow();
	});
});
