import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus, type Event } from "@recallnet/factory-telemetry";
import { describe, expect, it } from "vitest";

import { Context, StageStatus } from "./context.js";
import { Engine, HandlerRegistry } from "./engine.js";
import { parse } from "./parse.js";
import { createTraceHandler, type TraceEntry } from "./trace.js";

function readTraceEntries(tracePath: string): TraceEntry[] {
	const raw = readFileSync(tracePath, "utf-8").trim();
	if (!raw) return [];
	return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function stageEvents(events: Event[], nodeId: string): Event[] {
	return events.filter(
		(event) =>
			event.nodeId === nodeId
			&& (event.kind === "stage.start" || event.kind === "stage.finish" || event.kind === "stage.error"),
	);
}

function qualityEvents(events: Event[], nodeId: string): Event[] {
	return events.filter((event) => event.nodeId === nodeId && event.kind === "quality.signal");
}

function stageEntries(entries: TraceEntry[], nodeId: string): TraceEntry[] {
	return entries.filter(
		(entry) =>
			entry.nodeId === nodeId
			&& (entry.kind === "stage.start" || entry.kind === "stage.finish" || entry.kind === "stage.error"),
	);
}

describe("runtime trust partition telemetry wall", () => {
	it("keeps retry lifecycle events partitioned with trust envelope", async () => {
		const graph = parse(`
	digraph trust_partition_retry {
		start [shape=Mdiamond]
		builder_retry [type="tool" tool_id="shell" trust_role="mothership.local.tool" max_retries="2"]
		judge_retry [type="codergen" judge="true" trust_role="mothership.local.judge" agent_role="unknown" max_retries="2"]
		done [shape=Msquare]

		start -> builder_retry -> judge_retry -> done
	}
		`);

		let builderAttempts = 0;
		let judgeAttempts = 0;
		const registry = new HandlerRegistry();
		registry.register("tool", {
			async execute() {
				builderAttempts += 1;
				if (builderAttempts === 1) throw new Error("builder retry");
				return { status: StageStatus.Completed, output: "builder-ok" };
			},
		});
		registry.register("codergen", {
			async execute(_signal, node) {
				if (node.id !== "judge_retry") return { status: StageStatus.Completed, output: "ok" };
				judgeAttempts += 1;
				if (judgeAttempts === 1) throw new Error("judge retry");
				return { status: StageStatus.Completed, output: "judge-ok" };
			},
		});

		const events: Event[] = [];
		const bus = new EventBus();
		bus.on((event) => events.push(event));

		const traceDir = mkdtempSync(join(tmpdir(), "hatch-trace-trust-retry-"));
		const tracePath = join(traceDir, "events.jsonl");
		bus.on(createTraceHandler(tracePath));

		const engine = new Engine(graph, registry, { eventBus: bus, context: new Context() });
		await engine.run();

		const retryEvents = events.filter((event) => event.kind === "stage.retry");
		expect(retryEvents).toHaveLength(2);

		const builderRetry = retryEvents.find((event) => event.nodeId === "builder_retry");
		expect(builderRetry?.traceId).toMatch(/^builder-\d{6}$/);
		expect(builderRetry?.data?.attempt).toBe("2");
		expect(builderRetry?.data?.trust_partition).toBe("builder");
		expect(builderRetry?.data?.trust_partition_key).toBe("builder/mothership.local.tool");
		expect(builderRetry?.data?.trust_role).toBe("mothership.local.tool");
		expect(builderRetry?.data?.agent_id).toBe("tool.shell");
		expect(builderRetry?.data?.agent_role).toBe("tool.operator");

		const judgeRetry = retryEvents.find((event) => event.nodeId === "judge_retry");
		expect(judgeRetry?.traceId).toMatch(/^judge-\d{6}$/);
		expect(judgeRetry?.data?.attempt).toBe("2");
		expect(judgeRetry?.data?.trust_partition).toBe("judge");
		expect(judgeRetry?.data?.trust_partition_key).toBe("judge/mothership.local.judge");
		expect(judgeRetry?.data?.trust_role).toBe("mothership.local.judge");
		expect(judgeRetry?.data?.agent_id).toBeUndefined();
		expect(judgeRetry?.data?.agent_role).toBeUndefined();

		const retryEntries = readTraceEntries(tracePath).filter((entry) => entry.kind === "stage.retry");
		expect(retryEntries).toHaveLength(2);
		const builderRetryTrace = retryEntries.find((entry) => entry.nodeId === "builder_retry");
		expect(builderRetryTrace?.traceId).toMatch(/^builder-\d{6}$/);
		expect(builderRetryTrace?.data?.trust_partition_key).toBe("builder/mothership.local.tool");
		expect(builderRetryTrace?.data?.agent_id).toBe("tool.shell");

		const judgeRetryTrace = retryEntries.find((entry) => entry.nodeId === "judge_retry");
		expect(judgeRetryTrace?.traceId).toMatch(/^judge-\d{6}$/);
		expect(judgeRetryTrace?.data?.trust_partition_key).toBe("judge/mothership.local.judge");
		expect(judgeRetryTrace?.data?.agent_id).toBeUndefined();

		const builderQuality = qualityEvents(events, "builder_retry");
		expect(builderQuality).toHaveLength(2);
		expect(builderQuality.some((event) => event.data?.quality_outcome === "fail")).toBe(true);
		const builderRetriedPass = builderQuality.find((event) => event.data?.quality_outcome === "pass");
		expect(builderRetriedPass?.data?.quality_attempt).toBe("2");
		expect(builderRetriedPass?.data?.quality_score).toBe("0.90");
		expect(builderRetriedPass?.data?.quality_reason).toContain("retries=1:-0.10");
		expect(builderRetriedPass?.data?.quality_guard_state).toBe("closed");
		expect(builderRetriedPass?.traceId).toMatch(/^builder-\d{6}$/);

		const judgeQuality = qualityEvents(events, "judge_retry");
		expect(judgeQuality).toHaveLength(2);
		expect(judgeQuality.some((event) => event.data?.quality_outcome === "fail")).toBe(true);
		const judgeRetriedPass = judgeQuality.find((event) => event.data?.quality_outcome === "pass");
		expect(judgeRetriedPass?.data?.quality_attempt).toBe("2");
		expect(judgeRetriedPass?.data?.quality_score).toBe("0.90");
		expect(judgeRetriedPass?.data?.quality_reason).toContain("retries=1:-0.10");
		expect(judgeRetriedPass?.traceId).toMatch(/^judge-\d{6}$/);
	});
	it("separates builder/judge traces with deterministic partition metadata", async () => {
		const graph = parse(`
	digraph trust_partition_split {
		start [shape=Mdiamond]
		builder_step [type="tool" tool_id="shell" trust_role="mothership.local.tool"]
		judge_step [type="codergen" judge="true" trust_role="mothership.local.judge" agent_role="unknown"]
		done [shape=Msquare]

		start -> builder_step -> judge_step -> done
	}
		`);

		const registry = new HandlerRegistry();
		registry.register("tool", {
			async execute() {
				return {
					status: StageStatus.Completed,
					output: "builder-ok",
					contextUpdates: {
						builder_secret: "only-builder",
					},
				};
			},
		});
		registry.register("codergen", {
			async execute(_signal, node) {
				if (node.id === "judge_step") {
					return {
						status: StageStatus.Completed,
						output: "judge-ok",
						contextUpdates: {
							judge_secret: "only-judge",
						},
					};
				}
				return { status: StageStatus.Completed, output: "ok" };
			},
		});

		const events: Event[] = [];
		const bus = new EventBus();
		bus.on((event) => events.push(event));

		const traceDir = mkdtempSync(join(tmpdir(), "hatch-trace-trust-partition-"));
		const tracePath = join(traceDir, "events.jsonl");
		bus.on(createTraceHandler(tracePath));

		const engine = new Engine(graph, registry, { eventBus: bus, context: new Context() });
		await engine.run();

		const traceEntries = readTraceEntries(tracePath);

		const builderEvents = stageEvents(events, "builder_step");
		expect(builderEvents.length).toBeGreaterThanOrEqual(2);
		for (const event of builderEvents) {
			expect(event.data?.trust_partition).toBe("builder");
			expect(event.data?.trust_domain).toBe("builder");
			expect(event.data?.trust_partition_key).toBe("builder/mothership.local.tool");
			expect(event.traceId).toMatch(/^builder-\d{6}$/);
			expect(event.data?.judge_secret).toBeUndefined();
		}

		const judgeEvents = stageEvents(events, "judge_step");
		expect(judgeEvents.length).toBeGreaterThanOrEqual(2);
		for (const event of judgeEvents) {
			expect(event.data?.trust_partition).toBe("judge");
			expect(event.data?.trust_domain).toBe("judge");
			expect(event.data?.trust_partition_key).toBe("judge/mothership.local.judge");
			expect(event.traceId).toMatch(/^judge-\d{6}$/);
			expect(event.data?.builder_secret).toBeUndefined();
		}

		const builderTraceEntries = stageEntries(traceEntries, "builder_step");
		expect(builderTraceEntries.length).toBeGreaterThanOrEqual(2);
		for (const entry of builderTraceEntries) {
			expect(entry.data?.trust_partition).toBe("builder");
			expect(entry.data?.trust_partition_key).toBe("builder/mothership.local.tool");
			expect(entry.traceId).toMatch(/^builder-\d{6}$/);
			expect(entry.data?.judge_secret).toBeUndefined();
		}

		const judgeTraceEntries = stageEntries(traceEntries, "judge_step");
		expect(judgeTraceEntries.length).toBeGreaterThanOrEqual(2);
		for (const entry of judgeTraceEntries) {
			expect(entry.data?.trust_partition).toBe("judge");
			expect(entry.data?.trust_partition_key).toBe("judge/mothership.local.judge");
			expect(entry.traceId).toMatch(/^judge-\d{6}$/);
			expect(entry.data?.builder_secret).toBeUndefined();
		}
	});

	it("propagates guard circuit state into quality signal metadata", async () => {
		const graph = parse(`
	digraph trust_partition_guard_quality {
		start [shape=Mdiamond]
		guard_probe [type="tool" tool_id="shell"]
		done [shape=Msquare]

		start -> guard_probe -> done
	}
		`);

		const registry = new HandlerRegistry();
		registry.register("tool", {
			async execute() {
				return { status: StageStatus.Completed, output: "ok" };
			},
		});

		const openEvents: Event[] = [];
		const openBus = new EventBus();
		openBus.on((event) => openEvents.push(event));
		const openEngine = new Engine(graph, registry, {
			eventBus: openBus,
			context: new Context({ guard_circuit_state: "open" }),
		});
		await openEngine.run();

		const openQuality = qualityEvents(openEvents, "guard_probe");
		expect(openQuality).toHaveLength(1);
		expect(openQuality[0].data?.quality_guard_state).toBe("guarded");
		expect(openQuality[0].data?.quality_score).toBe("0.70");

		const terminalEvents: Event[] = [];
		const terminalBus = new EventBus();
		terminalBus.on((event) => terminalEvents.push(event));
		const terminalEngine = new Engine(graph, registry, {
			eventBus: terminalBus,
			context: new Context({ guard_circuit_state: "terminal" }),
		});
		await terminalEngine.run();

		const terminalQuality = qualityEvents(terminalEvents, "guard_probe");
		expect(terminalQuality).toHaveLength(1);
		expect(terminalQuality[0].data?.quality_guard_state).toBe("guarded_terminal");
		expect(terminalQuality[0].data?.quality_grade).toBe("medium");
	});

	it("maintains partition wall across long-running sessions", async () => {
		const graph = parse(`
	digraph trust_partition_long_session {
		start [shape=Mdiamond]
		builder_a [type="tool" tool_id="shell" trust_role="mothership.local.tool"]
		judge_a [type="codergen" judge="true" trust_role="mothership.local.judge" agent_role="unknown"]
		builder_b [type="tool" tool_id="shell" trust_role="mothership.local.tool"]
		judge_b [type="codergen" judge="true" trust_role="mothership.local.judge" agent_role="unknown"]
		builder_c [type="tool" tool_id="shell" trust_role="mothership.local.tool"]
		judge_c [type="codergen" judge="true" trust_role="mothership.local.judge" agent_role="unknown"]
		done [shape=Msquare]

		start -> builder_a -> judge_a -> builder_b -> judge_b -> builder_c -> judge_c -> done
	}
		`);

		const registry = new HandlerRegistry();
		registry.register("tool", {
			async execute() {
				return { status: StageStatus.Completed, output: "builder" };
			},
		});
		registry.register("codergen", {
			async execute() {
				return { status: StageStatus.Completed, output: "judge" };
			},
		});

		const events: Event[] = [];
		const bus = new EventBus();
		bus.on((event) => events.push(event));

		const traceDir = mkdtempSync(join(tmpdir(), "hatch-trace-trust-long-"));
		const tracePath = join(traceDir, "events.jsonl");
		bus.on(createTraceHandler(tracePath));

		const engine = new Engine(graph, registry, { eventBus: bus, context: new Context() });
		await engine.run();

		const lifecycle = events.filter(
			(event) => event.kind === "stage.start" || event.kind === "stage.finish" || event.kind === "stage.error",
		);
		expect(lifecycle.length).toBe(12);

		const builderTraceIds = lifecycle
			.filter((event) => event.data?.trust_partition === "builder")
			.map((event) => event.traceId || "");
		const judgeTraceIds = lifecycle
			.filter((event) => event.data?.trust_partition === "judge")
			.map((event) => event.traceId || "");

		expect(builderTraceIds.length).toBe(6);
		expect(judgeTraceIds.length).toBe(6);
		expect(builderTraceIds.every((traceId) => /^builder-\d{6}$/.test(traceId))).toBe(true);
		expect(judgeTraceIds.every((traceId) => /^judge-\d{6}$/.test(traceId))).toBe(true);

		const uniqueBuilderTraceIds = new Set(builderTraceIds);
		const uniqueJudgeTraceIds = new Set(judgeTraceIds);
		expect(uniqueBuilderTraceIds.size).toBe(3);
		expect(uniqueJudgeTraceIds.size).toBe(3);

		const overlap = [...uniqueBuilderTraceIds].filter((traceId) => uniqueJudgeTraceIds.has(traceId));
		expect(overlap).toEqual([]);

		const traceEntries = readTraceEntries(tracePath).filter(
			(entry) => entry.kind === "stage.start" || entry.kind === "stage.finish" || entry.kind === "stage.error",
		);
		expect(traceEntries.length).toBe(12);
		expect(
			traceEntries.every((entry) => {
				if (entry.data?.trust_partition === "judge") {
					return /^judge-\d{6}$/.test(String(entry.traceId || ""));
				}
				return /^builder-\d{6}$/.test(String(entry.traceId || ""));
			}),
		).toBe(true);
	});
});
