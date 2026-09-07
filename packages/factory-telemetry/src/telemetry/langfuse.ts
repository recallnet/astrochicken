import { existsSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import { resolveLangfuseTraceId } from "../langfuse-telemetry.js";
import { buildLangfuseGenerationPayload, isLangfuseGenerationSpan } from "./langfuse-generation-payload.js";
import {
	buildUniversalEventData,
	collectFactoryTelemetryMetadata,
	deriveAbstractionLevel,
	deriveEventOutcome,
	deriveTelemetryPhase,
	deriveSessionId,
	type FactoryMetadataProvider,
} from "./universal-metadata.js";

import type { Event, EventHandler } from "../events.js";

const DEFAULT_FLUSH_INTERVAL_MS = 250;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_QUEUE_SIZE = 5000;
const DEFAULT_EMIT_RETRY_ATTEMPTS = 2;
const DEFAULT_EMIT_RETRY_BACKOFF_MS = 50;
const UNIVERSAL_SCHEMA_VERSION = "hatch.telemetry.v1";

export interface LangfuseTelemetryConfig {
	publicKey: string;
	secretKey: string;
	baseUrl: string;
	capturePrompts: boolean;
	flushIntervalMs: number;
	batchSize: number;
	maxQueueSize: number;
	emitRetryAttempts: number;
	emitRetryBackoffMs: number;
}

export interface LangfuseTelemetryStats {
	queued: number;
	dropped: number;
	emitted: number;
	failedBatches: number;
}

export interface SessionTelemetryEvent {
	timestamp?: Date;
	runId?: string;
	handlerType: string;
	nodeId: string;
	sessionId: string;
	eventType: string;
	toolName?: string;
	message?: string;
	factoryContext?: Record<string, string>;
}

export interface LangfuseSpanEnvelope {
	sessionId: string;
	traceId: string;
	traceName: string;
	tags: string[];
	spanId: string;
	spanName: string;
	timestamp: Date;
	metadata: Record<string, string>;
	input?: string;
	output?: string;
	level?: "DEFAULT" | "ERROR";
	statusMessage?: string;
}

export interface LangfuseTelemetryTransport {
	emitBatch(spans: LangfuseSpanEnvelope[]): Promise<void>;
	shutdown(): Promise<void>;
}

declare global {
	// Test-only hook for injecting deterministic transport in integration tests.
	var __HATCH_LANGFUSE_TEST_TRANSPORT_FACTORY: (() => LangfuseTelemetryTransport) | undefined;
}

export interface LangfuseTelemetry {
	eventHandler: EventHandler;
	recordSessionEvent(event: SessionTelemetryEvent): void;
	flush(): Promise<void>;
	shutdown(): Promise<void>;
	stats(): LangfuseTelemetryStats;
}

export interface CreateLangfuseTelemetryOptions {
	env?: Record<string, string | undefined>;
	warn?: (message: string) => void;
	runId?: string;
	graphName?: string;
	pipelineFile?: string;
	getRunContext?: () => Record<string, string>;
	transport?: LangfuseTelemetryTransport;
	factoryMetadataProvider?: FactoryMetadataProvider;
}

interface ResolvedLangfuseConfig {
	enabled: boolean;
	config?: LangfuseTelemetryConfig;
}

type QueueItem =
	| { kind: "eventbus"; event: Event }
	| { kind: "session"; event: SessionTelemetryEvent };

const TRANSPORT_EVENT_KIND = "telemetry.langfuse.transport";
const TRANSPORT_NODE_ID = "langfuse_transport";

export function createLangfuseTelemetry(options: CreateLangfuseTelemetryOptions = {}): LangfuseTelemetry | null {
	const warn = options.warn ?? defaultWarn;
	const resolved = resolveLangfuseConfigFromEnv(options.env ?? process.env, warn);
	if (!resolved.enabled || !resolved.config) return null;

	const testTransportFactory = globalThis.__HATCH_LANGFUSE_TEST_TRANSPORT_FACTORY;
	const transport = options.transport ?? (testTransportFactory ? testTransportFactory() : new LazyLangfuseSdkTransport(resolved.config, warn));
	return new AsyncLangfuseTelemetryEmitter({
		config: resolved.config,
		transport,
		warn,
		runId: options.runId,
		graphName: options.graphName,
		pipelineFile: options.pipelineFile,
		getRunContext: options.getRunContext,
		factoryMetadataProvider: options.factoryMetadataProvider,
	});
}

export function resolveLangfuseConfigFromEnv(
	env: Record<string, string | undefined>,
	warn: (message: string) => void,
): ResolvedLangfuseConfig {
	const enabledFlag = parseBooleanFlag(env["HATCH_LANGFUSE_ENABLED"]);
	if (enabledFlag === false) {
		return { enabled: false };
	}

	const publicKey = String(env["LANGFUSE_PUBLIC_KEY"] || "").trim();
	const secretKey = String(env["LANGFUSE_SECRET_KEY"] || "").trim();
	const baseUrl = String(env["LANGFUSE_BASE_URL"] || "https://cloud.langfuse.com").trim() || "https://cloud.langfuse.com";

	const hasAnyLangfuseVar =
		Boolean(publicKey) ||
		Boolean(secretKey) ||
		Boolean(String(env["LANGFUSE_BASE_URL"] || "").trim()) ||
		enabledFlag === true;

	if (!publicKey || !secretKey) {
		if (hasAnyLangfuseVar) {
			warn(
				`[telemetry.langfuse] disabled: missing LANGFUSE_PUBLIC_KEY and/or LANGFUSE_SECRET_KEY (warning only; hatch continues without telemetry)`,
			);
		}
		return { enabled: false };
	}

	const flushIntervalMs = parsePositiveIntWithWarning(
		env["HATCH_LANGFUSE_FLUSH_INTERVAL_MS"],
		DEFAULT_FLUSH_INTERVAL_MS,
		"HATCH_LANGFUSE_FLUSH_INTERVAL_MS",
		warn,
	);
	const batchSize = parsePositiveIntWithWarning(
		env["HATCH_LANGFUSE_BATCH_SIZE"],
		DEFAULT_BATCH_SIZE,
		"HATCH_LANGFUSE_BATCH_SIZE",
		warn,
	);
	const maxQueueSize = parsePositiveIntWithWarning(
		env["HATCH_LANGFUSE_MAX_QUEUE_SIZE"],
		DEFAULT_MAX_QUEUE_SIZE,
		"HATCH_LANGFUSE_MAX_QUEUE_SIZE",
		warn,
	);
	const emitRetryAttempts = parsePositiveIntWithWarning(
		env["HATCH_LANGFUSE_EMIT_RETRY_ATTEMPTS"],
		DEFAULT_EMIT_RETRY_ATTEMPTS,
		"HATCH_LANGFUSE_EMIT_RETRY_ATTEMPTS",
		warn,
	);
	const emitRetryBackoffMs = parsePositiveIntWithWarning(
		env["HATCH_LANGFUSE_EMIT_RETRY_BACKOFF_MS"],
		DEFAULT_EMIT_RETRY_BACKOFF_MS,
		"HATCH_LANGFUSE_EMIT_RETRY_BACKOFF_MS",
		warn,
	);
	const capturePrompts = parseBooleanFlag(env["HATCH_LANGFUSE_CAPTURE_PROMPTS"]) ?? false;

	return {
		enabled: true,
		config: {
			publicKey,
			secretKey,
			baseUrl,
			capturePrompts,
			flushIntervalMs,
			batchSize,
			maxQueueSize,
			emitRetryAttempts,
			emitRetryBackoffMs,
		},
	};
}

export function collectFactoryContext(context: Record<string, string> | undefined): Record<string, string> {
	return collectFactoryTelemetryMetadata(context);
}

class AsyncLangfuseTelemetryEmitter implements LangfuseTelemetry {
	private readonly queue: QueueItem[] = [];
	private readonly warn: (message: string) => void;
	private readonly transport: LangfuseTelemetryTransport;
	private readonly config: LangfuseTelemetryConfig;
	private readonly runId: string;
	private readonly graphName: string;
	private readonly pipelineFile: string;
	private readonly graphId: string;
	private readonly getRunContext?: () => Record<string, string>;
	private readonly factoryMetadataProvider?: FactoryMetadataProvider;
	private readonly interval: ReturnType<typeof setInterval>;
	private readonly activeStageStarts = new Map<string, number>();
	private readonly activeSessionStarts = new Map<string, number>();
	private flushPromise: Promise<void> | null = null;
	private closed = false;
	private sequence = 0;
	private readonly metrics: LangfuseTelemetryStats = {
		queued: 0,
		dropped: 0,
		emitted: 0,
		failedBatches: 0,
	};

	constructor(args: {
		config: LangfuseTelemetryConfig;
		transport: LangfuseTelemetryTransport;
		warn: (message: string) => void;
		runId?: string;
		graphName?: string;
		pipelineFile?: string;
		getRunContext?: () => Record<string, string>;
		factoryMetadataProvider?: FactoryMetadataProvider;
	}) {
		this.config = args.config;
		this.transport = args.transport;
		this.warn = args.warn;
		this.runId = String(args.runId || "").trim();
		this.graphName = String(args.graphName || "").trim();
		this.pipelineFile = String(args.pipelineFile || "").trim();
		this.graphId = resolveGraphId(this.pipelineFile, this.graphName);
		this.getRunContext = args.getRunContext;
		this.factoryMetadataProvider = args.factoryMetadataProvider;
		this.interval = setInterval(() => {
			void this.flushQueue();
		}, this.config.flushIntervalMs);
		this.interval.unref?.();
	}

	eventHandler: EventHandler = (event) => {
		this.enqueue({ kind: "eventbus", event });
	};

	recordSessionEvent(event: SessionTelemetryEvent): void {
		this.enqueue({ kind: "session", event });
	}

	async flush(): Promise<void> {
		await this.flushQueue();
	}

	async shutdown(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		clearInterval(this.interval);
		await this.flushQueue();
		try {
			await this.transport.shutdown();
		} catch (error) {
			this.warn(
				`[telemetry.langfuse] shutdown warning: ${error instanceof Error ? error.message : String(error)} (warning only)`,
			);
		}
	}

	stats(): LangfuseTelemetryStats {
		return {
			queued: this.metrics.queued,
			dropped: this.metrics.dropped,
			emitted: this.metrics.emitted,
			failedBatches: this.metrics.failedBatches,
		};
	}

	private enqueue(item: QueueItem): void {
		if (this.closed) return;
		if (this.queue.length >= this.config.maxQueueSize) {
			this.metrics.dropped += 1;
			this.enqueueTransportHealthEvent({
				transport_event: "queue_overflow",
				transport_status: "drop",
				dropped_count: String(this.metrics.dropped),
				queue_size: String(this.queue.length),
				max_queue_size: String(this.config.maxQueueSize),
			});
			if (this.metrics.dropped % 100 === 1) {
				this.warn(
					`[telemetry.langfuse] queue full (max=${this.config.maxQueueSize}); dropping newest events (dropped=${this.metrics.dropped})`,
				);
			}
			return;
		}

		this.queue.push(item);
		this.metrics.queued = this.queue.length;

		if (this.queue.length >= this.config.batchSize) {
			queueMicrotask(() => {
				void this.flushQueue();
			});
		}
	}

	private async flushQueue(): Promise<void> {
		if (this.flushPromise) {
			await this.flushPromise;
			return;
		}
		if (this.queue.length === 0) return;
		this.flushPromise = (async () => {
			try {
				while (this.queue.length > 0) {
					const items = this.queue.splice(0, this.config.batchSize);
					this.metrics.queued = this.queue.length;
					const spans = items.map((item) => this.toSpan(item));
					await this.emitBatchWithRetry(spans);
				}
			} finally {
				this.flushPromise = null;
			}
		})();
		await this.flushPromise;
	}

	private async emitBatchWithRetry(spans: LangfuseSpanEnvelope[]): Promise<void> {
		const transportOnlyBatch = spans.every((span) => span.metadata["hatch.event_kind"] === TRANSPORT_EVENT_KIND);
		for (let attempt = 1; attempt <= this.config.emitRetryAttempts; attempt++) {
			try {
				await this.transport.emitBatch(spans);
				this.metrics.emitted += spans.length;
				if (attempt > 1 && !transportOnlyBatch) {
					this.enqueueTransportHealthEvent({
						transport_event: "emit_retry_recovered",
						transport_status: "ok",
						emit_attempt: String(attempt),
						batch_size: String(spans.length),
						emitted_count: String(this.metrics.emitted),
					});
				}
				return;
			} catch (error) {
				if (attempt < this.config.emitRetryAttempts) {
					if (!transportOnlyBatch) {
						this.enqueueTransportHealthEvent({
							transport_event: "emit_retry_scheduled",
							transport_status: "retry",
							emit_attempt: String(attempt),
							batch_size: String(spans.length),
							retry_backoff_ms: String(this.config.emitRetryBackoffMs * attempt),
							error_message: error instanceof Error ? error.message : String(error),
						});
					}
					await sleep(this.config.emitRetryBackoffMs * attempt);
					continue;
				}
				this.metrics.failedBatches += 1;
				if (!transportOnlyBatch) {
					this.enqueueTransportHealthEvent({
						transport_event: "emit_failed",
						transport_status: "fail",
						emit_attempt: String(attempt),
						batch_size: String(spans.length),
						failed_batches: String(this.metrics.failedBatches),
						error_message: error instanceof Error ? error.message : String(error),
					});
				}
				this.warn(
					`[telemetry.langfuse] transport warning: ${error instanceof Error ? error.message : String(error)} (warning only)`,
				);
			}
		}
	}


	private toSpan(item: QueueItem): LangfuseSpanEnvelope {
		this.sequence += 1;
		if (item.kind === "eventbus") {
			return this.toEventBusSpan(item.event, this.sequence);
		}
		return this.toSessionSpan(item.event, this.sequence);
	}

	private toEventBusSpan(event: Event, seq: number): LangfuseSpanEnvelope {
		const runContext = this.getRunContext?.() ?? {};
		const eventData = { ...(event.data || {}) };
		const mergedFactoryContext = {
			...collectFactoryTelemetryMetadata(runContext, this.factoryMetadataProvider),
			...collectFactoryTelemetryMetadata(eventData, this.factoryMetadataProvider),
		};
		const runId = String(eventData.run_id || this.runId || runContext["__run_id"] || "no_run_id").trim() || "no_run_id";
		const handlerType = String(eventData.handler_type || eventData["hatch.handler_type"] || inferHandlerTypeFromEvent(event)).trim() || "pipeline";
		const nodeId = String(event.nodeId || eventData.node_id || eventData["hatch.node_id"] || "pipeline").trim() || "pipeline";
		const attempt = String(eventData.attempt || eventData["hatch.attempt"] || "1").trim() || "1";
		const sessionFromEvent = String(eventData.session_id || eventData["hatch.session_id"] || "").trim();
		const sessionFromFactory = String(mergedFactoryContext["agent_session_id"] || "").trim();
		const sessionId = sessionFromEvent || sessionFromFactory || deriveSessionId({
			runId,
			handlerType,
			nodeId,
			attempt,
			sequence: seq,
		});
		const traceId = String(
			eventData.langfuse_trace_id
			|| event.traceId
			|| resolveLangfuseTraceId(runId, handlerType, `${sessionId}:${attempt}`),
		).trim();
		const abstractionLevel = String(
			eventData.abstraction_level
			|| eventData["hatch.abstraction_level"]
			|| deriveAbstractionLevel({ graphId: this.graphId, graphName: this.graphName, nodeId, handlerType }),
		).trim();
		const phase = String(
			eventData.phase
			|| eventData["hatch.phase"]
			|| deriveTelemetryPhase({ graphId: this.graphId, graphName: this.graphName, nodeId, handlerType }),
		).trim();
		const parentRunId = String(eventData.parent_run_id || eventData["hatch.parent_run_id"] || runContext["__parent_run_id"] || "").trim();
		const parentGraphId = String(eventData.parent_graph_id || eventData["hatch.parent_graph_id"] || runContext["__parent_graph_id"] || "").trim();
		const parentTraceId = String(eventData.parent_trace_id || eventData["hatch.parent_trace_id"] || runContext["__parent_trace_id"] || "").trim();
		const rootRunId = String(eventData.root_run_id || eventData["hatch.root_run_id"] || runContext["__root_run_id"] || runId).trim();
		const rootGraphId = String(eventData.root_graph_id || eventData["hatch.root_graph_id"] || runContext["__root_graph_id"] || this.graphId).trim();
		const lineageDepth = String(eventData.lineage_depth || eventData["hatch.lineage_depth"] || runContext["__lineage_depth"] || "0").trim();

		const skill = String(eventData.skill || eventData.langfuse_skill || handlerType);
		const skillId = String(eventData.skill_id || eventData["hatch.skill_id"] || eventData.langfuse_skill_id || skill || handlerType);
		const jobId = String(eventData.job_id || eventData["hatch.job_id"] || "");
		const promptVersion = String(eventData.prompt_version || eventData["hatch.prompt_version"] || "");
		const roleVersion = String(eventData.role_version || eventData["hatch.role_version"] || "");
		const universalEventData = buildUniversalEventData({
			runId,
			graphName: this.graphName || this.graphId,
			graphId: this.graphId,
			nodeId,
			handlerType,
			skill,
			skillId,
			skillVersion: String(eventData.skill_version || ""),
			jobId,
			promptVersion,
			roleVersion,
			model: String(eventData.model || eventData.langfuse_model || ""),
			provider: String(eventData.provider || eventData.langfuse_provider || ""),
			promptHash: String(eventData.prompt_hash || eventData.langfuse_prompt_hash || ""),
			attempt,
			outcome: deriveEventOutcome(event.kind, eventData, Boolean(event.error)),
			sessionId,
			langfuseTraceId: traceId,
			factoryMetadata: mergedFactoryContext,
			abstractionLevel,
			phase,
			phaseNodeId: nodeId,
			parentRunId,
			parentGraphId,
			parentTraceId,
			rootRunId,
			rootGraphId,
			lineageDepth,
		});
		const metadata = buildUniversalEventMetadata({
			event: {
				...event,
				data: { ...universalEventData, ...eventData },
			},
			runId,
			graphName: this.graphName,
			pipelineFile: this.graphId,
			factoryContext: mergedFactoryContext,
			sessionId,
			traceId,
		});
		applyEventKindMetadata(event, metadata, { sessionId, traceId, graphId: this.graphId, nodeId });
		const durationMs = this.resolveEventDurationMs(event, traceId, nodeId, event.timestamp);
		if (durationMs !== "") {
			metadata.duration_ms = durationMs;
			metadata["hatch.duration_ms"] = durationMs;
		}

		const span: LangfuseSpanEnvelope = {
			sessionId,
			traceId,
			traceName: buildLangfuseTraceName(this.graphId || this.graphName || this.pipelineFile || "hatch.pipeline", metadata),
			tags: buildLangfuseTags(metadata),
			spanId: `${traceId}:${seq}`,
			spanName: buildEventBusSpanName(event, this.graphId, nodeId),
			timestamp: event.timestamp,
			metadata,
		};

		if (event.kind === "pipeline.error" || event.kind === "stage.error") {
			span.level = "ERROR";
			span.statusMessage = event.error?.message || event.message || "pipeline error";
		}

		if (this.config.capturePrompts) {
			const prompt = extractPrompt(event);
			if (prompt) span.input = prompt;
			if (event.message) span.output = event.message;
		}

		return span;
	}

	private toSessionSpan(event: SessionTelemetryEvent, seq: number): LangfuseSpanEnvelope {
		const runContext = this.getRunContext?.() ?? {};
		const mergedFactoryContext = {
			...collectFactoryTelemetryMetadata(runContext, this.factoryMetadataProvider),
			...collectFactoryTelemetryMetadata(event.factoryContext, this.factoryMetadataProvider),
		};
		const runId = String(event.runId || this.runId || "").trim() || "no_run_id";
		const sessionId = String(event.sessionId || deriveSessionId({
			runId,
			handlerType: event.handlerType,
			nodeId: event.nodeId,
			attempt: "1",
			sequence: seq,
		})).trim();
		const traceId = resolveLangfuseTraceId(runId, event.handlerType, sessionId);
		const abstractionLevel = deriveAbstractionLevel({
			graphId: this.graphId,
			graphName: this.graphName,
			nodeId: event.nodeId,
			handlerType: event.handlerType,
		});
		const phase = deriveTelemetryPhase({
			graphId: this.graphId,
			graphName: this.graphName,
			nodeId: event.nodeId,
			handlerType: event.handlerType,
		});
		const parentRunId = String((event.factoryContext && (event.factoryContext as Record<string, string>)["__parent_run_id"]) || runContext["__parent_run_id"] || "").trim();
		const parentGraphId = String((event.factoryContext && (event.factoryContext as Record<string, string>)["__parent_graph_id"]) || runContext["__parent_graph_id"] || "").trim();
		const parentTraceId = String((event.factoryContext && (event.factoryContext as Record<string, string>)["__parent_trace_id"]) || runContext["__parent_trace_id"] || "").trim();
		const rootRunId = String((event.factoryContext && (event.factoryContext as Record<string, string>)["__root_run_id"]) || runContext["__root_run_id"] || runId).trim();
		const rootGraphId = String((event.factoryContext && (event.factoryContext as Record<string, string>)["__root_graph_id"]) || runContext["__root_graph_id"] || this.graphId).trim();
		const lineageDepth = String((event.factoryContext && (event.factoryContext as Record<string, string>)["__lineage_depth"]) || runContext["__lineage_depth"] || "0").trim();

		const universalEventData = buildUniversalEventData({
			runId,
			graphName: this.graphName || this.graphId,
			graphId: this.graphId,
			nodeId: event.nodeId,
			handlerType: event.handlerType,
			skill: event.handlerType,
			skillId: event.handlerType,
			skillVersion: "",
			jobId: "",
			promptVersion: "",
			roleVersion: "",
			model: "",
			provider: "",
			promptHash: "",
			attempt: "1",
			outcome: "observe",
			sessionId,
			langfuseTraceId: traceId,
			factoryMetadata: mergedFactoryContext,
			abstractionLevel,
			phase,
			phaseNodeId: event.nodeId,
			parentRunId,
			parentGraphId,
			parentTraceId,
			rootRunId,
			rootGraphId,
			lineageDepth,
		});

		const metadata: Record<string, string> = {
			...universalEventData,
			"hatch.schema_version": UNIVERSAL_SCHEMA_VERSION,
			"hatch.source": "session",
			"hatch.event_kind": "session.event",
			"hatch.run_id": runId,
			"hatch.graph_name": this.graphName,
			"hatch.pipeline_file": this.graphId,
			"hatch.graph_id": this.graphId,
			"hatch.node_id": event.nodeId,
			"hatch.scoped_node_id": buildScopedId(this.graphId, event.nodeId),
			"hatch.handler_type": event.handlerType,
			"hatch.session_id": sessionId,
			"hatch.session_event_type": event.eventType,
			"hatch.tool_name": String(event.toolName || ""),
			"hatch.trust_partition": isTrustParticipatingHandler(event.handlerType) ? "trusted" : "untrusted",
		};
		appendFactoryContext(metadata, mergedFactoryContext);
		const durationMs = this.resolveSessionDurationMs(event, runId, sessionId);
		if (durationMs !== "") {
			metadata.duration_ms = durationMs;
			metadata["hatch.duration_ms"] = durationMs;
		}

		const span: LangfuseSpanEnvelope = {
			sessionId,
			traceId,
			traceName: buildLangfuseTraceName(this.graphId || this.graphName || this.pipelineFile || "hatch.pipeline", metadata),
			tags: buildLangfuseTags(metadata),
			spanId: `${traceId}:${seq}`,
			spanName: `session.${event.eventType}.${this.graphId || this.graphName || "pipeline"}.${event.nodeId}`,
			timestamp: event.timestamp ?? new Date(),
			metadata,
		};

		if (this.config.capturePrompts && event.message) {
			span.output = event.message;
		}
		return span;
	}

	private resolveEventDurationMs(
		event: Event,
		traceId: string,
		nodeId: string,
		timestamp: Date,
	): string {
		const key = `${traceId}:${nodeId}`;
		if (event.kind === "stage.start") {
			this.activeStageStarts.set(key, timestamp.getTime());
			return "";
		}
		if (!event.kind.startsWith("stage.")) return "";
		const startedAt = this.activeStageStarts.get(key);
		if (startedAt === undefined) return "";
		const durationMs = Math.max(0, timestamp.getTime() - startedAt);
		if (event.kind === "stage.finish" || event.kind === "stage.error" || event.kind === "stage.skip" || event.kind === "stage.retry") {
			this.activeStageStarts.delete(key);
		}
		return String(durationMs);
	}

	private resolveSessionDurationMs(event: SessionTelemetryEvent, runId: string, sessionId: string): string {
		const key = buildSessionDurationKey(runId, event, sessionId);
		const timestamp = (event.timestamp ?? new Date()).getTime();
		if (event.eventType.endsWith("_start")) {
			this.activeSessionStarts.set(key, timestamp);
			return "";
		}
		if (!event.eventType.endsWith("_end")) {
			return "";
		}
		const startedAt = this.activeSessionStarts.get(key);
		if (startedAt === undefined) return "";
		this.activeSessionStarts.delete(key);
		return String(Math.max(0, timestamp - startedAt));
	}

	private enqueueTransportHealthEvent(data: Record<string, string>): void {
		const runContext = this.getRunContext?.() ?? {};
		const event: Event = {
			kind: TRANSPORT_EVENT_KIND,
			timestamp: new Date(),
			nodeId: TRANSPORT_NODE_ID,
			message: data.transport_event || "transport",
			data: {
				run_id: this.runId || runContext["__run_id"] || "no_run_id",
				graph: this.graphName || this.graphId || "pipeline",
				graph_id: this.graphId || this.graphName || "pipeline",
				node_id: TRANSPORT_NODE_ID,
				handler_type: "telemetry",
				outcome: data.transport_status || "observe",
				abstraction_level: "telemetry",
				phase: "langfuse_transport",
				...data,
			},
		};
		if (this.queue.length >= this.config.maxQueueSize) {
			const evictedIndex = this.queue.findIndex((item) => item.kind !== "eventbus" || item.event.kind !== TRANSPORT_EVENT_KIND);
			if (evictedIndex >= 0) {
				this.queue.splice(evictedIndex, 1);
			}
		}
		this.queue.push({ kind: "eventbus", event });
		this.metrics.queued = this.queue.length;
	}

}

class LazyLangfuseSdkTransport implements LangfuseTelemetryTransport {
	private readonly config: LangfuseTelemetryConfig;
	private readonly warn: (message: string) => void;
	private clientPromise: Promise<any | null> | null = null;
	private warnedImport = false;

	constructor(config: LangfuseTelemetryConfig, warn: (message: string) => void) {
		this.config = config;
		this.warn = warn;
	}

	async emitBatch(spans: LangfuseSpanEnvelope[]): Promise<void> {
		if (spans.length === 0) return;
		const client = await this.getClient();
		if (!client) return;

		for (const span of spans) {
			const tracePayload = {
				id: span.traceId,
				name: span.traceName,
				tags: span.tags,
				sessionId: span.sessionId,
				timestamp: span.timestamp,
				metadata: span.metadata,
			};
			const spanPayload: Record<string, unknown> = {
				id: span.spanId,
				name: span.spanName,
				tags: span.tags,
				startTime: span.timestamp,
				endTime: span.timestamp,
				metadata: span.metadata,
			};
			if (span.input) spanPayload.input = span.input;
			if (span.output) spanPayload.output = span.output;
			if (span.level) spanPayload.level = span.level;
			if (span.statusMessage) spanPayload.statusMessage = span.statusMessage;
			const generationPayload = isLangfuseGenerationSpan(span)
				? buildLangfuseGenerationPayload(span, spanPayload)
				: null;

			try {
				const trace = typeof client.trace === "function" ? client.trace(tracePayload) : null;
				if (generationPayload && trace && typeof trace.generation === "function") {
					trace.generation(generationPayload);
					continue;
				}
				if (trace && typeof trace.span === "function") {
					trace.span(spanPayload);
					continue;
				}
				if (generationPayload && typeof client.generation === "function") {
					client.generation({ ...generationPayload, traceId: span.traceId });
					continue;
				}
				if (typeof client.span === "function") {
					client.span({ ...spanPayload, traceId: span.traceId });
				}
			} catch (error) {
				this.warn(
					`[telemetry.langfuse] sdk warning: ${error instanceof Error ? error.message : String(error)} (warning only)`,
				);
			}
		}

		const flush = (client as any).flushAsync ?? (client as any).flush;
		if (typeof flush === "function") {
			await Promise.resolve(flush.call(client));
		}
	}

	async shutdown(): Promise<void> {
		const client = await this.getClient();
		if (!client) return;
		const shutdown = (client as any).shutdownAsync ?? (client as any).shutdown;
		if (typeof shutdown === "function") {
			await Promise.resolve(shutdown.call(client));
		}
	}

	private async getClient(): Promise<any | null> {
		if (!this.clientPromise) {
			this.clientPromise = this.createClient();
		}
		return this.clientPromise;
	}

	private async createClient(): Promise<any | null> {
		try {
			const mod: any = await import("langfuse");
			const LangfuseCtor = mod.Langfuse ?? mod.default?.Langfuse ?? mod.default;
			if (typeof LangfuseCtor !== "function") {
				if (!this.warnedImport) {
					this.warnedImport = true;
					this.warn("[telemetry.langfuse] disabled: could not resolve Langfuse constructor export (warning only)");
				}
				return null;
			}
			return new LangfuseCtor({
				publicKey: this.config.publicKey,
				secretKey: this.config.secretKey,
				baseUrl: this.config.baseUrl,
			});
		} catch (error) {
			if (!this.warnedImport) {
				this.warnedImport = true;
				this.warn(
					`[telemetry.langfuse] disabled: failed to initialize SDK (${error instanceof Error ? error.message : String(error)}). hatch continues without telemetry.`,
				);
			}
			return null;
		}
	}
}

function buildUniversalEventMetadata(args: {
	event: Event;
	runId: string;
	graphName: string;
	pipelineFile: string;
	factoryContext: Record<string, string>;
	sessionId: string;
	traceId: string;
}): Record<string, string> {
	const { event, runId, graphName, pipelineFile, factoryContext, sessionId, traceId } = args;
	const metadata: Record<string, string> = {
		"hatch.schema_version": UNIVERSAL_SCHEMA_VERSION,
		"hatch.source": "eventbus",
		"hatch.event_kind": event.kind,
		"hatch.timestamp": event.timestamp.toISOString(),
		"hatch.run_id": runId,
		"hatch.graph_name": graphName,
		"hatch.pipeline_file": pipelineFile,
		"hatch.graph_id": pipelineFile,
		"hatch.node_id": String(event.nodeId || ""),
		"hatch.scoped_node_id": buildScopedId(pipelineFile, String(event.nodeId || "")),
		"hatch.edge_from": String(event.edgeFrom || ""),
		"hatch.edge_to": String(event.edgeTo || ""),
		"hatch.scoped_edge_id": buildScopedId(
			pipelineFile,
			[String(event.edgeFrom || ""), String(event.edgeTo || "")].filter(Boolean).join("->"),
		),
		"hatch.has_error": event.error ? "true" : "false",
		"hatch.session_id": sessionId,
		"hatch.trace_id": traceId,
	};

	const hasAgentIdentity = Boolean(event.data?.agent_id && event.data?.agent_role);
	metadata["hatch.trust_partition"] = hasAgentIdentity ? "trusted" : "untrusted";

	for (const [key, value] of Object.entries(event.data || {})) {
		const normalized = String(value);
		metadata[`hatch.event_data.${key}`] = normalized;
		if (shouldMirrorEventDataKeyAsMetadata(key)) {
			metadata[key] = normalized;
		}
	}

	if (event.intent) {
		metadata["hatch.intent.handler_type"] = event.intent.handlerType;
		metadata["hatch.intent.kind"] = event.intent.kind;
		metadata["hatch.intent.digest"] = event.intent.digest;
		metadata["hatch.intent.ref"] = String(event.intent.intentRef || "");
		metadata["hatch.intent.profile"] = String(event.intent.intentProfile || "");
		metadata["hatch.intent.patches"] = JSON.stringify(event.intent.intentPatches || []);
	}

	if (event.error) {
		metadata["hatch.error_message"] = event.error.message;
	}

	appendFactoryContext(metadata, factoryContext);
	return metadata;
}

function shouldMirrorEventDataKeyAsMetadata(key: string): boolean {
	return (
		key.startsWith("langfuse_")
		|| key.startsWith("hatch.")
		|| key.startsWith("factory.")
		|| key === "session_id"
		|| key === "role"
		|| key === "run_id"
		|| key === "graph"
		|| key === "graph_id"
		|| key === "factory_id"
		|| key === "node_id"
		|| key === "handler_type"
		|| key === "model_provider"
		|| key === "outcome"
		|| key === "provider"
		|| key === "model"
		|| key === "prompt_hash"
		|| key === "skill"
		|| key === "skill_id"
		|| key === "job_id"
		|| key === "prompt_version"
		|| key === "role_version"
		|| key === "prompt_family"
		|| key === "prompt_source"
		|| key === "task_prompt_source"
		|| key === "system_prompt_source"
		|| key === "abstraction_level"
		|| key === "phase"
		|| key === "phase_node_id"
		|| key === "duration_ms"
		|| key === "parent_run_id"
		|| key === "parent_graph_id"
		|| key === "parent_trace_id"
		|| key === "root_run_id"
		|| key === "root_graph_id"
		|| key === "lineage_depth"
		|| key === "transport_event"
		|| key === "transport_status"
		|| key === "dropped_count"
		|| key === "queue_size"
		|| key === "max_queue_size"
		|| key === "emit_attempt"
		|| key === "batch_size"
		|| key === "retry_backoff_ms"
		|| key === "failed_batches"
		|| key === "emitted_count"
		|| key === "error_message"
		|| key === "gate_name"
		|| key === "gate_outcome"
		|| key === "gate_evidence_ref"
	);
}

function appendFactoryContext(metadata: Record<string, string>, factoryContext: Record<string, string>): void {
	for (const [key, value] of Object.entries(factoryContext)) {
		metadata[`factory.${key}`] = value;
	}
}

function buildEventBusSpanName(event: Event, graphId: string, nodeId: string): string {
	const graph = graphId || "pipeline";
	if (event.kind === "edge.selected") {
		const edge = [String(event.edgeFrom || ""), String(event.edgeTo || "")].filter(Boolean).join("->");
		return `${graph}:${edge || "edge"}:edge.selected`;
	}
	return `${graph}:${nodeId || "pipeline"}:${event.kind}`;
}

function inferHandlerTypeFromEvent(event: Event): string {
	if (event.kind === "parallel.fan_out") return "parallel.fan_out";
	if (event.kind === "parallel.fan_in") return "parallel.fan_in";
	if (event.kind.startsWith("guard.")) return "guard";
	if (event.kind.startsWith("stage.")) return "stage";
	if (event.kind === "quality.signal") return "quality";
	if (event.kind === "edge.selected") return "edge";
	return "pipeline";
}

function applyEventKindMetadata(
	event: Event,
	metadata: Record<string, string>,
	args: { sessionId: string; traceId: string; graphId: string; nodeId: string },
): void {
	if (event.kind === "parallel.fan_out" || event.kind === "parallel.fan_in") {
		metadata["hatch.span_type"] = "parallel";
		metadata["hatch.parallel_phase"] = event.kind === "parallel.fan_out" ? "fan_out" : "fan_in";
		return;
	}
	if (event.kind.startsWith("guard.") || event.kind === "stage.skip") {
		metadata["hatch.span_type"] = "gate";
		metadata.gate_name = metadata.gate_name || deriveGateName(event);
		metadata.gate_outcome = metadata.gate_outcome || deriveGateOutcome(event, metadata);
		metadata.gate_evidence_ref = metadata.gate_evidence_ref || deriveGateEvidenceRef(event, metadata, args);
		return;
	}
	if (event.kind === "quality.signal") {
		metadata["hatch.span_type"] = "quality_signal";
		metadata.gate_name = metadata.gate_name || "quality.signal";
		metadata.gate_outcome = metadata.gate_outcome || deriveGateOutcome(event, metadata);
		metadata.gate_evidence_ref = metadata.gate_evidence_ref || deriveGateEvidenceRef(event, metadata, args);
		return;
	}
	if (event.kind === TRANSPORT_EVENT_KIND) {
		metadata["hatch.span_type"] = "telemetry_transport";
		return;
	}
	metadata["hatch.span_type"] = "lifecycle";
}

function deriveGateName(event: Event): string {
	if (event.kind === "stage.skip") return "guard.stage_skip";
	if (event.kind.startsWith("guard.")) return event.kind;
	if (event.kind === "quality.signal") return "quality.signal";
	return `gate.${event.kind}`;
}

function deriveGateOutcome(event: Event, metadata: Record<string, string>): string {
	const explicit = String(metadata.gate_outcome || "").trim().toLowerCase();
	if (explicit === "pass" || explicit === "fail") return explicit;
	const qualityOutcome = String(metadata.quality_outcome || metadata.langfuse_quality_outcome || "").trim().toLowerCase();
	if (qualityOutcome === "pass" || qualityOutcome === "fail") return qualityOutcome;
	const allowed = String(metadata.allowed || "").trim().toLowerCase();
	if (allowed === "true") return "pass";
	if (allowed === "false") return "fail";
	return deriveEventOutcome(event.kind, metadata, Boolean(metadata["hatch.has_error"] === "true"));
}

function deriveGateEvidenceRef(
	event: Event,
	metadata: Record<string, string>,
	args: { sessionId: string; traceId: string; graphId: string; nodeId: string },
): string {
	const explicit = String(metadata.gate_evidence_ref || "").trim();
	if (explicit) return explicit;
	const artifactPath = String(metadata.artifact_path || metadata["hatch.event_data.artifact_path"] || "").trim();
	if (artifactPath) return `uri:file://${artifactPath}`;
	return `synthetic:${args.graphId}:${event.kind}:${args.nodeId}:${args.sessionId}:${args.traceId}`;
}

function extractPrompt(event: Event): string {
	if (!event.intent || !event.intent.data || typeof event.intent.data !== "object") return "";
	const raw = (event.intent.data as Record<string, unknown>)["prompt"];
	if (typeof raw !== "string") return "";
	return raw;
}

function buildSessionDurationKey(runId: string, event: SessionTelemetryEvent, sessionId: string): string {
	const family = event.eventType.replace(/_(start|end)$/, "");
	return `${runId}:${event.handlerType}:${event.nodeId}:${sessionId}:${event.toolName || ""}:${family}`;
}

function isTrustParticipatingHandler(handlerType: string): boolean {
	return (
		handlerType === "tool" ||
		handlerType === "stack.manager_loop" ||
		handlerType === "agent.worktree" ||
		handlerType === "agent.kw"
	);
}

function buildLangfuseTraceName(defaultGraphId: string, metadata: Record<string, string>): string {
	const langfuseType = String(metadata["langfuse_type"] || "").trim();
	const skill = firstNonEmpty([
		metadata["langfuse_skill"],
		metadata["skill"],
		metadata["skill_id"],
	]).replace(/\s+/g, "_");
	if (skill && langfuseType === "generation") {
		return `llm.generation:${skill}`;
	}
	if (skill && langfuseType === "session_event") {
		return `llm.session:${skill}`;
	}
	return `pipeline.graph:${defaultGraphId}`;
}

function buildLangfuseTags(metadata: Record<string, string>): string[] {
	const tags = new Set<string>();
	for (const [key, value] of Object.entries(metadata)) {
		const normalizedValue = String(value || "").trim();
		if (!normalizedValue) continue;
		if (key.startsWith("langfuse_tag_")) {
			tags.add(`${key.slice("langfuse_tag_".length)}:${normalizedValue}`);
		}
	}

	addLangfuseTag(tags, "factory", metadata["factory"] || metadata["hatch.factory"]);
	addLangfuseTag(tags, "factory_id", metadata["factory_id"] || metadata["hatch.factory_id"]);
	addLangfuseTag(tags, "graph", metadata["graph_id"] || metadata["hatch.graph_id"]);
	addLangfuseTag(tags, "node", metadata["node_id"] || metadata["hatch.node_id"]);
	addLangfuseTag(tags, "handler", metadata["handler_type"] || metadata["langfuse_handler_type"] || metadata["hatch.handler_type"]);
	addLangfuseTag(tags, "skill", metadata["langfuse_skill"] || metadata["skill"] || metadata["skill_id"]);
	addLangfuseTag(tags, "role", metadata["agent_role"]);
	addLangfuseTag(tags, "model", metadata["langfuse_model"] || metadata["model"]);
	addLangfuseTag(tags, "provider", metadata["langfuse_provider"] || metadata["provider"]);
	addLangfuseTag(tags, "outcome", metadata["langfuse_outcome"] || metadata["outcome"] || metadata["hatch.outcome"]);
	addLangfuseTag(tags, "failure_class", metadata["langfuse_failure_class"]);
	addLangfuseTag(tags, "retry_class", metadata["hatch.retry_class"]);
	addLangfuseTag(tags, "llm_path_id", metadata["langfuse_tag_llm_path_id"] || metadata["llm_path_id"] || metadata["hatch.llm_path_id"]);

	const attempt = Number(String(metadata["langfuse_attempt_index"] || metadata["attempt"] || metadata["hatch.attempt"] || "").trim());
	if (Number.isFinite(attempt) && attempt > 0) {
		tags.add(`retry:${attempt > 1 ? "true" : "false"}`);
	}

	return [...tags].sort();
}

function addLangfuseTag(tags: Set<string>, key: string, value: string | undefined): void {
	const normalizedValue = String(value || "").trim();
	if (!normalizedValue) return;
	tags.add(`${key}:${normalizedValue}`);
}

function firstNonEmpty(values: Array<string | undefined>): string {
	for (const value of values) {
		const normalized = String(value || "").trim();
		if (normalized) return normalized;
	}
	return "";
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function parseBooleanFlag(raw: string | undefined): boolean | undefined {
	if (raw === undefined) return undefined;
	const normalized = String(raw).trim().toLowerCase();
	if (!normalized) return undefined;
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return undefined;
}

function parsePositiveIntWithWarning(
	raw: string | undefined,
	fallback: number,
	envKey: string,
	warn: (message: string) => void,
): number {
	if (raw === undefined || String(raw).trim() === "") return fallback;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		warn(`[telemetry.langfuse] invalid ${envKey}="${raw}"; using fallback=${fallback}`);
		return fallback;
	}
	return Math.floor(parsed);
}

function defaultWarn(message: string): void {
	console.warn(message);
}

function resolveGraphId(pipelineFile: string, graphName: string): string {
	const raw = String(pipelineFile || "").trim();
	if (!raw) return String(graphName || "").trim();
	if (!raw.startsWith("/")) return raw;
	const repoRoot = findRepoRootFrom(dirname(raw));
	const rel = relative(repoRoot, raw);
	if (!rel || rel.startsWith("..")) return raw.split(sep).join("/");
	return rel.split(sep).join("/");
}

function findRepoRootFrom(startDir: string): string {
	let current = resolve(startDir);
	let previous = "";
	while (current && current !== previous) {
		if (existsSync(`${current}/.git`) || existsSync(`${current}/package.json`)) return current;
		previous = current;
		current = dirname(current);
	}
	return resolve(startDir);
}

function buildScopedId(graphId: string, localId: string | undefined): string {
	const local = String(localId || "").trim();
	if (!local) return "";
	return `${graphId}:${local}`;
}
