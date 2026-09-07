import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EventBus } from "../events.js";
import {
	collectFactoryContext,
	createLangfuseTelemetry,
	resolveLangfuseConfigFromEnv,
	type LangfuseSpanEnvelope,
	type LangfuseTelemetryTransport,
} from "./langfuse.js";

import type { Event } from "../events.js";

class InMemoryTransport implements LangfuseTelemetryTransport {
	public readonly batches: LangfuseSpanEnvelope[][] = [];
	public fail = false;
	public shutdownCalls = 0;

	async emitBatch(spans: LangfuseSpanEnvelope[]): Promise<void> {
		if (this.fail) throw new Error("transport failed");
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

describe("langfuse env configuration", () => {
	it("warns and disables when keys are missing", () => {
		const warnings: string[] = [];
		const cfg = resolveLangfuseConfigFromEnv(
			{
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "",
				LANGFUSE_SECRET_KEY: "",
			},
			(message) => warnings.push(message),
		);
		expect(cfg.enabled).toBe(false);
		expect(warnings.some((w) => w.includes("missing LANGFUSE_PUBLIC_KEY"))).toBe(true);
	});

	it("loads explicit config and parses capture prompts flag", () => {
		const warnings: string[] = [];
		const cfg = resolveLangfuseConfigFromEnv(
			{
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
				LANGFUSE_BASE_URL: "https://example.langfuse.dev",
				HATCH_LANGFUSE_CAPTURE_PROMPTS: "yes",
				HATCH_LANGFUSE_BATCH_SIZE: "20",
				HATCH_LANGFUSE_MAX_QUEUE_SIZE: "200",
				HATCH_LANGFUSE_FLUSH_INTERVAL_MS: "10",
			},
			(message) => warnings.push(message),
		);
		expect(cfg.enabled).toBe(true);
		expect(cfg.config?.publicKey).toBe("pk");
		expect(cfg.config?.secretKey).toBe("sk");
		expect(cfg.config?.baseUrl).toBe("https://example.langfuse.dev");
		expect(cfg.config?.capturePrompts).toBe(true);
		expect(cfg.config?.batchSize).toBe(20);
		expect(cfg.config?.maxQueueSize).toBe(200);
		expect(cfg.config?.flushIntervalMs).toBe(10);
		expect(warnings).toEqual([]);
	});
});

describe("langfuse metadata mapping + trust boundaries", () => {
	it("maps universal metadata and trusted partition", async () => {
		const transport = new InMemoryTransport();
		const runContext = {
			issue_number: "1035",
			milestone_title: "Wave 1",
			agent_session_id: "wave-session-9",
			factory_context: JSON.stringify({ repo: "recallnet/astrochicken", wave: "goal-542-wave-1" }),
		};
		const warnings: string[] = [];
		const telemetry = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
			},
			warn: (m) => warnings.push(m),
			runId: "run-1",
			graphName: "wave_execute",
			pipelineFile: "wave_execute.dot",
			getRunContext: () => runContext,
			transport,
		});
		expect(telemetry).toBeTruthy();

		telemetry!.eventHandler(
			event("stage.finish", {
				nodeId: "run_tool",
				message: "done",
				data: {
					agent_id: "tool.shell",
					agent_role: "tool.operator",
					attempt: "1",
					path_taken: "moderate",
					job_id: "wave.execute.issue.lifecycle",
					prompt_version: "2026-03-09.r1",
					role_version: "1.4.0",
					skill_id: "wave.execute.issue",
					"hatch.job_id": "wave.execute.issue.lifecycle",
					"hatch.prompt_version": "2026-03-09.r1",
					"hatch.role_version": "1.4.0",
					"hatch.execution.path": "moderate",
					"hatch.merge.resolver": "deterministic",
				},
			}),
		);
		await telemetry!.shutdown();

		expect(transport.batches.length).toBeGreaterThan(0);
		const span = transport.batches.flat()[0];
		expect(span.sessionId).toBe("wave-session-9");
		expect(span.traceId).toMatch(/^lf_trace_/);
		expect(span.metadata["hatch.trace_id"]).toBe(span.traceId);
		expect(span.metadata["hatch.event_kind"]).toBe("stage.finish");
		expect(span.metadata["hatch.trust_partition"]).toBe("trusted");
		expect(span.metadata["hatch.abstraction_level"]).toBe("wave");
		expect(span.metadata["hatch.phase"]).toBe("implement");
		expect(span.metadata["hatch.phase_node_id"]).toBe("run_tool");
		expect(span.metadata["hatch.event_data.path_taken"]).toBe("moderate");
		expect(span.metadata["hatch.event_data.hatch.execution.path"]).toBe("moderate");
		expect(span.metadata["hatch.event_data.hatch.merge.resolver"]).toBe("deterministic");
		expect(span.metadata.job_id).toBe("wave.execute.issue.lifecycle");
		expect(span.metadata.prompt_version).toBe("2026-03-09.r1");
		expect(span.metadata.role_version).toBe("1.4.0");
		expect(span.metadata.skill_id).toBe("wave.execute.issue");
		expect(span.metadata["hatch.job_id"]).toBe("wave.execute.issue.lifecycle");
		expect(span.metadata["hatch.prompt_version"]).toBe("2026-03-09.r1");
		expect(span.metadata["hatch.role_version"]).toBe("1.4.0");
		expect(span.metadata["hatch.skill_id"]).toBe("wave.execute.issue");
		expect(span.metadata["factory.issue_number"]).toBe("1035");
		expect(span.metadata["factory.repo"]).toBe("recallnet/astrochicken");
		expect(span.metadata["factory.wave"]).toBe("goal-542-wave-1");
		expect(warnings).toEqual([]);
	});

