import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWorkerPool } from "../../src/lib/factory-worker-pool.ts";

function createFakeWorker(respondWith) {
  const listeners = new Map();
  return {
    on(event, fn) { listeners.set(event, fn); },
    removeListener(event, fn) { if (listeners.get(event) === fn) listeners.delete(event); },
    postMessage(data) {
      const handler = listeners.get("message");
      if (handler) setTimeout(() => handler(respondWith(data)), 0);
    },
    terminate() {},
    _listeners: listeners,
  };
}

describe("factory-worker-pool", () => {
  describe("dispatch", () => {
    it("returns [] for empty entries", async () => {
      const pool = createWorkerPool({ workerFactory: () => createFakeWorker(() => ({})) });
      const result = await pool.dispatch({ entries: [] });
      assert.deepStrictEqual(result, []);
      pool.shutdown();
    });

    it("returns [{ row, warnings }] for a single ok response", async () => {
      const row = { factory_id: "f1", status: "ok" };
      const pool = createWorkerPool({
        workerFactory: () => createFakeWorker(() => ({ ok: true, row, warnings: [] })),
      });
      const result = await pool.dispatch({ entries: [{ factory_id: "f1" }] });
      assert.equal(result.length, 1);
      assert.deepStrictEqual(result[0].row, row);
      assert.deepStrictEqual(result[0].warnings, []);
      pool.shutdown();
    });

    it("handles multiple entries with different factory_ids", async () => {
      let callCount = 0;
      const pool = createWorkerPool({
        workerFactory: () => {
          callCount++;
          return createFakeWorker((data) => ({
            ok: true,
            row: { factory_id: data.registryEntry.factory_id },
            warnings: [],
          }));
        },
      });
      const result = await pool.dispatch({
        entries: [{ factory_id: "a" }, { factory_id: "b" }],
      });
      assert.equal(result.length, 2);
      assert.equal(callCount, 2);
      pool.shutdown();
    });

    it("returns fallback row when worker responds ok:false", async () => {
      const pool = createWorkerPool({
        workerFactory: () => createFakeWorker(() => ({ ok: false, message: "boom" })),
      });
      const result = await pool.dispatch({ entries: [{ factory_id: "f1" }] });
      assert.equal(result.length, 1);
      assert.equal(result[0].row._fallback, true);
      assert.equal(result[0].row.factory_id, "f1");
      assert.equal(result[0].row.error, "boom");
      assert.ok(result[0].warnings.length > 0);
      assert.ok(result[0].warnings[0].includes("f1"));
      pool.shutdown();
    });

    it("returns fallback row when worker emits error event", async () => {
      const pool = createWorkerPool({
        workerFactory: () => {
          const listeners = new Map();
          return {
            on(event, fn) { listeners.set(event, fn); },
            removeListener(event, fn) { if (listeners.get(event) === fn) listeners.delete(event); },
            postMessage() {
              const handler = listeners.get("error");
              if (handler) setTimeout(() => handler(new Error("worker crash")), 0);
            },
            terminate() {},
          };
        },
      });
      const result = await pool.dispatch({ entries: [{ factory_id: "f1" }] });
      assert.equal(result.length, 1);
      assert.equal(result[0].row._fallback, true);
      assert.equal(result[0].row.factory_id, "f1");
      assert.ok(result[0].row.error.includes("worker crash"));
      assert.ok(result[0].warnings[0].includes("f1"));
      // Worker should be removed from pool after error
      assert.equal(pool._workers.size, 0);
      pool.shutdown();
    });
  });

  describe("worker reuse", () => {
    it("reuses the same worker for the same factory_id", async () => {
      let callCount = 0;
      const pool = createWorkerPool({
        workerFactory: () => {
          callCount++;
          return createFakeWorker(() => ({ ok: true, row: { factory_id: "f1" }, warnings: [] }));
        },
      });
      await pool.dispatch({ entries: [{ factory_id: "f1" }] });
      await pool.dispatch({ entries: [{ factory_id: "f1" }] });
      assert.equal(callCount, 1);
      pool.shutdown();
    });

    it("creates separate workers for different factory_ids", async () => {
      let callCount = 0;
      const pool = createWorkerPool({
        workerFactory: () => {
          callCount++;
          return createFakeWorker(() => ({ ok: true, row: {}, warnings: [] }));
        },
      });
      await pool.dispatch({ entries: [{ factory_id: "a" }, { factory_id: "b" }] });
      assert.equal(callCount, 2);
      pool.shutdown();
    });
  });

  describe("worker error recovery", () => {
    it("creates a fresh worker after previous worker errored", async () => {
      let callCount = 0;
      let shouldError = true;
      const pool = createWorkerPool({
        workerFactory: () => {
          callCount++;
          if (shouldError) {
            shouldError = false;
            const listeners = new Map();
            return {
              on(event, fn) { listeners.set(event, fn); },
              removeListener(event, fn) { if (listeners.get(event) === fn) listeners.delete(event); },
              postMessage() {
                const handler = listeners.get("error");
                if (handler) setTimeout(() => handler(new Error("crash")), 0);
              },
              terminate() {},
            };
          }
          return createFakeWorker(() => ({ ok: true, row: { factory_id: "f1" }, warnings: [] }));
        },
      });

      // First dispatch errors
      await pool.dispatch({ entries: [{ factory_id: "f1" }] });
      assert.equal(callCount, 1);

      // Second dispatch should create a fresh worker
      const result = await pool.dispatch({ entries: [{ factory_id: "f1" }] });
      assert.equal(callCount, 2);
      assert.equal(result[0].row.factory_id, "f1");
      assert.equal(result[0].row._fallback, undefined);
      pool.shutdown();
    });
  });

  describe("shutdown", () => {
    it("terminates all workers and clears the map", async () => {
      const terminated = [];
      const pool = createWorkerPool({
        workerFactory: () => {
          const w = createFakeWorker(() => ({ ok: true, row: {}, warnings: [] }));
          w.terminate = () => terminated.push(true);
          return w;
        },
      });
      await pool.dispatch({ entries: [{ factory_id: "a" }, { factory_id: "b" }] });
      assert.equal(pool._workers.size, 2);
      pool.shutdown();
      assert.equal(terminated.length, 2);
      assert.equal(pool._workers.size, 0);
    });
  });

  describe("fallback row shape", () => {
    it("has factory_id, error, and _fallback:true", async () => {
      const pool = createWorkerPool({
        workerFactory: () => createFakeWorker(() => ({ ok: false, message: "fail" })),
      });
      const result = await pool.dispatch({ entries: [{ factory_id: "x" }] });
      const row = result[0].row;
      assert.equal(row.factory_id, "x");
      assert.equal(row.error, "fail");
      assert.equal(row._fallback, true);
      assert.equal(Object.keys(row).length, 3);
      pool.shutdown();
    });
  });
});
