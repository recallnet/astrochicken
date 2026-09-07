import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus } from "@recallnet/factory-telemetry";
import { bindLangfuseLifecycleTelemetry } from "@recallnet/factory-telemetry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Context, StageStatus, type Outcome } from "./context.js";
import { Engine, HandlerRegistry, type Handler } from "./engine.js";
import { parse } from "./parse.js";
import { createRunState } from "./run.js";

import type { Node } from "./graph.js";

class FastLoopHandler implements Handler {
	constructor(private delayMs: number) {}

	async execute(_signal: AbortSignal, _node: Node, _ctx: Context, _input: string): Promise<Outcome> {
		await new Promise((resolve) => setTimeout(resolve, this.delayMs));
		return { status: StageStatus.Completed, output: "ok" };
	}
}

function graphText(): string {
	return `
		digraph telemetry_overhead {
			start [shape=Mdiamond]
			task [type="tool"]
			done [shape=Msquare]
			start -> task -> done
		}
	`;
}

async function measureRunDurationMs(args: { runId: string; includeLifecycleBinding: boolean; delayMs: number; runsDir: string }): Promise<number> {
	const graph = parse(graphText());
	const registry = new HandlerRegistry();
	registry.register("tool", new FastLoopHandler(args.delayMs));
	const bus = new EventBus();
	const ctx = new Context({ __run_id: args.runId });
	const binding = args.includeLifecycleBinding
		? bindLangfuseLifecycleTelemetry({
				eventBus: bus,
				ctx,
				emitter: {
					flush: async () => {},
					retry: async () => {},
				},
			})
		: null;
	const engine = new Engine(graph, registry, {
		eventBus: bus,
		context: ctx,
		runState: createRunState(args.runId, "/tmp/overhead.dot", { runsDir: args.runsDir }),
	});

	const start = Date.now();
	await engine.run();
	if (binding) await binding.waitForIdle();
	return Date.now() - start;
}

describe("langfuse lifecycle overhead", () => {
	let root = "";
	let testRunsDir = "";

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "hatch-langfuse-overhead-"));
		testRunsDir = join(root, ".hatch", "runs");
		mkdirSync(testRunsDir, { recursive: true });
	});

	afterEach(() => {
		delete process.env.HATCH_RUN_HEARTBEAT_MS;
		delete process.env.HATCH_LANGFUSE_HEARTBEAT_FLUSH_EVERY;
		rmSync(root, { recursive: true, force: true });
	});

	it(
		"keeps runtime overhead under 20% for heartbeat lifecycle flush path",
		async () => {
			process.env.HATCH_RUN_HEARTBEAT_MS = "20";
			process.env.HATCH_LANGFUSE_HEARTBEAT_FLUSH_EVERY = "1";

			const baselineMs = await measureRunDurationMs({
				runId: "baseline-0",
				includeLifecycleBinding: false,
				delayMs: 2200,
				runsDir: testRunsDir,
			});
			const lifecycleMs = await measureRunDurationMs({
				runId: "lifecycle-0",
				includeLifecycleBinding: true,
				delayMs: 2200,
				runsDir: testRunsDir,
			});
			const overhead = baselineMs <= 0 ? 0 : (lifecycleMs - baselineMs) / baselineMs;
			expect(overhead).toBeLessThan(0.2);
		},
		10000,
	);
});