	it("captures context.update execution-path telemetry in eventbus metadata", async () => {
		const transport = new InMemoryTransport();
		const telemetry = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
			},
			runId: "run-ctx-1",
			graphName: "wave_execute",
			pipelineFile: "wave_execute.dot",
			transport,
		});
		expect(telemetry).toBeTruthy();

		telemetry!.eventHandler(
			event("context.update", {
				nodeId: "route",
				data: {
					path_taken: "fast",
					"hatch.execution.path": "fast",
					"hatch.merge.resolver": "deterministic",
				},
			}),
		);
		await telemetry!.shutdown();

		const span = transport.batches.flat()[0];
		expect(span.metadata["hatch.event_kind"]).toBe("context.update");
		expect(span.metadata["hatch.event_data.path_taken"]).toBe("fast");
		expect(span.metadata["hatch.event_data.hatch.execution.path"]).toBe("fast");
		expect(span.metadata["hatch.event_data.hatch.merge.resolver"]).toBe("deterministic");
	});

	it("preserves benchmark identity metadata for stage/retry/quality events", async () => {
		const transport = new InMemoryTransport();
		const telemetry = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
			},
			runId: "run-benchmark-1",
			graphName: "wave_execute",
			pipelineFile: "wave_execute.dot",
			getRunContext: () => ({ factory_id: "mothership", prompt_hash: "sha256:wave-execute-r1" }),
			transport,
		});
		expect(telemetry).toBeTruthy();

		const benchmarkFields = {
			factory_id: "mothership",
			model: "claude-sonnet-4-6",
			provider: "anthropic",
			prompt_hash: "sha256:wave-execute-r1",
			job_id: "wave.execute.issue.lifecycle",
			prompt_version: "2026-03-09.r1",
			role_version: "1.4.0",
			skill_id: "wave.execute.issue",
			"hatch.job_id": "wave.execute.issue.lifecycle",
			"hatch.prompt_version": "2026-03-09.r1",
			"hatch.role_version": "1.4.0",
			"hatch.skill_id": "wave.execute.issue",
		};
		telemetry!.eventHandler(event("stage.finish", { nodeId: "worker", data: { attempt: "1", ...benchmarkFields } }));
		telemetry!.eventHandler(event("stage.retry", { nodeId: "worker", data: { attempt: "2", ...benchmarkFields } }));
		telemetry!.eventHandler(event("quality.signal", {
			nodeId: "worker",
			data: {
				attempt: "2",
				quality_outcome: "pass",
				langfuse_quality_outcome: "pass",
				...benchmarkFields,
			},
		}));
		await telemetry!.shutdown();

		const spans = transport.batches.flat().filter((span) => {
			const kind = span.metadata["hatch.event_kind"];
			return kind === "stage.finish" || kind === "stage.retry" || kind === "quality.signal";
		});
		expect(spans).toHaveLength(3);
		for (const span of spans) {
			expect(span.metadata.factory_id).toBe("mothership");
			expect(span.metadata.graph_id).toBe("wave_execute.dot");
			expect(span.metadata.node_id).toBe("worker");
			expect(span.metadata.handler_type).toBeTruthy();
			expect(span.metadata.model).toBe("claude-sonnet-4-6");
			expect(span.metadata.provider).toBe("anthropic");
			expect(span.metadata.prompt_hash).toBe("sha256:wave-execute-r1");
			expect(span.metadata.job_id).toBe("wave.execute.issue.lifecycle");
			expect(span.metadata.prompt_version).toBe("2026-03-09.r1");
			expect(span.metadata.role_version).toBe("1.4.0");
			expect(span.metadata.skill_id).toBe("wave.execute.issue");
			expect(span.metadata["hatch.job_id"]).toBe("wave.execute.issue.lifecycle");
			expect(span.metadata["hatch.prompt_version"]).toBe("2026-03-09.r1");
			expect(span.metadata["hatch.role_version"]).toBe("1.4.0");
			expect(span.metadata["hatch.skill_id"]).toBe("wave.execute.issue");
		}
	});

	it("labels untrusted partition when identity fields are absent", async () => {
		const transport = new InMemoryTransport();
		const telemetry = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
			},
			runId: "run-2",
			graphName: "test",
			pipelineFile: "test.dot",
			transport,
		});
		expect(telemetry).toBeTruthy();
		telemetry!.eventHandler(event("stage.finish", { nodeId: "non_trusted", data: { attempt: "1" } }));
		await telemetry!.shutdown();
		const span = transport.batches.flat()[0];
		expect(span.metadata["hatch.trust_partition"]).toBe("untrusted");
	});

	it("normalizes absolute pipeline paths into stable repo-relative graph ids", async () => {
		const repoA = mkdtempSync(join(tmpdir(), "hatch-graph-id-a-"));
		const repoB = mkdtempSync(join(tmpdir(), "hatch-graph-id-b-"));
		mkdirSync(join(repoA, ".git"));
		mkdirSync(join(repoB, ".git"));
		const fileA = join(repoA, "apps", "hatch", "src", "pipeline", "sample.dot");
		const fileB = join(repoB, "apps", "hatch", "src", "pipeline", "sample.dot");

		const transportA = new InMemoryTransport();
		const telemetryA = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
			},
			runId: "run-a",
			graphName: "wave_execute",
			pipelineFile: fileA,
			transport: transportA,
		});
		const transportB = new InMemoryTransport();
		const telemetryB = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
			},
			runId: "run-b",
			graphName: "wave_execute",
			pipelineFile: fileB,
			transport: transportB,
		});
		expect(telemetryA).toBeTruthy();
		expect(telemetryB).toBeTruthy();

		telemetryA!.eventHandler(event("stage.finish", { nodeId: "child_tool", edgeFrom: "start", edgeTo: "child_tool" }));
		telemetryB!.eventHandler(event("stage.finish", { nodeId: "child_tool", edgeFrom: "start", edgeTo: "child_tool" }));
		await telemetryA!.shutdown();
		await telemetryB!.shutdown();

		const spanA = transportA.batches.flat()[0];
		const spanB = transportB.batches.flat()[0];
		expect(spanA.metadata["hatch.graph_id"]).toBe("apps/hatch/src/pipeline/sample.dot");
		expect(spanB.metadata["hatch.graph_id"]).toBe("apps/hatch/src/pipeline/sample.dot");
		expect(spanA.metadata["hatch.scoped_node_id"]).toBe("apps/hatch/src/pipeline/sample.dot:child_tool");
		expect(spanB.metadata["hatch.scoped_node_id"]).toBe("apps/hatch/src/pipeline/sample.dot:child_tool");

		rmSync(repoA, { recursive: true, force: true });
		rmSync(repoB, { recursive: true, force: true });
	});

	it("supports detach and reattach on the same EventBus without duplicate spans", async () => {
		const transport = new InMemoryTransport();
		const telemetry = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
			},
			runId: "run-bus",
			graphName: "wave_execute",
			pipelineFile: "wave_execute.dot",
			transport,
		});
		expect(telemetry).toBeTruthy();

		const bus = new EventBus();
		const detach = bus.on(telemetry!.eventHandler);
		detach();
		bus.on(telemetry!.eventHandler);
		bus.emit(event("stage.finish", { nodeId: "once" }));
		await telemetry!.shutdown();

		expect(transport.batches.flat()).toHaveLength(1);
	});
});

