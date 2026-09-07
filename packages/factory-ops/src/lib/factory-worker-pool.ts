/**
 * Persistent worker pool for factory row collection.
 *
 * Instead of spawning and terminating a new Worker per factory per refresh,
 * the pool keeps workers alive and reuses them across dispatches. Each
 * factory_id gets a dedicated worker; workers are created on first use
 * and persist until shutdown().
 */

import { Worker } from "node:worker_threads";

function trim(value = "") {
  return String(value ?? "").trim();
}

function buildFallbackRow(entry = {}, baseContext = {}, errorMessage = "") {
  return {
    factory_id: trim(entry.factory_id) || "unknown",
    error: errorMessage,
    _fallback: true,
  };
}

/**
 * Create a worker pool that reuses workers across refresh cycles.
 *
 * @param {{ workerFactory?: () => Worker-like }} opts
 *   workerFactory is injectable for testing; defaults to spawning real Workers.
 */
export function createWorkerPool({
  workerFactory,
  workerUrl,
} = {}) {
  const workers = new Map(); // factory_id → worker

  const defaultWorkerUrl = workerUrl || new URL("./factory-row-collector-worker-pooled.ts", import.meta.url);

  function getOrCreateWorker(factoryId) {
    if (workers.has(factoryId)) return workers.get(factoryId);

    const worker = workerFactory
      ? workerFactory()
      : new Worker(defaultWorkerUrl);

    workers.set(factoryId, worker);
    return worker;
  }

  /**
   * Dispatch work to the pool. Returns a promise that resolves with
   * results for all entries, same shape as collectFactoryRowsParallel.
   */
  function dispatch({
    entries = [],
    baseContext = {},
    lookbackHours = 24,
    now = Date.now(),
    rootDir = process.cwd(),
    releaseTargetingLookupEntries = [],
  } = {}) {
    if (entries.length === 0) return Promise.resolve([]);

    const tasks = entries.map((entry) => new Promise((resolve) => {
      const factoryId = trim(entry.factory_id) || "unknown";
      const worker = getOrCreateWorker(factoryId);

      // Replace listeners for this dispatch cycle
      const onMessage = (msg) => {
        worker.removeListener("message", onMessage);
        worker.removeListener("error", onError);
        if (msg.ok) {
          resolve({ row: msg.row, warnings: msg.warnings || [] });
        } else {
          const message = String(msg.message || "worker_failed");
          resolve({
            row: buildFallbackRow(msg.entry || entry, msg.baseContext || baseContext, message),
            warnings: [`${factoryId}:row_collection_failed:${message}`],
          });
        }
      };

      const onError = (err) => {
        worker.removeListener("message", onMessage);
        worker.removeListener("error", onError);
        // Worker errored — remove from pool so a fresh one is created next time
        workers.delete(factoryId);
        const message = String(err?.message || err);
        resolve({
          row: buildFallbackRow(entry, baseContext, message),
          warnings: [`${factoryId}:row_collection_failed:${message}`],
        });
      };

      worker.on("message", onMessage);
      worker.on("error", onError);

      worker.postMessage({
        registryEntry: entry,
        baseContext,
        lookbackHours,
        now,
        rootDir,
        releaseTargetingLookupEntries,
      });
    }));

    return Promise.all(tasks);
  }

  function shutdown() {
    for (const [, worker] of workers) {
      worker.terminate();
    }
    workers.clear();
  }

  return { dispatch, shutdown, _workers: workers };
}
