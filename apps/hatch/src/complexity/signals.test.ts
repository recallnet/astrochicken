import { describe, expect, it } from "vitest";

import { complexityTelemetryData, estimateComplexity } from "./estimate.js";
import {
	allComplexitySignals,
	normalizeComplexityInput,
	signalDependencyPressure,
	signalDiffSize,
	signalFileCount,
	signalQaCoverage,
	signalSensitivePaths,
	signalSideEffects,
} from "./signals.js";

describe("normalizeComplexityInput", () => {
	it("normalizes aliases and list-derived counters deterministically", () => {
		const normalized = normalizeComplexityInput({
			title: "Patch auth",
			description: "deploy migration",
			paths: "src/auth/guard.ts,infra/terraform/main.tf",
			lines_added: "10",
			lines_deleted: 5,
			file_count: "2",
			dependencies: ["#1", "#2"],
			blocked_by: "[#3]",
			blocks: ["#4"],
			test_command: "npm test",
		});

		expect(normalized).toEqual({
			issue_title: "Patch auth",
			issue_body: "deploy migration",
			changed_files: ["src/auth/guard.ts", "infra/terraform/main.tf"],
			estimated_lines_added: 10,
			estimated_lines_deleted: 5,
			estimated_file_count: 2,
			dependency_count: 2,
			blocked_by_count: 1,
			blocks_count: 1,
			qa_command: "npm test",
		});
	});
});

describe("signalDiffSize", () => {
	it("returns unknown when line metadata is missing", () => {
		expect(signalDiffSize({})).toEqual({
			key: "diff_size",
			value: "unknown",
			score: 2,
			reason: "missing_line_estimate",
			unknown: true,
		});
	});

	it("applies deterministic threshold buckets", () => {
		expect(signalDiffSize({ estimated_lines_added: 40, estimated_lines_deleted: 0 })).toMatchObject({
			value: "small",
			score: 0,
			reason: "line_change_total=40",
		});
		expect(signalDiffSize({ estimated_lines_added: 120, estimated_lines_deleted: 80 })).toMatchObject({
			value: "medium",
			score: 1,
			reason: "line_change_total=200",
		});
		expect(signalDiffSize({ estimated_lines_added: 201, estimated_lines_deleted: 0 })).toMatchObject({
			value: "large",
			score: 2,
			reason: "line_change_total=201",
		});
	});

	it("infers diff-size from issue text when numeric metadata is absent", () => {
		expect(signalDiffSize({ issue_body: "Estimated impact: 18 lines changed" })).toMatchObject({
			value: "small",
			score: 0,
			reason: "line_change_total=18",
		});
		expect(signalDiffSize({ issue_body: "Major rewrite across parser modules" })).toMatchObject({
			value: "large",
			score: 2,
			reason: "issue_text_scope=large_change",
		});
	});
});

describe("signalFileCount", () => {
	it("falls back to changed_files length when estimated_file_count is missing", () => {
		expect(signalFileCount({ changed_files: ["a.ts", "b.ts"] })).toMatchObject({
			value: "small",
			score: 0,
			reason: "files=2",
		});
	});

	it("returns unknown when file metadata is missing", () => {
		expect(signalFileCount({})).toEqual({
			key: "file_count",
			value: "unknown",
			score: 2,
			reason: "missing_file_count",
			unknown: true,
		});
	});

	it("applies boundary buckets for medium and large", () => {
		expect(signalFileCount({ estimated_file_count: 8 })).toMatchObject({
			value: "medium",
			score: 1,
			reason: "files=8",
		});
		expect(signalFileCount({ estimated_file_count: 9 })).toMatchObject({
			value: "large",
			score: 2,
			reason: "files=9",
		});
	});

	it("infers file-count hints from issue text", () => {
		expect(signalFileCount({ issue_body: "Touches 3 files across parser package" })).toMatchObject({
			value: "medium",
			score: 1,
			reason: "files=3",
		});
		expect(signalFileCount({ issue_body: "single file hotfix in src/index.ts" })).toMatchObject({
			value: "small",
			score: 0,
			reason: "files=1",
		});
	});
});

