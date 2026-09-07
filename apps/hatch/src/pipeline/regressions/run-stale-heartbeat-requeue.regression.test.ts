import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	configureRunStorageScope,
	createRunState,
	loadRunMetadata,
	loadRunState,
	recoverStaleRuns,
	saveRunMetadata,
	saveRunState,
	type RunMetadata,
	type RunStatus,
} from "../run.js";

const pipelineFile = "/tmp/pipeline.dot";

function iso(offsetMs: number, now: Date): string {
	return new Date(now.getTime() + offsetMs).toISOString();
}

function makeWriteRunState(runsDir: string) {
	return function writeRunState(runId: string, status: RunStatus, updatedAt: string): void {
		const state = createRunState(runId, pipelineFile, { runsDir });
		state.status = status;
		state.startedAt = updatedAt;
		saveRunState(state, { now: new Date(updatedAt), updatePid: false });
	};
}

function makeWriteCustomRunState(runsDir: string) {
	return function writeCustomRunState(
		runId: string,
		status: RunStatus,
		updatedAt: string,
		mutate: (state: ReturnType<typeof createRunState>) => void,
	): void {
		const state = createRunState(runId, pipelineFile, { runsDir });
		state.status = status;
		state.startedAt = updatedAt;
		state.updatedAt = updatedAt;
		mutate(state);
		saveRunState(state, { now: new Date(updatedAt), updatePid: false });
	};
}

function writeRunMetadata(metadata: RunMetadata): void {
	saveRunMetadata(metadata, { touchUpdatedAt: false, now: new Date(metadata.updatedAt) });
}

