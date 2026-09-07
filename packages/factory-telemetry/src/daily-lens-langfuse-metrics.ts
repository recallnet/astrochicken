// @ts-ignore — factory-core daily-lens-collector is untyped JS
import {
  MissingDataReason,
  addMissingData,
  createCollectorEnvelope,
  finalizeCollectorEnvelope,
  toArray,
  toNumber,
} from "@hatch/factory-core/daily-lens-collector";

interface AuthHeaders {
  authorization: string;
  accept: string;
  [key: string]: string;
}

interface MetricsResult {
  ok: boolean;
  status: number;
  data: Record<string, unknown>[];
  error?: string;
}

interface ModelEntry {
  count: number;
  tokens_total: number;
  cost_total_usd: number;
}

function resolveAuthHeaders({ langfuseKey = "", env = process.env }: { langfuseKey?: string; env?: Record<string, string | undefined> } = {}): AuthHeaders | null {
  const explicitSecret = String(langfuseKey || "").trim();
  const publicKey = String(env?.LANGFUSE_PUBLIC_KEY || "").trim();
  const secretKey = String(env?.LANGFUSE_SECRET_KEY || env?.LANGFUSE_API_KEY || explicitSecret || "").trim();

  if (publicKey && secretKey) {
    return {
      authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`,
      accept: "application/json",
    };
  }

  if (secretKey) {
    return {
      authorization: `Bearer ${secretKey}`,
      accept: "application/json",
    };
  }

  return null;
}

function withDefaults(base: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    totals: {
      trace_count: 0,
      tokens_total: 0,
      cost_total_usd: 0,
    },
    latency: {
      p50_ms: 0,
      p90_ms: 0,
      p95_ms: 0,
    },
    by_model: [],
    ...base,
  };
}

// @context:integration !critical Langfuse Cloud changed the metrics endpoint
// from POST /api/public/v2/metrics to GET /api/public/metrics/daily (returns
// pre-aggregated daily metrics). The old POST endpoint returns 405.
async function fetchMetricsDaily({ fetchFn, baseUrl, headers, fromTimestamp, toTimestamp }: {
  fetchFn: typeof fetch;
  baseUrl: string;
  headers: AuthHeaders;
  fromTimestamp: string;
  toTimestamp: string;
}): Promise<MetricsResult> {
  const params = new URLSearchParams();
  if (fromTimestamp) params.set("fromTimestamp", fromTimestamp);
  if (toTimestamp) params.set("toTimestamp", toTimestamp);
  params.set("limit", "50");
  const url = `${baseUrl}/api/public/metrics/daily?${params}`;
  try {
    const response = await fetchFn(url, { headers });
    if (!response?.ok) {
      return { ok: false, status: Number(response?.status || 0), data: [] };
    }
    const body = await response.json();
    return { ok: true, status: 200, data: Array.isArray(body?.data) ? body.data : [] };
  } catch (error: unknown) {
    return { ok: false, status: 0, data: [], error: String((error as Error)?.message || error) };
  }
}

export async function collectLangfuseMetrics({
  windowStart = "",
  windowEnd = "",
  fetchFn = globalThis.fetch,
  langfuseUrl = "",
  langfuseKey = "",
  env = process.env as Record<string, string | undefined>,
}: {
  windowStart?: string;
  windowEnd?: string;
  fetchFn?: typeof fetch;
  langfuseUrl?: string;
  langfuseKey?: string;
  env?: Record<string, string | undefined>;
} = {}): Promise<Record<string, unknown>> {
  let payload;
  try {
    payload = createCollectorEnvelope({
      source: "langfuse_metrics",
      windowStart,
      windowEnd,
    });
  } catch (error: unknown) {
    return {
      source: "langfuse_metrics",
      window: { start: String(windowStart || ""), end: String(windowEnd || "") },
      missing_data: [{
        reason: MissingDataReason.WINDOW_INVALID,
        detail: String((error as Error)?.message || error),
      }],
      ...withDefaults(),
    };
  }

  const baseUrl = String(
    langfuseUrl || env?.LANGFUSE_BASE_URL || env?.LANGFUSE_URL || "",
  ).trim().replace(/\/$/, "");
  const headers = resolveAuthHeaders({ langfuseKey, env });

  if (!baseUrl || !headers || typeof fetchFn !== "function") {
    addMissingData(payload, MissingDataReason.SOURCE_MISSING, "Langfuse Metrics API unavailable", {
      source_hint: "LANGFUSE_BASE_URL/LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY",
    });
    return finalizeCollectorEnvelope({ ...payload, ...withDefaults() });
  }

  const dailyResult = await fetchMetricsDaily({
    fetchFn,
    baseUrl,
    headers,
    fromTimestamp: payload.window.start,
    toTimestamp: payload.window.end,
  });
  if (!dailyResult.ok) {
    addMissingData(payload, MissingDataReason.SOURCE_MISSING, "Langfuse Metrics API request failed", {
      status: dailyResult.status,
      error: dailyResult.error || "",
    });
    return finalizeCollectorEnvelope({ ...payload, ...withDefaults() });
  }

  // Aggregate across days in the window
  let traceCount = 0;
  let costTotal = 0;
  let tokensTotal = 0;
  const modelMap = new Map<string, ModelEntry>();
  for (const day of dailyResult.data) {
    traceCount += toNumber(day.countTraces, 0);
    costTotal += toNumber(day.totalCost, 0);
    for (const usage of (toArray(day.usage) as Record<string, unknown>[])) {
      const model = String(usage.model || "unknown");
      if (model === "null" || model === "unknown") continue;
      const existing = modelMap.get(model) || { count: 0, tokens_total: 0, cost_total_usd: 0 };
      existing.count += toNumber(usage.countTraces, 0);
      existing.tokens_total += toNumber(usage.totalUsage, 0);
      existing.cost_total_usd += toNumber(usage.totalCost, 0);
      modelMap.set(model, existing);
    }
  }

  // Sum tokens from per-model breakdown
  for (const v of modelMap.values()) tokensTotal += v.tokens_total;
  const totals = {
    trace_count: traceCount,
    cost_total_usd: costTotal,
    tokens_total: tokensTotal,
  };
  // Latency is not available in the daily endpoint — report zeros
  const latency = { p50_ms: 0, p90_ms: 0, p95_ms: 0 };

  const byModel = [...modelMap.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return finalizeCollectorEnvelope({
    ...payload,
    totals,
    latency,
    by_model: byModel,
  });
}
