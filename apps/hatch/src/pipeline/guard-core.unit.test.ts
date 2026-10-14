import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
	configureFactoryGuardScope,
	loadFactoryGuardState,
	saveFactoryGuardState,
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
	it.each(["-1", "NaN", "Infinity", "not-a-number"])("rejects invalid numeric context and environment limits: %s", (invalid) => {
		process.env["HATCH_GUARD_RUN_MAX_TOOL_CALLS"] = invalid;
		const policy = resolvePolicy(makeRunState(), { guard_run_max_tool_calls: invalid });
		expect(policy.runLimits.tool_calls).toBe(1000);
	});

	it("uses a valid environment limit when context is invalid, but accepts an explicit zero", () => {
		process.env["HATCH_GUARD_RUN_MAX_TOOL_CALLS"] = "17";
		expect(resolvePolicy(makeRunState(), { guard_run_max_tool_calls: "-1" }).runLimits.tool_calls).toBe(17);
		expect(resolvePolicy(makeRunState(), { guard_run_max_tool_calls: "0" }).runLimits.tool_calls).toBe(0);
	});

	it("uses environment revision before persisted revision and defaults an empty persisted revision", () => {
		const run = makeRunState({ guard: makeRunGuardState({ policyRevision: "persisted" }) });
		process.env["HATCH_GUARD_POLICY_REVISION"] = "environment";
		expect(resolvePolicy(run, {}).revision).toBe("environment");
		delete process.env["HATCH_GUARD_POLICY_REVISION"];
		expect(resolvePolicy(run, {}).revision).toBe("persisted");
		run.guard.policyRevision = "";
		expect(resolvePolicy(run, {}).revision).toBe(DEFAULT_POLICY_REVISION);
	});

	it.each(["factory_id", "factory", "instance_id"])("derives factory scope from %s and ignores default placeholders", (key) => {
		const run = makeRunState({ context: { [key]: "persisted-factory" } });
		expect(resolvePolicy(run, { [key]: " request-factory " }).factoryScope).toBe("request-factory");
		expect(resolvePolicy(run, { [key]: " DEFAULT " }).factoryScope).toBe("persisted-factory");
	});

	it("falls back through environment identity, persisted scope, and pipeline factory path", () => {
		const run = makeRunState();
		process.env["HATCH_INSTANCE_ID"] = "instance";
		expect(resolvePolicy(run, {}).factoryScope).toBe("instance");
		process.env["HATCH_FACTORY_ID"] = "factory";
		expect(resolvePolicy(run, {}).factoryScope).toBe("factory");
		delete process.env["HATCH_INSTANCE_ID"];
		delete process.env["HATCH_FACTORY_ID"];
		run.guard.factoryScope = "persisted";
		expect(resolvePolicy(run, {}).factoryScope).toBe("persisted");
		run.guard.factoryScope = "default";
		run.pipelineFile = "/missing/factories/path-factory/workflow/main.ts";
		expect(resolvePolicy(run, {}).factoryScope).toBe("path-factory");
	});

	it("resolves worker period through request, persisted context, and persisted guard", () => {
		const run = makeRunState({ context: { worker_period: "stored-period" }, guard: makeRunGuardState({ workerPeriod: "guard-period" }) });
		expect(resolvePolicy(run, { worker_period: "request-period" }).workerPeriod).toBe("request-period");
		expect(resolvePolicy(run, {}).workerPeriod).toBe("stored-period");
		run.context = { guard_worker_period: "stored-guard-period" };
		expect(resolvePolicy(run, {}).workerPeriod).toBe("stored-guard-period");
		run.context = {};
		expect(resolvePolicy(run, {}).workerPeriod).toBe("guard-period");
	});

	it("applies environment scope and worker-period overrides and floors fractional terminal counts", () => {
		process.env["HATCH_GUARD_FACTORY_SCOPE"] = "env-scope";
		process.env["HATCH_GUARD_WORKER_PERIOD"] = "env-period";
		const policy = resolvePolicy(makeRunState(), { guard_terminal_overflow_count: "2.9" });
		expect(policy.factoryScope).toBe("env-scope");
		expect(policy.workerPeriod).toBe("env-period");
		expect(policy.terminalOverflowCount).toBe(2);
	});

});


