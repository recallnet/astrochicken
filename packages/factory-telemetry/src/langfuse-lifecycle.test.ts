import { afterEach, describe, expect, it, vi } from "vitest";

import { EventBus, type Event } from "./events.js";
import {
	bindLangfuseLifecycleTelemetry,
	LANGFUSE_FLUSH_EVENT_KIND,
	LANGFUSE_RETRY_EVENT_KIND,
	type LangfuseFlushRequest,
	type LangfuseRetryRequest,
} from "./langfuse-lifecycle.js";

class StubEmitter {
	flushCalls: LangfuseFlushRequest[] = [];
	retryCalls: LangfuseRetryRequest[] = [];
	constructor(
		private behavior: {
			flush?: (req: LangfuseFlushRequest, call: number) => Promise<void>;
			retry?: (req: LangfuseRetryRequest, call: number) => Promise<void>;
		} = {},
	) {}

	async flush(req: LangfuseFlushRequest): Promise<void> {
		this.flushCalls.push(req);
		if (!this.behavior.flush) return;
		await this.behavior.flush(req, this.flushCalls.length);
	}

	async retry(req: LangfuseRetryRequest): Promise<void> {
		this.retryCalls.push(req);
		if (!this.behavior.retry) return;
		await this.behavior.retry(req, this.retryCalls.length);
	}
}

class MemoryContext {
	private readonly map = new Map<string, string>();

	constructor(initial: Record<string, string> = {}) {
		for (const [key, value] of Object.entries(initial)) {
			this.map.set(key, value);
		}
	}

	get(key: string): string {
		return this.map.get(key) ?? "";
	}

	set(key: string, value: string): void {
		this.map.set(key, value);
	}
}

function captureEvents(bus: EventBus): Event[] {
	const events: Event[] = [];
	bus.on((event) => events.push(event));
	return events;
}

describe("langfuse lifecycle telemetry", () => {
	afterEach(() => {
		delete process.env.HATCH_LANGFUSE_HEARTBEAT_FLUSH_EVERY;
		delete process.env.HATCH_LANGFUSE_FLUSH_TIMEOUT_MS;
		delete process.env.HATCH_LANGFUSE_RETRY_TIMEOUT_MS;
	});
	it("samples heartbeat flushes and emits deterministic flush events", async () => {
		const bus = new EventBus();
		const events = captureEvents(bus);
		const ctx = new MemoryContext({ __run_id: "run-heartbeat" });
		const emitter = new StubEmitter();
		const binding = bindLangfuseLifecycleTelemetry({
			eventBus: bus,
			ctx,
			emitter,
			heartbeatFlushEvery: 2,
			flushTimeoutMs: 100,
			retryTimeoutMs: 100,
		});

		bus.emit({ kind: "pipeline.heartbeat", nodeId: "long_node" });
		bus.emit({ kind: "pipeline.heartbeat", nodeId: "long_node" });

		await binding.waitForIdle();

		expect(emitter.flushCalls).toHaveLength(1);
		expect(emitter.flushCalls[0]?.trigger).toBe("heartbeat");
		expect(emitter.retryCalls).toHaveLength(0);
		expect(ctx.get("__langfuse_last_flush_trigger")).toBe("heartbeat");

		const flushEvents = events.filter((event) => event.kind === LANGFUSE_FLUSH_EVENT_KIND);
		expect(flushEvents.map((event) => event.data?.langfuse_lifecycle_status)).toEqual(["start", "ok"]);
		expect(flushEvents.every((event) => event.data?.agent_id === undefined)).toBe(true);
		expect(flushEvents.every((event) => event.data?.agent_role === undefined)).toBe(true);
		expect(flushEvents[0]?.data?.langfuse_flush_run_id).toBe("run-heartbeat");
		expect(flushEvents[1]?.data?.langfuse_flush_run_id).toBe("run-heartbeat");
	});

	it("logs actionable failure context and forces retry during shutdown flush path", async () => {
		const warn = vi.fn();
		const bus = new EventBus();
		const events = captureEvents(bus);
		const ctx = new MemoryContext({ __run_id: "run-shutdown" });
		const emitter = new StubEmitter({
			flush: async () => {
				throw new Error("langfuse unavailable");
			},
			retry: async () => {},
		});
		const binding = bindLangfuseLifecycleTelemetry({
			eventBus: bus,
			ctx,
			emitter,
			heartbeatFlushEvery: 10,
			flushTimeoutMs: 100,
			retryTimeoutMs: 100,
			logger: { warn },
		});

		await binding.flushNow("shutdown");
		await binding.waitForIdle();

		expect(emitter.flushCalls).toHaveLength(1);
		expect(emitter.retryCalls).toHaveLength(1);
		expect(emitter.retryCalls[0]?.trigger).toBe("retry");
		expect(ctx.get("__langfuse_retry_count")).toBe("0");
		expect(ctx.get("__langfuse_last_flush_trigger")).toBe("retry");
		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0]?.[0] || "")).toContain("trigger=shutdown");

		const flushStatuses = events
			.filter((event) => event.kind === LANGFUSE_FLUSH_EVENT_KIND)
			.map((event) => event.data?.langfuse_lifecycle_status);
		expect(flushStatuses).toEqual(["start", "fail"]);

		const retryEvents = events.filter((event) => event.kind === LANGFUSE_RETRY_EVENT_KIND);
		const retryStatuses = retryEvents.map((event) => event.data?.langfuse_lifecycle_status);
		expect(retryStatuses).toEqual(["fail", "start", "ok"]);
		expect(retryEvents[1]?.data?.langfuse_retry_run_id).toBe("run-shutdown");
		expect(retryEvents[2]?.data?.langfuse_retry_run_id).toBe("run-shutdown");
	});

	it("uses persisted retry context to continue retries after resume", async () => {
		const bus = new EventBus();
		const ctx = new MemoryContext({
			__run_id: "run-resume",
			__langfuse_retry_count: "1",
			__langfuse_retry_next_at: "0",
		});
		const emitter = new StubEmitter({
			retry: async () => {},
		});
		const binding = bindLangfuseLifecycleTelemetry({
			eventBus: bus,
			ctx,
			emitter,
			heartbeatFlushEvery: 99,
			retryTimeoutMs: 100,
		});

		bus.emit({ kind: "pipeline.heartbeat", nodeId: "resumed_node" });
		await binding.waitForIdle();

		expect(emitter.retryCalls).toHaveLength(1);
		expect(emitter.flushCalls).toHaveLength(0);
		expect(ctx.get("__langfuse_retry_count")).toBe("0");
		expect(ctx.get("__langfuse_last_flush_trigger")).toBe("retry");
	});
});
