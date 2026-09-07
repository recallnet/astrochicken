import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";


import {
  CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES,
} from "./canonical-domain-events.ts";
import { summarizeOpenProjectedPacketsFromRows } from "./canonical-packet-projection.ts";
import {
  projectRunsFromCanonicalRows,
  readProjectedRunState as readState,
} from "./canonical-run-projection.ts";
import { buildControlPlaneStatus } from "./control-plane-status.ts";
import { normalizeFactoryContext } from "./factory-context-resolver.ts";
import {
  deriveRunAgeSignals,
  deriveManagedState,
  parseActiveChildrenInState,
  parseControlPlaneBlockedFromContext,
} from "./factory-status-support.ts";
import { resolveGoalExecutionPathMetadata } from "./goal-execution-path-visibility.ts";
import { ensureProjectionDimensions } from "./insight-contract.ts";
import { buildPostgresPoolOptions, createResilientPool } from "./postgres-pool-options.ts";

const STATUS_PROJECTION_SQL = `
create table if not exists factory_status_projection (
  factory_id text primary key,
  after_commit_cursor bigint not null,
  projected_at timestamptz not null default now(),
  projection jsonb not null
);
`;
const STATUS_PROJECTION_SCHEMA_LOCK_KEY = 641206;

const TERMINAL_FAILURE_STATUSES = new Set(["failed", "suspended", "guarded", "guarded_terminal", "blocked", "terminal"]);
const EMPTY_HARD_GOAL_REVIEW = Object.freeze({
  repo: "",
  goal_count: 0,
  hard_goal_count: 0,
  needs_planning_count: 0,
  awaiting_post_plan_review_count: 0,
  approved_plan_resume_count: 0,
  awaiting_post_plan_review_goal_numbers: [],
  approved_plan_resume_goal_numbers: [],
  hard_goals: [],
});
const EMPTY_HARD_PLAN_TRACEABILITY = Object.freeze({
  goals_with_materialized_hard_plans: 0,
  goals: [],
});

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function parseIsoMs(value) {
  if (!value) return 0;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
}

function isProcessAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readMetadata(runsDir = "", runId = "") {
  if (!runsDir || !runId) return null;
  const metadataPath = join(runsDir, runId, "metadata.json");
  if (!existsSync(metadataPath)) return null;
  return parseJson(readFileSync(metadataPath, "utf8"), null);
}

