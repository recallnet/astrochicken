
import {
  buildPacketPublishedEvent,
  buildPacketStateUpdatedEvent,
  CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES,
} from "./canonical-domain-events.ts";
import { appendCanonicalEvents } from "./canonical-event-log.ts";
import { resolveCanonicalEventStoreUrl } from "./canonical-event-store-url.ts";
import { trim } from "./cli-helpers.ts";
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

const PACKET_SCHEMA_LOCK_KEY = 641214;
const PACKET_EVENT_FAMILIES = [
  CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.PACKET_PUBLISHED,
  CANONICAL_FACTORY_DOMAIN_EVENT_FAMILIES.PACKET_STATE_UPDATED,
];
const TERMINAL_PACKET_RUN_STATUSES = new Set([
  "completed",
  "failed",
  "suspended",
  "blocked",
  "guarded",
  "guarded_terminal",
  "terminal",
]);

function projectRunStatusesFromRows(rows = []) {
  const statuses = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    const runId = trim(row?.run_id || payload.run_id || "");
    if (!runId) continue;
    if (row.event_family === "hatch.run.started" || row.event_family === "hatch.run.node_entered") {
      statuses.set(runId, "running");
      continue;
    }
    if (row.event_family === "hatch.run.completed") {
      statuses.set(runId, "completed");
      continue;
    }
    if (row.event_family === "hatch.run.failed") {
      statuses.set(runId, "failed");
      continue;
    }
  }
  return statuses;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePacketEntry({
  packet = {},
  packetPath = "",
  storageClass = "",
  family = "",
  durable = false,
} = {}) {
  const normalizedPacket = packet && typeof packet === "object" ? cloneJson(packet) : {};
  const normalizedRunId = trim(normalizedPacket.run_id || "");
  const normalizedPacketPath = trim(packetPath);
  const normalizedFamily = trim(family);
  const normalizedStorageClass = trim(storageClass);
  return {
    packet: normalizedPacket,
    packet_path: normalizedPacketPath,
    packet_ref: {
      packet_id: trim(normalizedPacket.packet_id || ""),
      packet_type: trim(normalizedPacket.packet_type || ""),
      packet_state: trim(normalizedPacket.packet_state || ""),
      run_id: normalizedRunId,
      packet_path: normalizedPacketPath,
    },
    registry_entry: {
      family: normalizedFamily,
      durable: durable === true,
      storage_class: normalizedStorageClass,
    },
    run_id: normalizedRunId,
  };
}

function projectPacketEntries(rows = []) {
  const packets = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!PACKET_EVENT_FAMILIES.includes(String(row?.event_family || "").trim())) continue;
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    const packet = payload.packet && typeof payload.packet === "object" ? payload.packet : {};
    const packetId = trim(packet.packet_id || "");
    if (!packetId) continue;
    packets.set(packetId, normalizePacketEntry({
      packet,
      packetPath: payload.packet_path,
      storageClass: payload.storage_class,
      family: payload.family,
      durable: payload.durable === true,
    }));
  }
  return [...packets.values()];
}

function matchesWindow(entry = {}, { windowMs = 0, nowMs = Date.now() } = {}) {
  if (!(windowMs > 0)) return true;
  const createdAtMs = Date.parse(String(entry?.packet?.created_at || ""));
  if (!Number.isFinite(createdAtMs)) return true;
  return (nowMs - createdAtMs) <= windowMs;
}

function matchesFilters(entry = {}, {
  packetTypes = [],
  families = [],
  durableOnly = false,
  packetState = "",
  factoryId = "",
  runId = "",
} = {}) {
  const normalizedTypes = new Set((Array.isArray(packetTypes) ? packetTypes : []).map((value) => trim(value)).filter(Boolean));
  const normalizedFamilies = new Set((Array.isArray(families) ? families : []).map((value) => trim(value)).filter(Boolean));
  const desiredState = trim(packetState);
  const desiredFactoryId = trim(factoryId);
  const desiredRunId = trim(runId);
  const packet = entry?.packet && typeof entry.packet === "object" ? entry.packet : {};
  const registryEntry = entry?.registry_entry && typeof entry.registry_entry === "object" ? entry.registry_entry : {};

  if (durableOnly && registryEntry.durable !== true) return false;
  if (normalizedTypes.size > 0 && !normalizedTypes.has(trim(packet.packet_type || ""))) return false;
  if (normalizedFamilies.size > 0 && !normalizedFamilies.has(trim(registryEntry.family || ""))) return false;
  if (desiredState && trim(packet.packet_state || "") !== desiredState) return false;
  if (desiredFactoryId && trim(packet.factory_id || "") !== desiredFactoryId) return false;
  if (desiredRunId && trim(packet.run_id || entry?.run_id || "") !== desiredRunId) return false;
  return true;
}

