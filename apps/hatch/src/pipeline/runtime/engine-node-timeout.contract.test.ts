import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus, type Event } from "@recallnet/factory-telemetry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Context, type Outcome, StageStatus } from "../context.js";
import { Engine, HandlerRegistry, type Handler } from "../engine.js";
import { DynamicFanOutHandler } from "../handler/fan_out_dynamic.js";
import { PipelineHandler } from "../handler/pipeline.js";
import { parse } from "../parse.js";
import { createRunState } from "../run.js";

import type { Node } from "../graph.js";

/**
 * Handler that never resolves — simulates a hung LLM API call that does not
 * honour the AbortSignal internally (e.g. a handler that has its own async
 * loop and hasn't wired signal cancellation yet).  The engine must still
 * race the outer timeout promise and throw, even when the handler keeps
 * running in the background.
 */
class HangingHandler implements Handler {
	calls = 0;
	async execute(
		_signal: AbortSignal,
		_node: Node,
		_ctx: Context,
		_input: string,
	): Promise<Outcome> {
		this.calls++;
		// Never resolves — simulates a hung LLM call
		return new Promise<Outcome>(() => {});
	}
}

/** Handler that completes immediately. */
class OkHandler implements Handler {
	async execute(): Promise<Outcome> {
		return { status: StageStatus.Completed, output: "ok" };
	}
}

