import { createHash } from "node:crypto";

import { classifyFailureMessage, deriveQualitySignal, deriveRetryTelemetry } from "./quality.js";

import type { EventBus, IntentMetadataLike } from "./events.js";

export const LANGFUSE_GENERATION_EVENT_KIND = "telemetry.langfuse.generation";
export const LANGFUSE_SESSION_EVENT_KIND = "telemetry.langfuse.session";
export const LANGFUSE_PROMPT_TEXT_FLAG = "HATCH_LANGFUSE_INCLUDE_PROMPT_TEXT";

const TRUTHY_VALUES = new Set(["1", "true", "yes"]);
const LANGFUSE_NODE_CONTEXT_PREFIX = "langfuse";
const TRUST_PARTICIPATING_HANDLER_TYPES = new Set(["tool", "stack.manager_loop", "agent.worktree", "agent.kw"]);

export interface LangfuseNodeLike {
	id: string;
	attrs: Record<string, string>;
}

export interface LangfuseContextStore {
	get(key: string): string;
	set(key: string, value: string): void;
}

export type LangfuseSessionEventHandler = (event: unknown) => void;

/**
 * Minimal session contract consumed by telemetry binding.
 *
 * Keeps this package publish-safe without hard dependency on specific agent SDK types.
 */
export interface LangfuseSessionLike {
	subscribe(handler: LangfuseSessionEventHandler): () => void;
}

export interface LangfuseSessionContextView {
	langfuse_session_id: string;
	langfuse_skill_id: string;
	langfuse_prompt_hash: string;
	langfuse_attempt_index: string;
}

export interface LangfuseUsageMetrics {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	costInput: number;
	costOutput: number;
	costCacheRead: number;
	costCacheWrite: number;
	costTotal: number;
}

export interface LangfuseGenerationEventArgs {
	eventBus?: EventBus;
	node: LangfuseNodeLike;
	ctx: LangfuseContextStore;
	handlerType: string;
	sessionKey: string;
	attemptIndex: number;
	prompt: string;
	provider: string;
	model: string;
	outcome: "success" | "error" | "length";
	llmPathId?: string;
	usage?: Partial<LangfuseUsageMetrics>;
	errorMessage?: string;
	intent?: IntentMetadataLike;
}

export interface LangfuseSessionEventArgs {
	eventBus?: EventBus;
	node: LangfuseNodeLike;
	ctx: LangfuseContextStore;
	handlerType: string;
	sessionKey: string;
	eventType: string;
	attemptIndex?: number;
	llmPathId?: string;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	provider?: string;
	model?: string;
	usage?: Partial<LangfuseUsageMetrics>;
	intent?: IntentMetadataLike;
}

export function isLangfusePromptTextEnabled(env = process.env): boolean {
	const raw = String(env[LANGFUSE_PROMPT_TEXT_FLAG] || "").trim().toLowerCase();
	return TRUTHY_VALUES.has(raw);
}

export function computeLangfusePromptHash(prompt: string): string {
	return `sha256:${createHash("sha256").update(String(prompt || "")).digest("hex")}`;
}

export function nextLangfuseAttemptIndex(cache: Map<string, number>, chainKey: string): number {
	const current = cache.get(chainKey) ?? 0;
	const next = current + 1;
	cache.set(chainKey, next);
	return next;
}

export function resolveLangfuseTraceId(runId: string, handlerType: string, sessionKey: string): string {
	const seed = `${runId}:${handlerType}:${sessionKey}`;
	const hash = createHash("sha256").update(seed).digest("hex").slice(0, 16);
	return `lf_trace_${hash}`;
}

/**
 * Persist node-scoped Langfuse session metadata in shared pipeline context.
 *
 * The node-id namespace keeps builder/judge node metadata isolated and prevents
 * cross-node clobber when multiple handlers share one Context instance.
 */
