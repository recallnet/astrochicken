import { describe, expect, it } from "vitest";

import {
	buildCanonicalLifecycleEnvelopesFromRunLifecycleEvents,
	createCanonicalLifecycleEventEmitter,
	projectCanonicalLifecycleRows,
} from "./lifecycle-backfill.js";

describe("canonical lifecycle backfill", () => {
	it("maps lifecycle fail events into canonical failed rows", () => {
		const rows = buildCanonicalLifecycleEnvelopesFromRunLifecycleEvents({
			factoryId: "mothership",
			emitter: "apps.hatch.runtime",
			events: [
				{
					schemaVersion: 1,
					ts: "2026-03-25T12:00:00.000Z",
					event: "fail",
					runId: "run-fail-1",
					graph: "goal_run",
					node: "review",
					issue: "2411",
					milestone: "goal-2411",
				},
			],
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]?.event_family).toBe("hatch.run.failed");
		expect(rows[0]?.factory_id).toBe("mothership");
		const projection = projectCanonicalLifecycleRows(rows);
		expect(projection["run-fail-1"]).toEqual(
			expect.objectContaining({
				factory_id: "mothership",
				run_id: "run-fail-1",
				status: "failed",
				current_node: "",
				last_event_origin: "runtime",
			}),
		);
	});

	it("degrades optional canonical lifecycle emission when the store is unavailable", async () => {
		let ensureAttempts = 0;
		const emitter = createCanonicalLifecycleEventEmitter({
			connectionString: "postgres://optional",
			factoryId: "example-trading",
			runId: "run-optional-1",
			emitter: "apps.hatch.runtime",
			required: false,
			store: {
				async ensureSchema() {
					ensureAttempts += 1;
					throw new Error("Connection terminated due to connection timeout");
				},
				async append() {
					return [];
				},
				async read() {
					return [];
				},
				subscribe() {
					return () => {};
				},
				async close() {},
			},
		});

		emitter.emit([
			{
				schemaVersion: 1,
				ts: "2026-03-25T12:00:00.000Z",
				event: "run-start",
				runId: "run-optional-1",
				graph: "goal_run",
				node: "plan",
				issue: "1653",
				milestone: "goal-1653",
			},
		]);
		await expect(emitter.flush()).resolves.toBeUndefined();
		emitter.emit([
			{
				schemaVersion: 1,
				ts: "2026-03-25T12:00:01.000Z",
				event: "complete",
				runId: "run-optional-1",
				graph: "goal_run",
				node: "done",
				issue: "1653",
				milestone: "goal-1653",
			},
		]);
		await expect(emitter.flush()).resolves.toBeUndefined();
		expect(ensureAttempts).toBe(1);
	});

	it("keeps fail-closed behavior when the canonical store is required", async () => {
		const emitter = createCanonicalLifecycleEventEmitter({
			connectionString: "postgres://required",
			factoryId: "example-trading",
			runId: "run-required-1",
			emitter: "apps.hatch.runtime",
			required: true,
			store: {
				async ensureSchema() {
					throw new Error("Connection terminated due to connection timeout");
				},
				async append() {
					return [];
				},
				async read() {
					return [];
				},
				subscribe() {
					return () => {};
				},
				async close() {},
			},
		});

		emitter.emit([
			{
				schemaVersion: 1,
				ts: "2026-03-25T12:00:00.000Z",
				event: "run-start",
				runId: "run-required-1",
				graph: "goal_run",
				node: "plan",
				issue: "1653",
				milestone: "goal-1653",
			},
		]);

		await expect(emitter.flush()).rejects.toThrow(/connection timeout/i);
	});
});
