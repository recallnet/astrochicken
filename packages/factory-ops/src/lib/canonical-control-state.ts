import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";


import {
  buildControlActionAppliedEvent,
  CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES,
} from "./canonical-domain-events.ts";
import { resolveCanonicalEventStoreUrl } from "./canonical-event-store-url.ts";
import { trim } from "./cli-helpers.ts";
import {
  MANAGED_FACTORY_SNAPSHOT_SCHEMA,
  normalizeManagedLifecycleSnapshot,
  resolveExternalFactoryControlStatePath,
} from "./external-factory-control-state.ts";
import { runInlineProjectionSync } from "./inline-projection-runner.ts";
import { buildPostgresPoolOptions, createResilientPool } from "./postgres-pool-options.ts";

const FACTORY_EVENTS_SCHEMA_SQL = `
create sequence if not exists canonical_event_commit_seq;
create table if not exists factory_events (
  event_id uuid primary key,
  commit_cursor bigint not null,
  batch_offset integer not null,
  schema text not null,
  event_family text not null,
  event_version integer not null,
  factory_id text not null,
  run_id text,
  emitter text not null,
  emitted_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  event_origin text not null,
  provenance jsonb not null default '{}'::jsonb,
  payload jsonb not null
);
create index if not exists idx_factory_events_factory_cursor on factory_events(factory_id, commit_cursor, batch_offset);
create index if not exists idx_factory_events_commit_cursor on factory_events(commit_cursor, batch_offset);
create index if not exists idx_factory_events_run_id on factory_events(run_id);
`;

const CONTROL_PROJECTION_SQL = `
create table if not exists factory_control_state_projection (
  factory_id text primary key,
  after_commit_cursor bigint not null,
  projected_at timestamptz not null default now(),
  projection jsonb not null
);
`;

const CONTROL_PROJECTION_SCHEMA_LOCK_KEY = 641209;

const LIFECYCLE_EVENT_FAMILY = "factory.control.lifecycle_snapshot_updated";
const ACTIONS = new Set(["pause", "quarantine", "retry", "unblock", "resume"]);

function defaultLifecycleSnapshot() {
  return normalizeManagedLifecycleSnapshot({
    schema_version: MANAGED_FACTORY_SNAPSHOT_SCHEMA,
    lifecycle_state: "",
    lifecycle_reason: "",
    lifecycle_failure_classification: "",
    lifecycle_failure_reason: "",
    lifecycle_updated_at: "",
    lifecycle_updated_by: "",
    blockers: {
      upstream: {
        has_open_upstream_bugs: false,
        open_upstream_bug_count: 0,
        open_upstream_bug_numbers: [],
      },
      action_items: {
        has_action_items: false,
        action_item_count: 0,
      },
    },
    unresolved_actions: 0,
    queue_depth: 0,
    oldest_work_age_seconds: 0,
    latest_incidents: [],
  });
}

