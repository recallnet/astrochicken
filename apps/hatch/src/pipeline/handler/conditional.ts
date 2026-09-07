import { StageStatus } from "../context.js";

import type { Context, Outcome } from "../context.js";
import type { Handler } from "../engine.js";
import type { Node } from "../graph.js";

/** ConditionalHandler is a pass-through. Edge selection handles the branching. */
export class ConditionalHandler implements Handler {
	async execute(_signal: AbortSignal, _node: Node, _ctx: Context, input: string): Promise<Outcome> {
		return { status: StageStatus.Completed, output: input };
	}
}
