// @ts-ignore — factory-core daily-lens-collector is untyped JS
import {
  MissingDataReason,
  addMissingData,
  createCollectorEnvelope,
  finalizeCollectorEnvelope,
  inWindow,
  toArray,
  toNumber,
  uniqueStrings,
} from "@hatch/factory-core/daily-lens-collector";

type LangfuseTrace = Record<string, any>;

function resolveScopeIdentity(trace: LangfuseTrace = {}): string | null {
  return trace?.judgeContextScopeIdentity
    || trace?.judge_context_scope_identity
    || trace?.metadata?.judgeContextScopeIdentity
    || trace?.metadata?.judge_context_scope_identity
    || trace?.metadata?.judge_context_identity
    || null;
}

function resolveSkill(trace: LangfuseTrace = {}): string {
  return String(
    trace?.skill
      || trace?.metadata?.skill
      || trace?.metadata?.langfuse_skill
      || trace?.metadata?.["hatch.skill"]
      || "unknown",
  );
}

function resolveAbstractionLevel(trace: LangfuseTrace = {}): string {
  return String(
    trace?.metadata?.abstraction_level
      || trace?.metadata?.["hatch.abstraction_level"]
      || "unknown",
  );
}

function resolveGraph(trace: LangfuseTrace = {}): string {
  return String(
    trace?.metadata?.graph_id
      || trace?.metadata?.["hatch.graph_id"]
      || trace?.metadata?.graph
      || "unknown",
  );
}

function resolvePhase(trace: LangfuseTrace = {}): string {
  return String(
    trace?.metadata?.phase
      || trace?.metadata?.["hatch.phase"]
      || "unknown",
  );
}

function resolveModel(trace: LangfuseTrace = {}): string {
  return String(
    trace?.model
      || trace?.metadata?.model
      || trace?.metadata?.langfuse_model
      || trace?.modelParameters?.name
      || "unknown",
  );
}

function resolveTraceId(trace: LangfuseTrace = {}): string {
  return String(trace?.id || trace?.trace_id || trace?.traceId || "").trim();
}

function resolveTimestamp(trace: LangfuseTrace = {}): string {
  return String(trace?.timestamp || trace?.createdAt || trace?.startTime || "").trim();
}

function resolveTokenCount(trace: LangfuseTrace = {}): number {
  return toNumber(
    trace?.usage?.totalTokens
      ?? trace?.totalTokens
      ?? trace?.metadata?.langfuse_tokens_total
      ?? (toNumber(trace?.usage?.inputTokens, 0) + toNumber(trace?.usage?.outputTokens, 0)),
    0,
  );
}

function resolveCost(trace: LangfuseTrace = {}): number {
  return toNumber(
    trace?.totalCost
      ?? trace?.cost?.total
      ?? trace?.cost_total
      ?? trace?.metadata?.langfuse_cost_total,
    0,
  );
}

function resolveLatency(trace: LangfuseTrace = {}): number {
  return toNumber(
    trace?.latency
      ?? trace?.duration
      ?? trace?.metadata?.hatch?.duration_ms
      ?? trace?.metadata?.["hatch.duration_ms"],
    0,
  );
}

