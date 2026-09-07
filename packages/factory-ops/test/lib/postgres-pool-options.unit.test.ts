import test from "node:test";
import assert from "node:assert/strict";



import {
  buildPostgresPoolOptions,
  createResilientPool,
  DEFAULT_POSTGRES_CONNECT_TIMEOUT_MS,
  DEFAULT_POSTGRES_QUERY_TIMEOUT_MS,
  DEFAULT_POSTGRES_IDLE_IN_TX_TIMEOUT_MS,
} from "../../src/lib/postgres-pool-options.ts";

test("buildPostgresPoolOptions includes connection timeout", () => {
  const opts = buildPostgresPoolOptions({ connectionString: "postgresql://localhost/test" });
  assert.equal(opts.connectionTimeoutMillis, DEFAULT_POSTGRES_CONNECT_TIMEOUT_MS);
});

test("buildPostgresPoolOptions includes statement_timeout", () => {
  const opts = buildPostgresPoolOptions({ connectionString: "postgresql://localhost/test" });
  assert.equal(opts.statement_timeout, DEFAULT_POSTGRES_QUERY_TIMEOUT_MS);
});

test("buildPostgresPoolOptions includes idle_in_transaction_session_timeout", () => {
  const opts = buildPostgresPoolOptions({ connectionString: "postgresql://localhost/test" });
  assert.equal(opts.idle_in_transaction_session_timeout, DEFAULT_POSTGRES_IDLE_IN_TX_TIMEOUT_MS);
});

test("buildPostgresPoolOptions allows overrides", () => {
  const opts = buildPostgresPoolOptions({
    connectionString: "postgresql://localhost/test",
    overrides: { statement_timeout: 60000 },
  });
  assert.equal(opts.statement_timeout, 60000);
});

test("createResilientPool returns a pool with error handler attached", async () => {
  const pool = await createResilientPool({
    connectionString: "postgresql://localhost:1/nonexistent",
    connectionTimeoutMillis: 100,
  });
  // Pool should have at least one error listener (our no-op handler)
  assert.ok(pool.listenerCount("error") >= 1,
    "pool must have an error handler to prevent unhandled error crashes");
  assert.ok(pool.listenerCount("connect") >= 1,
    "pool must attach client error listeners when connections are created");
  pool.end().catch(() => {});
});

test("createResilientPool does not crash on emitted error event", async () => {
  const pool = await createResilientPool({
    connectionString: "postgresql://localhost:1/nonexistent",
    connectionTimeoutMillis: 100,
  });
  // Emitting an error should NOT throw (the handler swallows it)
  assert.doesNotThrow(() => {
    pool.emit("error", new Error("connection terminated unexpectedly"));
  });
  pool.end().catch(() => {});
});

test("createResilientPool attaches a no-op error handler to connected clients", async () => {
  const pool = await createResilientPool({
    connectionString: "postgresql://localhost:1/nonexistent",
    connectionTimeoutMillis: 100,
  });
  const fakeClient = new (await import("node:events")).EventEmitter();
  assert.equal(fakeClient.listenerCount("error"), 0);
  pool.emit("connect", fakeClient);
  assert.ok(fakeClient.listenerCount("error") >= 1,
    "connected clients must gain an error handler to avoid unhandled idle timeout crashes");
  assert.doesNotThrow(() => {
    fakeClient.emit("error", new Error("terminating connection due to idle-in-transaction timeout"));
  });
  pool.end().catch(() => {});
});
