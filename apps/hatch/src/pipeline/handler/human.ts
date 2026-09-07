import { createInterface } from "node:readline";

import { StageStatus } from "../context.js";
import { expandVariables } from "../engine.js";
import { nodePrompt } from "../graph.js";
import { resolveIntentMetadata } from "../intent.js";

import type { Context, Outcome } from "../context.js";
import type { Handler } from "../engine.js";
import type { Node } from "../graph.js";

/** Interviewer interface for human gates. */
export interface Interviewer {
	ask(question: string, input: string): Promise<{ approved: boolean; response: string }>;
}

/** ConsoleInterviewer prompts on the terminal. */
export class ConsoleInterviewer implements Interviewer {
	async ask(question: string, input: string): Promise<{ approved: boolean; response: string }> {
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		return new Promise((resolve) => {
			if (input) {
				console.log("\nContext from previous step:");
				console.log(input);
				console.log();
			}
			console.log(question);
			rl.question("Approve? [y/N] > ", (answer) => {
				rl.close();
				const approved = answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
				resolve({ approved, response: answer.trim() });
			});
		});
	}
}

/** AutoApproveInterviewer always approves. */
export class AutoApproveInterviewer implements Interviewer {
	async ask(_question: string, _input: string): Promise<{ approved: boolean; response: string }> {
		return { approved: true, response: "auto-approved" };
	}
}

/** HumanHandler pauses for human approval. */
export class HumanHandler implements Handler {
	constructor(private interviewer: Interviewer) {}

	async execute(_signal: AbortSignal, node: Node, ctx: Context, input: string): Promise<Outcome> {
		const question = expandVariables(nodePrompt(node) || `Node "${node.id}" requires approval.`, ctx);
		const intent = resolveIntentMetadata(node.id, {
			handlerType: "wait.human",
			kind: "human",
			data: {
				question,
				context: input,
			},
		});

		const result = await this.interviewer.ask(question, input);

		return {
			status: result.approved ? StageStatus.Completed : StageStatus.Failed,
			output: result.response,
			preferredLabel: result.approved ? "approved" : "rejected",
			intent,
		};
	}
}
