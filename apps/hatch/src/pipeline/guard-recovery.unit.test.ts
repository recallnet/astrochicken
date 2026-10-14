import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import { configureFactoryGuardScope, factoryKey, loadFactoryGuardState, resolvePolicy, saveFactoryGuardState } from "./guard-core.js";
import { acquireLock } from "./lock.js";
import { configureRunStorageScope, createRunState, runsDir } from "./run.js";

import {
	recordGuardMetadata,
	buildBlockedDecision,
	statusForGuardDecision,
	resetGuardBudgets,
	incrementGuardCounter,
} from "./guard-recovery.js";

import type {
	GuardCounters,
	GuardCircuitState,
	GuardDecisionMetadata,
	RunGuardState,
} from "./run.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCounters(overrides: Partial<GuardCounters> = {}): GuardCounters {
	return {
		tool_calls: 0,
		llm_calls: 0,
		review_retry_calls: 0,
		pipeline_transition_calls: 0,
		...overrides,
	};
}

function makeRunGuardState(overrides: Partial<RunGuardState> = {}): RunGuardState {
	return {
		policyRevision: "v1",
		factoryScope: "test",
		workerPeriod: "2026-03-22",
		counters: makeCounters(),
		factoryCounters: makeCounters(),
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
		owner: { ownerId: "run:test-1", leaseName: "", leaseGeneration: 0 },
		...overrides,
	};
}

function makeRunState(guardOverrides: Partial<RunGuardState> = {}) {
	return {
		runId: "test-1",
		guard: makeRunGuardState(guardOverrides),
		context: {},
	} as any;
}

function makeDecision(overrides: Partial<ReturnType<typeof buildBlockedDecision>> = {}) {
	return {
		allowed: false,
		counter: "tool_calls" as const,
		reasonCode: "run_tool_budget_exceeded" as const,
		circuitState: "open" as GuardCircuitState,
		transition: "none" as const,
		policyRevision: "v1",
		threshold: 10,
		scope: "run" as const,
		backoffMs: 0,
		nextAttemptAt: "",
		runCounters: makeCounters(),
		factoryCounters: makeCounters(),
		ownerId: "run:test-1",
		leaseName: "",
		leaseGeneration: 0,
		...overrides,
	};
}

function makeFactoryState(overrides: Record<string, unknown> = {}) {
	return {
		counters: makeCounters(),
		expiresAt: "",
		...overrides,
	} as any;
}

function makePolicy(overrides: Record<string, unknown> = {}) {
	return {
		revision: "v1",
		factoryScope: "test",
		workerPeriod: "2026-03-22",
		lockTimeoutMs: 5000,
		backoffBaseMs: 1000,
		backoffCapMs: 60000,
		terminalOverflowCount: 5,
		runLimits: makeCounters({ tool_calls: 10, llm_calls: 20, review_retry_calls: 3, pipeline_transition_calls: 5 }),
		factoryLimits: makeCounters({ tool_calls: 50, llm_calls: 100, review_retry_calls: 15, pipeline_transition_calls: 25 }),
		...overrides,
	} as any;
}

const CONTEXT = {
	nodeId: "agent.worktree",
	issueNumber: "42",
	branch: "feat/foo",
	milestoneTitle: "M1",
};

// ---------------------------------------------------------------------------
// recordGuardMetadata
// ---------------------------------------------------------------------------

