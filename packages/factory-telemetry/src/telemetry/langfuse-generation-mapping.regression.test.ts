import { describe, expect, it, vi } from "vitest";

const {
	langfuseCtorMock,
	traceMock,
	generationMock,
	spanMock,
	flushAsyncMock,
	shutdownAsyncMock,
} = vi.hoisted(() => {
	const generationMock = vi.fn();
	const spanMock = vi.fn();
	const traceMock = vi.fn(() => ({
		generation: generationMock,
		span: spanMock,
	}));
	const flushAsyncMock = vi.fn(async () => {});
	const shutdownAsyncMock = vi.fn(async () => {});
	const langfuseCtorMock = vi.fn(() => ({
		trace: traceMock,
		flushAsync: flushAsyncMock,
		shutdownAsync: shutdownAsyncMock,
	}));
	return {
		langfuseCtorMock,
		traceMock,
		generationMock,
		spanMock,
		flushAsyncMock,
		shutdownAsyncMock,
	};
});

vi.mock("langfuse", () => ({
	Langfuse: langfuseCtorMock,
}));

import { createLangfuseTelemetry } from "./langfuse.js";
import { buildLangfuseGenerationPayload, isLangfuseGenerationSpan } from "./langfuse-generation-payload.js";

describe("langfuse generation mapping", () => {
	it("exports generation payload helpers for coverage guard", () => {
		const isGeneration = isLangfuseGenerationSpan({
			traceId: "t",
			traceName: "trace",
			sessionId: "s",
			spanId: "sp",
			spanName: "span",
			timestamp: new Date("2026-03-17T21:00:00.000Z"),
			tags: [],
			metadata: { "hatch.event_kind": "telemetry.langfuse.generation" },
		});
		expect(isGeneration).toBe(true);

		const payload = buildLangfuseGenerationPayload(
			{
				traceId: "t",
				traceName: "trace",
				sessionId: "s",
				spanId: "sp",
				spanName: "span",
				timestamp: new Date("2026-03-17T21:00:00.000Z"),
				tags: [],
				metadata: {
					langfuse_model: "anthropic/claude-sonnet-4.6",
					langfuse_provider: "openrouter",
					langfuse_tokens_total: "10",
					langfuse_cost_total: "0.01",
				},
			},
			{ id: "sp", name: "span" },
		);
		expect(payload.model).toBe("anthropic/claude-sonnet-4.6");
		expect((payload as any).usage?.totalCost).toBe(0.01);
	});

	it("sends telemetry.langfuse.generation as Langfuse generation with model + non-zero cost", async () => {
		const telemetry = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
			},
			runId: "run-supervisor-review",
			graphName: "factory_supervisor_tick",
			pipelineFile: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
		});
		expect(telemetry).toBeTruthy();

		telemetry!.eventHandler({
			kind: "telemetry.langfuse.generation",
			timestamp: new Date("2026-03-17T21:00:00.000Z"),
			nodeId: "supervisor_review",
			data: {
				langfuse_type: "generation",
				langfuse_trace_id: "lf_trace_supervisor_review",
				langfuse_handler_type: "stack.manager_loop",
				handler_type: "stack.manager_loop",
				langfuse_skill: "supervisor.review",
				skill: "supervisor.review",
				langfuse_provider: "openrouter",
				provider: "openrouter",
				langfuse_model: "anthropic/claude-sonnet-4.6",
				model: "anthropic/claude-sonnet-4.6",
				langfuse_tokens_input: "100",
				langfuse_tokens_output: "50",
				langfuse_tokens_total: "150",
				langfuse_cost_total: "0.42",
			},
		});

		await telemetry!.flush();
		await telemetry!.shutdown();

		expect(langfuseCtorMock).toHaveBeenCalledTimes(1);
		expect(traceMock).toHaveBeenCalled();
		expect(generationMock).toHaveBeenCalled();
		expect(flushAsyncMock).toHaveBeenCalled();
		expect(shutdownAsyncMock).toHaveBeenCalled();

		const generationPayload = generationMock.mock.calls[0]?.[0] as Record<string, any>;
		expect(generationPayload.model).toBe("anthropic/claude-sonnet-4.6");
		expect(generationPayload.modelParameters?.provider).toBe("openrouter");
		expect(generationPayload.usage?.totalCost).toBe(0.42);
		expect(generationPayload.usage?.total).toBe(150);
		expect(generationPayload.costDetails?.total).toBe(0.42);
		expect(spanMock).not.toHaveBeenCalled();
	});
});
