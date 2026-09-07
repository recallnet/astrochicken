import { Client } from "pg";

import { buildCanonicalEventStorePgClientConfig } from "./postgres-client-options.js";

export type CanonicalEventStoreProbeResult = { ok: true } | { ok: false; reason: string };

export async function probeCanonicalEventStore(connectionString: string): Promise<CanonicalEventStoreProbeResult> {
	const client = new Client(buildCanonicalEventStorePgClientConfig({ connectionString }));
	try {
		await client.connect();
		await client.query("select 1");
		return { ok: true };
	} catch (error) {
		return { ok: false, reason: String(error instanceof Error ? error.message : error) };
	} finally {
		await client.end().catch(() => {});
	}
}

export async function assertCanonicalEventStoreAvailableForExecution({
	required,
	connectionString,
	probe = probeCanonicalEventStore,
}: {
	required: boolean;
	connectionString: string;
	probe?: (connectionString: string) => Promise<CanonicalEventStoreProbeResult>;
}): Promise<void> {
	if (!required) return;
	if (!String(connectionString || "").trim()) {
		throw new Error("Canonical event store fail-closed: missing connection string for execution-critical path");
	}
	const result = await probe(connectionString);
	if (!result.ok) {
		throw new Error(`Canonical event store fail-closed: ${result.reason}`);
	}
}

export async function assertCanonicalEventStoreAvailableForCommand(
	command: string,
	env: NodeJS.ProcessEnv = process.env,
	probe: (connectionString: string) => Promise<CanonicalEventStoreProbeResult> = probeCanonicalEventStore,
): Promise<void> {
	const executionCritical = new Set(["run", "resume", "recover", "watch", "dispatch"]);
	if (!executionCritical.has(command)) return;
	const required = env.HATCH_CANONICAL_EVENT_STORE_REQUIRED === "true";
	const connectionString = env.HATCH_CANONICAL_EVENT_STORE_URL || "";
	await assertCanonicalEventStoreAvailableForExecution({ required, connectionString, probe });
}