export function recordLangfuseSessionContext(
	ctx: LangfuseContextStore,
	nodeId: string,
	sessionId: string,
	attemptIndex: number,
	promptHash: string,
	skillId: string,
): void {
	const scopedNodeId = normalizeNodeScope(nodeId);
	const attempt = Number.isFinite(attemptIndex) && attemptIndex > 0 ? String(Math.floor(attemptIndex)) : "1";
	ctx.set(langfuseNodeContextKey(scopedNodeId, "session_id"), String(sessionId || ""));
	ctx.set(langfuseNodeContextKey(scopedNodeId, "attempt_index"), attempt);
	ctx.set(langfuseNodeContextKey(scopedNodeId, "prompt_hash"), String(promptHash || ""));
	ctx.set(langfuseNodeContextKey(scopedNodeId, "skill_id"), String(skillId || ""));
}

export function readLangfuseSessionContext(ctx: LangfuseContextStore, nodeId: string): LangfuseSessionContextView {
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

export function langfuseNodeContextKey(nodeId: string, field: "session_id" | "skill_id" | "prompt_hash" | "attempt_index"): string {
	return `${LANGFUSE_NODE_CONTEXT_PREFIX}:${normalizeNodeScope(nodeId)}:${field}`;
}

export function usageFromAssistantMessage(message: any): LangfuseUsageMetrics {
	const usage = normalizeUsageObject(message);
	const cost = normalizeCostObject(message, usage);

	const inputTokens = pickNumber(usage, [
		"input",
		"inputTokens",
		"input_tokens",
		"prompt_tokens",
		"promptTokens",
		"promptTokenCount",
	]);
	const outputTokens = pickNumber(usage, [
		"output",
		"outputTokens",
		"output_tokens",
		"completion_tokens",
		"completionTokens",
		"completionTokenCount",
		"candidatesTokenCount",
	]);
	const cacheReadTokens = pickNumber(usage, [
		"cacheRead",
		"cacheReadTokens",
		"cache_read",
		"cache_read_input_tokens",
		"cached_tokens",
		"cachedContentTokenCount",
		"prompt_tokens_details.cached_tokens",
	]);
	const cacheWriteTokens = pickNumber(usage, [
		"cacheWrite",
		"cacheWriteTokens",
		"cache_write",
		"cache_creation_input_tokens",
		"cacheWriteTokenCount",
	]);
	const totalTokens = pickNumber(usage, ["totalTokens", "total_tokens", "totalTokenCount"])
		|| inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;

	const headerCost = extractHeaderCostObject(message, usage);
	const costInput = pickNumber(cost, ["input", "inputCost", "input_cost", "prompt", "promptCost"])
		|| headerCost.input
		|| 0;
	const costOutput = pickNumber(cost, ["output", "outputCost", "output_cost", "completion", "completionCost"])
		|| headerCost.output
		|| 0;
	const costCacheRead = pickNumber(cost, ["cacheRead", "cache_read", "cachedRead", "cached_read"])
		|| headerCost.cacheRead
		|| 0;
	const costCacheWrite = pickNumber(cost, ["cacheWrite", "cache_write", "cachedWrite", "cached_write"])
		|| headerCost.cacheWrite
		|| 0;
	const explicitCostTotal = pickNumber(cost, ["total", "costTotal", "totalCost", "total_cost", "usd"])
		|| headerCost.total
		|| 0;
	const computedCostTotal = costInput + costOutput + costCacheRead + costCacheWrite;
	const costTotal = explicitCostTotal || computedCostTotal;

	return {
		inputTokens,
		outputTokens,
		totalTokens,
		cacheReadTokens,
		cacheWriteTokens,
		costInput,
		costOutput,
		costCacheRead,
		costCacheWrite,
		costTotal,
	};
}

export function emitLangfuseGenerationEvent(args: LangfuseGenerationEventArgs): void {
	if (!args.eventBus) return;
	const runId = args.ctx.get("__run_id") || "no_run_id";
	const traceId = resolveLangfuseTraceId(runId, args.handlerType, args.sessionKey);
	const includePromptText = isLangfusePromptTextEnabled();
	const promptHash = computeLangfusePromptHash(args.prompt);
	const usage = {
		...emptyUsage(),
		...(args.usage || {}),
	};
	const attemptIndex = Math.max(1, args.attemptIndex || 1);
	const quality = qualitySnapshot({
		node: args.node,
		handlerType: args.handlerType,
		attempt: attemptIndex,
		outcome: args.outcome === "success" ? "pass" : "fail",
		model: args.model,
		errorMessage: args.errorMessage,
	});
	const retryTelemetry = deriveRetryTelemetry({
		attempt: attemptIndex,
		outcome: args.outcome === "success" ? "pass" : "fail",
	});

	const data: Record<string, string> = {
		langfuse_type: "generation",
		langfuse_trace_id: traceId,
		langfuse_observation_id: `${traceId}:gen:${attemptIndex}`,
		langfuse_attempt_index: String(attemptIndex),
		langfuse_handler_type: args.handlerType,
		handler: args.handlerType,
		langfuse_session_key: args.sessionKey,
		langfuse_provider: args.provider,
		langfuse_model: args.model,
		langfuse_outcome: args.outcome,
		langfuse_tag_model: args.model,
		langfuse_tag_provider: args.provider,
		langfuse_tag_outcome: args.outcome,
		llm_path_id: String(args.llmPathId || args.node.attrs["llm_path_id"] || ""),
		langfuse_prompt_hash: promptHash,
		langfuse_prompt_text_enabled: includePromptText ? "true" : "false",
		langfuse_tokens_input: String(usage.inputTokens),
		langfuse_tokens_output: String(usage.outputTokens),
		langfuse_tokens_total: String(usage.totalTokens),
		langfuse_tokens_cache_read: String(usage.cacheReadTokens),
		langfuse_tokens_cache_write: String(usage.cacheWriteTokens),
		langfuse_cost_input: numberOrEmpty(usage.costInput),
		langfuse_cost_output: numberOrEmpty(usage.costOutput),
		langfuse_cost_cache_read: numberOrEmpty(usage.costCacheRead),
		langfuse_cost_cache_write: numberOrEmpty(usage.costCacheWrite),
		langfuse_cost_total: numberOrEmpty(usage.costTotal),
		...quality,
		...retryTelemetry,
		"hatch.kpi.retry.failure_class": quality.langfuse_failure_class,
		...skillAndProcessTags(args.node, args.ctx, args.handlerType, args.intent),
		langfuse_tag_prompt_hash: promptHash,
		langfuse_tag_failure_class: quality.langfuse_failure_class,
		langfuse_tag_retry: attemptIndex > 1 ? "true" : "false",
		langfuse_tag_retry_class: retryTelemetry["hatch.retry_class"] || "",
	};
	if (data.llm_path_id) {
		data["hatch.llm_path_id"] = data.llm_path_id;
		data["langfuse_tag_llm_path_id"] = data.llm_path_id;
	}
	if (includePromptText) data["langfuse_prompt_text"] = args.prompt;
	if (args.errorMessage) data["langfuse_error"] = args.errorMessage;

	args.eventBus.emit({
		kind: LANGFUSE_GENERATION_EVENT_KIND,
		nodeId: args.node.id,
		message: args.outcome,
		data,
		intent: args.intent,
	});
}

export function emitLangfuseSessionEvent(args: LangfuseSessionEventArgs): void {
	if (!args.eventBus) return;
	const runId = args.ctx.get("__run_id") || "no_run_id";
	const traceId = resolveLangfuseTraceId(runId, args.handlerType, args.sessionKey);
	const usage = {
		...emptyUsage(),
		...(args.usage || {}),
	};
	const attemptIndex = Math.max(1, args.attemptIndex || 1);
	const outcome: "pass" | "fail" = args.isError ? "fail" : "pass";
	const quality = qualitySnapshot({
		node: args.node,
		handlerType: args.handlerType,
		attempt: attemptIndex,
		outcome,
		model: args.model || "",
		errorMessage: args.isError ? `session_event:${args.eventType}` : undefined,
	});
	const retryTelemetry = deriveRetryTelemetry({ attempt: attemptIndex, outcome });

	const data: Record<string, string> = {
		langfuse_type: "session_event",
		langfuse_trace_id: traceId,
		langfuse_observation_id: `${traceId}:session:${args.eventType}:${Date.now()}`,
		langfuse_handler_type: args.handlerType,
		handler: args.handlerType,
		langfuse_attempt_index: String(attemptIndex),
		langfuse_session_key: args.sessionKey,
		langfuse_session_event_type: args.eventType,
		llm_path_id: String(args.llmPathId || args.node.attrs["llm_path_id"] || ""),
		langfuse_tool_call_id: args.toolCallId || "",
		langfuse_tool_name: args.toolName || "",
		langfuse_event_error: args.isError ? "true" : "false",
		langfuse_provider: args.provider || "",
		langfuse_model: args.model || "",
		langfuse_tag_model: args.model || "",
		langfuse_tag_provider: args.provider || "",
		langfuse_tag_outcome: outcome,
		langfuse_tokens_input: String(usage.inputTokens),
		langfuse_tokens_output: String(usage.outputTokens),
		langfuse_tokens_total: String(usage.totalTokens),
		langfuse_tokens_cache_read: String(usage.cacheReadTokens),
		langfuse_tokens_cache_write: String(usage.cacheWriteTokens),
		langfuse_cost_input: numberOrEmpty(usage.costInput),
		langfuse_cost_output: numberOrEmpty(usage.costOutput),
		langfuse_cost_cache_read: numberOrEmpty(usage.costCacheRead),
		langfuse_cost_cache_write: numberOrEmpty(usage.costCacheWrite),
		langfuse_cost_total: numberOrEmpty(usage.costTotal),
		...quality,
		...retryTelemetry,
		"hatch.kpi.retry.failure_class": quality.langfuse_failure_class,
		...skillAndProcessTags(args.node, args.ctx, args.handlerType, args.intent),
		langfuse_tag_failure_class: quality.langfuse_failure_class,
		langfuse_tag_retry: attemptIndex > 1 ? "true" : "false",
		langfuse_tag_retry_class: retryTelemetry["hatch.retry_class"] || "",
	};
	if (data.llm_path_id) {
		data["hatch.llm_path_id"] = data.llm_path_id;
		data["langfuse_tag_llm_path_id"] = data.llm_path_id;
	}
	args.eventBus.emit({
		kind: LANGFUSE_SESSION_EVENT_KIND,
		nodeId: args.node.id,
		message: args.eventType,
		data,
		intent: args.intent,
	});
}

export function bindLangfuseSessionTelemetry(args: {
	session: LangfuseSessionLike;
	eventBus?: EventBus;
	node: LangfuseNodeLike;
	ctx: LangfuseContextStore;
	handlerType: string;
	sessionKey: string;
	attemptIndex?: number;
	intent?: IntentMetadataLike;
	logPrefix?: string;
	onProgress?: () => void;
}): () => void {
	if (!args.eventBus && !args.onProgress) return () => {};
	const attemptIndex = Math.max(1, args.attemptIndex || 1);
	const onProgress = args.onProgress ?? (() => {});
	return args.session.subscribe((event: any) => {
		onProgress();
		if (event?.type === "tool_execution_start") {
			if (args.logPrefix) console.log(`    [${args.logPrefix}] ${event.toolName}`);
			emitLangfuseSessionEvent({
				eventBus: args.eventBus,
				node: args.node,
				ctx: args.ctx,
				handlerType: args.handlerType,
				sessionKey: args.sessionKey,
				attemptIndex,
				eventType: "tool_execution_start",
				toolCallId: String(event.toolCallId || ""),
				toolName: String(event.toolName || ""),
				intent: args.intent,
			});
			return;
		}
		if (event?.type === "tool_execution_end") {
			emitLangfuseSessionEvent({
				eventBus: args.eventBus,
				node: args.node,
				ctx: args.ctx,
				handlerType: args.handlerType,
				sessionKey: args.sessionKey,
				attemptIndex,
				eventType: "tool_execution_end",
				toolCallId: String(event.toolCallId || ""),
				toolName: String(event.toolName || ""),
				isError: Boolean(event.isError),
				intent: args.intent,
			});
			return;
		}
		if (event?.type === "tool_execution_update") {
			emitLangfuseSessionEvent({
				eventBus: args.eventBus,
				node: args.node,
				ctx: args.ctx,
				handlerType: args.handlerType,
				sessionKey: args.sessionKey,
				attemptIndex,
				eventType: "tool_execution_update",
				toolCallId: String(event.toolCallId || ""),
				toolName: String(event.toolName || ""),
				intent: args.intent,
			});
			return;
		}
		if (event?.type === "agent_start" || event?.type === "agent_end" || event?.type === "turn_start" || event?.type === "turn_end") {
			emitLangfuseSessionEvent({
				eventBus: args.eventBus,
				node: args.node,
				ctx: args.ctx,
				handlerType: args.handlerType,
				sessionKey: args.sessionKey,
				attemptIndex,
				eventType: event.type,
				intent: args.intent,
			});
			return;
		}
		if (event?.type !== "message_end") return;
		const message = event.message;
		if (message?.role !== "assistant") return;
		const usage = usageFromAssistantMessage(message);
		emitLangfuseSessionEvent({
			eventBus: args.eventBus,
			node: args.node,
			ctx: args.ctx,
			handlerType: args.handlerType,
			sessionKey: args.sessionKey,
			attemptIndex,
			eventType: "message_end",
			provider: String(message.provider || ""),
			model: String(message.model || ""),
			usage,
			intent: args.intent,
		});
	});
}

function emptyUsage(): LangfuseUsageMetrics {
	return {
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		costInput: 0,
		costOutput: 0,
		costCacheRead: 0,
		costCacheWrite: 0,
		costTotal: 0,
	};
}

function qualitySnapshot(args: {
	node: LangfuseNodeLike;
	handlerType: string;
	attempt: number;
	outcome: "pass" | "fail";
	model: string;
	errorMessage?: string;
}): Record<string, string> {
	const signal = deriveQualitySignal({
		nodeId: args.node.id,
		traceId: "",
		trustPartition: String(args.node.attrs["trust_partition"] || "builder"),
		trustDomain: String(args.node.attrs["trust_domain"] || args.node.attrs["trust_partition"] || "builder"),
		trustRole: String(args.node.attrs["trust_role"] || args.node.attrs["agent_role"] || "unknown"),
		attempt: Math.max(1, args.attempt),
		outcome: args.outcome,
		failureClass: args.outcome === "fail" ? classifyFailureMessage(args.errorMessage || "runtime") : "none",
		guardState: "closed",
		handlerType: args.handlerType,
		model: args.model || "unknown",
	});
	return {
		langfuse_quality_score: signal.langfuse_quality_score,
		langfuse_quality_grade: signal.langfuse_quality_grade,
		langfuse_failure_class: signal.langfuse_failure_class,
		langfuse_skill: signal.langfuse_skill,
	};
}

function skillAndProcessTags(node: LangfuseNodeLike, ctx: LangfuseContextStore, handlerType: string, intent?: IntentMetadataLike): Record<string, string> {
	const skill = resolveSkill(node, handlerType, intent);
	const workUnit = resolveWorkUnitTags(ctx);
	const tags: Record<string, string> = {
		langfuse_tag_prompt_hash: "", // set by generation events; kept stable for dashboards
		langfuse_tag_handler: handlerType,
		langfuse_tag_skill: skill,
		langfuse_tag_skill_id: node.attrs["skill_id"] || node.attrs["skill"] || skill,
		langfuse_tag_skill_name: node.attrs["skill_name"] || skill,
		langfuse_tag_process_id: node.attrs["process_id"] || node.attrs["process"] || "",
		langfuse_tag_process_name: node.attrs["process_name"] || "",
		langfuse_tag_intent_ref: intent?.intentRef || node.attrs["intent_ref"] || "",
		langfuse_tag_intent_profile: intent?.intentProfile || node.attrs["intent_profile"] || "",
		langfuse_tag_intent_patches: intent?.intentPatches ? JSON.stringify(intent.intentPatches) : "",
		langfuse_tag_trust_domain: node.attrs["trust_domain"] || "",
		langfuse_tag_trust_role: node.attrs["trust_role"] || "",
		langfuse_skill: skill,
		skill,
		"hatch.kpi.cost.skill": skill,
		"hatch.kpi.cost.handler": handlerType,
		...workUnit,
	};
	if (nodeTrustParticipates(node, handlerType)) {
		tags["agent_id"] = resolveAgentId(node, handlerType);
		tags["agent_role"] = resolveAgentRole(node, handlerType);
		tags["langfuse_tag_role"] = tags["agent_role"];
	}
	return tags;
}

function resolveSkill(node: LangfuseNodeLike, handlerType: string, intent?: IntentMetadataLike): string {
	const value =
		node.attrs["skill"] ||
		node.attrs["skill_id"] ||
		node.attrs["skill_name"] ||
		intent?.handlerType ||
		handlerType;
	return String(value || "unknown");
}

function resolveWorkUnitTags(ctx: LangfuseContextStore): Record<string, string> {
	const goalId = firstNonEmpty([
		ctx.get("goal_id"),
		ctx.get("goal_number"),
		ctx.get("goal_issue"),
		ctx.get("current_goal_id"),
	]);
	const issueId = firstNonEmpty([
		ctx.get("issue_number"),
		ctx.get("current_issue_number"),
		ctx.get("target_issue_number"),
		ctx.get("issue_id"),
		ctx.get("wave_issue"),
	]);
	const hypothesisId = firstNonEmpty([
		ctx.get("hypothesis_id"),
		ctx.get("hypothesis_number"),
		ctx.get("hypothesis"),
	]);
	const waveId = firstNonEmpty([
		ctx.get("wave_id"),
		ctx.get("wave"),
		ctx.get("milestone_title"),
	]);

	const segments: string[] = [];
	if (goalId) segments.push(`goal:${goalId}`);
	if (waveId) segments.push(`wave:${waveId}`);
	if (issueId) segments.push(`issue:${issueId}`);
	if (hypothesisId) segments.push(`hypothesis:${hypothesisId}`);
	const workUnit = segments.join("|");

	return {
		"hatch.work_unit": workUnit,
		"hatch.work_unit.goal": goalId,
		"hatch.work_unit.wave": waveId,
		"hatch.work_unit.issue": issueId,
		"hatch.work_unit.hypothesis": hypothesisId,
		"hatch.kpi.cost.work_unit": workUnit,
	};
}

function nodeTrustParticipates(node: LangfuseNodeLike, handlerType: string): boolean {
	const nodeHandlerType = String(node.attrs["type"] || node.attrs["handler_type"] || handlerType || "").trim();
	return TRUST_PARTICIPATING_HANDLER_TYPES.has(nodeHandlerType);
}

function resolveAgentId(node: LangfuseNodeLike, handlerType: string): string {
	const explicit = String(node.attrs["agent_id"] || "").trim();
	if (explicit) return explicit;
	if (handlerType === "tool") return "tool.generic";
	if (handlerType === "stack.manager_loop") return "stack.manager_loop";
	if (handlerType === "agent.worktree") return "agent.worktree";
	if (handlerType === "agent.kw") return "agent.kw";
	return "unknown";
}

function resolveAgentRole(node: LangfuseNodeLike, handlerType: string): string {
	const explicit = String(node.attrs["agent_role"] || "").trim();
	if (explicit) return explicit;
	if (handlerType === "tool") return "tool.operator";
	if (handlerType === "stack.manager_loop") return "manager.supervisor";
	if (handlerType === "agent.worktree") return "worktree.implementer";
	if (handlerType === "agent.kw") return "knowledge.researcher";
	return "unknown";
}

function firstNonEmpty(values: Array<string | undefined>): string {
	for (const value of values) {
		const normalized = String(value || "").trim();
		if (normalized) return normalized;
	}
	return "";
}

function normalizeNodeScope(nodeId: string): string {
	const cleaned = String(nodeId || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
	return cleaned || "unknown_node";
}

function numberOrEmpty(value: number): string {
	return Number.isFinite(value) && value > 0 ? String(value) : "";
}

function pickNumber(source: Record<string, unknown>, paths: string[]): number {
	for (const path of paths) {
		const value = readPath(source, path);
		const parsed = toNumber(value);
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
	for (const path of paths) {
		const value = readPath(source, path);
		const parsed = toNumber(value);
		if (Number.isFinite(parsed) && parsed === 0) return 0;
	}
	return 0;
}

function readPath(source: Record<string, unknown>, path: string): unknown {
	const parts = path.split(".");
	let current: unknown = source;
	for (const part of parts) {
		if (!current || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

function normalizeUsageObject(message: any): Record<string, unknown> {
	return {
		...coerceRecord(message?.usageMetadata),
		...coerceRecord(message?.responseMetadata?.usageMetadata),
		...coerceRecord(message?.response?.usageMetadata),
		...coerceRecord(message?.usage),
	};
}

function normalizeCostObject(message: any, usage: Record<string, unknown>): Record<string, unknown> {
	return {
		...coerceRecord(message?.cost),
		...coerceRecord(message?.pricing),
		...coerceRecord(message?.usageCost),
		...coerceRecord(usage["pricing"]),
		...coerceRecord(usage["usageCost"]),
		...coerceRecord(usage["cost"]),
	};
}

function extractHeaderCostObject(message: any, usage: Record<string, unknown>): {
	total: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
} {
	const headerSources = [
		coerceRecord(message?.responseHeaders),
		coerceRecord(message?.response?.headers),
		coerceRecord(message?.metadata?.headers),
		coerceRecord(message?.headers),
		coerceRecord(usage["responseHeaders"]),
		coerceRecord(usage["headers"]),
	];
	const flattened: Record<string, unknown> = {};
	for (const source of headerSources) {
		for (const [key, value] of Object.entries(source)) {
			if (value === undefined || value === null || value === "") continue;
			flattened[String(key).toLowerCase()] = value;
		}
	}
	const total = pickHeaderNumber(flattened, ["x-cost", "x-openrouter-cost", "openrouter-cost", "x-llm-cost"]);
	const input = pickHeaderNumber(flattened, ["x-cost-input", "x-openrouter-cost-input", "openrouter-cost-input"]);
	const output = pickHeaderNumber(flattened, ["x-cost-output", "x-openrouter-cost-output", "openrouter-cost-output"]);
	const cacheRead = pickHeaderNumber(flattened, ["x-cost-cache-read", "x-openrouter-cost-cache-read", "openrouter-cost-cache-read"]);
	const cacheWrite = pickHeaderNumber(flattened, ["x-cost-cache-write", "x-openrouter-cost-cache-write", "openrouter-cost-cache-write"]);
	return { total, input, output, cacheRead, cacheWrite };
}

function pickHeaderNumber(headers: Record<string, unknown>, keys: string[]): number {
	for (const key of keys) {
		if (!(key in headers)) continue;
		const parsed = toNumber(headers[key]);
		if (Number.isFinite(parsed) && parsed >= 0) return parsed;
	}
	return 0;
}

function coerceRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}

function toNumber(value: unknown): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}
