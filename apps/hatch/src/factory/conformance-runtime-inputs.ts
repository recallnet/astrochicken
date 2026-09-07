import { existsSync, statSync } from "node:fs";
import path from "node:path";

import type { FactoryConfigDocument } from "./config-schema.js";

export interface RuntimeInputCommandResult {
	ok: boolean;
	command: string;
	stdout: string;
	stderr: string;
	exitCode: number;
	timedOut: boolean;
	errorMessage: string;
}

export interface RuntimeInputCommandRunner {
	(request: {
		command: string;
		args: string[];
		cwd: string;
		env: NodeJS.ProcessEnv;
		timeoutMs: number;
	}): RuntimeInputCommandResult;
}

type StructuredHarnessError = Error & {
	details?: Record<string, unknown>;
	command?: string;
	exitCode?: number;
};

function buildHarnessLikeError(
	message: string,
	options: { details?: Record<string, unknown>; command?: string; exitCode?: number } = {},
): StructuredHarnessError {
	const error = new Error(message) as StructuredHarnessError;
	error.details = options.details ?? {};
	error.command = options.command ?? "";
	error.exitCode = Number.isInteger(options.exitCode) ? options.exitCode : 1;
	return error;
}

function resolveExecutable(name: string, commandCwd: string): string {
	const local = path.resolve(commandCwd, "node_modules", ".bin", name);
	return existsSync(local) ? local : name;
}

function formatCommand(command: string, args: string[]): string {
	return [command, ...args.map((arg) => (arg.includes(" ") ? JSON.stringify(arg) : arg))].join(" ");
}

function parseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
	const trimmed = String(raw || "").trim();
	if (!trimmed) return { ok: false };
	try {
		return { ok: true, value: JSON.parse(trimmed) };
	} catch {
		return { ok: false };
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function runIntentStackPhase(args: {
	factoryRoot: string;
	commandCwd: string;
	timeoutMs: number;
	runCommand: RuntimeInputCommandRunner;
}): { details: Record<string, unknown>; command: string } {
	const hatchOpsBin = resolveExecutable("hatch-ops", args.commandCwd);
	const command = args.runCommand({
		command: hatchOpsBin,
		args: ["common", "resolve-intent-stack", "--factory-root", args.factoryRoot],
		cwd: args.commandCwd,
		env: process.env,
		timeoutMs: args.timeoutMs,
	});
	if (!command.ok) {
		throw buildHarnessLikeError(`intent stack resolution failed: ${command.errorMessage || command.stderr || "non-zero exit"}`, {
			details: {
				factory_root: args.factoryRoot,
				stdout: command.stdout,
				stderr: command.stderr,
				timed_out: command.timedOut,
			},
			command: command.command,
			exitCode: command.exitCode,
		});
	}

	const payload = parseJson(command.stdout);
	if (!payload.ok || !isPlainObject(payload.value)) {
		throw buildHarnessLikeError("intent stack output is not valid JSON", {
			details: {
				factory_root: args.factoryRoot,
				stdout: command.stdout,
				stderr: command.stderr,
			},
			command: command.command,
		});
	}

	const value = payload.value as Record<string, unknown>;
	return {
		details: {
			factory_root: args.factoryRoot,
			platform_intent_path: String(value.platform_intent_path || ""),
			factory_intent_path: String(value.factory_intent_path || ""),
			factory_id: String(value.factory_id || ""),
			target_repo: String(value.target_repo || ""),
		},
		command: command.command,
	};
}

export function formatIntentStackCommandHint(args: { commandCwd: string; factoryRoot: string }): string {
	const hatchOpsBin = resolveExecutable("hatch-ops", args.commandCwd);
	return formatCommand(hatchOpsBin, ["common", "resolve-intent-stack", "--factory-root", args.factoryRoot]);
}

export function runSkillLoadingPhase(
	config: FactoryConfigDocument,
	repoRoot: string,
	factoryRoot?: string,
): { details: Record<string, unknown> } {
	const skillPath = String(config.skills.supervisor || "").trim();
	const resolvedPath = resolveExistingPath(skillPath, repoRoot, factoryRoot) || defaultResolvedPath(skillPath, repoRoot, factoryRoot);
	if (!skillPath || !existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
		throw buildHarnessLikeError("skills.supervisor must reference an existing file relative to repo root or factory root", {
			details: { skill_path: skillPath, resolved_path: resolvedPath },
		});
	}
	return { details: { skill_path: skillPath, resolved_path: resolvedPath } };
}

export function runScenarioRootPhase(
	config: FactoryConfigDocument,
	repoRoot: string,
	factoryRoot?: string,
): { details: Record<string, unknown> } {
	const scenariosRoot = String(config.scenarios.root || "").trim();
	const resolvedPath = resolveExistingPath(scenariosRoot, repoRoot, factoryRoot) || defaultResolvedPath(scenariosRoot, repoRoot, factoryRoot);
	if (!scenariosRoot || !existsSync(resolvedPath) || !statSync(resolvedPath).isDirectory()) {
		throw buildHarnessLikeError("scenarios.root must reference an existing directory relative to repo root or factory root", {
			details: { scenarios_root: scenariosRoot, resolved_path: resolvedPath },
		});
	}
	return { details: { scenarios_root: scenariosRoot, resolved_path: resolvedPath } };
}

function resolveExistingPath(targetPath: string, repoRoot: string, factoryRoot?: string): string {
	const candidates = resolvePathCandidates(targetPath, repoRoot, factoryRoot);
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return "";
}

function defaultResolvedPath(targetPath: string, repoRoot: string, factoryRoot?: string): string {
	const candidates = resolvePathCandidates(targetPath, repoRoot, factoryRoot);
	return candidates[0] || path.resolve(repoRoot, targetPath || ".");
}

function resolvePathCandidates(targetPath: string, repoRoot: string, factoryRoot?: string): string[] {
	if (path.isAbsolute(targetPath)) {
		return [targetPath];
	}
	const candidates: string[] = [];
	if (factoryRoot) {
		candidates.push(path.resolve(factoryRoot, targetPath || "."));
	}
	candidates.push(path.resolve(repoRoot, targetPath || "."));
	candidates.push(path.resolve(process.cwd(), targetPath || "."));
	return [...new Set(candidates)];
}
