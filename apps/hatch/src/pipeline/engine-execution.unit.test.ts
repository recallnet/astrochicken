import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus } from "@recallnet/factory-telemetry";
import { afterEach, beforeEach, describe, it, expect } from "vitest";

import { configureFactoryGuardScope } from "./guard-core.js";
import { createRunState } from "./run.js";
import { Context, type Outcome, StageStatus, type StageRecord } from "./context.js";
import { executeNodeWithRetries, type ExecuteNodeParams } from "./engine-execution.js";
import type { Graph, Node } from "./graph.js";
import { HandlerRegistry, type Handler } from "./handler-registry.js";
import { createWorkflowInstrumentationHelpers } from "./instrumentation-helpers.js";
import { ThreadStore } from "./threads.js";

// ── Helpers ──

function makeNode(id: string, attrs: Record<string, string> = {}): Node {
	return { id, attrs };
}

function makeGraph(overrides: Partial<Graph> = {}): Graph {
	return {
		name: "test",
		attrs: {},
		nodes: {},
		edges: [],
		...overrides,
	};
}

function makeInstrumentation(events: EventBus) {
	return createWorkflowInstrumentationHelpers({
		eventBus: events,
		workflowId: "test-workflow",
	});
}

/** Build a full ExecuteNodeParams with sensible defaults, overridable per-field. */
function makeParams(overrides: Partial<ExecuteNodeParams> = {}): ExecuteNodeParams {
	const events = new EventBus();
	return {
		signal: undefined,
		node: makeNode("n1", { type: "start" }),
		input: "hello",
		graph: makeGraph(),
		registry: new HandlerRegistry(),
		events,
		context: new Context(),
		threadStore: new ThreadStore(),
		records: [],
		instrumentation: makeInstrumentation(events),
		startRunHeartbeat: () => null,
		lifecycleIdentityData: () => ({}),
		mergeLifecycleData: (base, id) => ({ ...base, ...id }),
		currentGuardCircuitState: () => "closed",
		nextTraceId: () => "trace-1",
		...overrides,
	};
}

class FakeHandler implements Handler {
	private calls = 0;
	constructor(private fn: (call: number, signal: AbortSignal) => Promise<Outcome>) {}
	async execute(
		signal: AbortSignal,
		_node: Node,
		_ctx: Context,
		_input: string,
	): Promise<Outcome> {
		this.calls++;
		return this.fn(this.calls, signal);
	}
}

function succeedingHandler(output = "ok"): Handler {
	return new FakeHandler(async () => ({
		status: StageStatus.Completed,
		output,
	}));
}

function failingHandler(message = "boom"): Handler {
	return new FakeHandler(async () => {
		throw new Error(message);
	});
}

// ── Tests ──

