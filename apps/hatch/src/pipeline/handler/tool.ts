import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, resolve, join } from "node:path";

import { findRepoRoot } from "../../intent/loader.js";
import { ActionRegistry } from "../action-registry.js";
import { StageStatus } from "../context.js";
import { expandVariables } from "../engine.js";
import { nodePrompt, nodeWorkDir, graphWorkDir } from "../graph.js";
import { resolveIntentMetadata } from "../intent.js";

import type { Context, Outcome } from "../context.js";
import type { Handler } from "../engine.js";
import type { Node, Graph } from "../graph.js";

const TOOL_CONTEXT_TOKEN_RE = /(?:(['"])\$\{([^}]+)\}\1)|\$\{([^}]+)\}/g;

function toToolContextEnvName(key: string): string {
	const normalized = String(key || "")
		.replace(/[^A-Za-z0-9_]/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toUpperCase();
	return `HATCH_VAR_${normalized || "VALUE"}`;
}

/**
 * Determine whether a position in the original command string falls inside
 * single-quoted shell context by counting unescaped quote characters up to
 * that position.
 */
function isInsideSingleQuotes(text: string): boolean {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === "\\" && !inSingle && i + 1 < text.length) {
			i++; // skip escaped char (backslash escaping is inactive inside single quotes)
			continue;
		}
		if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
		if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
	}
	return inSingle;
}

function expandToolCommandViaEnv(command: string, ctx: Context): { command: string; injectedEnv: Record<string, string> } {
	const lookup = ctx.lookup();
	const injectedEnv: Record<string, string> = {};
	const keyToEnv = new Map<string, string>();
	const usedEnvNames = new Set<string>();

	const resolveEnvName = (key: string): string => {
		const existing = keyToEnv.get(key);
		if (existing) return existing;

		const base = toToolContextEnvName(key);
		let candidate = base;
		let suffix = 2;
		while (usedEnvNames.has(candidate)) {
			candidate = `${base}_${suffix}`;
			suffix += 1;
		}

		keyToEnv.set(key, candidate);
		usedEnvNames.add(candidate);
		injectedEnv[candidate] = lookup(key);
		return candidate;
	};

	// Manual match loop so we can check quoting context at each position.
	const re = new RegExp(TOOL_CONTEXT_TOKEN_RE.source, "g");
	let result = "";
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = re.exec(command)) !== null) {
		const directQuote = match[1];
		const quotedKey = match[2];
		const bareKey = match[3];
		const key = String(quotedKey || bareKey || "");
		const envName = resolveEnvName(key);

		result += command.slice(lastIndex, match.index);

		const inSingleQuoteCtx = isInsideSingleQuotes(command.slice(0, match.index));
		if (directQuote && inSingleQuoteCtx) {
			// Directly-quoted token like "${key}" inside a single-quoted string.
			// The regex consumed the surrounding quotes (e.g. JSON literal `"`),
			// so we must re-emit them inside the single-quoted context.
			// Output: <quote>'  "<env-ref>"  '<quote>
			//   <quote>  = original quote char, still inside SQ (literal)
			//   '        = close SQ
			//   "<ref>"  = DQ env ref the shell will expand
			//   '        = re-open SQ
			//   <quote>  = original quote char, back inside SQ (literal)
			result += `${directQuote}'"\${${envName}}"'${directQuote}`;
		} else if (directQuote) {
			// Directly-quoted token like '${key}' or "${key}" — quotes are
			// consumed by the match; replace with double-quoted env ref.
			result += `"\${${envName}}"`;
		} else if (inSingleQuoteCtx) {
			// Bare ${key} inside a single-quoted string — shell won't expand
			// env vars there. Break out of single quotes, insert the
			// double-quoted env ref, then re-enter single quotes.
			result += `'"\${${envName}}"'`;
		} else {
			result += `"\${${envName}}"`;
		}

		lastIndex = match.index + match[0].length;
	}
	result += command.slice(lastIndex);

	return { command: result, injectedEnv };
}

function parseNodeEnv(node: Node, ctx: Context): Record<string, string> {
	const envRaw = node.attrs["env"];
	if (!envRaw) return {};

	const expandedEnv = expandVariables(envRaw, ctx);
	let parsed: unknown;
	try {
		parsed = JSON.parse(expandedEnv);
	} catch (err) {
		throw new Error(
			`tool handler: node "${node.id}" has invalid env JSON: ${err instanceof Error ? err.message : err}`,
		);
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error(`tool handler: node "${node.id}" env must be a JSON object`);
	}

	const merged: Record<string, string> = {};
	for (const [key, value] of Object.entries(parsed)) {
		merged[key] = String(value);
	}
	return merged;
}

function prependPathEntries(existingPath: string, entries: string[]): string {
	const unique = entries.filter((entry, index) => entry && entries.indexOf(entry) === index);
	if (unique.length === 0) return existingPath;
	if (!existingPath) return unique.join(delimiter);
	return `${unique.join(delimiter)}${delimiter}${existingPath}`;
}

