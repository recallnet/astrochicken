import type { Event, EventData, EventHandler } from "./events.js";

const STAGE_EVENT_KINDS = new Set<Event["kind"]>([
	"stage.start",
	"stage.finish",
	"stage.error",
	"stage.retry",
	"stage.skip",
	"quality.signal",
	"guard.decision",
	"guard.transition",
	"parallel.fan_out",
	"parallel.fan_in",
]);

const OBSERVABLE_EVENT_KINDS = new Set<Event["kind"]>([
	...STAGE_EVENT_KINDS,
	"context.update",
	"edge.selected",
	"guard.reset",
]);
const TRACE_ID_PARTITION_PATTERN = /^(builder|judge)-/;
const BUILDER_PARTITION = "builder";
const JUDGE_PARTITION = "judge";
const PARTITION_TOKEN_REGEX: Record<"builder" | "judge", RegExp> = {
	builder: /(^|[._-])builder([._-]|$)/i,
	judge: /(^|[._-])judge([._-]|$)/i,
};
const HIGH_CARDINALITY_KEY_PATTERN = /(issue|goal|hypothesis|sha|hash|branch|artifact_path|owner_id|lease_name|run_id|commit)/i;

// NOTE: allowlisted keys are forwarded only as span metadata (not tags).
// High-cardinality values are intentionally metadata-only so gate payloads stay
// queryable without leaking raw prompt/tool content.
const METADATA_ALLOWLIST = new Set([
	"attempt",
	"agent_id",
	"agent_role",
	"trust_partition",
	"trust_domain",
	"trust_role",
	"trust_partition_key",
	"trace_partition",
	"complexity_class",
	"complexity_signals",
	"complexity_reason",
	"complexity_otel_key",
	"hatch.complexity.class",
	"hatch.execution.path",
	"path_taken",
	"hatch.merge.resolver",
	"hatch.session_id",
	"hatch.role",
	"hatch.skill_id",
	"hatch.job_id",
	"hatch.prompt_version",
	"hatch.role_version",
	"hatch.prompt_family",
	"hatch.prompt_source",
	"hatch.task_prompt_source",
	"hatch.system_prompt_source",
	"hatch.prompt_hash",
	"hatch.llm_path_id",
	"hatch.attempt",
	"hatch.retry_class",
	"hatch.first_attempt_pass",
	"hatch.kpi.quality.skill",
	"hatch.kpi.retry.failure_class",
	"factory",
	"factory_id",
	"repo",
	"graph",
	"graph_id",
	"node_id",
	"run_id",
	"session_id",
	"role",
	"outcome",
	"handler_type",
	"model",
	"provider",
	"model_provider",
	"prompt_hash",
	"llm_path_id",
	"skill_id",
	"job_id",
	"prompt_version",
	"role_version",
	"prompt_family",
	"prompt_source",
	"task_prompt_source",
	"system_prompt_source",
	"hatch.tag.factory",
	"hatch.tag.factory_id",
	"hatch.factory_id",
	"hatch.tag.handler_type",
	"hatch.tag.model_provider",
	"hatch.tag.outcome",
	"quality_score",
	"quality_grade",
	"quality_reason",
	"quality_outcome",
	"quality_failure_class",
	"quality_guard_state",
	"quality_skill",
	"quality_model",
	"quality_attempt",
	"quality_schema_version",
	"langfuse_quality_score",
	"langfuse_quality_grade",
	"langfuse_quality_reason",
	"langfuse_quality_outcome",
	"langfuse_failure_class",
	"langfuse_skill",
	"langfuse_quality_model",
	"langfuse_quality_attempt",
	"langfuse_quality_schema_version",
	"langfuse_session_id",
	"langfuse_skill_id",
	"langfuse_prompt_hash",
	"langfuse_attempt_index",
	"gate_name",
	"gate_outcome",
	"gate_evidence_ref",
	"span_type",
	"allowed",
	"counter",
	"reason_code",
	"circuit_state",
	"guard_circuit_state",
	"transition",
	"policy_revision",
	"threshold",
	"scope",
	"backoff_ms",
	"next_attempt_at",
	"factory_scope",
	"worker_period",
	"artifact_path",
	"guard_trace_id",
	"edge",
	"fan_out_count",
	"max_concurrency",
	"item_count",
	"child_count",
	"failed_items",
	"parallel_phase",
]);

const spanFilterMetrics: LangfuseSpanFilterMetrics = {
	langfuse_span_dropped_partition: 0,
	langfuse_span_filter_errors: 0,
};

export interface LangfuseSpanFilterMetrics {
	langfuse_span_dropped_partition: number;
	langfuse_span_filter_errors: number;
}

export interface LangfuseSpanRecord {
	traceId: string;
	spanId: string;
	observationId: string;
	eventKind: Event["kind"];
	nodeId: string;
	startTime: string;
	metadata: Record<string, string>;
	message?: string;
	error?: string;
}