describe("signalSensitivePaths", () => {
	it("returns unknown when changed files are missing", () => {
		expect(signalSensitivePaths({})).toEqual({
			key: "sensitive_paths",
			value: "unknown",
			score: 1,
			reason: "missing_changed_files",
			unknown: true,
		});
	});

	it("detects sensitive path patterns deterministically", () => {
		expect(signalSensitivePaths({ changed_files: ["src/index.ts"] })).toMatchObject({
			value: "false",
			score: 0,
			reason: "no_sensitive_paths",
		});
		expect(signalSensitivePaths({ changed_files: ["infra/terraform/main.tf"] })).toMatchObject({
			value: "true",
			score: 2,
			reason: "matched=infra/terraform/main.tf",
		});
		expect(signalSensitivePaths({ changed_files: ["docs/reference/validation.md"] })).toMatchObject({
			value: "true",
			score: 2,
			reason: "matched=docs/reference/validation.md",
		});
	});

	it("infers sensitive-path risk from issue text when changed files are missing", () => {
		expect(signalSensitivePaths({ issue_body: "Touches apps/hatch/src/cli.ts and CI workflows" })).toMatchObject({
			value: "true",
			score: 2,
		});
	});
});

describe("signalSideEffects", () => {
	it("returns unknown when issue text is missing", () => {
		expect(signalSideEffects({})).toEqual({
			key: "side_effect_keywords",
			value: "unknown",
			score: 1,
			reason: "missing_issue_text",
			unknown: true,
		});
	});

	it("returns false when issue text is absent but changed files are non-side-effect paths", () => {
		expect(signalSideEffects({ changed_files: ["src/index.ts"] })).toEqual({
			key: "side_effect_keywords",
			value: "false",
			score: 0,
			reason: "no_side_effect_paths_or_keywords",
		});
	});

	it("detects external effect keywords and no-keyword case", () => {
		expect(signalSideEffects({ issue_title: "Refactor imports", issue_body: "no side effects" })).toMatchObject({
			value: "false",
			score: 0,
			reason: "no_side_effect_keywords",
		});
		expect(
			signalSideEffects({
				issue_title: "Deploy auth migration",
				issue_body: "touches production database",
			}),
		).toMatchObject({ value: "true", score: 2 });
		expect(
			signalSideEffects({
				issue_title: "Update API contract",
				issue_body: "Adjust terraform variables",
			}),
		).toMatchObject({ value: "true", score: 2 });
		expect(
			signalSideEffects({
				changed_files: ["infra/deploy/main.tf"],
			}),
		).toMatchObject({ value: "true", score: 2, reason: "matched_path=infra/deploy/main.tf" });
	});
});

describe("signalDependencyPressure", () => {
	it("returns unknown when dependency metadata is missing", () => {
		expect(signalDependencyPressure({})).toEqual({
			key: "dependency_pressure",
			value: "unknown",
			score: 1,
			reason: "missing_dependency_metadata",
			unknown: true,
		});
	});

	it("classifies none/moderate/high from deterministic totals", () => {
		expect(signalDependencyPressure({ dependency_count: 0, blocked_by_count: 0, blocks_count: 0 })).toMatchObject({
			value: "none",
			score: 0,
			reason: "dependency_total=0",
		});
		expect(signalDependencyPressure({ dependency_count: 1, blocked_by_count: 1, blocks_count: 0 })).toMatchObject({
			value: "moderate",
			score: 1,
			reason: "dependency_total=2",
		});
		expect(signalDependencyPressure({ dependency_count: 1, blocked_by_count: 1, blocks_count: 1 })).toMatchObject({
			value: "high",
			score: 2,
			reason: "dependency_total=3",
		});
	});

	it("infers dependency pressure from blocked-by/blocks issue text sections", () => {
		const signal = signalDependencyPressure({
			issue_body: "Blocked-by: #101 #102\nBlocks: #201\nDepends on: #301",
		});
		expect(signal).toMatchObject({
			value: "high",
			score: 2,
			reason: "dependency_total=4",
		});
	});
});

