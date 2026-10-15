/**
 * Persistent worker thread for running blocking I/O operations off the main
 * thread.  The fleet TUI's auto-refresh calls factoryFleetStatus and
 * buildFactoryDashboard which perform heavy synchronous I/O (readFileSync,
 * spawnSync, etc.).  Running them here keeps the Ink event loop responsive.
 */

import { parentPort } from "node:worker_threads";

const handlers = {};

// Module-level singletons initialised lazily inside resolveHandler
let _workerPool = null;
let _cachedOutcomes = null;

async function resolveHandler(name) {
  if (handlers[name]) return handlers[name];
  switch (name) {
    case "factoryFleetStatus": {
      const [fleetMod, poolMod, outcomesMod] = await Promise.all([
        import("../commands/factory-fleet-status.ts"),
        import("../lib/factory-worker-pool.ts"),
        import("../commands/factory-outcomes.ts"),
      ]);
      if (!_workerPool) _workerPool = poolMod.createWorkerPool();
      if (!_cachedOutcomes) _cachedOutcomes = outcomesMod.createCachedCollectFactoryOutcomes({ ttlMs: 60_000 });
      handlers[name] = (args) => fleetMod.factoryFleetStatus({
        ...args,
        collectFactoryRowsFn: _workerPool.dispatch.bind(_workerPool),
        collectFactoryOutcomesFn: _cachedOutcomes,
      });
      break;
    }
    case "buildFactoryDashboard": {
      const [dashMod, goalTitlesMod] = await Promise.all([
        import("../commands/factory-dashboard.ts"),
        import("../lib/fetch-goal-titles-graphql-only.ts"),
      ]);
      // Use GraphQL-only goal titles — no serial REST fallback that stalls refresh
      handlers[name] = (args) => dashMod.buildFactoryDashboard({
        ...args,
        fetchGoalTitlesFn: goalTitlesMod.fetchGoalTitlesGraphQLOnly,
      });
      break;
    }
    case "ping": {
      handlers[name] = async (args) => ({ pong: true, ...args });
      break;
    }
    case "sleep": {
      handlers[name] = async (args) => {
        const ms = Math.max(0, Number(args?.ms) || 0);
        await new Promise((resolve) => setTimeout(resolve, ms));
        return { value: args?.value ?? null, ms };
      };
      break;
    }
    default:
      return null;
  }
  return handlers[name];
}

parentPort.on("message", async ({ id, fn, args }) => {
  try {
    const handler = await resolveHandler(fn);
    if (!handler) throw new Error(`offthread-dispatcher: unknown handler "${fn}"`);
    const result = await handler(args);
    parentPort.postMessage({ id, ok: true, result });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: String(error?.message || error) });
  }
});
