import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	applyRuntimeRecoverySweep,
	planRuntimeRecoverySweepActions,
	scanRuntimeRecoverySweep,
} from "./runs-recovery-sweep.js";
import { cmdRuns } from "./runs.js";

const GRAPH_PATHS = {
	waveIssueExecute: "docs/contracts/workflow-ir/mothership/wave_issue_execute.dot",
	waveExecute: "docs/contracts/workflow-ir/mothership/wave_execute.dot",
	factorySupervisorTick: "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot",
} as const;

function git(args: string[], cwd: string): string {
	return String(execFileSync("git", args, { cwd, stdio: "pipe" })).trim();
}

function recoveryRunState(overrides: Record<string, unknown>): Record<string, unknown> {
	return {
		pipelineFile: GRAPH_PATHS.waveIssueExecute,
		status: "running",
		pid: 999999,
		updatedAt: "2026-01-01T00:00:00.000Z",
		startedAt: "2026-01-01T00:00:00.000Z",
		currentNode: "build",
		activeChildren: {},
		completedNodes: [],
		locksHeld: [],
		records: [],
		...overrides,
	};
}

function writeRunState(runsDir: string, runId: string, state: Record<string, unknown>): void {
	const runDir = join(runsDir, runId);
	mkdirSync(runDir, { recursive: true });
	writeFileSync(join(runDir, "state.json"), JSON.stringify(state, null, 2));
}

function writeLease(lockDir: string, leaseName: string, lease: Record<string, unknown>): void {
	mkdirSync(lockDir, { recursive: true });
	writeFileSync(join(lockDir, `${leaseName}.lock`), JSON.stringify(lease, null, 2));
}

async function captureStdout(run: () => Promise<void>): Promise<string> {
	const chunks: string[] = [];
	const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
		chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk));
		return true;
	}) as typeof process.stdout.write);

	try {
		await run();
	} finally {
		spy.mockRestore();
	}

	return chunks.join("");
}

function shuffle<T>(items: T[], seed: number): T[] {
	const out = [...items];
	let x = seed >>> 0;
	for (let i = out.length - 1; i > 0; i -= 1) {
		x = (1664525 * x + 1013904223) >>> 0;
		const j = x % (i + 1);
		const tmp = out[i] as T;
		out[i] = out[j] as T;
		out[j] = tmp;
	}
	return out;
}

