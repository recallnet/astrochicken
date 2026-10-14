import path from "node:path";

export const DAILY_LENS_WINDOW_START = "2026-03-15T14:45:00.000Z";
export const DAILY_LENS_WINDOW_END = "2026-03-16T14:45:00.000Z";

export const DAILY_LENS_REQUIRED_DATASET_IDS = [
  "langfuse",
  "langfuse_metrics",
  "github",
  "git",
  "hatch_runs",
  "supervisor",
  "managed_fleet",
  "agent_learnings",
  "past_lens_outputs",
  "pending_suggestions",
  "llm_inventory",
  "goal_decomposition_timeouts",
];

export function createDailyLensCollectedFixture({
  windowStart = DAILY_LENS_WINDOW_START,
  windowEnd = DAILY_LENS_WINDOW_END,
  includeExternalDatasetPaths = false,
  externalDatasetPaths = {},
} = {}) {
  const collected = {
    base: {
      langfuse: {
        source: "langfuse",
        window: { start: windowStart, end: windowEnd },
        trace_count: 2,
        traces: [{ trace_id: "trace-1" }, { trace_id: "trace-2" }],
        missing_data: [{ reason: "source_missing", detail: "langfuse unavailable" }],
        meta: { error: "langfuse_gap" },
      },
      github: {
        source: "github_state",
        window: { start: windowStart, end: windowEnd },
        issues: [{ number: 1 }, { number: 2 }],
        pull_requests: [{ number: 3 }],
        missing_data: [],
        meta: {},
      },
      git: {
        source: "git_history",
        window: { start: windowStart, end: windowEnd },
        commits: [{ sha: "abc123" }],
        commit_count: 1,
        missing_data: [],
        meta: {},
      },
      hatch_runs: {
        source: "runs_artifacts",
        window: { start: windowStart, end: windowEnd },
        runs: [{ run_id: "run-1" }, { run_id: "run-2" }],
        counts: { guarded_runs: 1 },
        missing_data: [],
        meta: {},
      },
      langfuse_metrics: {
        source: "langfuse_metrics",
        window: { start: windowStart, end: windowEnd },
        totals: { trace_count: 112, tokens_total: 5538017, cost_total_usd: 4.56 },
        latency: { p50_ms: 12300, p90_ms: 45200, p95_ms: 67800 },
        by_model: [{ key: "openai/gpt-5.3-codex", count: 95, tokens_total: 4800000, cost_total_usd: 3.80 }],
        missing_data: [],
        meta: {},
      },
      managed_fleet: {
        source: "managed_fleet",
        factories: [{ factory_id: "fixture-factory" }],
        summary: { active_factory_count: 1, total_runs: 2, total_commits: 3 },
        missing_data: [],
        meta: {},
      },
      supervisor: {
        source: "supervisor_status",
        window: { start: windowStart, end: windowEnd },
        runs: [{ run_id: "run-a" }],
        ticks: [{ run_id: "tick-a" }],
        missing_data: [],
        meta: {},
      },
    },
    pending_suggestions: [{ id: "pending-1" }, { id: "pending-2" }],
    past_lens_outputs: [{ date: "2026-03-15" }],
  };

  if (!includeExternalDatasetPaths) return collected;

  return {
    ...collected,
    agent_learnings: {
      path: String(externalDatasetPaths.agentLearningsPath || "").trim(),
      entries: [{ heading: "2026-03-16", body: "learning" }],
    },
    llm_inventory: {
      path: String(externalDatasetPaths.llmInventoryPath || "").trim(),
      generated_at: "2026-03-16T01:00:00.000Z",
    },
    goal_decomposition_timeouts: {
      path: String(externalDatasetPaths.goalDecompositionTimeoutsPath || "").trim(),
      defaults: { soft_ms: 1000 },
    },
  };
}

export function createDailyLensExternalDatasetPaths(rootDir = "") {
  const base = path.join(rootDir, "external-datasets");
  return {
    agentLearningsPath: path.join(base, "AGENT-LEARNINGS.md"),
    llmInventoryPath: path.join(base, "llm-role-session-baseline.json"),
    goalDecompositionTimeoutsPath: path.join(base, "goal-decomposition-timeouts.json"),
  };
}
