import { resolveCanonicalEventStoreUrl } from "./canonical-event-store-url.ts";
import { projectionIsCurrent, readLatestCanonicalEventCursor } from "./canonical-projection-freshness.ts";
import { normalizeFactoryContext } from "./factory-context-resolver.ts";
import {
  projectFactoryFleetToPostgres,
  readFactoryFleetProjection,
} from "./factory-fleet-postgres-projection.ts";

function trim(value = "") {
  return String(value ?? "").trim();
}

export async function factoryFleetStatus({
  context = {},
  lookbackHours = 24,
  json = false,
  registryPath = "factory-registry.json",
  now = Date.now(),
  projectionScope = "global",
  resolveCanonicalEventStoreUrlFn = resolveCanonicalEventStoreUrl,
  projectFactoryFleetToPostgresFn = projectFactoryFleetToPostgres,
  readFactoryFleetProjectionFn = readFactoryFleetProjection,
  readLatestCanonicalEventCursorFn = readLatestCanonicalEventCursor,
} = {}) {
  void json;

  const resolvedContext = normalizeFactoryContext(context);
  const runsDir = trim(resolvedContext?.runs_dir) || ".hatch/runs";
  const connectionString = resolveCanonicalEventStoreUrlFn({
    runsDir,
    context: resolvedContext,
    surface: "canonical fleet projection",
  });

  const persisted = await readFactoryFleetProjectionFn({
    connectionString,
    projectionScope,
  });
  const latestCursor = await readLatestCanonicalEventCursorFn({ connectionString });
  // @context:decision !critical Fleet reads must stay on the canonical PG path.
  // Reproject only when the stored cursor lags the event store; otherwise the
  // TUI should serve the persisted projection instead of rebuilding every row.
  if (projectionIsCurrent({ projection: persisted, latestCursor })) {
    return persisted?.projection || {};
  }
  const projected = await projectFactoryFleetToPostgresFn({
    connectionString,
    context: resolvedContext,
    lookbackHours,
    registryPath,
    now,
    projectionScope,
  });
  const refreshed = await readFactoryFleetProjectionFn({
    connectionString,
    projectionScope,
  });
  return refreshed?.projection || projected?.projection || {};
}