function resolveAuthHeaders({
  langfuseKey = "",
  env = process.env as Record<string, string | undefined>,
}: { langfuseKey?: string; env?: Record<string, string | undefined> } = {}): { authorization: string; accept: string } | null {
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

async function fetchJsonWithRetries({
  fetchFn,
  url,
  headers,
  retries = 0,
}: {
  fetchFn: typeof fetch;
  url: string;
  headers: Record<string, string>;
  retries?: number;
} = {} as { fetchFn: typeof fetch; url: string; headers: Record<string, string> }): Promise<{ ok: boolean; status: number; body: unknown; error: string }> {
  let attempt = 0;
  const maxAttempts = Math.max(1, Number(retries || 0) + 1);
  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const response = await fetchFn(url, {
        method: "GET",
        headers,
      });
      lastResponse = response;
      if (response?.ok) {
        return {
          ok: true,
          status: Number(response.status || 200),
          body: await response.json(),
          error: "",
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastResponse) {
    return {
      ok: false,
      status: Number(lastResponse.status || 0),
      body: null,
      error: "",
    };
  }

  return {
    ok: false,
    status: 0,
    body: null,
    error: String((lastError as Error)?.message || lastError || ""),
  };
}

function aggregateRows(rows: LangfuseTrace[] = [], keyName: string) {
  const table = new Map();
  for (const row of rows) {
    const key = String(row?.[keyName] || "unknown");
    const current = table.get(key) || { key, count: 0, tokens_total: 0, cost_total_usd: 0 };
    current.count += 1;
    current.tokens_total += toNumber(row?.tokens_total, 0);
    current.cost_total_usd += toNumber(row?.cost_usd, 0);
    table.set(key, current);
  }
  return [...table.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function withDefaults(base: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    trace_count: 0,
    dashboard_url: "",
    sampled_trace_ids: [],
    sampled_traces: [],
    judge_context_scope_identities: [],
    totals: {
      trace_count: 0,
      tokens_total: 0,
      cost_total_usd: 0,
    },
    by_skill: [],
    by_model: [],
    by_abstraction_level: [],
    by_graph: [],
    by_phase: [],
    ...base,
  };
}

function uniqueScopeIdentities(sampledTraces: LangfuseTrace[] = []): string[] {
  const keys = uniqueStrings(sampledTraces
    .map((trace) => trace.judgeContextScopeIdentity)
    .filter((value) => value !== null)
    .map((identity) => {
      try {
        return JSON.stringify(identity);
      } catch {
        return "";
      }
    }));

  return keys
    .map((item) => {
      const parsed = item ? JSON.parse(item) : null;
      return parsed;
    })
    .filter(Boolean);
}

export async function collectLangfuse({
  windowStart = "",
  windowEnd = "",
  fetchFn = globalThis.fetch,
  langfuseUrl = "",
  langfuseKey = "",
  retries = 0,
  env = process.env as Record<string, string | undefined>,
}: {
  windowStart?: string;
  windowEnd?: string;
  fetchFn?: typeof fetch;
  langfuseUrl?: string;
  langfuseKey?: string;
  retries?: number;
  env?: Record<string, string | undefined>;
} = {}): Promise<Record<string, unknown>> {
  let payload;
  try {
    payload = createCollectorEnvelope({
      source: "langfuse",
      windowStart,
      windowEnd,
    });
  } catch (error: unknown) {
    return {
      source: "langfuse",
      window: { start: String(windowStart || ""), end: String(windowEnd || "") },
      missing_data: [{
        reason: MissingDataReason.WINDOW_INVALID,
        detail: String((error as Error)?.message || error),
      }],
      ...withDefaults(),
    };
  }

  const baseUrl = String(
    langfuseUrl
      || env?.LANGFUSE_BASE_URL
      || env?.LANGFUSE_URL
      || "",
  ).trim();
  const headers = resolveAuthHeaders({ langfuseKey, env });

  if (!baseUrl || !headers || typeof fetchFn !== "function") {
    addMissingData(payload, MissingDataReason.SOURCE_MISSING, "Langfuse API unavailable", {
      source_hint: "LANGFUSE_BASE_URL/LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY",
    });
    return finalizeCollectorEnvelope({
      ...payload,
      ...withDefaults(),
    });
  }
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  let page = 1;
  let totalPages = 1;
  const rawTraces = [];

  while (page <= totalPages) {
    const query = new URLSearchParams({
      fromTimestamp: payload.window.start,
      toTimestamp: payload.window.end,
      limit: "100",
      page: String(page),
    });

    const result = await fetchJsonWithRetries({
      fetchFn,
      url: `${normalizedBaseUrl}/api/public/traces?${query.toString()}`,
      headers,
      retries,
    });

    if (!result.ok) {
      addMissingData(payload, MissingDataReason.SOURCE_MISSING, "Langfuse API unavailable", {
        status: Number(result?.status || 0),
        error: String(result?.error || ""),
      });
      return finalizeCollectorEnvelope({
        ...payload,
        ...withDefaults(),
      });
    }

    if (!result.body || typeof result.body !== "object") {
      addMissingData(payload, MissingDataReason.PARSE_ERROR, "Langfuse traces payload was not valid JSON");
      return finalizeCollectorEnvelope({
        ...payload,
        ...withDefaults(),
      });
    }

    const body = result.body as Record<string, unknown> | null;
    rawTraces.push(...toArray((body as LangfuseTrace)?.data || (body as LangfuseTrace)?.traces));
    totalPages = Math.max(1, Number(((body as LangfuseTrace)?.meta as LangfuseTrace)?.totalPages || page));
    page += 1;
  }

  const normalizedTraces = rawTraces
    .map((rawTrace) => {
      const trace = rawTrace as LangfuseTrace;
      const id = resolveTraceId(trace);
      const timestamp = resolveTimestamp(trace);
      return {
        id,
        trace_id: id,
        timestamp,
        skill: resolveSkill(trace),
        model: resolveModel(trace),
        abstraction_level: resolveAbstractionLevel(trace),
        graph_id: resolveGraph(trace),
        phase: resolvePhase(trace),
        tokens_total: resolveTokenCount(trace),
        cost_usd: resolveCost(trace),
        duration_ms: resolveLatency(trace),
        name: String(trace?.name || ""),
        event_kind: String(trace?.metadata?.["hatch.event_kind"] || ""),
        factory_id: String(trace?.metadata?.factory_id || trace?.metadata?.["hatch.factory_meta.factory_id"] || ""),
        judgeContextScopeIdentity: resolveScopeIdentity(trace),
      };
    })
    .filter((trace) => trace.id && inWindow(trace.timestamp, payload._windowMs.startMs, payload._windowMs.endMs));

  const totals = normalizedTraces.reduce((acc, trace) => ({
    trace_count: acc.trace_count + 1,
    tokens_total: acc.tokens_total + toNumber(trace.tokens_total, 0),
    cost_total_usd: acc.cost_total_usd + toNumber(trace.cost_usd, 0),
  }), {
    trace_count: 0,
    tokens_total: 0,
    cost_total_usd: 0,
  });

  const sampledTraces = normalizedTraces.slice(0, 10).map((trace) => ({
    trace_id: trace.id,
    skill: trace.skill,
    model: trace.model,
    timestamp: trace.timestamp,
    judgeContextScopeIdentity: trace.judgeContextScopeIdentity || null,
  }));

  const dashboardUrl = normalizedBaseUrl
    ? `${normalizedBaseUrl}/project/traces?filter=timestamp%3E%3D${encodeURIComponent(payload.window.start)}%26timestamp%3C%3D${encodeURIComponent(payload.window.end)}`
    : "";

  return finalizeCollectorEnvelope({
    ...payload,
    trace_count: normalizedTraces.length,
    dashboard_url: dashboardUrl,
    sampled_trace_ids: sampledTraces.map((trace) => trace.trace_id),
    sampled_traces: sampledTraces,
    judge_context_scope_identities: uniqueScopeIdentities(sampledTraces),
    totals,
    by_skill: aggregateRows(normalizedTraces, "skill"),
    by_model: aggregateRows(normalizedTraces, "model"),
    by_abstraction_level: aggregateRows(normalizedTraces, "abstraction_level"),
    by_graph: aggregateRows(normalizedTraces, "graph_id"),
    by_phase: aggregateRows(normalizedTraces, "phase"),
  });
}
