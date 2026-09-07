import type { Context, Outcome } from "./context.js";
import type { Node } from "./graph.js";

export interface HandlerExecutionControls {
	reportProgress: () => void;
}

/** Handler executes a pipeline node. */
export interface Handler {
	execute(
		signal: AbortSignal,
		node: Node,
		ctx: Context,
		input: string,
		controls?: HandlerExecutionControls,
	): Promise<Outcome>;
}

/** HandlerRegistry maps handler type strings to Handler implementations. */
export class HandlerRegistry {
	private handlers = new Map<string, Handler>();

	register(handlerType: string, handler: Handler): void {
		this.handlers.set(handlerType, handler);
	}

	get(handlerType: string): Handler | undefined {
		return this.handlers.get(handlerType);
	}
}
