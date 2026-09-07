import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchTick } from "./loop.js";
import {
	dispatchQueueSourcePath,
	dispatchRunRecordPath,
	dispatchTickRecordPath,
	loadDispatchQueue,
	saveDispatchQueue,
	type DispatchQueueEntry,
} from "./store.js";

vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
}));

import { spawn } from "node:child_process";

function createMockChild(pid: number): EventEmitter & { pid: number } {
	return Object.assign(new EventEmitter(), { pid });
}

function deterministicRunId(tickId: string, graph: string, goalId?: string): string {
	const input = `${tickId}:${graph}:${goalId ?? ""}`;
	const hash = createHash("sha256").update(input).digest();
	const bytes = Buffer.from(hash.subarray(0, 16));
	bytes[6] = (bytes[6] & 0x0f) | 0x50;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

describe("dispatchTick", () => {
	let rootDir: string;

	beforeEach(() => {
		rootDir = mkdtempSync(join(tmpdir(), "hatch-dispatch-"));
	});

	afterEach(() => {
		rmSync(rootDir, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	it("writes tick/run metadata and updates the queue", async () => {
		const queue: DispatchQueueEntry[] = [
			{ graph: "graphs/goal_run.dot", goal_id: "goal-1", context: { foo: "bar" } },
			{ graph: "graphs/goal_run.dot", goal_id: "goal-2" },
		];
		const queuePath = dispatchQueueSourcePath(rootDir);
		saveDispatchQueue(queuePath, queue);

		const spawnMock = vi.mocked(spawn);
		let pidCounter = 1000;
		spawnMock.mockImplementation(() => {
			pidCounter += 1;
			return createMockChild(pidCounter) as any;
		});

		await dispatchTick({ rootDir, maxPerTick: 1 });

		expect(spawn).toHaveBeenCalledTimes(1);

		const tickId = "tick-000001";
		const tickPath = dispatchTickRecordPath(rootDir, tickId);
		const tickRecord = JSON.parse(readFileSync(tickPath, "utf8"));
		const expectedRunId = deterministicRunId(tickId, queue[0].graph, queue[0].goal_id);

		expect(tickRecord.status).toBe("completed");
		expect(tickRecord.queue_source).toBe(".hatch/dispatch/queue.json");
		expect(tickRecord.queue_snapshot).toBe(`.hatch/dispatch/queue-snapshots/${tickId}.json`);
		expect(tickRecord.run_ids).toEqual([expectedRunId]);
		expect(tickRecord.selected).toEqual([
			expect.objectContaining({
				graph: queue[0].graph,
				goal_id: queue[0].goal_id,
				run_id: expectedRunId,
				context: { foo: "bar" },
			}),
		]);

		const snapshotPath = join(rootDir, tickRecord.queue_snapshot);
		expect(loadDispatchQueue(snapshotPath)).toEqual([queue[1]]);
		expect(loadDispatchQueue(queuePath)).toEqual([queue[1]]);

		const runPath = dispatchRunRecordPath(rootDir, expectedRunId);
		const runRecord = JSON.parse(readFileSync(runPath, "utf8"));
		expect(runRecord.status).toBe("running");
		expect(runRecord.pid).toBe(pidCounter);
		expect(runRecord.tick_id).toBe(tickId);
		expect(runRecord.context).toEqual({ foo: "bar" });
		expect(runRecord.graph).toBe(resolve(rootDir, queue[0].graph));

		const [command, args, options] = spawnMock.mock.calls[0];
		expect(command).toBe("hatch");
		expect(args).toEqual(
			expect.arrayContaining(["run", resolve(rootDir, queue[0].graph), "--run-id", expectedRunId, "--context"]),
		);
		expect(options).toEqual(expect.objectContaining({ cwd: rootDir, stdio: "inherit" }));
	});
});
