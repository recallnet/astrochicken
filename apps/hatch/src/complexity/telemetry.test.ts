import { describe, expect, it } from "vitest";

import {
	DEFAULT_COMPLEXITY_CLASS,
	DEFAULT_COMPLEXITY_OTEL_KEY,
	DEFAULT_COMPLEXITY_REASON,
	complexityTelemetryEventData,
	extractComplexityDimensions,
	resolveComplexityTelemetry,
} from "./telemetry.js";
import { StageStatus } from "../pipeline/context.js";

describe("resolveComplexityTelemetry", () => {
	it("extracts estimator payload fields from stage outcome output", () => {
		const telemetry = resolveComplexityTelemetry({
			context: {},
			outcome: {
				status: StageStatus.Completed,
				output: JSON.stringify({
					complexity_class: "medium",
					signals: {
						diff_size: {
							value: "medium",
							reason: "line_change_total=120",
							score: 1,
							_reason: "line_change_total=120",
							_score: 1,
							_unknown: false,
						},
					},
					reason: "class=medium;score=3;top=diff_size:medium",
					otel_dimension_key: "hatch.complexity.class",
				}),
			},
		});

		expect(telemetry.complexityClass).toBe("medium");
		expect(telemetry.reason).toBe("class=medium;score=3;top=diff_size:medium");
		expect(telemetry.otelDimensionKey).toBe("hatch.complexity.class");
		expect(telemetry.signalMap).toEqual({
			diff_size: {
				value: "medium",
				reason: "line_change_total=120",
				score: 1,
				_reason: "line_change_total=120",
				_score: 1,
				_unknown: false,
			},
		});
		expect(telemetry.pathTaken).toBe("moderate");
		expect(telemetry.executionPath).toBe("moderate");
	});

	it("falls back to deterministic defaults when estimator payload is absent", () => {
		const telemetry = resolveComplexityTelemetry({
			context: {},
			outcome: {
				status: StageStatus.Completed,
				output: "ok",
			},
		});

		expect(telemetry.complexityClass).toBe(DEFAULT_COMPLEXITY_CLASS);
		expect(telemetry.reason).toBe(DEFAULT_COMPLEXITY_REASON);
		expect(telemetry.otelDimensionKey).toBe(DEFAULT_COMPLEXITY_OTEL_KEY);
		expect(telemetry.signalMap).toEqual({ estimator_state: "missing" });
	});
});

describe("complexityTelemetryEventData", () => {
	it("emits required stage.finish complexity fields and OTEL dimension key/value", () => {
		const telemetry = resolveComplexityTelemetry({
			context: {
				complexity_class: "low",
				complexity_signals: JSON.stringify({ diff_size: "small" }),
				complexity_reason: "class=low;score=0;top=diff_size:small",
				complexity_otel_key: "hatch.complexity.class",
			},
		});

		const data = complexityTelemetryEventData(telemetry);
		expect(data.complexity_class).toBe("low");
		expect(data.complexity_signals).toBe("{\"diff_size\":\"small\"}");
		expect(data.complexity_reason).toBe("class=low;score=0;top=diff_size:small");
		expect(data.complexity_otel_key).toBe("hatch.complexity.class");
		expect(data["hatch.complexity.class"]).toBe("low");
	});

	it("extractComplexityDimensions keeps low-cardinality dimensions only", () => {
		const dimensions = extractComplexityDimensions({
			complexity_class: "high",
			complexity_otel_key: "hatch.complexity.class",
			"hatch.execution.path": "full",
			path_taken: "full",
			"hatch.merge.resolver": "auto",
			complexity_signals: "{\"diff_size\":\"large\"}",
		});

		expect(dimensions).toEqual({
			"hatch.complexity.class": "high",
			"hatch.execution.path": "full",
			path_taken: "full",
			"hatch.merge.resolver": "auto",
		});
	});
});
