import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { classifyWorktreePath, type WorktreeProtection } from "./factory/worktree-path-policy.js";
import { lockDirPath } from "./pipeline/lock.js";
import { isPidAlive } from "./pipeline/run.js";
import { collectWorktreeCandidateDirs } from "./worktree-candidate-scan.js";

const RUNTIME_RECOVERY_SWEEP_SCHEMA_VERSION = "runtime_recovery_sweep/v1";

type RunStatus = "running" | "completed" | "failed" | "suspended" | "queued" | "guarded" | "guarded_terminal";

type SweepActionType = "terminalize_run" | "clear_active_child_ref" | "remove_worktree" | "delete_branch";

interface ActiveChildRecord {
	childId: string;
	parentNodeId: string;
	childRunId: string;
	childRunDir: string;
	pipelineFile: string;
	role?: "coder" | "reviewer" | "manager" | "judge";
	traceKind?: string;
	workerIndex?: number;
	sessionId?: string;
	branch?: string;
	worktreeDir?: string;
	status: "running" | "completed" | "failed";
	currentNode?: string;
	failure?: {
		reason: "child_failed" | "child_timeout" | "child_aborted" | "";
		childId: string;
		nodeId: string;
		runId: string;
	};
	exportWriteback?: {
		status: "pending" | "applied" | "skipped";
		reason: string;
	};
}

interface ParsedRunState {
	runId: string;
	pipelineFile: string;
	status: RunStatus;
	pid: number;
	updatedAt: string;
	startedAt: string;
	currentNode: string;
	context: Record<string, string>;
	activeChildren: Record<string, ActiveChildRecord>;
}

interface WorktreeRef {
	path: string;
	branch: string;
	repoPath: string;
	runId: string;
}

interface GitWorktreeEntry {
	repoPath: string;
	path: string;
	branch: string;
}

interface WorktreeGitState {
	commitsAhead: number;
	dirty: boolean;
	readable: boolean;
}

export interface RecoverySweepAction {
	type: SweepActionType;
	runId?: string;
	parentRunId?: string;
	nodeId?: string;
	childId?: string;
	traceKind?: string;
	path?: string;
	repoPath?: string;
	branch?: string;
	reason: string;
	worktreeProtection?: WorktreeProtection;
}

export interface RecoverySweepReport {
	schemaVersion: string;
	scannedAt: string;
	runsDir: string;
	repoPath: string;
	staleRuns: Array<{
		runId: string;
		status: string;
		pipeline: string;
		currentNode: string;
		updatedAt: string;
		ageSeconds: number;
		reason: string;
		protectedByLease: boolean;
		terminalizeSafe: boolean;
	}>;
	unresolvedActiveChildRefs: Array<{
		parentRunId: string;
		nodeId: string;
		childId: string;
		traceKind: string;
		childRunId: string;
		childRunDir: string;
		reason: string;
		parentStatus: string;
		childStatus: string;
		protectedByLease: boolean;
		clearSafe: boolean;
	}>;
	orphanedWorktrees: Array<{
		path: string;
		repoPath: string;
		branch: string;
		runId: string;
		reason: string;
		gitTracked: boolean;
		commitsAhead: number;
		dirty: boolean;
		readable: boolean;
		protectedByLease: boolean;
		safeToRemove: boolean;
		worktreeProtection: WorktreeProtection;
	}>;
	orphanedBranches: Array<{
		repoPath: string;
		branch: string;
		runId: string;
		reason: string;
		mergedIntoMain: boolean;
		checkedOutByWorktree: boolean;
		protectedByLease: boolean;
		safeToDelete: boolean;
	}>;
	activeLeaseRunIds: string[];
	safeActions: RecoverySweepAction[];
	stats: {
		staleRunCount: number;
		unresolvedActiveChildRefCount: number;
		orphanedWorktreeCount: number;
		orphanedBranchCount: number;
		safeActionCount: number;
	};
}

export interface ApplyRecoverySweepResult {
	ok: boolean;
	appliedCount: number;
	failedCount: number;
	appliedActions: RecoverySweepAction[];
	failedActions: Array<{ action: RecoverySweepAction; error: string }>;
}

export interface RuntimeRecoverySweepScanOptions {
	runsDir?: string;
	repoPath?: string;
	lockDir?: string;
	now?: Date;
	staleSeconds?: number;
	runId?: string;
	worktree?: string;
	branch?: string;
	protectedPaths?: string[];
	skipWorktreeScan?: boolean;
}

function parseJson<T>(raw: string, fallback: T): T {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

function createChildId(parentNodeId: string, childRunId: string): string {
	const node = String(parentNodeId || "").trim();
	const run = String(childRunId || "").trim();
	if (node && run) return `${node}__${run}`;
	return node || run;
}

function normalizeChildRunId(value: unknown, childRunDir: string): string {
	const explicit = String(value || "").trim();
	if (explicit) return explicit;
	if (!childRunDir) return "";
	return basename(childRunDir);
}

function normalizeParentNodeId(value: unknown, entryKey: string, childRunId: string): string {
	const explicit = String(value || "").trim();
	if (explicit) return explicit;
	const key = String(entryKey || "").trim();
	if (!key) return "";
	if (childRunId && key.endsWith(`__${childRunId}`)) {
		return key.slice(0, Math.max(0, key.length - (`__${childRunId}`).length));
	}
	return key;
}

function normalizeChildId(value: unknown, entryKey: string, parentNodeId: string, childRunId: string): string {
	const explicit = String(value || "").trim();
	if (explicit) return explicit;
	if (parentNodeId && childRunId) return createChildId(parentNodeId, childRunId);
	return String(entryKey || "").trim() || parentNodeId;
}

function normalizeChildRole(value: unknown): ActiveChildRecord["role"] | "" {
	const role = String(value || "").trim().toLowerCase();
	if (role === "coder") return "coder";
	if (role === "reviewer") return "reviewer";
	if (role === "manager") return "manager";
	if (role === "judge") return "judge";
	return "";
}

function normalizeWorkerIndex(value: unknown): number | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) return undefined;
	return Math.floor(parsed);
}

