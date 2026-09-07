import { trim } from "./cli-helpers.ts";

export const DEFAULT_POSTGRES_CONNECT_TIMEOUT_MS = 5_000;
export const DEFAULT_POSTGRES_QUERY_TIMEOUT_MS = 30_000;
export const DEFAULT_POSTGRES_LOCK_TIMEOUT_MS = 10_000;
export const DEFAULT_POSTGRES_IDLE_IN_TX_TIMEOUT_MS = 30_000;

export function resolvePostgresConnectTimeoutMs(env = process.env) {
  const raw = trim(env?.HATCH_POSTGRES_CONNECT_TIMEOUT_MS || "");
  if (!raw) return DEFAULT_POSTGRES_CONNECT_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POSTGRES_CONNECT_TIMEOUT_MS;
}

export function resolvePostgresQueryTimeoutMs(env = process.env) {
  const raw = trim(env?.HATCH_POSTGRES_QUERY_TIMEOUT_MS || "");
  if (!raw) return DEFAULT_POSTGRES_QUERY_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POSTGRES_QUERY_TIMEOUT_MS;
}

export function resolvePostgresLockTimeoutMs(env = process.env) {
  const raw = trim(env?.HATCH_POSTGRES_LOCK_TIMEOUT_MS || "");
  if (!raw) return DEFAULT_POSTGRES_LOCK_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POSTGRES_LOCK_TIMEOUT_MS;
}

export function resolvePostgresIdleInTransactionTimeoutMs(env = process.env) {
  const raw = trim(env?.HATCH_POSTGRES_IDLE_IN_TRANSACTION_TIMEOUT_MS || "");
  if (!raw) return DEFAULT_POSTGRES_IDLE_IN_TX_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POSTGRES_IDLE_IN_TX_TIMEOUT_MS;
}

export function buildPostgresPoolOptions({
  connectionString = "",
  env = process.env,
  overrides = {},
} = {}) {
  return {
    connectionString: trim(connectionString),
    connectionTimeoutMillis: resolvePostgresConnectTimeoutMs(env),
    // @context:regression!critical Connection deadlines alone were insufficient:
    // projection readers could still hang forever on advisory-lock waits or slow
    // queries after connect, wedging daemon ticks and control-state mutations.
    query_timeout: resolvePostgresQueryTimeoutMs(env),
    statement_timeout: resolvePostgresQueryTimeoutMs(env),
    lock_timeout: resolvePostgresLockTimeoutMs(env),
    idle_in_transaction_session_timeout: resolvePostgresIdleInTransactionTimeoutMs(env),
    ...overrides,
  };
}

// @context:regression!critical Projection readers use short-lived pools from
// CLI/daemon subprocesses; without a pool-level error listener, dropped idle
// clients can surface as unhandled EventEmitter errors and crash the process.
// @context:decision !critical — pg is imported lazily via await import() because
// this module and its consumers are loaded by inline node -e scripts where ESM
// top-level imports of pg fail (pnpm symlinks not resolvable from file path).
let _Pool = null;
async function getPool() {
  if (!_Pool) {
    const pg = await import("pg");
    _Pool = pg.default?.Pool || pg.Pool;
  }
  return _Pool;
}

export async function createResilientPool(options = {}) {
  const Pool = await getPool();
  const pool = new Pool(options);
  pool.on("error", () => {});
  // @context:regression !critical Idle client disconnects can arrive after a
  // workflow finishes and after the client has been released back to the pool.
  // A pool-level listener is not enough for that case because pg emits the
  // fatal timeout on the individual Client instance, which otherwise crashes
  // the daemon with an unhandled EventEmitter error.
  pool.on("connect", (client) => {
    if (!client || typeof client.on !== "function") return;
    client.on("error", () => {});
  });
  return pool;
}
