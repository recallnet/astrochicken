import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus, type Event } from "@recallnet/factory-telemetry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Context, type Outcome, StageStatus, type StageRecord } from "./context.js";
import { Engine, HandlerRegistry, type Handler } from "./engine.js";
import { parseWithAst } from "./parse.js";
import { createRunState } from "./run.js";
import { applyGraphStylesheetImports } from "./stylesheet-imports.js";

import type { Node } from "./graph.js";

const SUPERVISOR_TICK_DOT = join(import.meta.dirname, "../../../../docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot");

interface ScenarioResult {
	events: Event[];
	records: StageRecord[];
	executedNodes: string[];
	persistedState: {
		context: Record<string, string>;
		records: Array<{ nodeId: string }>;
	};
}

function toStringRecord(values: Record<string, string | number | boolean>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(values)) {
		if (typeof value === "string") out[key] = value;
		else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
		else out[key] = JSON.stringify(value);
	}
	return out;
}

function jsonOutcome(values: Record<string, string | number | boolean>): Outcome {
	return {
		status: StageStatus.Completed,
		output: JSON.stringify(values),
		contextUpdates: toStringRecord(values),
	};
}

class SupervisorTickScenarioHandler implements Handler {
	constructor(
		private readonly hasOpenBugsFast: boolean,
		private readonly hasOpenBugsAfterFast: boolean,
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
			return jsonOutcome({
				has_open_bugs: this.hasOpenBugsFast,
				open_bug_count: this.hasOpenBugsFast ? 2 : 0,
				parse_error: "",
			});
		}

		if (node.id === "evaluate_open_bug_gate_after_fast") {
			return jsonOutcome({
				has_open_bugs: this.hasOpenBugsAfterFast,
				open_bug_count: this.hasOpenBugsAfterFast ? 1 : 0,
				parse_error: "",
			});
		}

		if (node.id === "count_ready_goals") {
			return {
				status: StageStatus.Completed,
				output: "0",
				contextUpdates: { goal_count: "0" },
			};
		}

		if (node.id === "decide_wave_dispatch") {
			return jsonOutcome({
				selected_waves: "[]",
				in_flight_count: 0,
				ready_count: 0,
				priorities_text: "",
			});
		}

		if (node.id === "detect_stalled_wave") {
			return jsonOutcome({
				stalled_wave_count: 0,
				stalled_wave_telemetry: "[]",
				stalled_wave_telemetry_count: 0,
			});
		}

		if (String(node.attrs.output_format || "") === "json") {
			const keys = String(node.attrs.outputs || "")
				.split(",")
				.map((key) => key.trim())
				.filter(Boolean);
			const payload = keys.reduce<Record<string, string>>((acc, key) => {
				acc[key] = "";
				return acc;
			}, {});
			return {
				status: StageStatus.Completed,
				output: JSON.stringify(payload),
			};
		}

		return {
			status: StageStatus.Completed,
			output: node.id,
		};
	}
}

function expectOrderedSubsequence(sequence: string[], subsequence: string[]) {
	let searchFrom = 0;
	for (const nodeId of subsequence) {
		const index = sequence.indexOf(nodeId, searchFrom);
		expect(index, `expected node ${nodeId} after index ${searchFrom - 1}`).toBeGreaterThanOrEqual(0);
		searchFrom = index + 1;
	}
}

async function runScenario(args: {
	runId: string;
	hasOpenBugsFast: boolean;
	hasOpenBugsAfterFast: boolean;
	runsDir: string;
}): Promise<ScenarioResult> {
	const events: Event[] = [];
	const eventBus = new EventBus();
	eventBus.on((event) => events.push(event));

	const executedNodes: string[] = [];
	const handler = new SupervisorTickScenarioHandler(args.hasOpenBugsFast, args.hasOpenBugsAfterFast, executedNodes);
	const registry = new HandlerRegistry();
	for (const handlerType of [
		"tool",
		"codergen",
		"stack.manager_loop",
		"pipeline",
		"fan_out.dynamic",
		"fan_in.dynamic",
		"fan_out.detached",
		"conditional",
	]) {
		registry.register(handlerType, handler);
	}

	const parsed = parseWithAst(readFileSync(SUPERVISOR_TICK_DOT, "utf8"));
	applyGraphStylesheetImports({
		graph: parsed.graph,
		graphFile: SUPERVISOR_TICK_DOT,
		stylesheetImports: parsed.stylesheetImports,
	});
	const graph = parsed.graph;
	const runState = createRunState(args.runId, SUPERVISOR_TICK_DOT, { runsDir: args.runsDir });
	const engine = new Engine(graph, registry, {
		context: new Context(),
		eventBus,
		runState,
	});

	await engine.run();

	const persistedState = JSON.parse(readFileSync(join(args.runsDir, args.runId, "state.json"), "utf8")) as ScenarioResult["persistedState"];

	return {
		events,
		records: engine.getRecords(),
		executedNodes,
		persistedState,
	};
}

