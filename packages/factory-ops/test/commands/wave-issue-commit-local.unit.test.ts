import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { commitLocalIssueWorktree } from "../../src/commands/wave-issue-commit-local.ts";

test("commitLocalIssueWorktree returns {ok:false} for a missing worktree directory", () => {
	const result = commitLocalIssueWorktree({
		worktreeDir: join(tmpdir(), "missing-worktree-dir"),
		issueNumber: "42",
		issueTitle: "Example",
		runId: "run-1",
	});
	assert.equal(result.ok, false);
	assert.ok(result.reason.includes("worktree directory does not exist"));
});

test("commit_helper.sh path resolves to an existing file from source location", () => {
	const sourceFile = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "commands", "wave-issue-commit-local.ts");
	const sourceDir = dirname(sourceFile);
	const src = readFileSync(sourceFile, "utf8");
	const match = src.match(/join\(dirname\(fileURLToPath\(import\.meta\.url\)\)((?:,\s*"\.\.")+)\)/);
	assert.ok(match, "could not find opsRoot path construction in source");
	const dotdotCount = (match[1].match(/\.\./g) || []).length;
	let opsRoot = sourceDir;
	for (let i = 0; i < dotdotCount; i++) opsRoot = dirname(opsRoot);
	const helperPath = join(opsRoot, "scripts", "commit_helper.sh");
	assert.ok(
		existsSync(helperPath),
		`commit_helper.sh not found at resolved path: ${helperPath} (${dotdotCount} parent dirs from source)`,
	);
});

test("commitLocalIssueWorktree returns {ok:false} for a directory without git metadata", () => {
	const worktreeDir = mkdtempSync(join(tmpdir(), "wave-issue-commit-local-"));
	writeFileSync(join(worktreeDir, "README.md"), "not a git worktree\n", "utf8");

	const result = commitLocalIssueWorktree({
		worktreeDir,
		issueNumber: "42",
		issueTitle: "Example",
		runId: "run-1",
	});
	assert.equal(result.ok, false);
	assert.ok(result.reason.includes("missing .git"));
});

test("commitLocalIssueWorktree returns {ok:false} when commit_helper.sh fails", () => {
	const worktreeDir = mkdtempSync(join(tmpdir(), "wave-issue-commit-local-"));
	writeFileSync(join(worktreeDir, ".git"), "gitdir: /tmp/fake-git-dir\n", "utf8");

	const result = commitLocalIssueWorktree({
		worktreeDir,
		issueNumber: "42",
		issueTitle: "Example",
		runId: "run-1",
	});
	assert.equal(result.ok, false);
	assert.equal(typeof result.reason, "string");
	assert.ok(result.reason.length > 0);
});
