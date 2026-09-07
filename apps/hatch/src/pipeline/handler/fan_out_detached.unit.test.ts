import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus, type Event } from "@recallnet/factory-telemetry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Context, StageStatus } from "../context.js";
import { parse } from "../parse.js";
import { createRunState, type RunState } from "../run.js";
import { DetachedFanOutHandler } from "./fan_out_detached.js";

import type { Node } from "../graph.js";
import type { HandlerConfig } from "./register.js";

// Mock child_process.spawn to avoid actually launching processes in tests.
const mockSpawn = vi.fn();
vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		spawn: (...args: unknown[]) => mockSpawn(...args),
	};
});

function baseConfig(args: { workDir: string; eventBus?: EventBus; runState?: RunState; runsDir: string }): HandlerConfig {
	return {
		modelRegistry: {} as any,
		authStorage: {} as any,
		resourceLoader: {} as any,
		defaultModel: "test-model",
		defaultProvider: "test-provider",
		workDir: args.workDir,
		graph: parse(`digraph parent { start [shape=Mdiamond] spawn [type="fan_out.detached"] done [shape=Msquare] start -> spawn -> done }`),
		runState: args.runState ?? createRunState("detached-test-parent", "/tmp/parent.dot", { runsDir: args.runsDir }),
		eventBus: args.eventBus,
	};
}

function detachedFanNode(id: string, overrides: Partial<Node["attrs"]> = {}): Node {
	return {
		id,
		attrs: {
			type: "fan_out.detached",
			source_key: "wave_slots",
			item_key: "wave_slot",
			template: "docs/contracts/workflow-ir/mothership/wave_execute.dot",
			output_key: "spawned_wave_runs",
			max_concurrency: "0",
			...overrides,
		},
	};
}

function makeMockChild(pid: number) {
	return { pid, unref: vi.fn() };
}

