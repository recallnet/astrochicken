import { once } from "node:events";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus } from "@recallnet/factory-telemetry";
import { createLangfuseTelemetry, type LangfuseSpanEnvelope, type LangfuseTelemetryTransport } from "@recallnet/factory-telemetry";
import { afterEach, describe, expect, it } from "vitest";

import { createServer } from "../../server/server.js";
import { Context, StageStatus } from "../context.js";
import { Engine, HandlerRegistry } from "../engine.js";
import { parse } from "../parse.js";

import type { AddressInfo } from "node:net";

class InMemoryTransport implements LangfuseTelemetryTransport {
	public readonly batches: LangfuseSpanEnvelope[][] = [];
	public shutdownCalls = 0;
	async emitBatch(spans: LangfuseSpanEnvelope[]): Promise<void> {
		this.batches.push(spans);
	}
	async shutdown(): Promise<void> {
		this.shutdownCalls += 1;
	}
}

describe("langfuse integration coverage gaps", () => {
	afterEach(() => {
		delete process.env.HATCH_LANGFUSE_ENABLED;
		delete process.env.LANGFUSE_PUBLIC_KEY;
		delete process.env.LANGFUSE_SECRET_KEY;
		delete process.env.LANGFUSE_BASE_URL;
	});

	it("forwards child pipeline EventBus emissions to telemetry", async () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-child-telemetry-"));
		const childPath = join(root, "child.dot");
		writeFileSync(
			childPath,
			`digraph child {\n  start [shape=Mdiamond]\n  child_tool [type="tool" governance="reversible" prompt="printf child-ok"]\n  done [shape=Msquare]\n  start -> child_tool -> done\n}\n`,
		);

		const parent = parse(`
	digraph parent {
		start [shape=Mdiamond]
		child [type="pipeline" pipeline="${childPath}" inherit_context="true"]
		done [shape=Msquare]
		start -> child -> done
	}
		`);

		const transport = new InMemoryTransport();
		const ctx = new Context({ issue_number: "1035" });
		const bus = new EventBus();
		const telemetry = createLangfuseTelemetry({
			env: {
				HATCH_LANGFUSE_ENABLED: "true",
				LANGFUSE_PUBLIC_KEY: "pk",
				LANGFUSE_SECRET_KEY: "sk",
			},
			runId: "parent-run",
			graphName: "parent",
			pipelineFile: "parent.dot",
			getRunContext: () => ctx.all(),
			transport,
		});
		expect(telemetry).toBeTruthy();
		bus.on(telemetry!.eventHandler);

		const registry = new HandlerRegistry();
		registry.register("pipeline", {
			async execute(signal, node, runCtx, input) {
				const { PipelineHandler } = await import("../handler/pipeline.js");
				const handler = new PipelineHandler({
					modelRegistry: {} as any,
					authStorage: {} as any,
					resourceLoader: {} as any,
					defaultModel: "",
					defaultProvider: "",
					graph: parent,
					workDir: root,
					eventBus: bus,
				});
				return handler.execute(signal, node as any, runCtx, input);
			},
		});
		registry.register("tool", {
			async execute() {
				return { status: StageStatus.Completed, output: "tool ok" };
			},
		});

		const engine = new Engine(parent, registry, { context: ctx, eventBus: bus });
		await engine.run();
		await telemetry!.shutdown();

		const spans = transport.batches.flat();
		const childStageStart = spans.find((s) => s.metadata["hatch.node_id"] === "child_tool" && s.metadata["hatch.event_kind"] === "stage.start");
		expect(childStageStart).toBeTruthy();

		rmSync(root, { recursive: true, force: true });
	});

	it("server path no longer boots per-run langfuse transport wiring", async () => {
		process.env.HATCH_LANGFUSE_ENABLED = "true";
		process.env.LANGFUSE_PUBLIC_KEY = "pk";
		process.env.LANGFUSE_SECRET_KEY = "sk";

		const originalFactory = (globalThis as any).__HATCH_LANGFUSE_TEST_TRANSPORT_FACTORY;
		const transport = new InMemoryTransport();
		(globalThis as any).__HATCH_LANGFUSE_TEST_TRANSPORT_FACTORY = () => transport;

		const server = createServer(
			{
				async buildRegistry({ onSessionTelemetryEvent, eventBus }) {
					const reg = new HandlerRegistry();
					reg.register("start", { async execute() { return { status: StageStatus.Completed, output: "" }; } });
					reg.register("exit", { async execute() { return { status: StageStatus.Completed, output: "" }; } });
					reg.register("stack.manager_loop", {
						async execute() {
							onSessionTelemetryEvent?.({
								handlerType: "stack.manager_loop",
								nodeId: "manager",
								sessionId: "mgr-1",
								eventType: "tool_execution_start",
								toolName: "read",
								runId: "server-run",
							});
							eventBus?.emit({ kind: "stage.finish", nodeId: "manager", message: "ok" } as Event);
							return { status: StageStatus.Completed, output: "ok" };
						},
					});
					return reg;
				},
			},
			"127.0.0.1:0",
		);
		await once(server, "listening");
		const address = server.address() as AddressInfo;
		const baseUrl = `http://127.0.0.1:${address.port}`;

		const dot = `digraph s {\n start [shape=Mdiamond]\n manager [type="stack.manager_loop" governance="reversible"]\n done [shape=Msquare]\n start -> manager -> done\n}`;
		const response = await fetch(`${baseUrl}/pipelines`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ dot }),
		});
		expect(response.status).toBe(201);

		const payload = (await response.json()) as { id: string };
		for (let i = 0; i < 20; i++) {
			const runRes = await fetch(`${baseUrl}/pipelines/${payload.id}`);
			const run = (await runRes.json()) as { status: string };
			if (run.status === "completed" || run.status === "failed") break;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}

		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});

		expect(transport.batches.flat()).toHaveLength(0);

		(globalThis as any).__HATCH_LANGFUSE_TEST_TRANSPORT_FACTORY = originalFactory;
	});
});