describe("runtime recovery sweep", () => {
	let root: string;
	let repo: string;
	let runsDir: string;
	let lockDir: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "hatch-runtime-recovery-sweep-"));
		repo = join(root, "repo");
		runsDir = join(root, ".hatch", "runs");
		lockDir = join(root, ".hatch", "locks");
		mkdirSync(repo, { recursive: true });
		mkdirSync(runsDir, { recursive: true });
		mkdirSync(lockDir, { recursive: true });

		git(["init", "-b", "main"], repo);
		git(["config", "user.email", "hatch@example.com"], repo);
		git(["config", "user.name", "Hatch Test"], repo);
		writeFileSync(join(repo, "README.md"), "# test\n");
		git(["add", "README.md"], repo);
		git(["commit", "-m", "init"], repo);
	});

	afterEach(() => {
		if (process.platform === "darwin") {
			try { execFileSync("chflags", ["-R", "nouchg", root], { stdio: "ignore" }); } catch {}
		}
		rmSync(root, { recursive: true, force: true });
	});

	it("hatch runs recovery-sweep --json returns canonical scan report shape", async () => {
		const output = await captureStdout(async () => {
			await cmdRuns([
				"recovery-sweep",
				"--json",
				`--runs-dir=${runsDir}`,
				`--repo=${repo}`,
			]);
		});

		const payload = JSON.parse(output) as {
			ok: boolean;
			report: {
				schemaVersion: string;
				staleRuns: unknown[];
				unresolvedActiveChildRefs: unknown[];
				orphanedWorktrees: Array<{ worktreeProtection?: { protected?: boolean; reason?: string } }>;
				orphanedBranches: unknown[];
			};
		};
		expect(payload.ok).toBe(true);
		expect(payload.report.schemaVersion).toBe("runtime_recovery_sweep/v1");
		expect(Array.isArray(payload.report.staleRuns)).toBe(true);
		expect(Array.isArray(payload.report.unresolvedActiveChildRefs)).toBe(true);
		expect(Array.isArray(payload.report.orphanedWorktrees)).toBe(true);
		expect(payload.report.orphanedWorktrees.every((entry) => typeof entry.worktreeProtection?.protected === "boolean")).toBe(true);
		expect(Array.isArray(payload.report.orphanedBranches)).toBe(true);
	});

	it("scoped run-id sweep never emits actions for non-target active run artifacts", () => {
		const targetWorktree = join(root, ".hatch-worktrees", "wave", "target-run");
		const otherWorktree = join(root, ".hatch-worktrees", "wave", "other-active");
		mkdirSync(dirname(targetWorktree), { recursive: true });
		git(["worktree", "add", "-b", "wave/target-run", targetWorktree, "main"], repo);
		git(["worktree", "add", "-b", "wave/other-active", otherWorktree, "main"], repo);

		writeRunState(runsDir, "target-run", recoveryRunState({
			runId: "target-run",
			context: {
				__worktree_repo: repo,
				worktree_dir: targetWorktree,
				branch: "wave/target-run",
			},
		}));

		writeRunState(runsDir, "other-active", recoveryRunState({
			runId: "other-active",
			pid: process.pid,
			updatedAt: new Date().toISOString(),
			startedAt: new Date().toISOString(),
			context: {
				__worktree_repo: repo,
				worktree_dir: otherWorktree,
				branch: "wave/other-active",
			},
		}));

		const report = scanRuntimeRecoverySweep({
			runsDir,
			repoPath: repo,
			lockDir,
			runId: "target-run",
			now: new Date("2026-01-01T00:30:00.000Z"),
			staleSeconds: 60,
		});

		expect(report.staleRuns.map((run) => run.runId)).toEqual(["target-run"]);
		expect(report.orphanedWorktrees.some((entry) => entry.path === otherWorktree)).toBe(false);
		expect(report.orphanedBranches.some((entry) => entry.branch === "wave/other-active")).toBe(false);
		expect(report.safeActions.some((action) => action.runId === "other-active")).toBe(false);
		expect(report.safeActions.some((action) => action.path === otherWorktree)).toBe(false);
		expect(report.safeActions.some((action) => action.branch === "wave/other-active")).toBe(false);

		expect(report.safeActions.some((action) => action.type === "terminalize_run" && action.runId === "target-run")).toBe(true);
		expect(report.safeActions.some((action) => action.type === "remove_worktree" && action.path === targetWorktree)).toBe(true);
	});

	it("scoped run-id sweep does not fully parse unrelated terminal history", () => {
		const targetWorktree = join(root, ".hatch-worktrees", "wave", "target-only");
		mkdirSync(dirname(targetWorktree), { recursive: true });
		git(["worktree", "add", "-b", "wave/target-only", targetWorktree, "main"], repo);

		writeRunState(runsDir, "target-run", recoveryRunState({
			runId: "target-run",
			context: {
				__worktree_repo: repo,
				worktree_dir: targetWorktree,
				branch: "wave/target-only",
			},
		}));

		writeRunState(runsDir, "historical-heavy", recoveryRunState({
			runId: "historical-heavy",
			pipelineFile: GRAPH_PATHS.factorySupervisorTick,
			status: "completed",
			pid: 0,
			updatedAt: "2026-01-01T00:00:10.000Z",
			currentNode: "done",
			context: {
				huge_snapshot: "x".repeat(20000),
				worktree_dir: join(root, ".hatch-worktrees", "wave", "should-not-load"),
				branch: "wave/should-not-load",
			},
		}));

		const parseSpy = vi.spyOn(JSON, "parse");
		const report = scanRuntimeRecoverySweep({
			runsDir,
			repoPath: repo,
			lockDir,
			runId: "target-run",
			now: new Date("2026-01-01T00:30:00.000Z"),
			staleSeconds: 60,
		});
		const parsedHistoricalRun = parseSpy.mock.calls.some(([raw]) =>
			typeof raw === "string" && raw.includes(`"runId": "historical-heavy"`));
		parseSpy.mockRestore();

		expect(report.staleRuns.map((run) => run.runId)).toEqual(["target-run"]);
		expect(report.orphanedWorktrees.some((entry) => entry.path.includes("should-not-load"))).toBe(false);
		expect(parsedHistoricalRun).toBe(false);
	});

	it("skipWorktreeScan avoids enumerating orphaned worktrees and branches while preserving stale run cleanup", () => {
		const worktreeDir = join(root, ".hatch-worktrees", "wave", "api-only-stale");
		mkdirSync(dirname(worktreeDir), { recursive: true });
		git(["worktree", "add", "-b", "wave/api-only-stale", worktreeDir, "main"], repo);

		writeRunState(runsDir, "api-only-stale", recoveryRunState({
			runId: "api-only-stale",
			context: {
				__worktree_repo: repo,
				worktree_dir: worktreeDir,
				branch: "wave/api-only-stale",
			},
		}));

		const report = scanRuntimeRecoverySweep({
			runsDir,
			repoPath: repo,
			lockDir,
			now: new Date("2026-01-01T00:30:00.000Z"),
			staleSeconds: 60,
			skipWorktreeScan: true,
		});

		expect(report.staleRuns.map((run) => run.runId)).toEqual(["api-only-stale"]);
		expect(report.orphanedWorktrees).toEqual([]);
		expect(report.orphanedBranches).toEqual([]);
		expect(report.safeActions.some((action) => action.type === "terminalize_run" && action.runId === "api-only-stale")).toBe(true);
		expect(report.safeActions.some((action) => action.type === "remove_worktree")).toBe(false);
		expect(report.safeActions.some((action) => action.type === "delete_branch")).toBe(false);
	});

	it("treats namespace-level residue as the orphan candidate without crawling nested junk", () => {
		const residueDir = join(root, ".hatch-worktrees", "merge", "broken-merge-worktree");
		const nestedFakeGitDir = join(residueDir, "node_modules", "fake-package", ".git");
		mkdirSync(dirname(nestedFakeGitDir), { recursive: true });
		writeFileSync(join(residueDir, "README.md"), "residue\n");
		writeFileSync(nestedFakeGitDir, "gitdir: /tmp/not-real\n");

		const report = scanRuntimeRecoverySweep({
			runsDir,
			repoPath: repo,
			lockDir,
			now: new Date("2026-01-01T00:30:00.000Z"),
			staleSeconds: 60,
		});

		expect(report.orphanedWorktrees.some((entry) => entry.path === residueDir)).toBe(true);
		expect(report.orphanedWorktrees.some((entry) => entry.path === dirname(nestedFakeGitDir))).toBe(false);
		expect(report.safeActions.some((action) => action.type === "remove_worktree" && action.path === residueDir)).toBe(true);
	});

	it("returns canonical scan report and applies deterministic-safe cleanup actions", () => {
		const worktreeDir = join(root, ".hatch-worktrees", "wave", "orphan-1");
		mkdirSync(dirname(worktreeDir), { recursive: true });
		git(["worktree", "add", "-b", "wave/orphan-1", worktreeDir, "main"], repo);

		writeRunState(runsDir, "dead-run-1", recoveryRunState({
			runId: "dead-run-1",
			context: {
				__worktree_repo: repo,
				worktree_dir: worktreeDir,
				branch: "wave/orphan-1",
			},
		}));

		writeRunState(runsDir, "parent-run-1", recoveryRunState({
			runId: "parent-run-1",
			pipelineFile: GRAPH_PATHS.factorySupervisorTick,
			status: "failed",
			pid: process.pid,
			updatedAt: "2026-01-01T00:02:00.000Z",
			currentNode: "wave_execute",
			context: {},
			activeChildren: {
				wave_execute: {
					childRunDir: join(runsDir, "missing-child-run"),
					pipelineFile: GRAPH_PATHS.waveExecute,
					status: "running",
					currentNode: "start",
				},
			},
		}));

		const report = scanRuntimeRecoverySweep({
			runsDir,
			repoPath: repo,
			lockDir,
			now: new Date("2026-01-01T00:30:00.000Z"),
			staleSeconds: 60,
		});

		expect(report.schemaVersion).toBe("runtime_recovery_sweep/v1");
		expect(report.staleRuns.some((run) => run.runId === "dead-run-1")).toBe(true);
		expect(report.unresolvedActiveChildRefs.some((ref) => ref.parentRunId === "parent-run-1")).toBe(true);
		expect(report.orphanedWorktrees.some((entry) => entry.path === worktreeDir)).toBe(true);
		expect(report.orphanedWorktrees.find((entry) => entry.path === worktreeDir)?.worktreeProtection).toMatchObject({
			approvedDisposable: true,
			disposableKind: "wave",
			protected: false,
		});
		expect(report.orphanedBranches.some((entry) => entry.branch === "wave/orphan-1")).toBe(true);
		expect(report.safeActions.some((action) => action.type === "terminalize_run" && action.runId === "dead-run-1")).toBe(true);
		expect(report.safeActions.some((action) => action.type === "remove_worktree" && action.path === worktreeDir)).toBe(true);
		expect(report.safeActions.find((action) => action.type === "remove_worktree" && action.path === worktreeDir)?.worktreeProtection).toMatchObject({
			approvedDisposable: true,
			protected: false,
		});
		expect(report.safeActions.some((action) => action.type === "clear_active_child_ref" && action.parentRunId === "parent-run-1")).toBe(true);

		const applied = applyRuntimeRecoverySweep({ report, runsDir, now: new Date("2026-01-01T00:31:00.000Z") });
		expect(applied.ok).toBe(true);
		expect(applied.appliedCount).toBeGreaterThanOrEqual(3);

		const deadRun = JSON.parse(readFileSync(join(runsDir, "dead-run-1", "state.json"), "utf-8")) as { status: string };
		expect(deadRun.status).toBe("failed");
		expect(existsSync(worktreeDir)).toBe(false);

		const parent = JSON.parse(readFileSync(join(runsDir, "parent-run-1", "state.json"), "utf-8")) as {
			activeChildren: Record<string, { status?: string; failure?: { reason?: string; nodeId?: string; runId?: string } }>;
		};
		expect(parent.activeChildren.wave_execute?.status).toBe("failed");
		expect(parent.activeChildren.wave_execute?.failure?.reason).toBe("child_failed");
	});

	it("reclaims stale live-pid parents that still reference a terminal child as running", () => {
		writeRunState(runsDir, "goal-parent-stale", recoveryRunState({
			runId: "goal-parent-stale",
			pipelineFile: GRAPH_PATHS.goalExecute,
			pid: process.pid,
			currentNode: "merge_branch",
			context: {},
			activeChildren: {
				artifact_ingest: {
					childId: "artifact_ingest__child-done",
					parentNodeId: "artifact_ingest",
					childRunId: "child-done",
					childRunDir: join(runsDir, "child-done"),
					pipelineFile: GRAPH_PATHS.artifactIngest,
					traceKind: "run",
					status: "running",
					currentNode: "done",
				},
			},
		}));

		writeRunState(runsDir, "child-done", recoveryRunState({
			runId: "child-done",
			pipelineFile: GRAPH_PATHS.artifactIngest,
			status: "completed",
			pid: process.pid,
			updatedAt: "2026-01-01T00:00:05.000Z",
			currentNode: "done",
			context: {},
		}));

		const report = scanRuntimeRecoverySweep({
			runsDir,
			repoPath: repo,
			lockDir,
			now: new Date("2026-01-01T00:30:00.000Z"),
			staleSeconds: 60,
			skipWorktreeScan: true,
		});

		expect(report.staleRuns).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					runId: "goal-parent-stale",
					reason: "stale_heartbeat",
				}),
			]),
		);
		expect(report.unresolvedActiveChildRefs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					parentRunId: "goal-parent-stale",
					childRunId: "child-done",
					reason: "child_status_mismatch",
					clearSafe: true,
				}),
			]),
		);
		expect(report.safeActions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "terminalize_run",
					runId: "goal-parent-stale",
				}),
				expect.objectContaining({
					type: "clear_active_child_ref",
					parentRunId: "goal-parent-stale",
					nodeId: "artifact_ingest",
				}),
			]),
		);

		const applied = applyRuntimeRecoverySweep({ report, runsDir, now: new Date("2026-01-01T00:31:00.000Z") });
		expect(applied.ok).toBe(true);

		const parent = JSON.parse(readFileSync(join(runsDir, "goal-parent-stale", "state.json"), "utf-8")) as {
			status: string;
			activeChildren: Record<string, { status?: string; failure?: { reason?: string } }>;
		};
		expect(parent.status).toBe("failed");
		expect(parent.activeChildren.artifact_ingest?.status).toBe("failed");
		expect(parent.activeChildren.artifact_ingest?.failure?.reason).toBe("child_failed");
	});

	it("does not auto-clean worktrees outside approved disposable roots", () => {
		const unapprovedWorktree = join(root, "scratch-worktrees", "orphan-unsafe");
		mkdirSync(dirname(unapprovedWorktree), { recursive: true });
		git(["worktree", "add", "-b", "wave/orphan-unsafe", unapprovedWorktree, "main"], repo);

		writeRunState(runsDir, "dead-run-unsafe", recoveryRunState({
			runId: "dead-run-unsafe",
			context: {
				__worktree_repo: repo,
				worktree_dir: unapprovedWorktree,
				branch: "wave/orphan-unsafe",
			},
		}));

		const report = scanRuntimeRecoverySweep({
			runsDir,
			repoPath: repo,
			lockDir,
			now: new Date("2026-01-01T00:30:00.000Z"),
			staleSeconds: 60,
		});

		const orphan = report.orphanedWorktrees.find((entry) => entry.path === unapprovedWorktree);
		expect(orphan?.safeToRemove).toBe(false);
		expect(orphan?.worktreeProtection).toMatchObject({
			protected: true,
			reason: "disposable_worktree_path_not_approved",
		});
		expect(report.safeActions.some((action) => action.type === "remove_worktree" && action.path === unapprovedWorktree)).toBe(false);
	});

	it("excludes canonical checkout from orphaned worktree classification and protected removal actions", () => {
		writeRunState(runsDir, "dead-main-run", recoveryRunState({
			runId: "dead-main-run",
			pipelineFile: GRAPH_PATHS.waveExecute,
			currentNode: "merge_shared_branch",
			context: {
				__worktree_repo: repo,
				worktree_dir: repo,
				branch: "main",
			},
		}));

		const report = scanRuntimeRecoverySweep({
			runsDir,
			repoPath: repo,
			lockDir,
			now: new Date("2026-01-01T00:30:00.000Z"),
			staleSeconds: 60,
		});

		expect(report.staleRuns.some((run) => run.runId === "dead-main-run")).toBe(true);
		expect(report.orphanedWorktrees.some((entry) => entry.path === repo)).toBe(false);
		expect(report.safeActions.some((action) => action.type === "remove_worktree" && action.path === repo)).toBe(false);
	});

	it("refuses protected remove_worktree actions without falling back to deletion", () => {
		const protectedPath = repo;
		const report = {
			schemaVersion: "runtime_recovery_sweep/v1",
			scannedAt: new Date("2026-01-01T00:30:00.000Z").toISOString(),
			runsDir,
			repoPath: repo,
			staleRuns: [],
			unresolvedActiveChildRefs: [],
			orphanedWorktrees: [],
			orphanedBranches: [],
			activeLeaseRunIds: [],
			safeActions: [
				{
					type: "remove_worktree",
					path: protectedPath,
					repoPath: repo,
					reason: "orphaned_worktree",
					worktreeProtection: {
						canonical: true,
						repoRoot: true,
						approvedDisposable: false,
						disposableKind: "",
						protected: true,
						reason: "canonical_checkout_protected",
						approvedRoots: [],
					},
				},
			],
			stats: {
				staleRunCount: 0,
				unresolvedActiveChildRefCount: 0,
				orphanedWorktreeCount: 0,
				orphanedBranchCount: 0,
				safeActionCount: 1,
			},
		} as any;

		const applied = applyRuntimeRecoverySweep({ report, runsDir, now: new Date("2026-01-01T00:31:00.000Z") });
		expect(applied.ok).toBe(false);
		expect(applied.failedCount).toBe(1);
		expect(applied.failedActions[0]?.error).toBe("canonical_checkout_protected");
		expect(existsSync(protectedPath)).toBe(true);
	});

	it("clear_active_child_ref resolves canonical child entries by childId and parentNodeId+traceKind fallback", () => {
		writeRunState(runsDir, "parent-canonical", recoveryRunState({
			runId: "parent-canonical",
			pipelineFile: GRAPH_PATHS.factorySupervisorTick,
			status: "failed",
			pid: process.pid,
			updatedAt: "2026-01-01T00:05:00.000Z",
			currentNode: "wave_execute",
			context: {},
			activeChildren: {
				"wave_execute__child-a": {
					childId: "wave_execute__child-a",
					parentNodeId: "wave_execute",
					childRunId: "child-a",
					childRunDir: join(runsDir, "child-a"),
					pipelineFile: GRAPH_PATHS.waveExecute,
					traceKind: "coder",
					status: "running",
					currentNode: "build",
				},
				"wave_execute__child-b": {
					childId: "wave_execute__child-b",
					parentNodeId: "wave_execute",
					childRunId: "child-b",
					childRunDir: join(runsDir, "child-b"),
					pipelineFile: GRAPH_PATHS.waveExecute,
					traceKind: "reviewer",
					status: "running",
					currentNode: "review",
				},
			},
		}));

		writeRunState(runsDir, "child-a", recoveryRunState({
			runId: "child-a",
			pid: process.pid,
			updatedAt: "2026-01-01T00:04:00.000Z",
			context: {},
		}));

		writeRunState(runsDir, "child-b", recoveryRunState({
			runId: "child-b",
			pid: process.pid,
			updatedAt: "2026-01-01T00:05:00.000Z",
			currentNode: "review",
			context: {},
		}));

		const report = {
			schemaVersion: "runtime_recovery_sweep/v1",
			scannedAt: new Date("2026-01-01T00:30:00.000Z").toISOString(),
			runsDir,
			repoPath: repo,
			staleRuns: [],
			unresolvedActiveChildRefs: [],
			orphanedWorktrees: [],
			orphanedBranches: [],
			activeLeaseRunIds: [],
			safeActions: [
				{
					type: "clear_active_child_ref",
					parentRunId: "parent-canonical",
					childId: "wave_execute__child-a",
					nodeId: "wave_execute",
					traceKind: "coder",
					reason: "unresolved_active_child_ref",
				},
				{
					type: "clear_active_child_ref",
					parentRunId: "parent-canonical",
					childId: "",
					nodeId: "wave_execute",
					traceKind: "reviewer",
					reason: "unresolved_active_child_ref",
				},
			],
			stats: {
				staleRunCount: 0,
				unresolvedActiveChildRefCount: 0,
				orphanedWorktreeCount: 0,
				orphanedBranchCount: 0,
				safeActionCount: 2,
			},
		} as any;

		const applied = applyRuntimeRecoverySweep({ report, runsDir, now: new Date("2026-01-01T00:31:00.000Z") });
		expect(applied.ok).toBe(true);
		expect(applied.appliedCount).toBe(2);

		const parent = JSON.parse(readFileSync(join(runsDir, "parent-canonical", "state.json"), "utf-8")) as {
			activeChildren: Record<string, { status?: string; failure?: { childId?: string }; traceKind?: string }>;
		};
		expect(parent.activeChildren["wave_execute__child-a"]?.status).toBe("failed");
		expect(parent.activeChildren["wave_execute__child-a"]?.failure?.childId).toBe("wave_execute__child-a");
		expect(parent.activeChildren["wave_execute__child-b"]?.status).toBe("failed");
		expect(parent.activeChildren["wave_execute__child-b"]?.failure?.childId).toBe("wave_execute__child-b");
	});

	it("does not schedule destructive cleanup when an active lease still references the stale run", () => {
		const worktreeDir = join(root, ".hatch-worktrees", "wave", "lease-protected");
		mkdirSync(dirname(worktreeDir), { recursive: true });
		git(["worktree", "add", "-b", "wave/lease-protected", worktreeDir, "main"], repo);

		writeRunState(runsDir, "lease-protected-run", recoveryRunState({
			runId: "lease-protected-run",
			context: {
				__worktree_repo: repo,
				worktree_dir: worktreeDir,
				branch: "wave/lease-protected",
			},
		}));

		writeLease(lockDir, "lease-protected", {
			schemaVersion: 1,
			leaseName: "lease-protected",
			status: "active",
			ownerId: "run:lease-protected-run",
			hostId: "host-a",
			pid: null,
			generation: 1,
			acquiredAt: "2026-01-01T00:20:00.000Z",
			heartbeatAt: "2026-01-01T00:29:00.000Z",
			heartbeatIntervalMs: 5000,
			ttlMs: 120000,
			expiresAt: "2026-01-01T00:35:00.000Z",
			updatedAt: "2026-01-01T00:29:00.000Z",
		});

		const report = scanRuntimeRecoverySweep({
			runsDir,
			repoPath: repo,
			lockDir,
			now: new Date("2026-01-01T00:30:00.000Z"),
			staleSeconds: 60,
		});

		expect(report.staleRuns.some((run) => run.runId === "lease-protected-run")).toBe(true);
		expect(report.safeActions.some((action) => action.runId === "lease-protected-run")).toBe(false);
		expect(report.safeActions.some((action) => action.type === "remove_worktree" && action.path === worktreeDir)).toBe(false);
		expect(report.safeActions.some((action) => action.type === "delete_branch" && action.branch === "wave/lease-protected")).toBe(false);
	});

	it("distributed host-simulated divergence planner stays deterministic and lease-safe under permutations", () => {
		const base = {
			staleRuns: [
				{ runId: "run-a", protectedByLease: false },
				{ runId: "run-b", protectedByLease: true },
				{ runId: "run-c", protectedByLease: false },
			],
			unresolvedRefs: [
				{ parentRunId: "run-a", nodeId: "child-a", clearSafe: true },
				{ parentRunId: "run-b", nodeId: "child-b", clearSafe: true },
			],
			orphanedWorktrees: [
				{ path: "/tmp/wt-a", runId: "run-a", safeToRemove: true, protectedByLease: false },
				{ path: "/tmp/wt-b", runId: "run-b", safeToRemove: true, protectedByLease: true },
			],
			orphanedBranches: [
				{ repoPath: "/tmp/repo", branch: "wave/a", runId: "run-a", safeToDelete: true, protectedByLease: false },
				{ repoPath: "/tmp/repo", branch: "wave/b", runId: "run-b", safeToDelete: true, protectedByLease: true },
			],
		};

		const expected = planRuntimeRecoverySweepActions(base);
		for (let seed = 1; seed <= 20; seed += 1) {
			const got = planRuntimeRecoverySweepActions({
				staleRuns: shuffle(base.staleRuns, seed),
				unresolvedRefs: shuffle(base.unresolvedRefs, seed + 100),
				orphanedWorktrees: shuffle(base.orphanedWorktrees, seed + 200),
				orphanedBranches: shuffle(base.orphanedBranches, seed + 300),
			});
			expect(got).toEqual(expected);
			expect(got.some((action) => action.runId === "run-b" || action.branch === "wave/b" || action.path === "/tmp/wt-b")).toBe(false);
		}
	});

	it("removes stale worktree directory not tracked by git", () => {
		// Simulate a worktree directory that exists on disk but is not registered
		// with git (e.g. after git worktree prune or manual cleanup).
		const staleDir = join(root, ".hatch-worktrees", "wave", "goal", "stale-orphan");
		mkdirSync(staleDir, { recursive: true });
		writeFileSync(join(staleDir, "README.md"), "stale\n");

		const report = {
			schemaVersion: "runtime_recovery_sweep/v1",
			runsDir,
			staleRuns: [],
			unresolvedActiveChildRefs: [],
			orphanedWorktrees: [],
			orphanedBranches: [],
			safeActions: [
				{
					type: "remove_worktree" as const,
					path: staleDir,
					repoPath: repo,
					runId: "stale-run",
					reason: "orphaned_worktree" as const,
					worktreeProtection: {
						canonical: false,
						repoRoot: false,
						approvedDisposable: true,
						disposableKind: "wave",
						protected: false,
						reason: "",
						approvedRoots: [join(root, ".hatch-worktrees", "wave")],
					},
				},
			],
			stats: { staleRunCount: 0, unresolvedActiveChildRefCount: 0, orphanedWorktreeCount: 1, orphanedBranchCount: 0, safeActionCount: 1 },
		};

		const applied = applyRuntimeRecoverySweep({ report: report as any, runsDir, now: new Date("2026-01-01T00:31:00.000Z") });
		expect(applied.ok).toBe(true);
		expect(applied.appliedCount).toBe(1);
		expect(applied.failedCount).toBe(0);
		expect(existsSync(staleDir)).toBe(false);
	});

	it.skipIf(process.platform !== "darwin")("removes orphaned worktree containing a uchg-flagged .canonical-checkout marker", () => {
		const worktreeDir = join(root, ".hatch-worktrees", "wave", "goal", "uchg-test");
		mkdirSync(dirname(worktreeDir), { recursive: true });
		git(["worktree", "add", "-b", "wave/uchg-test", worktreeDir, "main"], repo);

		// Set uchg flag on a .canonical-checkout marker file inside the worktree
		const markerPath = join(worktreeDir, ".canonical-checkout");
		writeFileSync(markerPath, "This file protects the canonical checkout from accidental deletion.\n");
		execFileSync("chflags", ["uchg", markerPath], { stdio: "ignore" });

		const report = {
			schemaVersion: "runtime_recovery_sweep/v1",
			runsDir,
			staleRuns: [],
			unresolvedActiveChildRefs: [],
			orphanedWorktrees: [],
			orphanedBranches: [],
			safeActions: [
				{
					type: "remove_worktree" as const,
					path: worktreeDir,
					repoPath: repo,
					runId: "uchg-run",
					reason: "orphaned_worktree" as const,
					worktreeProtection: {
						canonical: false,
						repoRoot: false,
						approvedDisposable: true,
						disposableKind: "wave",
						protected: false,
						reason: "",
						approvedRoots: [join(root, ".hatch-worktrees", "wave")],
					},
				},
			],
			stats: { staleRunCount: 0, unresolvedActiveChildRefCount: 0, orphanedWorktreeCount: 1, orphanedBranchCount: 0, safeActionCount: 1 },
		};

		const applied = applyRuntimeRecoverySweep({ report: report as any, runsDir, now: new Date("2026-01-01T00:31:00.000Z") });
		expect(applied.ok).toBe(true);
		expect(applied.appliedCount).toBe(1);
		expect(applied.failedCount).toBe(0);
		expect(existsSync(worktreeDir)).toBe(false);
	});

	it("does not treat cross-repo worktrees as orphaned (multi-factory shared .hatch-worktrees)", () => {
		// Setup: create a second git repo (simulating another factory's target repo)
		const otherRepo = join(root, "other-repo");
		mkdirSync(otherRepo, { recursive: true });
		git(["init", "-b", "main"], otherRepo);
		git(["config", "user.email", "hatch@example.com"], otherRepo);
		git(["config", "user.name", "Hatch Test"], otherRepo);
		writeFileSync(join(otherRepo, "README.md"), "# other repo\n");
		git(["add", "README.md"], otherRepo);
		git(["commit", "-m", "init"], otherRepo);

		// Create a worktree from the OTHER repo in the shared .hatch-worktrees dir
		const crossRepoWorktreeDir = join(root, ".hatch-worktrees", "wave", "goal", "1223");
		mkdirSync(dirname(crossRepoWorktreeDir), { recursive: true });
		git(["worktree", "add", "-b", "wave/goal/1223", crossRepoWorktreeDir, "main"], otherRepo);

		// No runs in THIS factory reference this worktree
		// The sweep for THIS factory (repoPath=repo) should NOT touch the cross-repo worktree

		const report = scanRuntimeRecoverySweep({
			runsDir,
			repoPath: repo,
			lockDir,
			now: new Date("2026-01-01T00:30:00.000Z"),
			staleSeconds: 60,
		});

		// The cross-repo worktree must NOT appear as orphaned
		expect(report.orphanedWorktrees.some((entry) => entry.path === crossRepoWorktreeDir)).toBe(false);
		expect(report.safeActions.some((action) => action.type === "remove_worktree" && action.path === crossRepoWorktreeDir)).toBe(false);

		// Verify the worktree still exists after apply
		const applied = applyRuntimeRecoverySweep({ report, runsDir, now: new Date("2026-01-01T00:31:00.000Z") });
		expect(applied.ok).toBe(true);
		expect(existsSync(crossRepoWorktreeDir)).toBe(true);
	});
});