export type LangfuseSpanSink = (span: LangfuseSpanRecord) => void;

export function getLangfuseSpanFilterMetrics(): LangfuseSpanFilterMetrics {
	return { ...spanFilterMetrics };
}

export function resetLangfuseSpanFilterMetrics(): void {
	spanFilterMetrics.langfuse_span_dropped_partition = 0;
	spanFilterMetrics.langfuse_span_filter_errors = 0;
}

/**
 * Map a hatch lifecycle event into a Langfuse-compatible span record.
 *
 * This is a deterministic boundary layer between EventBus events and external
 * observability sinks. It intentionally allowlists metadata keys so sensitive
 * node-local fields cannot leak across trust domains.
 */
export function mapEventToLangfuseSpan(event: Event): LangfuseSpanRecord | null {
	if (!OBSERVABLE_EVENT_KINDS.has(event.kind)) return null;

	try {
		const traceId = resolveTraceId(event);
		const filtered = filterMetadata(event.data);
		const normalized = normalizeTrustMetadata(filtered, traceId);
		const partitionCheck = assertPartitionMatch(traceId, normalized);
		if (!partitionCheck.ok) {
			spanFilterMetrics.langfuse_span_dropped_partition += 1;
			console.warn(`[langfuse.span] dropped reason=partition_mismatch trace=${traceId} kind=${event.kind} detail=${partitionCheck.reason}`);
			return null;
		}
		const gateAnnotated = annotateGateMetadata(event, partitionCheck.metadata, partitionCheck.redactedKeys);
		const parallelAnnotated = annotateParallelMetadata(event, gateAnnotated);
		const hatchSessionAnnotated = annotateHatchSessionMetadata(parallelAnnotated);
		const metadata = attachEventTopologyMetadata(event, hatchSessionAnnotated);
		if (STAGE_EVENT_KINDS.has(event.kind) && !metadata.span_type) {
			metadata.span_type = "stage";
		}
		const observationId = `${event.kind}:${event.nodeId || "pipeline"}:${event.timestamp.toISOString()}`;
		const spanId = isLifecycleSpanPinnedToTrace(event) ? traceId : observationId;

		return {
			traceId,
			spanId,
			observationId,
			eventKind: event.kind,
			nodeId: event.nodeId || "pipeline",
			startTime: event.timestamp.toISOString(),
			metadata,
			...(event.message ? { message: event.message } : {}),
			...(event.error ? { error: event.error.message } : {}),
		};
	} catch (error) {
		spanFilterMetrics.langfuse_span_filter_errors += 1;
		console.warn(`[langfuse.span] map_error kind=${event.kind} error=${error instanceof Error ? error.message : String(error)}`);
		return null;
	}
}

export function createLangfuseSpanHandler(sink: LangfuseSpanSink): EventHandler {
	return (event: Event) => {
		try {
			const span = mapEventToLangfuseSpan(event);
			if (!span) return;
			sink(span);
		} catch (error) {
			spanFilterMetrics.langfuse_span_filter_errors += 1;
			console.warn(`[langfuse.span] handler_error kind=${event.kind} error=${error instanceof Error ? error.message : String(error)}`);
		}
	};
}

function resolveTraceId(event: Event): string {
	if (event.traceId && event.traceId.trim()) return event.traceId;
	const guardTrace = String(event.data?.guard_trace_id || "").trim();
	if (guardTrace) return guardTrace;
	const partition = inferPartitionFromData(event.data);
	if (isParallelLifecycleEvent(event)) {
		const nodePart = sanitizeKey(event.nodeId || event.data?.node_id || "pipeline");
		return `${partition}-parallel-${nodePart}`;
	}
	return `${partition}-unscoped`;
}

function inferPartitionFromData(data: EventData | undefined): string {
	const trustPartition = String(data?.trust_partition || "").trim().toLowerCase();
	if (trustPartition === BUILDER_PARTITION || trustPartition === JUDGE_PARTITION) return trustPartition;
	return BUILDER_PARTITION;
}

function inferPartitionFromTraceId(traceId: string): "builder" | "judge" {
	const match = traceId.match(TRACE_ID_PARTITION_PATTERN);
	if (!match) return BUILDER_PARTITION;
	return match[1] === JUDGE_PARTITION ? JUDGE_PARTITION : BUILDER_PARTITION;
}