function normalizeRunStatus(value: unknown): RunStatus {
	const status = String(value || "failed").toLowerCase();
	if (status === "running" || status === "completed" || status === "suspended" || status === "queued" || status === "guarded" || status === "guarded_terminal") return status;
	return "failed";
}

function readRunStates(runsDir: string): ParsedRunState[] {
	if (!existsSync(runsDir)) return [];
	return readRunStatesForEntries(runsDir, new Set(readdirSync(runsDir))).sort((a, b) => a.runId.localeCompare(b.runId));
}

function extractJsonStringField(raw: string, key: string): string {
	const prefix = raw.split(`"${key}"`)[0] ?? raw;
	const slice = raw.slice(prefix.length);
	const match = slice.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
	if (!match?.[1]) return "";
	try { return JSON.parse(`"${match[1]}"`); } catch { return ""; }
}

function extractJsonNumberField(raw: string, key: string): number {
	const prefix = raw.split(`"${key}"`)[0] ?? raw;
	const slice = raw.slice(prefix.length);
	const match = slice.match(new RegExp(`"${key}"\\s*:\\s*(-?\\d+)`));
	if (!match?.[1]) return 0;
	const parsed = Number(match[1]);
	return Number.isFinite(parsed) ? parsed : 0;
}

function readRunStateSummary(statePath: string, entry: string): ParsedRunState | null {
	const raw = readFileSync(statePath, "utf8");
	const status = normalizeRunStatus(extractJsonStringField(raw, "status"));
	return {
		runId: extractJsonStringField(raw, "runId") || entry,
		pipelineFile: extractJsonStringField(raw, "pipelineFile") || extractJsonStringField(raw, "pipeline"),
		status,
		pid: extractJsonNumberField(raw, "pid"),
		updatedAt: extractJsonStringField(raw, "updatedAt"),
		startedAt: extractJsonStringField(raw, "startedAt"),
		currentNode: extractJsonStringField(raw, "currentNode"),
		context: {},
		activeChildren: {},
	};
}

function readScopedRunStates(runsDir: string, targetRunId: string): ParsedRunState[] {
	if (!existsSync(runsDir)) return [];
	const runs: ParsedRunState[] = [];
	for (const entry of readdirSync(runsDir)) {
		const statePath = join(runsDir, entry, "state.json");
		if (!existsSync(statePath)) continue;
		if (entry === targetRunId) {
			const [full] = readRunStatesForEntries(runsDir, new Set([entry]));
			if (full) runs.push(full);
			continue;
		}
		const summary = readRunStateSummary(statePath, entry);
		if (summary) runs.push(summary);
	}
	return runs.sort((a, b) => a.runId.localeCompare(b.runId));
}

function readRunStatesForEntries(runsDir: string, entries: Set<string>): ParsedRunState[] {
	const runs: ParsedRunState[] = [];
	for (const entry of readdirSync(runsDir)) {
		if (!entries.has(entry)) continue;
		const statePath = join(runsDir, entry, "state.json");
		if (!existsSync(statePath)) continue;
		const raw = parseJson<Record<string, unknown>>(readFileSync(statePath, "utf8"), {});
		const contextRaw = raw.context && typeof raw.context === "object" ? (raw.context as Record<string, unknown>) : {};
		const context: Record<string, string> = {};
		for (const [key, value] of Object.entries(contextRaw)) {
			context[key] = typeof value === "string" ? value : JSON.stringify(value);
		}

		const childrenRaw = raw.activeChildren && typeof raw.activeChildren === "object"
			? (raw.activeChildren as Record<string, unknown>)
			: {};
		const activeChildren: Record<string, ActiveChildRecord> = {};
		for (const [entryKey, childValue] of Object.entries(childrenRaw)) {
			if (!childValue || typeof childValue !== "object") continue;
			const child = childValue as Record<string, unknown>;
			const statusRaw = String(child.status || "running").toLowerCase();
			const status = statusRaw === "completed" ? "completed" : statusRaw === "failed" ? "failed" : "running";
			const childRunDir = String(child.childRunDir || child.child_run_dir || "");
			const childRunId = normalizeChildRunId(child.childRunId ?? child.child_run_id, childRunDir);
			const parentNodeId = normalizeParentNodeId(child.parentNodeId ?? child.parent_node_id, entryKey, childRunId);
			const childId = normalizeChildId(child.childId ?? child.child_id, entryKey, parentNodeId, childRunId);
			const failureRaw = child.failure && typeof child.failure === "object"
				? (child.failure as Record<string, unknown>)
				: null;
			const reasonRaw = String(failureRaw?.reason || "").trim();
			const failureReason = reasonRaw === "child_timeout"
				? "child_timeout"
				: reasonRaw === "child_aborted"
					? "child_aborted"
					: reasonRaw === "child_failed"
						? "child_failed"
						: "";
			const exportWritebackRaw = child.exportWriteback && typeof child.exportWriteback === "object"
				? (child.exportWriteback as Record<string, unknown>)
				: null;
			const exportWritebackStatusRaw = String(exportWritebackRaw?.status || "").toLowerCase();
			const exportWritebackStatus = exportWritebackStatusRaw === "applied"
				? "applied"
				: exportWritebackStatusRaw === "skipped"
					? "skipped"
					: "pending";
			const role = normalizeChildRole(child.role);
			const workerIndex = normalizeWorkerIndex(child.workerIndex ?? child.worker_index);
			activeChildren[childId] = {
				childId,
				parentNodeId,
				childRunId,
				childRunDir,
				pipelineFile: String(child.pipelineFile || ""),
				role: role || undefined,
				traceKind: child.traceKind || child.trace_kind ? String(child.traceKind || child.trace_kind) : role || undefined,
				workerIndex,
				sessionId: child.sessionId || child.session_id ? String(child.sessionId || child.session_id) : undefined,
				branch: child.branch ? String(child.branch) : undefined,
				worktreeDir: child.worktreeDir ? String(child.worktreeDir) : undefined,
				status,
				currentNode: child.currentNode ? String(child.currentNode) : undefined,
				failure: failureRaw
					? {
						reason: failureReason,
						childId: String(failureRaw.childId || childId),
						nodeId: String(failureRaw.nodeId || ""),
						runId: String(failureRaw.runId || childRunId),
					}
					: undefined,
				exportWriteback: exportWritebackRaw
					? {
						status: exportWritebackStatus,
						reason: String(exportWritebackRaw.reason || ""),
					}
					: undefined,
			};
		}

		runs.push({
			runId: String(raw.runId || entry),
			pipelineFile: String(raw.pipelineFile || raw.pipeline || ""),
			status: normalizeRunStatus(raw.status),
			pid: Number(raw.pid || 0),
			updatedAt: String(raw.updatedAt || ""),
			startedAt: String(raw.startedAt || ""),
			currentNode: String(raw.currentNode || ""),
			context,
			activeChildren,
		});
	}
	return runs;
}

