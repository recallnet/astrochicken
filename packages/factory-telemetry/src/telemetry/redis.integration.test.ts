import { afterEach, describe, expect, it, vi } from "vitest";

import { InMemoryRedisHarness } from "./redis-test-harness.js";
import {
	REDIS_FACTORY_INDEX_KEY,
	createRedisTelemetrySink,
	discoverRedisFactories,
	readRedisEvents,
	redisEventStreamKey,
	resolveRedisTelemetryConfig,
} from "./redis.js";

import type { Event } from "../events.js";

function lifecycleEvent(overrides: Partial<Event> = {}): Event {
	return {
		kind: "stage.finish",
		timestamp: overrides.timestamp ?? new Date("2026-03-14T22:00:00.000Z"),
		nodeId: overrides.nodeId ?? "run",
		message: overrides.message,
		data: {
			run_id: "run-1",
			graph: "wave_execute",
			node: overrides.nodeId ?? "run",
			...(overrides.data || {}),
		},
	};
}

describe("redis telemetry sink", () => {
	afterEach(() => {
		delete (globalThis as any).__HATCH_REDIS_TEST_CLIENT_FACTORY;
	});
	it("creates no-op sink when redis is unset", async () => {
		const sinkConfig = resolveRedisTelemetryConfig({
			env: {},
			identity: { factoryId: "mothership", hostId: "host-a" },
		});
		expect(sinkConfig).toBeNull();

		const result = await createRedisTelemetrySink(sinkConfig);
		expect(result.enabled).toBe(false);
		expect(result.reason).toBe("no_config");
		expect(result.streamKey).toBe(redisEventStreamKey({ factoryId: "", hostId: "" }));
		await expect(result.sink.flush()).resolves.toBeUndefined();
	});

	it("does not initialize redis client when config is unset", async () => {
		const factory = vi.fn(() => new InMemoryRedisHarness());
		(globalThis as any).__HATCH_REDIS_TEST_CLIENT_FACTORY = factory;
		const result = await createRedisTelemetrySink(null);
		expect(result.enabled).toBe(false);
		expect(result.reason).toBe("no_config");
		expect(factory).not.toHaveBeenCalled();
	});

	it("namespaces stream keys per factory + host and keeps a discoverable index", async () => {
		const redis = new InMemoryRedisHarness();
		const a = await createRedisTelemetrySink({
			redisUrl: "redis://local",
			identity: { factoryId: "mothership", hostId: "host-a" },
			client: redis,
		});
		const b = await createRedisTelemetrySink({
			redisUrl: "redis://local",
			identity: { factoryId: "example-trading", hostId: "host-b" },
			client: redis,
		});
		expect(a.enabled).toBe(true);
		expect(b.enabled).toBe(true);
		expect(a.streamKey).not.toBe(b.streamKey);
		expect(a.streamKey).toContain(":mothership:host-a:events");
		expect(b.streamKey).toContain(":example-trading:host-b:events");

		a.sink.emit(lifecycleEvent({ data: { run_id: "run-a", graph: "goal_run" } }));
		b.sink.emit(lifecycleEvent({ data: { run_id: "run-b", graph: "goal_run" } }));
		await a.sink.flush();
		await b.sink.flush();

		const indexRows = await redis.smembers(REDIS_FACTORY_INDEX_KEY);
		expect(indexRows.length).toBeGreaterThanOrEqual(2);
		const discovered = await discoverRedisFactories(redis);
		expect(discovered.some((entry) => entry.factoryId === "mothership" && entry.hostId === "host-a")).toBe(true);
		expect(discovered.some((entry) => entry.factoryId === "example-trading" && entry.hostId === "host-b")).toBe(true);

		const streamA = await readRedisEvents(redis, { key: a.streamKey });
		const streamB = await readRedisEvents(redis, { key: b.streamKey });
		expect(streamA).toHaveLength(1);
		expect(streamB).toHaveLength(1);
		expect((streamA[0]?.event as any)?.data?.run_id).toBe("run-a");
		expect((streamB[0]?.event as any)?.data?.run_id).toBe("run-b");
	});

	it("supports blocking xread for real-time consumers in order", async () => {
		const redis = new InMemoryRedisHarness();
		const result = await createRedisTelemetrySink({
			redisUrl: "redis://local",
			identity: { factoryId: "mothership", hostId: "host-a" },
			client: redis,
		});
		expect(result.enabled).toBe(true);

		const reader1 = redis.xread({
			streams: [{ key: result.streamKey, id: "0-0" }],
			blockMs: 500,
			count: 1,
		});
		result.sink.emit(lifecycleEvent({ data: { run_id: "run-1", graph: "goal_run", node: "start" } }));
		await result.sink.flush();
		const rows1 = await reader1;
		expect(rows1).toHaveLength(1);
		const firstEntry = rows1[0]?.entries?.[0];
		expect(firstEntry).toBeDefined();
		const firstPayload = JSON.parse(String(firstEntry?.fields.payload || "{}"));
		expect(firstPayload?.event?.data?.node).toBe("start");

		const reader2 = redis.xread({
			streams: [{ key: result.streamKey, id: firstEntry?.id || "0-0" }],
			blockMs: 500,
			count: 1,
		});
		result.sink.emit(lifecycleEvent({ data: { run_id: "run-1", graph: "goal_run", node: "review" } }));
		await result.sink.flush();
		const rows2 = await reader2;
		expect(rows2).toHaveLength(1);
		const secondPayload = JSON.parse(String(rows2[0]?.entries?.[0]?.fields.payload || "{}"));
		expect(secondPayload?.event?.data?.node).toBe("review");
	});

	it("fails open on startup/connect failure", async () => {
		const warnings: string[] = [];
		(globalThis as any).__HATCH_REDIS_TEST_CLIENT_FACTORY = () => {
			throw new Error("connect refused");
		};
		const failed = await createRedisTelemetrySink({
			redisUrl: "redis://broken",
			identity: { factoryId: "mothership", hostId: "host-a" },
			warn: (message) => warnings.push(message),
		});
		expect(failed.enabled).toBe(false);
		expect(failed.reason).toBe("startup_failure");
		expect(warnings.some((line) => line.includes("startup failure"))).toBe(true);
	});

	it("drops after bounded mid-run failures and emit remains non-throwing", async () => {
		const warnings: string[] = [];
		const redis = new InMemoryRedisHarness({ failAfterWrites: 1 });
		const result = await createRedisTelemetrySink({
			redisUrl: "redis://local",
			identity: { factoryId: "mothership", hostId: "host-a" },
			client: redis,
			warn: (message) => warnings.push(message),
			failurePolicy: { maxDroppedEvents: 2 },
		});
		expect(result.enabled).toBe(true);

		expect(() => result.sink.emit(lifecycleEvent({ data: { run_id: "run-1" } }))).not.toThrow();
		expect(() => result.sink.emit(lifecycleEvent({ data: { run_id: "run-2" } }))).not.toThrow();
		expect(() => result.sink.emit(lifecycleEvent({ data: { run_id: "run-3" } }))).not.toThrow();
		await result.sink.flush();

		const rows = await readRedisEvents(redis, { key: result.streamKey });
		expect(rows.length).toBe(1);
		expect((rows[0]?.event as any)?.data?.run_id).toBe("run-1");
		expect(warnings.some((line) => line.includes("write failure"))).toBe(true);
		expect(warnings.some((line) => line.includes("disabled after dropped events exceeded"))).toBe(true);
	});
});
