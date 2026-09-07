import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus, type Event } from "@recallnet/factory-telemetry";
import { bindLangfuseLifecycleTelemetry } from "@recallnet/factory-telemetry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Context, StageStatus } from "./context.js";
import { Engine, HandlerRegistry } from "./engine.js";
import { persistLifecycleContextFromEngine } from "./lifecycle-persistence.js";
import { parse } from "./parse.js";
import { createRunState, loadRunState } from "./run.js";

describe("langfuse lifecycle suspend/shutdown recovery", () => {
	let root = "";
	let testRunsDir = "";

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "hatch-langfuse-recover-"));
		testRunsDir = join(root, ".hatch", "runs");
		mkdirSync(testRunsDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("persists retry metadata after suspend/shutdown failures and retries on resume heartbeat", async () => {
		const graph = parse(`
			digraph lifecycle_recovery {
				start [shape=Mdiamond]
				node [type="tool"]
				done [shape=Msquare]
				start -> node -> done
			}
		`);
		const registry = new HandlerRegistry();
		registry.register("tool", {
			async execute() {
				return { status: StageStatus.Completed, output: "ok" };
			},
		});

		const runState = createRunState("lifecycle-recover-run", "/tmp/lifecycle-recovery.dot", { runsDir: testRunsDir });
		const ctx = new Context({ __run_id: runState.runId });
		const bus = new EventBus();
		const events: Event[] = [];
		bus.on((event) => events.push(event));

		const baseMs = Date.parse("2026-01-01T00:00:00.000Z");
		let nowMs = baseMs;
		const failingEmitter = {
			flush: vi.fn(async () => {
				throw new Error("flush offline");
			}),
			retry: vi.fn(async () => {
				throw new Error("retry offline");
			}),
		};
		const binding = bindLangfuseLifecycleTelemetry({
			eventBus: bus,
			ctx,
			emitter: failingEmitter,
			heartbeatFlushEvery: 100,
			flushTimeoutMs: 80,
			retryTimeoutMs: 80,
			now: () => new Date(nowMs),
		});

		const engine = new Engine(graph, registry, {
			eventBus: bus,
			context: ctx,
			runState,
		});

		engine.suspend();
		await binding.flushNow("shutdown");
		await binding.waitForIdle();
		persistLifecycleContextFromEngine(engine);

		const persisted = loadRunState(runState.runId);
		expect(persisted).not.toBeNull();
		expect(Number(persisted?.context.__langfuse_retry_count || "0")).toBeGreaterThan(0);
		expect(Number(persisted?.context.__langfuse_retry_next_at || "0")).toBeGreaterThan(baseMs);
		expect(persisted?.context.__langfuse_last_flush_error).toBeTruthy();
		expect(failingEmitter.flush).toHaveBeenCalled();
		expect(events.some((event) => event.kind === "pipeline.suspend")).toBe(true);

		const retryNextAtMs = Number(persisted?.context.__langfuse_retry_next_at || "0");
		nowMs = Math.max(nowMs, retryNextAtMs + 1);

		const resumeCtx = new Context(persisted?.context || {});
		const resumeBus = new EventBus();
		const resumeEvents: Event[] = [];
		resumeBus.on((event) => resumeEvents.push(event));
		const resumeEmitter = {
			flush: vi.fn(async () => {}),
			retry: vi.fn(async () => {}),
		};
		const resumeBinding = bindLangfuseLifecycleTelemetry({
			eventBus: resumeBus,
			ctx: resumeCtx,
			emitter: resumeEmitter,
			heartbeatFlushEvery: 100,
			flushTimeoutMs: 80,
			retryTimeoutMs: 80,
			now: () => new Date(nowMs),
		});

		resumeBus.emit({
			kind: "pipeline.heartbeat",
			nodeId: "node",
			data: {
				run_id: runState.runId,
				run_status: "running",
				heartbeat_interval_ms: "20000",
			},
		});
		await resumeBinding.waitForIdle();

		expect(resumeEmitter.retry).toHaveBeenCalledTimes(1);
		expect(resumeCtx.get("__langfuse_retry_count")).toBe("0");
		expect(resumeEvents.some((event) => event.kind === "telemetry.langfuse.retry")).toBe(true);
		expect(
			resumeEvents.some(
				(event) =>
					event.kind === "telemetry.langfuse.retry" &&
					event.data?.langfuse_lifecycle_status === "ok",
			),
		).toBe(true);
	});
});
