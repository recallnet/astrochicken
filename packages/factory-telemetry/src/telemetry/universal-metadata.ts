import type { EventKind } from "../events.js";

const FACTORY_CONTEXT_JSON_KEYS = ["factory_context", "telemetry_factory_context", "factory_ctx"] as const;
const FACTORY_CONTEXT_ALLOWLIST = [
	"factory",
	"factory_id",
	"repo",
	"owner",
	"issue_number",
	"issue_id",
	"issue_title",
	"milestone_title",
	"milestone_number",
	"wave",
	"wave_id",
	"wave_issue",
	"branch",
	"worktree_dir",
	"agent_session_id",
	"wave_sessions_dir",
	"goal_issue",
	"goal_number",
	"goal_id",
	"hypothesis_id",
] as const;

export type FactoryMetadataProvider = (context: Record<string, string>) => Record<string, string>;

export interface FactoryTelemetryIdentity {
	factory?: string;
	factory_id?: string;
	repo?: string;
}

export function factoryMetadataProviderFromIdentity(identity: FactoryTelemetryIdentity): FactoryMetadataProvider {
	const normalized = {
		factory: String(identity.factory || "").trim(),
		factory_id: String(identity.factory_id || "").trim(),
		repo: String(identity.repo || "").trim(),
	};
	return () => {
		const out: Record<string, string> = {};
		if (normalized.factory) out.factory = normalized.factory;
		if (normalized.factory_id) out.factory_id = normalized.factory_id;
		if (normalized.repo) out.repo = normalized.repo;
		return out;
	};
}

export interface UniversalEventDataArgs {
	runId: string;
	graphName: string;
	graphId: string;
	nodeId: string;
	handlerType: string;
	skill: string;
	skillId: string;
	skillVersion: string;
	jobId: string;
	promptVersion: string;
	roleVersion: string;
	model: string;
	provider: string;
	promptHash: string;
	attempt: string;
	outcome: string;
	sessionId: string;
	langfuseTraceId: string;
	factoryMetadata: Record<string, string>;
	abstractionLevel?: string;
	phase?: string;
	phaseNodeId?: string;
	parentRunId?: string;
	parentGraphId?: string;
	parentTraceId?: string;
	rootRunId?: string;
	rootGraphId?: string;
	lineageDepth?: string;
}

export function collectFactoryTelemetryMetadata(
	context: Record<string, string> | undefined,
	provider?: FactoryMetadataProvider,
): Record<string, string> {
	const out: Record<string, string> = {};
	if (context) {
		for (const key of FACTORY_CONTEXT_JSON_KEYS) {
			const raw = String(context[key] || "").trim();
			if (!raw) continue;
			const parsed = parseJsonObject(raw);
			if (!parsed) continue;
			for (const [entryKey, value] of Object.entries(parsed)) {
				const normalized = normalizeTelemetryValue(value);
				if (normalized !== "") out[entryKey] = normalized;
			}
		}

		for (const key of FACTORY_CONTEXT_ALLOWLIST) {
			const raw = String(context[key] || "").trim();
			if (!raw) continue;
			out[key] = raw;
		}

		for (const [key, value] of Object.entries(context)) {
			if (!key.startsWith("factory_")) continue;
			if (FACTORY_CONTEXT_JSON_KEYS.includes(key as (typeof FACTORY_CONTEXT_JSON_KEYS)[number])) continue;
			const normalized = normalizeTelemetryValue(value);
			if (normalized !== "") out[key] = normalized;
		}
	}

	if (provider && context) {
		const provided = provider(context);
		for (const [key, value] of Object.entries(provided || {})) {
			const normalized = normalizeTelemetryValue(value);
			if (normalized !== "") out[key] = normalized;
		}
	}
	return out;
}

