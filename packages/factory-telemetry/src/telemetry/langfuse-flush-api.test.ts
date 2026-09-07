import { describe, expect, it } from "vitest";

import { createLangfuseTelemetry, type LangfuseSpanEnvelope, type LangfuseTelemetryTransport } from "./langfuse.js";

import type { Event } from "../events.js";

class InMemoryTransport implements LangfuseTelemetryTransport {
	public readonly batches: LangfuseSpanEnvelope[][] = [];
	public shutdownCalls = 0;
	public releaseFirstBatch: (() => void) | null = null;
	public blockFirstBatch = false;
	private emitCalls = 0;

	async emitBatch(spans: LangfuseSpanEnvelope[]): Promise<void> {
		this.emitCalls += 1;
		if (this.blockFirstBatch && this.emitCalls === 1) {
			await new Promise<void>((resolve) => {
				this.releaseFirstBatch = resolve;
			});
		}
		this.batches.push(spans);
	}
	async shutdown(): Promise<void> {
		this.shutdownCalls += 1;
	}
}

function event(kind: Event["kind"], fields: Partial<Event> = {}): Event {
	return {
		kind,
		timestamp: fields.timestamp ?? new Date("2026-03-06T12:00:00.000Z"),
		nodeId: fields.nodeId,
		edgeFrom: fields.edgeFrom,
		edgeTo: fields.edgeTo,
		message: fields.message,
		data: fields.data,
		error: fields.error,
		intent: fields.intent,
	};
}

describe("langfuse telemetry flush api", () => {
	it("exposes explicit flush() before shutdown for runtime durability boundaries", async () => {
		const transport = new InMemoryTransport();
		const telemetry = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
				HATCH_LANGFUSE_BATCH_SIZE: "100",
			},
			runId: "flush-run",
			graphName: "flush_graph",
			pipelineFile: "flush.dot",
			transport,
		});
		expect(telemetry).toBeTruthy();

		telemetry!.eventHandler(event("stage.finish", { nodeId: "n1", message: "ok" }));
		expect(transport.batches.flat()).toHaveLength(0);

		await telemetry!.flush();
		expect(transport.batches.flat()).toHaveLength(1);

		await telemetry!.shutdown();
		expect(transport.shutdownCalls).toBe(1);
	});

	it("waits for an in-flight flush before shutdown completes", async () => {
		const transport = new InMemoryTransport();
		transport.blockFirstBatch = true;
		const telemetry = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
				HATCH_LANGFUSE_BATCH_SIZE: "1",
			},
			runId: "flush-race",
			graphName: "flush_graph",
			pipelineFile: "flush.dot",
			transport,
		});
		expect(telemetry).toBeTruthy();

		telemetry!.eventHandler(event("stage.finish", { nodeId: "n1", message: "ok" }));
		await Promise.resolve();
		const shutdownPromise = telemetry!.shutdown();
		await Promise.resolve();
		expect(transport.batches.flat()).toHaveLength(0);
		transport.releaseFirstBatch?.();
		await shutdownPromise;
		expect(transport.batches.flat()).toHaveLength(1);
		expect(transport.shutdownCalls).toBe(1);
	});

	it("coalesces concurrent flush callers onto the same in-flight drain", async () => {
		const transport = new InMemoryTransport();
		transport.blockFirstBatch = true;
		const telemetry = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
				HATCH_LANGFUSE_BATCH_SIZE: "1",
			},
			runId: "flush-concurrent",
			graphName: "flush_graph",
			pipelineFile: "flush.dot",
			transport,
		});
		expect(telemetry).toBeTruthy();

		telemetry!.eventHandler(event("stage.finish", { nodeId: "n1", message: "ok" }));
		await Promise.resolve();
		const flushA = telemetry!.flush();
		const flushB = telemetry!.flush();
		await Promise.resolve();
		expect(transport.batches.flat()).toHaveLength(0);
		transport.releaseFirstBatch?.();
		await Promise.all([flushA, flushB]);
		expect(transport.batches.flat()).toHaveLength(1);
		await telemetry!.shutdown();
	});
});
