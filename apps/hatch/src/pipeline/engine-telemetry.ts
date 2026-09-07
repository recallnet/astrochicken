import { createHash } from "node:crypto";

import {
	type Event,
	EventBus,
	buildUniversalEventData,
	collectFactoryTelemetryMetadata,
	deriveAbstractionLevel,
	deriveEventOutcome,
	deriveTelemetryPhase,
	deriveSessionId,
	type FactoryMetadataProvider,
} from "@recallnet/factory-telemetry";

import { nodeClass, nodeHandlerType, nodePrompt, nodeTrustPartition } from "./graph.js";
import { resolveModelPolicyTelemetryFields } from "./model-policy-telemetry.js";
import {
	applyTelemetryBenchmarkIdentity,
	assertBenchmarkIdentityContract,
	resolveTelemetryBenchmarkIdentity,
} from "./telemetry-benchmark-identity.js";

import type { Context } from "./context.js";
import type { Graph } from "./graph.js";
import type { RunState } from "./run.js";

const LANGFUSE_NODE_CONTEXT_PREFIX = "langfuse";

function normalizeNodeScope(nodeId: string): string {
	const cleaned = String(nodeId || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
	return cleaned || "unknown_node";
}

function langfuseNodeContextKey(nodeId: string, field: string): string {
	return `${LANGFUSE_NODE_CONTEXT_PREFIX}:${normalizeNodeScope(nodeId)}:${field}`;
}

interface SessionContextView {
	langfuse_session_id: string;
	langfuse_skill_id: string;
	langfuse_prompt_hash: string;
	langfuse_attempt_index: string;
}

function readSessionContext(ctx: Context, nodeId: string): SessionContextView {
	const scopedNodeId = normalizeNodeScope(nodeId);
	const rawAttempt = String(ctx.get(langfuseNodeContextKey(scopedNodeId, "attempt_index")) || "").trim();
	const parsedAttempt = Number(rawAttempt);
	return {
		langfuse_session_id: String(ctx.get(langfuseNodeContextKey(scopedNodeId, "session_id")) || "").trim(),
		langfuse_skill_id: String(ctx.get(langfuseNodeContextKey(scopedNodeId, "skill_id")) || "").trim(),
		langfuse_prompt_hash: String(ctx.get(langfuseNodeContextKey(scopedNodeId, "prompt_hash")) || "").trim(),
		langfuse_attempt_index: Number.isFinite(parsedAttempt) && parsedAttempt > 0 ? String(Math.floor(parsedAttempt)) : "1",
	};
}

function computePromptHash(prompt: string): string {
	return `sha256:${createHash("sha256").update(String(prompt || "")).digest("hex")}`;
}

function resolveTraceId(runId: string, handlerType: string, sessionKey: string): string {
	const seed = `${runId}:${handlerType}:${sessionKey}`;
	const hash = createHash("sha256").update(seed).digest("hex").slice(0, 16);
	return `lf_trace_${hash}`;
}

const ENRICHED_TELEMETRY_EVENT_KINDS = new Set<Event["kind"]>([
	"stage.start",
	"stage.finish",
	"stage.error",
	"stage.retry",
	"stage.skip",
	"edge.selected",
	"parallel.fan_out",
	"parallel.fan_in",
	"guard.decision",
	"guard.transition",
	"guard.reset",
	"quality.signal",
	"fast-route.branch",
]);

export class EngineEventBus extends EventBus {
	private readonly sink: EventBus;
	private readonly enrich: (event: Omit<Event, "timestamp"> & { timestamp?: Date }) => Omit<Event, "timestamp"> & { timestamp?: Date };

	constructor(
		sink: EventBus,
		enrich: (event: Omit<Event, "timestamp"> & { timestamp?: Date }) => Omit<Event, "timestamp"> & { timestamp?: Date },
	) {
		super();
		this.sink = sink;
		this.enrich = enrich;
	}

	override emit(event: Omit<Event, "timestamp"> & { timestamp?: Date }): void {
		this.sink.emit(this.enrich(event));
	}

	override on(handler: (event: Event) => void): () => void {
		return this.sink.on(handler);
	}

	override off(handler: (event: Event) => void): void {
		this.sink.off(handler);
	}
}

interface EnrichTelemetryContext {
	graph: Graph;
	graphId: string;
	pipelineFile: string;
	context: Context;
	runState?: RunState;
	factoryMetadataProvider?: FactoryMetadataProvider;
	nextTelemetrySequence: () => number;
	latestAttemptForNode: (nodeId: string) => number;
}

function inferHandlerTypeForEvent(kind: Event["kind"]): string {
	if (kind === "parallel.fan_out" || kind === "parallel.fan_in") return kind;
	if (kind.startsWith("guard.")) return "guard";
	if (kind.startsWith("stage.")) return "stage";
	return "pipeline";
}

function stageDurationContextKey(nodeId: string): string {
	return `__telemetry_stage_started_at:${nodeId || "pipeline"}`;
}

function expandNodeSessionId(rawSessionId: string, context: Context): string {
	if (!rawSessionId.includes("${")) return rawSessionId;
	const lookup = context.lookup();
	return rawSessionId.replaceAll(/\$\{([^}]+)\}/g, (_match, key: string) => lookup(String(key)));
}