describe("recoverStaleRuns", () => {
	let root: string;
	let testRunsDir: string;
	let writeRunState: ReturnType<typeof makeWriteRunState>;
	let writeCustomRunState: ReturnType<typeof makeWriteCustomRunState>;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "hatch-run-"));
		testRunsDir = join(root, ".hatch", "runs");
		mkdirSync(testRunsDir, { recursive: true });
		configureRunStorageScope({ runsDir: testRunsDir });
		writeRunState = makeWriteRunState(testRunsDir);
		writeCustomRunState = makeWriteCustomRunState(testRunsDir);
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("requeues stale running runs and ignores fresh or completed entries", () => {
		const now = new Date("2025-01-01T00:00:00.000Z");
		const staleUpdated = iso(-120_000, now);
		const freshUpdated = iso(-10_000, now);

		writeRunState("run-stale", "running", staleUpdated);
		writeRunMetadata({
			runId: "run-stale",
			status: "running",
			pid: null,
			heartbeatAt: staleUpdated,
			updatedAt: staleUpdated,
			requeueAttempted: false,
		});

		writeRunState("run-fresh", "running", freshUpdated);
		writeRunMetadata({
			runId: "run-fresh",
			status: "running",
			pid: null,
			heartbeatAt: freshUpdated,
			updatedAt: freshUpdated,
			requeueAttempted: false,
		});

		writeRunState("run-completed", "completed", staleUpdated);
		writeRunMetadata({
			runId: "run-completed",
			status: "completed",
			pid: null,
			heartbeatAt: staleUpdated,
			updatedAt: staleUpdated,
			requeueAttempted: false,
		});

		const result = recoverStaleRuns({ ttlMs: 60_000, now });
		expect(result).toEqual([
			{
				runId: "run-stale",
				action: "requeued",
				status: "queued",
				reasonCode: "stale_heartbeat",
			},
		]);

		const staleState = loadRunState("run-stale");
		const staleMetadata = loadRunMetadata("run-stale");
		expect(staleState?.status).toBe("queued");
		expect(staleMetadata?.status).toBe("queued");
		expect(staleMetadata?.requeueAttempted).toBe(true);
		expect(staleMetadata?.reasonCode).toBe("stale_heartbeat");
		expect(staleMetadata?.updatedAt).toBe(now.toISOString());

		expect(loadRunState("run-fresh")?.status).toBe("running");
		expect(loadRunState("run-completed")?.status).toBe("completed");
	});

	it("requeues runs when heartbeat expires even if pid is alive", () => {
		const now = new Date("2025-01-01T00:30:00.000Z");
		const staleUpdated = iso(-120_000, now);

		writeRunState("run-heartbeat", "running", staleUpdated);
		writeRunMetadata({
			runId: "run-heartbeat",
			status: "running",
			pid: process.pid,
			heartbeatAt: staleUpdated,
			updatedAt: staleUpdated,
			requeueAttempted: false,
		});

		const result = recoverStaleRuns({ ttlMs: 60_000, now });
		expect(result).toEqual([
			{
				runId: "run-heartbeat",
				action: "requeued",
				status: "queued",
				reasonCode: "stale_heartbeat",
			},
		]);

		const metadata = loadRunMetadata("run-heartbeat");
		expect(metadata?.status).toBe("queued");
		expect(metadata?.reasonCode).toBe("stale_heartbeat");
		const state = loadRunState("run-heartbeat");
		expect(state?.status).toBe("queued");
	});

	it("fails stale runs when a requeue was already attempted", () => {
		const now = new Date("2025-01-01T01:00:00.000Z");
		const updatedAt = iso(-120_000, now);
		const deadPid = process.pid + 100_000;

		writeRunState("run-requeued", "running", updatedAt);
		writeRunMetadata({
			runId: "run-requeued",
			status: "running",
			pid: deadPid,
			heartbeatAt: now.toISOString(),
			updatedAt,
			requeueAttempted: true,
		});

		const result = recoverStaleRuns({ ttlMs: 60_000, now });
		expect(result).toEqual([
			{
				runId: "run-requeued",
				action: "failed",
				status: "failed",
				reasonCode: "stale_pid",
			},
		]);

		expect(loadRunState("run-requeued")?.status).toBe("failed");
		const metadata = loadRunMetadata("run-requeued");
		expect(metadata?.status).toBe("failed");
		expect(metadata?.reasonCode).toBe("stale_pid");
	});

	it("fails runs with missing metadata using metadata_missing reason", () => {
		const now = new Date("2025-01-01T02:00:00.000Z");
		const updatedAt = iso(-120_000, now);

		writeRunState("run-legacy", "running", updatedAt);

		const result = recoverStaleRuns({ ttlMs: 60_000, now });
		expect(result).toEqual([
			{
				runId: "run-legacy",
				action: "failed",
				status: "failed",
				reasonCode: "metadata_missing",
			},
		]);

		expect(loadRunState("run-legacy")?.status).toBe("failed");
		const metadata = loadRunMetadata("run-legacy");
		expect(metadata?.status).toBe("failed");
		expect(metadata?.reasonCode).toBe("metadata_missing");
	});

	it("requeues only unfinished fan_out_goal_run children and preserves completed siblings", () => {
		const now = new Date("2025-01-01T03:00:00.000Z");
		const staleUpdated = iso(-120_000, now);

		writeCustomRunState("supervisor-parent", "running", staleUpdated, (state) => {
			state.currentNode = "fan_out_goal_run";
			state.activeChildren = {
				"fan_out_goal_run__0": {
					childId: "fan_out_goal_run__0",
					parentNodeId: "fan_out_goal_run",
					childRunId: "goal-child-a",
					childRunDir: ".hatch/runs/goal-child-a",
					pipelineFile: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
					status: "completed",
					currentNode: "done",
				},
				"fan_out_goal_run__1": {
					childId: "fan_out_goal_run__1",
					parentNodeId: "fan_out_goal_run",
					childRunId: "goal-child-b",
					childRunDir: ".hatch/runs/goal-child-b",
					pipelineFile: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
					status: "completed",
					currentNode: "done",
				},
				"fan_out_goal_run__2": {
					childId: "fan_out_goal_run__2",
					parentNodeId: "fan_out_goal_run",
					childRunId: "goal-child-c",
					childRunDir: ".hatch/runs/goal-child-c",
					pipelineFile: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
					status: "running",
					currentNode: "intake_decompose",
				},
			};
		});
		writeRunMetadata({
			runId: "supervisor-parent",
			status: "running",
			pid: null,
			heartbeatAt: staleUpdated,
			updatedAt: staleUpdated,
			requeueAttempted: false,
		});

		for (const childRunId of ["goal-child-a", "goal-child-b"]) {
			writeCustomRunState(childRunId, "completed", staleUpdated, (state) => {
				state.currentNode = "done";
				state.context.goal_issue = childRunId === "goal-child-a" ? "1564" : "1565";
			});
			writeRunMetadata({
				runId: childRunId,
				status: "completed",
				pid: null,
				heartbeatAt: staleUpdated,
				updatedAt: staleUpdated,
				requeueAttempted: false,
			});
		}

		writeCustomRunState("goal-child-c", "running", staleUpdated, (state) => {
			state.currentNode = "intake_decompose";
			state.context.goal_issue = "1592";
			state.context.goal_title = "Goal: example-trading policy template pack";
		});
		writeRunMetadata({
			runId: "goal-child-c",
			status: "running",
			pid: null,
			heartbeatAt: staleUpdated,
			updatedAt: staleUpdated,
			requeueAttempted: false,
		});

		const result = recoverStaleRuns({ ttlMs: 60_000, now });
		expect(result).toEqual([
			{
				runId: "goal-child-c",
				action: "requeued",
				status: "queued",
				reasonCode: "stale_heartbeat",
			},
			{
				runId: "supervisor-parent",
				action: "requeued",
				status: "queued",
				reasonCode: "stale_heartbeat",
			},
		]);

		expect(loadRunState("goal-child-a")?.status).toBe("completed");
		expect(loadRunState("goal-child-b")?.status).toBe("completed");
		expect(loadRunState("goal-child-c")?.status).toBe("queued");
		const parentState = loadRunState("supervisor-parent");
		expect(parentState?.status).toBe("queued");
		expect(parentState?.activeChildren["fan_out_goal_run__0"]?.status).toBe("completed");
		expect(parentState?.activeChildren["fan_out_goal_run__1"]?.status).toBe("completed");
		expect(parentState?.activeChildren["fan_out_goal_run__2"]?.status).toBe("running");
	});

	it("requeues a stale goal_intake_decompose:propose chain without touching completed sibling goal runs", () => {
		const now = new Date("2025-01-01T04:00:00.000Z");
		const staleUpdated = iso(-120_000, now);

		writeCustomRunState("supervisor-parent-propose", "running", staleUpdated, (state) => {
			state.currentNode = "fan_out_goal_run";
			state.activeChildren = {
				"fan_out_goal_run__0": {
					childId: "fan_out_goal_run__0",
					parentNodeId: "fan_out_goal_run",
					childRunId: "goal-child-complete",
					childRunDir: ".hatch/runs/goal-child-complete",
					pipelineFile: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
					status: "completed",
					currentNode: "done",
				},
				"fan_out_goal_run__1": {
					childId: "fan_out_goal_run__1",
					parentNodeId: "fan_out_goal_run",
					childRunId: "goal-child-propose",
					childRunDir: ".hatch/runs/goal-child-propose",
					pipelineFile: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
					status: "running",
					currentNode: "intake_decompose",
				},
			};
		});
		writeRunMetadata({
			runId: "supervisor-parent-propose",
			status: "running",
			pid: null,
			heartbeatAt: staleUpdated,
			updatedAt: staleUpdated,
			requeueAttempted: false,
		});

		writeCustomRunState("goal-child-complete", "completed", staleUpdated, (state) => {
			state.currentNode = "done";
			state.context.goal_issue = "1564";
			state.context.created_issue_numbers = "[1625,1626]";
		});
		writeRunMetadata({
			runId: "goal-child-complete",
			status: "completed",
			pid: null,
			heartbeatAt: staleUpdated,
			updatedAt: staleUpdated,
			requeueAttempted: false,
		});

		writeCustomRunState("goal-child-propose", "running", staleUpdated, (state) => {
			state.currentNode = "intake_decompose";
			state.activeChildren = {
				"intake_decompose__0": {
					childId: "intake_decompose__0",
					parentNodeId: "intake_decompose",
					childRunId: "goal-grandchild-propose",
					childRunDir: ".hatch/runs/goal-grandchild-propose",
					pipelineFile: "packages/capability-goal-decomposition/workflows/goal_intake_decompose/goal_intake_decompose.workflow-source.mjs",
					status: "running",
					currentNode: "propose",
				},
			};
			state.context.goal_issue = "1592";
		});
		writeRunMetadata({
			runId: "goal-child-propose",
			status: "running",
			pid: null,
			heartbeatAt: staleUpdated,
			updatedAt: staleUpdated,
			requeueAttempted: false,
		});

		writeCustomRunState("goal-grandchild-propose", "running", staleUpdated, (state) => {
			state.currentNode = "propose";
			state.context.goal_issue = "1592";
			state.context.goal_summary = "Ship external-factory policy template pack";
		});
		writeRunMetadata({
			runId: "goal-grandchild-propose",
			status: "running",
			pid: null,
			heartbeatAt: staleUpdated,
			updatedAt: staleUpdated,
			requeueAttempted: false,
		});

		const result = recoverStaleRuns({ ttlMs: 60_000, now });
		expect(result).toEqual([
			{
				runId: "goal-child-propose",
				action: "requeued",
				status: "queued",
				reasonCode: "stale_heartbeat",
			},
			{
				runId: "goal-grandchild-propose",
				action: "requeued",
				status: "queued",
				reasonCode: "stale_heartbeat",
			},
			{
				runId: "supervisor-parent-propose",
				action: "requeued",
				status: "queued",
				reasonCode: "stale_heartbeat",
			},
		]);

		expect(loadRunState("goal-child-complete")?.status).toBe("completed");
		expect(loadRunState("goal-grandchild-propose")?.status).toBe("queued");
		const childState = loadRunState("goal-child-propose");
		expect(childState?.status).toBe("queued");
		expect(childState?.activeChildren["intake_decompose__0"]?.childRunId).toBe("goal-grandchild-propose");
		expect(childState?.activeChildren["intake_decompose__0"]?.currentNode).toBe("propose");
	});

	it("preserves existing decomposition artifacts across restart so resumed goal runs can dedupe", () => {
		const now = new Date("2025-01-01T05:00:00.000Z");
		const staleUpdated = iso(-120_000, now);

		writeCustomRunState("goal-child-artifacts", "running", staleUpdated, (state) => {
			state.currentNode = "triage";
			state.context.goal_issue = "1523";
			state.context.decompose_plan_comment_id = "comment-123";
			state.context.created_issue_numbers = "[1615,1627,1629]";
			state.context.created_milestone_titles = "[\"goal-1523-wave-1\",\"goal-1523-wave-2\"]";
			state.context.decompose_parse_status = "valid_json";
			state.completedNodes = [
				{ id: "intake_decompose", completedAt: staleUpdated, outputHash: "hash-intake" },
				{ id: "issues", completedAt: staleUpdated, outputHash: "hash-issues" },
			];
		});
		writeRunMetadata({
			runId: "goal-child-artifacts",
			status: "running",
			pid: null,
			heartbeatAt: staleUpdated,
			updatedAt: staleUpdated,
			requeueAttempted: false,
		});

		const result = recoverStaleRuns({ ttlMs: 60_000, now });
		expect(result).toEqual([
			{
				runId: "goal-child-artifacts",
				action: "requeued",
				status: "queued",
				reasonCode: "stale_heartbeat",
			},
		]);

		const recovered = loadRunState("goal-child-artifacts");
		expect(recovered?.status).toBe("queued");
		expect(recovered?.context.decompose_plan_comment_id).toBe("comment-123");
		expect(recovered?.context.created_issue_numbers).toBe("[1615,1627,1629]");
		expect(recovered?.context.created_milestone_titles).toBe("[\"goal-1523-wave-1\",\"goal-1523-wave-2\"]");
		expect(recovered?.completedNodes.map((row) => row.id)).toEqual(["intake_decompose", "issues"]);
	});
});