function defaultActionState() {
  return {
    pause: { active: false },
    quarantine: { active: false, count: 0, last_reason: "", last_at: "" },
    draining: { active: false, at: "" },
    retry: { active: false, count: 0, last_reason: "", last_at: "", last_target: "" },
    unblock: { active: false, note: "", at: "" },
    resume: { active: false, at: "" },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildDefaultProjection({ factoryId = "", statePath = "" } = {}) {
  return {
    schema: "external-factory-control-state/v1",
    factory_id: trim(factoryId),
    version: 0,
    updated_at: "",
    updated_by: "",
    action_state: defaultActionState(),
    reason: "",
    retry_target: "",
    notes: [],
    lifecycle_state_snapshot: defaultLifecycleSnapshot(),
    state_path: trim(statePath),
  };
}

function clearTransient(actionState = {}) {
  const cleared = cloneJson(defaultActionState());
  const source = actionState && typeof actionState === "object" ? actionState : {};
  cleared.pause.active = source?.pause?.active === true;
  cleared.quarantine.active = source?.quarantine?.active === true;
  cleared.quarantine.count = Number(source?.quarantine?.count || 0);
  cleared.quarantine.last_reason = trim(source?.quarantine?.last_reason || "");
  cleared.quarantine.last_at = trim(source?.quarantine?.last_at || "");
  cleared.draining.active = source?.draining?.active === true;
  cleared.draining.at = trim(source?.draining?.at || "");
  cleared.retry.active = source?.retry?.active === true;
  cleared.retry.count = Number(source?.retry?.count || 0);
  cleared.retry.last_reason = trim(source?.retry?.last_reason || "");
  cleared.retry.last_at = trim(source?.retry?.last_at || "");
  cleared.retry.last_target = trim(source?.retry?.last_target || "");
  cleared.unblock.active = source?.unblock?.active === true;
  cleared.unblock.note = trim(source?.unblock?.note || "");
  cleared.unblock.at = trim(source?.unblock?.at || "");
  cleared.resume.active = source?.resume?.active === true;
  cleared.resume.at = trim(source?.resume?.at || "");
  cleared.pause.active = false;
  cleared.quarantine.active = false;
  cleared.draining.active = false;
  cleared.retry.active = false;
  cleared.unblock.active = false;
  cleared.resume.active = false;
  return cleared;
}

export function buildClearedActionState(actionState = {}) {
  const cleared = clearTransient(actionState);
  return {
    pause: { ...cleared.pause },
    quarantine: { ...cleared.quarantine },
    draining: { ...cleared.draining },
    retry: { ...cleared.retry },
    unblock: { ...cleared.unblock },
    resume: { ...cleared.resume },
  };
}

export function getCanonicalControlActiveAction(state = {}) {
  if (state?.action_state?.pause?.active) return "pause";
  if (state?.action_state?.quarantine?.active) return "quarantine";
  if (state?.action_state?.draining?.active) return "draining";
  if (state?.action_state?.retry?.active) return "retry";
  if (state?.action_state?.unblock?.active) return "unblock";
  if (state?.action_state?.resume?.active) return "resume";
  return "none";
}

function ensureMirrorStatePath({ statePath = "" } = {}) {
  const target = trim(statePath);
  if (!target) return;
  mkdirSync(dirname(target), { recursive: true });
}

function writeMirrorJson(path, payload) {
  // @context:decision !critical Mirror the projected control state for operator
  // tooling and forensic inspection, but never treat the file as authoritative
  // again. Canonical reads must replay Postgres first, then refresh this copy.
  ensureMirrorStatePath({ statePath: path });
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  renameSync(tmpPath, path);
}

function normalizeFactoryId(factoryId = "") {
  const normalized = trim(factoryId);
  if (!normalized) throw new Error("factory_id_required");
  return normalized;
}

function nextVersion(current = {}) {
  return Number(current?.version || 0) + 1;
}

function applyControlActionToProjection(current = {}, { action = "", reason = "", actor = "", retryTarget = "", emittedAt = "" } = {}) {
  const normalizedAction = trim(action).toLowerCase();
  if (!ACTIONS.has(normalizedAction)) {
    const error = new Error(`unsupported_action:${normalizedAction || "(empty)"}`);
    error.code = "invalid_action";
    throw error;
  }
  const normalizedReason = trim(reason);
  if (!normalizedReason) {
    const error = new Error("reason is required");
    error.code = "reason_required";
    throw error;
  }

  const next = cloneJson(current);
  const actionState = next.action_state && typeof next.action_state === "object"
    ? cloneJson(next.action_state)
    : defaultActionState();
  let nextRetryTarget = trim(next.retry_target || "");

  if (normalizedAction === "pause") {
    const toggled = !(actionState.pause?.active === true);
    const cleared = clearTransient(actionState);
    cleared.pause.active = toggled;
    next.action_state = cleared;
  }

  if (normalizedAction === "quarantine") {
    const cleared = clearTransient(actionState);
    cleared.quarantine.active = true;
    cleared.quarantine.count = Number(actionState?.quarantine?.count || 0) + 1;
    cleared.quarantine.last_reason = normalizedReason;
    cleared.quarantine.last_at = emittedAt;
    next.action_state = cleared;
  }

  if (normalizedAction === "retry") {
    const cleared = clearTransient(actionState);
    cleared.retry.active = true;
    cleared.retry.count = Number(actionState?.retry?.count || 0) + 1;
    cleared.retry.last_reason = normalizedReason;
    cleared.retry.last_at = emittedAt;
    cleared.retry.last_target = trim(retryTarget) || trim(actionState?.retry?.last_target || "") || trim(nextRetryTarget);
    nextRetryTarget = trim(cleared.retry.last_target);
    next.action_state = cleared;
  }

  if (normalizedAction === "unblock") {
    const updated = cloneJson(actionState);
    updated.unblock.active = true;
    updated.unblock.note = normalizedReason;
    updated.unblock.at = emittedAt;
    updated.resume.active = false;
    next.action_state = updated;
  }

  if (normalizedAction === "resume") {
    const hasManagedState = actionState.pause?.active === true
      || actionState.quarantine?.active === true
      || actionState.retry?.active === true
      || actionState.unblock?.active === true;
    if (!hasManagedState) {
      const error = new Error("resume_requires_active_managed_state");
      error.code = "invalid_transition";
      throw error;
    }
    if (actionState.quarantine?.active === true && actionState.unblock?.active !== true) {
      const error = new Error("resume_requires_unblock_after_quarantine");
      error.code = "invalid_transition";
      throw error;
    }
    const cleared = clearTransient(actionState);
    cleared.resume.active = true;
    cleared.resume.at = emittedAt;
    nextRetryTarget = "";
    next.action_state = cleared;
  }

  next.version = nextVersion(current);
  next.updated_at = emittedAt;
  next.updated_by = trim(actor) || "operator";
  next.reason = normalizedReason;
  next.retry_target = nextRetryTarget;
  next.notes = [
    ...(Array.isArray(current?.notes) ? current.notes : []),
    {
      at: emittedAt,
      actor: trim(actor) || "operator",
      action: normalizedAction,
      reason: normalizedReason,
      retry_target: trim(retryTarget),
    },
  ];
  return next;
}

function applyLifecycleSnapshotToProjection(current = {}, { actor = "", emittedAt = "", snapshot = {} } = {}) {
  const normalizedSnapshot = normalizeManagedLifecycleSnapshot(snapshot);
  const next = cloneJson(current);
  next.version = nextVersion(current);
  next.updated_at = emittedAt;
  next.updated_by = trim(actor) || trim(normalizedSnapshot.lifecycle_updated_by) || "managed_supervisor";
  next.reason = trim(normalizedSnapshot.lifecycle_reason || "");
  next.lifecycle_state_snapshot = normalizedSnapshot;
  if (trim(normalizedSnapshot.lifecycle_state) === "draining") {
    const updated = cloneJson(next.action_state || defaultActionState());
    updated.draining.active = true;
    updated.draining.at = trim(normalizedSnapshot.lifecycle_updated_at || emittedAt);
    next.action_state = updated;
  } else if (next.action_state?.draining?.active === true) {
    next.action_state.draining.active = false;
  }
  return next;
}

function projectControlStateFromRows({ rows = [], factoryId = "", statePath = "" } = {}) {
  let projection = buildDefaultProjection({ factoryId, statePath });
  let afterCommitCursor = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    const emittedAt = new Date(String(row?.emitted_at || Date.now())).toISOString();
    const payloadStatePath = trim(payload.state_path || projection.state_path || statePath);
    projection.state_path = payloadStatePath;
    if (row.event_family === CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.CONTROL_ACTION_APPLIED) {
      projection = applyControlActionToProjection(projection, {
        action: payload.action,
        reason: payload.reason,
        actor: payload.actor,
        retryTarget: payload.retry_target,
        emittedAt,
      });
      projection.state_path = payloadStatePath;
    }
    if (row.event_family === LIFECYCLE_EVENT_FAMILY) {
      projection = applyLifecycleSnapshotToProjection(projection, {
        actor: payload.actor,
        emittedAt,
        snapshot: payload.lifecycle_state_snapshot || {},
      });
      projection.state_path = payloadStatePath;
    }
    afterCommitCursor = Math.max(afterCommitCursor, Number(row?.commit_cursor || 0));
  }
  return { projection, afterCommitCursor };
}

async function ensureSchemas({ pool }) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock($1)", [CONTROL_PROJECTION_SCHEMA_LOCK_KEY]);
    await client.query(FACTORY_EVENTS_SCHEMA_SQL);
    await client.query(CONTROL_PROJECTION_SQL);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function projectAndPersistControlState({
  pool,
  factoryId = "",
  statePath = "",
} = {}) {
  const result = await pool.query(
    `select *
       from factory_events
      where factory_id = $1
        and event_family = any($2::text[])
      order by commit_cursor asc, batch_offset asc`,
    [factoryId, [CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.CONTROL_ACTION_APPLIED, LIFECYCLE_EVENT_FAMILY]],
  );
  const { projection, afterCommitCursor } = projectControlStateFromRows({
    rows: result.rows || [],
    factoryId,
    statePath,
  });
  await pool.query(
    `insert into factory_control_state_projection (
      factory_id, after_commit_cursor, projection
    ) values ($1, $2, $3::jsonb)
    on conflict (factory_id) do update set
      after_commit_cursor = excluded.after_commit_cursor,
      projected_at = now(),
      projection = excluded.projection`,
    [factoryId, afterCommitCursor, JSON.stringify(projection)],
  );
  return { projection, afterCommitCursor };
}

function createInlineRunner(functionName, args) {
  return `
    const mod = await import(${JSON.stringify(new URL("./canonical-control-state.ts", import.meta.url).href)});
    try {
      const out = await mod.${functionName}(${JSON.stringify(args)});
      process.stdout.write(JSON.stringify({ ok: true, out }));
    } catch (error) {
      process.stdout.write(JSON.stringify({
        ok: false,
        error: {
          code: String(error?.code || ""),
          message: String(error?.message || error || "${functionName}_failed"),
        },
      }));
    }
  `;
}

function runInline(functionName, args) {
  // @context:integration !critical Keep these control-state entrypoints
  // synchronous for existing CLI/daemon call sites by delegating the async
  // Postgres projection work to a child Node process. Reverting to direct
  // in-process async calls would ripple through execution-critical surfaces.
  const stdout = runInlineProjectionSync({
    moduleUrl: import.meta.url,
    script: createInlineRunner(functionName, args),
  });
  const parsed = JSON.parse(String(stdout || "{}"));
  if (parsed?.ok === false) {
    const error = new Error(String(parsed?.error?.message || `${functionName}_failed`));
    error.code = String(parsed?.error?.code || "");
    throw error;
  }
  return parsed?.out ?? {};
}

export function buildLifecycleSnapshotUpdatedEvent({
  factoryId = "",
  runId = "",
  actor = "",
  statePath = "",
  stateVersion = "",
  lifecycleStateSnapshot = {},
  emitter = "packages.factory-ops.supervisor-managed-persist-state.persistManagedLifecycleState",
} = {}) {
  return {
    schema: "canonical_event_envelope/v1",
    event_id: randomUUID(),
    event_family: LIFECYCLE_EVENT_FAMILY,
    event_version: 1,
    factory_id: trim(factoryId),
    run_id: trim(runId) || undefined,
    emitter,
    emitted_at: new Date().toISOString(),
    event_origin: "runtime",
    payload: {
      actor: trim(actor),
      state_path: trim(statePath),
      state_version: Number.isFinite(Number(stateVersion)) ? Number(stateVersion) : trim(stateVersion),
      lifecycle_state_snapshot: normalizeManagedLifecycleSnapshot(lifecycleStateSnapshot),
    },
  };
}

async function appendEvents({ pool, events = [] } = {}) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const next = await client.query("select nextval('canonical_event_commit_seq')");
    const commitCursor = Number(next.rows[0]?.nextval || 0);
    for (const [index, event] of events.entries()) {
      await client.query(
        `insert into factory_events (
          event_id, commit_cursor, batch_offset, schema, event_family, event_version,
          factory_id, run_id, emitter, emitted_at, event_origin, provenance, payload
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)`,
        [
          event.event_id,
          commitCursor,
          index,
          event.schema,
          event.event_family,
          event.event_version,
          event.factory_id,
          event.run_id || null,
          event.emitter,
          event.emitted_at,
          event.event_origin || "runtime",
          JSON.stringify(event.provenance || {}),
          JSON.stringify(event.payload || {}),
        ],
      );
    }
    await client.query("commit");
    return commitCursor;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function resolveConnectionString({ factoryId = "", rootDir = process.cwd(), runsDir = ".hatch/runs", context = {} } = {}) {
  return resolveCanonicalEventStoreUrl({
    runsDir,
    context: {
      ...context,
      factory_id: trim(factoryId) || trim(context?.factory_id),
      repo: trim(rootDir) || trim(context?.repo),
    },
    surface: "canonical control state",
  });
}

export async function readCanonicalFactoryControlState({
  factoryId = "",
  rootDir = process.cwd(),
  runsDir = ".hatch/runs",
  context = {},
  connectionString = "",
} = {}) {
  const normalizedFactoryId = normalizeFactoryId(factoryId);
  const statePath = resolveExternalFactoryControlStatePath({ factoryId: normalizedFactoryId, rootDir });
  const resolvedConnectionString = trim(connectionString) || resolveConnectionString({
    factoryId: normalizedFactoryId,
    rootDir,
    runsDir,
    context,
  });
  const pool = await createResilientPool(buildPostgresPoolOptions({ connectionString: resolvedConnectionString }));
  try {
    await ensureSchemas({ pool });
    const { projection } = await projectAndPersistControlState({
      pool,
      factoryId: normalizedFactoryId,
      statePath,
    });
    writeMirrorJson(statePath, projection);
    return projection;
  } finally {
    await pool.end();
  }
}

export async function applyCanonicalFactoryControlAction({
  action = "",
  factoryId = "",
  reason = "",
  actor = "",
  retryTarget = "",
  expectedVersion = undefined,
  rootDir = process.cwd(),
  runsDir = ".hatch/runs",
  context = {},
  runId = "",
  connectionString = "",
} = {}) {
  const normalizedFactoryId = normalizeFactoryId(factoryId);
  const statePath = resolveExternalFactoryControlStatePath({ factoryId: normalizedFactoryId, rootDir });
  const resolvedConnectionString = trim(connectionString) || resolveConnectionString({
    factoryId: normalizedFactoryId,
    rootDir,
    runsDir,
    context,
  });
  const pool = await createResilientPool(buildPostgresPoolOptions({ connectionString: resolvedConnectionString }));
  try {
    await ensureSchemas({ pool });
    const current = (await projectAndPersistControlState({
      pool,
      factoryId: normalizedFactoryId,
      statePath,
    })).projection;
    const expected = expectedVersion === undefined || expectedVersion === null || expectedVersion === ""
      ? null
      : Number(expectedVersion);
    if (expected !== null && expected !== Number(current.version || 0)) {
      const error = new Error(`expected_version=${expected} actual_version=${Number(current.version || 0)}`);
      error.code = "version_mismatch";
      throw error;
    }
    const preview = applyControlActionToProjection(current, {
      action,
      reason,
      actor,
      retryTarget,
      emittedAt: new Date().toISOString(),
    });
    const event = buildControlActionAppliedEvent({
      factoryId: normalizedFactoryId,
      runId,
      action,
      reason,
      actor,
      retryTarget,
      stateVersion: preview.version,
      stateAction: getCanonicalControlActiveAction(preview),
      statePath,
    });
    await appendEvents({ pool, events: [event] });
    const { projection } = await projectAndPersistControlState({
      pool,
      factoryId: normalizedFactoryId,
      statePath,
    });
    writeMirrorJson(statePath, projection);
    return {
      ok: true,
      action: trim(action).toLowerCase(),
      state_version: Number(projection.version || 0),
      state_path: statePath,
      state: projection,
      state_action: getCanonicalControlActiveAction(projection),
      canonical_events: [event],
    };
  } finally {
    await pool.end();
  }
}

export async function persistCanonicalFactoryLifecycleSnapshot({
  factoryId = "",
  rootDir = process.cwd(),
  lifecycleStateSnapshot = {},
  actor = "",
  runId = "",
  connectionString = "",
  runsDir = ".hatch/runs",
  context = {},
} = {}) {
  const normalizedFactoryId = normalizeFactoryId(factoryId);
  const statePath = resolveExternalFactoryControlStatePath({ factoryId: normalizedFactoryId, rootDir });
  const resolvedConnectionString = trim(connectionString) || resolveConnectionString({
    factoryId: normalizedFactoryId,
    rootDir,
    runsDir,
    context,
  });
  const pool = await createResilientPool(buildPostgresPoolOptions({ connectionString: resolvedConnectionString }));
  try {
    await ensureSchemas({ pool });
    const current = (await projectAndPersistControlState({
      pool,
      factoryId: normalizedFactoryId,
      statePath,
    })).projection;
    const preview = applyLifecycleSnapshotToProjection(current, {
      actor,
      emittedAt: trim(lifecycleStateSnapshot?.lifecycle_updated_at) || new Date().toISOString(),
      snapshot: lifecycleStateSnapshot,
    });
    const event = buildLifecycleSnapshotUpdatedEvent({
      factoryId: normalizedFactoryId,
      runId,
      actor,
      statePath,
      stateVersion: preview.version,
      lifecycleStateSnapshot,
    });
    await appendEvents({ pool, events: [event] });
    const { projection } = await projectAndPersistControlState({
      pool,
      factoryId: normalizedFactoryId,
      statePath,
    });
    writeMirrorJson(statePath, projection);
    return {
      ...projection,
      state_path: statePath,
      lifecycle_state_snapshot: projection.lifecycle_state_snapshot,
    };
  } finally {
    await pool.end();
  }
}

export async function writeCanonicalFactoryControlState({
  factoryId = "",
  rootDir = process.cwd(),
  actor = "",
  reason = "",
  nextState = {},
  expectedVersion = undefined,
  connectionString = "",
  runsDir = ".hatch/runs",
  context = {},
} = {}) {
  const activeAction = getCanonicalControlActiveAction({
    action_state: nextState?.action_state || {},
  });

  if (ACTIONS.has(activeAction)) {
    return applyCanonicalFactoryControlAction({
      action: activeAction,
      factoryId,
      reason,
      actor,
      retryTarget: trim(nextState?.retry_target || ""),
      expectedVersion,
      rootDir,
      connectionString,
      runsDir,
      context,
    });
  }

  if (nextState?.lifecycle_state_snapshot && typeof nextState.lifecycle_state_snapshot === "object") {
    return persistCanonicalFactoryLifecycleSnapshot({
      factoryId,
      rootDir,
      actor,
      connectionString,
      runsDir,
      context,
      lifecycleStateSnapshot: nextState.lifecycle_state_snapshot,
    });
  }

  return readCanonicalFactoryControlState({
    factoryId,
    rootDir,
    connectionString,
    runsDir,
    context,
  });
}

export function readCanonicalFactoryControlStateSync(args = {}) {
  return runInline("readCanonicalFactoryControlState", args);
}

export function applyCanonicalFactoryControlActionSync(args = {}) {
  return runInline("applyCanonicalFactoryControlAction", args);
}

export function persistCanonicalFactoryLifecycleSnapshotSync(args = {}) {
  return runInline("persistCanonicalFactoryLifecycleSnapshot", args);
}

export function writeCanonicalFactoryControlStateSync(args = {}) {
  return runInline("writeCanonicalFactoryControlState", args);
}
