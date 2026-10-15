import { describe, it, expect, vi, beforeEach } from "vitest";

import { toGuardEventData } from "@recallnet/factory-telemetry";

vi.mock("@recallnet/factory-telemetry", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@recallnet/factory-telemetry")>();
	return {
		...actual,
		toGuardEventData: vi.fn(actual.toGuardEventData),
	};
});

import { buildGuardEventTelemetry } from "./guard-eventbus.js";

const mockedToGuardEventData = vi.mocked(toGuardEventData);

function makeRunState(overrides: Record<string, unknown> = {}) {
	return {
		runId: "run-123",
		guard: { circuitState: "closed", counters: {}, owner: {} },
		context: {},
		...overrides,
	} as any;
}

function makeDecision(overrides: Record<string, unknown> = {}) {
	return {
		allowed: true,
		counter: "tool_calls",
		reasonCode: "",
		circuitState: "closed",
		transition: "none",
		policyRevision: "guard.v1",
		scope: "run",
		runCounters: { tool_calls: 5 },
		factoryCounters: { tool_calls: 10 },
		...overrides,
	} as any;
}

function makeArgs(overrides: Record<string, unknown> = {}) {
	return {
		runState: makeRunState(),
		decision: makeDecision(),
		nodeId: "node-1",
		kind: "guard.decision" as const,
		artifactPath: "/tmp/artifact.json",
		policyRevision: "guard.v1",
		factoryScope: "mothership",
		workerPeriod: "2026-03-22",
		...overrides,
	};
}