function runAgeSeconds(run: ParsedRunState, nowEpochMs: number): number {
	const updatedEpoch = Date.parse(run.updatedAt || "");
	if (!Number.isFinite(updatedEpoch)) return Number.MAX_SAFE_INTEGER;
	return Math.max(0, Math.floor((nowEpochMs - updatedEpoch) / 1000));
}

function isRunTerminal(status: RunStatus): boolean {
	return status === "completed" || status === "failed" || status === "guarded_terminal";
}

function collectActiveRunIds(runs: ParsedRunState[], staleSeconds: number, nowEpochMs: number): Set<string> {
	const out = new Set<string>();
	for (const run of runs) {
		const ageSeconds = runAgeSeconds(run, nowEpochMs);
		if (run.status === "running" && run.pid > 0 && isPidAlive(run.pid)) {
			out.add(run.runId);
			continue;
		}
		if ((run.status === "queued" || run.status === "guarded") && ageSeconds <= staleSeconds) {
			out.add(run.runId);
		}
	}
	return out;
}

function collectActiveLeaseRunIds(lockDir: string, knownRunIds: Set<string>, nowEpochMs: number): Set<string> {
	const runIds = new Set<string>();
	if (!existsSync(lockDir)) return runIds;
	const entries = readdirSync(lockDir).filter((name) => name.endsWith(".lock")).sort();
	for (const entry of entries) {
		const lease = parseJson<Record<string, unknown>>(readFileSync(join(lockDir, entry), "utf8"), {});
		if (String(lease.status || "") !== "active") continue;
		const expiresAt = Date.parse(String(lease.expiresAt || ""));
		if (Number.isFinite(expiresAt) && expiresAt <= nowEpochMs) continue;
		const ownerId = String(lease.ownerId || "");
		const runFromOwner = ownerId.match(/run:([a-zA-Z0-9_-]+)/)?.[1] || "";
		if (runFromOwner) {
			runIds.add(runFromOwner);
			continue;
		}
		for (const runId of knownRunIds) {
			if (ownerId.includes(runId)) runIds.add(runId);
		}
	}
	return runIds;
}

function normalizePath(pathValue: string): string {
	const trimmed = String(pathValue || "").trim();
	if (!trimmed) return "";
	return resolve(trimmed);
}

function collectWorktreeRefs(runs: ParsedRunState[], defaultRepoPath: string): WorktreeRef[] {
	const refs: WorktreeRef[] = [];
	for (const run of runs) {
		const context = run.context || {};
		const repoPath = normalizePath(context["__worktree_repo"] || defaultRepoPath);
		const defaultBranch = String(context.branch || "").trim();

		const explicitWorktree = normalizePath(context.worktree_dir || "");
		if (explicitWorktree) {
			refs.push({
				path: explicitWorktree,
				branch: defaultBranch,
				repoPath,
				runId: run.runId,
			});
		}

		for (const [key, value] of Object.entries(context)) {
			if (!key.endsWith("_worktree")) continue;
			const path = normalizePath(value);
			if (!path) continue;
			refs.push({
				path,
				branch: defaultBranch,
				repoPath,
				runId: run.runId,
			});
		}

		for (const child of Object.values(run.activeChildren || {})) {
			const path = normalizePath(String(child.worktreeDir || ""));
			if (!path) continue;
			refs.push({
				path,
				branch: String(child.branch || "").trim() || defaultBranch,
				repoPath,
				runId: run.runId,
			});
		}
	}

	const dedup = new Map<string, WorktreeRef>();
	for (const ref of refs) {
		const key = `${ref.path}::${ref.runId}`;
		if (!dedup.has(key)) dedup.set(key, ref);
	}
	return [...dedup.values()].sort((a, b) => {
		if (a.path !== b.path) return a.path.localeCompare(b.path);
		if (a.runId !== b.runId) return a.runId.localeCompare(b.runId);
		return a.branch.localeCompare(b.branch);
	});
}

function tryGit(repoPath: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
	try {
		const stdout = String(execFileSync("git", ["-C", repoPath, ...args], { stdio: "pipe" })).trim();
		return { ok: true, stdout, stderr: "" };
	} catch (err) {
		const stderr = err instanceof Error ? err.message : String(err);
		return { ok: false, stdout: "", stderr };
	}
}

function listGitWorktrees(repoPath: string): GitWorktreeEntry[] {
	const out = tryGit(repoPath, ["worktree", "list", "--porcelain"]);
	if (!out.ok) return [];
	const entries: GitWorktreeEntry[] = [];
	let currentPath = "";
	let currentBranch = "";
	const lines = out.stdout.split(/\r?\n/);
	for (const line of [...lines, ""]) {
		if (!line.trim()) {
			if (currentPath) {
				entries.push({
					repoPath,
					path: normalizePath(currentPath),
					branch: currentBranch,
				});
			}
			currentPath = "";
			currentBranch = "";
			continue;
		}
		if (line.startsWith("worktree ")) currentPath = line.slice("worktree ".length).trim();
		if (line.startsWith("branch refs/heads/")) currentBranch = line.slice("branch refs/heads/".length).trim();
	}
	return entries.filter((entry) => entry.path && entry.path !== normalizePath(repoPath));
}

