import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus, type Event } from "@recallnet/factory-telemetry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { evaluateGuardGate, incrementGuardCounter } from "./guard.js";
import { createRunState } from "./run.js";

function guardContext(overrides: Record<string, string> = {}): Record<string, string> {
	return {
		guard_factory_scope: "guard-test",
		guard_worker_period: "period-a",
		guard_policy_revision: "guard.test.v1",
		...overrides,
	};
}

describe("guard -> langfuse deterministic metadata", () => {
	let root: string;
	let testRunsDir: string;
	let previousLockDir: string | undefined;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "hatch-guard-langfuse-test-"));
		testRunsDir = join(root, ".hatch", "runs");
		mkdirSync(testRunsDir, { recursive: true });
		previousLockDir = process.env["HATCH_LOCK_DIR"];
		process.env["HATCH_LOCK_DIR"] = join(root, ".hatch", "locks");
	});

	afterEach(() => {
		if (previousLockDir === undefined) delete process.env["HATCH_LOCK_DIR"];
		else process.env["HATCH_LOCK_DIR"] = previousLockDir;
		rmSync(root, { recursive: true, force: true });
	});

	it("emits deterministic partition-aware guard trace ids with gate-safe telemetry metadata", () => {
		const runState = createRunState("guard-run-telemetry", "/tmp/sample.dot", { runsDir: testRunsDir });
		const context = guardContext({
			guard_factory_scope: "guard-telemetry-scope",
			guard_worker_period: "period-telemetry",
			guard_run_max_tool_calls: "0",
			guard_factory_max_tool_calls: "100",
			guard_backoff_base_ms: "5000",
			guard_backoff_cap_ms: "5000",
			trust_partition: "judge",
			trust_domain: "judge",
			trust_role: "mothership.local.judge",
		});
		runState.context = { ...context };

		const bus = new EventBus();
		const emitted: Event[] = [];
		bus.on((event) => emitted.push(event));

		const t0 = new Date("2026-03-07T00:00:00.000Z");
		const transition = incrementGuardCounter({
			runState,
			counter: "tool_calls",
			nodeId: "build",
			context,
			eventBus: bus,
			now: t0,
		});
		expect(transition.allowed).toBe(false);
		expect(transition.transition).toBe("open");

		const transitionEvent = emitted.find((entry) => entry.kind === "guard.transition");
		expect(transitionEvent).toBeDefined();
		expect(transitionEvent?.traceId).toMatch(/^judge-guard-/);
		expect(transitionEvent?.data?.artifact_path).toContain(runState.runId);
		expect(transitionEvent?.data?.reason_code).toBe("run_tool_budget_exceeded");
		expect(transitionEvent?.data?.scope).toBe("run");
		expect(transitionEvent?.data?.policy_revision).toBe("guard.test.v1");
		expect(transitionEvent?.data?.factory_scope).toBe("guard-telemetry-scope");
		expect(transitionEvent?.data?.worker_period).toBe("period-telemetry");
		expect(transitionEvent?.data?.guard_circuit_state).toBe("open");
		expect(transitionEvent?.data?.trace_partition).toBe("judge");
		expect(transitionEvent?.data?.trust_partition).toBe("judge");
		expect(transitionEvent?.data?.guard_trace_id).toBe(transitionEvent?.traceId);

		const decisionA = evaluateGuardGate({ runState, context, eventBus: bus, now: new Date("2026-03-07T00:00:00.100Z") });
		const decisionB = evaluateGuardGate({ runState, context, eventBus: bus, now: new Date("2026-03-07T00:00:00.200Z") });
		expect(decisionA.allowed).toBe(false);
		expect(decisionB.allowed).toBe(false);

		const decisionEvents = emitted.filter((entry) => entry.kind === "guard.decision");
		expect(decisionEvents.length).toBeGreaterThanOrEqual(2);
		const latest = decisionEvents.at(-1);
		const prior = decisionEvents.at(-2);
		expect(prior?.traceId).toBeDefined();
		expect(latest?.traceId).toBe(prior?.traceId);
		expect(latest?.data?.guard_trace_id).toBe(latest?.traceId);
	});
});