export function buildUniversalEventData(args: UniversalEventDataArgs): Record<string, string> {
	const modelProvider = resolveModelProvider(args.provider, args.model);
	const factory = String(args.factoryMetadata.factory || "").trim();
	const factoryId = String(args.factoryMetadata.factory_id || "").trim();
	const repo = String(args.factoryMetadata.repo || "").trim();
	const jobId = String(args.jobId || "").trim();
	const promptVersion = String(args.promptVersion || "").trim();
	const roleVersion = String(args.roleVersion || "").trim();
	const skillId = String(args.skillId || "").trim();
	const abstractionLevel = String(args.abstractionLevel || "").trim();
	const phase = String(args.phase || "").trim();
	const phaseNodeId = String(args.phaseNodeId || args.nodeId || "").trim();
	const parentRunId = String(args.parentRunId || "").trim();
	const parentGraphId = String(args.parentGraphId || "").trim();
	const parentTraceId = String(args.parentTraceId || "").trim();
	const rootRunId = String(args.rootRunId || "").trim();
	const rootGraphId = String(args.rootGraphId || "").trim();
	const lineageDepth = String(args.lineageDepth || "").trim();
	const out: Record<string, string> = {
		run_id: args.runId,
		graph: args.graphName,
		graph_id: args.graphId,
		node_id: args.nodeId,
		handler_type: args.handlerType,
		skill: args.skill,
		skill_version: args.skillVersion,
		model: args.model,
		provider: args.provider,
		prompt_hash: args.promptHash,
		attempt: args.attempt,
		outcome: args.outcome,
		session_id: args.sessionId,
		langfuse_trace_id: args.langfuseTraceId,
		model_provider: modelProvider,
		"hatch.run_id": args.runId,
		"hatch.graph": args.graphName,
		"hatch.graph_id": args.graphId,
		"hatch.node_id": args.nodeId,
		"hatch.handler_type": args.handlerType,
		"hatch.skill": args.skill,
		"hatch.skill_version": args.skillVersion,
		"hatch.model": args.model,
		"hatch.provider": args.provider,
		"hatch.prompt_hash": args.promptHash,
		"hatch.attempt": args.attempt,
		"hatch.outcome": args.outcome,
		"hatch.session_id": args.sessionId,
		"hatch.trace_id": args.langfuseTraceId,
		"hatch.model_provider": modelProvider,
		"hatch.tag.factory": factory || "none",
		"hatch.tag.factory_id": factoryId || "none",
		"hatch.tag.handler_type": args.handlerType || "unknown",
		"hatch.tag.model_provider": modelProvider || "unknown",
		"hatch.tag.outcome": normalizeOutcomeTag(args.outcome),
	};
	if (abstractionLevel) {
		out.abstraction_level = abstractionLevel;
		out["hatch.abstraction_level"] = abstractionLevel;
	}
	if (phase) {
		out.phase = phase;
		out["hatch.phase"] = phase;
	}
	if (phaseNodeId) {
		out.phase_node_id = phaseNodeId;
		out["hatch.phase_node_id"] = phaseNodeId;
	}
	if (parentRunId) {
		out.parent_run_id = parentRunId;
		out["hatch.parent_run_id"] = parentRunId;
	}
	if (parentGraphId) {
		out.parent_graph_id = parentGraphId;
		out["hatch.parent_graph_id"] = parentGraphId;
	}
	if (parentTraceId) {
		out.parent_trace_id = parentTraceId;
		out["hatch.parent_trace_id"] = parentTraceId;
	}
	if (rootRunId) {
		out.root_run_id = rootRunId;
		out["hatch.root_run_id"] = rootRunId;
	}
	if (rootGraphId) {
		out.root_graph_id = rootGraphId;
		out["hatch.root_graph_id"] = rootGraphId;
	}
	if (lineageDepth) {
		out.lineage_depth = lineageDepth;
		out["hatch.lineage_depth"] = lineageDepth;
	}
	if (factory) {
		out.factory = factory;
		out["hatch.factory"] = factory;
	}
	if (factoryId) {
		out.factory_id = factoryId;
		out["hatch.factory_id"] = factoryId;
	}
	if (repo) {
		out.repo = repo;
		out["hatch.repo"] = repo;
	}
	if (skillId) {
		out.skill_id = skillId;
		out["hatch.skill_id"] = skillId;
	}
	if (jobId) {
		out.job_id = jobId;
		out["hatch.job_id"] = jobId;
	}
	if (promptVersion) {
		out.prompt_version = promptVersion;
		out["hatch.prompt_version"] = promptVersion;
	}
	if (roleVersion) {
		out.role_version = roleVersion;
		out["hatch.role_version"] = roleVersion;
	}
	for (const [key, value] of Object.entries(args.factoryMetadata)) {
		const normalizedKey = sanitizeMetadataKey(key);
		if (!normalizedKey) continue;
		out[`factory.${normalizedKey}`] = value;
		out[`hatch.factory_meta.${normalizedKey}`] = value;
	}
	return out;
}