function packetSummary(entry = {}) {
  const packet = entry?.packet && typeof entry.packet === "object" ? entry.packet : {};
  const refs = packet.resource_refs && typeof packet.resource_refs === "object" ? packet.resource_refs : {};
  return {
    packet_id: trim(packet.packet_id || ""),
    packet_type: trim(packet.packet_type || ""),
    packet_state: trim(packet.packet_state || ""),
    packet_path: trim(entry?.packet_path || ""),
    run_id: trim(packet.run_id || entry?.run_id || ""),
    pipeline: trim(packet.pipeline || ""),
    node_id: trim(packet.node_id || ""),
    title: trim(refs.milestone_title || packet.intent || packet.packet_type || ""),
  };
}

export function projectPacketsFromCanonicalRows(rows = [], {
  runsDir = ".hatch/runs",
  packetTypes = [],
  families = [],
  durableOnly = false,
  packetState = "",
  factoryId = "",
  runId = "",
  nowMs = Date.now(),
  windowMs = 0,
  excludeTerminalRuns = false,
} = {}) {
  void runsDir;
  const runStatusById = projectRunStatusesFromRows(rows);
  return projectPacketEntries(rows)
    .filter((entry) => matchesFilters(entry, {
      packetTypes,
      families,
      durableOnly,
      packetState,
      factoryId,
      runId,
    }))
    .filter((entry) => matchesWindow(entry, { windowMs, nowMs }))
    .filter((entry) => {
      // @context:decision !critical Packet files remain durable artifacts, but
      // packet operator surfaces must not treat them as truth once the source
      // run is terminal. Canonical run events own that exclusion now.
      if (!excludeTerminalRuns) return true;
      const entryRunId = trim(entry?.packet?.run_id || entry?.run_id || "");
      if (!entryRunId) return true;
      return !TERMINAL_PACKET_RUN_STATUSES.has(runStatusById.get(entryRunId) || "");
    })
    .sort((left, right) => String(right?.packet?.created_at || "").localeCompare(String(left?.packet?.created_at || "")));
}

export function summarizeOpenProjectedPacketsFromRows({ rows = [], runsDir = ".hatch/runs", nowMs = Date.now() } = {}) {
  return projectPacketsFromCanonicalRows(rows, {
    runsDir,
    durableOnly: true,
    packetState: "open",
    nowMs,
    windowMs: 7 * 24 * 60 * 60 * 1000,
    excludeTerminalRuns: true,
  })
    .slice(0, 10)
    .map((entry) => packetSummary(entry));
}

async function ensureSchemas({ pool }) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock($1)", [PACKET_SCHEMA_LOCK_KEY]);
    await client.query(FACTORY_EVENTS_SCHEMA_SQL);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function appendCanonicalPacketEvents({
  connectionString = "",
  events = [],
} = {}) {
  return appendCanonicalEvents({
    connectionString: trim(connectionString),
    events,
    surface: "canonical packet projection",
  });
}

function resolvePacketConnectionString({
  runsDir = ".hatch/runs",
  context = {},
  factoryId = "",
} = {}) {
  return resolveCanonicalEventStoreUrl({
    runsDir,
    context: {
      ...context,
      factory_id: trim(factoryId) || trim(context?.factory_id),
    },
    surface: "canonical packet projection",
  });
}

function buildPacketQuery({ factoryId = "", runId = "" } = {}) {
  const normalizedFactoryId = trim(factoryId);
  const normalizedRunId = trim(runId);
  if (normalizedFactoryId) {
    return {
      text: `select *
               from factory_events
              where factory_id = $1
              order by commit_cursor asc, batch_offset asc`,
      values: [normalizedFactoryId],
    };
  }
  if (normalizedRunId) {
    return {
      text: `select *
               from factory_events
              where run_id = $1
                 or (event_family like 'hatch.run.%' and run_id = $1)
              order by commit_cursor asc, batch_offset asc`,
      values: [normalizedRunId],
    };
  }
  throw new Error("factory_id_or_run_id_required");
}

