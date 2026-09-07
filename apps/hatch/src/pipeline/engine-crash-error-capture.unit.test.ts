import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus } from "@recallnet/factory-telemetry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Context, type Outcome, StageStatus } from "./context.js";
import { Engine, HandlerRegistry, type Handler } from "./engine.js";
import { parse } from "./parse.js";
import { createRunState, type RunState, saveRunState } from "./run.js";

import type { Node } from "./graph.js";

/**
 * Handler that throws an exception on a specific node to simulate
 * a handler crash (e.g., artifact_ingest or run_release_report_flow).
 */
class CrashingHandler implements Handler {
	constructor(
		private readonly crashNodeId: string,
		private readonly errorMessage: string,
	) {}

	async execute(
		_signal: AbortSignal,
		node: Node,
		_ctx: Context,
		input: string,
	): Promise<Outcome> {
		if (node.id === this.crashNodeId) {
			throw new Error(this.errorMessage);
		}
		return { status: StageStatus.Completed, output: input || node.id };
	}
}

function buildCrashGraph() {
	return parse(`
		digraph crash_test {
			start [shape=Mdiamond]
			step_a [type="tool"]
			crash_node [type="tool"]
			done [shape=Msquare]

			start -> step_a -> crash_node -> done
		}
	`);
}

describe("engine crash error capture", () => {
	let testRoot: string;
	let testRunsDir: string;

	beforeEach(() => {
		testRoot = mkdtempSync(join(tmpdir(), "hatch-crash-error-capture-"));
		testRunsDir = join(testRoot, ".hatch", "runs");
		mkdirSync(testRunsDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testRoot, { recursive: true, force: true });
	});

	it("records error in run state records when handler throws and fail_open is not set", async () => {
		const errorMessage = "artifact_ingest exploded: connection refused";
		const runId = "crash-err-01";
		const eventBus = new EventBus();

		const handler = new CrashingHandler("crash_node", errorMessage);
		const registry = new HandlerRegistry();
		registry.register("tool", handler);

		const runState = createRunState(runId, "/tmp/crash-test.dot", { runsDir: testRunsDir });
		const engine = new Engine(buildCrashGraph(), registry, {
			context: new Context(),
			eventBus,
			runState,
		});

		// The pipeline should throw because crash_node has no fail_open
		await expect(engine.run()).rejects.toThrow();

		// The critical assertion: the run state records must contain the error
		const finalRunState = engine.getRunState()!;
		expect(finalRunState).toBeDefined();

		// Find the record for the crashing node
		const crashRecords = finalRunState.records.filter(
			(r) => r.nodeId === "crash_node" && r.status === StageStatus.Failed,
		);
		expect(crashRecords.length).toBeGreaterThan(0);

		// At least one record must have an outcome with the error message captured
		const hasErrorCaptured = crashRecords.some(
			(r) => r.outcome?.error && r.outcome.error.includes(errorMessage),
		);
		expect(
			hasErrorCaptured,
			`Expected at least one crash_node record to have outcome.error containing "${errorMessage}", but got: ${JSON.stringify(crashRecords.map((r) => r.outcome))}`,
		).toBe(true);

		// The run state status should be "failed"
		expect(finalRunState.status).toBe("failed");
	});

	it("still propagates the exception after recording the error", async () => {
		const errorMessage = "fatal handler error";
		const runId = "crash-err-02";
		const eventBus = new EventBus();

		const handler = new CrashingHandler("crash_node", errorMessage);
		const registry = new HandlerRegistry();
		registry.register("tool", handler);

		const runState = createRunState(runId, "/tmp/crash-test-propagate.dot", { runsDir: testRunsDir });
		const engine = new Engine(buildCrashGraph(), registry, {
			context: new Context(),
			eventBus,
			runState,
		});

		// Must still throw so the pipeline fails
		await expect(engine.run()).rejects.toThrow();
	});
});