describe("executeNodeWithRetries", () => {
	// 1. start/exit passthrough
	it("returns Completed with input echoed for unregistered start node", async () => {
		const params = makeParams({
			node: makeNode("s", { type: "start" }),
			input: "seed",
		});
		const outcome = await executeNodeWithRetries(params);
		expect(outcome.status).toBe(StageStatus.Completed);
		expect(outcome.output).toBe("seed");
	});

	it("returns Completed with input echoed for unregistered exit node", async () => {
		const params = makeParams({
			node: makeNode("e", { type: "exit" }),
			input: "done",
		});
		const outcome = await executeNodeWithRetries(params);
		expect(outcome.status).toBe(StageStatus.Completed);
		expect(outcome.output).toBe("done");
	});

	// 2. missing handler throws
	it("throws descriptive error for unregistered non-start/exit handler type", async () => {
		const params = makeParams({
			node: makeNode("n", { type: "llm" }),
		});
		await expect(executeNodeWithRetries(params)).rejects.toThrow(
			'no handler registered for type "llm"',
		);
	});

	// 3. handler success returns outcome
	it("returns handler outcome on success and pushes a completed record", async () => {
		const registry = new HandlerRegistry();
		registry.register("tool", succeedingHandler("result-42"));
		const records: StageRecord[] = [];

		const params = makeParams({
			node: makeNode("t1", { type: "tool" }),
			input: "go",
			registry,
			records,
		});

		const outcome = await executeNodeWithRetries(params);
		expect(outcome.status).toBe(StageStatus.Completed);
		expect(outcome.output).toBe("result-42");
		expect(outcome.durationMs).toBeGreaterThanOrEqual(0);

		expect(records).toHaveLength(1);
		expect(records[0].nodeId).toBe("t1");
		expect(records[0].status).toBe(StageStatus.Completed);
		expect(records[0].attempt).toBe(1);
	});

	// 4. retry on handler failure
	it("retries on failure then succeeds", async () => {
		const registry = new HandlerRegistry();
		let callCount = 0;
		registry.register(
			"tool",
			new FakeHandler(async () => {
				callCount++;
				if (callCount === 1) throw new Error("transient");
				return { status: StageStatus.Completed, output: "recovered" };
			}),
		);
		const records: StageRecord[] = [];

		const params = makeParams({
			node: makeNode("r1", { type: "tool", max_retries: "3" }),
			registry,
			records,
		});

		const outcome = await executeNodeWithRetries(params);
		expect(outcome.status).toBe(StageStatus.Completed);
		expect(outcome.output).toBe("recovered");
		// Should have 2 records: 1 failed attempt + 1 success
		expect(records).toHaveLength(2);
		expect(records[0].status).toBe(StageStatus.Failed);
		expect(records[0].attempt).toBe(1);
		expect(records[1].status).toBe(StageStatus.Completed);
		expect(records[1].attempt).toBe(2);
	});

	// 5. all retries exhausted throws
	it("throws wrapped error after all retries exhausted", async () => {
		const registry = new HandlerRegistry();
		registry.register("tool", failingHandler("persistent-fail"));
		const records: StageRecord[] = [];

		const params = makeParams({
			node: makeNode("f1", { type: "tool", max_retries: "2" }),
			registry,
			records,
		});

		await expect(executeNodeWithRetries(params)).rejects.toThrow(
			"after 2 attempts: persistent-fail",
		);
		expect(records).toHaveLength(2);
		expect(records.every((r) => r.status === StageStatus.Failed)).toBe(true);
	});

	// 6. maxRetries=0 treated as 1
	it("treats maxRetries=0 as a single attempt", async () => {
		const registry = new HandlerRegistry();
		registry.register("tool", failingHandler("once"));

		const params = makeParams({
			node: makeNode("z1", { type: "tool" }), // no max_retries => defaults to 0 => treated as 1
			registry,
		});

		await expect(executeNodeWithRetries(params)).rejects.toThrow(
			"after 1 attempts: once",
		);
	});

	it("succeeds with maxRetries=0 if handler succeeds on first try", async () => {
		const registry = new HandlerRegistry();
		registry.register("tool", succeedingHandler("first-try"));

		const params = makeParams({
			node: makeNode("z2", { type: "tool" }), // defaults to 0 => 1
			registry,
		});

		const outcome = await executeNodeWithRetries(params);
		expect(outcome.status).toBe(StageStatus.Completed);
		expect(outcome.output).toBe("first-try");
	});

	// 7. timeout aborts handler
	it("aborts handler when timeout expires", async () => {
		const registry = new HandlerRegistry();
		registry.register(
			"tool",
			new FakeHandler(async (_call, signal) => {
				// Wait longer than the timeout
				await new Promise((resolve, reject) => {
					const timer = setTimeout(resolve, 5000);
					signal.addEventListener(
						"abort",
						() => {
							clearTimeout(timer);
							reject(new Error("aborted"));
						},
						{ once: true },
					);
				});
				return { status: StageStatus.Completed, output: "never" };
			}),
		);

		const params = makeParams({
			node: makeNode("t1", { type: "tool", timeout: "50ms" }),
			registry,
		});

		await expect(executeNodeWithRetries(params)).rejects.toThrow(/timed out after 50ms/);
	});

	// 8. thread context prepended
	it("prepends thread context to input when thread_id is set", async () => {
		const registry = new HandlerRegistry();
		let capturedInput = "";
		registry.register(
			"tool",
			{
				async execute(_signal, _node, _ctx, input) {
					capturedInput = input;
					return { status: StageStatus.Completed, output: "done" };
				},
			},
		);

		const threadStore = new ThreadStore();
		threadStore.addMessage("conv-1", { role: "user", content: "earlier question" });
		threadStore.addMessage("conv-1", { role: "assistant", content: "earlier answer" });

		const params = makeParams({
			node: makeNode("th1", { type: "tool", thread_id: "conv-1" }),
			input: "new question",
			registry,
			threadStore,
		});

		await executeNodeWithRetries(params);
		expect(capturedInput).toContain("Previous conversation:");
		expect(capturedInput).toContain("earlier question");
		expect(capturedInput).toContain("earlier answer");
		expect(capturedInput).toContain("new question");
	});

	it("records assistant message to thread on success", async () => {
		const registry = new HandlerRegistry();
		registry.register("tool", succeedingHandler("assistant-reply"));

		const threadStore = new ThreadStore();

		const params = makeParams({
			node: makeNode("th2", { type: "tool", thread_id: "conv-2" }),
			input: "user-msg",
			registry,
			threadStore,
		});

		await executeNodeWithRetries(params);

		const messages = threadStore.getMessages("conv-2");
		// Should have user message (from prepend logic) + assistant message
		expect(messages.some((m) => m.role === "user")).toBe(true);
		expect(messages.some((m) => m.role === "assistant" && m.content === "assistant-reply")).toBe(true);
	});

	// 9. records pushed on success and failure
	it("pushes a failed record on handler error", async () => {
		const registry = new HandlerRegistry();
		registry.register("tool", failingHandler("kaboom"));
		const records: StageRecord[] = [];

		const params = makeParams({
			node: makeNode("e1", { type: "tool" }),
			registry,
			records,
		});

		await expect(executeNodeWithRetries(params)).rejects.toThrow();
		expect(records).toHaveLength(1);
		expect(records[0].status).toBe(StageStatus.Failed);
		expect(records[0].outcome?.error).toBe("kaboom");
		expect(records[0].nodeId).toBe("e1");
		expect(records[0].startedAt).toBeInstanceOf(Date);
		expect(records[0].endedAt).toBeInstanceOf(Date);
	});

	// Abort signal propagation
	it("propagates parent abort signal to handler", async () => {
		const ac = new AbortController();
		const registry = new HandlerRegistry();
		let handlerSignalAborted = false;

		registry.register("tool", {
			async execute(signal) {
				// Abort the parent after handler starts
				setTimeout(() => ac.abort(), 10);
				await new Promise((resolve, reject) => {
					const timer = setTimeout(resolve, 5000);
					signal.addEventListener(
						"abort",
						() => {
							clearTimeout(timer);
							handlerSignalAborted = true;
							reject(new Error("aborted"));
						},
						{ once: true },
					);
				});
				return { status: StageStatus.Completed, output: "never" };
			},
		});

		const params = makeParams({
			signal: ac.signal,
			node: makeNode("a1", { type: "tool", timeout: "5000ms" }),
			registry,
		});

		await expect(executeNodeWithRetries(params)).rejects.toThrow();
		expect(handlerSignalAborted).toBe(true);
	});
});


