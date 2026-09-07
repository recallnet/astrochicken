import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  createWorkerPool,
} from "../../src/lib/factory-worker-pool.ts";

function createFakeWorker({ onPostMessage, onTerminate } = {}) {
  const emitter = new EventEmitter();
  emitter.postMessage = (data) => {
    if (onPostMessage) onPostMessage(data, emitter);
  };
  emitter.terminate = () => {
    if (onTerminate) onTerminate();
  };
  return emitter;
}

test("createWorkerPool reuses existing workers across calls", async () => {
  let workersCreated = 0;

  const workerFactory = () => {
    workersCreated++;
    return createFakeWorker({
      onPostMessage: (data, w) => {
        setTimeout(() => w.emit("message", { ok: true, row: { factory_id: data.registryEntry.factory_id }, warnings: [] }), 1);
      },
    });
  };

  const pool = createWorkerPool({ workerFactory });

  const entries = [{ factory_id: "alpha" }, { factory_id: "beta" }];
  const shared = { entries, baseContext: {}, lookbackHours: 24, now: Date.now(), rootDir: "/tmp", releaseTargetingLookupEntries: [] };

  await pool.dispatch(shared);
  assert.equal(workersCreated, 2, "creates workers on first dispatch");

  await pool.dispatch(shared);
  assert.equal(workersCreated, 2, "reuses workers on second dispatch");

  pool.shutdown();
});

test("createWorkerPool creates new workers when factory set changes", async () => {
  let workersCreated = 0;

  const workerFactory = () => {
    workersCreated++;
    return createFakeWorker({
      onPostMessage: (data, w) => {
        setTimeout(() => w.emit("message", { ok: true, row: { factory_id: data.registryEntry.factory_id }, warnings: [] }), 1);
      },
    });
  };

  const pool = createWorkerPool({ workerFactory });
  const shared = { baseContext: {}, lookbackHours: 24, now: Date.now(), rootDir: "/tmp", releaseTargetingLookupEntries: [] };

  await pool.dispatch({ ...shared, entries: [{ factory_id: "alpha" }] });
  assert.equal(workersCreated, 1);

  await pool.dispatch({ ...shared, entries: [{ factory_id: "alpha" }, { factory_id: "gamma" }] });
  assert.equal(workersCreated, 2, "only creates worker for new factory");

  pool.shutdown();
});

test("createWorkerPool handles worker errors gracefully", async () => {
  const workerFactory = () => {
    return createFakeWorker({
      onPostMessage: (_data, w) => {
        setTimeout(() => w.emit("error", new Error("worker crashed")), 1);
      },
    });
  };

  const pool = createWorkerPool({ workerFactory });

  const results = await pool.dispatch({
    entries: [{ factory_id: "alpha" }],
    baseContext: {}, lookbackHours: 24, now: Date.now(), rootDir: "/tmp", releaseTargetingLookupEntries: [],
  });

  assert.equal(results.length, 1);
  assert.ok(results[0].warnings.some((w) => w.includes("row_collection_failed")));

  pool.shutdown();
});

test("createWorkerPool.shutdown terminates all workers", async () => {
  let terminated = 0;

  const workerFactory = () => {
    return createFakeWorker({
      onPostMessage: (data, w) => {
        setTimeout(() => w.emit("message", { ok: true, row: { factory_id: data.registryEntry.factory_id }, warnings: [] }), 1);
      },
      onTerminate: () => { terminated++; },
    });
  };

  const pool = createWorkerPool({ workerFactory });

  await pool.dispatch({
    entries: [{ factory_id: "a" }, { factory_id: "b" }],
    baseContext: {}, lookbackHours: 24, now: Date.now(), rootDir: "/tmp", releaseTargetingLookupEntries: [],
  });

  pool.shutdown();
  assert.equal(terminated, 2, "terminates all pooled workers");
});