describe("recordGuardMetadata", () => {
	it("does nothing when decision.allowed is true", () => {
		const runState = makeRunState();
		const decision = makeDecision({ allowed: true });
		const now = new Date("2026-03-22T10:00:00Z");

		recordGuardMetadata({ runState, decision, context: CONTEXT, now });

		expect(runState.guard.metadata).toBeNull();
		expect(runState.guard.reasonCode).toBe("");
	});

	it("does nothing when circuitState is closed", () => {
		const runState = makeRunState();
		const decision = makeDecision({ allowed: false, circuitState: "closed" });
		const now = new Date("2026-03-22T10:00:00Z");

		recordGuardMetadata({ runState, decision, context: CONTEXT, now });

		expect(runState.guard.metadata).toBeNull();
	});

	it("sets metadata when decision is blocked and circuitState is open", () => {
		const runState = makeRunState();
		const decision = makeDecision({
			allowed: false,
			circuitState: "open",
			reasonCode: "run_tool_budget_exceeded",
		});
		const now = new Date("2026-03-22T10:00:00Z");

		recordGuardMetadata({ runState, decision, context: CONTEXT, now });

		expect(runState.guard.metadata).not.toBeNull();
		const md = runState.guard.metadata as GuardDecisionMetadata;
		expect(md.reasonCode).toBe("run_tool_budget_exceeded");
		expect(md.nodeId).toBe("agent.worktree");
		expect(md.issueNumber).toBe("42");
		expect(md.branch).toBe("feat/foo");
		expect(md.milestoneTitle).toBe("M1");
		expect(md.capturedAt).toBe(now.toISOString());
		expect(runState.guard.reasonCode).toBe("run_tool_budget_exceeded");
	});

	it("sets metadata when circuitState is terminal", () => {
		const runState = makeRunState();
		const decision = makeDecision({
			allowed: false,
			circuitState: "terminal",
			reasonCode: "guard_terminal_state",
		});
		const now = new Date("2026-03-22T11:00:00Z");

		recordGuardMetadata({ runState, decision, context: CONTEXT, now });

		expect(runState.guard.metadata).not.toBeNull();
		expect(runState.guard.metadata!.reasonCode).toBe("guard_terminal_state");
		expect(runState.guard.reasonCode).toBe("guard_terminal_state");
	});

	it("preserves existing reasonCode when decision.reasonCode is empty", () => {
		const runState = makeRunState({ reasonCode: "run_llm_budget_exceeded" });
		const decision = makeDecision({
			allowed: false,
			circuitState: "open",
			reasonCode: "",
		});
		const now = new Date("2026-03-22T12:00:00Z");

		recordGuardMetadata({ runState, decision, context: CONTEXT, now });

		expect(runState.guard.reasonCode).toBe("run_llm_budget_exceeded");
		expect(runState.guard.metadata!.reasonCode).toBe("");
	});
});

// ---------------------------------------------------------------------------
// buildBlockedDecision
// ---------------------------------------------------------------------------

