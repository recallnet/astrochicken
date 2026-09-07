import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { EventBus, type Event } from "@recallnet/factory-telemetry";
import { afterEach, describe, expect, it } from "vitest";

import { Context, type Outcome, StageStatus } from "./context.js";
import { Engine, HandlerRegistry, type Handler } from "./engine.js";
import { DynamicFanInHandler, DynamicFanOutHandler } from "./handler/fan_out_dynamic.js";
import { PipelineHandler } from "./handler/pipeline.js";
import { parse } from "./parse.js";
import { createRunState } from "./run.js";

import type { Graph, Node } from "./graph.js";
import type { HandlerConfig } from "./handler/register.js";

const FIXTURE_ROOT = new URL("./fixtures/transition-convergence/", import.meta.url);

function fixturePath(name: string): string {
	return fileURLToPath(new URL(name, FIXTURE_ROOT));
}

function parseFixture(name: string): Graph {
	return parse(readFileSync(new URL(name, FIXTURE_ROOT), "utf8"));
}

function baseHandlerConfig(args: {
	workDir: string;
	graph: Graph;
	runId: string;
	pipelineFile: string;
	eventBus?: EventBus;
}): HandlerConfig {
	return {
		modelRegistry: {} as any,
		authStorage: {} as any,
		resourceLoader: {} as any,
		defaultModel: "test-model",
		defaultProvider: "test-provider",
		workDir: args.workDir,
		graph: args.graph,
		runState: createRunState(args.runId, args.pipelineFile),
		pipelineFile: args.pipelineFile,
		eventBus: args.eventBus,
	};
}

class EdgeSelectionToolHandler implements Handler {
	async execute(
		_signal: AbortSignal,
		node: Node,
		_ctx: Context,
	): Promise<Outcome> {
		switch (node.id) {
			case "phase_preferred":
				return {
					status: StageStatus.Completed,
					output: "phase_preferred",
					preferredLabel: "take_right",
				};
			case "phase_suggested":
				return {
					status: StageStatus.Completed,
					output: "phase_suggested",
					suggestedNextNodes: ["suggested_beta"],
				};
			default:
				return { status: StageStatus.Completed, output: node.id };
		}
	}
}

class RetryExhaustionToolHandler implements Handler {
	calls = 0;

	async execute(
		_signal: AbortSignal,
		node: Node,
		ctx: Context,
	): Promise<Outcome> {
		this.calls += 1;
		const retryRequest = Number.parseInt(ctx.get("retry_request") || "0", 10) || 0;
		ctx.set("retry_request", String(retryRequest + 1));
		ctx.set("retry_attempt", String(this.calls));
		throw new Error(`child_retries_exhausted node=${node.id} attempt=${this.calls}`);
	}
}

class NormalizeCompositeChildResultToolHandler implements Handler {
	async execute(
		_signal: AbortSignal,
		node: Node,
		ctx: Context,
	): Promise<Outcome> {
		if (node.id !== "normalize") {
			return { status: StageStatus.Completed, output: "noop" };
		}

		const reason = ctx.get("__composite_reason") || "child_failed";
		const childId = ctx.get("__composite_child_id");
		const childIndexMatch = childId.match(/__item_(\d+)$/);
		const childIndex = childIndexMatch ? childIndexMatch[1] : "0";
		const childStatus = reason === "child_timeout"
			? "timeout"
			: reason === "child_aborted"
				? "aborted"
				: "failed";

		return {
			status: StageStatus.Completed,
			output: JSON.stringify({
				child_result: reason,
				child_status: childStatus,
				child_index: childIndex,
			}),
		};
	}
}

function visitedNodeIds(engine: Engine): Set<string> {
	return new Set(engine.getRecords().map((record) => record.nodeId));
}

