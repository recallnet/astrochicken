import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import type {
	FactoryConformanceCommandRequest,
	FactoryConformanceCommandResult,
	FactoryConformanceCommandRunner,
} from "./conformance-harness.js";

export class HarnessFailure extends Error {
	readonly details: Record<string, unknown>;
	readonly command: string;
	readonly exitCode: number;

	constructor(message: string, options: { details?: Record<string, unknown>; command?: string; exitCode?: number } = {}) {
		super(message);
		this.name = "HarnessFailure";
		this.details = options.details ?? {};
		this.command = options.command ?? "";
		this.exitCode = Number.isInteger(options.exitCode) ? Number(options.exitCode) : 1;
	}
}

export interface ResolvedCommandInvocation {
	command: string;
	argsPrefix: string[];
	displayCommand: string;
}

export function resolveSupervisorGraphPath(args: {
	supervisorTickPath: string;
	repoRoot: string;
	factoryRoot: string;
	factoryConfigPath: string;
}): string {
	const raw = String(args.supervisorTickPath || "").trim();
	if (!raw) {
		throw new HarnessFailure("pipeline.supervisor_tick must be a non-empty path", {
			details: { factory_config_path: args.factoryConfigPath },
		});
	}

	if (path.isAbsolute(raw)) {
		return raw;
	}

	const candidates = [
		path.resolve(args.factoryRoot, raw),
		path.resolve(args.repoRoot, raw),
		path.resolve(path.dirname(args.factoryConfigPath), raw),
	];
	const existing = candidates.find((candidate) => existsSync(candidate));
	return existing || candidates[0] || raw;
}

export function defaultCommandRunner(request: FactoryConformanceCommandRequest): FactoryConformanceCommandResult {
	const commandString = formatCommand(request.command, request.args);
	const startedAt = Date.now();
	const run = spawnSync(request.command, request.args, {
		cwd: request.cwd,
		env: request.env,
		encoding: "utf8",
		timeout: request.timeoutMs,
		maxBuffer: 10 * 1024 * 1024,
	});
	const durationMs = Date.now() - startedAt;

	const stdout = String(run.stdout || "");
	const stderr = String(run.stderr || "");
	const exitCode = Number.isInteger(run.status) ? Number(run.status) : 1;
	const timedOut = Boolean((run.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT");
	const errorMessage = run.error
		? String(run.error.message || run.error)
		: (exitCode === 0 ? "" : `command exited with status ${exitCode}`);

	return {
		ok: !run.error && exitCode === 0,
		command: commandString,
		stdout,
		stderr,
		exitCode,
		durationMs,
		timedOut,
		errorMessage,
	};
}

export function formatCommand(command: string, args: string[]): string {
	return [command, ...args.map((arg) => (arg.includes(" ") ? JSON.stringify(arg) : arg))].join(" ");
}

export function parseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
	const trimmed = String(raw || "").trim();
	if (!trimmed) {
		return { ok: false };
	}

	try {
		return { ok: true, value: JSON.parse(trimmed) };
	} catch {
		for (const start of findJsonStartIndices(trimmed)) {
			const candidate = trimmed.slice(start).trim();
			if (!candidate) continue;
			try {
				return { ok: true, value: JSON.parse(candidate) };
			} catch {
				// continue scanning for a trailing JSON payload
			}
		}
		return { ok: false };
	}
}

function findJsonStartIndices(raw: string): number[] {
	const indices: number[] = [];
	for (let index = 0; index < raw.length; index += 1) {
		const ch = raw[index];
		if (ch === "{" || ch === "[") {
			indices.push(index);
		}
	}
	return indices;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveCommandInvocation(name: string, commandCwd: string): ResolvedCommandInvocation {
	const local = path.resolve(commandCwd, "node_modules", ".bin", name);
	if (existsSync(local)) {
		return {
			command: local,
			argsPrefix: [],
			displayCommand: name,
		};
	}

	if (name === "hatch") {
		const builtCli = path.resolve(commandCwd, "apps", "hatch", "dist", "cli.js");
		if (existsSync(builtCli)) {
			return {
				command: process.execPath,
				argsPrefix: [builtCli],
				displayCommand: name,
			};
		}
	}

	if (name === "hatch-ops") {
		const sourceCli = path.resolve(commandCwd, "packages", "factory-ops", "src", "cli.mjs");
		if (existsSync(sourceCli)) {
			return {
				command: process.execPath,
				argsPrefix: [sourceCli],
				displayCommand: name,
			};
		}
	}

	return {
		command: name,
		argsPrefix: [],
		displayCommand: name,
	};
}

export function joinPath(...segments: string[]): string {
	return path.join(...segments);
}

export function isPathWithin(parent: string, child: string): boolean {
	const rel = path.relative(path.resolve(parent), path.resolve(child));
	if (!rel) return true;
	return !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function asHarnessFailure(error: unknown): HarnessFailure {
	if (error instanceof HarnessFailure) return error;
	if (error instanceof Error) {
		const errorWithMeta = error as Error & { details?: unknown; command?: unknown; exitCode?: unknown };
		const details = typeof errorWithMeta.details === "object" && errorWithMeta.details !== null
			? errorWithMeta.details as Record<string, unknown>
			: {};
		const command = typeof errorWithMeta.command === "string"
			? errorWithMeta.command
			: "";
		const exitCode = Number.isInteger(errorWithMeta.exitCode)
			? Number(errorWithMeta.exitCode)
			: 1;
		return new HarnessFailure(error.message, { details, command, exitCode });
	}
	return new HarnessFailure(String(error));
}

export type { FactoryConformanceCommandRunner };
