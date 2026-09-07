import { EventBus, type Event } from "@recallnet/factory-telemetry";
import {
	bindLangfuseLifecycleTelemetry,
	LANGFUSE_FLUSH_EVENT_KIND,
	type LangfuseFlushRequest,
	type LangfuseRetryRequest,
} from "@recallnet/factory-telemetry";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Context } from "./context.js";
import { StageStatus } from "./context.js";
import { Engine, HandlerRegistry, type Handler } from "./engine.js";
import { parse } from "./parse.js";

import type { Outcome } from "./context.js";
import type { Node } from "./graph.js";

class SlowHandler implements Handler {
	constructor(private delayMs: number) {}

	async execute(_signal: AbortSignal, _node: Node, _ctx: Context, _input: string): Promise<Outcome> {
		await new Promise((resolve) => setTimeout(resolve, this.delayMs));
		return { status: StageStatus.Completed, output: "ok" };
	}
}

describe("langfuse lifecycle serve heartbeat", () => {
	afterEach(() => {
		delete process.env.HATCH_RUN_HEARTBEAT_MS;
		delete process.env.HATCH_LANGFUSE_HEARTBEAT_FLUSH_EVERY;
	});

	it("fires heartbeat-triggered flushes without runState using __run_id context", async () => {
		process.env.HATCH_RUN_HEARTBEAT_MS = "20";
		process.env.HATCH_LANGFUSE_HEARTBEAT_FLUSH_EVERY = "1";
		const graph = parse(`
			digraph serve_heartbeat {
				start [shape=Mdiamond]
				slow [type="tool"]
				done [shape=Msquare]
				start -> slow -> done
			}
		`);
		const registry = new HandlerRegistry();
		registry.register("tool", new SlowHandler(120));
		const bus = new EventBus();
		const events: Event[] = [];
		bus.on((event) => events.push(event));
		const flushCalls: LangfuseFlushRequest[] = [];
		const retryCalls: LangfuseRetryRequest[] = [];
		const binding = bindLangfuseLifecycleTelemetry({
			eventBus: bus,
			ctx: new Context({ __run_id: "serve-run" }),
			emitter: {
				flush: vi.fn(async (request: LangfuseFlushRequest) => {
					flushCalls.push(request);
				}),
				retry: vi.fn(async (request: LangfuseRetryRequest) => {
					retryCalls.push(request);
				}),
			},
			flushTimeoutMs: 100,
			retryTimeoutMs: 100,
		});

		const engine = new Engine(graph, registry, {
			eventBus: bus,
			context: new Context({ __run_id: "serve-run" }),
		});
		await engine.run();
		await binding.waitForIdle();

		expect(events.some((event) => event.kind === "pipeline.heartbeat")).toBe(true);
		expect(flushCalls.some((call) => call.trigger === "heartbeat")).toBe(true);
		expect(flushCalls.some((call) => call.runId === "serve-run")).toBe(true);
		expect(events.some((event) => event.kind === LANGFUSE_FLUSH_EVENT_KIND && event.message === "heartbeat")).toBe(true);
		expect(retryCalls).toHaveLength(0);
	});
});