describe("persisted factory guard boundaries", () => {
	let dir: string;
	const now = new Date("2025-01-01T12:00:00Z");
	let policy: GuardPolicy;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "guard-core-state-"));
		configureFactoryGuardScope({ guardDir: dir });
		policy = resolvePolicy(makeRunState(), { guard_factory_scope: "isolated", guard_worker_period: "test" });
	});
	afterEach(() => {
		configureFactoryGuardScope();
		rmSync(dir, { recursive: true, force: true });
	});
	const freshState = { circuitState: "closed", counters: createCounters(), policyRevision: "guard.v1" };
	it("initializes missing state with the caller owner and deterministic timestamp", () => {
		const state = loadFactoryGuardState(policy, "owner", now);
		expect(state).toMatchObject({ ...freshState, owner: { ownerId: "owner", leaseGeneration: 0 }, updatedAt: now.toISOString() });
	});
	it.each(["{broken", "null", "false", "42"])("recovers unsupported persisted state %s with clean counters", (contents) => {
		writeFileSync(join(dir, "isolated.test.json"), contents);
		expect(loadFactoryGuardState(policy, "owner", now)).toMatchObject(freshState);
	});
	it.each([
		["open", "open"], ["circuit_open", "open"], ["terminal", "terminal"],
		["tripped", "terminal"], ["circuit_terminal", "terminal"], ["unknown", "closed"], ["", "closed"],
	])("normalizes persisted circuit alias %s to %s", (input, expected) => {
		writeFileSync(join(dir, "isolated.test.json"), JSON.stringify({ circuitState: input }));
		expect(loadFactoryGuardState(policy, "owner", now).circuitState).toBe(expected);
	});
	it("normalizes legacy counter names and invalid numbers without sharing counters", () => {
		writeFileSync(join(dir, "isolated.test.json"), JSON.stringify({ counters: { toolCalls: "4", llmCalls: "bad", reviewRetryCalls: "2", pipelineTransitionCalls: 3 } }));
		const state = loadFactoryGuardState(policy, "owner", now);
		expect(state.counters).toEqual({ tool_calls: 4, llm_calls: 0, review_retry_calls: 2, pipeline_transition_calls: 3 });
		state.counters.tool_calls = 99;
		expect(loadFactoryGuardState(policy, "owner", now).counters.tool_calls).toBe(4);
	});
	it("preserves canonical persisted fields and owner while rejecting non-string reason codes", () => {
		const stored = { factoryScope: "stored", workerPeriod: "period", policyRevision: "revision", counters: { tool_calls: 1, llm_calls: 2, review_retry_calls: 3, pipeline_transition_calls: 4 }, reasonCode: 123, overflowCount: "2", resetCount: "3", openedAt: "opened", expiresAt: "expires", terminalAt: "terminal", lastDecisionAt: "decision", lastDecisionType: "deny", owner: { ownerId: "stored-owner", leaseName: "lease", leaseGeneration: "9" }, updatedAt: "updated" };
		writeFileSync(join(dir, "isolated.test.json"), JSON.stringify(stored));
		expect(loadFactoryGuardState(policy, "caller", now)).toMatchObject({ ...stored, reasonCode: "", overflowCount: 2, resetCount: 3, owner: { ownerId: "stored-owner", leaseName: "lease", leaseGeneration: 9 } });
	});
	it("round trips an atomic state save including a terminal budget reason", () => {
		const state = loadFactoryGuardState(policy, "owner", now);
		state.circuitState = "terminal";
		state.reasonCode = "factory_tool_budget_exceeded";
		saveFactoryGuardState(policy, state);
		expect(JSON.parse(readFileSync(join(dir, "isolated.test.json"), "utf8"))).toEqual(state);
		expect(loadFactoryGuardState(policy, "different-owner", now)).toEqual(state);
	});
});