describe("engine node timeout enforcement", () => {
	let testRoot: string;
	let testRunsDir: string;

	beforeEach(() => {
		testRoot = mkdtempSync(join(tmpdir(), "hatch-node-timeout-"));
		testRunsDir = join(testRoot, ".hatch", "runs");
		mkdirSync(testRunsDir, { recursive: true });
	});

	afterEach(() => {
		delete process.env.HATCH_RUN_HEARTBEAT_MS;
		rmSync(testRoot, { recursive: true, force: true });
	});
	it("rejects node execution after configured timeout", async () => {
		const graph = parse(`
			digraph timeout_test {
				start [shape=Mdiamond]
				slow [type="codergen" timeout="200ms" label="Slow node"]
				done [shape=Msquare]
				start -> slow -> done
			}
		`);

		const hanging = new HangingHandler();
		const registry = new HandlerRegistry();
		registry.register("codergen", hanging);

		const engine = new Engine(graph, registry, { context: new Context() });

		// Engine should reject because the node times out
		await expect(engine.run()).rejects.toThrow(/timed out/i);

		// The handler was called (at least once for the attempt)
		expect(hanging.calls).toBeGreaterThanOrEqual(1);
	});

	it("rejects node execution when timeout is interpolated from runtime context", async () => {
		const graph = parse(`
			digraph timeout_interpolated_fail {
				start [shape=Mdiamond]
				slow [type="codergen" timeout="\${goal_decomposition_timeouts.issue_draft}" label="Slow node"]
				done [shape=Msquare]
				start -> slow -> done
			}
		`);

		const hanging = new HangingHandler();
		const registry = new HandlerRegistry();
		registry.register("codergen", hanging);

		const engine = new Engine(graph, registry, {
			context: new Context({
				goal_decomposition_timeouts: JSON.stringify({ issue_draft: "100ms" }),
			}),
		});

		await expect(engine.run()).rejects.toThrow(/timed out/i);
		expect(hanging.calls).toBeGreaterThanOrEqual(1);
	});

	it("completes when interpolated timeout budget is sufficient", async () => {
		const graph = parse(`
			digraph timeout_interpolated_success {
				start [shape=Mdiamond]
				fast [type="tool" timeout="\${goal_decomposition_timeouts.issue_draft}" label="Fast node"]
				done [shape=Msquare]
				start -> fast -> done
			}
		`);

		const registry = new HandlerRegistry();
		registry.register("tool", new OkHandler());

		const engine = new Engine(graph, registry, {
			context: new Context({
				goal_decomposition_timeouts: JSON.stringify({ issue_draft: "500ms" }),
			}),
		});

		await engine.run();
		expect(engine.getRecords().some((record) => record.nodeId === "fast" && record.status === StageStatus.Completed)).toBe(true);
	});

	it("records timeout as failed stage with correct nodeId", async () => {
		process.env.HATCH_RUN_HEARTBEAT_MS = "20";
		const graph = parse(`
			digraph timeout_record {
				start [shape=Mdiamond]
				stuck [type="tool" timeout="100ms" label="Stuck tool"]
				done [shape=Msquare]
				start -> stuck -> done
			}
		`);

		const hanging = new HangingHandler();
		const registry = new HandlerRegistry();
		registry.register("tool", hanging);

		const events: Event[] = [];
		const bus = new EventBus();
		bus.on((event) => events.push(event));
		const engine = new Engine(graph, registry, {
			context: new Context(),
			eventBus: bus,
			runState: createRunState("timeout-heartbeat", "/tmp/timeout.dot", { runsDir: testRunsDir }),
		});

		await expect(engine.run()).rejects.toThrow();

		const records = engine.getRecords();
		const stuckRecords = records.filter((r) => r.nodeId === "stuck");
		expect(stuckRecords.length).toBeGreaterThanOrEqual(1);
		expect(stuckRecords.every((r) => r.status === StageStatus.Failed)).toBe(true);
		expect(events.some((event) => event.kind === "pipeline.heartbeat" && event.nodeId === "stuck")).toBe(true);
	});

	it("sets nodeStartedAt on runState before node execution (regression: reaper stale detection)", async () => {
		const graph = parse(`
			digraph node_started_at_test {
				start [shape=Mdiamond]
				fast [type="tool" label="Fast tool"]
				done [shape=Msquare]
				start -> fast -> done
			}
		`);

		const registry = new HandlerRegistry();
		registry.register("tool", new OkHandler());

		const runState = createRunState("node-started-at-test", "/tmp/node-started-at.dot", { runsDir: testRunsDir });
		const engine = new Engine(graph, registry, {
			context: new Context(),
			runState,
		});

		await engine.run();

		// nodeStartedAt must be set so the stale-run reaper can detect stuck nodes
		expect(runState.nodeStartedAt).toBeDefined();
		expect(runState.nodeStartedAt).not.toBe("");
		// It should be a valid ISO date
		expect(Number.isNaN(new Date(runState.nodeStartedAt!).getTime())).toBe(false);
	});

	it("does not timeout nodes without timeout attribute", async () => {
		const graph = parse(`
			digraph no_timeout {
				start [shape=Mdiamond]
				fast [type="tool" label="Fast tool"]
				done [shape=Msquare]
				start -> fast -> done
			}
		`);

		const registry = new HandlerRegistry();
		registry.register("tool", new OkHandler());

		const engine = new Engine(graph, registry, { context: new Context() });

		// Should complete without timeout
		await engine.run();

		const records = engine.getRecords();
		expect(records.some((r) => r.nodeId === "fast" && r.status === StageStatus.Completed)).toBe(
			true,
		);
	});

	it("classifies pipeline composite child timeout as child_timeout", async () => {
		const childPath = join(testRoot, "child-timeout.dot");
		writeFileSync(
			childPath,
			`digraph child_timeout {
				start [shape=Mdiamond]
				slow [type="tool" prompt="sleep 2" timeout="1s" governance="reversible" tool_id="shell" action_id="file.write"]
				done [shape=Msquare]
				start -> slow
				slow -> done [condition="outcome=success"]
			}`,
			"utf-8",
		);

		const parent = parse(`
			digraph parent_pipeline_timeout {
				start [shape=Mdiamond]
				child [type="pipeline" pipeline="${childPath}" export_keys="result"]
				done [shape=Msquare]
				start -> child
				child -> done [condition="outcome=fail"]
			}
		`);
		const registry = new HandlerRegistry();
		registry.register("pipeline", new PipelineHandler({
			modelRegistry: {} as any,
			authStorage: {} as any,
			resourceLoader: {} as any,
			defaultModel: "test-model",
			defaultProvider: "test-provider",
			workDir: testRoot,
			runState: createRunState("parent-composite-timeout", join(testRoot, "parent.dot"), { runsDir: testRunsDir }),
		} as any));
		const engine = new Engine(parent, registry, { context: new Context({ result: "parent" }) });

		await engine.run();
		const end = engine.getContext();
		expect(end.get("__composite_reason")).toBe("child_timeout");
		expect(end.get("__composite_export_writeback_status")).toBe("skipped");
	});

	it("classifies fan_out.dynamic composite child timeout as child_timeout", async () => {
		const childPath = join(testRoot, "fan-child-timeout.dot");
		writeFileSync(
			childPath,
			`digraph fan_child_timeout {
				start [shape=Mdiamond]
				slow [type="tool" prompt="sleep 2" timeout="1s" governance="reversible" tool_id="shell" action_id="file.write"]
				done [shape=Msquare]
				start -> slow
				slow -> done [condition="outcome=success"]
			}`,
			"utf-8",
		);

		const parent = parse(`
			digraph parent_fan_timeout {
				start [shape=Mdiamond]
				fan [type="fan_out.dynamic" source_key="items" item_key="item" template="${childPath}" max_concurrency="1"]
				done [shape=Msquare]
				start -> fan
				fan -> done [condition="outcome=fail"]
			}
		`);
		const registry = new HandlerRegistry();
		registry.register("fan_out.dynamic", new DynamicFanOutHandler({
			modelRegistry: {} as any,
			authStorage: {} as any,
			resourceLoader: {} as any,
			defaultModel: "test-model",
			defaultProvider: "test-provider",
			workDir: testRoot,
			runState: createRunState("parent-fan-timeout", join(testRoot, "parent-fan.dot"), { runsDir: testRunsDir }),
			graph: parent,
		} as any));
		const engine = new Engine(parent, registry, { context: new Context({ items: JSON.stringify(["a"]) }) });

		await engine.run();
		const end = engine.getContext();
		expect(end.get("__composite_reason")).toBe("child_timeout");
		expect(end.get("__fan_out_failure_index")).toBe("0");
	});

	it("halts when an irreversible tool node fails and only an unconditional edge exists", async () => {
		const graph = parse(`
			digraph tool_fail_open_guard {
				start [shape=Mdiamond]
				broken [type="tool" governance="irreversible" label="Broken tool"]
				done [shape=Msquare]
				start -> broken -> done
			}
		`);

		const registry = new HandlerRegistry();
		registry.register("tool", {
			async execute(): Promise<Outcome> {
				return {
					status: StageStatus.Failed,
					output: "",
					error: "tool failed",
				};
			},
		});

		const engine = new Engine(graph, registry, { context: new Context() });

		await expect(engine.run()).rejects.toThrow(/failed with no fail branch/i);
	});

	it("halts when fan_out.dynamic fails and only an unconditional edge exists", async () => {
		const graph = parse(`
			digraph fan_fail_open_guard {
				start [shape=Mdiamond]
				fan [type="fan_out.dynamic" source_key="items" item_key="item" template="/tmp/unused.dot"]
				done [shape=Msquare]
				start -> fan -> done
			}
		`);

		const registry = new HandlerRegistry();
		registry.register("fan_out.dynamic", {
			async execute(): Promise<Outcome> {
				return {
					status: StageStatus.Failed,
					output: "",
					error: "fan_out failed",
				};
			},
		});

		const engine = new Engine(graph, registry, {
			context: new Context({ items: JSON.stringify(["a"]) }),
		});

		await expect(engine.run()).rejects.toThrow(/failed with no fail branch/i);
	});

	it("continues past a failed pipeline node when fail_open=true", async () => {
		const graph = parse(`
			digraph pipeline_fail_open {
				start [shape=Mdiamond]
				child [type="pipeline" pipeline="/tmp/nonexistent.dot" fail_open="true"]
				done [shape=Msquare]
				start -> child -> done
			}
		`);

		const registry = new HandlerRegistry();
		registry.register("pipeline", {
			async execute(): Promise<Outcome> {
				return {
					status: StageStatus.Failed,
					output: "",
					error: "child pipeline timed out",
				};
			},
		});

		const engine = new Engine(graph, registry, { context: new Context() });
		await engine.run();
		// Engine completed without throwing — verify the child node was recorded as failed
		const childRecord = engine.getRecords().find((r) => r.nodeId === "child");
		expect(childRecord?.status).toBe(StageStatus.Failed);
	});

	it("continues past a throwing handler when fail_open=true", async () => {
		const graph = parse(`
			digraph throwing_fail_open {
				start [shape=Mdiamond]
				child [type="pipeline" pipeline="/tmp/nonexistent.dot" fail_open="true"]
				done [shape=Msquare]
				start -> child -> done
			}
		`);

		const registry = new HandlerRegistry();
		registry.register("pipeline", {
			async execute(): Promise<Outcome> {
				throw new Error("Cannot find module '/tmp/nonexistent.dot'");
			},
		});

		const engine = new Engine(graph, registry, { context: new Context() });
		// When fail_open=true, a thrown exception should NOT crash the pipeline.
		// It should be caught and converted to a Failed outcome.
		await engine.run();
		const childRecord = engine.getRecords().find((r) => r.nodeId === "child");
		expect(childRecord?.status).toBe(StageStatus.Failed);
	});

	it("records a returned failed outcome as a failed stage record", async () => {
		const graph = parse(`
			digraph returned_failed_outcome {
				start [shape=Mdiamond]
				broken [type="tool" label="Broken tool"]
				done [shape=Msquare]
				start -> broken
				broken -> done [condition="outcome=fail"]
			}
		`);

		const registry = new HandlerRegistry();
		registry.register("tool", {
			async execute(): Promise<Outcome> {
				return {
					status: StageStatus.Failed,
					output: "",
					error: "tool failed",
				};
			},
		});

		const engine = new Engine(graph, registry, { context: new Context() });

		await engine.run();

		const broken = engine.getRecords().find((record) => record.nodeId === "broken");
		expect(broken?.status).toBe(StageStatus.Failed);
		expect(broken?.outcome?.status).toBe(StageStatus.Failed);
	});

	it("abort signal from engine timeout is forwarded to handler so the handler can cancel its own work", async () => {
		// This is the regression test for the codergen signal-forwarding bug (#2048).
		// Previously CodergenHandler ignored its _signal parameter, so the underlying
		// session.prompt() kept running even after the engine's timeout race resolved.
		// Any handler that receives signal must be able to observe it going abort.
		let receivedSignal: AbortSignal | undefined;

		const registry = new HandlerRegistry();
		registry.register("codergen", {
			async execute(signal: AbortSignal): Promise<Outcome> {
				receivedSignal = signal;
				// Never resolves — simulates a hung LLM call
				return new Promise<Outcome>(() => {});
			},
		});

		const graph = parse(`
			digraph codergen_signal_regression {
				start [shape=Mdiamond]
				drafter [type="codergen" timeout="100ms" label="Draft issue spec"]
				done [shape=Msquare]
				start -> drafter -> done
			}
		`);

		const engine = new Engine(graph, registry, { context: new Context() });

		await expect(engine.run()).rejects.toThrow(/timed out/i);

		// The handler must have been called and must have received the signal.
		expect(receivedSignal).toBeDefined();
		// After the timeout fires, the signal passed to the handler must be aborted
		// so that the handler (e.g. CodergenHandler) can call session.abort().
		expect(receivedSignal!.aborted).toBe(true);
	});
});
