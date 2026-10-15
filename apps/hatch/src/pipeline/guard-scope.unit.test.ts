import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { configureFactoryGuardScope, loadFactoryGuardState, resolvePolicy, saveFactoryGuardState } from "./guard-core.js";
import { evaluateGuardGate, guardCounterForHandlerType, guardCounterForTransition, incrementGuardCounter } from "./guard.js";
import { createRunState, runDir } from "./run.js";

describe("guard factory scope defaults", () => {
	let root: string;
	let testRunsDir: string;
	let savedFactoryId: string | undefined;
	let savedInstanceId: string | undefined;

	beforeEach(() => {
		// Isolate from any ambient HATCH_FACTORY_ID / HATCH_INSTANCE_ID set by the
		// outer process (e.g. when tests run inside a live factory worktree).
		savedFactoryId = process.env["HATCH_FACTORY_ID"];
		savedInstanceId = process.env["HATCH_INSTANCE_ID"];
		delete process.env["HATCH_FACTORY_ID"];
		delete process.env["HATCH_INSTANCE_ID"];
		root = mkdtempSync(join(tmpdir(), "hatch-guard-scope-test-"));
		testRunsDir = join(root, ".hatch", "runs");
		mkdirSync(testRunsDir, { recursive: true });
		configureFactoryGuardScope({ guardDir: join(root, ".hatch", "guard") });
		// Isolate from host environment factory identity so config-file lookup is used
		savedFactoryId = process.env["HATCH_FACTORY_ID"];
		savedInstanceId = process.env["HATCH_INSTANCE_ID"];
		delete process.env["HATCH_FACTORY_ID"];
		delete process.env["HATCH_INSTANCE_ID"];
	});

	afterEach(() => {
		// Restore env vars before cleaning up the guard scope config.
		if (savedFactoryId !== undefined) {
			process.env["HATCH_FACTORY_ID"] = savedFactoryId;
		}
		if (savedInstanceId !== undefined) {
			process.env["HATCH_INSTANCE_ID"] = savedInstanceId;
		}
		configureFactoryGuardScope({});
		rmSync(root, { recursive: true, force: true });
		// Restore host environment
		if (savedFactoryId !== undefined) process.env["HATCH_FACTORY_ID"] = savedFactoryId;
		else delete process.env["HATCH_FACTORY_ID"];
		if (savedInstanceId !== undefined) process.env["HATCH_INSTANCE_ID"] = savedInstanceId;
		else delete process.env["HATCH_INSTANCE_ID"];
	});

	it("derives default factory guard scope from pipeline identity when no explicit scope is set", () => {
		const pipelineDir = join(root, "factories", "example-trading");
		mkdirSync(pipelineDir, { recursive: true });
		writeFileSync(
			join(pipelineDir, "factory.config.json"),
			JSON.stringify(
				{
					schema: "hatch.factory.config.v1",
					factory_id: "example-trading",
					factory_root: "factories/example-trading",
					kind_id: "example-trading",
					instance_id: "example-trading",
					target_repo: "example-org/example-trading",
					control_plane_repo: "recallnet/astrochicken",
					dispatch: {
						graph: "docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot",
					},
				},
				null,
				2,
			),
		);
		const runState = createRunState("guard-run-derived-scope", join(pipelineDir, "graphs", "factory_supervisor_tick.dot"), {
			runsDir: testRunsDir,
		});
		runState.context = {};
		const decision = incrementGuardCounter({
			runState,
			counter: "tool_calls",
			context: {},
			now: new Date("2026-01-01T00:00:00.000Z"),
		});
		expect(decision.allowed).toBe(true);
		expect(runState.guard.factoryScope).toBe("example-trading");
		expect(runState.guard.workerPeriod).toBe("default");
		expect(existsSync(join(root, ".hatch", "guard", "example-trading.default.json"))).toBe(true);
		expect(existsSync(join(root, ".hatch", "guard", "default.default.json"))).toBe(false);
		expect(existsSync(runDir(runState.runId))).toBe(true);
	});

	function scopedRun(id: string) {
		const run = createRunState(id, join(root, "pipeline.dot"), { runsDir: testRunsDir });
		run.context = { guard_factory_scope: id, guard_worker_period: "period" };
		return run;
	}

	it.each([
		["tool", "tool_calls"], ["pipeline", "pipeline_transition_calls"],
		...["codergen", "stack.manager_loop", "agent.worktree", "agent.kw"].map((handler) => [handler, "llm_calls"]),
		["start", null], ["", null],
	])("maps %s to its budget without charging unrelated handlers", (handler, counter) => {
		expect(guardCounterForHandlerType(handler as string)).toBe(counter);
	});

	it.each([
		["retry_review", "BUILD", {}, "review_retry_calls"],
		["review", "build", { review_verdict: "REVISE" }, "review_retry_calls"],
		["", "build", {}, null], ["review", "", { review_verdict: "revise" }, null],
		["review", "build", { review_verdict: "approve" }, null],
	])("charges only review reentry %s to %s", (from, to, context, counter) => {
		expect(guardCounterForTransition(from as string, to as string, context as Record<string, string>)).toBe(counter);
	});

	it("denies terminal runs and preserves fallback operator context", () => {
		const run = scopedRun("terminal-run");
		run.guard.circuitState = "terminal";
		const decision = evaluateGuardGate({ runState: run, context: {
			...run.context, last_stage: "review", target_issue_number: "12", last_branch: " wave/review ", milestone_title: "release",
		}, now: new Date("2026-01-01T00:00:00Z") });
		expect(decision).toMatchObject({ allowed: false, scope: "run", reasonCode: "guard_terminal_state" });
		expect(run.guard.metadata).toMatchObject({ nodeId: "review", issueNumber: "12", branch: "wave/review", milestoneTitle: "release" });
	});

	it.each(["terminal", "open"] as const)("denies a factory %s circuit in another run", (circuitState) => {
		const run = scopedRun(`factory-${circuitState}`);
		const now = new Date("2026-01-01T00:00:00Z");
		const policy = resolvePolicy(run, run.context);
		const factory = loadFactoryGuardState(policy, "other-owner", now);
		Object.assign(factory, { circuitState, reasonCode: "", openedAt: now.toISOString(), expiresAt: "2026-01-01T01:00:00Z", terminalAt: "" });
		saveFactoryGuardState(policy, factory);
		const decision = evaluateGuardGate({ runState: run, nodeId: "build", context: { ...run.context, issue_number: "14", branch: "wave/current" }, now });
		expect(decision).toMatchObject({ allowed: false, scope: "factory", circuitState });
		expect(run.guard.circuitState).toBe(circuitState);
		expect(run.guard.reasonCode).toBe(circuitState === "terminal" ? "guard_terminal_state" : "guard_backoff_active");
		expect(run.guard.metadata).toMatchObject({ nodeId: "build", issueNumber: "14", branch: "wave/current" });
		if (circuitState === "terminal") expect(run.guard.terminalAt).toBe(now.toISOString());
		else expect(run.guard.expiresAt).toBe(factory.expiresAt);
	});

	it("releases expired run and factory backoff durably before allowing work", () => {
		const run = scopedRun("expired-circuits");
		const now = new Date("2026-01-01T00:00:00Z");
		const policy = resolvePolicy(run, run.context);
		const factory = loadFactoryGuardState(policy, "other-owner", now);
		const expired = { circuitState: "open" as const, expiresAt: "2025-12-31T23:59:00Z", openedAt: "2025-12-31T23:58:00Z" };
		Object.assign(run.guard, expired);
		Object.assign(factory, expired);
		saveFactoryGuardState(policy, factory);
		const decision = evaluateGuardGate({ runState: run, now });
		expect(decision.allowed).toBe(true);
		expect(run.guard.circuitState).toBe("closed");
		expect(loadFactoryGuardState(policy, "other-owner", now)).toMatchObject({ circuitState: "closed", expiresAt: "", openedAt: "" });
	});

});