describe("langfuse queueing + non-blocking failure handling", () => {
	it("drops events on backpressure and never throws on emit path", async () => {
		const transport = new InMemoryTransport();
		const warnings: string[] = [];
		const telemetry = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
				HATCH_LANGFUSE_MAX_QUEUE_SIZE: "2",
				HATCH_LANGFUSE_BATCH_SIZE: "10",
			},
			warn: (m) => warnings.push(m),
			runId: "run-3",
			graphName: "test",
			pipelineFile: "test.dot",
			transport,
		});
		expect(telemetry).toBeTruthy();

		expect(() => telemetry!.eventHandler(event("stage.start", { nodeId: "a" }))).not.toThrow();
		expect(() => telemetry!.eventHandler(event("stage.start", { nodeId: "b" }))).not.toThrow();
		expect(() => telemetry!.eventHandler(event("stage.start", { nodeId: "c" }))).not.toThrow();
		await telemetry!.shutdown();

		const stats = telemetry!.stats();
		expect(stats.dropped).toBeGreaterThanOrEqual(1);
		expect(warnings.some((w) => w.includes("queue full"))).toBe(true);
		const transportEvent = transport.batches.flat().find((span) => span.metadata["hatch.event_kind"] === "telemetry.langfuse.transport");
		expect(transportEvent?.metadata["transport_event"]).toBe("queue_overflow");
		expect(transportEvent?.metadata["transport_status"]).toBe("drop");
		expect(transportEvent?.metadata["hatch.span_type"]).toBe("telemetry_transport");
	});

	it("warns on transport failures and preserves pipeline execution", async () => {
		const transport = new InMemoryTransport();
		transport.fail = true;
		const warnings: string[] = [];
		const telemetry = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
				HATCH_LANGFUSE_BATCH_SIZE: "1",
			},
			warn: (m) => warnings.push(m),
			runId: "run-4",
			graphName: "test",
			pipelineFile: "test.dot",
			transport,
		});
		expect(telemetry).toBeTruthy();
		expect(() => telemetry!.eventHandler(event("pipeline.error", { message: "boom" }))).not.toThrow();
		await telemetry!.shutdown();
		const stats = telemetry!.stats();
		expect(stats.failedBatches).toBeGreaterThanOrEqual(1);
		expect(warnings.some((w) => w.includes("transport warning"))).toBe(true);
	});

	it("emits durable transport retry/failure telemetry when export fails", async () => {
		const warnings: string[] = [];
		let first = true;
		const transport: LangfuseTelemetryTransport = {
			async emitBatch(spans) {
				if (spans.some((span) => span.metadata["hatch.event_kind"] === "telemetry.langfuse.transport")) return;
				if (first) {
					first = false;
					throw new Error("boom");
				}
			},
			async shutdown() {},
		};
		const emitted: LangfuseSpanEnvelope[] = [];
		const captureTransport: LangfuseTelemetryTransport = {
			async emitBatch(spans) {
				emitted.push(...spans);
				await transport.emitBatch(spans);
			},
			async shutdown() {},
		};
		const telemetry = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
				HATCH_LANGFUSE_BATCH_SIZE: "1",
				HATCH_LANGFUSE_EMIT_RETRY_ATTEMPTS: "2",
				HATCH_LANGFUSE_EMIT_RETRY_BACKOFF_MS: "1",
			},
			warn: (message) => warnings.push(message),
			runId: "run-transport-health",
			graphName: "wave_execute",
			pipelineFile: "wave_execute.dot",
			transport: captureTransport,
		});
		expect(telemetry).toBeTruthy();
		telemetry!.eventHandler(event("stage.finish", { nodeId: "worker" }));
		await telemetry!.shutdown();

		const transportSpans = emitted.filter((span) => span.metadata["hatch.event_kind"] === "telemetry.langfuse.transport");
		expect(transportSpans.some((span) => span.metadata["transport_event"] === "emit_retry_scheduled")).toBe(true);
		expect(transportSpans.some((span) => span.metadata["transport_event"] === "emit_retry_recovered")).toBe(true);
		expect(warnings).toEqual([]);
	});
});