function normalizeTrustMetadata(data: EventData | undefined, traceId: string): Record<string, string> {
	const trustPartition = normalizePartition(data?.trust_partition || inferPartitionFromTraceId(traceId));
	const trustDomain = String(data?.trust_domain || trustPartition);
	const trustRole = String(data?.trust_role || data?.agent_role || "unknown");
	const trustPartitionKey = String(data?.trust_partition_key || `${trustPartition}/${trustRole}`);
	const qualitySkill = String(data?.langfuse_skill || data?.quality_skill || data?.handler_type || "unknown");
	const qualityModel = String(data?.langfuse_quality_model || data?.quality_model || data?.model || "unknown");
	const qualityScore = String(data?.langfuse_quality_score || data?.quality_score || "");

	return {
		...data,
		trust_partition: trustPartition,
		trust_domain: trustDomain,
		trust_role: trustRole,
		trust_partition_key: trustPartitionKey,
		quality_skill: qualitySkill,
		quality_model: qualityModel,
		langfuse_skill: qualitySkill,
		langfuse_quality_model: qualityModel,
		...(qualityScore ? { langfuse_quality_score: qualityScore } : {}),
	};
}

function filterMetadata(data: EventData | undefined): Record<string, string> {
	if (!data) return {};
	const filtered: Record<string, string> = {};
	for (const [key, value] of Object.entries(data)) {
		if (METADATA_ALLOWLIST.has(key) || key.startsWith("complexity_signal.")) {
			filtered[key] = String(value);
			continue;
		}
		if (HIGH_CARDINALITY_KEY_PATTERN.test(key)) {
			filtered[`metadata_only.${key}`] = String(value);
		}
	}
	return filtered;
}

function assertPartitionMatch(traceId: string, metadata: Record<string, string>): {
	ok: boolean;
	reason?: string;
	metadata: Record<string, string>;
	redactedKeys: string[];
} {
	const tracePartition = inferPartitionFromTraceId(traceId);
	const eventPartition = normalizePartition(metadata.trust_partition || tracePartition);
	const rolePartition = inferPartitionFromRole(metadata.trust_role || metadata.agent_role || "");
	if (eventPartition !== tracePartition) {
		return {
			ok: false,
			reason: `trace_partition=${tracePartition} event_partition=${eventPartition}`,
			metadata,
			redactedKeys: [],
		};
	}
	if (rolePartition && rolePartition !== eventPartition) {
		return {
			ok: false,
			reason: `event_partition=${eventPartition} role_partition=${rolePartition}`,
			metadata,
			redactedKeys: [],
		};
	}

	const oppositePartition = eventPartition === BUILDER_PARTITION ? JUDGE_PARTITION : BUILDER_PARTITION;
	const redactedKeys: string[] = [];
	const sanitized: Record<string, string> = {};
	for (const [key, value] of Object.entries(metadata)) {
		if (shouldRedactPartitionKey(key, oppositePartition)) {
			redactedKeys.push(key);
			sanitized[`redacted.${sanitizeKey(key)}`] = "cross_partition_key";
			continue;
		}
		sanitized[key] = value;
	}

	return {
		ok: true,
		metadata: sanitized,
		redactedKeys,
	};
}

function shouldRedactPartitionKey(key: string, partition: "builder" | "judge"): boolean {
	if (key === "trust_partition" || key === "trust_role" || key === "trust_partition_key" || key === "trust_domain") return false;
	return PARTITION_TOKEN_REGEX[partition].test(key);
}

function annotateGateMetadata(event: Event, metadata: Record<string, string>, redactedKeys: string[]): Record<string, string> {
	const out: Record<string, string> = { ...metadata };
	if (redactedKeys.length > 0) {
		out.langfuse_partition_redactions = String(redactedKeys.length);
		out.langfuse_partition_redacted_keys = redactedKeys.sort().join(",");
	}
	if (!isGateEvent(event)) return out;

	const gateName = out.gate_name || deriveGateName(event, out);
	const gateOutcome = out.gate_outcome || deriveGateOutcome(event, out);
	const gateEvidenceRef = out.gate_evidence_ref || deriveGateEvidenceRef(event, out);
	return {
		...out,
		span_type: "gate",
		gate_name: gateName,
		gate_outcome: gateOutcome,
		gate_evidence_ref: gateEvidenceRef,
	};
}

function isGateEvent(event: Event): boolean {
	return event.kind === "stage.skip" || event.kind.startsWith("guard.");
}

function isGuardLifecycleEvent(event: Event): boolean {
	return event.kind === "guard.decision" || event.kind === "guard.transition";
}

function isParallelLifecycleEvent(event: Event): boolean {
	return event.kind === "parallel.fan_out" || event.kind === "parallel.fan_in";
}

function isLifecycleSpanPinnedToTrace(event: Event): boolean {
	return isGuardLifecycleEvent(event) || isParallelLifecycleEvent(event);
}

