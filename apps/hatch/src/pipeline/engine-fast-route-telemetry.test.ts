import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus, type Event } from "@recallnet/factory-telemetry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Context, type Outcome, StageStatus, type StageRecord } from "./context.js";
import { Engine, HandlerRegistry, type Handler } from "./engine.js";
import { parse } from "./parse.js";
import { createRunState } from "./run.js";

import type { Node } from "./graph.js";

interface ScenarioResult {
	events: Event[];
	records: StageRecord[];
	executedNodes: string[];
	persistedState: {
		context: Record<string, string>;
	};
	getEngineRecords: () => StageRecord[];
}

class FastRouteScenarioHandler implements Handler {
	constructor(
		private readonly hasOpenBugs: boolean,
		private readonly executedNodes: string[],
	) {}

	async execute(
		_signal: AbortSignal,
		node: Node,
		_ctx: Context,
		_input: string,
	): Promise<Outcome> {
		this.executedNodes.push(node.id);

		if (node.id === "evaluate_open_bug_gate_fast") {
			const flag = this.hasOpenBugs ? "true" : "false";
			return {
				status: StageStatus.Completed,
				output: flag,
				contextUpdates: {
					has_open_bugs: flag,
					open_bugs_present: flag,
				},
			};
		}

		return {
			status: StageStatus.Completed,
			output: node.id,
		};
	}
}

function buildFastRouteGraph() {
	return parse(`
		digraph fast_route_visibility {
			start [shape=Mdiamond]
			snapshot_state_fast [type="tool"]
			evaluate_open_bug_gate_fast [type="tool"]
			bug_fast_gate [shape=diamond]
			set_date_fast [type="tool"]
			supervisor_review_bug_fast [type="tool"]
			spawn_wave_runs [type="tool"]
			done [shape=Msquare]

			start -> snapshot_state_fast -> evaluate_open_bug_gate_fast -> bug_fast_gate
			bug_fast_gate -> supervisor_review_bug_fast [condition="has_open_bugs=true"]
			bug_fast_gate -> set_date_fast [condition="has_open_bugs!=true"]
			supervisor_review_bug_fast -> done
			set_date_fast -> spawn_wave_runs -> done
		}
	`);
}

function expectOrderedSubsequence(sequence: string[], subsequence: string[]) {
	let searchFrom = 0;
	for (const nodeId of subsequence) {
		const index = sequence.indexOf(nodeId, searchFrom);
		expect(
			index,
			`expected node \"${nodeId}\" to appear after index ${searchFrom - 1} in ${JSON.stringify(sequence)}`,
		).toBeGreaterThanOrEqual(0);
		searchFrom = index + 1;
	}
}

async function runScenario(args: { runId: string; hasOpenBugs: boolean; runsDir: string }): Promise<ScenarioResult> {
	const events: Event[] = [];
	const eventBus = new EventBus();
	eventBus.on((event) => events.push(event));

	const executedNodes: string[] = [];
	const handler = new FastRouteScenarioHandler(args.hasOpenBugs, executedNodes);
	const registry = new HandlerRegistry();
	registry.register("tool", handler);
	registry.register("conditional", handler);

	const runState = createRunState(args.runId, "/tmp/engine-fast-route-telemetry.dot", { runsDir: args.runsDir });
	const engine = new Engine(buildFastRouteGraph(), registry, {
		context: new Context(),
		eventBus,
		runState,
	});

	await engine.run();

	const statePath = join(args.runsDir, args.runId, "state.json");
	const persistedState = JSON.parse(readFileSync(statePath, "utf8")) as ScenarioResult["persistedState"];

	return {
		events,
		records: engine.getRecords(),
		executedNodes,
		persistedState,
		getEngineRecords: () => engine.getRecords(),
	};
}

describe("engine fast-route telemetry", () => {
	let testRoot = "";
	let testRunsDir = "";

	beforeEach(() => {
		testRoot = mkdtempSync(join(tmpdir(), "hatch-fast-route-telemetry-"));
		testRunsDir = join(testRoot, ".hatch", "runs");
		mkdirSync(testRunsDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testRoot, { recursive: true, force: true });
	});

	it("captures and persists bug_fast_gate telemetry for open-bug branch", async () => {
		const result = await runScenario({ runId: "fast-route-open-bug", hasOpenBugs: true, runsDir: testRunsDir });

		const fastRouteEvent = result.events.find((event) => event.kind === "fast-route.branch");
		expect(fastRouteEvent).toBeDefined();
		expect(fastRouteEvent?.nodeId).toBe("bug_fast_gate");
		expect(fastRouteEvent?.edgeFrom).toBe("bug_fast_gate");
		expect(fastRouteEvent?.edgeTo).toBe("supervisor_review_bug_fast");
		expect(fastRouteEvent?.data).toMatchObject({
			"fast_route.last_gate": "bug_fast_gate",
			"fast_route.branch": "supervisor_review_bug_fast",
			"fast_route.has_open_bugs": "true",
		});

		expect(result.persistedState.context["fast_route.last_gate"]).toBe("bug_fast_gate");
		expect(result.persistedState.context["fast_route.branch"]).toBe("supervisor_review_bug_fast");
		expect(result.persistedState.context["fast_route.has_open_bugs"]).toBe("true");

		const fastRouteSequence = [
			"snapshot_state_fast",
			"evaluate_open_bug_gate_fast",
			"bug_fast_gate",
			"supervisor_review_bug_fast",
		];
		expectOrderedSubsequence(result.executedNodes, fastRouteSequence);
		expect(result.executedNodes.slice(0, fastRouteSequence.length)).toEqual(fastRouteSequence);

		const openBugExecutionSequence = result.executedNodes.filter((nodeId) =>
			[
				"snapshot_state_fast",
				"evaluate_open_bug_gate_fast",
				"supervisor_review_bug_fast",
			].includes(nodeId),
		);
		expect(openBugExecutionSequence).toEqual([
			"snapshot_state_fast",
			"evaluate_open_bug_gate_fast",
			"supervisor_review_bug_fast",
		]);

		expect(result.records.some((record) => record.nodeId === "spawn_wave_runs")).toBe(false);
		expect(result.getEngineRecords().some((record) => record.nodeId === "spawn_wave_runs")).toBe(false);
	}, 30_000);

	it("captures and persists bug_fast_gate telemetry for clean branch", async () => {
		const result = await runScenario({ runId: "fast-route-clean", hasOpenBugs: false, runsDir: testRunsDir });

		const fastRouteEvent = result.events.find((event) => event.kind === "fast-route.branch");
		expect(fastRouteEvent).toBeDefined();
		expect(fastRouteEvent?.edgeTo).toBe("set_date_fast");
		expect(fastRouteEvent?.data).toMatchObject({
			"fast_route.last_gate": "bug_fast_gate",
			"fast_route.branch": "set_date_fast",
			"fast_route.has_open_bugs": "false",
		});

		expect(result.persistedState.context["fast_route.last_gate"]).toBe("bug_fast_gate");
		expect(result.persistedState.context["fast_route.branch"]).toBe("set_date_fast");
		expect(result.persistedState.context["fast_route.has_open_bugs"]).toBe("false");

		expectOrderedSubsequence(result.executedNodes, ["bug_fast_gate", "spawn_wave_runs"]);
		expect(result.records.some((record) => record.nodeId === "spawn_wave_runs")).toBe(true);
	}, 30_000);
});
