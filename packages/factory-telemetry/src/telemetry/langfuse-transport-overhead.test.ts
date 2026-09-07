import { describe, expect, it } from "vitest";

import { createLangfuseTelemetry, type LangfuseSpanEnvelope, type LangfuseTelemetryTransport } from "./langfuse.js";

import type { Event } from "../events.js";

class InMemoryTransport implements LangfuseTelemetryTransport {
	public readonly batches: LangfuseSpanEnvelope[][] = [];
	async emitBatch(spans: LangfuseSpanEnvelope[]): Promise<void> {
		this.batches.push(spans);
	}
	async shutdown(): Promise<void> {}
}

class FlakyTransport implements LangfuseTelemetryTransport {
	public readonly batches: LangfuseSpanEnvelope[][] = [];
	public calls = 0;
	constructor(private readonly failCalls: number) {}
	async emitBatch(spans: LangfuseSpanEnvelope[]): Promise<void> {
		this.calls += 1;
		if (this.calls <= this.failCalls) throw new Error("transient transport failure");
		this.batches.push(spans);
	}
	async shutdown(): Promise<void> {}
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
		traceId: fields.traceId,
	};
}

describe("langfuse eventbus hierarchy + batching", () => {
	it("maps enriched eventbus lifecycle into session->trace->span envelopes", async () => {
		const transport = new InMemoryTransport();
		const telemetry = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
				HATCH_LANGFUSE_BATCH_SIZE: "100",
			},
			runId: "run-hierarchy",
			graphName: "wave_execute",
			pipelineFile: "wave_execute.dot",
			transport,
		});
		if (!telemetry) throw new Error("expected telemetry");

		telemetry.eventHandler(
			event("stage.start", {
				nodeId: "build",
				traceId: "builder-000001",
				data: {
					session_id: "run:run-hierarchy:handler:tool:node:build:attempt:1",
					langfuse_trace_id: "lf_trace_build_attempt_1",
					handler_type: "tool",
					attempt: "1",
					factory: "mothership",
					repo: "recallnet/astrochicken",
				},
			}),
		);
		telemetry.eventHandler(
			event("stage.finish", {
				nodeId: "build",
				traceId: "builder-000001",
				data: {
					session_id: "run:run-hierarchy:handler:tool:node:build:attempt:1",
					langfuse_trace_id: "lf_trace_build_attempt_1",
					handler_type: "tool",
					attempt: "1",
					outcome: "pass",
					factory: "mothership",
					repo: "recallnet/astrochicken",
				},
			}),
		);
		telemetry.eventHandler(
			event("parallel.fan_out", {
				nodeId: "fan",
				data: {
					handler_type: "parallel.fan_out",
					session_id: "run:run-hierarchy:handler:parallel.fan_out:node:fan:attempt:1",
					langfuse_trace_id: "lf_trace_parallel_fan_1",
					attempt: "1",
					outcome: "pass",
				},
			}),
		);
		telemetry.eventHandler(
			event("quality.signal", {
				nodeId: "build",
				data: {
					handler_type: "tool",
					session_id: "run:run-hierarchy:handler:tool:node:build:attempt:1",
					langfuse_trace_id: "lf_trace_build_attempt_1",
					attempt: "1",
					quality_outcome: "pass",
					gate_name: "quality.signal",
					gate_evidence_ref: "sha256:quality-evidence",
				},
			}),
		);
		await telemetry.shutdown();

		const spans = transport.batches.flat();
		expect(spans).toHaveLength(4);
		const stageStart = spans.find((span) => span.metadata["hatch.event_kind"] === "stage.start");
		const stageFinish = spans.find((span) => span.metadata["hatch.event_kind"] === "stage.finish");
		expect(stageStart?.sessionId).toBe(stageFinish?.sessionId);
		expect(stageStart?.traceId).toBe(stageFinish?.traceId);
		expect(stageStart?.spanName).toContain("wave_execute.dot:build:stage.start");
		expect(stageFinish?.spanName).toContain("wave_execute.dot:build:stage.finish");
		expect(stageStart?.traceName).toContain("pipeline.graph:wave_execute.dot");

		const parallel = spans.find((span) => span.metadata["hatch.event_kind"] === "parallel.fan_out");
		expect(parallel?.metadata["hatch.span_type"]).toBe("parallel");
		expect(parallel?.metadata["hatch.parallel_phase"]).toBe("fan_out");

		const quality = spans.find((span) => span.metadata["hatch.event_kind"] === "quality.signal");
		expect(quality?.metadata["hatch.span_type"]).toBe("quality_signal");
		expect(quality?.metadata.gate_name).toBe("quality.signal");
		expect(quality?.metadata.gate_evidence_ref).toBe("sha256:quality-evidence");
	});

	it("projects dashboard-ready trace names and tags for llm generation + session events", async () => {
		const transport = new InMemoryTransport();
		const telemetry = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
			},
			runId: "run-dashboard",
			graphName: "wave_execute",
			pipelineFile: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
			transport,
		});
		if (!telemetry) throw new Error("expected telemetry");

		telemetry.eventHandler(
			event("telemetry.langfuse.generation", {
				nodeId: "build",
				message: "success",
				data: {
					langfuse_type: "generation",
					langfuse_trace_id: "lf_trace_generation",
					langfuse_attempt_index: "2",
					langfuse_handler_type: "agent.worktree",
					handler_type: "agent.worktree",
					handler: "agent.worktree",
					skill: "wave.builder",
					skill_id: "wave.builder",
					langfuse_skill: "wave.builder",
					langfuse_provider: "openai",
					provider: "openai",
					langfuse_model: "openai/gpt-5.3-codex",
					model: "openai/gpt-5.3-codex",
					langfuse_outcome: "success",
					outcome: "success",
					langfuse_failure_class: "none",
					llm_path_id: "mothership.wave.execute.issue",
					factory_id: "mothership",
					factory: "mothership",
					graph_id: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
					node_id: "build",
					agent_role: "worktree.implementer",
					langfuse_tag_role: "worktree.implementer",
					"hatch.retry_class": "retry_pass",
					langfuse_tag_skill: "wave.builder",
					langfuse_tag_llm_path_id: "mothership.wave.execute.issue",
				},
			}),
		);
		telemetry.eventHandler(
			event("telemetry.langfuse.session", {
				nodeId: "review",
				message: "tool_execution_end",
				data: {
					langfuse_type: "session_event",
					langfuse_trace_id: "lf_trace_session",
					langfuse_attempt_index: "1",
					langfuse_handler_type: "agent.worktree",
					handler_type: "agent.worktree",
					handler: "agent.worktree",
					skill: "wave.reviewer",
					skill_id: "wave.reviewer",
					langfuse_skill: "wave.reviewer",
					langfuse_provider: "anthropic",
					provider: "anthropic",
					langfuse_model: "claude-sonnet-4-6",
					model: "claude-sonnet-4-6",
					langfuse_outcome: "pass",
					outcome: "pass",
					langfuse_failure_class: "guard",
					factory_id: "mothership",
					factory: "mothership",
					graph_id: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
					node_id: "review",
					agent_role: "reviewer",
					langfuse_tag_role: "reviewer",
					"hatch.retry_class": "first_pass",
				},
			}),
		);
		await telemetry.shutdown();

		const spans = transport.batches.flat();
		const generation = spans.find((span) => span.metadata["hatch.event_kind"] === "telemetry.langfuse.generation");
		const session = spans.find((span) => span.metadata["hatch.event_kind"] === "telemetry.langfuse.session");
		expect(generation?.traceName).toBe("llm.generation:wave.builder");
		expect(generation?.tags).toEqual(expect.arrayContaining([
			"factory:mothership",
			"factory_id:mothership",
			"graph:factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
			"node:build",
			"handler:agent.worktree",
			"skill:wave.builder",
			"role:worktree.implementer",
			"model:openai/gpt-5.3-codex",
			"provider:openai",
			"outcome:success",
			"retry:true",
			"retry_class:retry_pass",
			"failure_class:none",
			"llm_path_id:mothership.wave.execute.issue",
		]));
		expect(session?.traceName).toBe("llm.session:wave.reviewer");
		expect(session?.tags).toEqual(expect.arrayContaining([
			"factory:mothership",
			"factory_id:mothership",
			"graph:factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
			"node:review",
			"handler:agent.worktree",
			"skill:wave.reviewer",
			"role:reviewer",
			"model:claude-sonnet-4-6",
			"provider:anthropic",
			"outcome:pass",
			"retry:false",
			"retry_class:first_pass",
			"failure_class:guard",
		]));
	});

	it("flushes queue in deterministic batches and drops overflow without throwing", async () => {
		const transport = new InMemoryTransport();
		const telemetry = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
				HATCH_LANGFUSE_BATCH_SIZE: "2",
				HATCH_LANGFUSE_MAX_QUEUE_SIZE: "4",
				HATCH_LANGFUSE_FLUSH_INTERVAL_MS: "10000",
			},
			runId: "run-batch",
			graphName: "batch_graph",
			pipelineFile: "batch.dot",
			transport,
		});
		if (!telemetry) throw new Error("expected telemetry");

		expect(() => telemetry.eventHandler(event("stage.start", { nodeId: "a" }))).not.toThrow();
		expect(() => telemetry.eventHandler(event("stage.start", { nodeId: "b" }))).not.toThrow();
		expect(() => telemetry.eventHandler(event("stage.start", { nodeId: "c" }))).not.toThrow();
		expect(() => telemetry.eventHandler(event("stage.start", { nodeId: "d" }))).not.toThrow();
		expect(() => telemetry.eventHandler(event("stage.start", { nodeId: "e" }))).not.toThrow();

		await telemetry.flush();
		await telemetry.shutdown();

		expect(transport.batches).toHaveLength(2);
		expect(transport.batches[0]).toHaveLength(2);
		expect(transport.batches[1]).toHaveLength(2);
		expect(telemetry.stats().dropped).toBeGreaterThanOrEqual(1);
	});

	it("retries transient transport failures during flush/shutdown", async () => {
		const transport = new FlakyTransport(1);
		const telemetry = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
				HATCH_LANGFUSE_BATCH_SIZE: "1",
				HATCH_LANGFUSE_EMIT_RETRY_ATTEMPTS: "3",
				HATCH_LANGFUSE_EMIT_RETRY_BACKOFF_MS: "1",
			},
			runId: "run-retry",
			graphName: "retry_graph",
			pipelineFile: "retry.dot",
			transport,
		});
		if (!telemetry) throw new Error("expected telemetry");

		telemetry.eventHandler(event("stage.finish", { nodeId: "n1" }));
		await telemetry.shutdown();

		expect(transport.calls).toBeGreaterThanOrEqual(2);
		const spans = transport.batches.flat();
		expect(spans.filter((span) => span.metadata["hatch.event_kind"] === "stage.finish")).toHaveLength(1);
		expect(spans.some((span) => span.metadata["hatch.event_kind"] === "telemetry.langfuse.transport")).toBe(true);
		expect(telemetry.stats().failedBatches).toBe(0);
	});
});

