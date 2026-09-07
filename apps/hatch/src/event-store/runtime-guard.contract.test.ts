import { describe, expect, it } from "vitest";

import {
	DEFAULT_CANONICAL_EVENT_STORE_CONNECT_TIMEOUT_MS,
	buildCanonicalEventStorePgClientConfig,
	resolveCanonicalEventStoreConnectTimeoutMs,
} from "./postgres-client-options.js";
import {
	assertCanonicalEventStoreAvailableForCommand,
	assertCanonicalEventStoreAvailableForExecution,
	probeCanonicalEventStore,
} from "./runtime-guard.js";

describe("canonical event store runtime guard", () => {
	it("reports a failed probe result when postgres is unreachable", async () => {
		await expect(probeCanonicalEventStore("postgres://test:test@127.0.0.1:1/test")).resolves.toMatchObject({
			ok: false,
		});
	});

	it("applies a finite default postgres connect timeout", () => {
		expect(
			buildCanonicalEventStorePgClientConfig({
				connectionString: "postgres://test:test@127.0.0.1:5432/test",
			}).connectionTimeoutMillis,
		).toBe(DEFAULT_CANONICAL_EVENT_STORE_CONNECT_TIMEOUT_MS);
	});

	it("honors HATCH_POSTGRES_CONNECT_TIMEOUT_MS overrides", () => {
		expect(
			buildCanonicalEventStorePgClientConfig({
				connectionString: "postgres://test:test@127.0.0.1:5432/test",
				env: { HATCH_POSTGRES_CONNECT_TIMEOUT_MS: "2345" },
			}).connectionTimeoutMillis,
		).toBe(2345);
	});

	it("normalizes invalid connect timeout env values back to the default", () => {
		expect(
			resolveCanonicalEventStoreConnectTimeoutMs({
				HATCH_POSTGRES_CONNECT_TIMEOUT_MS: "0",
			}),
		).toBe(DEFAULT_CANONICAL_EVENT_STORE_CONNECT_TIMEOUT_MS);
	});

	it("fails closed when the canonical store is required but unavailable", async () => {
		await expect(
			assertCanonicalEventStoreAvailableForExecution({
				required: true,
				connectionString: "postgres://test:test@127.0.0.1:1/test",
				probe: async () => ({ ok: false, reason: "connect ECONNREFUSED" }),
			}),
		).rejects.toThrow(/fail-closed/i);
	});

	it("allows execution when the canonical store is healthy", async () => {
		await expect(
			assertCanonicalEventStoreAvailableForExecution({
				required: true,
				connectionString: "postgres://test:test@127.0.0.1:5432/test",
				probe: async () => ({ ok: true }),
			}),
		).resolves.toBeUndefined();
	});

	it("guards execution-critical commands and ignores non-execution commands", async () => {
		await expect(
			assertCanonicalEventStoreAvailableForCommand(
				"run",
				{
					HATCH_CANONICAL_EVENT_STORE_REQUIRED: "true",
					HATCH_CANONICAL_EVENT_STORE_URL: "postgres://test:test@127.0.0.1:1/test",
				},
				async () => ({ ok: false, reason: "connect ECONNREFUSED" }),
			),
		).rejects.toThrow(/fail-closed/i);

		await expect(
			assertCanonicalEventStoreAvailableForCommand(
				"validate",
				{
					HATCH_CANONICAL_EVENT_STORE_REQUIRED: "true",
					HATCH_CANONICAL_EVENT_STORE_URL: "postgres://test:test@127.0.0.1:1/test",
				},
				async () => ({ ok: false, reason: "connect ECONNREFUSED" }),
			),
		).resolves.toBeUndefined();
	});
});
