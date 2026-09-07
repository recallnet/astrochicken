import { expect, test } from "vitest";

import { collectLangfuseMetrics } from "./daily-lens-langfuse-metrics.js";

const WINDOW_START = "2026-03-16T00:00:00.000Z";
const WINDOW_END = "2026-03-17T00:00:00.000Z";

test("collectLangfuseMetrics returns pre-aggregated KPIs from daily metrics API", async () => {
  const requests: Array<{ url: string; options: Record<string, unknown> }> = [];
  const payload = await collectLangfuseMetrics({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    langfuseUrl: "https://us.cloud.langfuse.com",
    fetchFn: async (url, options) => {
      requests.push({ url: String(url), options: (options || {}) as Record<string, unknown> });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: [
              {
                date: "2026-03-16",
                countTraces: 112,
                countObservations: 450,
                totalCost: 4.56,
                usage: [
                  { model: "openai/gpt-5.3-codex", inputUsage: 4000000, outputUsage: 800000, totalUsage: 4800000, totalCost: 3.8, countObservations: 95, countTraces: 95 },
                  { model: "claude-opus-4.6", inputUsage: 600000, outputUsage: 138017, totalUsage: 738017, totalCost: 0.76, countObservations: 17, countTraces: 17 },
                ],
              },
            ],
          };
        },
      };
    },
    env: {
      LANGFUSE_PUBLIC_KEY: "pk-live-test",
      LANGFUSE_SECRET_KEY: "sk-live-test",
    },
  });

  expect(payload.source).toBe("langfuse_metrics");
  expect(payload.missing_data).toHaveLength(0);
  expect(payload.totals).toEqual({
    trace_count: 112,
    cost_total_usd: 4.56,
    tokens_total: 5538017,
  });
  // Latency is not available from daily endpoint
  expect(payload.latency).toEqual({
    p50_ms: 0,
    p90_ms: 0,
    p95_ms: 0,
  });
  expect(payload.by_model).toHaveLength(2);
  expect(payload.by_model[0]?.key).toBe("claude-opus-4.6");
  expect(payload.by_model[1]?.key).toBe("openai/gpt-5.3-codex");
  expect(requests[0]?.url).toMatch(/\/api\/public\/metrics\/daily/);
  expect(requests[0]?.options.method).toBeUndefined(); // GET has no method set
});

test("collectLangfuseMetrics uses basic auth from env vars", async () => {
  let capturedHeaders: Record<string, string> = {};
  await collectLangfuseMetrics({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    langfuseUrl: "https://us.cloud.langfuse.com",
    fetchFn: async (_url, options) => {
      capturedHeaders = (options?.headers || {}) as Record<string, string>;
      return {
        ok: true,
        status: 200,
        async json() { return { data: [] }; },
      };
    },
    env: {
      LANGFUSE_PUBLIC_KEY: "pk-live-abc",
      LANGFUSE_SECRET_KEY: "sk-live-xyz",
    },
  });

  expect(capturedHeaders.authorization).toBe(
    `Basic ${Buffer.from("pk-live-abc:sk-live-xyz").toString("base64")}`,
  );
  // GET requests don't send content-type
});

test("collectLangfuseMetrics returns source_missing when credentials are absent", async () => {
  const payload = await collectLangfuseMetrics({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    env: {},
  });

  expect(payload.source).toBe("langfuse_metrics");
  expect(payload.missing_data).toHaveLength(1);
  expect(payload.missing_data[0]?.reason).toBe("source_missing");
  expect(payload.totals.trace_count).toBe(0);
  expect(payload.totals.cost_total_usd).toBe(0);
});

test("collectLangfuseMetrics returns structured data on API failure", async () => {
  const payload = await collectLangfuseMetrics({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    langfuseUrl: "https://us.cloud.langfuse.com",
    fetchFn: async () => ({ ok: false, status: 500, async json() { return {}; } }),
    env: {
      LANGFUSE_PUBLIC_KEY: "pk-live-test",
      LANGFUSE_SECRET_KEY: "sk-live-test",
    },
  });

  expect(payload.missing_data).toHaveLength(1);
  expect(payload.missing_data[0]?.reason).toBe("source_missing");
  expect(payload.totals.trace_count).toBe(0);
});

test("collectLangfuseMetrics encodes time window in URL params for daily endpoint", async () => {
  let capturedUrl = "";
  await collectLangfuseMetrics({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    langfuseUrl: "https://us.cloud.langfuse.com",
    fetchFn: async (url) => {
      capturedUrl = String(url);
      return { ok: true, status: 200, async json() { return { data: [] }; } };
    },
    env: {
      LANGFUSE_PUBLIC_KEY: "pk-live-test",
      LANGFUSE_SECRET_KEY: "sk-live-test",
    },
  });

  expect(capturedUrl).toContain("/api/public/metrics/daily");
  expect(capturedUrl).toContain(`fromTimestamp=${encodeURIComponent(WINDOW_START)}`);
  expect(capturedUrl).toContain(`toTimestamp=${encodeURIComponent(WINDOW_END)}`);
});