function isStaleOrphanedActiveRun({ run = {}, runsDir = "", staleMs = 0, nowMs = Date.now() } = {}) {
  if (String(run.status || "") !== "running") return false;
  const state = readState(runsDir, run.id) || {};
  const metadata = readMetadata(runsDir, run.id) || {};
  const freshestMs = Math.max(
    parseIsoMs(metadata.heartbeatAt),
    parseIsoMs(state.updatedAt),
    parseIsoMs(run.updated_at),
  );
  if (!freshestMs) return false;
  if (nowMs - freshestMs < staleMs) return false;
  const pid = Number(metadata.pid ?? state.pid);
  return !isProcessAlive(pid);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildControlStateFromEvent(row) {
  if (!row) return {};
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  const stateAction = String(payload.state_action || payload.action || "").trim();
  const makeActionState = (name) => ({ active: stateAction === name });
  return {
    reason: String(payload.reason || "").trim(),
    retry_target: String(payload.retry_target || "").trim(),
    state_path: String(payload.state_path || "").trim(),
    action_state: {
      pause: makeActionState("pause"),
      quarantine: makeActionState("quarantine"),
      retry: makeActionState("retry"),
      unblock: makeActionState("unblock"),
      resume: makeActionState("resume"),
    },
  };
}

function toActiveRow(run = {}, diskState = null, nowMs = Date.now()) {
  const updatedMs = parseIsoMs(run.updated_at);
  const state = diskState && typeof diskState === "object" ? diskState : {};
  const activeChildren = parseActiveChildrenInState(state);
  const children = activeChildren.map((child) => ({
    name: child.parent_node_id,
    runId: child.run_id,
    child_id: child.child_id,
    parent_node_id: child.parent_node_id,
    role: child.role,
    trace_kind: child.trace_kind,
    worker_index: child.worker_index,
    status: child.status,
    current_node: child.current_node,
    session_id: child.session_id,
  }));
  const blockedControlPlane = parseControlPlaneBlockedFromContext(state.context || {});
  const goalExecutionPathMetadata = resolveGoalExecutionPathMetadata(state.context || {});
  const ageSignals = deriveRunAgeSignals({
    started_at: run.started_at,
    updated_at: run.updated_at,
  }, {
    now: nowMs,
    fallbackUpdatedMs: updatedMs,
  });
  return {
    id: run.id,
    run_id: run.run_id,
    status: run.status,
    node: run.node || "?",
    current_node: run.current_node || run.node || "?",
    graph: run.graph,
    issue: run.issue,
    milestone: run.milestone,
    started_at: run.started_at,
    startedAt: run.started_at,
    updated_at: run.updated_at,
    updatedAt: run.updated_at,
    ...ageSignals,
    children,
    active_children: activeChildren,
    control_plane_blocked: blockedControlPlane,
    ...goalExecutionPathMetadata,
  };
}

export async function ensureFactoryStatusProjectionSchema({ connectionString = "", pool = null } = {}) {
  const ownedPool = pool || await createResilientPool(buildPostgresPoolOptions({ connectionString }));
  try {
    const client = await ownedPool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock($1)", [STATUS_PROJECTION_SCHEMA_LOCK_KEY]);
      await client.query(STATUS_PROJECTION_SQL);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } finally {
    if (!pool) await ownedPool.end();
  }
}

export async function projectFactoryStatusToPostgres({
  connectionString,
  factoryId = "",
  runsDir = ".hatch/runs",
  context = {},
  staleMinutes = 20,
  now = Date.now(),
} = {}) {
  const normalizedFactoryId = String(factoryId || context?.factory_id || "").trim();
  if (!normalizedFactoryId) {
    throw new Error("factoryId is required");
  }

  const pool = await createResilientPool(buildPostgresPoolOptions({ connectionString }));
  try {
    await ensureFactoryStatusProjectionSchema({ pool });
    const resolvedContext = normalizeFactoryContext({
      ...context,
      factory_id: normalizedFactoryId,
    }, { runsDirFallback: runsDir });
    const controlPlaneStatus = buildControlPlaneStatus({ runsDir, context: resolvedContext });
    const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const staleMs = Math.max(1, Number(staleMinutes) || 20) * 60 * 1000;

    const result = await pool.query(
      `select * from factory_events
         where factory_id = $1
         order by commit_cursor asc, batch_offset asc`,
      [normalizedFactoryId],
    );
    const rows = result.rows || [];
    const { runs, latestControlAction } = projectRunsFromCanonicalRows(rows, runsDir);
    const controlState = latestControlAction
      ? buildControlStateFromEvent(latestControlAction)
      : {
        reason: "",
        retry_target: "",
        state_path: "",
        action_state: {
          pause: { active: false },
          quarantine: { active: false },
          draining: { active: false },
          retry: { active: false },
          unblock: { active: false },
          resume: { active: false },
        },
      };

    let completed = 0;
    let failed = 0;
    let latestCompletedMs = 0;
    let latestFailedMs = 0;
    const active = [];
    let latestBlockedControlPlane = [];
    let latestBlockedControlPlaneMs = 0;

    for (const run of runs) {
      const updatedMs = parseIsoMs(run.updated_at);
      const diskState = readState(runsDir, run.id) || {};
      if (run.status === "completed") {
        completed += 1;
        latestCompletedMs = Math.max(latestCompletedMs, updatedMs);
        continue;
      }
      if (TERMINAL_FAILURE_STATUSES.has(String(run.status || "").trim())) {
        failed += 1;
        latestFailedMs = Math.max(latestFailedMs, updatedMs);
        continue;
      }
      if (isStaleOrphanedActiveRun({ run, runsDir, staleMs, nowMs })) {
        failed += 1;
        latestFailedMs = Math.max(latestFailedMs, updatedMs);
        continue;
      }

      const blockedControlPlane = parseControlPlaneBlockedFromContext(diskState.context || {});
      if (blockedControlPlane.length > 0 && updatedMs >= latestBlockedControlPlaneMs) {
        latestBlockedControlPlane = blockedControlPlane;
        latestBlockedControlPlaneMs = updatedMs;
      }
      active.push(toActiveRow(run, diskState, nowMs));
    }

    active.sort((left, right) => Number(left.last_progress_age_ms || 0) - Number(right.last_progress_age_ms || 0));

    const managedState = deriveManagedState({
      controlState,
      controlPlane: controlPlaneStatus,
      blockedControlPlane: latestBlockedControlPlane,
      failed,
      latestCompletedMs,
      latestFailedMs,
    });
    const afterCommitCursor = rows.reduce((max, row) => Math.max(max, Number(row.commit_cursor || 0)), 0);
    const projection = ensureProjectionDimensions("factory_status", {
      context: resolvedContext,
      active,
      runs: active,
      completed,
      failed,
      blocked_control_plane: latestBlockedControlPlane,
      managed_state: {
        ...managedState,
        state_path: String(controlState.state_path || ""),
      },
      control_plane: controlPlaneStatus,
      open_packets: summarizeOpenProjectedPacketsFromRows({ rows, runsDir, nowMs }),
      hard_goal_review: cloneJson(EMPTY_HARD_GOAL_REVIEW),
      hard_plan_traceability: cloneJson(EMPTY_HARD_PLAN_TRACEABILITY),
    });

    await pool.query(
      `insert into factory_status_projection (factory_id, after_commit_cursor, projection)
       values ($1, $2, $3::jsonb)
       on conflict (factory_id)
       do update set
         after_commit_cursor = excluded.after_commit_cursor,
         projected_at = now(),
         projection = excluded.projection`,
      [normalizedFactoryId, afterCommitCursor, JSON.stringify(projection)],
    );

    return {
      factory_id: normalizedFactoryId,
      after_commit_cursor: afterCommitCursor,
      projection,
    };
  } finally {
    await pool.end();
  }
}

export async function readFactoryStatusProjection({
  connectionString,
  factoryId = "",
} = {}) {
  const normalizedFactoryId = String(factoryId || "").trim();
  if (!normalizedFactoryId) return null;
  const pool = await createResilientPool(buildPostgresPoolOptions({ connectionString }));
  try {
    const result = await pool.query(
      `select factory_id, after_commit_cursor, projected_at, projection
         from factory_status_projection
        where factory_id = $1`,
      [normalizedFactoryId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      factory_id: String(row.factory_id),
      after_commit_cursor: Number(row.after_commit_cursor || 0),
      projected_at: new Date(String(row.projected_at)).toISOString(),
      projection: row.projection && typeof row.projection === "object" ? row.projection : {},
    };
  } finally {
    await pool.end();
  }
}