export function resolveModelProvider(provider: string, model: string): string {
	const explicit = String(provider || "").trim().toLowerCase();
	if (explicit) return explicit;
	const normalizedModel = String(model || "").trim().toLowerCase();
	if (!normalizedModel) return "unknown";
	if (normalizedModel.includes("claude") || normalizedModel.includes("anthropic")) return "anthropic";
	if (normalizedModel.includes("gpt") || normalizedModel.includes("openai")) return "openai";
	if (normalizedModel.includes("gemini") || normalizedModel.includes("google")) return "google";
	if (normalizedModel.includes("llama") || normalizedModel.includes("meta")) return "meta";
	return "unknown";
}

export function deriveEventOutcome(eventKind: EventKind, data: Record<string, string> | undefined, hasError: boolean): string {
	if (hasError || eventKind === "stage.error" || eventKind === "pipeline.error") return "fail";
	if (eventKind === "stage.finish") return "pass";
	if (eventKind === "stage.retry") return "retry";
	if (eventKind === "stage.skip") return "skip";
	if (eventKind.startsWith("guard.")) {
		const gateOutcome = String(data?.gate_outcome || "").trim().toLowerCase();
		if (gateOutcome === "pass" || gateOutcome === "fail") return gateOutcome;
		const allowed = String(data?.allowed || "").trim().toLowerCase();
		if (allowed === "true") return "pass";
		if (allowed === "false") return "fail";
		return "observe";
	}
	if (eventKind === "quality.signal") {
		const qualityOutcome = String(data?.quality_outcome || data?.langfuse_quality_outcome || "").trim().toLowerCase();
		if (qualityOutcome === "pass" || qualityOutcome === "fail") return qualityOutcome;
		return "observe";
	}
	if (eventKind === "edge.selected") return "route";
	if (eventKind === "parallel.fan_out" || eventKind === "parallel.fan_in") return "parallel";
	return "observe";
}

export function deriveSessionId(args: {
	runId: string;
	handlerType: string;
	nodeId: string;
	attempt: string;
	sequence: number;
}): string {
	const runId = String(args.runId || "no_run_id").trim() || "no_run_id";
	const handlerType = String(args.handlerType || "pipeline").trim() || "pipeline";
	const nodeId = String(args.nodeId || "pipeline").trim() || "pipeline";
	const attempt = String(args.attempt || "1").trim() || "1";
	return `run:${runId}:handler:${handlerType}:node:${nodeId}:attempt:${attempt}`;
}

export function deriveAbstractionLevel(args: { graphId?: string; graphName?: string; nodeId?: string; handlerType?: string }): string {
	const graphId = `${String(args.graphId || "").trim().toLowerCase()} ${String(args.graphName || "").trim().toLowerCase()}`.trim();
	const nodeId = String(args.nodeId || "").trim().toLowerCase();
	const handlerType = String(args.handlerType || "").trim().toLowerCase();
	const haystack = `${graphId} ${nodeId} ${handlerType}`;
	if (haystack.includes("factory_supervisor_tick")) return "supervisor";
	if (haystack.includes("goal_queue")) return "goal_queue";
	if (haystack.includes("goal_run")) return "goal";
	if (haystack.includes("wave_dispatch")) return "wave_dispatch";
	if (haystack.includes("wave_execute")) return "wave";
	if (haystack.includes("issue_execute")) return "issue";
	if (haystack.includes("merge")) return "merge";
	if (haystack.includes("review")) return "review";
	return "node";
}

