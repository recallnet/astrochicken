import path from "node:path";

const DEFAULT_DISPOSABLE_WORKTREE_KINDS = ["wave", "merge", "proposal"] as const;

export interface WorktreeProtection {
	canonical: boolean;
	repoRoot: boolean;
	approvedDisposable: boolean;
	disposableKind: string;
	protected: boolean;
	reason: string;
	approvedRoots: string[];
}

function normalizeAbsolute(candidatePath = ""): string {
	const normalized = String(candidatePath || "").trim();
	if (!normalized) return "";
	return path.resolve(normalized);
}

export function resolveDisposableWorktreeRoot(repoPath = "", kind = "wave"): string {
	const repo = normalizeAbsolute(repoPath);
	const normalizedKind = String(kind || "").trim();
	if (!repo || !normalizedKind) return "";
	return path.resolve(path.dirname(repo), ".hatch-worktrees", normalizedKind);
}

export function isApprovedDisposableWorktreePath(
	candidatePath = "",
	repoPath = "",
	kinds: readonly string[] = DEFAULT_DISPOSABLE_WORKTREE_KINDS,
): boolean {
	return classifyWorktreePath(candidatePath, repoPath, repoPath, kinds).approvedDisposable;
}

export function classifyWorktreePath(
	candidatePath = "",
	repoPath = "",
	canonicalCheckoutPath = repoPath,
	kinds: readonly string[] = DEFAULT_DISPOSABLE_WORKTREE_KINDS,
): WorktreeProtection {
	const absolutePath = normalizeAbsolute(candidatePath);
	const normalizedRepoPath = normalizeAbsolute(repoPath);
	const normalizedCanonicalPath = normalizeAbsolute(canonicalCheckoutPath || repoPath);
	const approvedRoots = Array.from(new Set(kinds
		.map((kind) => resolveDisposableWorktreeRoot(normalizedRepoPath, kind))
		.filter(Boolean)));

	let approvedDisposable = false;
	let disposableKind = "";
	for (const root of approvedRoots) {
		if (absolutePath === root || absolutePath.startsWith(`${root}${path.sep}`)) {
			approvedDisposable = true;
			disposableKind = path.basename(root);
			break;
		}
	}

	const canonical = Boolean(absolutePath) && absolutePath === normalizedCanonicalPath;
	const repoRoot = Boolean(absolutePath) && absolutePath === normalizedRepoPath;

	let reason = "";
	if (!absolutePath) reason = "missing_worktree_path";
	else if (canonical) reason = "canonical_checkout_protected";
	else if (repoRoot) reason = "repo_root_protected";
	else if (!approvedDisposable) reason = "disposable_worktree_path_not_approved";

	return {
		canonical,
		repoRoot,
		approvedDisposable,
		disposableKind,
		protected: Boolean(reason),
		reason,
		approvedRoots,
	};
}
