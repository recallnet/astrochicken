import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StageStatus } from "./context.js";
import { defaultCheckpointPath, loadCheckpoint, saveCheckpoint } from "./checkpoint.js";
import type { Checkpoint } from "./checkpoint.js";

vi.mock("../factory/repo-path-health.js", () => ({
	assertPathDoesNotRecreateConfiguredRepo: () => {},
}));

let tempDir: string;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "checkpoint-test-"));
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

describe("defaultCheckpointPath", () => {
	it("returns path ending with .hatch-checkpoint-<basename>.json", () => {
		const result = defaultCheckpointPath("factories/mothership/graphs/tick.dot");
		expect(result).toBe("factories/mothership/graphs/.hatch-checkpoint-tick.json");
	});

	it("strips .dot extension from the basename", () => {
		const result = defaultCheckpointPath("some/dir/my-pipeline.dot");
		expect(result).toBe("some/dir/.hatch-checkpoint-my-pipeline.json");
	});

	it("returns path in same directory as the pipeline file", () => {
		const result = defaultCheckpointPath("a/b/c/run.dot");
		expect(result.startsWith("a/b/c/")).toBe(true);
	});
});

describe("saveCheckpoint + loadCheckpoint roundtrip", () => {
	function makeCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
		return {
			pipelineFile: "test.dot",
			currentNodeId: "node_2",
			lastOutput: "hello world",
			context: { key1: "value1", key2: "value2" },
			records: [
				{
					nodeId: "node_1",
					status: StageStatus.Completed,
					startedAt: new Date("2026-01-15T10:00:00.000Z"),
					endedAt: new Date("2026-01-15T10:01:00.000Z"),
					attempt: 1,
				},
			],
			savedAt: "2026-01-15T10:01:00.000Z",
			...overrides,
		};
	}

	it("roundtrips with Date objects preserved", () => {
		const path = join(tempDir, "checkpoint.json");
		const original = makeCheckpoint();

		saveCheckpoint(path, original);
		const loaded = loadCheckpoint(path);

		expect(loaded.records[0].startedAt).toBeInstanceOf(Date);
		expect(loaded.records[0].endedAt).toBeInstanceOf(Date);
		expect(loaded.records[0].startedAt.toISOString()).toBe("2026-01-15T10:00:00.000Z");
		expect(loaded.records[0].endedAt!.toISOString()).toBe("2026-01-15T10:01:00.000Z");
	});

	it("preserves context", () => {
		const path = join(tempDir, "checkpoint.json");
		const original = makeCheckpoint();

		saveCheckpoint(path, original);
		const loaded = loadCheckpoint(path);

		expect(loaded.context).toEqual({ key1: "value1", key2: "value2" });
	});

	it("preserves pipelineFile, currentNodeId, lastOutput, savedAt", () => {
		const path = join(tempDir, "checkpoint.json");
		const original = makeCheckpoint();

		saveCheckpoint(path, original);
		const loaded = loadCheckpoint(path);

		expect(loaded.pipelineFile).toBe("test.dot");
		expect(loaded.currentNodeId).toBe("node_2");
		expect(loaded.lastOutput).toBe("hello world");
		expect(loaded.savedAt).toBe("2026-01-15T10:01:00.000Z");
	});

	it("records with undefined endedAt survive roundtrip", () => {
		const path = join(tempDir, "checkpoint.json");
		const original = makeCheckpoint({
			records: [
				{
					nodeId: "node_1",
					status: StageStatus.Running,
					startedAt: new Date("2026-01-15T10:00:00.000Z"),
					endedAt: undefined,
					attempt: 1,
				},
			],
		});

		saveCheckpoint(path, original);
		const loaded = loadCheckpoint(path);

		expect(loaded.records[0].endedAt).toBeUndefined();
		expect(loaded.records[0].startedAt).toBeInstanceOf(Date);
	});
});

describe("saveCheckpoint", () => {
	it("creates parent directories if needed", () => {
		const path = join(tempDir, "a", "b", "c", "checkpoint.json");

		const checkpoint: Checkpoint = {
			pipelineFile: "test.dot",
			currentNodeId: "node_1",
			lastOutput: "",
			context: {},
			records: [],
			savedAt: "2026-01-15T10:00:00.000Z",
		};

		saveCheckpoint(path, checkpoint);

		const raw = readFileSync(path, "utf-8");
		const data = JSON.parse(raw);
		expect(data.pipelineFile).toBe("test.dot");
	});
});

describe("loadCheckpoint date deserialization", () => {
	it("converts startedAt from ISO string to Date", () => {
		const path = join(tempDir, "checkpoint.json");
		const checkpoint: Checkpoint = {
			pipelineFile: "test.dot",
			currentNodeId: "node_1",
			lastOutput: "",
			context: {},
			records: [
				{
					nodeId: "node_1",
					status: StageStatus.Completed,
					startedAt: new Date("2026-03-01T12:00:00.000Z"),
					endedAt: new Date("2026-03-01T12:05:00.000Z"),
					attempt: 1,
				},
			],
			savedAt: "2026-03-01T12:05:00.000Z",
		};

		saveCheckpoint(path, checkpoint);
		const loaded = loadCheckpoint(path);

		expect(loaded.records[0].startedAt).toBeInstanceOf(Date);
		expect(loaded.records[0].startedAt.toISOString()).toBe("2026-03-01T12:00:00.000Z");
	});

	it("converts endedAt from ISO string to Date when present", () => {
		const path = join(tempDir, "checkpoint.json");
		const checkpoint: Checkpoint = {
			pipelineFile: "test.dot",
			currentNodeId: "node_1",
			lastOutput: "",
			context: {},
			records: [
				{
					nodeId: "node_1",
					status: StageStatus.Completed,
					startedAt: new Date("2026-03-01T12:00:00.000Z"),
					endedAt: new Date("2026-03-01T12:05:00.000Z"),
					attempt: 1,
				},
			],
			savedAt: "2026-03-01T12:05:00.000Z",
		};

		saveCheckpoint(path, checkpoint);
		const loaded = loadCheckpoint(path);

		expect(loaded.records[0].endedAt).toBeInstanceOf(Date);
		expect(loaded.records[0].endedAt!.toISOString()).toBe("2026-03-01T12:05:00.000Z");
	});

	it("leaves endedAt as undefined when not present in JSON", () => {
		const path = join(tempDir, "checkpoint.json");
		const checkpoint: Checkpoint = {
			pipelineFile: "test.dot",
			currentNodeId: "node_1",
			lastOutput: "",
			context: {},
			records: [
				{
					nodeId: "node_1",
					status: StageStatus.Running,
					startedAt: new Date("2026-03-01T12:00:00.000Z"),
					attempt: 1,
				},
			],
			savedAt: "2026-03-01T12:00:00.000Z",
		};

		saveCheckpoint(path, checkpoint);
		const loaded = loadCheckpoint(path);

		expect(loaded.records[0].endedAt).toBeUndefined();
	});
});
