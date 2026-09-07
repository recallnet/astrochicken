import { z } from "zod";

import { resolveCanonicalEventStoreUrl } from "./canonical-event-store-url.ts";
import { legacyFixtureFactoryStatus } from "./factory-status-support.ts";
import {
  formatFactoryStatus,
} from "./factory-status-support.ts";
import { runInlineProjectionSync } from "./inline-projection-runner.ts";
import { overlayInvocationFactoryContext } from "./projection-context-portability.ts";

const activeChildSchema = z.object({
  child_id: z.string(),
  parent_node_id: z.string(),
  run_id: z.string(),
  role: z.string().optional().default(""),
  trace_kind: z.string().optional().default(""),
  worker_index: z.number().nullable().optional(),
  status: z.string().optional().default("running"),
  current_node: z.string().optional().default(""),
  session_id: z.string().optional().default(""),
}).passthrough();

const activeRunSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  status: z.string(),
  node: z.string(),
  current_node: z.string(),
  graph: z.string().optional().default(""),
  issue: z.union([z.string(), z.number()]).optional().transform((value) => value === undefined ? "" : String(value)),
  milestone: z.string().optional().default(""),
  started_at: z.string().optional().default(""),
  startedAt: z.string().optional().default(""),
  updated_at: z.string().optional().default(""),
  updatedAt: z.string().optional().default(""),
  age_ms: z.number().optional().default(0),
  age: z.string().optional().default("0ms"),
  last_progress_age_ms: z.number().optional().default(0),
  last_progress_age: z.string().optional().default("0ms"),
  children: z.array(z.any()).optional().default([]),
  active_children: z.array(activeChildSchema).optional().default([]),
  control_plane_blocked: z.array(z.any()).optional().default([]),
}).passthrough();

const factoryStatusProjectionSchema = z.object({
  context: z.record(z.string(), z.any()).optional().default({}),
  active: z.array(activeRunSchema),
  runs: z.array(activeRunSchema),
  completed: z.number(),
  failed: z.number(),
  blocked_control_plane: z.array(z.any()).optional().default([]),
  managed_state: z.object({
    state_action: z.string(),
    reason: z.string().optional().default(""),
    retry_target: z.string().optional().default(""),
    health_classification: z.string(),
    state_path: z.string().optional().default(""),
  }).passthrough(),
  control_plane: z.record(z.string(), z.any()).optional().default({}),
  open_packets: z.array(z.any()).optional().default([]),
  hard_goal_review: z.record(z.string(), z.any()).optional().default({}),
  hard_plan_traceability: z.record(z.string(), z.any()).optional().default({}),
}).passthrough();

function buildInlineProjectionScript({
  connectionString,
  factoryId,
  runsDir,
  staleMinutes,
  now,
  context,
}) {
  return `
    const { readLatestCanonicalEventCursor } = await import(${JSON.stringify(new URL("./canonical-projection-freshness.ts", import.meta.url).href)});
    const { projectFactoryStatusToPostgres, readFactoryStatusProjection } = await import(${JSON.stringify(new URL("./factory-status-postgres-projection.ts", import.meta.url).href)});
    const latestCursor = await readLatestCanonicalEventCursor(${JSON.stringify({
      connectionString,
      factoryId,
    })});
    let persisted = null;
    try {
      persisted = await readFactoryStatusProjection(${JSON.stringify({
        connectionString,
        factoryId,
      })});
    } catch {}
    // @context:decision !critical Factory detail reads must prefer the stored
    // canonical projection when its cursor already matches the event store.
    // Reprojecting on every status read drags the TUI back through full event
    // scans and disk enrichment even when nothing changed.
    //
    // @context:regression !critical The factory_status_projection table is keyed
    // by factory_id only. Two CLI invocations from different roots (control-plane
    // layout vs external layout) share the same factory_id and the same event
    // store but resolve different factory_root and runs_dir values. A cached
    // projection from a previous run carries stale path fields and a stale
    // control_plane block (which reads release manifests from disk). Invalidate
    // the cache when the caller's factory_config_path or factory_root differs from
    // what is stored, so context-portability is preserved across sequential spawns.
    const callerFactoryConfigPath = ${JSON.stringify(String(context?.factory_config_path || ""))};
    const callerFactoryRoot = ${JSON.stringify(String(context?.factory_root || ""))};
    const cachedConfigPath = String((persisted && persisted.projection && persisted.projection.context && persisted.projection.context.factory_config_path) || "");
    const cachedFactoryRoot = String((persisted && persisted.projection && persisted.projection.context && persisted.projection.context.factory_root) || "");
    const contextRootMismatch = (callerFactoryConfigPath && cachedConfigPath && callerFactoryConfigPath !== cachedConfigPath)
      || (callerFactoryRoot && cachedFactoryRoot && callerFactoryRoot !== cachedFactoryRoot);
    if (!contextRootMismatch && persisted && Number(persisted.after_commit_cursor || 0) >= Number(latestCursor || 0)) {
      process.stdout.write(JSON.stringify(persisted.projection));
    } else {
      const result = await projectFactoryStatusToPostgres(${JSON.stringify({
        connectionString,
        factoryId,
        runsDir,
        context,
        staleMinutes,
        now,
      })});
      const refreshed = await readFactoryStatusProjection(${JSON.stringify({
        connectionString,
        factoryId,
      })}).catch(() => null);
      process.stdout.write(JSON.stringify((refreshed && refreshed.projection) || result.projection));
    }
  `;
}

