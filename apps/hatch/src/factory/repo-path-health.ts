import * as childProcess from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

export type ConfiguredRepoPathStatus = "unconfigured" | "ok" | "missing" | "not_git_worktree";

export interface ConfiguredRepoPathHealth {
	path: string;
	status: ConfiguredRepoPathStatus;
	reason: string;
}

function trim(value = ""): string {
	return String(value ?? "").trim();
}

function pickString(...values: Array<string | undefined>): string {
	for (const value of values) {
		const normalized = trim(value);
		if (normalized) return normalized;
	}
	return "";
}

export function resolveConfiguredRepoPath(env: NodeJS.ProcessEnv = process.env): string {
	return pickString(env.FACTORY_CONTEXT_REPO_PATH, env.HATCH_CANONICAL_CHECKOUT_PATH);
}

export function inspectConfiguredRepoPath(
	repoPath = resolveConfiguredRepoPath(),
	{ gitExec }: { gitExec?: typeof childProcess.execFileSync } = {},
): ConfiguredRepoPathHealth {
	const resolvedPath = trim(repoPath) ? path.resolve(repoPath) : "";
	if (!resolvedPath) {
		return { path: "", status: "unconfigured", reason: "repo_path_unconfigured" };
	}
	if (!existsSync(resolvedPath)) {
		return { path: resolvedPath, status: "missing", reason: "repo_path_missing" };
	}

	try {
		if (!statSync(resolvedPath).isDirectory()) {
			return { path: resolvedPath, status: "not_git_worktree", reason: "repo_not_git_worktree" };
		}
	} catch {
		return { path: resolvedPath, status: "not_git_worktree", reason: "repo_not_git_worktree" };
	}

	try {
		const execGit = typeof gitExec === "function"
			? gitExec
			: (typeof childProcess.execFileSync === "function" ? childProcess.execFileSync : null);
		if (!execGit) {
			return { path: resolvedPath, status: "not_git_worktree", reason: "repo_not_git_worktree" };
		}
		const root = String(execGit("git", ["-C", resolvedPath, "rev-parse", "--show-toplevel"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}) || "").trim();
		if (!root) {
			return { path: resolvedPath, status: "not_git_worktree", reason: "repo_not_git_worktree" };
		}
		return { path: resolvedPath, status: "ok", reason: "ok" };
	} catch {
		return { path: resolvedPath, status: "not_git_worktree", reason: "repo_not_git_worktree" };
	}
}

export function formatConfiguredRepoRepairGuidance(repoPath = ""): string {
	const resolvedPath = trim(repoPath) ? path.resolve(repoPath) : "<repo-path>";
	return `restore the checkout at ${resolvedPath} or update FACTORY_CONTEXT_REPO_PATH/HATCH_CANONICAL_CHECKOUT_PATH to a valid git worktree`;
}

export function assertConfiguredRepoPathHealthyForStartup(repoPath = resolveConfiguredRepoPath()): void {
	const health = inspectConfiguredRepoPath(repoPath);
	if (health.status === "unconfigured" || health.status === "ok") return;

	throw new Error(
		`[hatch] startup_blocked reason=${health.reason} repo_path=${health.path} repair=${formatConfiguredRepoRepairGuidance(health.path)}`,
	);
}

export function assertPathDoesNotRecreateConfiguredRepo(
	targetPath: string,
	{ repoPath = resolveConfiguredRepoPath(), label = "runtime_path" }: { repoPath?: string; label?: string } = {},
): void {
	const resolvedTarget = trim(targetPath) ? path.resolve(targetPath) : "";
	if (!resolvedTarget) return;

	const health = inspectConfiguredRepoPath(repoPath);
	if (health.status === "unconfigured" || health.status === "ok" || !health.path) return;

	const withinRepo = resolvedTarget === health.path || resolvedTarget.startsWith(`${health.path}${path.sep}`);
	if (!withinRepo) return;

	throw new Error(
		`[hatch] refusing_write label=${label} path=${resolvedTarget} reason=${health.reason} repo_path=${health.path} repair=${formatConfiguredRepoRepairGuidance(health.path)}`,
	);
}
