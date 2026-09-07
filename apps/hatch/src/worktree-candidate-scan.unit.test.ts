import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { collectWorktreeCandidateDirs } from "./worktree-candidate-scan.js";

describe("collectWorktreeCandidateDirs", () => {
	const roots: string[] = [];

	afterEach(() => {
		for (const root of roots.splice(0)) {
			try {
				rmSync(root, { recursive: true, force: true });
			} catch {
				// best-effort temp cleanup in test process
			}
		}
	});

	it("collects namespace worktree roots without descending into nested junk", () => {
		const root = mkdtempSync(join(tmpdir(), "worktree-candidate-scan-"));
		roots.push(root);
		const worktreeRoot = join(root, ".hatch-worktrees");
		const validWave = join(worktreeRoot, "wave", "goal", "2341");
		const residueMerge = join(worktreeRoot, "merge", "broken-merge-worktree");
		const nestedFakeGit = join(residueMerge, "node_modules", "fake-package", ".git");

		mkdirSync(dirname(join(validWave, ".git")), { recursive: true });
		writeFileSync(join(validWave, ".git"), "gitdir: /tmp/worktree-2341\n");
		mkdirSync(dirname(nestedFakeGit), { recursive: true });
		writeFileSync(join(residueMerge, "README.md"), "residue\n");
		writeFileSync(nestedFakeGit, "gitdir: /tmp/not-real\n");

		expect(collectWorktreeCandidateDirs(worktreeRoot)).toEqual([
			`${worktreeRoot}/merge/broken-merge-worktree`,
			`${worktreeRoot}/wave/goal/2341`,
		]);
	});
});
