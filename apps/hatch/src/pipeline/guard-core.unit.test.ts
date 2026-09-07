import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
	COUNTER_KEYS,
	createCounters,
	normalizeCounterKey,
	computeBackoffMs,
	mapReason,
	isOpenAndActive,
	finalizeOpenToClosed,
	nowIso,
	factoryKey,
	resolvePolicy,
	DEFAULT_POLICY_REVISION,
	type GuardPolicy,
} from "./guard-core.js";

import type { RunState, RunGuardState, GuardCircuitState } from "./run.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRunGuardState(overrides: Partial<RunGuardState> = {}): RunGuardState {
	return {
		policyRevision: "guard.v1",
		factoryScope: "default",
		workerPeriod: "default",
		counters: createCounters(),
		factoryCounters: createCounters(),
		circuitState: "closed",
		reasonCode: "",
		metadata: null,
		overflowCount: 0,
		openedAt: "",
		expiresAt: "",
		terminalAt: "",
		lastDecisionAt: "",
		lastDecisionType: "",
		resetCount: 0,
		owner: { ownerId: "run:test", leaseName: "", leaseGeneration: 0 },
		...overrides,
	};
}

function makeRunState(overrides: Partial<RunState> = {}): RunState {
	return {
		schemaVersion: 1,
		runId: "test-run",
		pipelineFile: "test.dot",
		pipeline: "test.dot",
		pid: 1,
		status: "running",
		startedAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		currentNode: "",
		lastOutput: "",
		context: {},
		completedNodes: [],
		activeChildren: {},
		locksHeld: [],
		records: [],
		guard: makeRunGuardState(),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("COUNTER_KEYS", () => {
	it("contains exactly the four expected keys", () => {
		expect(COUNTER_KEYS).toEqual([
			"tool_calls",
			"llm_calls",
			"review_retry_calls",
			"pipeline_transition_calls",
		]);
	});
});

describe("createCounters", () => {
	it("returns an object with all counters at zero", () => {
		const c = createCounters();
		expect(c).toEqual({
			tool_calls: 0,
			llm_calls: 0,
			review_retry_calls: 0,
			pipeline_transition_calls: 0,
		});
	});

	it("returns a fresh object each call", () => {
		const a = createCounters();
		const b = createCounters();
		expect(a).not.toBe(b);
	});
});

describe("normalizeCounterKey", () => {
	it.each(["tool_calls", "llm_calls", "review_retry_calls", "pipeline_transition_calls"] as const)(
		"returns '%s' for valid key '%s'",
		(key) => {
			expect(normalizeCounterKey(key)).toBe(key);
		},
	);

	it("returns null for invalid strings", () => {
		expect(normalizeCounterKey("not_a_key")).toBeNull();
		expect(normalizeCounterKey("")).toBeNull();
		expect(normalizeCounterKey("TOOL_CALLS")).toBeNull();
	});
});

describe("computeBackoffMs", () => {
	const policy: GuardPolicy = {
		revision: "test",
		factoryScope: "test",
		workerPeriod: "default",
		lockTimeoutMs: 1000,
		backoffBaseMs: 1000,
		backoffCapMs: 16000,
		terminalOverflowCount: 3,
		runLimits: createCounters(),
		factoryLimits: createCounters(),
	};

	it("returns 0 when overflowCount <= 0", () => {
		expect(computeBackoffMs(policy, 0)).toBe(0);
		expect(computeBackoffMs(policy, -1)).toBe(0);
	});

	it("returns backoffBaseMs when overflowCount = 1 (2^0 = 1)", () => {
		expect(computeBackoffMs(policy, 1)).toBe(1000);
	});

	it("returns backoffBaseMs * 2 when overflowCount = 2", () => {
		expect(computeBackoffMs(policy, 2)).toBe(2000);
	});

	it("returns backoffBaseMs * 4 when overflowCount = 3", () => {
		expect(computeBackoffMs(policy, 3)).toBe(4000);
	});

	it("caps at backoffCapMs", () => {
		expect(computeBackoffMs(policy, 100)).toBe(16000);
	});
});

describe("mapReason", () => {
	it.each([
		["run", "tool_calls", "run_tool_budget_exceeded"],
		["run", "llm_calls", "run_llm_budget_exceeded"],
		["run", "review_retry_calls", "run_review_retry_budget_exceeded"],
		["run", "pipeline_transition_calls", "run_pipeline_transition_budget_exceeded"],
		["factory", "tool_calls", "factory_tool_budget_exceeded"],
		["factory", "llm_calls", "factory_llm_budget_exceeded"],
		["factory", "review_retry_calls", "factory_review_retry_budget_exceeded"],
		["factory", "pipeline_transition_calls", "factory_pipeline_transition_budget_exceeded"],
	] as const)("scope '%s' + counter '%s' → '%s'", (scope, counter, expected) => {
		expect(mapReason(scope, counter)).toBe(expected);
	});
});

describe("isOpenAndActive", () => {
	const now = new Date("2025-01-01T12:00:00Z");

	it("returns false when circuitState is not 'open'", () => {
		expect(isOpenAndActive({ circuitState: "closed", expiresAt: "" }, now)).toBe(false);
		expect(isOpenAndActive({ circuitState: "terminal", expiresAt: "" }, now)).toBe(false);
	});

	it("returns true when open and expiresAt is in the future", () => {
		expect(
			isOpenAndActive({ circuitState: "open", expiresAt: "2025-01-01T13:00:00Z" }, now),
		).toBe(true);
	});

	it("returns false when open and expiresAt is in the past", () => {
		expect(
			isOpenAndActive({ circuitState: "open", expiresAt: "2025-01-01T11:00:00Z" }, now),
		).toBe(false);
	});

	it("returns true when open and expiresAt is invalid/empty (no expiry = stays open)", () => {
		expect(isOpenAndActive({ circuitState: "open", expiresAt: "" }, now)).toBe(true);
		expect(isOpenAndActive({ circuitState: "open", expiresAt: "not-a-date" }, now)).toBe(true);
	});
});

describe("finalizeOpenToClosed", () => {
	const now = new Date("2025-01-01T12:00:00Z");

	it("returns false and does nothing if circuit is not open", () => {
		const state = makeRunGuardState({ circuitState: "closed" });
		expect(finalizeOpenToClosed(state, now)).toBe(false);
		expect(state.circuitState).toBe("closed");
	});

	it("returns false if open but not expired", () => {
		const state = makeRunGuardState({
			circuitState: "open",
			expiresAt: "2025-01-01T13:00:00Z",
		});
		expect(finalizeOpenToClosed(state, now)).toBe(false);
		expect(state.circuitState).toBe("open");
	});

	it("returns false if open with no expiry (empty string)", () => {
		const state = makeRunGuardState({
			circuitState: "open",
			expiresAt: "",
		});
		expect(finalizeOpenToClosed(state, now)).toBe(false);
		expect(state.circuitState).toBe("open");
	});

	it("returns true and mutates state to closed when open and expired", () => {
		const state = makeRunGuardState({
			circuitState: "open",
			expiresAt: "2025-01-01T11:00:00Z",
			openedAt: "2025-01-01T10:00:00Z",
			reasonCode: "run_tool_budget_exceeded",
		});
		expect(finalizeOpenToClosed(state, now)).toBe(true);
		expect(state.circuitState).toBe("closed");
		expect(state.reasonCode).toBe("");
		expect(state.openedAt).toBe("");
		expect(state.expiresAt).toBe("");
		expect(state.lastDecisionType).toBe("expiry_release");
		expect(state.lastDecisionAt).toBe(now.toISOString());
	});
});

describe("nowIso", () => {
	it("returns an ISO string for a given date", () => {
		const d = new Date("2025-06-15T10:30:00Z");
		expect(nowIso(d)).toBe("2025-06-15T10:30:00.000Z");
	});
});

describe("factoryKey", () => {
	it("combines sanitized scope and workerPeriod with a dot", () => {
		expect(factoryKey("my-scope", "daily")).toBe("my-scope.daily");
	});

	it("sanitizes special characters", () => {
		expect(factoryKey("scope/with spaces!", "period@2")).toBe("scope_with_spaces_.period_2");
	});

	it("defaults empty parts to 'default'", () => {
		expect(factoryKey("", "")).toBe("default.default");
	});
});

describe("resolvePolicy", () => {
	const savedEnv: Record<string, string | undefined> = {};
	const envKeys = [
		"HATCH_GUARD_POLICY_REVISION",
		"HATCH_GUARD_FACTORY_SCOPE",
		"HATCH_GUARD_WORKER_PERIOD",
		"HATCH_GUARD_LOCK_TIMEOUT_MS",
		"HATCH_GUARD_BACKOFF_BASE_MS",
		"HATCH_GUARD_BACKOFF_CAP_MS",
		"HATCH_GUARD_TERMINAL_OVERFLOW_COUNT",
		"HATCH_GUARD_RUN_MAX_TOOL_CALLS",
		"HATCH_GUARD_RUN_MAX_LLM_CALLS",
		"HATCH_GUARD_RUN_MAX_REVIEW_RETRY_CALLS",
		"HATCH_GUARD_RUN_MAX_PIPELINE_TRANSITION_CALLS",
		"HATCH_GUARD_FACTORY_MAX_TOOL_CALLS",
		"HATCH_GUARD_FACTORY_MAX_LLM_CALLS",
		"HATCH_GUARD_FACTORY_MAX_REVIEW_RETRY_CALLS",
		"HATCH_GUARD_FACTORY_MAX_PIPELINE_TRANSITION_CALLS",
		"HATCH_FACTORY_ID",
		"HATCH_INSTANCE_ID",
	];

	beforeEach(() => {
		for (const key of envKeys) {
			savedEnv[key] = process.env[key];
			delete process.env[key];
		}
	});

	afterEach(() => {
		for (const key of envKeys) {
			if (savedEnv[key] === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = savedEnv[key];
			}
		}
	});

	it("returns default limits when no overrides provided", () => {
		const rs = makeRunState();
		const policy = resolvePolicy(rs, undefined);

		expect(policy.revision).toBe(DEFAULT_POLICY_REVISION);
		expect(policy.runLimits).toEqual({
			tool_calls: 1000,
			llm_calls: 400,
			review_retry_calls: 200,
			pipeline_transition_calls: 300,
		});
		expect(policy.factoryLimits).toEqual({
			tool_calls: 100_000,
			llm_calls: 40_000,
			review_retry_calls: 20_000,
			pipeline_transition_calls: 30_000,
		});
	});

	it("reads guard_run_max_tool_calls etc. from context", () => {
		const rs = makeRunState();
		const context: Record<string, string> = {
			guard_run_max_tool_calls: "42",
			guard_run_max_llm_calls: "10",
		};
		const policy = resolvePolicy(rs, context);
		expect(policy.runLimits.tool_calls).toBe(42);
		expect(policy.runLimits.llm_calls).toBe(10);
		// Others keep defaults
		expect(policy.runLimits.review_retry_calls).toBe(200);
	});

	it("falls back to env vars when context does not have values", () => {
		process.env["HATCH_GUARD_RUN_MAX_TOOL_CALLS"] = "99";
		const rs = makeRunState();
		const policy = resolvePolicy(rs, {});
		expect(policy.runLimits.tool_calls).toBe(99);
	});

	it("falls back to defaults for missing values", () => {
		const rs = makeRunState();
		const policy = resolvePolicy(rs, {});
		expect(policy.backoffBaseMs).toBe(30_000);
		expect(policy.backoffCapMs).toBe(30 * 60_000);
		expect(policy.lockTimeoutMs).toBe(1000);
	});

	it("terminalOverflowCount is at least 1", () => {
		const rs = makeRunState();
		const context: Record<string, string> = {
			guard_terminal_overflow_count: "0",
		};
		const policy = resolvePolicy(rs, context);
		expect(policy.terminalOverflowCount).toBe(1);
	});

	it("reads policy revision from context", () => {
		const rs = makeRunState();
		const context: Record<string, string> = {
			guard_policy_revision: "custom.v2",
		};
		const policy = resolvePolicy(rs, context);
		expect(policy.revision).toBe("custom.v2");
	});

	it("reads factory scope from context", () => {
		const rs = makeRunState();
		const context: Record<string, string> = {
			guard_factory_scope: "my-factory",
		};
		const policy = resolvePolicy(rs, context);
		expect(policy.factoryScope).toBe("my-factory");
	});

	it("reads factory limits from context", () => {
		const rs = makeRunState();
		const context: Record<string, string> = {
			guard_factory_max_tool_calls: "500",
			guard_factory_max_llm_calls: "250",
		};
		const policy = resolvePolicy(rs, context);
		expect(policy.factoryLimits.tool_calls).toBe(500);
		expect(policy.factoryLimits.llm_calls).toBe(250);
	});
});