function parseProjectionPayload(raw = "") {
  const parsed = JSON.parse(String(raw || "{}"));
  return factoryStatusProjectionSchema.parse(parsed);
}

function summarizeCanonicalStatusError(error) {
  const stderr = String(error?.stderr || "").trim();
  const message = String(error?.message || error || "").trim();
  const stackCandidate = stderr || message;
  if (!stackCandidate) return "canonical_status_unavailable";
  const lines = stackCandidate
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("Command failed:"))
    .filter((line) => !line.startsWith("at "))
    .filter((line) => !line.startsWith("Node.js v"))
    .filter((line) => !line.includes("/node_modules/"))
    .filter((line) => !line.includes("inline-projection.mjs"));
  const errorLine = lines.find((line) => /^Error:/u.test(line)) || lines[0] || "canonical_status_unavailable";
  return errorLine.replace(/^Error:\s*/u, "").trim() || "canonical_status_unavailable";
}

function canFallbackToLocalStatus(error) {
  const summary = summarizeCanonicalStatusError(error).toLowerCase();
  return [
    "connection terminated unexpectedly",
    "terminating connection",
    "connection closed unexpectedly",
    "connection ended unexpectedly",
    "read econreset",
    "write econreset",
    "the database system is starting up",
    "the database system is shutting down",
    "timeout expired",
    "connect etimedout",
  ].some((fragment) => summary.includes(fragment));
}

export function factoryStatus({
  runsDir = ".hatch/runs",
  staleMinutes = 20,
  context = {},
  now = Date.now(),
  runInlineProjectionSyncFn = runInlineProjectionSync,
  readCanonicalProjectionSyncFn = null,
  legacyFixtureFactoryStatusFn = legacyFixtureFactoryStatus,
} = {}) {
  const factoryId = String(context?.factory_id || "").trim();
  if (!factoryId) {
    throw new Error("factory_id is required for canonical factory status");
  }

  const connectionString = resolveCanonicalEventStoreUrl({ runsDir, context, surface: "canonical factory status" });
  try {
    const stdout = typeof readCanonicalProjectionSyncFn === "function"
      ? readCanonicalProjectionSyncFn({
        connectionString,
        factoryId,
        runsDir,
        staleMinutes,
        now,
        context,
      })
      : runInlineProjectionSyncFn({
        moduleUrl: import.meta.url,
        script: buildInlineProjectionScript({
          connectionString,
          factoryId,
          runsDir,
          staleMinutes,
          now,
          context,
        }),
      });
    return overlayInvocationFactoryContext({
      projection: parseProjectionPayload(stdout),
      context,
      runsDirFallback: runsDir,
    });
  } catch (error) {
    if (!canFallbackToLocalStatus(error)) {
      throw error;
    }
    // @context:regression !critical The fleet/detail TUI must keep rendering
    // through transient canonical Postgres disconnects. Falling back to the
    // local run-state projector preserves operator visibility instead of
    // crashing the detail pane on a dropped pool connection.
    const fallback = legacyFixtureFactoryStatusFn({
      runsDir,
      staleMinutes,
      context,
      now,
    });
    return {
      ...fallback,
      context: {
        ...(fallback?.context && typeof fallback.context === "object" ? fallback.context : {}),
        canonical_status_source: "legacy_fixture_fallback",
        canonical_status_warning: summarizeCanonicalStatusError(error),
      },
    };
  }
}

export { formatFactoryStatus };