describe("signalQaCoverage", () => {
	it("returns missing when QA command is absent", () => {
		expect(signalQaCoverage({})).toEqual({
			key: "qa_signal",
			value: "missing",
			score: 1,
			reason: "missing_qa_command",
			unknown: true,
		});
	});

	it("infers test coverage intent from issue text when qa command is missing", () => {
		expect(signalQaCoverage({ issue_body: "Add tests and expand unit test coverage" })).toMatchObject({
			value: "present_from_issue_text",
			score: -1,
		});
	});

	it("detects explicit test coverage command", () => {
		expect(signalQaCoverage({ qa_command: "npm test -- --runInBand" })).toMatchObject({
			value: "present",
			score: -1,
			reason: "qa_command_indicates_test_coverage",
		});
	});

	it("marks non-test QA commands separately", () => {
		expect(signalQaCoverage({ qa_command: "npm run lint" })).toMatchObject({
			value: "present_non_test",
			score: 0,
			reason: "qa_command_present_without_explicit_test_signal",
		});
	});
});

describe("allComplexitySignals", () => {
	it("returns a deterministic key order for reason ranking stability", () => {
		const keys = allComplexitySignals({}).map((signal) => signal.key);
		expect(keys).toEqual([
			"diff_size",
			"file_count",
			"sensitive_paths",
			"side_effect_keywords",
			"dependency_pressure",
			"qa_signal",
		]);
	});
});

describe("estimateComplexity aggregation contract", () => {
	it("escalates to high when multiple high-risk signals conflict despite medium score", () => {
		const estimate = estimateComplexity({
			issue_title: "Deploy migration",
			issue_body: "Touches production rollout guardrails",
			estimated_lines_added: 5,
			estimated_lines_deleted: 0,
			estimated_file_count: 1,
			changed_files: ["infra/terraform/main.tf"],
			dependency_count: 0,
			blocked_by_count: 0,
			blocks_count: 0,
			qa_command: "npm test",
		});

		expect(estimate.score).toBe(3);
		expect(estimate.complexity_class).toBe("high");
		expect(estimate.reason).toContain("class=high");
		expect(estimate.reason).toContain("sensitive_paths:true");
		expect(estimate.reason).toContain("side_effect_keywords:true");
	});

	it("derives deterministic class from issue-body-only metadata hints", () => {
		const estimate = estimateComplexity({
			issue_title: "Refactor parser modules",
			issue_body:
				"Estimated impact: 32 lines changed across 2 files. Add tests for parser edge cases. Blocked-by: #42",
		});

		expect(estimate.signals.diff_size?.value).toBe("small");
		expect(estimate.signals.file_count?.value).toBe("small");
		expect(estimate.signals.qa_signal?.value).toBe("present_from_issue_text");
		expect(estimate.signals.dependency_pressure?.value).toBe("moderate");
		expect(estimate.signals.dependency_pressure?._unknown).toBe(false);
		expect(estimate.reason).toContain("class=");
	});

	it("serializes telemetry payload expected by waveComplexityEstimate consumers", () => {
		const estimate = estimateComplexity({
			issue_title: "Refactor exports",
			issue_body: "No side effects",
			estimated_lines_added: 8,
			estimated_lines_deleted: 2,
			estimated_file_count: 1,
			changed_files: ["src/index.ts"],
			dependency_count: 0,
			blocked_by_count: 0,
			blocks_count: 0,
			qa_command: "npm test",
		});

		const telemetry = complexityTelemetryData(estimate);
		expect(telemetry.complexity_class).toBe(estimate.complexity_class);
		expect(telemetry.complexity_reason).toBe(estimate.reason);
		expect(telemetry.complexity_otel_key).toBe("hatch.complexity.class");
		expect(telemetry["hatch.complexity.class"]).toBe(estimate.complexity_class);
		expect(JSON.parse(telemetry.complexity_signals)).toEqual(estimate.signals);
	});
});