function resolveDeterministicToolPath(sharedEnv: Record<string, string>, workDir: string): string {
	const repoCandidate = sharedEnv.FACTORY_REPO
		? resolve(sharedEnv.FACTORY_REPO)
		: findRepoRoot(resolve(workDir || "."));
	const pathEntries = [
		join(repoCandidate, "scripts", "bin"),
		join(repoCandidate, "node_modules", ".bin"),
	].filter((entry) => existsSync(entry));
	return prependPathEntries(sharedEnv.PATH || process.env.PATH || "", pathEntries);
}

function nodeActionRuntime(node: Node): string {
	return String(node.attrs["action_runtime"] || "").trim().toLowerCase();
}

/** ToolHandler executes a shell command defined in the node's prompt attribute. */
export class ToolHandler implements Handler {
	constructor(
		private workDir: string = ".",
		private graph?: Graph,
		private sharedEnv: Record<string, string> = {},
		private actionRegistry: ActionRegistry = new ActionRegistry(),
	) {}

	async execute(
		signal: AbortSignal,
		node: Node,
		ctx: Context,
		input: string,
		controls?: { reportProgress?: () => void },
	): Promise<Outcome> {
		// Resolve working directory: node > graph > config default
		let workDir = nodeWorkDir(node);
		if (!workDir && this.graph) workDir = graphWorkDir(this.graph);
		if (!workDir) workDir = this.workDir;
		if (!workDir) workDir = ".";
		workDir = expandVariables(workDir, ctx);

		const nodeEnv = parseNodeEnv(node, ctx);
		const finalEnv: NodeJS.ProcessEnv = {
			...process.env,
			...this.sharedEnv,
			...nodeEnv,
		};
		finalEnv.PATH = resolveDeterministicToolPath(finalEnv as Record<string, string>, workDir);

		if (nodeActionRuntime(node) === "in_process") {
			const actionId = String(node.attrs["action_id"] || "").trim();
			const action = this.actionRegistry.get(actionId);
			if (!action) {
				throw new Error(`tool handler: node "${node.id}" has unregistered in-process action_id "${actionId}"`);
			}
			return action.execute({
				signal,
				node,
				ctx,
				input,
				workDir,
				env: finalEnv as Record<string, string>,
			});
		}

		let command = nodePrompt(node);
		if (!command) throw new Error(`tool handler: node "${node.id}" has no prompt/command`);

		const expandedCommand = expandToolCommandViaEnv(command, ctx);
		command = expandedCommand.command;
		Object.assign(finalEnv, expandedCommand.injectedEnv);

		const shellArgs = ["-c", command];
		const intent = resolveIntentMetadata(node.id, {
			handlerType: "tool",
			kind: "command",
			data: {
				command,
				stdin: input,
				workDir,
			},
		});

		const reportProgress = controls?.reportProgress ?? (() => {});
		return new Promise<Outcome>((resolve) => {
			let stdout = "";
			let stderr = "";
			let settled = false;
			let abortHandler: (() => void) | undefined;

			const finish = (outcome: Outcome): void => {
				if (settled) return;
				settled = true;
				if (abortHandler) signal.removeEventListener("abort", abortHandler);
				resolve(outcome);
			};

			const child = spawn("sh", shellArgs, { cwd: workDir, env: finalEnv, stdio: ["pipe", "pipe", "pipe"] });
			reportProgress();

			child.stdout?.on("data", (chunk: Buffer | string) => {
				stdout += chunk.toString();
				reportProgress();
			});
			child.stderr?.on("data", (chunk: Buffer | string) => {
				stderr += chunk.toString();
				reportProgress();
			});
			child.on("error", (err) => {
				reportProgress();
				finish({
					status: StageStatus.Failed,
					output: stdout,
					error: `${err.message}: ${stderr}`,
					intent,
				});
			});
			child.on("close", (code, childSignal) => {
				reportProgress();
				if (settled) return;
				if (code === 0) {
					finish({ status: StageStatus.Completed, output: stdout, intent });
					return;
				}
				const errorReason = childSignal ? `signal ${childSignal}` : `exit code ${String(code ?? "unknown")}`;
				const errorDetail = stderr || (stdout ? `(stdout: ${stdout.slice(0, 500)})` : "");
				finish({
					status: StageStatus.Failed,
					output: stdout,
					error: `Command failed with ${errorReason}: ${errorDetail}`,
					intent,
				});
			});

			if (input) {
				child.stdin?.on("error", () => {}); // Ignore EPIPE when child doesn't read stdin
				child.stdin?.write(input);
				child.stdin?.end();
			}

			abortHandler = () => {
				reportProgress();
				child.kill("SIGTERM");
			};
			if (signal.aborted) abortHandler();
			else signal.addEventListener("abort", abortHandler, { once: true });
		});
	}
}
