import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	assertPathDoesNotRecreateConfiguredRepo,
	assertConfiguredRepoPathHealthyForStartup,
	formatConfiguredRepoRepairGuidance,
	inspectConfiguredRepoPath,
	resolveConfiguredRepoPath,
} from "./repo-path-health.js";

describe("configured repo path health", () => {
	it("reports missing configured repo paths deterministically", () => {
		const missingPath = join(tmpdir(), "hatch-missing-repo-path");
		expect(inspectConfiguredRepoPath(missingPath)).toEqual({
			path: missingPath,
			status: "missing",
			reason: "repo_path_missing",
		});
	});

	it("reports existing non-git directories as invalid worktrees", () => {
		const nonGitDir = mkdtempSync(join(tmpdir(), "hatch-non-git-repo-"));
		const gitExec = (() => {
			throw new Error("not a git worktree");
		}) as any;
		expect(inspectConfiguredRepoPath(nonGitDir, { gitExec })).toEqual({
			path: nonGitDir,
			status: "not_git_worktree",
			reason: "repo_not_git_worktree",
		});
	});

	it("blocks startup with repair guidance when configured repo path is unhealthy", () => {
		const missingPath = join(tmpdir(), "hatch-startup-missing-repo");
		expect(() => assertConfiguredRepoPathHealthyForStartup(missingPath)).toThrow(
			`[hatch] startup_blocked reason=repo_path_missing repo_path=${missingPath} repair=${formatConfiguredRepoRepairGuidance(missingPath)}`,
		);
	});

	it("resolves configured repo paths from runtime env precedence", () => {
		expect(resolveConfiguredRepoPath({
			FACTORY_CONTEXT_REPO_PATH: "/tmp/context-repo",
			HATCH_CANONICAL_CHECKOUT_PATH: "/tmp/canonical-repo",
		} as NodeJS.ProcessEnv)).toBe("/tmp/context-repo");
		expect(resolveConfiguredRepoPath({
			HATCH_CANONICAL_CHECKOUT_PATH: "/tmp/canonical-repo",
		} as NodeJS.ProcessEnv)).toBe("/tmp/canonical-repo");
	});

	it("refuses writes that would recreate a configured missing repo path", () => {
		const missingPath = join(tmpdir(), "hatch-recreate-missing-repo");
		expect(() => assertPathDoesNotRecreateConfiguredRepo(
			join(missingPath, ".hatch", "mothership", "runs"),
			{ repoPath: missingPath, label: "runs_dir" },
		)).toThrow(/refusing_write label=runs_dir/);
	});
});
