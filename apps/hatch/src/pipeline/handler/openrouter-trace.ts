import { basename } from "node:path";

import { resolveLangfuseTraceId } from "@recallnet/factory-telemetry";

import type { Context } from "../context.js";
import type { HandlerConfig } from "./register.js";

export interface OpenRouterTraceOptions {
	metadata: {
		trace: Record<string, string>;
	};
	headers: Record<string, string>;
}

export function buildOpenRouterTraceOptions(
	ctx: Context,
	config: Pick<HandlerConfig, "pipelineFile" | "graph"> | undefined,
	handlerType: string,
	sessionKey: string,
	llmPathId = "",
): OpenRouterTraceOptions {
	try {
		const runId = normalizeValue(ctx.get("__run_id")) || "no_run_id";
		const safeHandlerType = normalizeValue(handlerType) || "unknown_handler";
		const safeSessionKey = normalizeValue(sessionKey) || "session";
		const traceId = resolveLangfuseTraceId(runId, safeHandlerType, safeSessionKey);
		const sessionId = resolveLangfuseTraceId(runId, safeHandlerType, `${safeSessionKey}:session`);
		const traceNameSource = normalizeValue(config?.pipelineFile) || normalizeValue(config?.graph?.name) || "unknown";
		const traceName = basename(traceNameSource) || "unknown";
		const nodeId =
			normalizeValue((ctx as unknown as { node?: { id?: string } }).node?.id)
			|| normalizeValue(ctx.get("__node_id"))
			|| normalizeValue(ctx.get("last_stage"))
			|| "unknown_node";
		const generationName = `${safeHandlerType}:${nodeId}:${safeSessionKey}`;
		const parentSpanId = normalizeValue(ctx.get("__parent_run_id"));
		const issueNumber = firstNonEmpty([
			normalizeValue(ctx.get("issue.number")),
			normalizeValue(ctx.get("issue_number")),
			readIssueNumberFromIssueContext(ctx),
		]);
		const milestone = normalizeValue(ctx.get("milestone"));
		const wave = normalizeValue(ctx.get("wave"));

		const tracePayload: Record<string, string> = {
			trace_id: traceId,
			trace_name: traceName,
			generation_name: generationName,
			session_id: sessionId,
		};
		if (parentSpanId) tracePayload.parent_span_id = parentSpanId;
		if (issueNumber) tracePayload.issue_number = issueNumber;
		if (milestone) tracePayload.milestone = milestone;
		if (wave) tracePayload.wave = wave;
		if (normalizeValue(llmPathId)) tracePayload.llm_path_id = normalizeValue(llmPathId);

		return {
			metadata: { trace: tracePayload },
			headers: {
				"HTTP-Referer": normalizeValue(config?.pipelineFile),
				"X-Title": normalizeValue(config?.graph?.name) || "hatch-pipeline",
			},
		};
	} catch {
		return {
			metadata: {
				trace: {
					trace_id: "",
					trace_name: "unknown",
					generation_name: "unknown_handler:unknown_node:session",
					session_id: "",
				},
			},
			headers: {
				"HTTP-Referer": "",
				"X-Title": "hatch-pipeline",
			},
		};
	}
}

export function mergeOpenRouterTraceOptions(
	baseOptions: Record<string, unknown>,
	traceOptions: OpenRouterTraceOptions,
): Record<string, unknown> {
	const existingMetadata = asRecord(baseOptions["metadata"]);
	const existingHeaders = asRecord(baseOptions["headers"]);
	const existingTrace = asRecord(existingMetadata["trace"]);
	const nextTrace = asRecord(traceOptions.metadata?.trace);

	return {
		...baseOptions,
		metadata: {
			...existingMetadata,
			...traceOptions.metadata,
			trace: {
				...existingTrace,
				...nextTrace,
			},
		},
		headers: {
			...stringRecord(existingHeaders),
			...traceOptions.headers,
		},
	};
}

function readIssueNumberFromIssueContext(ctx: Context): string {
	const issueRaw = normalizeValue(ctx.get("issue"));
	if (!issueRaw) return "";
	try {
		const parsed = JSON.parse(issueRaw) as Record<string, unknown>;
		const fromNested = normalizeValue(parsed["number"]);
		if (fromNested) return fromNested;
		return normalizeValue(parsed["issue_number"]);
	} catch {
		return "";
	}
}

function normalizeValue(value: unknown): string {
	return String(value || "").trim();
}

function firstNonEmpty(values: string[]): string {
	for (const value of values) {
		if (value) return value;
	}
	return "";
}

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}

function stringRecord(value: Record<string, unknown>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, val] of Object.entries(value)) {
		out[key] = String(val ?? "");
	}
	return out;
}
