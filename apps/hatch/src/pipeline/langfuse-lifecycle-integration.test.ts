import { EventBus, type Event } from "@recallnet/factory-telemetry";
import {
	bindLangfuseLifecycleTelemetry,
	LANGFUSE_FLUSH_EVENT_KIND,
	LANGFUSE_RETRY_EVENT_KIND,
	type LangfuseFlushRequest,
	type LangfuseRetryRequest,
} from "@recallnet/factory-telemetry";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Context, StageStatus, type Outcome } from "./context.js";
import { Engine, HandlerRegistry, type Handler } from "./engine.js";
import { parse } from "./parse.js";
import { createRunState } from "./run.js";

import type { Node } from "./graph.js";



class LongHandler implements Handler {
	constructor(private delayMs = 140) {}

	async execute(signal: AbortSignal, _node: Node, _ctx: Context, _input: string): Promise<Outcome> {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => resolve(), this.delayMs);
			signal.addEventListener("abort", () => {
				clearTimeout(timer);
				reject(new Error("aborted"));
			});
		});
		return { status: StageStatus.Completed, output: "long ok" };
	}
}

class Emitter {
	flushCalls: LangfuseFlushRequest[] = [];
	retryCalls: LangfuseRetryRequest[] = [];
	flush = vi.fn(async (request: LangfuseFlushRequest) => {
		this.flushCalls.push(request);
	});
	retry = vi.fn(async (request: LangfuseRetryRequest) => {
		this.retryCalls.push(request);
	});
}

describe("langfuse lifecycle integration", () => {
	afterEach(() => {
		delete process.env.HATCH_RUN_HEARTBEAT_MS;
		delete process.env.HATCH_LANGFUSE_HEARTBEAT_FLUSH_EVERY;
	});
	it("wires heartbeat + suspend hooks into lifecycle flush without blocking execution", async () => {
		process.env.HATCH_RUN_HEARTBEAT_MS = "20";
		process.env.HATCH_LANGFUSE_HEARTBEAT_FLUSH_EVERY = "1";
		const graph = parse(`
			digraph long_life {
				start [shape=Mdiamond]
				heavy [type="tool"]
				done [shape=Msquare]
				start -> heavy -> done
			}
		`);
		const registry = new HandlerRegistry();
		registry.register("tool", new LongHandler(180));

		const bus = new EventBus();
		const events: Event[] = [];
		bus.on((event) => events.push(event));

		const ctx = new Context({ __run_id: "run-long" });
		const emitter = new Emitter();
		const binding = bindLangfuseLifecycleTelemetry({
			eventBus: bus,
			ctx,
			emitter,
			flushTimeoutMs: 100,
			retryTimeoutMs: 100,
		});

		const engine = new Engine(graph, registry, {
			eventBus: bus,
			context: ctx,
			runState: createRunState("run-long", "/tmp/long.dot"),
		});
		const runStart = Date.now();
		await engine.run();
		const runDuration = Date.now() - runStart;
		engine.suspend();
		await binding.waitForIdle();

		expect(runDuration).toBeLessThan(2500);
		expect(emitter.flushCalls.some((call) => call.trigger === "heartbeat")).toBe(true);
		expect(emitter.flushCalls.some((call) => call.trigger === "finish")).toBe(true);
		expect(emitter.flushCalls.some((call) => call.trigger === "suspend")).toBe(true);
		expect(events.some((event) => event.kind === "pipeline.heartbeat")).toBe(true);
		expect(events.some((event) => event.kind === "pipeline.finish")).toBe(true);
		expect(events.some((event) => event.kind === "pipeline.suspend")).toBe(true);
		expect(events.some((event) => event.kind === LANGFUSE_FLUSH_EVENT_KIND)).toBe(true);
		expect(events.some((event) => event.kind === LANGFUSE_RETRY_EVENT_KIND)).toBe(false);
	}, 10_000);
});
