import { describe, expect, it } from "vitest";

import { classifyWorktreePath, isApprovedDisposableWorktreePath, resolveDisposableWorktreeRoot } from "./worktree-path-policy.js";

describe("worktree path policy", () => {
	it("resolves approved disposable roots under the repo parent", () => {
		expect(resolveDisposableWorktreeRoot("/tmp/ws/astrochicken", "wave")).toBe("/tmp/ws/.hatch-worktrees/wave");
		expect(resolveDisposableWorktreeRoot("/tmp/ws/astrochicken", "proposal")).toBe("/tmp/ws/.hatch-worktrees/proposal");
	});

	it("accepts only approved disposable cleanup roots", () => {
		const repo = "/tmp/ws/astrochicken";
		expect(isApprovedDisposableWorktreePath("/tmp/ws/.hatch-worktrees/wave/run-1", repo)).toBe(true);
		expect(isApprovedDisposableWorktreePath("/tmp/ws/.hatch-worktrees/merge/run-2", repo)).toBe(true);
		expect(isApprovedDisposableWorktreePath("/tmp/ws/.hatch-worktrees/proposal/run-3", repo)).toBe(true);
		expect(isApprovedDisposableWorktreePath("/tmp/ws/random/run-4", repo)).toBe(false);
	});

	it("rejects canonical checkout when HATCH_CANONICAL_CHECKOUT_PATH differs from repo", () => {
		const repo = "/tmp/ws/astrochicken";
		const canonical = "/tmp/ws/canonical-checkout";
		expect(classifyWorktreePath(canonical, repo, canonical)).toMatchObject({
			canonical: true,
			protected: true,
			reason: "canonical_checkout_protected",
		});
	});

	it("rejects repo root even when canonical checkout is elsewhere", () => {
		const repo = "/tmp/ws/astrochicken";
		const canonical = "/tmp/ws/canonical-checkout";
		expect(classifyWorktreePath(repo, repo, canonical)).toMatchObject({
			repoRoot: true,
			protected: true,
			reason: "repo_root_protected",
		});
	});

	it("classifies canonical checkout and repo root as protected", () => {
		const repo = "/tmp/ws/astrochicken";
		expect(classifyWorktreePath(repo, repo)).toMatchObject({
			canonical: true,
			repoRoot: true,
			protected: true,
			reason: "canonical_checkout_protected",
		});
		expect(classifyWorktreePath("/tmp/ws/random/run-4", repo)).toMatchObject({
			approvedDisposable: false,
			protected: true,
			reason: "disposable_worktree_path_not_approved",
		});
		expect(classifyWorktreePath("/tmp/ws/.hatch-worktrees/merge/run-2", repo)).toMatchObject({
			approvedDisposable: true,
			disposableKind: "merge",
			protected: false,
			reason: "",
		});
	});
});
