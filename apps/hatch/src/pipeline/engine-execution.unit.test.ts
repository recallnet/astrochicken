import { EventBus } from "@recallnet/factory-telemetry";
import { describe, it, expect } from "vitest";

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
