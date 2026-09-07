import { resolveCanonicalEventStoreUrl } from "./canonical-event-store-url.ts";
import { normalizeFactoryContext } from "./factory-context-resolver.ts";
import { runInlineProjectionSync } from "./inline-projection-runner.ts";
import { overlayInvocationFactoryContext } from "./projection-context-portability.ts";

function buildInlineProjectionScript({
  connectionString,
  factoryId,
  runsDir,
  now,
  context,
}) {
  return `
    const { readLatestCanonicalEventCursor } = await import(${JSON.stringify(new URL("./canonical-projection-freshness.ts", import.meta.url).href)});
    const { projectFactoryTickToPostgres, readFactoryTickProjection } = await import(${JSON.stringify(new URL("./factory-tick-postgres-projection.ts", import.meta.url).href)});
    const latestCursor = await readLatestCanonicalEventCursor(${JSON.stringify({
      connectionString,
      factoryId,
    })});
    let persisted = null;
    try {
      persisted = await readFactoryTickProjection(${JSON.stringify({
        connectionString,
        factoryId,
      })});
    } catch {}
    // @context:decision !critical Tick detail reads should be cheap PG-backed
    // lookups when the canonical projection is current. Only stale cursors
    // justify replaying events and rebuilding the projection on demand.
    //
    // @context:regression !critical The factory_tick_projection table is keyed by
    // factory_id only. Two CLI invocations from different roots share the same
    // factory_id and event store but resolve different factory_root. Invalidate
    // the cache when the caller's factory_config_path or factory_root differs from
    // what is stored in the projection, so context-portability is preserved.
    const callerFactoryConfigPath = ${JSON.stringify(String(context?.factory_config_path || ""))};
    const callerFactoryRoot = ${JSON.stringify(String(context?.factory_root || ""))};
    const cachedConfigPath = String((persisted && persisted.projection && persisted.projection.context && persisted.projection.context.factory_config_path) || "");
    const cachedFactoryRoot = String((persisted && persisted.projection && persisted.projection.context && persisted.projection.context.factory_root) || "");
    const contextRootMismatch = (callerFactoryConfigPath && cachedConfigPath && callerFactoryConfigPath !== cachedConfigPath)
      || (callerFactoryRoot && cachedFactoryRoot && callerFactoryRoot !== cachedFactoryRoot);
    if (!contextRootMismatch && persisted && Number(persisted.after_commit_cursor || 0) >= Number(latestCursor || 0)) {
      process.stdout.write(JSON.stringify(persisted.projection));
    } else {
      const result = await projectFactoryTickToPostgres(${JSON.stringify({
        connectionString,
        factoryId,
        runsDir,
        context,
        now,
      })});
      const refreshed = await readFactoryTickProjection(${JSON.stringify({
        connectionString,
        factoryId,
      })}).catch(() => null);
      process.stdout.write(JSON.stringify((refreshed && refreshed.projection) || result.projection));
    }
  `;
}

export function factoryTickStatus({
  runsDir = ".hatch/runs",
  context = {},
  now = Date.now(),
  readCanonicalProjectionSyncFn = null,
} = {}) {
  const resolvedContext = normalizeFactoryContext(context, { runsDirFallback: runsDir });
  const effectiveContext = {
    ...resolvedContext,
    canonical_event_store_url: context?.canonical_event_store_url,
  };
  const factoryId = String(resolvedContext?.factory_id || "").trim();
  let connectionString = "";
  connectionString = resolveCanonicalEventStoreUrl({ runsDir, context: effectiveContext, surface: "canonical factory tick status" });

  const stdout = typeof readCanonicalProjectionSyncFn === "function"
    ? readCanonicalProjectionSyncFn({
      connectionString,
      factoryId,
      runsDir,
      now,
      context: effectiveContext,
    })
    : runInlineProjectionSync({
      moduleUrl: import.meta.url,
      script: buildInlineProjectionScript({
        connectionString,
        factoryId,
        runsDir,
        now,
        context: effectiveContext,
      }),
    });
  return overlayInvocationFactoryContext({
    projection: JSON.parse(String(stdout || "{}")),
    context: effectiveContext,
    runsDirFallback: runsDir,
  });
}
