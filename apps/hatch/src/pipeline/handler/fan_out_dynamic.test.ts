import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus, type Event } from "@recallnet/factory-telemetry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Context, StageStatus } from "../context.js";
import { parse } from "../parse.js";
import { createRunState } from "../run.js";
import { DynamicFanOutHandler } from "./fan_out_dynamic.js";

import type { Node } from "../graph.js";
import type { HandlerConfig } from "./register.js";

function baseConfig(args: { workDir: string; eventBus: EventBus; runsDir: string }): HandlerConfig {
	return {
		modelRegistry: {} as any,
		authStorage: {} as any,
		resourceLoader: {} as any,
		defaultModel: "test-model",
		defaultProvider: "test-provider",
		workDir: args.workDir,
		graph: parse(`digraph parent { start [shape=Mdiamond] fan [type="fan_out.dynamic"] done [shape=Msquare] start -> fan -> done }`),
		runState: createRunState("fan-out-dynamic-test", "/tmp/parent.dot", { runsDir: args.runsDir }),
		eventBus: args.eventBus,
	};
}

function dynamicFanNode(id: string, templatePath: string, maxConcurrency = "1"): Node {
	return {
		id,
		attrs: {
			type: "fan_out.dynamic",
			source_key: "items",
			item_key: "item",
			template: templatePath,
			max_concurrency: maxConcurrency,
		},
	};
}