describe("langfuse long-lived session spans", () => {
	it("records session tool events from worktree/kw/manager handlers", async () => {
		const transport = new InMemoryTransport();
		const telemetry = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
			},
			runId: "run-5",
			graphName: "wave_execute",
			pipelineFile: "wave_execute.dot",
			transport,
		});
		expect(telemetry).toBeTruthy();

		telemetry!.recordSessionEvent({
			handlerType: "agent.worktree",
			nodeId: "execute_issue",
			sessionId: "milestone-goal-1-wave-1",
			eventType: "tool_execution_start",
			toolName: "bash",
			runId: "run-5",
			timestamp: new Date("2026-03-06T12:00:00.000Z"),
			factoryContext: {
				agent_session_id: "milestone-goal-1-wave-1",
				issue_number: "1035",
			},
		});
		telemetry!.recordSessionEvent({
			handlerType: "agent.worktree",
			nodeId: "execute_issue",
			sessionId: "milestone-goal-1-wave-1",
			eventType: "tool_execution_end",
			toolName: "bash",
			runId: "run-5",
			timestamp: new Date("2026-03-06T12:00:01.250Z"),
			factoryContext: {
				agent_session_id: "milestone-goal-1-wave-1",
				issue_number: "1035",
			},
		});
		await telemetry!.shutdown();

		const spans = transport.batches.flat();
		const startSpan = spans.find((span) => span.spanName.includes("session.tool_execution_start"));
		const endSpan = spans.find((span) => span.spanName.includes("session.tool_execution_end"));
		expect(startSpan).toBeTruthy();
		expect(endSpan).toBeTruthy();
		expect(startSpan?.traceId).toBe(endSpan?.traceId);
		expect(endSpan?.metadata["duration_ms"]).toBe("1250");
		expect(endSpan?.metadata["hatch.source"]).toBe("session");
		expect(endSpan?.metadata["hatch.session_id"]).toBe("milestone-goal-1-wave-1");
		expect(endSpan?.metadata["hatch.handler_type"]).toBe("agent.worktree");
		expect(endSpan?.metadata["hatch.trust_partition"]).toBe("trusted");
		expect(endSpan?.metadata["hatch.abstraction_level"]).toBe("wave");
		expect(endSpan?.metadata["hatch.phase"]).toBe("implement");
		expect(endSpan?.metadata["hatch.phase_node_id"]).toBe("execute_issue");
		expect(endSpan?.metadata["factory.issue_number"]).toBe("1035");
	});

	it("emits duration and parent lineage metadata for child pipeline events", async () => {
		const transport = new InMemoryTransport();
		const telemetry = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
			},
			runId: "child-run",
			graphName: "goal_run",
			pipelineFile: "goal_run.dot",
			getRunContext: () => ({
				__parent_run_id: "parent-1",
				__parent_graph_id: "factory_supervisor_tick.dot",
				__parent_trace_id: "lf_trace_parent_1",
				__root_run_id: "root-1",
				__root_graph_id: "factory_supervisor_tick.dot",
				__lineage_depth: "2",
			}),
			transport,
		});
		expect(telemetry).toBeTruthy();
		telemetry!.eventHandler(event("stage.start", {
			nodeId: "triage",
			timestamp: new Date("2026-03-06T12:00:00.000Z"),
		}));
		telemetry!.eventHandler(event("stage.finish", {
			nodeId: "triage",
			timestamp: new Date("2026-03-06T12:00:01.500Z"),
		}));
		await telemetry!.shutdown();

		const finishSpan = transport.batches.flat().find((span) => span.metadata["hatch.event_kind"] === "stage.finish");
		expect(finishSpan?.metadata["duration_ms"]).toBe("1500");
		expect(finishSpan?.metadata["parent_run_id"]).toBe("parent-1");
		expect(finishSpan?.metadata["parent_graph_id"]).toBe("factory_supervisor_tick.dot");
		expect(finishSpan?.metadata["parent_trace_id"]).toBe("lf_trace_parent_1");
		expect(finishSpan?.metadata["root_run_id"]).toBe("root-1");
		expect(finishSpan?.metadata["root_graph_id"]).toBe("factory_supervisor_tick.dot");
		expect(finishSpan?.metadata["lineage_depth"]).toBe("2");
		expect(finishSpan?.metadata["hatch.abstraction_level"]).toBe("goal");
		expect(finishSpan?.metadata["hatch.phase"]).toBe("triage");
		expect(finishSpan?.metadata["hatch.phase_node_id"]).toBe("triage");
	});
});