describe("buildGuardEventTelemetry", () => {
	beforeEach(() => {
		mockedToGuardEventData.mockRestore();
	});

	describe("normal path (toGuardEventData succeeds)", () => {
		it("returns traceId starting with 'builder-guard-' for builder partition", () => {
			const result = buildGuardEventTelemetry(makeArgs());
			expect(result.traceId).toMatch(/^builder-guard-/);
		});

		it("returns traceId starting with 'judge-guard-' when trust_partition is judge", () => {
			const result = buildGuardEventTelemetry(
				makeArgs({ eventContext: { trust_partition: "judge" } }),
			);
			expect(result.traceId).toMatch(/^judge-guard-/);
		});

		it("data includes factory_scope, worker_period, guard_circuit_state", () => {
			const result = buildGuardEventTelemetry(makeArgs());
			expect(result.data.factory_scope).toBe("mothership");
			expect(result.data.worker_period).toBe("2026-03-22");
			expect(result.data.guard_circuit_state).toBe("closed");
		});

		it("includes factory_id in extras when present in eventContext", () => {
			const result = buildGuardEventTelemetry(
				makeArgs({ eventContext: { factory_id: "factory-abc" } }),
			);
			expect(result.data.factory_id).toBe("factory-abc");
		});

		it("does not include factory_id when absent everywhere", () => {
			const result = buildGuardEventTelemetry(makeArgs());
			expect(result.data.factory_id).toBeUndefined();
		});
	});

	describe("fallback path (toGuardEventData throws)", () => {
		beforeEach(() => {
			mockedToGuardEventData.mockImplementation(() => {
				throw new Error("boom");
			});
		});

		it("returns fallback data with allowed 'true' when decision.allowed is true", () => {
			const result = buildGuardEventTelemetry(makeArgs());
			expect(result.data.allowed).toBe("true");
			expect(result.data.factory_scope).toBe("mothership");
			expect(result.data.worker_period).toBe("2026-03-22");
			expect(result.data.guard_circuit_state).toBe("closed");
			expect(result.data.artifact_path).toBe("/tmp/artifact.json");
		});

		it("returns allowed 'false' when decision.allowed is false", () => {
			const result = buildGuardEventTelemetry(
				makeArgs({ decision: makeDecision({ allowed: false }) }),
			);
			expect(result.data.allowed).toBe("false");
		});

		it("includes reason_code and scope as strings", () => {
			const result = buildGuardEventTelemetry(
				makeArgs({
					decision: makeDecision({ reasonCode: "limit_exceeded", scope: "factory" }),
				}),
			);
			expect(result.data.reason_code).toBe("limit_exceeded");
			expect(result.data.scope).toBe("factory");
		});
	});

	describe("partition normalization", () => {
		it("trust_partition 'judge' → traceId starts with 'judge-guard-'", () => {
			const result = buildGuardEventTelemetry(
				makeArgs({ eventContext: { trust_partition: "judge" } }),
			);
			expect(result.traceId).toMatch(/^judge-guard-/);
		});

		it("trust_partition 'builder' → traceId starts with 'builder-guard-'", () => {
			const result = buildGuardEventTelemetry(
				makeArgs({ eventContext: { trust_partition: "builder" } }),
			);
			expect(result.traceId).toMatch(/^builder-guard-/);
		});

		it("trust_partition undefined → defaults to 'builder-guard-'", () => {
			const result = buildGuardEventTelemetry(makeArgs());
			expect(result.traceId).toMatch(/^builder-guard-/);
		});

		it("trust_partition ' JUDGE ' → normalized to 'judge-guard-'", () => {
			const result = buildGuardEventTelemetry(
				makeArgs({ eventContext: { trust_partition: " JUDGE " } }),
			);
			expect(result.traceId).toMatch(/^judge-guard-/);
		});
	});

	describe("guard circuit state fallback", () => {
		it("uses decision.circuitState when present", () => {
			const result = buildGuardEventTelemetry(
				makeArgs({ decision: makeDecision({ circuitState: "open" }) }),
			);
			expect(result.data.guard_circuit_state).toBe("open");
		});

		it("falls back to runState.guard.circuitState", () => {
			const result = buildGuardEventTelemetry(
				makeArgs({
					decision: makeDecision({ circuitState: "" }),
					runState: makeRunState({ guard: { circuitState: "half-open", counters: {}, owner: {} } }),
				}),
			);
			expect(result.data.guard_circuit_state).toBe("half-open");
		});

		it("falls back to 'closed' when both missing", () => {
			const result = buildGuardEventTelemetry(
				makeArgs({
					decision: makeDecision({ circuitState: "" }),
					runState: makeRunState({ guard: { circuitState: "", counters: {}, owner: {} } }),
				}),
			);
			expect(result.data.guard_circuit_state).toBe("closed");
		});
	});

	describe("factory ID resolution", () => {
		it("resolves from eventContext.factory_id", () => {
			const result = buildGuardEventTelemetry(
				makeArgs({ eventContext: { factory_id: "from-snake" } }),
			);
			expect(result.data.factory_id).toBe("from-snake");
		});

		it("resolves from eventContext.factoryId (camelCase)", () => {
			const result = buildGuardEventTelemetry(
				makeArgs({ eventContext: { factoryId: "from-camel" } }),
			);
			expect(result.data.factory_id).toBe("from-camel");
		});

		it("resolves from runState.context.factory_id", () => {
			const result = buildGuardEventTelemetry(
				makeArgs({
					runState: makeRunState({ context: { factory_id: "from-runstate" } }),
				}),
			);
			expect(result.data.factory_id).toBe("from-runstate");
		});

		it("not included when all empty", () => {
			const result = buildGuardEventTelemetry(makeArgs());
			expect(result.data.factory_id).toBeUndefined();
		});
	});
	it.each([false, true])("retains fallback policy and scope when telemetry conversion fails=%s", (conversionFails) => {
		if (conversionFails) mockedToGuardEventData.mockImplementationOnce(() => { throw new Error("conversion unavailable"); });
		const result = buildGuardEventTelemetry(makeArgs({
			nodeId: "",
			decision: makeDecision({ counter: "", scope: "", policyRevision: "" }),
		}));
		expect(result.data.scope).toBe("none");
		expect(result.data.policy_revision).toBe("guard.v1");
		expect(result.traceId).toMatch(/^builder-guard-[a-f0-9]{20}$/);
		expect(result.data.guard_trace_id).toBe(result.traceId);
	});

});
