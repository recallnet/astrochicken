import { execFile } from "node:child_process";

import { StageStatus } from "../context.js";
import { expandVariables } from "../engine.js";
import { nodePrompt, nodeWorkDir, graphWorkDir } from "../graph.js";
import { resolveIntentMetadata } from "../intent.js";

import type { Context, Outcome } from "../context.js";
import type { Handler } from "../engine.js";
import type { Node, Graph } from "../graph.js";

/** AssertHandler runs a shell command and checks exit code against expectation. */
export class AssertHandler implements Handler {
	constructor(
		private workDir: string = ".",
		private graph?: Graph,
	) {}

	async execute(_signal: AbortSignal, node: Node, ctx: Context, input: string): Promise<Outcome> {
		let command = nodePrompt(node);
		if (!command) throw new Error(`assert handler: node "${node.id}" has no prompt/command`);
		command = expandVariables(command, ctx);

		const expect = node.attrs["expect"] || "success";
		const failMessage = node.attrs["fail_message"]
			? expandVariables(node.attrs["fail_message"], ctx)
			: "";

		// Resolve workdir: node > graph > config
		let workDir = nodeWorkDir(node);
		if (!workDir && this.graph) workDir = graphWorkDir(this.graph);
		if (!workDir) workDir = this.workDir;
		if (!workDir) workDir = ".";
		workDir = expandVariables(workDir, ctx);

		const intent = resolveIntentMetadata(node.id, {
			handlerType: "assert",
			kind: "assert",
			data: {
				command,
				stdin: input,
				workDir,
				expect,
				failMessage,
			},
		});

		return new Promise<Outcome>((resolve) => {
			const child = execFile(
				"sh",
				["-c", command],
				{ cwd: workDir, maxBuffer: 10 * 1024 * 1024 },
				(err, stdout) => {
					const exitedZero = !err;
					const expectSuccess = expect === "success";
					const passed = exitedZero === expectSuccess;

					if (passed) {
						resolve({ status: StageStatus.Completed, output: stdout, intent });
					} else {
						resolve({
							status: StageStatus.Failed,
							output: failMessage || stdout,
							error: failMessage || `assertion failed (expect=${expect}, got exit ${exitedZero ? 0 : "non-0"})`,
							intent,
						});
					}
				},
			);

			if (input) {
				child.stdin?.write(input);
				child.stdin?.end();
			}
		});
	}
}