describe("langfuse transport overhead benchmark", () => {
	it("keeps local enqueue overhead bounded for representative event load", async () => {
		const loops = 4000;
		const sampleEvent = event("stage.finish", {
			nodeId: "run",
			data: { attempt: "1", agent_id: "tool.shell", agent_role: "tool.operator" },
			message: "ok",
		});

		const representativeWork = () => {
			let score = 0;
			for (let i = 0; i < 600; i++) {
				score += (i * 7) % 13;
			}
			const packet = {
				score,
				node: "run",
				status: "completed",
				tags: ["pipeline", "telemetry", "benchmark"],
			};
			return JSON.parse(JSON.stringify(packet)).score as number;
		};

		const baseStart = process.hrtime.bigint();
		let baseSum = 0;
		for (let i = 0; i < loops; i++) {
			baseSum += representativeWork();
		}
		const baseNs = Number(process.hrtime.bigint() - baseStart);
		expect(baseSum).toBeGreaterThan(0);

		const transport = new InMemoryTransport();
		const telemetry = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
				HATCH_LANGFUSE_BATCH_SIZE: "5000",
				HATCH_LANGFUSE_MAX_QUEUE_SIZE: "25000",
			},
			runId: "bench-1",
			graphName: "benchmark",
			pipelineFile: "bench.dot",
			transport,
		});
		if (!telemetry) throw new Error("expected telemetry");

		const teleStart = process.hrtime.bigint();
		let telemetrySum = 0;
		for (let i = 0; i < loops; i++) {
			telemetrySum += representativeWork();
			telemetry.eventHandler(sampleEvent);
		}
		const teleNs = Number(process.hrtime.bigint() - teleStart);
		await telemetry.shutdown();
		expect(telemetrySum).toBeGreaterThan(0);

		const overheadNs = Math.max(0, teleNs - baseNs);
		const overheadRatio = overheadNs / Math.max(1, baseNs);
		const overheadNsPerEvent = overheadNs / loops;
		const runningUnderCoverage =
			Boolean(process.env["NODE_V8_COVERAGE"] || process.env["VITEST_COVERAGE"]) ||
			process.argv.some((arg) => arg.includes("--coverage")) ||
			String(process.env["npm_lifecycle_event"] || "").includes("test:guard-gates");
		const ratioBudget = runningUnderCoverage ? 2.0 : 0.20;

		expect(overheadRatio).toBeLessThan(ratioBudget);
		expect(overheadNsPerEvent).toBeLessThan(1_000_000);
	});
});
