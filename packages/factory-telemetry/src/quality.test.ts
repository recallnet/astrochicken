import { describe, expect, it } from "vitest";

import { buildQualitySignalEventData, deriveQualitySignal, deriveRetryTelemetry } from "./quality.js";

import type { Event } from "./events.js";

describe("quality signal derivation", () => {
	it("produces deterministic score from outcome/guard/retry inputs", () => {
		const signal = deriveQualitySignal({
			nodeId: "build",
			traceId: "builder-000001",
			trustPartition: "builder",
			trustDomain: "builder",
			trustRole: "mothership.local.tool",
			attempt: 3,
			outcome: "fail",
			failureClass: "runtime",
			guardState: "guarded",
			handlerType: "tool",
			model: "gpt-4.1",
		});

		expect(signal.quality_schema_version).toBe("hatch.quality_signal.v1");
		expect(signal.quality_score).toBe("0.00");
		expect(signal.quality_grade).toBe("low");
		expect(signal.langfuse_quality_score).toBe("0.00");
		expect(signal.langfuse_quality_grade).toBe("low");
		expect(signal.quality_outcome).toBe("fail");
		expect(signal.quality_failure_class).toBe("runtime");
		expect(signal.langfuse_failure_class).toBe("runtime");
		expect(signal.quality_guard_state).toBe("guarded");
		expect(signal.quality_skill).toBe("tool");
		expect(signal.langfuse_skill).toBe("tool");
		expect(signal.quality_model).toBe("gpt-4.1");
		expect(signal.quality_attempt).toBe("3");
		expect(signal.quality_reason).toContain("outcome=fail");
		expect(signal.quality_reason).toContain("retries=2");
	});

	it("derives deterministic retry telemetry classes", () => {
		expect(deriveRetryTelemetry({ attempt: 1, outcome: "pass" })).toEqual({
			"hatch.retry_class": "first_pass",
			"hatch.first_attempt_pass": "true",
		});
		expect(deriveRetryTelemetry({ attempt: 2, outcome: "pass" })).toEqual({
			"hatch.retry_class": "retry_pass",
			"hatch.first_attempt_pass": "false",
		});
		expect(deriveRetryTelemetry({ attempt: 1, outcome: "fail" })).toEqual({
			"hatch.retry_class": "first_fail",
			"hatch.first_attempt_pass": "false",
		});
	});

	it("builds quality event data from stage.finish and stage.error events", () => {
		const finishEvent: Event = {
			kind: "stage.finish",
			timestamp: new Date("2026-03-06T14:00:00.000Z"),
			nodeId: "judge",
			traceId: "judge-000100",
			data: {
				attempt: "1",
				trust_partition: "judge",
				trust_domain: "judge",
				trust_role: "mothership.local.judge",
				trust_partition_key: "judge/mothership.local.judge",
				handler_type: "codergen",
				model: "gpt-5-mini",
			},
		};
		const finishQuality = buildQualitySignalEventData(finishEvent);
		expect(finishQuality).not.toBeNull();
		expect(finishQuality?.quality_outcome).toBe("pass");
		expect(finishQuality?.quality_grade).toBe("high");
		expect(finishQuality?.quality_attempt).toBe("1");
		expect(finishQuality?.quality_skill).toBe("codergen");
		expect(finishQuality?.quality_model).toBe("gpt-5-mini");
		expect(finishQuality?.langfuse_quality_score).toBe("1.00");
		expect(finishQuality?.langfuse_skill).toBe("codergen");
		expect(finishQuality?.["hatch.retry_class"]).toBe("first_pass");
		expect(finishQuality?.["hatch.first_attempt_pass"]).toBe("true");

		const retriedFinishEvent: Event = {
			kind: "stage.finish",
			timestamp: new Date("2026-03-06T14:00:00.500Z"),
			nodeId: "builder_retry",
			traceId: "builder-000100",
			data: {
				attempt: "2",
				trust_partition: "builder",
				trust_domain: "builder",
				trust_role: "mothership.local.tool",
				trust_partition_key: "builder/mothership.local.tool",
				handler_type: "tool",
				model: "gpt-4.1-mini",
				guard_circuit_state: "closed",
			},
		};
		const retriedFinishQuality = buildQualitySignalEventData(retriedFinishEvent);
		expect(retriedFinishQuality).not.toBeNull();
		expect(retriedFinishQuality?.quality_outcome).toBe("pass");
		expect(retriedFinishQuality?.quality_attempt).toBe("2");
		expect(retriedFinishQuality?.quality_score).toBe("0.90");
		expect(retriedFinishQuality?.langfuse_quality_score).toBe("0.90");
		expect(retriedFinishQuality?.quality_reason).toContain("retries=1:-0.10");
		expect(retriedFinishQuality?.["hatch.retry_class"]).toBe("retry_pass");
		expect(retriedFinishQuality?.["hatch.first_attempt_pass"]).toBe("false");

		const errorEvent: Event = {
			kind: "stage.error",
			timestamp: new Date("2026-03-06T14:00:01.000Z"),
			nodeId: "build",
			traceId: "builder-000101",
			error: new Error("timed out after 10s"),
			data: {
				attempt: "2",
				trust_partition: "builder",
				trust_domain: "builder",
				trust_role: "mothership.local.tool",
				trust_partition_key: "builder/mothership.local.tool",
				handler_type: "tool",
				model: "none",
				guard_circuit_state: "terminal",
			},
		};
		const errorQuality = buildQualitySignalEventData(errorEvent);
		expect(errorQuality).not.toBeNull();
		expect(errorQuality?.quality_outcome).toBe("fail");
		expect(errorQuality?.quality_failure_class).toBe("timeout");
		expect(errorQuality?.langfuse_failure_class).toBe("timeout");
		expect(errorQuality?.quality_attempt).toBe("2");
		expect(errorQuality?.quality_guard_state).toBe("guarded_terminal");
		expect(errorQuality?.quality_skill).toBe("tool");
		expect(errorQuality?.["hatch.retry_class"]).toBe("retry_fail");
		expect(errorQuality?.["hatch.first_attempt_pass"]).toBe("false");
	});
});
