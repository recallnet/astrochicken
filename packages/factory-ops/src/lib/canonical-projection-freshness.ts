import { buildPostgresPoolOptions, createResilientPool } from "./postgres-pool-options.ts";

function asCursor(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function projectionIsCurrent({ projection = null, latestCursor = 0 } = {}) {
  if (!projection || typeof projection !== "object") return false;
  return asCursor(projection?.after_commit_cursor) >= asCursor(latestCursor);
}

export async function readLatestCanonicalEventCursor({
  connectionString,
  factoryId = "",
  pool = null,
} = {}) {
  const normalizedFactoryId = String(factoryId || "").trim();
  const ownedPool = pool || await createResilientPool(buildPostgresPoolOptions({ connectionString }));
  try {
    const params = [];
    let whereClause = "";
    if (normalizedFactoryId) {
      params.push(normalizedFactoryId);
      whereClause = "where factory_id = $1";
    }
    const result = await ownedPool.query(
      `select coalesce(max(commit_cursor), 0)::bigint as latest_cursor
         from factory_events
         ${whereClause}`,
      params,
    );
    return asCursor(result.rows?.[0]?.latest_cursor);
  } finally {
    if (!pool) await ownedPool.end();
  }
}