describe("DetachedFanOutHandler", () => {
	let root: string;
	let testRunsDir: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "hatch-fan-detached-test-"));
		testRunsDir = join(root, ".hatch", "runs");
		mkdirSync(testRunsDir, { recursive: true });
		mockSpawn.mockReset();
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	describe("input validation", () => {
		it("fails when source_key is missing", async () => {
			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, runsDir: testRunsDir }));
			const node = detachedFanNode("spawn", { source_key: "" });
			const ctx = new Context({});

			const result = await handler.execute(AbortSignal.timeout(5000), node, ctx, "");
			expect(result.status).toBe(StageStatus.Failed);
			expect(result.error).toContain("missing source_key");
		});

		it("fails when template is missing", async () => {
			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, runsDir: testRunsDir }));
			const node = detachedFanNode("spawn", { template: "" });
			const ctx = new Context({ wave_slots: "[]" });

			const result = await handler.execute(AbortSignal.timeout(5000), node, ctx, "");
			expect(result.status).toBe(StageStatus.Failed);
			expect(result.error).toContain("missing template");
		});

		it("fails when source_key is not a JSON array", async () => {
			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, runsDir: testRunsDir }));
			const node = detachedFanNode("spawn");
			const ctx = new Context({ wave_slots: "not-json" });

			const result = await handler.execute(AbortSignal.timeout(5000), node, ctx, "");
			expect(result.status).toBe(StageStatus.Failed);
			expect(result.error).toContain("not a JSON array");
		});

		it("fails when source_key is a JSON object (not array)", async () => {
			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, runsDir: testRunsDir }));
			const node = detachedFanNode("spawn");
			const ctx = new Context({ wave_slots: '{"key": "value"}' });

			const result = await handler.execute(AbortSignal.timeout(5000), node, ctx, "");
			expect(result.status).toBe(StageStatus.Failed);
			expect(result.error).toContain("not a JSON array");
		});
	});

	describe("empty source array", () => {
		it("returns immediately with empty array and no spawns", async () => {
			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, runsDir: testRunsDir }));
			const node = detachedFanNode("spawn");
			const ctx = new Context({ wave_slots: "[]" });

			const result = await handler.execute(AbortSignal.timeout(5000), node, ctx, "");
			expect(result.status).toBe(StageStatus.Completed);
			expect(result.output).toBe("[]");
			expect(mockSpawn).not.toHaveBeenCalled();
		});
	});

	describe("spawning processes", () => {
		it("spawns one detached process per item", async () => {
			mockSpawn.mockReturnValue(makeMockChild(12345));
			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, runsDir: testRunsDir }));
			const node = detachedFanNode("spawn");
			const items = [{ milestone: "wave-1" }, { milestone: "wave-2" }];
			const ctx = new Context({ wave_slots: JSON.stringify(items) });

			const result = await handler.execute(AbortSignal.timeout(5000), node, ctx, "");
			expect(result.status).toBe(StageStatus.Completed);
			expect(mockSpawn).toHaveBeenCalledTimes(2);

			const parsed = JSON.parse(result.output);
			expect(parsed).toHaveLength(2);
			expect(parsed[0].pid).toBe(12345);
			expect(parsed[0].template).toBe("docs/contracts/workflow-ir/mothership/wave_execute.dot");
			expect(parsed[1].pid).toBe(12345);
		});

		it("spawns with detached: true, file-based stdio, and calls unref()", async () => {
			const mockChild = makeMockChild(99999);
			mockSpawn.mockReturnValue(mockChild);
			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, runsDir: testRunsDir }));
			const node = detachedFanNode("spawn");
			const ctx = new Context({ wave_slots: JSON.stringify(["item-1"]) });

			await handler.execute(AbortSignal.timeout(5000), node, ctx, "");

			expect(mockSpawn).toHaveBeenCalledTimes(1);
			const spawnArgs = mockSpawn.mock.calls[0];
			const spawnOptions = spawnArgs[2];
			expect(spawnOptions.detached).toBe(true);
			// stdio uses file descriptors: [ignore, stdout.log fd, stderr.log fd]
			expect(spawnOptions.stdio).toEqual(["ignore", expect.any(Number), expect.any(Number)]);
			expect(mockChild.unref).toHaveBeenCalledTimes(1);
		});

		it("writes context.json for each child with parent snapshot + item", async () => {
			mockSpawn.mockReturnValue(makeMockChild(11111));
			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, runsDir: testRunsDir }));
			const node = detachedFanNode("spawn");
			const ctx = new Context({
				wave_slots: JSON.stringify(["slot-a"]),
				gh_repo: "recallnet/astrochicken",
				factory_id: "mothership",
			});

			const result = await handler.execute(AbortSignal.timeout(5000), node, ctx, "");
			const parsed = JSON.parse(result.output);
			const childRunId = parsed[0].childRunId;

			// The context file should exist in the child's run directory.
			// Since we're in a temp dir, run directories are created under .hatch/runs/<id>/
			// Find it by checking the spawn args for the --context path.
			const spawnArgs = mockSpawn.mock.calls[0];
			const args: string[] = spawnArgs[1];
			const contextIdx = args.indexOf("--context");
			expect(contextIdx).toBeGreaterThan(-1);
			const contextPath = args[contextIdx + 1];
			expect(existsSync(contextPath)).toBe(true);

			const childCtx = JSON.parse(readFileSync(contextPath, "utf8"));
			expect(childCtx.wave_slot).toBe("slot-a");
			expect(childCtx.gh_repo).toBe("recallnet/astrochicken");
			expect(childCtx.factory_id).toBe("mothership");
			expect(childCtx.__fan_out_index).toBe("0");
			expect(childCtx.__fan_out_mode).toBe("detached");
		});

		it("passes --checkpoint flag to child for resumability", async () => {
			mockSpawn.mockReturnValue(makeMockChild(22222));
			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, runsDir: testRunsDir }));
			const node = detachedFanNode("spawn");
			const ctx = new Context({ wave_slots: JSON.stringify(["slot-1"]) });

			await handler.execute(AbortSignal.timeout(5000), node, ctx, "");

			const spawnArgs = mockSpawn.mock.calls[0];
			const args: string[] = spawnArgs[1];
			expect(args).toContain("--checkpoint");
		});
	});

	describe("run state registration", () => {
		it("registers spawned children in parent run state activeChildren", async () => {
			mockSpawn.mockReturnValue(makeMockChild(33333));
			const parentRunState = createRunState("parent-run", "/tmp/tick.dot", { runsDir: testRunsDir });
			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, runState: parentRunState, runsDir: testRunsDir }));
			const node = detachedFanNode("spawn");
			const ctx = new Context({ wave_slots: JSON.stringify(["slot-1", "slot-2"]) });

			await handler.execute(AbortSignal.timeout(5000), node, ctx, "");

			const children = Object.values(parentRunState.activeChildren);
			expect(children).toHaveLength(2);
			expect(children[0].status).toBe("running");
			expect(children[0].parentNodeId).toBe("spawn");
			expect(children[0].pipelineFile).toBe("docs/contracts/workflow-ir/mothership/wave_execute.dot");
			expect(children[1].status).toBe("running");
		});

		it("uses the parent-scoped runs dir for detached child run directories", async () => {
			mockSpawn.mockReturnValue(makeMockChild(33334));
			const scopedRunsDir = join(root, ".hatch", "example-trading", "runs");
			mkdirSync(scopedRunsDir, { recursive: true });
			const parentRunState = createRunState("parent-run-scoped", "/tmp/tick.dot", { runsDir: scopedRunsDir });
			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, runState: parentRunState, runsDir: scopedRunsDir }));
			const node = detachedFanNode("spawn");
			const ctx = new Context({ wave_slots: JSON.stringify(["slot-1"]) });

			await handler.execute(AbortSignal.timeout(5000), node, ctx, "");

			const child = Object.values(parentRunState.activeChildren)[0];
			expect(child.childRunDir.startsWith(scopedRunsDir)).toBe(true);

			const spawnArgs = mockSpawn.mock.calls[0];
			const args: string[] = spawnArgs[1];
			const contextIdx = args.indexOf("--context");
			const contextPath = args[contextIdx + 1];
			expect(contextPath.startsWith(scopedRunsDir)).toBe(true);
		});

		it("forwards the parent-scoped runs dir to the detached child process environment", async () => {
			mockSpawn.mockReturnValue(makeMockChild(33335));
			const scopedRunsDir = join(root, ".hatch", "example-trading", "runs");
			mkdirSync(scopedRunsDir, { recursive: true });
			const parentRunState = createRunState("parent-run-env", "/tmp/tick.dot", { runsDir: scopedRunsDir });
			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, runState: parentRunState, runsDir: scopedRunsDir }));
			const node = detachedFanNode("spawn");
			const ctx = new Context({ wave_slots: JSON.stringify(["slot-1"]) });

			await handler.execute(AbortSignal.timeout(5000), node, ctx, "");

			const spawnOptions = mockSpawn.mock.calls[0][2];
			expect(spawnOptions.env.HATCH_RUNS_DIR).toBe(scopedRunsDir);
		});

		it("sets exportWriteback to skipped/detached_process", async () => {
			mockSpawn.mockReturnValue(makeMockChild(44444));
			const parentRunState = createRunState("parent-run-2", "/tmp/tick.dot", { runsDir: testRunsDir });
			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, runState: parentRunState, runsDir: testRunsDir }));
			const node = detachedFanNode("spawn");
			const ctx = new Context({ wave_slots: JSON.stringify(["slot-1"]) });

			await handler.execute(AbortSignal.timeout(5000), node, ctx, "");

			const child = Object.values(parentRunState.activeChildren)[0];
			expect(child.exportWriteback?.status).toBe("skipped");
			expect(child.exportWriteback?.reason).toBe("detached_process");
		});
	});

	describe("spawn failure handling", () => {
		it("records error for failed spawn without failing the entire handler", async () => {
			mockSpawn
				.mockReturnValueOnce(makeMockChild(55555))
				.mockImplementationOnce(() => { throw new Error("ENOENT: hatch not found"); })
				.mockReturnValueOnce(makeMockChild(66666));

			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, runsDir: testRunsDir }));
			const node = detachedFanNode("spawn");
			const ctx = new Context({ wave_slots: JSON.stringify(["a", "b", "c"]) });

			const result = await handler.execute(AbortSignal.timeout(5000), node, ctx, "");
			expect(result.status).toBe(StageStatus.Completed);

			const parsed = JSON.parse(result.output);
			expect(parsed).toHaveLength(3);
			expect(parsed[0].pid).toBe(55555);
			expect(parsed[0].error).toBeUndefined();
			expect(parsed[1].pid).toBeNull();
			expect(parsed[1].error).toContain("ENOENT");
			expect(parsed[2].pid).toBe(66666);
			expect(parsed[2].error).toBeUndefined();
		});

		it("tracks spawn success/error counts in context updates", async () => {
			mockSpawn
				.mockReturnValueOnce(makeMockChild(77777))
				.mockImplementationOnce(() => { throw new Error("spawn failed"); });

			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, runsDir: testRunsDir }));
			const node = detachedFanNode("spawn");
			const ctx = new Context({ wave_slots: JSON.stringify(["a", "b"]) });

			const result = await handler.execute(AbortSignal.timeout(5000), node, ctx, "");
			expect(result.contextUpdates?.["__fan_out_detached_spawn_count"]).toBe("2");
			expect(result.contextUpdates?.["__fan_out_detached_success_count"]).toBe("1");
			expect(result.contextUpdates?.["__fan_out_detached_error_count"]).toBe("1");
		});
	});

	describe("context isolation", () => {
		it("each child gets immutable snapshot — mutations do not leak between children", async () => {
			mockSpawn.mockReturnValue(makeMockChild(88888));
			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, runsDir: testRunsDir }));
			const node = detachedFanNode("spawn");
			const ctx = new Context({
				wave_slots: JSON.stringify(["slot-1", "slot-2"]),
				shared_key: "original_value",
			});

			await handler.execute(AbortSignal.timeout(5000), node, ctx, "");

			// Both children should have the same shared_key value.
			const call1Args: string[] = mockSpawn.mock.calls[0][1];
			const call2Args: string[] = mockSpawn.mock.calls[1][1];
			const ctx1Path = call1Args[call1Args.indexOf("--context") + 1];
			const ctx2Path = call2Args[call2Args.indexOf("--context") + 1];
			const ctx1 = JSON.parse(readFileSync(ctx1Path, "utf8"));
			const ctx2 = JSON.parse(readFileSync(ctx2Path, "utf8"));

			expect(ctx1.shared_key).toBe("original_value");
			expect(ctx2.shared_key).toBe("original_value");
			expect(ctx1.wave_slot).toBe("slot-1");
			expect(ctx2.wave_slot).toBe("slot-2");
			expect(ctx1.__fan_out_index).toBe("0");
			expect(ctx2.__fan_out_index).toBe("1");
		});

		it("parent context is not mutated by handler", async () => {
			mockSpawn.mockReturnValue(makeMockChild(99999));
			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, runsDir: testRunsDir }));
			const node = detachedFanNode("spawn");
			const ctx = new Context({
				wave_slots: JSON.stringify(["slot-1"]),
				before: "untouched",
			});
			const snapshotBefore = ctx.all();

			await handler.execute(AbortSignal.timeout(5000), node, ctx, "");

			// Parent context should not have fan_out internal keys injected.
			expect(ctx.get("before")).toBe("untouched");
			expect(ctx.get("__fan_out_index")).toBe("");
			expect(ctx.get("__fan_out_mode")).toBe("");
		});
	});

	describe("telemetry", () => {
		it("emits parallel.fan_out event with detached_process handler type", async () => {
			mockSpawn.mockReturnValue(makeMockChild(11111));
			const bus = new EventBus();
			const emitted: Event[] = [];
			bus.on((event) => emitted.push(event));

			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, eventBus: bus, runsDir: testRunsDir }));
			const node = detachedFanNode("spawn");
			const ctx = new Context({ wave_slots: JSON.stringify(["a", "b"]) });

			await handler.execute(AbortSignal.timeout(5000), node, ctx, "");

			const fanOutEvents = emitted.filter((e) => e.kind === "parallel.fan_out");
			expect(fanOutEvents).toHaveLength(1);
			expect(fanOutEvents[0].data.child_handler_type).toBe("detached_process");
			expect(fanOutEvents[0].data.fan_out_count).toBe("2");
		});

		it("does not emit fan_in event (fire-and-forget)", async () => {
			mockSpawn.mockReturnValue(makeMockChild(22222));
			const bus = new EventBus();
			const emitted: Event[] = [];
			bus.on((event) => emitted.push(event));

			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, eventBus: bus, runsDir: testRunsDir }));
			const node = detachedFanNode("spawn");
			const ctx = new Context({ wave_slots: JSON.stringify(["a"]) });

			await handler.execute(AbortSignal.timeout(5000), node, ctx, "");

			const fanInEvents = emitted.filter((e) => e.kind === "parallel.fan_in");
			expect(fanInEvents).toHaveLength(0);
		});
	});

	describe("max_concurrency", () => {
		it("limits spawns to max_concurrency when set", async () => {
			mockSpawn.mockReturnValue(makeMockChild(33333));
			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, runsDir: testRunsDir }));
			const node = detachedFanNode("spawn", { max_concurrency: "2" });
			const items = ["a", "b", "c", "d", "e"];
			const ctx = new Context({ wave_slots: JSON.stringify(items) });

			const result = await handler.execute(AbortSignal.timeout(5000), node, ctx, "");
			expect(mockSpawn).toHaveBeenCalledTimes(2);

			const parsed = JSON.parse(result.output);
			expect(parsed).toHaveLength(2);
		});

		it("spawns all items when max_concurrency is 0 (unlimited)", async () => {
			mockSpawn.mockReturnValue(makeMockChild(44444));
			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, runsDir: testRunsDir }));
			const node = detachedFanNode("spawn", { max_concurrency: "0" });
			const ctx = new Context({ wave_slots: JSON.stringify(["a", "b", "c"]) });

			const result = await handler.execute(AbortSignal.timeout(5000), node, ctx, "");
			expect(mockSpawn).toHaveBeenCalledTimes(3);

			const parsed = JSON.parse(result.output);
			expect(parsed).toHaveLength(3);
		});
	});

	describe("@hatch/ template resolution", () => {
		it("resolves @hatch/ package paths via resolveGraphPath instead of literal path.resolve", async () => {
			mockSpawn.mockReturnValue(makeMockChild(77777));
			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, runsDir: testRunsDir }));
			const node = detachedFanNode("spawn", {
				template: "docs/contracts/workflow-ir/capability-software-development/goal_execute.dot",
			});
			const ctx = new Context({ wave_slots: JSON.stringify(["1231"]) });

			const result = await handler.execute(AbortSignal.timeout(5000), node, ctx, "");

			// The spawn should use the resolved package path, not a literal @hatch/ path.
			const spawnArgs = mockSpawn.mock.calls[0];
			const args: string[] = spawnArgs[1];
			const graphArg = args[args.indexOf("run") + 1];
			// The resolved path should NOT contain @hatch/ literally in the filesystem path.
			expect(graphArg).not.toContain("/@hatch/");
			// It should resolve to the package's actual location.
			expect(graphArg).toContain("capability-software-development");
			expect(graphArg).toContain("goal_execute.dot");
		});
	});

	describe("output_key", () => {
		it("writes spawn results to output_key in context updates", async () => {
			mockSpawn.mockReturnValue(makeMockChild(55555));
			const handler = new DetachedFanOutHandler(baseConfig({ workDir: root, runsDir: testRunsDir }));
			const node = detachedFanNode("spawn", { output_key: "spawned_wave_runs" });
			const ctx = new Context({ wave_slots: JSON.stringify(["a"]) });

			const result = await handler.execute(AbortSignal.timeout(5000), node, ctx, "");
			expect(result.contextUpdates?.["spawned_wave_runs"]).toBeTruthy();

			const parsed = JSON.parse(result.contextUpdates!["spawned_wave_runs"]);
			expect(parsed).toHaveLength(1);
			expect(parsed[0].pid).toBe(55555);
		});
	});
});
