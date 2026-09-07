import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function trim(value = "") {
	return String(value || "").trim();
}

export function commitLocalIssueWorktree({
	worktreeDir = "",
	issueNumber = "",
	issueTitle = "",
	runId = "",
} = {}) {
	const resolvedWorktreeDir = trim(worktreeDir);
	if (!resolvedWorktreeDir || !existsSync(resolvedWorktreeDir)) {
		return { ok: false, reason: `commit-local: worktree directory does not exist: ${resolvedWorktreeDir}` };
	}
	const gitFile = join(resolvedWorktreeDir, ".git");
	if (!existsSync(gitFile)) {
		return { ok: false, reason: `commit-local: worktree is not a git repository (missing .git): ${resolvedWorktreeDir}` };
	}

	try {
		const opsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
		execFileSync(join(opsRoot, "scripts", "commit_helper.sh"), [
			"--issue-number",
			trim(issueNumber),
			"--title",
			String(issueTitle || ""),
			"--run-id",
			trim(runId),
		], {
			cwd: resolvedWorktreeDir,
			encoding: "utf8",
			stdio: "pipe",
		});
	} catch (err) {
		const stderr = err?.stderr || err?.message || String(err);
		return { ok: false, reason: `commit-local: commit_helper.sh failed: ${stderr}` };
	}

	return { ok: true, reason: "committed" };
}
