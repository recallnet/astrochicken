import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
	OTEL_TAXONOMY_CONTRACT,
	stringifyGovernedOtelAttributes,
	validateGovernedOtelAttributes,
	validateGovernedOtelCorrelation,
	validateGovernedOtelEventName,
} from "./otel-contract.js";
import { emitGovernedOtelEvent } from "./otel-stdout.js";

describe("otel taxonomy contract", () => {
	it("defines the required correlation attributes", () => {
		expect(OTEL_TAXONOMY_CONTRACT.required_correlation_attributes).toEqual([
			"factory_id",
			"run_id",
			"workflow_id",
			"capability_id",
			"owner",
		]);
	});

	it("matches the checked-in JSON contract", () => {
		expect(OTEL_TAXONOMY_CONTRACT).toEqual(
			JSON.parse(readFileSync(new URL("./otel-contract.json", import.meta.url), "utf8")),
		);
	});

	it("rejects missing governed correlation keys", () => {
		expect(validateGovernedOtelCorrelation({ factory_id: "mothership" })).toContain("missing_correlation:run_id");
	});

	it("rejects invalid event names and unknown attribute keys", () => {
		expect(validateGovernedOtelEventName("Factory.Bad")).toContain("invalid_event_name:Factory.Bad");
		expect(validateGovernedOtelAttributes({ unsupported_key: "x" })).toContain("unknown_attribute_key:unsupported_key");
	});

	it("merges correlation attributes into governed telemetry attributes", () => {
		expect(stringifyGovernedOtelAttributes(
			{
				factory_id: "mothership",
				run_id: "run-1",
				workflow_id: "wave_execute",
				capability_id: "wave_execution",
				owner: "factory_ops.wave_judge_fallback",
			},
			{ pipeline: "wave_execute" },
		)).toEqual({
			factory_id: "mothership",
			run_id: "run-1",
			workflow_id: "wave_execute",
			capability_id: "wave_execution",
			owner: "factory_ops.wave_judge_fallback",
			pipeline: "wave_execute",
		});
	});

	it("emits governed events when the contract is satisfied", () => {
		const prevMode = process.env.OTEL_MODE;
		process.env.OTEL_MODE = "stdout";
		let stderr = "";
		const write = process.stderr.write;
		process.stderr.write = ((chunk: unknown) => {
			stderr += String(chunk);
			return true;
		}) as typeof process.stderr.write;
		try {
			emitGovernedOtelEvent({
				event_name: "factory.supervisor.telemetry",
				correlation: {
					factory_id: "mothership",
					run_id: "run-1",
					workflow_id: "factory_supervisor",
					capability_id: "supervisor",
					owner: "factory_ops.supervisor_artifact",
				},
				attributes: {
					artifact_type: "telemetry",
					pipeline: "factory_supervisor",
				},
				body: { ok: true },
			});
		} finally {
			process.stderr.write = write;
			if (prevMode == null) delete process.env.OTEL_MODE;
			else process.env.OTEL_MODE = prevMode;
		}
		expect(stderr).toContain("factory.supervisor.telemetry");
		expect(stderr).toContain("\"workflow_id\":\"factory_supervisor\"");
	});

	it("throws when a governed event violates the contract", () => {
		expect(() => emitGovernedOtelEvent({
			event_name: "factory.supervisor.telemetry",
			correlation: {
				factory_id: "mothership",
				run_id: "",
				workflow_id: "factory_supervisor",
				capability_id: "supervisor",
				owner: "factory_ops.supervisor_artifact",
			},
			attributes: {},
			body: {},
		})).toThrow(/invalid_governed_otel_event/);
	});
});