function inspectWorktreeState(path: string): WorktreeGitState {
	if (!existsSync(path)) return { commitsAhead: 0, dirty: false, readable: false };
	const count = tryGit(path, ["rev-list", "--count", "main..HEAD"]);
	const status = tryGit(path, ["status", "--porcelain"]);
	if (!count.ok || !status.ok) return { commitsAhead: 0, dirty: false, readable: false };
	return {
		commitsAhead: Number(count.stdout || "0") || 0,
		dirty: status.stdout.length > 0,
		readable: true,
	};
}

/**
 * Resolve the bare/common git directory that owns a worktree.
 * Returns the realpath-resolved path to the .git dir (or bare repo) so
 * callers can compare two worktrees' ownership even across macOS symlinks
 * (/var → /private/var).  Returns "" on failure.
 */
function resolveGitCommonDir(worktreePath: string): string {
	const out = tryGit(worktreePath, ["rev-parse", "--git-common-dir"]);
	if (!out.ok) return "";
	const resolved = resolve(worktreePath, out.stdout);
	try {
		return realpathSync(resolved);
	} catch {
		return resolved;
	}
}

function branchExists(repoPath: string, branch: string): boolean {
	if (!branch) return false;
	const out = tryGit(repoPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
	return out.ok;
}

function isMergedIntoMain(repoPath: string, branch: string): boolean {
	if (!branch) return false;
	const out = tryGit(repoPath, ["merge-base", "--is-ancestor", branch, "main"]);
	return out.ok;
}

function sortAction(a: RecoverySweepAction, b: RecoverySweepAction): number {
	const rank: Record<SweepActionType, number> = {
		terminalize_run: 0,
		clear_active_child_ref: 1,
		remove_worktree: 2,
		delete_branch: 3,
	};
	const ar = rank[a.type] ?? 99;
	const br = rank[b.type] ?? 99;
	if (ar !== br) return ar - br;
	if ((a.runId || "") !== (b.runId || "")) return String(a.runId || "").localeCompare(String(b.runId || ""));
	if ((a.parentRunId || "") !== (b.parentRunId || "")) return String(a.parentRunId || "").localeCompare(String(b.parentRunId || ""));
	if ((a.nodeId || "") !== (b.nodeId || "")) return String(a.nodeId || "").localeCompare(String(b.nodeId || ""));
	if ((a.childId || "") !== (b.childId || "")) return String(a.childId || "").localeCompare(String(b.childId || ""));
	if ((a.path || "") !== (b.path || "")) return String(a.path || "").localeCompare(String(b.path || ""));
	if ((a.branch || "") !== (b.branch || "")) return String(a.branch || "").localeCompare(String(b.branch || ""));
	return String(a.reason || "").localeCompare(String(b.reason || ""));
}

export function planRuntimeRecoverySweepActions({
	staleRuns = [],
	unresolvedRefs = [],
	orphanedWorktrees = [],
	orphanedBranches = [],
}: {
	staleRuns?: Array<{ runId: string; terminalizeSafe?: boolean; protectedByLease?: boolean }>;
	unresolvedRefs?: Array<{
		parentRunId: string;
		nodeId: string;
		childId?: string;
		traceKind?: string;
		clearSafe?: boolean;
		protectedByLease?: boolean;
	}>;
	orphanedWorktrees?: Array<{
		path: string;
		repoPath?: string;
		runId?: string;
		safeToRemove?: boolean;
		protectedByLease?: boolean;
		worktreeProtection?: WorktreeProtection;
	}>;
	orphanedBranches?: Array<{ repoPath: string; branch: string; runId?: string; safeToDelete?: boolean; protectedByLease?: boolean }>;
}): RecoverySweepAction[] {
	const actions: RecoverySweepAction[] = [];

	for (const run of staleRuns) {
		if (run.protectedByLease) continue;
		if (run.terminalizeSafe === false) continue;
		actions.push({ type: "terminalize_run", runId: run.runId, reason: "stale_run_record" });
	}

	for (const ref of unresolvedRefs) {
		if (ref.protectedByLease) continue;
		if (ref.clearSafe === false) continue;
		actions.push({
			type: "clear_active_child_ref",
			parentRunId: ref.parentRunId,
			nodeId: ref.nodeId,
			childId: ref.childId || "",
			traceKind: ref.traceKind || "",
			reason: "unresolved_active_child_ref",
		});
	}

	for (const wt of orphanedWorktrees) {
		if (wt.protectedByLease) continue;
		if (!wt.safeToRemove) continue;
		actions.push({
			type: "remove_worktree",
			path: wt.path,
			repoPath: wt.repoPath || "",
			runId: wt.runId,
			reason: "orphaned_worktree",
			worktreeProtection: wt.worktreeProtection,
		});
	}

	for (const branch of orphanedBranches) {
		if (branch.protectedByLease) continue;
		if (!branch.safeToDelete) continue;
		actions.push({
			type: "delete_branch",
			repoPath: branch.repoPath,
			branch: branch.branch,
			runId: branch.runId,
			reason: "orphaned_branch",
		});
	}

	actions.sort(sortAction);
	return actions;
}

export function scanRuntimeRecoverySweep(options: RuntimeRecoverySweepScanOptions = {}): RecoverySweepReport {
	const runsDir = normalizePath(options.runsDir || join(process.cwd(), ".hatch", "runs"));
	const repoPath = normalizePath(options.repoPath || process.cwd());
	const lockDir = normalizePath(options.lockDir || lockDirPath());
	const staleSeconds = Number.isFinite(options.staleSeconds) && Number(options.staleSeconds) > 0 ? Number(options.staleSeconds) : 20 * 60;
	const now = options.now || new Date();
	const nowEpochMs = now.getTime();
	const filterRunId = String(options.runId || "").trim();
	const filterWorktree = normalizePath(options.worktree || "");
	const filterBranch = String(options.branch || "").trim();
	const strictRunScope = Boolean(filterRunId) && !filterWorktree && !filterBranch;
	const protectedPathSet = new Set(
		(options.protectedPaths || []).map((p) => normalizePath(p)).filter(Boolean),
	);
	const skipWorktreeScan = options.skipWorktreeScan === true;

	const runsAll = strictRunScope ? readScopedRunStates(runsDir, filterRunId) : readRunStates(runsDir);
	const runsScope = filterRunId ? runsAll.filter((run) => run.runId === filterRunId) : runsAll;
	const runByIdAll = new Map(runsAll.map((run) => [run.runId, run]));
	const knownRunIdsAll = new Set(runsAll.map((run) => run.runId));
	const activeRunIds = collectActiveRunIds(runsAll, staleSeconds, nowEpochMs);
	const activeLeaseRunIds = collectActiveLeaseRunIds(lockDir, knownRunIdsAll, nowEpochMs);

	const staleRuns = runsScope
		.filter((run) => {
			const ageSeconds = runAgeSeconds(run, nowEpochMs);
			if (run.status === "running" && !isPidAlive(run.pid)) return true;
			if (run.status === "running" && ageSeconds > staleSeconds) return true;
			if ((run.status === "queued" || run.status === "suspended" || run.status === "guarded") && ageSeconds > staleSeconds) {
				return true;
			}
			return false;
		})
		.map((run) => {
			const ageSeconds = runAgeSeconds(run, nowEpochMs);
			const protectedByLease = activeLeaseRunIds.has(run.runId);
			let reason = "stale_run_record";
			// @context:regression !critical A live PID with a stale heartbeat is not an active owner.
			// Example Trading wedged in merge_branch while still claiming a completed artifact_ingest child as
			// running; the recovery sweep must terminalize that parent so the supervisor can re-dispatch.
			if (run.status === "running") reason = isPidAlive(run.pid) ? "stale_heartbeat" : "pid_dead";
			if (run.status === "queued") reason = "queued_ttl_exceeded";
			if (run.status === "suspended") reason = "suspended_ttl_exceeded";
			if (run.status === "guarded") reason = "guarded_ttl_exceeded";
			return {
				runId: run.runId,
				status: run.status,
				pipeline: run.pipelineFile,
				currentNode: run.currentNode,
				updatedAt: run.updatedAt,
				ageSeconds,
				reason,
				protectedByLease,
				terminalizeSafe: !protectedByLease,
			};
		})
		.sort((a, b) => a.runId.localeCompare(b.runId));

	const unresolvedActiveChildRefs = [] as RecoverySweepReport["unresolvedActiveChildRefs"];
	for (const parent of runsScope) {
		for (const [entryKey, child] of Object.entries(parent.activeChildren || {})) {
			if (child.status !== "running") continue;
			const childRunId = String(child.childRunId || (child.childRunDir ? basename(child.childRunDir) : ""));
			const childState = childRunId ? runByIdAll.get(childRunId) : undefined;
			let reason = "";
			if (!childRunId || !childState) reason = "child_run_missing";
			else if (childState.status !== "running") reason = "child_status_mismatch";
			else if (isRunTerminal(parent.status)) reason = "parent_terminal_with_running_child_ref";
			if (!reason) continue;
			const protectedByLease = activeLeaseRunIds.has(parent.runId);
			const parentNodeId = String(child.parentNodeId || normalizeParentNodeId("", entryKey, childRunId));
			const childId = String(child.childId || normalizeChildId("", entryKey, parentNodeId, childRunId));
			const parentAgeSeconds = runAgeSeconds(parent, nowEpochMs);
			const staleRunningParent = parent.status === "running" && parentAgeSeconds > staleSeconds;
			unresolvedActiveChildRefs.push({
				parentRunId: parent.runId,
				nodeId: parentNodeId,
				childId,
				traceKind: String(child.traceKind || child.role || ""),
				childRunId,
				childRunDir: child.childRunDir,
				reason,
				parentStatus: parent.status,
				childStatus: childState?.status || "missing",
				protectedByLease,
				clearSafe: (!activeRunIds.has(parent.runId) || staleRunningParent) && !protectedByLease,
			});
		}
	}
	unresolvedActiveChildRefs.sort((a, b) => {
		if (a.parentRunId !== b.parentRunId) return a.parentRunId.localeCompare(b.parentRunId);
		if (a.nodeId !== b.nodeId) return a.nodeId.localeCompare(b.nodeId);
		return a.childId.localeCompare(b.childId);
	});

	if (skipWorktreeScan) {
		const safeActions = planRuntimeRecoverySweepActions({
			staleRuns,
			unresolvedRefs: unresolvedActiveChildRefs,
			orphanedWorktrees: [],
			orphanedBranches: [],
		});

		return {
			schemaVersion: RUNTIME_RECOVERY_SWEEP_SCHEMA_VERSION,
			scannedAt: now.toISOString(),
			runsDir,
			repoPath,
			staleRuns,
			unresolvedActiveChildRefs,
			orphanedWorktrees: [],
			orphanedBranches: [],
			activeLeaseRunIds: [...activeLeaseRunIds].sort((a, b) => a.localeCompare(b)),
			safeActions,
			stats: {
				staleRunCount: staleRuns.length,
				unresolvedActiveChildRefCount: unresolvedActiveChildRefs.length,
				orphanedWorktreeCount: 0,
				orphanedBranchCount: 0,
				safeActionCount: safeActions.length,
			},
		};
	}

	const allWorktreeRefs = collectWorktreeRefs(runsAll, repoPath);
	const scopedWorktreeRefs = filterRunId ? allWorktreeRefs.filter((ref) => ref.runId === filterRunId) : allWorktreeRefs;
	const scopedPathRefs = new Set(scopedWorktreeRefs.map((ref) => ref.path).filter(Boolean));
	const scopedBranchRefs = new Set(scopedWorktreeRefs.map((ref) => ref.branch).filter(Boolean));

	const worktreeToRunIds = new Map<string, Set<string>>();
	const worktreeToBranch = new Map<string, string>();
	const worktreeToRepo = new Map<string, string>();
	const branchToRunIds = new Map<string, Set<string>>();

	for (const ref of allWorktreeRefs) {
		if (!worktreeToRunIds.has(ref.path)) worktreeToRunIds.set(ref.path, new Set());
		worktreeToRunIds.get(ref.path)?.add(ref.runId);
		if (ref.branch && !worktreeToBranch.has(ref.path)) worktreeToBranch.set(ref.path, ref.branch);
		if (ref.repoPath && !worktreeToRepo.has(ref.path)) worktreeToRepo.set(ref.path, ref.repoPath);
		if (ref.branch) {
			if (!branchToRunIds.has(ref.branch)) branchToRunIds.set(ref.branch, new Set());
			branchToRunIds.get(ref.branch)?.add(ref.runId);
		}
	}

	const repoCandidates = new Set<string>([repoPath]);
	for (const ref of allWorktreeRefs) repoCandidates.add(ref.repoPath || repoPath);
	for (const run of runsAll) {
		const repoFromContext = normalizePath(run.context["__worktree_repo"] || "");
		if (repoFromContext) repoCandidates.add(repoFromContext);
	}

	const gitWorktrees: GitWorktreeEntry[] = [];
	for (const candidateRepo of repoCandidates) {
		for (const entry of listGitWorktrees(candidateRepo)) {
			gitWorktrees.push(entry);
		}
	}
	gitWorktrees.sort((a, b) => {
		if (a.path !== b.path) return a.path.localeCompare(b.path);
		if (a.repoPath !== b.repoPath) return a.repoPath.localeCompare(b.repoPath);
		return a.branch.localeCompare(b.branch);
	});

	for (const entry of gitWorktrees) {
		if (!worktreeToRepo.has(entry.path)) worktreeToRepo.set(entry.path, entry.repoPath);
		if (entry.branch && !worktreeToBranch.has(entry.path)) worktreeToBranch.set(entry.path, entry.branch);
	}

	const nestedWorktrees = new Set<string>();
	for (const candidateRepo of repoCandidates) {
		const root = join(dirname(candidateRepo), ".hatch-worktrees");
		for (const path of collectWorktreeCandidateDirs(root)) {
			nestedWorktrees.add(path);
			if (!worktreeToRepo.has(path)) worktreeToRepo.set(path, candidateRepo);
		}
	}

	const gitWorktreePaths = new Set(gitWorktrees.map((entry) => entry.path));
	const candidatePaths = new Set<string>();
	if (filterWorktree) {
		candidatePaths.add(filterWorktree);
	} else if (strictRunScope) {
		for (const path of scopedPathRefs) candidatePaths.add(path);
	} else {
		for (const path of worktreeToRunIds.keys()) candidatePaths.add(path);
		for (const path of gitWorktreePaths) candidatePaths.add(path);
		for (const path of nestedWorktrees) candidatePaths.add(path);
	}

	if (filterBranch) {
		for (const entry of gitWorktrees) {
			if (entry.branch === filterBranch) candidatePaths.add(entry.path);
		}
		for (const ref of allWorktreeRefs) {
			if (ref.branch === filterBranch) candidatePaths.add(ref.path);
		}
	}

	const staleRunIds = new Set(staleRuns.map((run) => run.runId));
	const sweepRepoGitCommonDir = resolveGitCommonDir(repoPath);
	const orphanedWorktrees = [] as RecoverySweepReport["orphanedWorktrees"];
	for (const path of [...candidatePaths].sort((a, b) => a.localeCompare(b))) {
		if (!existsSync(path)) continue;
		if (filterWorktree && path !== filterWorktree) continue;
		if (strictRunScope && !scopedPathRefs.has(path)) continue;
		// Cross-repo protection: skip worktrees owned by a different git repository.
		// When multiple factories share .hatch-worktrees, each factory's sweep must
		// not touch worktrees belonging to other factories' repos.
		if (sweepRepoGitCommonDir) {
			const worktreeGitCommonDir = resolveGitCommonDir(path);
			if (worktreeGitCommonDir && worktreeGitCommonDir !== sweepRepoGitCommonDir) continue;
		}
		const runIds = [...(worktreeToRunIds.get(path) || new Set<string>())].sort((a, b) => a.localeCompare(b));
		const repoForPath = worktreeToRepo.get(path) || repoPath;
		const branch = worktreeToBranch.get(path) || "";
		if (filterBranch && branch !== filterBranch) continue;
		const protectedByLease = runIds.some((runId) => activeLeaseRunIds.has(runId));
		const linkedToActiveRun = runIds.some((runId) => activeRunIds.has(runId));
		const linkedToStaleRun = runIds.some((runId) => staleRunIds.has(runId));
		const gitTracked = gitWorktreePaths.has(path);
		const state = inspectWorktreeState(path);
		const worktreeProtection = classifyWorktreePath(path, repoForPath, repoForPath);
		const disposableNonGitResidue = !gitTracked && !state.readable;
		const safeToRemove = !linkedToActiveRun
			&& !protectedByLease
			&& !worktreeProtection.protected
			&& (
				disposableNonGitResidue
				|| (state.readable && state.commitsAhead === 0 && !state.dirty)
			);
		const unreferenced = runIds.length === 0;
		if (linkedToActiveRun) continue;
		if (worktreeProtection.canonical) continue;
		if (protectedPathSet.has(normalizePath(path))) continue;
		if (!linkedToStaleRun && !unreferenced) continue;
		orphanedWorktrees.push({
			path,
			repoPath: repoForPath,
			branch,
			runId: runIds[0] || "",
			reason: linkedToStaleRun ? "stale_run_worktree_residue" : "unreferenced_worktree_residue",
			gitTracked,
			commitsAhead: state.commitsAhead,
			dirty: state.dirty,
			readable: state.readable,
			protectedByLease,
			safeToRemove,
			worktreeProtection,
		});
	}

	const branchToCheckedOutPaths = new Map<string, Set<string>>();
	for (const wt of gitWorktrees) {
		if (!wt.branch) continue;
		if (!branchToCheckedOutPaths.has(wt.branch)) branchToCheckedOutPaths.set(wt.branch, new Set());
		branchToCheckedOutPaths.get(wt.branch)?.add(wt.path);
		if (!branchToRunIds.has(wt.branch)) branchToRunIds.set(wt.branch, new Set());
	}
	for (const wt of orphanedWorktrees) {
		if (!wt.branch) continue;
		if (!branchToRunIds.has(wt.branch)) branchToRunIds.set(wt.branch, new Set());
		if (wt.runId) branchToRunIds.get(wt.branch)?.add(wt.runId);
	}

	const orphanedBranches = [] as RecoverySweepReport["orphanedBranches"];
	for (const [branch, runIdSet] of [...branchToRunIds.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		if (!branch) continue;
		if (filterBranch && branch !== filterBranch) continue;
		if (strictRunScope && !scopedBranchRefs.has(branch)) continue;
		const runIds = [...runIdSet].sort((a, b) => a.localeCompare(b));
		const protectedByLease = runIds.some((runId) => activeLeaseRunIds.has(runId));
		const linkedToActiveRun = runIds.some((runId) => activeRunIds.has(runId));
		const linkedToStaleRun = runIds.some((runId) => staleRunIds.has(runId));
		if (linkedToActiveRun) continue;

		let repoForBranch = repoPath;
		for (const wt of orphanedWorktrees) {
			if (wt.branch === branch && wt.repoPath) {
				repoForBranch = wt.repoPath;
				break;
			}
		}

		if (!branchExists(repoForBranch, branch)) continue;
		const mergedIntoMain = isMergedIntoMain(repoForBranch, branch);
		const checkedOutPaths = [...(branchToCheckedOutPaths.get(branch) || new Set())];
		const checkedOutByWorktree = checkedOutPaths.length > 0;
		const checkedOutByRetainedWorktree = checkedOutPaths.some((checkedOutPath) => {
			const matchingOrphan = orphanedWorktrees.find((wt) =>
				wt.path === checkedOutPath || (wt.branch === branch && wt.repoPath === repoForBranch)
			);
			return !matchingOrphan?.safeToRemove;
		});
		const safeToDelete = !checkedOutByRetainedWorktree && !protectedByLease && mergedIntoMain;
		if (!linkedToStaleRun && !orphanedWorktrees.some((wt) => wt.branch === branch)) continue;
		orphanedBranches.push({
			repoPath: repoForBranch,
			branch,
			runId: runIds[0] || "",
			reason: linkedToStaleRun ? "stale_run_branch_residue" : "orphaned_worktree_branch_residue",
			mergedIntoMain,
			checkedOutByWorktree,
			protectedByLease,
			safeToDelete,
		});
	}

	const safeActions = planRuntimeRecoverySweepActions({
		staleRuns,
		unresolvedRefs: unresolvedActiveChildRefs,
		orphanedWorktrees,
		orphanedBranches,
	});

	return {
		schemaVersion: RUNTIME_RECOVERY_SWEEP_SCHEMA_VERSION,
		scannedAt: now.toISOString(),
		runsDir,
		repoPath,
		staleRuns,
		unresolvedActiveChildRefs,
		orphanedWorktrees,
		orphanedBranches,
		activeLeaseRunIds: [...activeLeaseRunIds].sort((a, b) => a.localeCompare(b)),
		safeActions,
		stats: {
			staleRunCount: staleRuns.length,
			unresolvedActiveChildRefCount: unresolvedActiveChildRefs.length,
			orphanedWorktreeCount: orphanedWorktrees.length,
			orphanedBranchCount: orphanedBranches.length,
			safeActionCount: safeActions.length,
		},
	};
}

function loadStatePath(runsDir: string, runId: string): string {
	return join(runsDir, runId, "state.json");
}

function childUpdatedMs(runsDir: string, childRunId: string): number {
	if (!childRunId) return 0;
	const statePath = loadStatePath(runsDir, childRunId);
	if (!existsSync(statePath)) return 0;
	const state = parseJson<Record<string, unknown>>(readFileSync(statePath, "utf8"), {});
	const updatedAt = Date.parse(String(state.updatedAt || ""));
	return Number.isFinite(updatedAt) ? updatedAt : 0;
}

function resolveActiveChildKey(
	activeChildren: Record<string, Record<string, unknown>>,
	args: { childId: string; parentNodeId: string; traceKind: string },
	runsDir: string,
): string {
	if (args.childId && activeChildren[args.childId]) return args.childId;
	if (args.parentNodeId && activeChildren[args.parentNodeId]) return args.parentNodeId;

	const candidates = Object.entries(activeChildren)
		.map(([key, row]) => {
			const childRunDir = String(row.childRunDir || row.child_run_dir || "");
			const childRunId = String(row.childRunId || row.child_run_id || (childRunDir ? basename(childRunDir) : ""));
			const parentNodeId = String(row.parentNodeId || row.parent_node_id || normalizeParentNodeId("", key, childRunId));
			const traceKind = String(row.traceKind || row.trace_kind || row.role || "");
			const status = String(row.status || "");
			return {
				key,
				parentNodeId,
				traceKind,
				status,
				childRunId,
				updatedMs: childUpdatedMs(runsDir, childRunId),
			};
		})
		.filter((candidate) => !args.parentNodeId || candidate.parentNodeId === args.parentNodeId)
		.filter((candidate) => !args.traceKind || candidate.traceKind === args.traceKind);

	if (candidates.length === 0 && args.parentNodeId) {
		const fallback = Object.entries(activeChildren)
			.map(([key, row]) => {
				const childRunDir = String(row.childRunDir || row.child_run_dir || "");
				const childRunId = String(row.childRunId || row.child_run_id || (childRunDir ? basename(childRunDir) : ""));
				const parentNodeId = String(row.parentNodeId || row.parent_node_id || normalizeParentNodeId("", key, childRunId));
				const status = String(row.status || "");
				return {
					key,
					parentNodeId,
					status,
					childRunId,
					updatedMs: childUpdatedMs(runsDir, childRunId),
				};
			})
			.filter((candidate) => candidate.parentNodeId === args.parentNodeId);
		if (fallback.length === 0) return "";
		fallback.sort((a, b) => {
			const runningDelta = (b.status === "running" ? 1 : 0) - (a.status === "running" ? 1 : 0);
			if (runningDelta !== 0) return runningDelta;
			if (a.updatedMs !== b.updatedMs) return b.updatedMs - a.updatedMs;
			return b.key.localeCompare(a.key);
		});
		return fallback[0]?.key || "";
	}

	if (candidates.length === 0) return "";
	candidates.sort((a, b) => {
		const runningDelta = (b.status === "running" ? 1 : 0) - (a.status === "running" ? 1 : 0);
		if (runningDelta !== 0) return runningDelta;
		if (a.updatedMs !== b.updatedMs) return b.updatedMs - a.updatedMs;
		return b.key.localeCompare(a.key);
	});
	return candidates[0]?.key || "";
}

function applyAction(action: RecoverySweepAction, runsDir: string, now: Date): { ok: boolean; error: string } {
	if (action.type === "terminalize_run") {
		const runId = String(action.runId || "");
		if (!runId) return { ok: false, error: "missing_run_id" };
		const statePath = loadStatePath(runsDir, runId);
		if (!existsSync(statePath)) return { ok: false, error: "run_state_missing" };
		const state = parseJson<Record<string, unknown>>(readFileSync(statePath, "utf8"), {});
		state.status = "failed";
		state.updatedAt = now.toISOString();
		const context = state.context && typeof state.context === "object" ? (state.context as Record<string, string>) : {};
		context["__recovery_sweep_reason"] = String(action.reason || "stale_run_record");
		context["__recovery_sweep_at"] = now.toISOString();
		state.context = context;
		writeFileSync(statePath, JSON.stringify(state, null, 2));
		return { ok: true, error: "" };
	}

	if (action.type === "clear_active_child_ref") {
		const runId = String(action.parentRunId || "");
		const nodeId = String(action.nodeId || "");
		const childId = String(action.childId || "");
		const traceKind = String(action.traceKind || "");
		if (!runId || (!nodeId && !childId)) return { ok: false, error: "missing_parent_or_node" };
		const statePath = loadStatePath(runsDir, runId);
		if (!existsSync(statePath)) return { ok: false, error: "parent_run_missing" };
		const state = parseJson<Record<string, unknown>>(readFileSync(statePath, "utf8"), {});
		const activeChildren = state.activeChildren && typeof state.activeChildren === "object"
			? (state.activeChildren as Record<string, Record<string, unknown>>)
			: {};
		const targetKey = resolveActiveChildKey(activeChildren, { childId, parentNodeId: nodeId, traceKind }, runsDir);
		if (!targetKey) return { ok: true, error: "" };
		const target = activeChildren[targetKey];
		target.status = "failed";
		const childRunDir = String(target.childRunDir || target.child_run_dir || "");
		const childRunId = String(target.childRunId || target.child_run_id || (childRunDir ? basename(childRunDir) : ""));
		const resolvedParentNodeId = String(target.parentNodeId || target.parent_node_id || nodeId || normalizeParentNodeId("", targetKey, childRunId));
		const resolvedChildId = String(target.childId || target.child_id || createChildId(resolvedParentNodeId, childRunId) || targetKey);
		target.childId = resolvedChildId;
		target.parentNodeId = resolvedParentNodeId;
		target.childRunId = childRunId;
		target.failure = {
			reason: "child_failed",
			childId: resolvedChildId,
			nodeId: String(target.currentNode || ""),
			runId: childRunId,
		};
		target.exportWriteback = {
			status: "skipped",
			reason: "child_failed",
		};
		activeChildren[targetKey] = target;
		state.activeChildren = activeChildren;
		state.updatedAt = now.toISOString();
		writeFileSync(statePath, JSON.stringify(state, null, 2));
		return { ok: true, error: "" };
	}

	if (action.type === "remove_worktree") {
		const path = normalizePath(String(action.path || ""));
		if (!path) return { ok: false, error: "missing_worktree_path" };
		if (!existsSync(path)) return { ok: true, error: "" };
		const repoPath = normalizePath(String(action.repoPath || ""));
		const worktreeProtection = action.worktreeProtection || classifyWorktreePath(path, repoPath, repoPath);
		if (worktreeProtection.protected) {
			return { ok: false, error: worktreeProtection.reason || "protected_worktree_remove_blocked" };
		}
		// On macOS, .canonical-checkout markers may have BSD uchg (immutable) flags
		// that prevent git worktree remove and rmSync from succeeding. Strip them first.
		if (process.platform === "darwin") {
			try { execFileSync("chflags", ["-R", "nouchg", path], { stdio: "ignore" }); } catch {}
		}
		if (repoPath) {
			// Best-effort git worktree remove; if it fails (e.g. orphaned worktree
			// no longer tracked by git), fall through to rmSync.
			tryGit(repoPath, ["worktree", "remove", path, "--force"]);
		}
		if (existsSync(path)) {
			try { rmSync(path, { recursive: true, force: true }); } catch {}
		}
		if (existsSync(path)) return { ok: false, error: "worktree_remove_failed" };
		return { ok: true, error: "" };
	}

	if (action.type === "delete_branch") {
		const repoPath = normalizePath(String(action.repoPath || ""));
		const branch = String(action.branch || "").trim();
		if (!repoPath || !branch) return { ok: false, error: "missing_repo_or_branch" };
		if (!branchExists(repoPath, branch)) return { ok: true, error: "" };
		const result = tryGit(repoPath, ["branch", "-D", branch]);
		if (result.ok || !branchExists(repoPath, branch)) return { ok: true, error: "" };
		return { ok: false, error: "branch_delete_failed" };
	}

	return { ok: false, error: "unknown_action_type" };
}

export function applyRuntimeRecoverySweep({
	report,
	runsDir,
	now,
}: {
	report: RecoverySweepReport;
	runsDir?: string;
	now?: Date;
}): ApplyRecoverySweepResult {
	const actions = Array.isArray(report?.safeActions) ? report.safeActions : [];
	const resolvedRunsDir = normalizePath(runsDir || report.runsDir || join(process.cwd(), ".hatch", "runs"));
	const nowDate = now || new Date();
	const appliedActions: RecoverySweepAction[] = [];
	const failedActions: Array<{ action: RecoverySweepAction; error: string }> = [];

	for (const action of actions) {
		const out = applyAction(action, resolvedRunsDir, nowDate);
		if (out.ok) appliedActions.push(action);
		else failedActions.push({ action, error: out.error });
	}

	return {
		ok: failedActions.length === 0,
		appliedCount: appliedActions.length,
		failedCount: failedActions.length,
		appliedActions,
		failedActions,
	};
}
