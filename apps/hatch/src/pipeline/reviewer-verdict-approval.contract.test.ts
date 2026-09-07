import { describe, expect, it } from "vitest";

import { Context, StageStatus, type Outcome } from "./context.js";
import { Engine, HandlerRegistry, type Handler } from "./engine.js";
import { parse } from "./parse.js";

import type { Node } from "./graph.js";

class StaticNodeOutputHandler implements Handler {
	constructor(private readonly outputsByNode: Record<string, Outcome>) {}

	async execute(_signal: AbortSignal, node: Node): Promise<Outcome> {
		return this.outputsByNode[node.id] ?? { status: StageStatus.Completed, output: "" };
	}
}

function reviewRoutingGraph(): ReturnType<typeof parse> {
	return parse(`
		digraph review_subgraph_contract {
			start [shape=Mdiamond]
			review [type="codergen" reviewer="true" output_key="review_result" output_format="json" outputs="review_verdict,review_reason_codes,review_notes"]
			resolve_review_route [type="tool" outputs="review_verdict,review_route_reason"]
			decide [shape=diamond]
			approve_attempt [type="tool" output_key="final_route"]
			revise_attempt [type="tool" output_key="final_route"]
			done [shape=Msquare]
			start -> review -> resolve_review_route -> decide
			decide -> approve_attempt [condition="review_verdict=approve"]
			decide -> revise_attempt [condition="review_verdict!=approve"]
			approve_attempt -> done
			revise_attempt -> done
		}
	`);
}

function visitedNodeIds(engine: Engine): Set<string> {
	return new Set(engine.getRecords().map((record) => record.nodeId));
}

describe("review verdict approval routing (engine contract)", () => {
	it("routes to approve_attempt when resolve_review_route returns review_verdict=approve", async () => {
		const graph = reviewRoutingGraph();
		const registry = new HandlerRegistry();

		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				review: {
					status: StageStatus.Completed,
					output: JSON.stringify({
						review_verdict: "approve",
						review_reason_codes: ["APPROVED"],
						review_notes: "Implementation complete.",
					}),
				},
			}),
		);

		registry.register(
			"tool",
			new StaticNodeOutputHandler({
				resolve_review_route: {
					status: StageStatus.Completed,
					output: JSON.stringify({
						review_verdict: "approve",
						review_route_reason: "approved",
					}),
				},
				approve_attempt: {
					status: StageStatus.Completed,
					output: "approve_attempt_reached",
				},
				revise_attempt: {
					status: StageStatus.Completed,
					output: "revise_attempt_reached",
				},
			}),
		);
		registry.register("conditional", new StaticNodeOutputHandler({ decide: { status: StageStatus.Completed, output: "" } }));

		const engine = new Engine(graph, registry, { context: new Context() });
		await engine.run();

		expect(engine.getContext().get("review_verdict")).toBe("approve");
		expect(engine.getContext().get("final_route")).toBe("approve_attempt_reached");

		const visited = visitedNodeIds(engine);
		expect(visited.has("approve_attempt")).toBe(true);
		expect(visited.has("revise_attempt")).toBe(false);
	});

	it("routes to revise_attempt when resolve_review_route overrides review_verdict to revise", async () => {
		const graph = reviewRoutingGraph();
		const registry = new HandlerRegistry();

		registry.register(
			"codergen",
			new StaticNodeOutputHandler({
				review: {
					status: StageStatus.Completed,
					output: JSON.stringify({
						review_verdict: "approve",
						review_reason_codes: ["APPROVED"],
						review_notes: "Implementation complete.",
					}),
				},
			}),
		);

		registry.register(
			"tool",
			new StaticNodeOutputHandler({
				resolve_review_route: {
					status: StageStatus.Completed,
					output: JSON.stringify({
						review_verdict: "revise",
						review_route_reason: "policy_override_revise",
					}),
				},
				approve_attempt: {
					status: StageStatus.Completed,
					output: "approve_attempt_reached",
				},
				revise_attempt: {
					status: StageStatus.Completed,
					output: "revise_attempt_reached",
				},
			}),
		);
		registry.register("conditional", new StaticNodeOutputHandler({ decide: { status: StageStatus.Completed, output: "" } }));

		const engine = new Engine(graph, registry, { context: new Context() });
		await engine.run();

		expect(engine.getContext().get("review_verdict")).toBe("revise");
		expect(engine.getContext().get("final_route")).toBe("revise_attempt_reached");

		const visited = visitedNodeIds(engine);
		expect(visited.has("approve_attempt")).toBe(false);
		expect(visited.has("revise_attempt")).toBe(true);
	});
});
