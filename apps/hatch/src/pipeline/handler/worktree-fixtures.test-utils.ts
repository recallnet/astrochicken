import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * worktree.ts can acquire a repo mutation lock at <repo>/.git.hatch.lock when
 * <repo>/.git is absent. Tests must create the repo/worktree directories
 * explicitly before executing handler paths that touch lock acquisition.
 */
function createHermeticWorktreeFixtures() {
	const root = mkdtempSync(join(tmpdir(), "worktree-test-"));
	return {
		root,
		repoDir: join(root, "repo"),
		worktreesRoot: join(root, ".hatch-worktrees"),
	};
}

function ensureRepoDir(root: string): string {
	const repoDir = join(root, "repo");
	mkdirSync(repoDir, { recursive: true });
	return repoDir;
}

function ensureWorktreeDir(root: string, name: string): string {
	const worktreeDir = join(root, ".hatch-worktrees", name);
	mkdirSync(worktreeDir, { recursive: true });
	return worktreeDir;
}

function cleanupFixtures(root: string): void {
	rmSync(root, { recursive: true, force: true });
}

export function createWorktreeFixture(): {
	root: string;
	repoDir: string;
	worktreesRoot: string;
	cleanup: () => void;
};
export function createWorktreeFixture(branch: string): {
	root: string;
	repoDir: string;
	worktreesRoot: string;
	worktreeDir: string;
	cleanup: () => void;
};
export function createWorktreeFixture(branch?: string) {
	const fixtures = createHermeticWorktreeFixtures();
	const repoDir = ensureRepoDir(fixtures.root);
	const cleanup = () => cleanupFixtures(fixtures.root);
	if (!branch) {
		return {
			root: fixtures.root,
			repoDir,
			worktreesRoot: fixtures.worktreesRoot,
			cleanup,
		};
	}

	return {
		root: fixtures.root,
		repoDir,
		worktreesRoot: fixtures.worktreesRoot,
		worktreeDir: ensureWorktreeDir(fixtures.root, branch),
		cleanup,
	};
}