export function deriveTelemetryPhase(args: { graphId?: string; graphName?: string; nodeId?: string; handlerType?: string }): string {
	const nodeId = String(args.nodeId || "").trim();
	const normalizedNode = normalizePhaseToken(nodeId);
	const graphId = String(args.graphId || "").trim();
	const graphName = String(args.graphName || "").trim();
	const handlerType = String(args.handlerType || "").trim();
	const abstractionLevel = deriveAbstractionLevel(args);
	const handlerToken = normalizePhaseToken(handlerType);

	if (hasPhaseToken(normalizedNode, ["langfuse_transport"]) || hasPhaseToken(handlerToken, ["transport"])) return "transport";
	if (handlerToken.includes("parallel")) return "parallel";

	switch (abstractionLevel) {
		case "supervisor":
			if (hasPhaseToken(normalizedNode, ["snapshot"])) return "snapshot";
			if (hasPhaseToken(normalizedNode, ["recovery", "sanitize", "sweep"])) return "recovery";
			if (hasPhaseToken(normalizedNode, ["bug"])) return "bug_triage";
			if (hasPhaseToken(normalizedNode, ["goal", "artifact"])) return "goal_queue";
			if (hasPhaseToken(normalizedNode, ["wave", "milestone"])) return "wave_dispatch";
			if (hasPhaseToken(normalizedNode, ["release"])) return "release";
			if (hasPhaseToken(normalizedNode, ["review"])) return "review";
			if (hasPhaseToken(normalizedNode, ["set", "load", "resolve", "config"])) return "bootstrap";
			break;
		case "goal_queue":
			return "goal_queue";
		case "wave_dispatch":
			return "wave_dispatch";
		case "goal":
			if (hasPhaseToken(normalizedNode, ["triage", "judge"])) return "triage";
			if (hasPhaseToken(normalizedNode, ["scenario"])) return "scenario";
			if (hasPhaseToken(normalizedNode, ["draft", "scope", "write", "payload", "issue_spec"])) return "issue_spec";
			if (hasPhaseToken(normalizedNode, ["analyze", "propose", "plan", "review"])) return "decomposition";
			if (hasPhaseToken(normalizedNode, ["execute_issue"])) return "issue_execution";
			if (hasPhaseToken(normalizedNode, ["intake"])) return "intake";
			break;
		case "wave":
			if (hasPhaseToken(normalizedNode, ["find_ready", "ready", "claim", "lock"])) return "claim";
			if (hasPhaseToken(normalizedNode, ["review", "postmortem"])) return "review";
			if (hasPhaseToken(normalizedNode, ["judge"])) return "judge";
			if (hasPhaseToken(normalizedNode, ["merge", "rebase", "conflict", "post_merge", "push_failure"])) return "merge";
			if (hasPhaseToken(normalizedNode, ["build", "implement", "execute_issue", "run_tool"])) return "implement";
			break;
		case "merge":
			return "merge";
		case "review":
			return "review";
		default:
			break;
	}

	if (nodeId) return nodeId;
	const fallbackGraphId = String(args.graphId || args.graphName || "").trim();
	if (fallbackGraphId) return fallbackGraphId;
	const fallbackHandlerType = String(args.handlerType || "").trim();
	return fallbackHandlerType || "pipeline";
}

function normalizePhaseToken(value: string): string {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

function hasPhaseToken(value: string, tokens: string[]): boolean {
	if (!value) return false;
	return tokens.some((token) => value.includes(token));
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}

function normalizeTelemetryValue(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value.trim();
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function sanitizeMetadataKey(value: string): string {
	return String(value || "")
		.trim()
		.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function normalizeOutcomeTag(outcome: string): string {
	const normalized = String(outcome || "").trim().toLowerCase();
	if (!normalized) return "observe";
	if (["pass", "fail", "retry", "skip", "route", "parallel", "observe"].includes(normalized)) return normalized;
	return "observe";
}