describe("execution guard and lifecycle boundaries", () => {
	let root: string;
	let previousLockDir: string | undefined;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "engine-execution-boundary-"));
		configureFactoryGuardScope({ guardDir: join(root, "guard") });
		previousLockDir = process.env["HATCH_LOCK_DIR"];
		process.env["HATCH_LOCK_DIR"] = join(root, "locks");
	});
	afterEach(() => {
		configureFactoryGuardScope({});
		if (previousLockDir === undefined) delete process.env["HATCH_LOCK_DIR"];
		else process.env["HATCH_LOCK_DIR"] = previousLockDir;
		rmSync(root, { recursive: true, force: true });
	});

	function guardedParams(handlerType: string, handler: Handler, attrs: Record<string, string> = {}) {
		const registry = new HandlerRegistry();
		registry.register(handlerType, handler);
		return makeParams({
			node: makeNode("guarded", { type: handlerType, ...attrs }),
			registry,
			runState: createRunState("boundary-run", "/tmp/fixture.dot", { runsDir: join(root, "runs") }),
			context: new Context({ guard_factory_scope: "execution-boundary", guard_worker_period: "test" }),
		});
	}

	it("does not invoke a handler or heartbeat after a terminal guard decision", async () => {
		let calls = 0;
		let heartbeats = 0;
		const params = guardedParams("tool", new FakeHandler(async () => {
			calls++;
			return { status: StageStatus.Completed, output: "forbidden" };
		}));
		params.runState!.guard.circuitState = "terminal";
		params.startRunHeartbeat = () => { heartbeats++; return null; };
		const outcome = await executeNodeWithRetries(params);
		expect(outcome.status).toBe(StageStatus.Skipped);
		expect(outcome.contextUpdates?.["__guard_blocked"]).toBe("true");
		expect(outcome.error).toBe("guard_terminal_state");
		expect(calls).toBe(0);
		expect(heartbeats).toBe(0);
		expect(params.records).toEqual([]);
	});

	it("denies the next tool invocation when its run budget is exhausted", async () => {
		let calls = 0;
		const params = guardedParams("tool", new FakeHandler(async () => {
			calls++;
			return { status: StageStatus.Completed, output: "allowed-once" };
		}));
		params.context.set("guard_run_max_tool_calls", "1");
		params.context.set("guard_factory_max_tool_calls", "100");
		params.runState!.guard.counters.tool_calls = 1;
		const outcome = await executeNodeWithRetries(params);
		expect(outcome.status).toBe(StageStatus.Skipped);
		expect(outcome.error).toBe("run_tool_budget_exceeded");
		expect(outcome.contextUpdates?.["gate_name"]).toBe("guard.tool_calls");
		expect(calls).toBe(0);
		expect(params.records).toEqual([]);
	});

	it.each([
		["tool", "tool_calls"],
		["pipeline", "pipeline_transition_calls"],
		["codergen", "llm_calls"],
	] as const)("accounts for allowed %s execution against its guard counter", async (handlerType, counter) => {
		const params = guardedParams(handlerType, succeedingHandler("counted"));
		const outcome = await executeNodeWithRetries(params);
		expect(outcome.output).toBe("counted");
		expect(params.runState!.guard.counters[counter]).toBe(1);
		expect(params.records).toHaveLength(1);
	});

	it.each(["parallel.fan_out", "parallel.fan_in"])("emits %s pass and failure telemetry without a handler budget counter", async (handlerType) => {
		const params = guardedParams(handlerType, succeedingHandler("parallel-result"));
		const emitted: Array<{ kind: string; data?: Record<string, string> }> = [];
		params.events.on((event) => emitted.push(event));
		expect((await executeNodeWithRetries(params)).status).toBe(StageStatus.Completed);
		expect(emitted.some((event) => event.kind === handlerType && event.data?.["outcome"] === "pass")).toBe(true);
		params.registry.register(handlerType, failingHandler("parallel-failure"));
		await expect(executeNodeWithRetries(params)).rejects.toThrow("parallel-failure");
		expect(emitted.some((event) => event.kind === handlerType && event.data?.["outcome"] === "fail")).toBe(true);
	});

	it("keeps failure records and stops every heartbeat when a handler throws a non-Error value", async () => {
		let stops = 0;
		const params = guardedParams("tool", new FakeHandler(async () => { throw "remote failure"; }), { max_retries: "2" });
		params.startRunHeartbeat = () => () => { stops++; };
		await expect(executeNodeWithRetries(params)).rejects.toThrow("after 2 attempts: remote failure");
		expect(stops).toBe(2);
		expect(params.records.map((record) => record.outcome?.error)).toEqual(["remote failure", "remote failure"]);
	});

	it("stops the heartbeat and records a returned failure without retrying it as an exception", async () => {
		let stops = 0;
		const params = guardedParams("tool", new FakeHandler(async () => ({ status: StageStatus.Failed, output: "", error: "explicit rejection" })), { max_retries: "3" });
		params.startRunHeartbeat = () => () => { stops++; };
		const outcome = await executeNodeWithRetries(params);
		expect(outcome.error).toBe("explicit rejection");
		expect(params.records).toHaveLength(1);
		expect(params.records[0].status).toBe(StageStatus.Failed);
		expect(stops).toBe(1);
	});

	it.each([
		[{ llm_model: "primary", agent_model: "fallback" }, "primary"],
		[{ agent_model: "fallback" }, "fallback"],
	] as const)("records effective model telemetry for %j", async (attrs, expectedModel) => {
		const params = guardedParams("tool", succeedingHandler(), attrs);
		const models: string[] = [];
		params.events.on((event) => { if (event.kind === "stage.start") models.push(event.data?.["model"] || ""); });
		await executeNodeWithRetries(params);
		expect(models).toEqual([expectedModel]);
	});

	it("tolerates absent merged telemetry while still executing and recording a failure", async () => {
		const params = guardedParams("tool", failingHandler("no metadata"));
		params.mergeLifecycleData = () => undefined;
		await expect(executeNodeWithRetries(params)).rejects.toThrow("no metadata");
		expect(params.records[0].outcome?.error).toBe("no metadata");
		params.registry.register("tool", succeedingHandler("no metadata success"));
		expect((await executeNodeWithRetries(params)).output).toBe("no metadata success");
	});

	it("binds graph intent metadata without losing the handler's resolved intent", async () => {
		const params = guardedParams("tool", new FakeHandler(async () => ({
			status: StageStatus.Completed, output: "", intent: { handlerType: "tool", kind: "command", data: { command: "inspect" }, nodeId: "guarded", digest: "fixture-digest" },
		})));
		params.graph.attrs = { intent_ref: "release-check", intent_profile: "strict", intent_patches: "audit" };
		const outcome = await executeNodeWithRetries(params);
		expect(outcome.intent).toMatchObject({ intentRef: "release-check", intentProfile: "strict", intentPatches: ["audit"], data: { command: "inspect" } });
	});

	it("preserves timeout cause metadata even when a handler ignores cancellation", async () => {
		const params = guardedParams("tool", new FakeHandler(async () => new Promise<Outcome>(() => {})), { timeout: "5ms" });
		await expect(executeNodeWithRetries(params)).rejects.toMatchObject({ timeoutTriggered: true, abortTriggered: false });
		expect(params.records).toHaveLength(1);
	});

	it("rejects an already-aborted parent before invoking a cooperative handler", async () => {
		const controller = new AbortController();
		controller.abort();
		let called = false;
		const params = guardedParams("tool", new FakeHandler(async (_call, signal) => {
			called = true;
			signal.throwIfAborted();
			return { status: StageStatus.Completed, output: "forbidden" };
		}), { timeout: "10ms" });
		params.signal = controller.signal;
		await expect(executeNodeWithRetries(params)).rejects.toThrow();
		expect(called).toBe(false);
	});

	it("adds prior thread history when the current input is empty and skips empty assistant output", async () => {
		let captured = "";
		const params = guardedParams("tool", { async execute(_signal, _node, _context, input) { captured = input; return { status: StageStatus.Completed, output: "" }; } }, { thread_id: "history" });
		params.input = "";
		params.threadStore.addMessage("history", { role: "assistant", content: "previous answer" });
		await executeNodeWithRetries(params);
		expect(captured).toContain("Previous conversation:");
		expect(captured).toContain("previous answer");
		expect(params.threadStore.getMessages("history").filter((message) => message.role === "assistant")).toHaveLength(1);
	});

	it("requires a scenario registry before invoking a scenario-dependent handler", async () => {
		let calls = 0;
		const params = guardedParams("tool", new FakeHandler(async () => { calls++; return { status: StageStatus.Completed, output: "" }; }), { scenarios: "missing" });
		await expect(executeNodeWithRetries(params)).rejects.toThrow("scenario registry root is required");
		expect(calls).toBe(0);
	});

	it("keeps the original input when a declared scenario is absent from an explicit registry", async () => {
		let captured = "";
		const params = guardedParams("tool", { async execute(_signal, _node, _context, input) { captured = input; return { status: StageStatus.Completed, output: "ok" }; } }, { scenarios: "missing" });
		mkdirSync(join(root, "scenarios"));
		params.context.set("scenarios_root", join(root, "scenarios"));
		await executeNodeWithRetries(params);
		expect(captured).toBe("hello");
	});
	it.each(["", "operator input"])("injects scenario guidance while preserving current input %j", async (input) => {
		let captured = "";
		const params = guardedParams("tool", { async execute(_signal, _node, _context, value) { captured = value; return { status: StageStatus.Completed, output: "ok" }; } }, { scenarios: "audit/SCENARIO.md" });
		params.input = input;
		const registryRoot = join(root, "scenarios");
		mkdirSync(join(registryRoot, "audit"), { recursive: true });
		writeFileSync(join(registryRoot, "audit", "SCENARIO.md"), "---\nid: audit-before-change\ntitle: Inspect real evidence\npriority: critical\nscope: safety\ndomain: release\n---\n## Context\nReview artifacts before changing state.\n## Steps\nInspect the release.\n");
		params.context.set("scenarios_root", registryRoot);
		await executeNodeWithRetries(params);
		expect(captured).toContain("audit-before-change");
		expect(captured).toContain("Inspect real evidence");
		if (input) expect(captured.endsWith("\n\n" + input)).toBe(true);
		else expect(captured).not.toContain("operator input");
	});

	it("rejects a pre-aborted timed execution without starting uncancellable work", async () => {
		const controller = new AbortController();
		controller.abort();
		let calls = 0;
		const params = guardedParams("tool", new FakeHandler(async () => {
			calls++;
			return new Promise<Outcome>(() => {});
		}), { timeout: "5ms" });
		params.signal = controller.signal;
		const result = await Promise.race([
			executeNodeWithRetries(params).then(() => ({ state: "completed" }), (error: unknown) => ({ state: "rejected", error })),
			new Promise<{ state: string }>((resolve) => setTimeout(() => resolve({ state: "still-pending" }), 50)),
		]);
		expect(result.state).toBe("rejected");
		expect("error" in result && result.error).toMatchObject({ timeoutTriggered: false, abortTriggered: true });
		expect(calls).toBe(0);
	});

	it("observes a parent abort raised synchronously while starting a handler", async () => {
		const controller = new AbortController();
		const params = guardedParams("tool", new FakeHandler(async () => {
			controller.abort();
			return new Promise<Outcome>(() => {});
		}), { timeout: "5ms" });
		params.signal = controller.signal;
		await expect(executeNodeWithRetries(params)).rejects.toMatchObject({ timeoutTriggered: false, abortTriggered: true });
	});

	it("handles a synchronous parent abort followed by a synchronous handler throw without orphan rejection", async () => {
		const controller = new AbortController();
		const params = guardedParams("tool", {
			execute() {
				controller.abort();
				throw new Error("synchronous handler failure");
			},
		}, { timeout: "5ms" });
		params.signal = controller.signal;
		await expect(executeNodeWithRetries(params)).rejects.toMatchObject({ timeoutTriggered: false, abortTriggered: true });
		// Allow the runtime's unhandled-rejection turn to run before this case completes.
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(params.records).toHaveLength(1);
		expect(params.records[0].status).toBe(StageStatus.Failed);
	});

	it("does not start deferred timed work if the parent aborts before its invocation microtask", async () => {
		const controller = new AbortController();
		let calls = 0;
		const params = guardedParams("tool", new FakeHandler(async () => {
			calls++;
			return { status: StageStatus.Completed, output: "forbidden" };
		}), { timeout: "50ms" });
		params.signal = controller.signal;
		const execution = executeNodeWithRetries(params);
		controller.abort();
		await expect(execution).rejects.toMatchObject({ timeoutTriggered: false, abortTriggered: true });
		expect(calls).toBe(0);
	});

});
