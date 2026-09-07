import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const WORKTREE_SCAN_PRUNE_DIRS = new Set([
	".agent",
	".claude",
	".hatch",
	".hook-logs",
	".pnpm",
	"coverage",
	"node_modules",
	"reports",
]);

export function collectWorktreeCandidateDirs(rootDir: string): string[] {
	if (!existsSync(rootDir)) return [];
	const out: string[] = [];
	for (const namespace of safeDirectoryChildren(rootDir)) {
		const namespacePath = join(rootDir, namespace);
		for (const candidate of collectWorktreeCandidatesAtLevel(namespacePath)) {
			out.push(candidate);
		}
	}
	return [...new Set(out)].sort((a, b) => a.localeCompare(b));
}

function safeDirectoryChildren(dir: string): string[] {
	let children: string[] = [];
	try {
		children = readdirSync(dir);
	} catch {
		return [];
	}

	return children.filter((child) => {
		if (WORKTREE_SCAN_PRUNE_DIRS.has(child)) return false;
		const next = join(dir, child);
		try {
			return statSync(next).isDirectory();
		} catch {
			return false;
		}
	});
}

function hasGitMarker(dir: string): boolean {
	try {
		return readdirSync(dir).includes(".git");
	} catch {
		return false;
	}
}

function collectWorktreeCandidatesAtLevel(parentDir: string): string[] {
	const candidates: string[] = [];
	for (const child of safeDirectoryChildren(parentDir)) {
		const childPath = join(parentDir, child);
		if (hasGitMarker(childPath)) {
			candidates.push(normalizePath(childPath));
			continue;
		}
		const nested = safeDirectoryChildren(childPath);
		if (nested.length === 0) {
			candidates.push(normalizePath(childPath));
			continue;
		}
		for (const grandchild of nested) {
			candidates.push(normalizePath(join(childPath, grandchild)));
		}
	}
	return candidates;
}

function normalizePath(pathValue: string): string {
	return pathValue ? pathValue.replace(/\\/g, "/") : pathValue;
}
