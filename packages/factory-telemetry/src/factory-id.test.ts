import { describe, expect, it, vi } from "vitest";

import { emitOtelEvent } from "./otel-stdout.js";
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

	it("adds factory_id to otel resource attributes", async () => {
		const originalMode = process.env.OTEL_MODE;
		const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		const originalFetch = globalThis.fetch;
		(globalThis as any).fetch = fetchMock;
		process.env.OTEL_MODE = "otlp";
		process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otel.example/v1/logs";

		emitOtelEvent({
			event_name: "factory.test",
			attributes: { factory_id: "external" },
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		const resourceAttrs = body.resourceLogs[0].resource.attributes as Array<{ key: string; value: { stringValue: string } }>;
		expect(resourceAttrs.some((entry) => entry.key === "factory.id" && entry.value.stringValue === "external")).toBe(true);

		if (originalMode === undefined) delete process.env.OTEL_MODE;
		else process.env.OTEL_MODE = originalMode;
		if (originalEndpoint === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
		else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
		(globalThis as any).fetch = originalFetch;
	});
});
