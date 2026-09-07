import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus, type Event } from "@recallnet/factory-telemetry";
import { describe, expect, it } from "vitest";

import { Context } from "./context.js";
import { Engine, HandlerRegistry } from "./engine.js";
import { ToolHandler } from "./handler/tool.js";
import { computeIntentDigest, type IntentDescriptor } from "./intent.js";
import { parse } from "./parse.js";
import { createTraceHandler, type TraceEntry } from "./trace.js";

describe("runtime intent metadata emission", () => {
	it("emits intent identifiers and digest in events and records", async () => {
		const graph = parse(`
	digraph intent_metadata {
		intent_ref = "intent.sample"
		intent_profile = "graph_profile"
		intent_patches = "graph_patch"

		start [shape=Mdiamond]
		run [shape=parallelogram prompt="echo hi" intent_profile="node_profile" intent_patches="node_patch"]
		done [shape=Msquare]

		start -> run -> done
	}
		`);

		const registry = new HandlerRegistry();
		registry.register("tool", new ToolHandler(".", graph));

		const events: Event[] = [];
		const bus = new EventBus();
		bus.on((event) => events.push(event));

		const traceDir = mkdtempSync(join(tmpdir(), "hatch-trace-"));
		const tracePath = join(traceDir, "events.jsonl");
		bus.on(createTraceHandler(tracePath));

		const engine = new Engine(graph, registry, { eventBus: bus, context: new Context() });
		await engine.run();

		const record = engine.getRecords().find((entry) => entry.nodeId === "run");
		expect(record?.outcome?.intent).toBeDefined();

		const intent = record!.outcome!.intent!;
		expect(intent.intentRef).toBe("intent.sample");
		expect(intent.intentProfile).toBe("node_profile");
		expect(intent.intentPatches).toEqual(["graph_patch", "node_patch"]);

		const descriptor: IntentDescriptor = {
			handlerType: "tool",
			kind: "command",
			data: { command: "echo hi", stdin: "", workDir: "." },
		};
		expect(intent.digest).toBe(computeIntentDigest(descriptor));

		const finishEvent = events.find((event) => event.kind === "stage.finish" && event.nodeId === "run");
		expect(finishEvent?.intent?.intentRef).toBe("intent.sample");
		expect(finishEvent?.intent?.digest).toBe(intent.digest);

		const traceRaw = readFileSync(tracePath, "utf-8").trim();
		const traceEntries: TraceEntry[] = traceRaw
			? traceRaw.split("\n").filter(Boolean).map((line) => JSON.parse(line))
			: [];
		const traceFinish = traceEntries.find((entry) => entry.kind === "stage.finish" && entry.nodeId === "run");
		expect(traceFinish?.intent?.intentRef).toBe("intent.sample");
		expect(traceFinish?.intent?.digest).toBe(intent.digest);
	});
});
