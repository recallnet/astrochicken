import { resolveCanonicalEventStoreUrl } from "./canonical-event-store-url.ts";
import { trim } from "./cli-helpers.ts";
import { runInlineProjectionSync } from "./inline-projection-runner.ts";
import { createResilientPool, buildPostgresPoolOptions } from "./postgres-pool-options.ts";

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

const CANONICAL_EVENT_SCHEMA_LOCK_KEY = 641211;

async function ensureSchemas({ pool }) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock($1)", [CANONICAL_EVENT_SCHEMA_LOCK_KEY]);
    await client.query(FACTORY_EVENTS_SCHEMA_SQL);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function resolveConnectionString({
  connectionString = "",
  runsDir = ".hatch/runs",
  context = {},
  repoRoot = "",
  surface = "canonical event log",
} = {}) {
  const explicit = trim(connectionString);
  if (explicit) return explicit;
  return resolveCanonicalEventStoreUrl({
    runsDir,
    context,
    repoRoot,
    surface,
  });
}

export async function appendCanonicalEvents({
  connectionString = "",
  events = [],
  runsDir = ".hatch/runs",
  context = {},
  repoRoot = "",
  surface = "canonical event log",
} = {}) {
  const emitted = Array.isArray(events) ? events.filter(Boolean) : [];
  if (emitted.length === 0) return 0;
  const resolvedConnectionString = resolveConnectionString({
    connectionString,
    runsDir,
    context,
    repoRoot,
    surface,
  });

  const pool = await createResilientPool(buildPostgresPoolOptions({ connectionString: resolvedConnectionString }));
  try {
    await ensureSchemas({ pool });
    const client = await pool.connect();
    try {
      await client.query("begin");
      const next = await client.query("select nextval('canonical_event_commit_seq')");
      const commitCursor = Number(next.rows[0]?.nextval || 0);
      for (const [index, event] of emitted.entries()) {
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
  } finally {
    await pool.end();
  }
}

function createInlineRunner(functionName, args) {
  const encodedArgs = JSON.stringify(args ?? {});
  return `
    import { ${functionName} } from ${JSON.stringify(import.meta.url)};
    try {
      const out = await ${functionName}(${encodedArgs});
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
  return parsed?.out ?? 0;
}

export function appendCanonicalEventsSync(args = {}) {
  return runInline("appendCanonicalEvents", args);
}