describe("engine transition/convergence contract", () => {
	afterEach(() => {
		delete process.env.HATCH_RUN_HEARTBEAT_MS;
	});

	it("enforces the documented 5-step edge selection ordering plus no-match failure path", async () => {
		// docs/state-machines.md contract anchor: edge selection precedence is
		// condition filtering -> preferred label -> suggested next node -> weight
		// -> lexical target-node tiebreak.
		const graph = parseFixture("edge-selection-order.dot");
		const registry = new HandlerRegistry();
		registry.register("tool", new EdgeSelectionToolHandler());

		const orderedEngine = new Engine(graph, registry, {
			context: new Context({
				scenario: "ordered",
				condition_route: "selected",
				preferred_gate: "true",
				suggested_gate: "true",
				weight_gate: "true",
				lexical_gate: "true",
			}),
		});
		await orderedEngine.run();

		const orderedVisited = visitedNodeIds(orderedEngine);
		expect(orderedEngine.getContext().get("phase_condition_pick")).toBe("condition_selected");
		expect(orderedEngine.getContext().get("phase_preferred_pick")).toBe("preferred_right");
		expect(orderedEngine.getContext().get("phase_suggested_pick")).toBe("suggested_beta");
		expect(orderedEngine.getContext().get("phase_weight_pick")).toBe("weight_high");
		expect(orderedEngine.getContext().get("phase_lexical_pick")).toBe("lexical_a");
		expect(orderedVisited.has("condition_wrong")).toBe(false);
		expect(orderedVisited.has("preferred_left")).toBe(false);
		expect(orderedVisited.has("suggested_alpha")).toBe(false);
		expect(orderedVisited.has("weight_low")).toBe(false);
		expect(orderedVisited.has("lexical_z")).toBe(false);

		const noMatchEngine = new Engine(graph, registry, {
			context: new Context({ scenario: "no_match" }),
		});
		await expect(noMatchEngine.run()).rejects.toThrow(/no matching edges/i);
	});

	it("applies bounded max_retries and records retry metadata until exhaustion", async () => {
		// docs/state-machines.md contract anchor: retries are bounded and
		// deterministic; exhaustion is terminal for the node.
		const graph = parseFixture("retry-exhaustion.dot");
		const bus = new EventBus();
		const events: Event[] = [];
		bus.on((event) => events.push(event));

		const retryHandler = new RetryExhaustionToolHandler();
		const registry = new HandlerRegistry();
		registry.register("tool", retryHandler);

		const engine = new Engine(graph, registry, {
			context: new Context(),
			eventBus: bus,
		});

		await expect(engine.run()).rejects.toThrow(/after 3 attempts: child_retries_exhausted/i);
		expect(retryHandler.calls).toBe(3);
		expect(engine.getContext().get("retry_request")).toBe("3");
		expect(engine.getContext().get("retry_attempt")).toBe("3");

		const retryNodeRecords = engine.getRecords().filter((record) => record.nodeId === "retry_node");
		expect(retryNodeRecords.map((record) => record.attempt)).toEqual([1, 2, 3]);
		expect(retryNodeRecords.every((record) => record.status === StageStatus.Failed)).toBe(true);

		const retryEvents = events.filter((event) => event.kind === "stage.retry" && event.nodeId === "retry_node");
		expect(retryEvents).toHaveLength(2);
		expect(retryEvents.map((event) => event.data?.attempt)).toEqual(["2", "3"]);
	});

	it.each([
		{
			name: "child_failed",
			childTemplate: "child-terminal-case-failed.dot",
			expectedTerminal: "done_failed",
		},
		{
			name: "child_timeout",
			childTemplate: "child-terminal-case-timeout.dot",
			expectedTerminal: "done_timeout",
		},
		{
			name: "child_aborted",
			childTemplate: "child-terminal-case-aborted.dot",
			expectedTerminal: "done_aborted",
		},
	])( 
		"normalizes pipeline child terminal reason %s and halts on the configured terminal edge",
		async ({ name, childTemplate, expectedTerminal }) => {
			// docs/state-machines.md contract anchor: child terminal outcomes are
			// normalized and routed through deterministic terminal edges.
			const root = mkdtempSync(join(tmpdir(), "hatch-transition-child-"));
			try {
				const graph = parseFixture("child-terminal-normalization.dot");
				const pipelineConfig = baseHandlerConfig({
					workDir: root,
					graph,
					runId: `transition-child-${name}`,
					pipelineFile: join(root, "child-terminal-normalization.dot"),
				});

				const registry = new HandlerRegistry();
				if (name === "child_aborted") {
					registry.register("pipeline", {
						async execute(): Promise<Outcome> {
							return {
								status: StageStatus.Failed,
								output: "",
								error: "synthetic child aborted",
								contextUpdates: {
									__composite_reason: "child_aborted",
									__composite_child_id: "run_child__item_0",
									__composite_export_writeback_status: "skipped",
									__composite_export_writeback_reason: "child_aborted",
								},
							};
						},
					});
				} else {
					registry.register("pipeline", new PipelineHandler(pipelineConfig));
				}
				registry.register("tool", new NormalizeCompositeChildResultToolHandler());

				const engine = new Engine(graph, registry, {
					context: new Context({
						child_template: fixturePath(childTemplate),
					}),
				});
				await engine.run();

				const visited = visitedNodeIds(engine);
				expect(engine.getContext().get("child_result")).toBe(name);
				expect(engine.getContext().get("child_status")).not.toBe("");
				expect(engine.getContext().get("child_index")).toBe("0");
				expect(engine.getContext().get("__composite_reason")).toBe(name);
				expect(engine.getContext().get("__composite_export_writeback_status")).toBe("skipped");
				expect(engine.getContext().get("last_stage")).toBe(expectedTerminal);
				expect(engine.getRecords().at(-1)?.nodeId).toBe("normalize");
				expect(
					["done_failed", "done_timeout", "done_aborted"].filter((nodeId) => nodeId !== expectedTerminal)
						.every((nodeId) => !visited.has(nodeId)),
				).toBe(true);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		},
	);

	it("preserves fan-out/fan-in deterministic ordering and export indexing on success", async () => {
		// docs/state-machines.md contract anchor: fan-in consumes fan-out results
		// deterministically, preserving input-index ordering for exports.
		const root = mkdtempSync(join(tmpdir(), "hatch-transition-fan-success-"));
		try {
			const graph = parseFixture("fan-out-dynamic-fanin.dot");
			const config = baseHandlerConfig({
				workDir: root,
				graph,
				runId: "transition-fan-success",
				pipelineFile: join(root, "fan-out-dynamic-fanin.dot"),
			});

			const registry = new HandlerRegistry();
			registry.register("fan_out.dynamic", new DynamicFanOutHandler(config));
			registry.register("fan_in.dynamic", new DynamicFanInHandler());

			const engine = new Engine(graph, registry, {
				context: new Context({
					items: JSON.stringify(["slow", "fast"]),
					fan_child_template: fixturePath("fan-out-child-template.dot"),
				}),
			});
			await engine.run();

			const visited = visitedNodeIds(engine);
			expect(visited.has("fanin")).toBe(true);
			expect(engine.getContext().get("last_stage")).toBe("done_success");
			expect(engine.getRecords().at(-1)?.nodeId).toBe("fanin");
			expect(engine.getContext().get("fan_results")).toBe('["0","1"]');
			expect(engine.getContext().get("fanin_payload")).toBe('["0","1"]');
			expect(engine.getContext().get("alpha__0")).toBe("a0");
			expect(engine.getContext().get("zeta__0")).toBe("z0");
			expect(engine.getContext().get("alpha__1")).toBe("a1");
			expect(engine.getContext().get("zeta__1")).toBe("z1");

			const indexedExportKeys = Object.keys(engine.getContext().all()).filter(
				(key) => key === "alpha__0" || key === "zeta__0" || key === "alpha__1" || key === "zeta__1",
			);
			expect(indexedExportKeys).toEqual(["alpha__0", "zeta__0", "alpha__1", "zeta__1"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("propagates fan-out child failure deterministically and skips fan-in", async () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-transition-fan-fail-"));
		try {
			const graph = parseFixture("fan-out-dynamic-fanin.dot");
			const config = baseHandlerConfig({
				workDir: root,
				graph,
				runId: "transition-fan-fail",
				pipelineFile: join(root, "fan-out-dynamic-fanin.dot"),
			});

			const registry = new HandlerRegistry();
			registry.register("fan_out.dynamic", new DynamicFanOutHandler(config));
			registry.register("fan_in.dynamic", new DynamicFanInHandler());

			const engine = new Engine(graph, registry, {
				context: new Context({
					items: JSON.stringify(["ok", "fail", "slow"]),
					fan_child_template: fixturePath("fan-out-child-template-mixed.dot"),
				}),
			});
			await engine.run();

			const visited = visitedNodeIds(engine);
			expect(engine.getContext().get("last_stage")).toBe("done_fail");
			expect(engine.getRecords().at(-1)?.nodeId).toBe("fan");
			expect(visited.has("fanin")).toBe(false);
			expect(engine.getContext().get("__composite_reason")).toBe("child_failed");
			expect(engine.getContext().get("__fan_out_failure_index")).toBe("1");
			expect(engine.getContext().get("__composite_export_writeback_status")).toBe("skipped");
			expect(engine.getContext().get("alpha__0")).toBe("");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("prefers matching conditional edge over unconditional fallback from diamond node", async () => {
		// Regression: when a diamond has both a conditional edge (condition="route=yes")
		// and an unconditional fallback edge, both matched in step 1. The lexical
		// tiebreak then picked the wrong target (e.g. "advance_clean_attempt" over
		// "build_merged_results"). Conditional edges must win over unconditional ones.
		const graph = parseFixture("conditional-over-unconditional.dot");
		const handler = {
			async execute(_signal: AbortSignal, node: Node): Promise<Outcome> {
				return { status: StageStatus.Completed, output: node.id };
			},
		};
		const registry = new HandlerRegistry();
		registry.register("tool", handler);
		registry.register("conditional", handler);

		const engine = new Engine(graph, registry, {
			context: new Context({ route: "yes" }),
		});
		await engine.run();

		const visited = visitedNodeIds(engine);
		expect(visited.has("target_conditional")).toBe(true);
		expect(visited.has("fallback_advance")).toBe(false);
		expect(engine.getContext().get("gate_pick")).toBe("target_conditional");
	});

	it("takes unconditional fallback when no conditional edge matches from diamond", async () => {
		const graph = parseFixture("conditional-over-unconditional.dot");
		const handler = {
			async execute(_signal: AbortSignal, node: Node): Promise<Outcome> {
				return { status: StageStatus.Completed, output: node.id };
			},
		};
		const registry = new HandlerRegistry();
		registry.register("tool", handler);
		registry.register("conditional", handler);

		const engine = new Engine(graph, registry, {
			context: new Context({ route: "no" }),
		});
		await engine.run();

		const visited = visitedNodeIds(engine);
		expect(visited.has("fallback_advance")).toBe(true);
		expect(visited.has("target_conditional")).toBe(false);
		expect(engine.getContext().get("gate_pick")).toBe("fallback_advance");
	});
});