function resolveTelemetryAttempt(rawAttempt: string | undefined, nodeId: string, latestAttemptForNode: (nodeId: string) => number): string {
	const normalized = Number(rawAttempt || "");
	return Number.isFinite(normalized) && normalized > 0
		? String(Math.floor(normalized))
		: (nodeId ? String(latestAttemptForNode(nodeId)) : "1");
}

export function enrichTelemetryEvent(
	event: Omit<Event, "timestamp"> & { timestamp?: Date },
	ctx: EnrichTelemetryContext,
): Omit<Event, "timestamp"> & { timestamp?: Date } {
	if (!ENRICHED_TELEMETRY_EVENT_KINDS.has(event.kind)) return event;
	const data = { ...(event.data || {}) };
	const nodeId = String(event.nodeId || event.edgeFrom || "").trim();
	const node = nodeId ? ctx.graph.nodes[nodeId] : undefined;
	const handlerType = String(data.handler_type || (node ? nodeHandlerType(node) : inferHandlerTypeForEvent(event.kind))).trim() || "pipeline";
	const nodeSessionContext = nodeId ? readSessionContext(ctx.context, nodeId) : {
		langfuse_session_id: "",
		langfuse_skill_id: "",
		langfuse_prompt_hash: "",
		langfuse_attempt_index: "1",
	};
	const attempt = resolveTelemetryAttempt(String(data.attempt || data.langfuse_attempt_index || ""), nodeId, ctx.latestAttemptForNode);
	const runId = String(data.run_id || ctx.context.get("__run_id") || ctx.runState?.runId || "no_run_id");
	const model = String(data.model || node?.attrs["llm_model"] || node?.attrs["agent_model"] || "");
	const provider = String(data.provider || node?.attrs["llm_provider"] || node?.attrs["agent_provider"] || data.langfuse_provider || "");
	const promptHash = String(data.prompt_hash || data.langfuse_prompt_hash || nodeSessionContext.langfuse_prompt_hash || ctx.context.get("prompt_hash") || (node ? computePromptHash(nodePrompt(node)) : ""));
	const explicitNodeSessionId = node
		? expandNodeSessionId(String(node.attrs["session_id"] || "").trim(), ctx.context)
		: "";
	const skill = String(data.skill || data.langfuse_skill || nodeSessionContext.langfuse_skill_id || data.quality_skill || handlerType);
	const benchmarkIdentity = resolveTelemetryBenchmarkIdentity({
		data,
		nodeAttrs: node?.attrs,
		nodeSessionContext,
		ctx: ctx.context,
		skill,
		handlerType,
	});
	const { jobId, promptVersion, roleVersion, skillId } = benchmarkIdentity;
	const skillVersion = String(data.skill_version || ctx.context.get("skill_version") || "");
	const outcome = deriveEventOutcome(event.kind, data, Boolean(event.error));
	const sequence = ctx.nextTelemetrySequence();
	const sessionId = String(
		data.session_id
		|| data.langfuse_session_id
		|| nodeSessionContext.langfuse_session_id
		|| explicitNodeSessionId
		|| deriveSessionId({
			runId,
			handlerType,
			nodeId: nodeId || event.kind,
			attempt,
			sequence,
		}),
	);
	const derivedTraceId = String(
		data.langfuse_trace_id || resolveTraceId(runId, handlerType, `${sessionId}:${attempt}`),
	);
	const trustPartition = String(data.trust_partition || (node ? nodeTrustPartition(node) : "builder"));
	const fallbackTraceId = `${trustPartition === "judge" ? "judge" : "builder"}-${String(sequence).padStart(6, "0")}`;
	const factoryMetadata = collectFactoryTelemetryMetadata(ctx.context.all(), ctx.factoryMetadataProvider);
	const parentRunId = String(data.parent_run_id || ctx.context.get("__parent_run_id") || "");
	const parentGraphId = String(data.parent_graph_id || ctx.context.get("__parent_graph_id") || "");
	const parentTraceId = String(data.parent_trace_id || ctx.context.get("__parent_trace_id") || "");
	const rootRunId = String(data.root_run_id || ctx.context.get("__root_run_id") || runId);
	const rootGraphId = String(data.root_graph_id || ctx.context.get("__root_graph_id") || ctx.graphId || "");
	const lineageDepth = String(data.lineage_depth || ctx.context.get("__lineage_depth") || "0");
	const abstractionLevel = deriveAbstractionLevel({
		graphId: ctx.graphId,
		graphName: ctx.graph.name,
		nodeId: nodeId || event.kind,
		handlerType,
	});
	const phase = deriveTelemetryPhase({
		graphId: ctx.graphId,
		graphName: ctx.graph.name,
		nodeId: nodeId || event.kind,
		handlerType,
	});
	const universalData = buildUniversalEventData({
		runId,
		graphName: ctx.graph.name,
		graphId: ctx.graphId,
		nodeId: nodeId || event.kind,
		handlerType,
		skill,
		skillId,
		skillVersion,
		jobId,
		promptVersion,
		roleVersion,
		model,
		provider,
		promptHash,
		attempt,
		outcome,
		sessionId,
		langfuseTraceId: derivedTraceId,
		factoryMetadata,
		abstractionLevel,
		phase,
		phaseNodeId: nodeId || event.kind,
		parentRunId,
		parentGraphId,
		parentTraceId,
		rootRunId,
		rootGraphId,
		lineageDepth,
	} as Parameters<typeof buildUniversalEventData>[0]);
	const enrichedData: Record<string, string> = {
		...universalData,
		...data,
	};
	const role = String(data.role || (node ? nodeClass(node) : "")).trim();
	const llmPathId = String(data.llm_path_id || node?.attrs["llm_path_id"] || "").trim();
	const systemPromptSource = String(data.system_prompt_source || node?.attrs["system_prompt_source"] || "").trim();
	const taskPromptSource = String(data.task_prompt_source || node?.attrs["task_prompt_source"] || "").trim();
	const promptSource = String(data.prompt_source || node?.attrs["prompt_source"] || taskPromptSource || "").trim();
	const promptFamily = String(data.prompt_family || promptSource || taskPromptSource).trim();
	const resolvedSessionId = String(enrichedData["hatch.session_id"] || nodeSessionContext.langfuse_session_id || sessionId);
	const resolvedAttempt = String(enrichedData["hatch.attempt"] || (resolvedSessionId ? nodeSessionContext.langfuse_attempt_index : "") || attempt || "1");
	enrichedData["hatch.session_id"] = resolvedSessionId;
	enrichedData["hatch.attempt"] = resolvedAttempt;
	enrichedData["hatch.prompt_hash"] = String(enrichedData["hatch.prompt_hash"] || promptHash || "");
	if (role) {
		enrichedData.role = String(enrichedData.role || role);
		enrichedData["hatch.role"] = String(enrichedData["hatch.role"] || enrichedData.role || role);
	}
	if (llmPathId) {
		enrichedData.llm_path_id = String(enrichedData.llm_path_id || llmPathId);
		enrichedData["hatch.llm_path_id"] = String(enrichedData["hatch.llm_path_id"] || enrichedData.llm_path_id || llmPathId);
	}
	if (promptSource) {
		enrichedData.prompt_source = String(enrichedData.prompt_source || promptSource);
		enrichedData["hatch.prompt_source"] = String(enrichedData["hatch.prompt_source"] || enrichedData.prompt_source || promptSource);
	}
	if (taskPromptSource) {
		enrichedData.task_prompt_source = String(enrichedData.task_prompt_source || taskPromptSource);
		enrichedData["hatch.task_prompt_source"] = String(
			enrichedData["hatch.task_prompt_source"] || enrichedData.task_prompt_source || taskPromptSource,
		);
	}
	if (systemPromptSource) {
		enrichedData.system_prompt_source = String(enrichedData.system_prompt_source || systemPromptSource);
		enrichedData["hatch.system_prompt_source"] = String(
			enrichedData["hatch.system_prompt_source"] || enrichedData.system_prompt_source || systemPromptSource,
		);
	}
	if (promptFamily) {
		enrichedData.prompt_family = String(enrichedData.prompt_family || promptFamily);
		enrichedData["hatch.prompt_family"] = String(enrichedData["hatch.prompt_family"] || enrichedData.prompt_family || promptFamily);
	}

	const modelPolicyTelemetry = resolveModelPolicyTelemetryFields({
		eventData: data,
		context: ctx.context,
		nodeAttrs: node?.attrs,
	});
	if (modelPolicyTelemetry) {
		Object.assign(enrichedData, modelPolicyTelemetry);
	}

	applyTelemetryBenchmarkIdentity(enrichedData, benchmarkIdentity);
	const benchmarkViolation = assertBenchmarkIdentityContract({ eventKind: event.kind, data: enrichedData, nodeAttrs: node?.attrs });
	if (benchmarkViolation) {
		enrichedData["benchmark_identity_violation"] = benchmarkViolation.message;
	}
	if (event.kind === "stage.start" && nodeId) {
		ctx.context.set(stageDurationContextKey(nodeId), String((event.timestamp ?? new Date()).getTime()));
	} else if (
		nodeId
		&& (event.kind === "stage.finish" || event.kind === "stage.error" || event.kind === "stage.retry" || event.kind === "stage.skip")
	) {
		const startedAt = Number(ctx.context.get(stageDurationContextKey(nodeId)) || "");
		if (Number.isFinite(startedAt) && startedAt > 0) {
			enrichedData.duration_ms = String(Math.max(0, (event.timestamp ?? new Date()).getTime() - startedAt));
			enrichedData["hatch.duration_ms"] = enrichedData.duration_ms;
		}
		if (event.kind !== "stage.retry") {
			ctx.context.set(stageDurationContextKey(nodeId), "");
		}
	}
	if (!enrichedData.model_provider) {
		enrichedData.model_provider = universalData.model_provider || "unknown";
	}
	if (!enrichedData["hatch.model_provider"]) {
		enrichedData["hatch.model_provider"] = universalData["hatch.model_provider"] || "unknown";
	}
	return {
		...event,
		traceId: event.traceId || fallbackTraceId,
		data: enrichedData,
	};
}