describe("buildBlockedDecision", () => {
	it("returns allowed=false with transition=none", () => {
		const runState = makeRunState();
		const factoryState = makeFactoryState();
		const policy = makePolicy();

		const decision = buildBlockedDecision(
			runState, factoryState, policy,
			"tool_calls", "run_tool_budget_exceeded", "open", "run",
		);

		expect(decision.allowed).toBe(false);
		expect(decision.transition).toBe("none");
	});

	it("uses runLimits threshold when scope is run", () => {
		const runState = makeRunState();
		const factoryState = makeFactoryState();
		const policy = makePolicy();

		const decision = buildBlockedDecision(
			runState, factoryState, policy,
			"tool_calls", "run_tool_budget_exceeded", "open", "run",
		);

		expect(decision.threshold).toBe(10);
		expect(decision.scope).toBe("run");
	});

	it("uses factoryLimits threshold when scope is factory", () => {
		const runState = makeRunState();
		const factoryState = makeFactoryState();
		const policy = makePolicy();

		const decision = buildBlockedDecision(
			runState, factoryState, policy,
			"llm_calls", "factory_llm_budget_exceeded", "open", "factory",
		);

		expect(decision.threshold).toBe(100);
		expect(decision.scope).toBe("factory");
	});

	it("returns threshold 0 when scope is none", () => {
		const runState = makeRunState();
		const factoryState = makeFactoryState();
		const policy = makePolicy();

		const decision = buildBlockedDecision(
			runState, factoryState, policy,
			"tool_calls", "guard_lease_unavailable", "open", "none",
		);

		expect(decision.threshold).toBe(0);
	});

	it("returns threshold 0 when counter is empty", () => {
		const runState = makeRunState();
		const factoryState = makeFactoryState();
		const policy = makePolicy();

		const decision = buildBlockedDecision(
			runState, factoryState, policy,
			"", "guard_terminal_state", "terminal", "run",
		);

		expect(decision.threshold).toBe(0);
	});

	it("copies runCounters from runState.guard.counters", () => {
		const counters = makeCounters({ tool_calls: 7, llm_calls: 3 });
		const runState = makeRunState({ counters });
		const factoryState = makeFactoryState();
		const policy = makePolicy();

		const decision = buildBlockedDecision(
			runState, factoryState, policy,
			"tool_calls", "run_tool_budget_exceeded", "open", "run",
		);

		expect(decision.runCounters).toEqual({ tool_calls: 7, llm_calls: 3, review_retry_calls: 0, pipeline_transition_calls: 0 });
		// Ensure it's a copy, not a reference
		expect(decision.runCounters).not.toBe(runState.guard.counters);
	});

	it("copies factoryCounters from factoryState.counters", () => {
		const runState = makeRunState();
		const factoryCounters = makeCounters({ tool_calls: 30 });
		const factoryState = makeFactoryState({ counters: factoryCounters });
		const policy = makePolicy();

		const decision = buildBlockedDecision(
			runState, factoryState, policy,
			"tool_calls", "factory_tool_budget_exceeded", "open", "factory",
		);

		expect(decision.factoryCounters).toEqual({ tool_calls: 30, llm_calls: 0, review_retry_calls: 0, pipeline_transition_calls: 0 });
		expect(decision.factoryCounters).not.toBe(factoryState.counters);
	});

	it("uses runState.guard.expiresAt for nextAttemptAt when set", () => {
		const expiresAt = "2026-03-22T11:00:00.000Z";
		const runState = makeRunState({ expiresAt });
		const factoryState = makeFactoryState();
		const policy = makePolicy();

		const decision = buildBlockedDecision(
			runState, factoryState, policy,
			"tool_calls", "run_tool_budget_exceeded", "open", "run",
		);

		expect(decision.nextAttemptAt).toBe(expiresAt);
	});

	it("falls back to factoryState.expiresAt when runState has none", () => {
		const runState = makeRunState({ expiresAt: "" });
		const factoryExpiresAt = "2026-03-22T12:00:00.000Z";
		const factoryState = makeFactoryState({ expiresAt: factoryExpiresAt });
		const policy = makePolicy();

		const decision = buildBlockedDecision(
			runState, factoryState, policy,
			"tool_calls", "factory_tool_budget_exceeded", "open", "factory",
		);

		expect(decision.nextAttemptAt).toBe(factoryExpiresAt);
	});

	it("returns empty nextAttemptAt when neither has expiresAt", () => {
		const runState = makeRunState({ expiresAt: "" });
		const factoryState = makeFactoryState({ expiresAt: "" });
		const policy = makePolicy();

		const decision = buildBlockedDecision(
			runState, factoryState, policy,
			"tool_calls", "run_tool_budget_exceeded", "open", "run",
		);

		expect(decision.nextAttemptAt).toBe("");
	});

	it("sets policyRevision from policy", () => {
		const runState = makeRunState();
		const factoryState = makeFactoryState();
		const policy = makePolicy({ revision: "v42" });

		const decision = buildBlockedDecision(
			runState, factoryState, policy,
			"tool_calls", "run_tool_budget_exceeded", "open", "run",
		);

		expect(decision.policyRevision).toBe("v42");
	});

	it("sets owner fields from runState.guard.owner", () => {
		const runState = makeRunState({
			owner: { ownerId: "run:abc", leaseName: "my-lease", leaseGeneration: 5 },
		});
		const factoryState = makeFactoryState();
		const policy = makePolicy();

		const decision = buildBlockedDecision(
			runState, factoryState, policy,
			"tool_calls", "run_tool_budget_exceeded", "open", "run",
		);

		expect(decision.ownerId).toBe("run:abc");
		expect(decision.leaseName).toBe("my-lease");
		expect(decision.leaseGeneration).toBe(5);
	});

	it("passes through circuitState and reasonCode", () => {
		const runState = makeRunState();
		const factoryState = makeFactoryState();
		const policy = makePolicy();

		const decision = buildBlockedDecision(
			runState, factoryState, policy,
			"review_retry_calls", "guard_terminal_state", "terminal", "factory",
		);

		expect(decision.circuitState).toBe("terminal");
		expect(decision.reasonCode).toBe("guard_terminal_state");
		expect(decision.counter).toBe("review_retry_calls");
	});
});

// ---------------------------------------------------------------------------
// statusForGuardDecision
// ---------------------------------------------------------------------------

describe("statusForGuardDecision", () => {
	it("returns guarded_terminal when circuitState is terminal", () => {
		const decision = makeDecision({ circuitState: "terminal" });
		expect(statusForGuardDecision(decision)).toBe("guarded_terminal");
	});

	it("returns guarded when circuitState is open", () => {
		const decision = makeDecision({ circuitState: "open" });
		expect(statusForGuardDecision(decision)).toBe("guarded");
	});

	it("returns guarded when circuitState is closed", () => {
		const decision = makeDecision({ circuitState: "closed" });
		expect(statusForGuardDecision(decision)).toBe("guarded");
	});
});