describe("DynamicFanOutHandler telemetry", () => {
	let root: string;
	let testRunsDir: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "hatch-fan-dynamic-test-"));
		testRunsDir = join(root, ".hatch", "runs");
		mkdirSync(testRunsDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("emits parallel.fan_out before child execution and parallel.fan_in after completion", async () => {
		const childPath = join(root, "child.dot");
		writeFileSync(childPath, `digraph child { start [shape=Mdiamond] done [shape=Msquare] start -> done }`);

		const bus = new EventBus();
		const emitted: Event[] = [];
		bus.on((event) => emitted.push(event));

		const handler = new DynamicFanOutHandler(baseConfig({ workDir: root, eventBus: bus, runsDir: testRunsDir }));
		let fanOutSeen = false;
		let childCalls = 0;
		const internal = handler as unknown as { pipelineHandler: { execute: DynamicFanOutHandler["execute"] } };
		const originalExecute = internal.pipelineHandler.execute.bind(internal.pipelineHandler);
		internal.pipelineHandler.execute = (async (signal, node, ctx, input) => {
			childCalls += 1;
			expect(fanOutSeen).toBe(true);
			return originalExecute(signal, node as any, ctx as any, input as any) as any;
		}) as unknown as DynamicFanOutHandler["execute"];

		bus.on((event) => {
			if (event.kind === "parallel.fan_out") fanOutSeen = true;
		});

		const node = dynamicFanNode("fan_dynamic", childPath, "1");
		const ctx = new Context({
			items: JSON.stringify(["a", "b"]),
			__run_id: "run-1282",
			path_taken: "full",
		});

		const outcome = await handler.execute(new AbortController().signal, node, ctx, "input");
		expect(outcome.status).toBe(StageStatus.Completed);
		expect(childCalls).toBe(2);

		const fanEvents = emitted.filter((event) => event.kind === "parallel.fan_out" || event.kind === "parallel.fan_in");
		expect(fanEvents.map((event) => event.kind)).toEqual(["parallel.fan_out", "parallel.fan_in"]);
		expect(fanEvents[0].traceId).toBe("builder-parallel-fan_dynamic");
		expect(fanEvents[1].traceId).toBe("builder-parallel-fan_dynamic");
		expect(fanEvents[0].data?.fan_out_count).toBe("2");
		expect(fanEvents[0].data?.max_concurrency).toBe("1");
		expect(fanEvents[0].data?.path_taken).toBe("full");
		expect(fanEvents[0].data?.context_inheritance).toBe("immutable_parent_snapshot");
		expect(fanEvents[1].data?.item_count).toBe("2");
		expect(fanEvents[1].data?.child_count).toBe("2");
		expect(fanEvents[1].data?.failed_items).toBe("0");
	});

	it("returns failed outcome with normalized reason and emits failure metadata when a child fails", async () => {
		const missingTemplatePath = join(root, "missing-child.dot");
		const bus = new EventBus();
		const emitted: Event[] = [];
		bus.on((event) => emitted.push(event));

		const handler = new DynamicFanOutHandler(baseConfig({ workDir: root, eventBus: bus, runsDir: testRunsDir }));
		const node = dynamicFanNode("fan_dynamic_fail", missingTemplatePath, "1");
		const ctx = new Context({ items: JSON.stringify(["a"]), __run_id: "run-1282-fail" });

		const outcome = await handler.execute(new AbortController().signal, node, ctx, "input");
		expect(outcome.status).toBe(StageStatus.Failed);
		expect(outcome.contextUpdates?.["__composite_reason"]).toBe("child_failed");

		const fanEvents = emitted.filter((event) => event.kind === "parallel.fan_out" || event.kind === "parallel.fan_in");
		expect(fanEvents.map((event) => event.kind)).toEqual(["parallel.fan_out", "parallel.fan_in"]);
		expect(fanEvents[1].data?.failed_items).toBe("1");
		expect(fanEvents[1].data?.child_count).toBe("1");
		expect(fanEvents[1].data?.failure_reason).toBe("child_failed");
		expect(fanEvents[1].data?.failure_child_index).toBe("0");
	});

	it("selects the first failed child by input order regardless of completion timing", async () => {
		const bus = new EventBus();
		const emitted: Event[] = [];
		const settledItems: string[] = [];
		bus.on((event) => emitted.push(event));

		const handler = new DynamicFanOutHandler(baseConfig({ workDir: root, eventBus: bus, runsDir: testRunsDir }));
		const internal = handler as unknown as {
			pipelineHandler: {
				execute: (signal: AbortSignal, node: Node, ctx: Context, input: string) => Promise<any>;
			};
		};
		const delays: Record<string, number> = {
			"slow-fail": 40,
			"fast-fail": 5,
			ok: 20,
		};
		internal.pipelineHandler.execute = async (_signal, childNode, childCtx) => {
			const item = childCtx.get("item");
			await new Promise((resolve) => setTimeout(resolve, delays[item] ?? 10));
			settledItems.push(item);
			if (item === "slow-fail") {
				return {
					status: StageStatus.Failed,
					output: "",
					error: "slow failure",
					contextUpdates: {
						__composite_reason: "child_failed",
						__composite_child_id: childNode.id,
						__composite_child_node_id: "step_slow",
						__composite_child_run_id: "run-slow",
					},
				};
			}
			if (item === "fast-fail") {
				return {
					status: StageStatus.Failed,
					output: "",
					error: "fast failure",
					contextUpdates: {
						__composite_reason: "child_failed",
						__composite_child_id: childNode.id,
						__composite_child_node_id: "step_fast",
						__composite_child_run_id: "run-fast",
					},
				};
			}
			return { status: StageStatus.Completed, output: item };
		};

		const node = dynamicFanNode("fan_dynamic_parallel_fail", join(root, "unused-child.dot"), "2");
		const ctx = new Context({
			items: JSON.stringify(["slow-fail", "fast-fail", "ok"]),
			__run_id: "run-1282-parallel-fail",
		});

		const outcome = await handler.execute(new AbortController().signal, node, ctx, "input");
		expect(outcome.status).toBe(StageStatus.Failed);
		expect(outcome.contextUpdates?.["__fan_out_failure_index"]).toBe("0");
		expect(outcome.contextUpdates?.["__composite_child_node_id"]).toBe("step_slow");
		expect(outcome.contextUpdates?.["__composite_child_run_id"]).toBe("run-slow");
		expect(settledItems).toHaveLength(3);

		const fanEvents = emitted.filter((event) => event.kind === "parallel.fan_out" || event.kind === "parallel.fan_in");
		expect(fanEvents.map((event) => event.kind)).toEqual(["parallel.fan_out", "parallel.fan_in"]);
		expect(fanEvents[1].data?.failed_items).toBe("2");
		expect(fanEvents[1].data?.failure_child_index).toBe("0");
		expect(fanEvents[1].data?.failure_child_node_id).toBe("step_slow");
	});

	it("classifies external abort as child_aborted when child template has timeout", async () => {
		const childPath = join(root, "child-abort-timeout.dot");
		writeFileSync(
			childPath,
			`digraph child_abort_timeout {
				start [shape=Mdiamond]
				slow [type="tool" prompt="sleep 2" timeout="5s" governance="reversible" tool_id="shell" action_id="file.write"]
				done [shape=Msquare]
				start -> slow
				slow -> done [condition="outcome=success"]
			}`,
		);

		const bus = new EventBus();
		const emitted: Event[] = [];
		bus.on((event) => emitted.push(event));

		const handler = new DynamicFanOutHandler(baseConfig({ workDir: root, eventBus: bus, runsDir: testRunsDir }));
		const node = dynamicFanNode("fan_dynamic_abort", childPath, "1");
		const ctx = new Context({ items: JSON.stringify(["a"]), __run_id: "run-fan-abort" });
		const ac = new AbortController();
		const outcomePromise = handler.execute(ac.signal, node, ctx, "input");
		setTimeout(() => ac.abort(), 50);
		const outcome = await outcomePromise;

		expect(outcome.status).toBe(StageStatus.Failed);
		expect(outcome.contextUpdates?.["__composite_reason"]).toBe("child_aborted");
		expect(outcome.contextUpdates?.["__composite_child_id"]).toBe("fan_dynamic_abort__item_0");
		expect(outcome.contextUpdates?.["__composite_child_node_id"]).toBe("slow");
		expect(outcome.contextUpdates?.["__composite_child_run_id"]).toBeTruthy();

		const fanIn = emitted.find((event) => event.kind === "parallel.fan_in");
		expect(fanIn?.data?.failure_reason).toBe("child_aborted");
		expect(fanIn?.data?.failure_child_index).toBe("0");
	});

	it("uses an immutable parent snapshot so later children cannot read sibling exports", async () => {
		const bus = new EventBus();
		const handler = new DynamicFanOutHandler(baseConfig({ workDir: root, eventBus: bus, runsDir: testRunsDir }));
		const internal = handler as unknown as {
			pipelineHandler: {
				execute: (signal: AbortSignal, node: Node, ctx: Context, input: string) => Promise<any>;
			};
		};

		let observedSiblingExport = "";
		internal.pipelineHandler.execute = async (_signal, _childNode, childCtx) => {
			const item = childCtx.get("item");
			if (item === "first") {
				return {
					status: StageStatus.Completed,
					output: "first-output",
					contextUpdates: {
						sibling_value: "first-export",
					},
				};
			}
			observedSiblingExport = childCtx.get("sibling_value__0");
			return {
				status: StageStatus.Completed,
				output: "second-output",
				contextUpdates: {},
			};
		};

		const node = dynamicFanNode("fan_dynamic_snapshot", join(root, "unused-child.dot"), "1");
		const ctx = new Context({ items: JSON.stringify(["first", "second"]) });

		const outcome = await handler.execute(new AbortController().signal, node, ctx, "input");
		expect(outcome.status).toBe(StageStatus.Completed);
		expect(observedSiblingExport).toBe("");
		expect(outcome.contextUpdates?.["sibling_value__0"]).toBe("first-export");
		expect(ctx.get("sibling_value__0")).toBe("");
	});

	it("aggregates child exports deterministically by input index regardless of completion timing", async () => {
		const runWithDelays = async (delays: Record<string, number>) => {
			const bus = new EventBus();
			const handler = new DynamicFanOutHandler(baseConfig({ workDir: root, eventBus: bus, runsDir: testRunsDir }));
			const internal = handler as unknown as {
				pipelineHandler: {
					execute: (signal: AbortSignal, node: Node, ctx: Context, input: string) => Promise<any>;
				};
			};
			internal.pipelineHandler.execute = async (_signal, _childNode, childCtx) => {
				const item = childCtx.get("item");
				await new Promise((resolve) => setTimeout(resolve, delays[item] ?? 0));
				return {
					status: StageStatus.Completed,
					output: `output-${item}`,
					contextUpdates: {
						zeta: `z-${item}`,
						alpha: `a-${item}`,
					},
				};
			};

			const node = dynamicFanNode("fan_dynamic_ordering", join(root, "unused-child.dot"), "2");
			const parentBeforeMerge = new Context({ parent: "stable", items: JSON.stringify(["slow", "fast"]) });
			const outcome = await handler.execute(new AbortController().signal, node, parentBeforeMerge, "input");
			expect(outcome.status).toBe(StageStatus.Completed);

			const mergedParent = new Context({ parent: "stable" });
			mergedParent.merge(outcome.contextUpdates || {});
			return {
				outcome,
				mergedParent: mergedParent.all(),
			};
		};

		const slowFirst = await runWithDelays({ slow: 40, fast: 5 });
		const fastFirst = await runWithDelays({ slow: 5, fast: 40 });

		expect(slowFirst.outcome.output).toBe('["output-slow","output-fast"]');
		expect(fastFirst.outcome.output).toBe('["output-slow","output-fast"]');
		expect(slowFirst.mergedParent).toEqual(fastFirst.mergedParent);

		const indexedKeys = Object.keys(slowFirst.outcome.contextUpdates || {}).filter((key) => /__\d+$/.test(key));
		expect(indexedKeys).toEqual(["alpha__0", "zeta__0", "alpha__1", "zeta__1"]);
	});

	it("does not leak successful child exports when any child fails", async () => {
		const bus = new EventBus();
		const handler = new DynamicFanOutHandler(baseConfig({ workDir: root, eventBus: bus, runsDir: testRunsDir }));
		const internal = handler as unknown as {
			pipelineHandler: {
				execute: (signal: AbortSignal, node: Node, ctx: Context, input: string) => Promise<any>;
			};
		};
		internal.pipelineHandler.execute = async (_signal, childNode, childCtx) => {
			const item = childCtx.get("item");
			if (item === "ok") {
				return {
					status: StageStatus.Completed,
					output: "",
					contextUpdates: {
						result_key: "exported-success",
					},
				};
			}
			return {
				status: StageStatus.Failed,
				output: "",
				error: "failed child",
				contextUpdates: {
					result_key: "should-not-export",
					__composite_reason: "child_failed",
					__composite_child_id: childNode.id,
					__composite_child_node_id: "step_fail",
					__composite_child_run_id: "run-fail",
				},
			};
		};

		const node = dynamicFanNode("fan_dynamic_export_contract", join(root, "unused-child.dot"), "2");
		const ctx = new Context({ items: JSON.stringify(["ok", "fail"]) });

		const outcome = await handler.execute(new AbortController().signal, node, ctx, "input");
		expect(outcome.status).toBe(StageStatus.Failed);
		expect(outcome.contextUpdates?.["result_key__0"]).toBeUndefined();
		expect(outcome.contextUpdates?.["__composite_reason"]).toBe("child_failed");
		expect(outcome.contextUpdates?.["__composite_export_writeback_status"]).toBe("skipped");
		expect(ctx.get("result_key__0")).toBe("");
	});

	it("passes the selected object item into child context under item_key without mutating sibling input", async () => {
		const bus = new EventBus();
		const handler = new DynamicFanOutHandler(baseConfig({ workDir: root, eventBus: bus, runsDir: testRunsDir }));
		const internal = handler as unknown as {
			pipelineHandler: {
				execute: (signal: AbortSignal, node: Node, ctx: Context, input: string) => Promise<any>;
			};
		};

		const seen: Array<{
			feature: string;
			fanOutIndex: string;
			sourceItems: string;
		}> = [];

		internal.pipelineHandler.execute = async (_signal, _childNode, childCtx) => {
			seen.push({
				feature: childCtx.get("feature"),
				fanOutIndex: childCtx.get("__fan_out_index"),
				sourceItems: childCtx.get("items"),
			});
			return {
				status: StageStatus.Completed,
				output: childCtx.get("feature"),
				contextUpdates: {
					issue_url: `https://example.test/issues/${childCtx.get("__fan_out_index")}`,
				},
			};
		};

		const node: Node = {
			id: "fan_feature_payload",
			attrs: {
				type: "fan_out.dynamic",
				source_key: "items",
				item_key: "feature",
				template: join(root, "unused-child.dot"),
				max_concurrency: "1",
				output_key: "issue_url",
				export_keys: "issue_url",
			},
		};
		const features = [
			{ id: "F-1", name: "First real feature", slug: "first-real-feature" },
			{ id: "F-2", name: "Second real feature", slug: "second-real-feature" },
		];
		const ctx = new Context({
			items: JSON.stringify(features),
		});

		const outcome = await handler.execute(new AbortController().signal, node, ctx, "goal-parent-input");
		expect(outcome.status).toBe(StageStatus.Completed);
		expect(seen).toEqual([
			{
				feature: JSON.stringify(features[0]),
				fanOutIndex: "0",
				sourceItems: JSON.stringify(features),
			},
			{
				feature: JSON.stringify(features[1]),
				fanOutIndex: "1",
				sourceItems: JSON.stringify(features),
			},
		]);
		expect(JSON.parse(outcome.output)).toEqual([
			"https://example.test/issues/0",
			"https://example.test/issues/1",
		]);
	});

	it("prefers exported key over terminal output when output_key matches an export", async () => {
		const bus = new EventBus();
		const handler = new DynamicFanOutHandler(baseConfig({ workDir: root, eventBus: bus, runsDir: testRunsDir }));
		const internal = handler as unknown as {
			pipelineHandler: {
				execute: (signal: AbortSignal, node: Node, ctx: Context, input: string) => Promise<any>;
			};
		};
		internal.pipelineHandler.execute = async (_signal, _childNode, childCtx) => {
			const item = childCtx.get("item");
			return {
				status: StageStatus.Completed,
				output: "approved",  // terminal output (e.g. judge decision gate)
				contextUpdates: {
					issue_url: `https://github.com/test/repo/issues/${item === "first" ? "100" : "101"}`,
				},
			};
		};

		const node: Node = {
			id: "fan_export_priority",
			attrs: {
				type: "fan_out.dynamic",
				source_key: "items",
				item_key: "item",
				template: join(root, "unused-child.dot"),
				max_concurrency: "1",
				output_key: "issue_url",
				export_keys: "issue_url",
			},
		};
		const ctx = new Context({ items: JSON.stringify(["first", "second"]) });

		const outcome = await handler.execute(new AbortController().signal, node, ctx, "input");
		expect(outcome.status).toBe(StageStatus.Completed);
		// The aggregate output should contain the actual URLs, not "approved"
		const parsed = JSON.parse(outcome.output);
		expect(parsed).toEqual([
			"https://github.com/test/repo/issues/100",
			"https://github.com/test/repo/issues/101",
		]);
		// Indexed exports should also have the URLs
		expect(outcome.contextUpdates?.["issue_url__0"]).toBe("https://github.com/test/repo/issues/100");
		expect(outcome.contextUpdates?.["issue_url__1"]).toBe("https://github.com/test/repo/issues/101");
	});

	it("fails deterministically on invalid child export keys without returning parent export updates", async () => {
		const bus = new EventBus();
		const handler = new DynamicFanOutHandler(baseConfig({ workDir: root, eventBus: bus, runsDir: testRunsDir }));
		const internal = handler as unknown as {
			pipelineHandler: {
				execute: (signal: AbortSignal, node: Node, ctx: Context, input: string) => Promise<any>;
			};
		};
		internal.pipelineHandler.execute = async (_signal, _childNode, childCtx) => {
			const item = childCtx.get("item");
			if (item === "invalid-first") {
				await new Promise((resolve) => setTimeout(resolve, 30));
				return {
					status: StageStatus.Completed,
					output: "invalid",
					contextUpdates: {
						"bad key": "nope",
					},
				};
			}
			await new Promise((resolve) => setTimeout(resolve, 1));
			return {
				status: StageStatus.Completed,
				output: "valid",
				contextUpdates: {
					good_key: "ok",
				},
			};
		};

		const node = dynamicFanNode("fan_dynamic_invalid_export", join(root, "unused-child.dot"), "2");
		const ctx = new Context({ items: JSON.stringify(["invalid-first", "valid-second"]) });

		const outcome = await handler.execute(new AbortController().signal, node, ctx, "input");
		expect(outcome.status).toBe(StageStatus.Failed);
		expect(outcome.error).toContain("invalid export aggregation");
		expect(outcome.contextUpdates?.["__composite_export_writeback_status"]).toBe("skipped");
		expect(outcome.contextUpdates?.["__composite_export_writeback_reason"]).toBe("invalid_export_state");
		const indexedKeys = Object.keys(outcome.contextUpdates || {}).filter((key) => /__\d+$/.test(key));
		expect(indexedKeys).toEqual([]);
		expect(ctx.get("good_key__1")).toBe("");
	});
});
