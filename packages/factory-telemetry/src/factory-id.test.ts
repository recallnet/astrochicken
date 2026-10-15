import { describe, expect, it, vi } from "vitest";

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { emitOtelEvent, flushOtelRuntime, shutdownOtelRuntime } from "./otel-stdout.js";
import { createLangfuseTelemetry, type LangfuseSpanEnvelope, type LangfuseTelemetryTransport } from "./telemetry/langfuse.js";

class CaptureTransport implements LangfuseTelemetryTransport {
	readonly spans: LangfuseSpanEnvelope[] = [];
	async emitBatch(spans: LangfuseSpanEnvelope[]): Promise<void> {
		this.spans.push(...spans);
	}
	async shutdown(): Promise<void> {}
}

describe("factory_id telemetry propagation", () => {
	it("adds factory_id to langfuse span metadata", async () => {
		const transport = new CaptureTransport();
		const telemetry = createLangfuseTelemetry({
			env: {
				LANGFUSE_PUBLIC_KEY: "pk-test",
				LANGFUSE_SECRET_KEY: "sk-test",
			},
			transport,
			runId: "run-1",
			graphName: "graph-a",
			pipelineFile: "factories/mothership/graphs/test.dot",
			getRunContext: () => ({
				factory_id: "mothership",
				factory: "mothership",
				repo: "recallnet/astrochicken",
			}),
		});
		if (!telemetry) throw new Error("expected telemetry instance");

		telemetry.eventHandler({
			kind: "stage.finish",
			timestamp: new Date("2026-01-01T00:00:00.000Z"),
			nodeId: "tool_node",
			data: {
				handler_type: "tool",
				attempt: "1",
			},
		});

		await telemetry.shutdown();
		expect(transport.spans.length).toBeGreaterThan(0);
		const span = transport.spans[0];
		expect(span.metadata.factory_id).toBe("mothership");
		expect(span.metadata["hatch.factory_id"]).toBe("mothership");
		expect(span.metadata["factory.factory_id"]).toBe("mothership");
	});

	it("exports factory_id as an OTLP log attribute", async () => {
		const payloads: any[] = [];
		const server = createServer((request, response) => {
			let body = "";
			request.on("data", (chunk) => { body += chunk.toString(); });
			request.on("end", () => {
				payloads.push(JSON.parse(body));
				response.writeHead(200, { "content-type": "application/json" });
				response.end("{}");
			});
		});
		await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
		const originalMode = process.env.OTEL_MODE;
		const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
		try {
			process.env.OTEL_MODE = "otlp";
			process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/logs`;
			emitOtelEvent({ event_name: "factory.test", attributes: { factory_id: "external" } });
			await flushOtelRuntime();
			expect(payloads).toHaveLength(1);
			const attrs = payloads[0].resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
			expect(attrs.some((entry: any) => entry.key === "factory_id" && entry.value.stringValue === "external")).toBe(true);
		} finally {
			await shutdownOtelRuntime();
			if (originalMode === undefined) delete process.env.OTEL_MODE;
			else process.env.OTEL_MODE = originalMode;
			if (originalEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
			else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
			await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); });
		}
	});
});
