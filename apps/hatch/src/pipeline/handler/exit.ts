import { StageStatus } from "../context.js";

import type { Context, Outcome } from "../context.js";
import type { Handler } from "../engine.js";
import type { Node } from "../graph.js";

/** ExitHandler is a no-op pass-through. */
export class ExitHandler implements Handler {
	async execute(_signal: AbortSignal, _node: Node, _ctx: Context, input: string): Promise<Outcome> {
		return { status: StageStatus.Completed, output: input };
	}
}
