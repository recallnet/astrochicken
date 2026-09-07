import { EventBus, createLangfuseSpanHandler, type LangfuseSpanRecord } from "@recallnet/factory-telemetry";
import { describe, expect, it } from "vitest";

import { Context, StageStatus } from "./context.js";
import { Engine, HandlerRegistry } from "./engine.js";
import { parse } from "./parse.js";

describe("langfuse span mapping integration wiring", () => {
	it("preserves builder/judge span isolation across retries and long session", async () => {
		const graph = parse(`
	digraph langfuse_partition_long {
		start [shape=Mdiamond]
		builder_a [type="tool" tool_id="shell" trust_role="mothership.local.tool" max_retries="2"]
		judge_a [type="codergen" judge="true" trust_role="mothership.local.judge" max_retries="2"]
		builder_b [type="tool" tool_id="shell" trust_role="mothership.local.tool"]
		judge_b [type="codergen" judge="true" trust_role="mothership.local.judge"]
		done [shape=Msquare]

		start -> builder_a -> judge_a -> builder_b -> judge_b -> done
	}
		`);

		let builderAttempts = 0;
		let judgeAttempts = 0;
		const registry = new HandlerRegistry();
		registry.register("tool", {
			async execute(_signal, node) {
				if (node.id === "builder_a") {
					builderAttempts += 1;
					if (builderAttempts === 1) throw new Error("retry builder once");
				}
				return { status: StageStatus.Completed, output: "builder" };
			},
		});
		registry.register("codergen", {
			async execute(_signal, node) {
				if (node.id === "judge_a") {
					judgeAttempts += 1;
					if (judgeAttempts === 1) throw new Error("retry judge once");
				}
				return { status: StageStatus.Completed, output: "judge" };
			},
		});

		const spans: LangfuseSpanRecord[] = [];
		const bus = new EventBus();
		bus.on(createLangfuseSpanHandler((span) => spans.push(span)));

		const engine = new Engine(graph, registry, { eventBus: bus, context: new Context() });
		await engine.run();

		expect(spans.length).toBeGreaterThan(0);

		const builderSpans = spans.filter((span) => span.metadata.trust_partition === "builder");
		const judgeSpans = spans.filter((span) => span.metadata.trust_partition === "judge");
		expect(builderSpans.length).toBeGreaterThan(0);
		expect(judgeSpans.length).toBeGreaterThan(0);
		expect(builderSpans.every((span) => span.traceId.startsWith("builder-"))).toBe(true);
		expect(judgeSpans.every((span) => span.traceId.startsWith("judge-"))).toBe(true);
	});
});
