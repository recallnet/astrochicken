import { describe, expect, test } from "vitest";

import { collectLangfuse } from "./daily-lens-langfuse.js";

const WINDOW_START = "2026-03-05T00:00:00.000Z";
const WINDOW_END = "2026-03-06T00:00:00.000Z";

test("collectLangfuse normalizes traces, aggregates cost and tokens, and preserves scope identity", async () => {
  const payload = await collectLangfuse({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    langfuseUrl: "https://langfuse.example",
    langfuseKey: "lf-key",
    fetchFn: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          data: [
            {
              id: "trace-1",
              timestamp: "2026-03-05T02:00:00.000Z",
              model: "openai/o3",
              metadata: {
                langfuse_skill: "reviewer",
                "hatch.abstraction_level": "review",
                "hatch.graph_id": "wave_execute.dot",
                "hatch.phase": "review",
                judgeContextScopeIdentity: { repo: "recallnet/astrochicken", issue: 1325 },
              },
              usage: { totalTokens: 321 },
              totalCost: 0.42,
            },
            {
              id: "trace-2",
              timestamp: "2026-03-05T09:00:00.000Z",
              model: "openai/gpt-5.3-codex",
              metadata: {
                langfuse_skill: "coder",
                "hatch.abstraction_level": "wave",
                "hatch.graph_id": "goal_run.dot",
                "hatch.phase": "implement",
              },
              usage: { totalTokens: 100 },
              totalCost: 0.1,
            },
          ],
        };
      },
    }),
  });

  expect(payload.source).toBe("langfuse");
  expect(payload.window).toEqual({ start: WINDOW_START, end: WINDOW_END });
  expect(payload.missing_data).toHaveLength(0);
  expect(payload.trace_count).toBe(2);
  expect(payload.sampled_trace_ids).toEqual(["trace-1", "trace-2"]);
  expect(payload.totals).toEqual({
    trace_count: 2,
    tokens_total: 421,
    cost_total_usd: 0.52,
  });
  expect(payload.judge_context_scope_identities).toHaveLength(1);
  expect(payload.judge_context_scope_identities[0]).toEqual({ repo: "recallnet/astrochicken", issue: 1325 });
  expect(payload.by_abstraction_level.map((row) => row.key)).toEqual(["review", "wave"]);
  expect(payload.by_graph.map((row) => row.key)).toEqual(["goal_run.dot", "wave_execute.dot"]);
  expect(payload.by_phase.map((row) => row.key)).toEqual(["implement", "review"]);
});

test("collectLangfuse returns structured missing_data marker on API failure", async () => {
  const payload = await collectLangfuse({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    langfuseUrl: "https://langfuse.example",
    langfuseKey: "lf-key",
    fetchFn: async () => ({ ok: false, status: 503, async json() { return {}; } }),
  });

  expect(payload.trace_count).toBe(0);
  expect(payload.missing_data).toHaveLength(1);
  expect(payload.missing_data[0]?.reason).toBe("source_missing");
  expect(payload.missing_data[0]?.detail).toMatch(/Langfuse API unavailable/);
});

test("collectLangfuse uses public traces API with basic auth and paginates", async () => {
  const requests: Array<{ url: string; options: Record<string, unknown> }> = [];
  const payload = await collectLangfuse({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    langfuseUrl: "https://us.cloud.langfuse.com",
    fetchFn: async (url, options = {}) => {
      requests.push({ url: String(url), options: options as Record<string, unknown> });
      const page = Number(new URL(String(url)).searchParams.get("page") || "1");
      return {
        ok: true,
        status: 200,
        async json() {
          if (page === 1) {
            return {
              data: [
                {
                  id: "trace-public-1",
                  timestamp: "2026-03-05T02:00:00.000Z",
                  metadata: {
                    langfuse_skill: "reviewer",
                    "hatch.abstraction_level": "review",
                    "hatch.graph_id": "wave_execute.dot",
                    "hatch.phase": "review",
                  },
                  usage: { total: 21 },
                  totalCost: 0.05,
                },
              ],
              meta: { page: 1, totalPages: 2 },
            };
          }

          return {
            data: [
              {
                id: "trace-public-2",
                timestamp: "2026-03-05T04:00:00.000Z",
                metadata: {
                  langfuse_skill: "coder",
                  "hatch.abstraction_level": "wave",
                  "hatch.graph_id": "goal_run.dot",
                  "hatch.phase": "implement",
                },
                usage: { input: 30, output: 12, total: 42 },
                totalCost: 0.1,
              },
            ],
            meta: { page: 2, totalPages: 2 },
          };
        },
      };
    },
    env: {
      LANGFUSE_PUBLIC_KEY: "pk-live-test",
      LANGFUSE_SECRET_KEY: "sk-live-test",
    },
  });

  expect(payload.trace_count).toBe(2);
  expect(requests).toHaveLength(2);
  expect(requests[0]?.url).toMatch(/\/api\/public\/traces\?/);
  expect(requests[0]?.url).toMatch(/page=1/);
  expect(requests[1]?.url).toMatch(/page=2/);
  expect((requests[0]?.options?.headers as Record<string, string>)?.authorization).toBe(
    `Basic ${Buffer.from("pk-live-test:sk-live-test").toString("base64")}`,
  );
});

test("collectLangfuse retries transient public API failures before succeeding", async () => {
  let attempts = 0;
  const payload = await collectLangfuse({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    langfuseUrl: "https://us.cloud.langfuse.com",
    retries: 2,
    fetchFn: async () => {
      attempts += 1;
      if (attempts < 3) {
        return { ok: false, status: 503, async json() { return { message: "down" }; } };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: [
              {
                id: "trace-retried",
                timestamp: "2026-03-05T02:30:00.000Z",
                metadata: { langfuse_skill: "reviewer" },
                usage: { total: 10 },
                totalCost: 0.01,
              },
            ],
            meta: { page: 1, totalPages: 1 },
          };
        },
      };
    },
    env: {
      LANGFUSE_PUBLIC_KEY: "pk-live-test",
      LANGFUSE_SECRET_KEY: "sk-live-test",
    },
  });

  expect(attempts).toBe(3);
  expect(payload.missing_data).toHaveLength(0);
  expect(payload.trace_count).toBe(1);
});
