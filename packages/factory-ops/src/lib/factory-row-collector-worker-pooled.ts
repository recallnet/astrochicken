/**
 * Pooled worker thread for factory row collection.
 *
 * Unlike the one-shot worker, this stays alive and processes messages
 * from the parent thread via postMessage. Each message contains the
 * same workerData shape as the one-shot worker.
 */

import { parentPort } from "node:worker_threads";

import { collectFactoryRow, createDefaultFleetRowDeps } from "./factory-fleet-projection-support.ts";

function trim(value = "") {
  return String(value || "").trim();
}

const defaultDeps = createDefaultFleetRowDeps();

parentPort.on("message", (msg) => {
  const {
    registryEntry,
    baseContext,
    lookbackHours,
    now,
    rootDir,
    releaseTargetingLookupEntries,
  } = msg;

  const releaseTargetingLookup = new Map(releaseTargetingLookupEntries || []);

  try {
    const row = collectFactoryRow({
      registryEntry,
      baseContext,
      lookbackHours,
      now,
      rootDir,
      releaseTargetingLookup,
      ...defaultDeps,
    });
    const rowWarnings = (row.warnings || []).map((w) => `${row.factory_id}:${w}`);
    parentPort.postMessage({ ok: true, row, warnings: rowWarnings });
  } catch (error) {
    const factoryId = trim(registryEntry?.factory_id) || "unknown";
    const message = String(error?.message || error);
    parentPort.postMessage({
      ok: false,
      factoryId,
      message,
      entry: registryEntry,
      baseContext,
    });
  }
});