describe("durable guard reset authorization", () => {
	let root: string;
	let previousRuns: string;
	let previousLocks: string | undefined;
	const now = new Date("2026-10-14T20:00:00.000Z");
	beforeEach(() => {
		previousRuns = runsDir();
		previousLocks = process.env.HATCH_LOCK_DIR;
		root = mkdtempSync(join(tmpdir(), "guard-reset-authorization-"));
		process.env.HATCH_LOCK_DIR = join(root, "locks");
		configureFactoryGuardScope({ guardDir: join(root, "guard") });
	});
	afterEach(() => {
		configureFactoryGuardScope();
		configureRunStorageScope({ runsDir: previousRuns });
		if (previousLocks === undefined) delete process.env.HATCH_LOCK_DIR;
		else process.env.HATCH_LOCK_DIR = previousLocks;
		rmSync(root, { recursive: true, force: true });
	});
	function fixtureRun() {
		const run = createRunState("reset-run", "fixture.dot", { runsDir: join(root, "runs") });
		run.context = { guard_factory_scope: "reset-fixture", guard_worker_period: "fixture-period", guard_lock_timeout_ms: "1" };
		run.guard.counters.tool_calls = 5;
		return run;
	}
	it("denies a different run owner without changing the exhausted budget", () => {
		const run = fixtureRun();
		const result = resetGuardBudgets({ runState: run, actorId: "another-operator" });
		expect(result.ok).toBe(false);
		expect(result.reason).toBe("owner_mismatch");
		expect(result.artifactPath).toBe("");
		expect(run.guard.counters.tool_calls).toBe(5);
		expect(result.runState.counters).not.toBe(run.guard.counters);
	});
	it("requires force to reset another factory owner and persists an auditable reset", () => {
		const run = fixtureRun();
		const policy = resolvePolicy(run, run.context);
		const factory = loadFactoryGuardState(policy, "other-factory-owner", now);
		factory.counters.tool_calls = 8;
		factory.owner.ownerId = "other-factory-owner";
		saveFactoryGuardState(policy, factory);
		const denied = resetGuardBudgets({ runState: run, actorId: run.guard.owner.ownerId, now });
		expect(denied.reason).toBe("factory_owner_mismatch");
		expect(denied.factoryState.counters.tool_calls).toBe(8);
		expect(run.guard.counters.tool_calls).toBe(5);
		const emit = vi.fn();
		const reset = resetGuardBudgets({ runState: run, actorId: "operator", force: true, now, eventBus: { emit } as any });
		expect(reset.ok).toBe(true);
		expect(reset.reason).toBe("reset_applied");
		expect(reset.runState.counters.tool_calls).toBe(0);
		expect(reset.factoryState.counters.tool_calls).toBe(0);
		expect(reset.runState.owner.ownerId).toBe("operator");
		expect(reset.runState.resetCount).toBe(1);
		expect(existsSync(reset.artifactPath)).toBe(true);
		expect(emit.mock.calls.some(([event]) => event.kind === "guard.reset" && event.data.artifact_path === reset.artifactPath)).toBe(true);
	});
	it("fails closed when the factory lease is already held", () => {
		const run = fixtureRun();
		const policy = resolvePolicy(run, run.context);
		const release = acquireLock(`factory-guard-${factoryKey(policy.factoryScope, policy.workerPeriod)}`, 1, { ownerId: "other-worker" });
		expect(release).not.toBeNull();
		try {
			const result = resetGuardBudgets({ runState: run, actorId: "", force: true, now });
			expect(result.ok).toBe(false);
			expect(result.reason).toBe("factory_lease_unavailable");
			expect(run.guard.counters.tool_calls).toBe(5);
		} finally { release?.(); }
	});
	it("leaves budget unchanged for an unrecognized counter", () => {
		const run = fixtureRun();
		const decision = incrementGuardCounter({ runState: run, counter: "unsupported" as any });
		expect(decision.allowed).toBe(true);
		expect(decision.counter).toBe("");
		expect(run.guard.counters.tool_calls).toBe(5);
	});
});
