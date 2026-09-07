/**
 * Main-thread API for dispatching function calls to a persistent worker
 * thread.  Keeps the Ink event loop free while heavy synchronous I/O runs
 * in the background.
 *
 * Usage:
 *   import { callOffThread, terminateDispatcher } from "./offthread-dispatcher.ts";
 *   const snapshot = await callOffThread("factoryFleetStatus", { context, lookbackHours, registryPath });
 */

import { Worker } from "node:worker_threads";

const workers = new Map();
let nextId = 0;
const pendingByLane = new Map();

function normalizeLane(options = {}) {
  const lane = String(options?.lane || "default").trim();
  return lane || "default";
}

function lanePending(lane) {
  if (!pendingByLane.has(lane)) pendingByLane.set(lane, new Map());
  return pendingByLane.get(lane);
}

function updateRef(lane) {
  const worker = workers.get(lane);
  if (!worker) return;
  if (lanePending(lane).size > 0) worker.ref();
  else worker.unref();
}

function resetLane(lane, error = null) {
  const pending = lanePending(lane);
  for (const entry of pending.values()) {
    if (error) entry.reject(error);
    else entry.resolve(null);
  }
  pending.clear();
  workers.delete(lane);
}

function ensureWorker(lane) {
  const existing = workers.get(lane);
  if (existing) return existing;
  const worker = new Worker(new URL("./offthread-dispatcher-worker.ts", import.meta.url));
  worker.on("message", (msg) => {
    const pending = lanePending(lane);
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    updateRef(lane);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(msg.error));
  });
  worker.on("error", (err) => {
    resetLane(lane, err);
  });
  worker.on("exit", () => {
    workers.delete(lane);
  });
  worker.unref();
  workers.set(lane, worker);
  return worker;
}

export function callOffThread(fn, args, options = {}) {
  return new Promise((resolve, reject) => {
    const lane = normalizeLane(options);
    const worker = ensureWorker(lane);
    const id = nextId++;
    lanePending(lane).set(id, { resolve, reject });
    updateRef(lane);
    worker.postMessage({ id, fn, args });
  });
}

export async function terminateDispatcher() {
  const terminations = [];
  for (const [lane, worker] of workers.entries()) {
    resetLane(lane);
    terminations.push(worker.terminate().catch(() => {}));
  }
  workers.clear();
  await Promise.all(terminations);
}