function annotateParallelMetadata(event: Event, metadata: Record<string, string>): Record<string, string> {
	if (!isParallelLifecycleEvent(event)) return metadata;
	// Parallel counters (fan_out_count/child_count/failed_items/max_concurrency)
	// remain metadata; tags stay low-cardinality upstream.
	const out: Record<string, string> = {
		...metadata,
		span_type: "parallel",
		parallel_phase: event.kind === "parallel.fan_out" ? "fan_out" : "fan_in",
	};
	if (!out.handler_type) out.handler_type = event.kind;
	return out;
}

function annotateHatchSessionMetadata(metadata: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = { ...metadata };
	const sessionId = String(out.langfuse_session_id || out.session_id || out["hatch.session_id"] || "").trim();
	const skillId = String(out.langfuse_skill_id || out.skill_id || out["hatch.skill_id"] || out.skill || out.langfuse_skill || "").trim();
	const jobId = String(out.job_id || out["hatch.job_id"] || "").trim();
	const promptVersion = String(out.prompt_version || out["hatch.prompt_version"] || "").trim();
	const roleVersion = String(out.role_version || out["hatch.role_version"] || "").trim();
	const promptHash = String(out.langfuse_prompt_hash || out.prompt_hash || out["hatch.prompt_hash"] || "").trim();
	const llmPathId = String(out.llm_path_id || out["hatch.llm_path_id"] || "").trim();
	const attempt = normalizeAttemptIndex(out.langfuse_attempt_index || out["hatch.attempt"] || out.attempt || "1");
	if (sessionId) out["hatch.session_id"] = sessionId;
	if (skillId) {
		out.skill_id = out.skill_id || skillId;
		out["hatch.skill_id"] = skillId;
	}
	if (jobId) {
		out.job_id = out.job_id || jobId;
		out["hatch.job_id"] = jobId;
	}
	if (promptVersion) {
		out.prompt_version = out.prompt_version || promptVersion;
		out["hatch.prompt_version"] = promptVersion;
	}
	if (roleVersion) {
		out.role_version = out.role_version || roleVersion;
		out["hatch.role_version"] = roleVersion;
	}
	if (promptHash) out["hatch.prompt_hash"] = promptHash;
	if (llmPathId) {
		out.llm_path_id = out.llm_path_id || llmPathId;
		out["hatch.llm_path_id"] = llmPathId;
	}
	out["hatch.attempt"] = attempt;
	return out;
}

function attachEventTopologyMetadata(event: Event, metadata: Record<string, string>): Record<string, string> {
	const out = { ...metadata };
	if (event.edgeFrom && event.edgeFrom.trim()) out.edge_from = event.edgeFrom;
	if (event.edgeTo && event.edgeTo.trim()) out.edge_to = event.edgeTo;
	if (!out.edge) {
		if (event.edgeFrom && event.edgeTo) out.edge = `${event.edgeFrom}->${event.edgeTo}`;
		else if (event.edgeFrom) out.edge = event.edgeFrom;
		else if (event.edgeTo) out.edge = event.edgeTo;
	}
	if (!out.node_id && event.nodeId) out.node_id = event.nodeId;
	return out;
}

function deriveGateName(event: Event, metadata: Record<string, string>): string {
	if (event.kind === "stage.skip") return "guard.stage_skip";
	const counter = String(metadata.counter || "").trim();
	if (!counter) return `guard.${event.kind.split(".")[1] || "decision"}`;
	return `guard.${counter}`;
}

function deriveGateOutcome(event: Event, metadata: Record<string, string>): "pass" | "fail" {
	const allowed = String(metadata.allowed || "").trim().toLowerCase();
	if (allowed === "true") return "pass";
	if (allowed === "false") return "fail";
	if (event.kind === "stage.skip") return "fail";
	return "pass";
}

function deriveGateEvidenceRef(event: Event, metadata: Record<string, string>): string {
	const artifactPath = String(metadata["metadata_only.artifact_path"] || metadata.artifact_path || "").trim();
	if (artifactPath) return `uri:file://${artifactPath}`;
	return `synthetic:${event.kind}:${event.nodeId || "pipeline"}:${event.timestamp.toISOString()}`;
}

function inferPartitionFromRole(role: string): "builder" | "judge" | "" {
	const normalized = String(role || "").toLowerCase();
	if (!normalized || normalized === "unknown") return "";
	if (normalized.includes("judge")) return JUDGE_PARTITION;
	return BUILDER_PARTITION;
}

function normalizePartition(value: string): "builder" | "judge" {
	return String(value || "").trim().toLowerCase() === JUDGE_PARTITION ? JUDGE_PARTITION : BUILDER_PARTITION;
}

function normalizeAttemptIndex(raw: string): string {
	const parsed = Number(String(raw || "").trim());
	if (Number.isFinite(parsed) && parsed > 0) return String(Math.floor(parsed));
	return "1";
}

function sanitizeKey(value: string): string {
	return String(value || "").replace(/[^a-zA-Z0-9_.-]/g, "_");
}
