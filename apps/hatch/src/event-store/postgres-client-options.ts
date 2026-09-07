export const DEFAULT_CANONICAL_EVENT_STORE_CONNECT_TIMEOUT_MS = 5_000;

export function resolveCanonicalEventStoreConnectTimeoutMs(
	env: NodeJS.ProcessEnv = process.env,
): number {
	const raw = String(env.HATCH_POSTGRES_CONNECT_TIMEOUT_MS || "").trim();
	if (!raw) return DEFAULT_CANONICAL_EVENT_STORE_CONNECT_TIMEOUT_MS;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CANONICAL_EVENT_STORE_CONNECT_TIMEOUT_MS;
}

export function buildCanonicalEventStorePgClientConfig({
	connectionString,
	env = process.env,
}: {
	connectionString: string;
	env?: NodeJS.ProcessEnv;
}) {
	return {
		connectionString: String(connectionString || "").trim(),
		// @context:regression !critical Factory daemons must fail closed when Postgres
		// connect stalls; otherwise execution-critical control-state and projection reads
		// can hang before tick_start and restart in a loop with no shipped work.
		connectionTimeoutMillis: resolveCanonicalEventStoreConnectTimeoutMs(env),
	};
}