describe("supervisor fast-route runtime routing", () => {
	let testRoot = "";
	let testRunsDir = "";

	beforeEach(() => {
		testRoot = mkdtempSync(join(tmpdir(), "hatch-supervisor-fast-route-"));
		testRunsDir = join(testRoot, ".hatch", "runs");
		mkdirSync(testRunsDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testRoot, { recursive: true, force: true });
	});

	it("terminates on bug fast-route when open bugs remain and persists fast_route.* telemetry", async () => {
		const result = await runScenario({
			runId: "supervisor-fast-route-open",
			hasOpenBugsFast: true,
			hasOpenBugsAfterFast: true,
			runsDir: testRunsDir,
		});

		const fastRouteEvent = result.events.find((event) => event.kind === "fast-route.branch");
		expect(fastRouteEvent?.edgeFrom).toBe("bug_fast_gate");
		expect(fastRouteEvent?.edgeTo).toBe("fast_route_telemetry_open");
		expect(fastRouteEvent?.data).toMatchObject({
			"fast_route.last_gate": "bug_fast_gate",
			"fast_route.branch": "fast_route_telemetry_open",
			"fast_route.has_open_bugs": "true",
		});

		expect(result.persistedState.context["fast_route.last_gate"]).toBe("bug_fast_gate");
		expect(result.persistedState.context["fast_route.branch"]).toBe("fast_route_telemetry_open");
		expect(result.persistedState.context["fast_route.has_open_bugs"]).toBe("true");

		const openBugExecutionSequence = result.executedNodes.filter((nodeId) =>
			["snapshot_state_fast", "evaluate_open_bug_gate_fast", "supervisor_review_bug_fast"].includes(nodeId),
		);
		expect(openBugExecutionSequence).toEqual([
			"snapshot_state_fast",
			"evaluate_open_bug_gate_fast",
			"supervisor_review_bug_fast",
		]);
		expectOrderedSubsequence(result.executedNodes, [
			"snapshot_state_fast",
			"evaluate_open_bug_gate_fast",
			"supervisor_review_bug_fast",
		]);

		const persistedNodeIds = result.persistedState.records.map((record) => record.nodeId);
		expectOrderedSubsequence(persistedNodeIds, [
			"snapshot_state_fast",
			"evaluate_open_bug_gate_fast",
			"supervisor_review_bug_fast",
		]);

		expect(result.records.some((record) => record.nodeId === "spawn_goal_execute")).toBe(false);
		expect(result.records.some((record) => record.nodeId === "recovery_sweep_runtime")).toBe(false);
	}, 30_000);

	it("routes clean fast-route branch into maintenance flow without running supervisor bug review", async () => {
		const result = await runScenario({
			runId: "supervisor-fast-route-clear",
			hasOpenBugsFast: false,
			hasOpenBugsAfterFast: false,
			runsDir: testRunsDir,
		});

		const fastRouteEvent = result.events.find((event) => event.kind === "fast-route.branch");
		expect(fastRouteEvent?.edgeTo).toBe("fast_route_telemetry_clear");
		expect(fastRouteEvent?.data).toMatchObject({
			"fast_route.last_gate": "bug_fast_gate",
			"fast_route.branch": "fast_route_telemetry_clear",
			"fast_route.has_open_bugs": "false",
		});

		expect(result.records.some((record) => record.nodeId === "supervisor_review_bug_fast")).toBe(false);
		expect(result.records.some((record) => record.nodeId === "spawn_goal_execute")).toBe(false);
		expect(result.records.some((record) => record.nodeId === "recovery_sweep_runtime")).toBe(true);
		expectOrderedSubsequence(result.executedNodes, ["bug_fast_gate", "recovery_sweep_runtime"]);
	}, 30_000);
});
