import { StageStatus } from "../context.js";
import { outgoingEdges, nodeHandlerType } from "../graph.js";

import type { Context, Outcome } from "../context.js";
import type { Handler, HandlerRegistry } from "../engine.js";
import type { Node, Graph } from "../graph.js";

/** ParallelHandler fans out to all outgoing branches concurrently. */
export class ParallelHandler implements Handler {
	async execute(_signal: AbortSignal, _node: Node, _ctx: Context, input: string): Promise<Outcome> {
		// The parallel handler itself is a pass-through.
		// The engine handles fan-out by detecting the parallel node type.
		// For now, just pass input through.
		return { status: StageStatus.Completed, output: input };
	}
}

/** FanInHandler joins parallel branches. */
export class FanInHandler implements Handler {
	async execute(_signal: AbortSignal, _node: Node, _ctx: Context, input: string): Promise<Outcome> {
		// Fan-in merges inputs from parallel branches.
		// For now, just pass through — the engine manages the merge.
		return { status: StageStatus.Completed, output: input };
	}
}