export async function listCanonicalPackets({
  runsDir = ".hatch/runs",
  context = {},
  connectionString = "",
  factoryId = "",
  runId = "",
  packetTypes = [],
  families = [],
  durableOnly = false,
  packetState = "",
  nowMs = Date.now(),
  windowMs = 0,
  excludeTerminalRuns = false,
} = {}) {
  const normalizedFactoryId = trim(factoryId || context?.factory_id || "");
  const normalizedRunId = trim(runId);
  const normalizedConnectionString = trim(connectionString) || resolvePacketConnectionString({
    runsDir,
    context,
    factoryId: normalizedFactoryId,
  });
  const pool = await createResilientPool(buildPostgresPoolOptions({ connectionString: normalizedConnectionString }));
  try {
    await ensureSchemas({ pool });
    const query = buildPacketQuery({ factoryId: normalizedFactoryId, runId: normalizedRunId });
    const result = await pool.query(query.text, query.values);
    return projectPacketsFromCanonicalRows(result.rows || [], {
      runsDir,
      packetTypes,
      families,
      durableOnly,
      packetState,
      factoryId: normalizedFactoryId,
      runId: normalizedRunId,
      nowMs,
      windowMs,
      excludeTerminalRuns,
    });
  } finally {
    await pool.end();
  }
}

function buildInlineProjectionScript(args) {
  return `
    const mod = await import(${JSON.stringify(new URL("./canonical-packet-projection.ts", import.meta.url).href)});
    try {
      const out = await mod.listCanonicalPackets(${JSON.stringify(args)});
      process.stdout.write(JSON.stringify({ ok: true, out }));
    } catch (error) {
      process.stdout.write(JSON.stringify({
        ok: false,
        error: {
          code: String(error?.code || ""),
          message: String(error?.message || error || "listCanonicalPackets_failed"),
        },
      }));
    }
  `;
}

export function listCanonicalPacketsSync(args = {}) {
  const stdout = runInlineProjectionSync({
    moduleUrl: import.meta.url,
    script: buildInlineProjectionScript(args),
  });
  const parsed = JSON.parse(String(stdout || "{}"));
  if (parsed?.ok === false) {
    const error = new Error(String(parsed?.error?.message || "listCanonicalPackets_failed"));
    error.code = String(parsed?.error?.code || "");
    throw error;
  }
  return Array.isArray(parsed?.out) ? parsed.out : [];
}

export async function mirrorCanonicalPacketPublished({
  runsDir = ".hatch/runs",
  context = {},
  packet = {},
  packetPath = "",
  storageClass = "",
  family = "",
  durable = false,
} = {}) {
  try {
    const connectionString = resolvePacketConnectionString({
      runsDir,
      context: {
        ...context,
        factory_id: trim(packet?.factory_id || context?.factory_id),
      },
      factoryId: trim(packet?.factory_id),
    });
    return await appendCanonicalPacketEvents({
      connectionString,
      events: [
        buildPacketPublishedEvent({
          factoryId: trim(packet?.factory_id),
          runId: trim(packet?.run_id),
          packet,
          packetPath,
          storageClass,
          family,
          durable,
        }),
      ],
    });
  } catch {
    return 0;
  }
}

export async function mirrorCanonicalPacketStateUpdated({
  runsDir = ".hatch/runs",
  context = {},
  packet = {},
  packetPath = "",
  storageClass = "",
  family = "",
  durable = false,
  statusReason = "",
} = {}) {
  try {
    const connectionString = resolvePacketConnectionString({
      runsDir,
      context: {
        ...context,
        factory_id: trim(packet?.factory_id || context?.factory_id),
      },
      factoryId: trim(packet?.factory_id),
    });
    return await appendCanonicalPacketEvents({
      connectionString,
      events: [
        buildPacketStateUpdatedEvent({
          factoryId: trim(packet?.factory_id),
          runId: trim(packet?.run_id),
          packet,
          packetPath,
          storageClass,
          family,
          durable,
          statusReason,
        }),
      ],
    });
  } catch {
    return 0;
  }
}

function buildInlineMirrorScript(functionName, args) {
  return `
    const mod = await import(${JSON.stringify(new URL("./canonical-packet-projection.ts", import.meta.url).href)});
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

function runInlineMirror(functionName, args) {
  const stdout = runInlineProjectionSync({
    moduleUrl: import.meta.url,
    script: buildInlineMirrorScript(functionName, args),
  });
  const parsed = JSON.parse(String(stdout || "{}"));
  if (parsed?.ok === false) {
    const error = new Error(String(parsed?.error?.message || `${functionName}_failed`));
    error.code = String(parsed?.error?.code || "");
    throw error;
  }
  return parsed?.out ?? 0;
}

export function mirrorCanonicalPacketPublishedSync(args = {}) {
  try {
    return runInlineMirror("mirrorCanonicalPacketPublished", args);
  } catch {
    return 0;
  }
}

export function mirrorCanonicalPacketStateUpdatedSync(args = {}) {
  try {
    return runInlineMirror("mirrorCanonicalPacketStateUpdated", args);
  } catch {
    return 0;
  }
}
