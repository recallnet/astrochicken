
import {
  buildProjectedStateFromRun,
  projectRunsFromCanonicalRows,
  readProjectedRunState,
} from "./canonical-run-projection.ts";
import { normalizeFactoryContext } from "./factory-context-resolver.ts";
import {
  buildTickProjectionFromStates,
} from "./factory-tick-run-projection.ts";
import { ensureProjectionDimensions } from "./insight-contract.ts";
import { buildPostgresPoolOptions, createResilientPool } from "./postgres-pool-options.ts";

const TICK_PROJECTION_SQL = `
create table if not exists factory_tick_projection (
  factory_id text primary key,
  after_commit_cursor bigint not null,
  projected_at timestamptz not null default now(),
  projection jsonb not null
);
`;
const TICK_PROJECTION_SCHEMA_LOCK_KEY = 641207;

export async function ensureFactoryTickProjectionSchema({ connectionString = "", pool = null } = {}) {
  const ownedPool = pool || await createResilientPool(buildPostgresPoolOptions({ connectionString }));
  try {
    const client = await ownedPool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock($1)", [TICK_PROJECTION_SCHEMA_LOCK_KEY]);
      await client.query(TICK_PROJECTION_SQL);
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

export async function projectFactoryTickToPostgres({
  connectionString,
  factoryId = "",
  runsDir = ".hatch/runs",
  context = {},
  now = Date.now(),
} = {}) {
  const normalizedFactoryId = String(factoryId || context?.factory_id || "").trim();
  if (!normalizedFactoryId) {
    throw new Error("factoryId is required");
  }

  const pool = await createResilientPool(buildPostgresPoolOptions({ connectionString }));
  try {
    await ensureFactoryTickProjectionSchema({ pool });
    const resolvedContext = normalizeFactoryContext({
      ...context,
      factory_id: normalizedFactoryId,
    }, { runsDirFallback: runsDir });
    const result = await pool.query(
      `select * from factory_events
         where factory_id = $1
         order by commit_cursor asc, batch_offset asc`,
      [normalizedFactoryId],
    );
    const rows = result.rows || [];
    const { runs } = projectRunsFromCanonicalRows(rows, runsDir);
    const allStates = new Map();
    for (const run of runs) {
      const diskState = readProjectedRunState(runsDir, run.id) || null;
      allStates.set(run.id, buildProjectedStateFromRun(run, diskState));
    }
    const projection = ensureProjectionDimensions("factory_tick_status", buildTickProjectionFromStates({
      allStates,
      runsDir,
      context: resolvedContext,
      now,
    }));
    const afterCommitCursor = rows.reduce((max, row) => Math.max(max, Number(row.commit_cursor || 0)), 0);

    await pool.query(
      `insert into factory_tick_projection (factory_id, after_commit_cursor, projection)
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

export async function readFactoryTickProjection({
  connectionString,
  factoryId = "",
} = {}) {
  const normalizedFactoryId = String(factoryId || "").trim();
  if (!normalizedFactoryId) return null;
  const pool = await createResilientPool(buildPostgresPoolOptions({ connectionString }));
  try {
    const result = await pool.query(
      `select factory_id, after_commit_cursor, projected_at, projection
         from factory_tick_projection
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
