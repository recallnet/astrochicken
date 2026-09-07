import assert from "node:assert/strict";
import test from "node:test";

import {
  createResilientPool,
  DEFAULT_POSTGRES_CONNECT_TIMEOUT_MS,
  DEFAULT_POSTGRES_IDLE_IN_TX_TIMEOUT_MS,
  DEFAULT_POSTGRES_LOCK_TIMEOUT_MS,
  DEFAULT_POSTGRES_QUERY_TIMEOUT_MS,
  buildPostgresPoolOptions,
  resolvePostgresConnectTimeoutMs,
  resolvePostgresIdleInTransactionTimeoutMs,
  resolvePostgresLockTimeoutMs,
  resolvePostgresQueryTimeoutMs,
} from "../../src/lib/postgres-pool-options.ts";

test("buildPostgresPoolOptions applies a finite default connect timeout", () => {
  const out = buildPostgresPoolOptions({ connectionString: "postgres://example" });
  assert.equal(out.connectionTimeoutMillis, DEFAULT_POSTGRES_CONNECT_TIMEOUT_MS);
  assert.equal(out.query_timeout, DEFAULT_POSTGRES_QUERY_TIMEOUT_MS);
  assert.equal(out.statement_timeout, DEFAULT_POSTGRES_QUERY_TIMEOUT_MS);
  assert.equal(out.lock_timeout, DEFAULT_POSTGRES_LOCK_TIMEOUT_MS);
  assert.equal(out.idle_in_transaction_session_timeout, DEFAULT_POSTGRES_IDLE_IN_TX_TIMEOUT_MS);
});

test("buildPostgresPoolOptions honors HATCH_POSTGRES_CONNECT_TIMEOUT_MS overrides", () => {
  const out = buildPostgresPoolOptions({
    connectionString: "postgres://example",
    env: {
      HATCH_POSTGRES_CONNECT_TIMEOUT_MS: "2345",
      HATCH_POSTGRES_QUERY_TIMEOUT_MS: "3456",
      HATCH_POSTGRES_LOCK_TIMEOUT_MS: "4567",
    },
  });
  assert.equal(out.connectionTimeoutMillis, 2345);
  assert.equal(out.query_timeout, 3456);
  assert.equal(out.statement_timeout, 3456);
  assert.equal(out.lock_timeout, 4567);
  assert.equal(out.idle_in_transaction_session_timeout, DEFAULT_POSTGRES_IDLE_IN_TX_TIMEOUT_MS);
});

test("resolvePostgresConnectTimeoutMs falls back on invalid overrides", () => {
  assert.equal(
    resolvePostgresConnectTimeoutMs({ HATCH_POSTGRES_CONNECT_TIMEOUT_MS: "bogus" }),
    DEFAULT_POSTGRES_CONNECT_TIMEOUT_MS,
  );
});

test("resolvePostgres query and lock timeout helpers fall back on invalid overrides", () => {
  assert.equal(
    resolvePostgresQueryTimeoutMs({ HATCH_POSTGRES_QUERY_TIMEOUT_MS: "bogus" }),
    DEFAULT_POSTGRES_QUERY_TIMEOUT_MS,
  );
  assert.equal(
    resolvePostgresLockTimeoutMs({ HATCH_POSTGRES_LOCK_TIMEOUT_MS: "bogus" }),
    DEFAULT_POSTGRES_LOCK_TIMEOUT_MS,
  );
  assert.equal(
    resolvePostgresIdleInTransactionTimeoutMs({ HATCH_POSTGRES_IDLE_IN_TRANSACTION_TIMEOUT_MS: "bogus" }),
    DEFAULT_POSTGRES_IDLE_IN_TX_TIMEOUT_MS,
  );
});

test("createResilientPool attaches a pool error listener and preserves fail-closed timeouts", async () => {
  const pool = await createResilientPool(buildPostgresPoolOptions({
    connectionString: "postgres://example",
    env: {
      HATCH_POSTGRES_CONNECT_TIMEOUT_MS: "1111",
      HATCH_POSTGRES_QUERY_TIMEOUT_MS: "2222",
      HATCH_POSTGRES_LOCK_TIMEOUT_MS: "3333",
      HATCH_POSTGRES_IDLE_IN_TRANSACTION_TIMEOUT_MS: "4444",
    },
  }));
  try {
    assert.equal(pool.options.connectionTimeoutMillis, 1111);
    assert.equal(pool.options.query_timeout, 2222);
    assert.equal(pool.options.statement_timeout, 2222);
    assert.equal(pool.options.lock_timeout, 3333);
    assert.equal(pool.options.idle_in_transaction_session_timeout, 4444);
    assert.ok(pool.listenerCount("error") >= 1);
    assert.ok(pool.listenerCount("connect") >= 1);
  } finally {
    await pool.end().catch(() => {});
  }
});

test("createResilientPool protects idle clients from unhandled fatal timeout events", async () => {
  const pool = await createResilientPool({
    connectionString: "postgres://example",
  });
  try {
    const { EventEmitter } = await import("node:events");
    const fakeClient = new EventEmitter();
    pool.emit("connect", fakeClient);
    assert.ok(fakeClient.listenerCount("error") >= 1);
    assert.doesNotThrow(() => {
      fakeClient.emit("error", Object.assign(new Error("terminating connection due to idle-in-transaction timeout"), {
        code: "25P03",
      }));
    });
  } finally {
    await pool.end().catch(() => {});
  }
});
