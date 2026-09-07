import type { LangfuseSpanEnvelope } from "./langfuse.js";

export function isLangfuseGenerationSpan(span: LangfuseSpanEnvelope): boolean {
	const kind = String(span.metadata["hatch.event_kind"] || "").trim();
	const langfuseType = String(span.metadata["langfuse_type"] || "").trim();
	return kind === "telemetry.langfuse.generation" || langfuseType === "generation";
}

export function buildLangfuseGenerationPayload(
	span: LangfuseSpanEnvelope,
	fallbackSpanPayload: Record<string, unknown>,
): Record<string, unknown> {
	const metadata = span.metadata || {};
	const inputTokens = parseMetricNumber(metadata["langfuse_tokens_input"]);
	const outputTokens = parseMetricNumber(metadata["langfuse_tokens_output"]);
	const totalTokens = parseMetricNumber(metadata["langfuse_tokens_total"]);
	const cacheReadTokens = parseMetricNumber(metadata["langfuse_tokens_cache_read"]);
	const cacheWriteTokens = parseMetricNumber(metadata["langfuse_tokens_cache_write"]);

	const costInput = parseMetricNumber(metadata["langfuse_cost_input"]);
	const costOutput = parseMetricNumber(metadata["langfuse_cost_output"]);
	const costCacheRead = parseMetricNumber(metadata["langfuse_cost_cache_read"]);
	const costCacheWrite = parseMetricNumber(metadata["langfuse_cost_cache_write"]);
	const costTotal = parseMetricNumber(metadata["langfuse_cost_total"]);

	const model = firstNonEmpty([metadata["langfuse_model"], metadata["model"]]);
	const provider = firstNonEmpty([metadata["langfuse_provider"], metadata["provider"]]);

	const usageTotal = totalTokens ?? (inputTokens || 0) + (outputTokens || 0) + (cacheReadTokens || 0) + (cacheWriteTokens || 0);
	const computedCostTotal = (costInput || 0) + (costOutput || 0) + (costCacheRead || 0) + (costCacheWrite || 0);
	const effectiveCostTotal = costTotal ?? computedCostTotal;
	const hasUsage = usageTotal > 0 || (inputTokens || 0) > 0 || (outputTokens || 0) > 0 || (cacheReadTokens || 0) > 0 || (cacheWriteTokens || 0) > 0;
	const hasCost = effectiveCostTotal > 0 || (costInput || 0) > 0 || (costOutput || 0) > 0 || (costCacheRead || 0) > 0 || (costCacheWrite || 0) > 0;

	const modelParameters: Record<string, string> = {};
	if (provider) modelParameters.provider = provider;
	if (metadata["model_provider"]) modelParameters.model_provider = metadata["model_provider"];
	if (metadata["langfuse_handler_type"]) modelParameters.handler_type = metadata["langfuse_handler_type"];

	const generationPayload: Record<string, unknown> = {
		...fallbackSpanPayload,
		model: model || undefined,
		...(Object.keys(modelParameters).length > 0 ? { modelParameters } : {}),
	};

	if (hasUsage) {
		generationPayload.usage = {
			input: inputTokens || 0,
			output: outputTokens || 0,
			total: usageTotal,
			inputCost: costInput || 0,
			outputCost: costOutput || 0,
			totalCost: effectiveCostTotal,
		};
		generationPayload.usageDetails = {
			input: inputTokens || 0,
			output: outputTokens || 0,
			total: usageTotal,
			cache_read_input_tokens: cacheReadTokens || 0,
			cache_creation_input_tokens: cacheWriteTokens || 0,
		};
	}
	if (hasCost) {
		generationPayload.costDetails = {
			input: costInput || 0,
			output: costOutput || 0,
			total: effectiveCostTotal,
			cache_read: costCacheRead || 0,
			cache_write: costCacheWrite || 0,
		};
	}

	return generationPayload;
}

function parseMetricNumber(raw: string | undefined): number | undefined {
	const parsed = Number(String(raw || "").trim());
	if (!Number.isFinite(parsed) || parsed < 0) return undefined;
	return parsed;
}

function firstNonEmpty(values: Array<string | undefined>): string {
	for (const value of values) {
		const normalized = String(value || "").trim();
		if (normalized) return normalized;
	}
	return "";
}
