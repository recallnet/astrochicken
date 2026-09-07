/**
 * Worker thread that collects a single factory row.
 *
 * Receives `workerData` with serializable arguments, imports the real
 * dependency implementations, runs `collectFactoryRow`, and posts the
 * result back to the parent thread.
 *
 * This allows `factoryFleetStatus` to process multiple factories in
 * parallel — each worker runs blocking sync I/O on its own thread.
 */

import { parentPort, workerData } from "node:worker_threads";

import { collectFactoryRow, createDefaultFleetRowDeps } from "./factory-fleet-projection-support.ts";

const {
  registryEntry,
  baseContext,
  lookbackHours,
  now,
  rootDir,
  releaseTargetingLookupEntries,
} = workerData;

const releaseTargetingLookup = new Map(releaseTargetingLookupEntries || []);
const defaultDeps = createDefaultFleetRowDeps();

function trim(value = "") {
  return String(value || "").trim();
}

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