describe("factory context collector", () => {
	it("merges explicit JSON context + allowlisted keys", () => {
		const out = collectFactoryContext({
			factory_context: JSON.stringify({ repo: "recallnet/astrochicken", wave: "goal-1-wave-1" }),
			issue_number: "1035",
			factory_custom_flag: "on",
			ignore_me: "nope",
		});
		expect(out.repo).toBe("recallnet/astrochicken");
		expect(out.wave).toBe("goal-1-wave-1");
		expect(out.issue_number).toBe("1035");
		expect(out.factory_custom_flag).toBe("on");
		expect(out.ignore_me).toBeUndefined();
	});

	it("accepts factory metadata provider hook for goal/issue/wave keys", async () => {
		const transport = new InMemoryTransport();
		const telemetry = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
			},
			runId: "hook-run",
			graphName: "wave_execute",
			pipelineFile: "wave_execute.dot",
			getRunContext: () => ({ repo: "recallnet/astrochicken" }),
			factoryMetadataProvider: () => ({ goal_id: "g-42", issue_id: "i-1035", wave_id: "w-1" }),
			transport,
		});
		telemetry!.eventHandler(event("stage.finish", { nodeId: "worker" }));
		await telemetry!.shutdown();
		const span = transport.batches.flat()[0];
		expect(span.metadata["factory.goal_id"]).toBe("g-42");
		expect(span.metadata["factory.issue_id"]).toBe("i-1035");
		expect(span.metadata["factory.wave_id"]).toBe("w-1");
	});
});

describe("telemetry overhead benchmark", () => {
	it("keeps local enqueue overhead under 75% for representative event load", async () => {
		const loops = 4000;
		const sampleEvent = event("stage.finish", {
			nodeId: "run",
			data: { attempt: "1", agent_id: "tool.shell", agent_role: "tool.operator" },
			message: "ok",
		});

		const representativeWork = () => {
			let score = 0;
			for (let i = 0; i < 1200; i++) {
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
		expect(telemetry).toBeTruthy();

		const teleStart = process.hrtime.bigint();
		let telemetrySum = 0;
		for (let i = 0; i < loops; i++) {
			telemetrySum += representativeWork();
			telemetry!.eventHandler(sampleEvent);
		}
		const teleNs = Number(process.hrtime.bigint() - teleStart);
		await telemetry!.shutdown();
		expect(telemetrySum).toBeGreaterThan(0);

		const overheadRatio = (teleNs - baseNs) / Math.max(1, baseNs);
		expect(overheadRatio).toBeLessThan(0.75);
	});
});
