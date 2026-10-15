import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { buildCanonicalEventEnvelope } from "./envelope.js";
import {
	createCanonicalLifecycleEventEmitter,
} from "./lifecycle-backfill.js";
import { createCanonicalPostgresEventStore } from "./postgres-store.js";
import {
	clearLifecycleProjectionEmitters,
	configureRunStorageScope,
	createRunState,
	saveRunState,
	setLifecycleProjectionEmitter,
} from "../pipeline/run.js";

import { createComposeCommand, waitForComposePostgres } from "../../../../scripts/test/helpers/compose-command.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const composePath = path.resolve(
	repoRoot,
	"packages/factory-ops/config/postgres/canonical-event-store.compose.yml",
);


async function allocatePort(): Promise<number> {
	return await new Promise((resolve, reject) => {
		const server = net.createServer();
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("failed to allocate port"));
				return;
			}
			const { port } = address;
			server.close((error) => {
				if (error) reject(error);
				else resolve(port);
			});
		});
		server.on("error", reject);
	});
}

describe("canonical postgres event store", () => {
	const stateRoot = mkdtempSync(path.join(tmpdir(), "canonical-event-store-"));
	const envPath = path.join(stateRoot, "postgres.env");
	const composeProject = `commit01_${randomUUID().slice(0, 8)}`;
	let connectionString = "";
	const compose = createComposeCommand({ repoRoot, composePath, project: composeProject, envPath });

	beforeAll(async () => {
		const password = "astrochicken";
		const db = "astrochicken_factory";
		const user = "astrochicken";
		const port = String(await allocatePort());
		const envText = [
			`CANONICAL_EVENT_STORE_ROOT=${stateRoot}`,
			`POSTGRES_DB=${db}`,
			`POSTGRES_USER=${user}`,
			`POSTGRES_PASSWORD=${password}`,
			`POSTGRES_PORT=${port}`,
		].join("\n");
		writeFileSync(envPath, `${envText}\n`);
		compose("up", "-d", "postgres");
		await waitForComposePostgres(compose, user, db);
		connectionString = `postgres://${user}:${password}@127.0.0.1:${port}/${db}`;
	});

	afterAll(() => {
		try {
			compose("down", "-v");
		} finally {
			rmSync(stateRoot, { recursive: true, force: true });
		}
	});

	it("appends, reads, and subscribes with transactional batch ordering", async () => {
		const store = createCanonicalPostgresEventStore({ connectionString, subscribePollIntervalMs: 50 });
		await store.ensureSchema();

		const batch = [
			buildCanonicalEventEnvelope({
				event_family: "goal.selected",
				event_version: 1,
				factory_id: "example-trading",
				emitter: "apps.hatch.runtime",
				payload: { issue_number: 1462 },
			}),
			buildCanonicalEventEnvelope({
				event_family: "issue.created",
				event_version: 1,
				factory_id: "example-trading",
				run_id: "run-1462",
				emitter: "apps.hatch.runtime",
				payload: { issue_number: 1536 },
			}),
		];

		const appended = await store.append(batch);
		expect(appended).toHaveLength(2);
		expect(appended[0].commit_cursor).toBeTypeOf("number");
		expect(appended[0].batch_offset).toBe(0);
		expect(appended[1].commit_cursor).toBe(appended[0].commit_cursor);
		expect(appended[1].batch_offset).toBe(1);

		const rows = await store.read();
		expect(rows.map((row) => row.event_family)).toEqual(["goal.selected", "issue.created"]);

		const seen: string[] = [];
		const unsubscribe = store.subscribe((event) => {
			seen.push(event.event_family);
		});

		await store.append([
			buildCanonicalEventEnvelope({
				event_family: "review.completed",
				event_version: 1,
				factory_id: "example-trading",
				emitter: "apps.hatch.runtime",
				payload: { issue_number: 1536, disposition: "approve" },
			}),
		]);

		for (let i = 0; i < 20 && seen.length === 0; i += 1) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		unsubscribe();
		await store.close();

		expect(seen).toContain("review.completed");
	});

	it("emits fresh hatch lifecycle events into the canonical store partitioned by factory_id", async () => {
		const store = createCanonicalPostgresEventStore({ connectionString, subscribePollIntervalMs: 50 });
		await store.ensureSchema();
		const baseline = await store.read();
		const afterCursor = baseline.length > 0 ? Math.max(...baseline.map((row) => row.commit_cursor)) : 0;

		const stateRoot = mkdtempSync(path.join(tmpdir(), "lifecycle-store-"));
		const scopedRunsDir = path.join(stateRoot, "runs");
		configureRunStorageScope({ runsDir: scopedRunsDir, factoryId: "example-trading" });

		const emitter = createCanonicalLifecycleEventEmitter({
			connectionString,
			factoryId: "example-trading",
			runId: "run-emit-1462",
			emitter: "apps.hatch.runtime",
		});
		setLifecycleProjectionEmitter("run-emit-1462", (events) => {
			emitter.emit(events);
		});

		try {
			const state = createRunState("run-emit-1462", "factories/example-trading/graphs/goal_run.dot", {
				runsDir: scopedRunsDir,
				factoryId: "example-trading",
			});
			state.currentNode = "build";
			saveRunState(state, { updatePid: false });
			state.currentNode = "review";
			saveRunState(state, { updatePid: false });
			state.status = "completed";
			state.currentNode = "done";
			saveRunState(state, { updatePid: false });
			await emitter.flush();

			const rows = await store.read(afterCursor);
			expect(rows.every((row) => row.factory_id === "example-trading")).toBe(true);
			expect(rows.map((row) => row.event_family)).toEqual([
				"hatch.run.started",
				"hatch.run.node_entered",
				"hatch.run.node_exited",
				"hatch.run.node_entered",
				"hatch.run.node_exited",
				"hatch.run.node_entered",
				"hatch.run.completed",
			]);
		} finally {
			setLifecycleProjectionEmitter("run-emit-1462", null);
			clearLifecycleProjectionEmitters();
			await emitter.close();
			rmSync(stateRoot, { recursive: true, force: true });
			await store.close();
		}
	});

});
