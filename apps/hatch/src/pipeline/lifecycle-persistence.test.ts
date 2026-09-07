import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Context, StageStatus, type StageRecord } from "./context.js";
import { persistLifecycleContextFromEngine } from "./lifecycle-persistence.js";
import { createRunState, loadRunState } from "./run.js";

describe("persistLifecycleContextFromEngine", () => {
	let root = "";
	let testRunsDir = "";

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "hatch-lifecycle-persist-"));
		testRunsDir = join(root, ".hatch", "runs");
		mkdirSync(testRunsDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("persists lifecycle retry context into run state for recovery", () => {
		const runState = createRunState("persist-lifecycle", "/tmp/persist-lifecycle.dot", { runsDir: testRunsDir });
		const ctx = new Context({
			__run_id: runState.runId,
			__langfuse_retry_count: "2",
			__langfuse_retry_next_at: "1700000000000",
			__langfuse_last_flush_error: "flush timeout",
		});
		const records: StageRecord[] = [
			{
				nodeId: "n1",
				status: StageStatus.Failed,
				startedAt: new Date("2026-01-01T00:00:00.000Z"),
				endedAt: new Date("2026-01-01T00:00:01.000Z"),
				attempt: 1,
			},
		];
		const engine = {
			getRunState: vi.fn(() => runState),
			getContext: vi.fn(() => ctx),
			getRecords: vi.fn(() => records),
		};

		persistLifecycleContextFromEngine(engine);

		const persisted = loadRunState(runState.runId);
		expect(persisted?.context.__langfuse_retry_count).toBe("2");
		expect(persisted?.context.__langfuse_retry_next_at).toBe("1700000000000");
		expect(persisted?.context.__langfuse_last_flush_error).toBe("flush timeout");
		expect(persisted?.records.length).toBe(1);
		expect(persisted?.records[0]?.nodeId).toBe("n1");
	});

	it("is a no-op when engine or run state is missing", () => {
		expect(() => persistLifecycleContextFromEngine(null)).not.toThrow();
		expect(() =>
			persistLifecycleContextFromEngine({
				getRunState: () => undefined,
				getContext: () => new Context(),
				getRecords: () => [],
			}),
		).not.toThrow();
	});
});
