
import { resolveFactoryContext } from "./factory-context-resolver.ts";
import {
  buildFactoryFleetProjection,
  readFactoryRegistry,
} from "./factory-fleet-projection-support.ts";
import {
  projectFactoryStatusToPostgres,
  readFactoryStatusProjection,
} from "./factory-status-postgres-projection.ts";
import {
  projectFactoryTickToPostgres,
  readFactoryTickProjection,
} from "./factory-tick-postgres-projection.ts";
import { buildPostgresPoolOptions, createResilientPool } from "./postgres-pool-options.ts";

const FLEET_PROJECTION_SQL = `
create table if not exists factory_fleet_projection (
  projection_scope text primary key,
  after_commit_cursor bigint not null,
  projected_at timestamptz not null default now(),
  projection jsonb not null
);
`;
const FLEET_PROJECTION_SCHEMA_LOCK_KEY = 641208;
const DEFAULT_PROJECTION_SCOPE = "global";

function trim(value = "") {
  return String(value ?? "").trim();
}

export async function ensureFactoryFleetProjectionSchema({ connectionString = "", pool = null } = {}) {
  const ownedPool = pool || await createResilientPool(buildPostgresPoolOptions({ connectionString }));
  try {
    const client = await ownedPool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock($1)", [FLEET_PROJECTION_SCHEMA_LOCK_KEY]);
      await client.query(FLEET_PROJECTION_SQL);
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

export async function projectFactoryFleetToPostgres({
  connectionString,
  context = {},
  lookbackHours = 24,
  registryPath = "factory-registry.json",
  now = Date.now(),
  staleMinutes = 20,
  projectionScope = DEFAULT_PROJECTION_SCOPE,
  readFactoryRegistryFn = readFactoryRegistry,
  resolveFactoryContextFn = resolveFactoryContext,
  factoryActiveSummaryFn,
  hostHealthFn,
  hostVersionFn,
  collectFactoryOutcomesFn,
  factoryReleaseTargetingStatusFn,
  collectFactoryRowsFn,
  projectFactoryStatusToPostgresFn = projectFactoryStatusToPostgres,
  readFactoryStatusProjectionFn = readFactoryStatusProjection,
  projectFactoryTickToPostgresFn = projectFactoryTickToPostgres,
  readFactoryTickProjectionFn = readFactoryTickProjection,
} = {}) {
  const registry = readFactoryRegistryFn({ context, registryPath, cwd: process.cwd() });
  const entries = registry?.ok && Array.isArray(registry.factories) ? registry.factories : [];
  const statusByFactory = new Map();
  const tickByFactory = new Map();
  let afterCommitCursor = 0;

  for (const entry of entries) {
    const factoryId = trim(entry.factory_id);
    if (!factoryId) continue;

    let factoryContext;
    try {
      factoryContext = resolveFactoryContextFn({
        cwd: process.cwd(),
        factoryRoot: "",
        factoryId,
        targetRepo: trim(entry.target_repo),
        controlPlaneRepo: trim(context?.control_plane_repo || entry.control_plane_repo),
      });
    } catch {
      continue;
    }

    const runsDir = trim(factoryContext?.runs_dir) || ".hatch/runs";
    const statusResult = await projectFactoryStatusToPostgresFn({
      connectionString,
      factoryId,
      runsDir,
      context: factoryContext,
      staleMinutes,
      now,
    });
    const tickResult = await projectFactoryTickToPostgresFn({
      connectionString,
      factoryId,
      runsDir,
      context: factoryContext,
      now,
    });
    const statusProjection = await readFactoryStatusProjectionFn({ connectionString, factoryId });
    const tickProjection = await readFactoryTickProjectionFn({ connectionString, factoryId });
    statusByFactory.set(factoryId, statusProjection?.projection || statusResult?.projection || {});
    tickByFactory.set(factoryId, tickProjection?.projection || tickResult?.projection || { context: {}, ticks: [] });
    afterCommitCursor = Math.max(
      afterCommitCursor,
      Number(statusProjection?.after_commit_cursor || statusResult?.after_commit_cursor || 0),
      Number(tickProjection?.after_commit_cursor || tickResult?.after_commit_cursor || 0),
    );
  }

  const projection = await buildFactoryFleetProjection({
    context,
    lookbackHours,
    json: true,
    registryPath,
    now,
    readFactoryRegistryFn,
    resolveFactoryContextFn,
    factoryStatusFn: ({ context: rowContext = {} }) => statusByFactory.get(trim(rowContext.factory_id)) || {},
    factoryActiveSummaryFn,
    tickStatusFn: ({ context: rowContext = {} }) => tickByFactory.get(trim(rowContext.factory_id)) || { context: {}, ticks: [] },
    hostHealthFn,
    hostVersionFn,
    collectFactoryOutcomesFn,
    factoryReleaseTargetingStatusFn,
    collectFactoryRowsFn,
  });

  const pool = await createResilientPool(buildPostgresPoolOptions({ connectionString }));
  try {
    await ensureFactoryFleetProjectionSchema({ pool });
    await pool.query(
      `insert into factory_fleet_projection (projection_scope, after_commit_cursor, projection)
       values ($1, $2, $3::jsonb)
       on conflict (projection_scope)
       do update set
         after_commit_cursor = excluded.after_commit_cursor,
         projected_at = now(),
         projection = excluded.projection`,
      [trim(projectionScope) || DEFAULT_PROJECTION_SCOPE, afterCommitCursor, JSON.stringify(projection)],
    );
  } finally {
    await pool.end();
  }

  return {
    projection_scope: trim(projectionScope) || DEFAULT_PROJECTION_SCOPE,
    after_commit_cursor: afterCommitCursor,
    projection,
  };
}

export async function readFactoryFleetProjection({
  connectionString,
  projectionScope = DEFAULT_PROJECTION_SCOPE,
} = {}) {
  const pool = await createResilientPool(buildPostgresPoolOptions({ connectionString }));
  try {
    const result = await pool.query(
      `select projection_scope, after_commit_cursor, projected_at, projection
         from factory_fleet_projection
        where projection_scope = $1`,
      [trim(projectionScope) || DEFAULT_PROJECTION_SCOPE],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      projection_scope: String(row.projection_scope),
      after_commit_cursor: Number(row.after_commit_cursor || 0),
      projected_at: new Date(String(row.projected_at)).toISOString(),
      projection: row.projection && typeof row.projection === "object" ? row.projection : {},
    };
  } finally {
    await pool.end();
  }
}
