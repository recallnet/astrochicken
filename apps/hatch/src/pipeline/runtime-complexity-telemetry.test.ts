import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus, type Event } from "@recallnet/factory-telemetry";
import { describe, expect, it } from "vitest";

import { Context, StageStatus } from "./context.js";
import { Engine, HandlerRegistry } from "./engine.js";
import { parse } from "./parse.js";
import { createTraceHandler, type TraceEntry } from "./trace.js";
import {
	DEFAULT_COMPLEXITY_OTEL_KEY,
	DEFAULT_COMPLEXITY_CLASS,
	DEFAULT_COMPLEXITY_REASON,
} from "../complexity/telemetry.js";

function readTraceEntries(tracePath: string): TraceEntry[] {
	const raw = readFileSync(tracePath, "utf-8").trim();
	if (!raw) return [];
	return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

describe("runtime stage.finish complexity telemetry", () => {
	it("preserves estimator payload through event bus and trace handler", async () => {
		const graph = parse(`
	digraph complexity_finish {
		start [shape=Mdiamond]
		run [type="tool"]
		done [shape=Msquare]

		start -> run -> done
	}
		`);

		const registry = new HandlerRegistry();
		registry.register("tool", {
			async execute() {
				return {
					status: StageStatus.Completed,
					output: JSON.stringify({
						complexity_class: "medium",
						signals: {
							diff_size: {
								value: "medium",
								reason: "line_change_total=120",
								score: 1,
								_unknown: false,
							},
							sensitive_paths: {
								value: "false",
								reason: "no_sensitive_paths",
								score: 0,
								_unknown: false,
							},
						},
						reason: "class=medium;score=3;top=diff_size:medium",
						otel_dimension_key: "hatch.complexity.class",
					}),
					contextUpdates: {
						complexity_class: "medium",
						complexity_reason: "class=medium;score=3;top=diff_size:medium",
						complexity_otel_key: "hatch.complexity.class",
					},
				};
			},
		});

		const events: Event[] = [];
		const bus = new EventBus();
		bus.on((event) => events.push(event));

		const traceDir = mkdtempSync(join(tmpdir(), "hatch-trace-complexity-"));
		const tracePath = join(traceDir, "events.jsonl");
		bus.on(createTraceHandler(tracePath));

		const engine = new Engine(graph, registry, { eventBus: bus, context: new Context() });
		await engine.run();

		const finishEvent = events.find((event) => event.kind === "stage.finish" && event.nodeId === "run");
		expect(finishEvent?.data?.complexity_class).toBe("medium");
		expect(finishEvent?.data?.complexity_reason).toContain("class=medium");
		expect(finishEvent?.data?.complexity_otel_key).toBe("hatch.complexity.class");
		expect(finishEvent?.data?.["hatch.complexity.class"]).toBe("medium");
		expect(finishEvent?.data?.complexity_signals).toBeDefined();
		expect(JSON.parse(String(finishEvent?.data?.complexity_signals))).toEqual({
			diff_size: {
				value: "medium",
				reason: "line_change_total=120",
				score: 1,
				_unknown: false,
			},
			sensitive_paths: {
				value: "false",
				reason: "no_sensitive_paths",
				score: 0,
				_unknown: false,
			},
		});
		expect(finishEvent?.data?.["hatch.execution.path"]).toBe("moderate");
		expect(finishEvent?.data?.path_taken).toBe("moderate");
		expect(finishEvent?.data?.["hatch.merge.resolver"]).toBe("unknown");
		expect(finishEvent?.data?.["complexity_signal.diff_size"]).toBe("medium");
		expect(finishEvent?.data?.["complexity_signal.diff_size.reason"]).toBe("line_change_total=120");
		expect(finishEvent?.data?.["complexity_signal.diff_size.score"]).toBe("1");
		expect(finishEvent?.data?.["complexity_signal.diff_size._unknown"]).toBe("false");
		expect(finishEvent?.data?.["complexity_signal.sensitive_paths"]).toBe("false");

		const traceEntries = readTraceEntries(tracePath);
		const traceFinish = traceEntries.find((entry) => entry.kind === "stage.finish" && entry.nodeId === "run");
		expect(traceFinish?.data?.complexity_class).toBe("medium");
		expect(traceFinish?.dimensions?.["hatch.complexity.class"]).toBe("medium");
		expect(traceFinish?.dimensions?.["hatch.execution.path"]).toBe("moderate");
		expect(traceFinish?.dimensions?.path_taken).toBe("moderate");
	});

	it("preserves prior estimator telemetry when later nodes emit unrelated reason/signals payloads", async () => {
		const graph = parse(`
	digraph complexity_multi_node {
		start [shape=Mdiamond]
		estimator [type="tool"]
		consumer [type="tool"]
		done [shape=Msquare]

		start -> estimator -> consumer -> done
	}
		`);

		const registry = new HandlerRegistry();
		let call = 0;
		registry.register("tool", {
			async execute() {
				call += 1;
				if (call === 1) {
					return {
						status: StageStatus.Completed,
						output: JSON.stringify({
							complexity_class: "low",
							signals: {
								diff_size: "small",
								file_count: "small",
							},
							reason: "class=low;score=1;top=diff_size:small",
							otel_dimension_key: "hatch.complexity.class",
						}),
						contextUpdates: {
							complexity_class: "low",
							complexity_signals: JSON.stringify({ diff_size: "small", file_count: "small" }),
							complexity_reason: "class=low;score=1;top=diff_size:small",
							complexity_otel_key: "hatch.complexity.class",
						},
					};
				}
				return {
					status: StageStatus.Completed,
					output: JSON.stringify({
						reason: "generic_non_estimator_reason",
						signals: {
							not_complexity: "true",
						},
					}),
				};
			},
		});

		const events: Event[] = [];
		const bus = new EventBus();
		bus.on((event) => events.push(event));

		const traceDir = mkdtempSync(join(tmpdir(), "hatch-trace-complexity-multi-"));
		const tracePath = join(traceDir, "events.jsonl");
		bus.on(createTraceHandler(tracePath));

		const engine = new Engine(graph, registry, { eventBus: bus, context: new Context() });
		await engine.run();

		const finishConsumer = events.find((event) => event.kind === "stage.finish" && event.nodeId === "consumer");
		expect(finishConsumer?.data?.complexity_class).toBe("low");
		expect(finishConsumer?.data?.["hatch.execution.path"]).toBe("fast");
		expect(finishConsumer?.data?.path_taken).toBe("fast");
		expect(finishConsumer?.data?.complexity_reason).toBe("class=low;score=1;top=diff_size:small");
		expect(finishConsumer?.data?.["complexity_signal.diff_size"]).toBe("small");
		expect(finishConsumer?.data?.["complexity_signal.file_count"]).toBe("small");
		expect(finishConsumer?.data?.["complexity_signal.not_complexity"]).toBeUndefined();

		const traceEntries = readTraceEntries(tracePath);
		const traceConsumer = traceEntries.find((entry) => entry.kind === "stage.finish" && entry.nodeId === "consumer");
		expect(traceConsumer?.data?.complexity_class).toBe("low");
		expect(traceConsumer?.dimensions?.["hatch.complexity.class"]).toBe("low");
		expect(traceConsumer?.dimensions?.["hatch.execution.path"]).toBe("fast");
		expect(traceConsumer?.dimensions?.path_taken).toBe("fast");
	});

	it("emits hatch.execution.path from actual routed branch taken, not heuristic-only fallback", async () => {
		const graph = parse(`
	digraph complexity_branch_routing {
		start [shape=Mdiamond]
		estimate [type="tool"]
		route [type="tool"]
		fast_path [type="tool"]
		full_path [type="tool"]
		done [shape=Msquare]

		start -> estimate -> route
		route -> fast_path [condition="complexity_class=fast" label="fast"]
		route -> full_path [condition="complexity_class!=fast" label="full"]
		fast_path -> done
		full_path -> done
	}
		`);

		const registry = new HandlerRegistry();
		registry.register("tool", {
			async execute(_signal, node) {
				if (node.id === "estimate") {
					return {
						status: StageStatus.Completed,
						output: JSON.stringify({ complexity_class: "fast" }),
						contextUpdates: {
							complexity_class: "fast",
							path_taken: "full",
						},
					};
				}
				if (node.id === "route") {
					return { status: StageStatus.Completed, output: "routed" };
				}
				if (node.id === "fast_path") {
					return {
						status: StageStatus.Completed,
						output: "fast",
					};
				}
				return {
					status: StageStatus.Completed,
					output: "full",
				};
			},
		});

		const events: Event[] = [];
		const bus = new EventBus();
		bus.on((event) => events.push(event));
		const engine = new Engine(graph, registry, { eventBus: bus, context: new Context() });
		await engine.run();

		const selectedEdge = events.find((event) => event.kind === "edge.selected" && event.edgeFrom === "route");
		expect(selectedEdge?.edgeTo).toBe("fast_path");
		expect(selectedEdge?.data?.path_taken).toBe("fast");
		expect(selectedEdge?.data?.["hatch.execution.path"]).toBe("fast");

		const routeContextUpdate = events.find((event) => event.kind === "context.update" && event.nodeId === "route");
		expect(routeContextUpdate?.data?.path_taken).toBe("fast");
		expect(routeContextUpdate?.data?.["hatch.execution.path"]).toBe("fast");

		const fastFinish = events.find((event) => event.kind === "stage.finish" && event.nodeId === "fast_path");
		expect(fastFinish?.data?.path_taken).toBe("fast");
		expect(fastFinish?.data?.["hatch.execution.path"]).toBe("fast");
	});

	it("keeps explicit path_taken telemetry from outcome payloads when no routing edge was selected", async () => {
		const graph = parse(`
	digraph complexity_explicit_path {
		start [shape=Mdiamond]
		run [type="tool"]
		done [shape=Msquare]

		start -> run -> done
	}
		`);

		const registry = new HandlerRegistry();
		registry.register("tool", {
			async execute() {
				return {
					status: StageStatus.Completed,
					output: JSON.stringify({
						complexity_class: "high",
						path_taken: "moderate",
						"hatch.execution.path": "moderate",
					}),
					contextUpdates: {
						complexity_class: "high",
						path_taken: "moderate",
						"hatch.execution.path": "moderate",
					},
				};
			},
		});

		const events: Event[] = [];
		const bus = new EventBus();
		bus.on((event) => events.push(event));
		const engine = new Engine(graph, registry, { eventBus: bus, context: new Context() });
		await engine.run();

		const finishEvent = events.find((event) => event.kind === "stage.finish" && event.nodeId === "run");
		expect(finishEvent?.data?.path_taken).toBe("moderate");
		expect(finishEvent?.data?.["hatch.execution.path"]).toBe("moderate");
	});

	it("emits deterministic defaults when estimator payload is absent", async () => {
		const graph = parse(`
	digraph complexity_default {
		start [shape=Mdiamond]
		run [type="tool"]
		done [shape=Msquare]

		start -> run -> done
	}
		`);

		const registry = new HandlerRegistry();
		registry.register("tool", {
			async execute() {
				return {
					status: StageStatus.Completed,
					output: "ok",
				};
			},
		});

		const events: Event[] = [];
		const bus = new EventBus();
		bus.on((event) => events.push(event));
		const traceDir = mkdtempSync(join(tmpdir(), "hatch-trace-complexity-default-"));
		const tracePath = join(traceDir, "events.jsonl");
		bus.on(createTraceHandler(tracePath));

		const engine = new Engine(graph, registry, { eventBus: bus, context: new Context() });
		await engine.run();

		const finishEvent = events.find((event) => event.kind === "stage.finish" && event.nodeId === "run");
		expect(finishEvent?.data?.complexity_class).toBe(DEFAULT_COMPLEXITY_CLASS);
		expect(finishEvent?.data?.complexity_reason).toBe(DEFAULT_COMPLEXITY_REASON);
		expect(finishEvent?.data?.complexity_otel_key).toBe(DEFAULT_COMPLEXITY_OTEL_KEY);
		expect(finishEvent?.data?.[DEFAULT_COMPLEXITY_OTEL_KEY]).toBe(DEFAULT_COMPLEXITY_CLASS);
		expect(finishEvent?.data?.["hatch.execution.path"]).toBe("full");
		expect(finishEvent?.data?.path_taken).toBe("full");

		const traceEntries = readTraceEntries(tracePath);
		const traceFinish = traceEntries.find((entry) => entry.kind === "stage.finish" && entry.nodeId === "run");
		expect(traceFinish?.dimensions?.[DEFAULT_COMPLEXITY_OTEL_KEY]).toBe(DEFAULT_COMPLEXITY_CLASS);
		expect(traceFinish?.dimensions?.["hatch.execution.path"]).toBe("full");
		expect(traceFinish?.dimensions?.path_taken).toBe("full");
	});
});
