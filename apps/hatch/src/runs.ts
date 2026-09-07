import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";

import {
	presentFactoryStatus,
	presentTickStatus,
	renderFactoryPresentation,
	type ActiveRunLike,
	type FactoryStatusLike,
} from "./factory/status-presenter.js";
import { isApprovedDisposableWorktreePath } from "./factory/worktree-path-policy.js";
import { resetGuardBudgets } from "./pipeline/guard.js";
import { sweepLeases } from "./pipeline/lock.js";
import {
	loadRunState,
	listRuns,
	saveRunState,
	isStaleRun,
	isPidAlive,
	cleanupRun,
	latestTickArtifact,
	runsDir as defaultRunsDir,
	type RunState,
} from "./pipeline/run.js";
import { applyRuntimeRecoverySweep, scanRuntimeRecoverySweep } from "./runs-recovery-sweep.js";

const LEGACY_RUNS_DIR_HINT = ".hatch/runs";

function formatAge(date: Date): string {
	const ms = Date.now() - date.getTime();
	if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
	if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
	if (ms < 86400000) return `${Math.floor(ms / 3600000)}h`;
	return `${Math.floor(ms / 86400000)}d`;
}

function parseModelPolicyContext(context: Record<string, string>): {
	source: string;
	version: string;
	policyPackDir: string;
	defaultProvider: string;
	defaultModel: string;
	allowedModels: string[];
	selectedVia: string;
} | null {
	const source = String(context["model_policy_source"] || "").trim();
	const version = String(context["model_policy_version"] || "").trim();
	const defaultProvider = String(context["model_policy_default_provider"] || "").trim();
	const defaultModel = String(context["model_policy_default_model"] || "").trim();
	const selectedVia = String(context["model_policy_selected_via"] || "").trim();
	const allowedModelsRaw = String(context["model_policy_allowed_models"] || "");
	const policyPackDir = String(context["model_policy_policy_pack_dir"] || "").trim();
	const allowedModels = allowedModelsRaw
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	if (!source && !version && !defaultProvider && !defaultModel && !selectedVia && allowedModels.length === 0) {
		return null;
	}
	return {
		source,
		version,
		policyPackDir,
		defaultProvider,
		defaultModel,
		allowedModels,
		selectedVia,
	};
}

function pickString(...values: Array<string | undefined>): string {
	for (const value of values) {
		const normalized = String(value || "").trim();
		if (normalized) return normalized;
	}
	return "";
}

function parseIssueNumber(value: string): number {
	const parsed = Number.parseInt(String(value || "").trim(), 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseGoalCount(context: Record<string, string>): string {
	const raw = pickString(context["goal_count"], context["goal_issues"]);
	if (!raw) return "";
	const numeric = Number.parseInt(raw, 10);
	if (Number.isFinite(numeric) && numeric > 0) return String(numeric);
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) return String(parsed.length);
	} catch {
		// deterministic fallback below
	}
	return "";
}

function resolvePresenterContext(run: RunState | null = null): Record<string, string> {
	const context = run?.context || {};
	const defaultRuns = defaultRunsDir() || LEGACY_RUNS_DIR_HINT;
	return {
		factory_root: pickString(context["factory_root"], process.env["HATCH_FACTORY_ROOT"], process.env["FACTORY_ROOT"]),
		factory_config_path: pickString(context["factory_config_path"], process.env["HATCH_FACTORY_CONFIG_PATH"], process.env["FACTORY_CONFIG_PATH"]),
		factory_id: pickString(context["factory_id"], process.env["HATCH_FACTORY_ID"], process.env["FACTORY_ID"]),
		target_repo: pickString(
			context["target_repo"],
			process.env["HATCH_TARGET_REPO"],
			process.env["TARGET_REPO"],
			process.env["HATCH_GH_REPO"],
			process.env["GH_REPO"],
			process.env["MOTHERSHIP_REPO"],
		),
		control_plane_repo: pickString(context["control_plane_repo"], process.env["HATCH_CONTROL_PLANE_REPO"], process.env["CONTROL_PLANE_REPO"]),
		runs_dir: pickString(context["runs_dir"], process.env["HATCH_RUNS_DIR"], process.env["RUNS_DIR"], defaultRuns),
		scenarios_root: pickString(context["scenarios_root"], process.env["HATCH_SCENARIOS_ROOT"], process.env["SCENARIOS_ROOT"]),
		factory_mode: pickString(context["factory_mode"], process.env["HATCH_FACTORY_MODE"], process.env["FACTORY_MODE"]),
		factory_mode_source: pickString(context["factory_mode_source"]),
	};
}

function buildRunContext(state: RunState) {
	const context = state.context || {};
	return {
		runId: state.runId,
		keys: Object.keys(context).sort(),
		context,
		modelPolicy: parseModelPolicyContext(context),
	};
}

function buildRunWhy(state: RunState) {
	const stale = isStaleRun(state);
	const status = stale ? "stale" : state.status;
	const updatedAgeMs = Date.now() - new Date(state.updatedAt).getTime();
	const updatedAge = formatAge(new Date(state.updatedAt));
	const pidAlive = isPidAlive(state.pid);
	let explanation = "running normally";
	if (status === "suspended") explanation = "process received SIGINT/SIGTERM and suspended; recover or reconcile required";
	else if (status === "stale") explanation = "PID dead while marked running; recoverable stale run";
	else if (status === "running" && !pidAlive) explanation = "running status with dead PID; stale transition likely imminent";
	else if (status === "running" && updatedAgeMs > 120000) explanation = "running with old heartbeat; likely blocked in long node";
	const runningChildren = Object.entries(state.activeChildren || {}).filter(([, c]) => c.status === "running");
	if (runningChildren.length > 0) {
		const child = runningChildren[0][1];
		explanation = `executing child pipeline ${basename(child.pipelineFile || "")}:${child.currentNode || "?"}`;
	}

	const contextSignals = ["goal_runs", "goal_issues", "goal_count", "ready_results", "final_state_review", "artifact_ingest_result"]
		.filter((k) => Object.prototype.hasOwnProperty.call(state.context || {}, k))
		.map((k) => ({ key: k, value: String((state.context as Record<string, string>)[k] || "").slice(0, 180) }));

	const rec = state.records[state.records.length - 1] as any;
	const lastRecord = rec
		? {
			nodeId: String(rec.nodeId || ""),
			status: String(rec.status || ""),
			durationMs: Number(rec?.outcome?.durationMs || 0),
		}
		: null;

	return {
		runId: state.runId,
		status,
		currentNode: state.currentNode,
		pidAlive,
		updatedAge,
		explanation,
		contextSignals,
		modelPolicy: parseModelPolicyContext(state.context || {}),
		activeChildren: Object.entries(state.activeChildren || {}).map(([name, c]) => ({
			name,
			status: c.status,
			currentNode: c.currentNode || "",
			pipeline: basename(c.pipelineFile || ""),
			failureReason: c.failure?.reason || "",
			failureChildNode: c.failure?.nodeId || "",
			failureChildRun: c.failure?.runId || "",
		})),
		lastRecord,
	};
}

function buildRunDetail(state: RunState) {
	const stale = isStaleRun(state);
	return {
		runId: state.runId,
		pipeline: state.pipelineFile,
		pipelineName: basename(state.pipelineFile),
		status: stale ? "stale" : state.status,
		pid: state.pid,
		pidAlive: isPidAlive(state.pid),
		startedAt: state.startedAt,
		updatedAt: state.updatedAt,
		currentNode: state.currentNode,
		completedNodes: state.completedNodes.length,
		latestTickArtifact: latestTickArtifact(state.runId),
		activeChildren: state.activeChildren,
		locksHeld: state.locksHeld,
		contextKeys: Object.keys(state.context || {}),
	};
}

function printRunDetail(state: RunState): void {
	const isStale = isStaleRun(state);
	console.log(`Run: ${state.runId}`);
	console.log(`  Pipeline:  ${state.pipelineFile}`);
	console.log(`  Status:    ${state.status}${isStale ? " (stale — PID dead)" : ""}`);
	console.log(`  PID:       ${state.pid}${isPidAlive(state.pid) ? " (alive)" : " (dead)"}`);
	console.log(`  Started:   ${state.startedAt}`);
	console.log(`  Updated:   ${state.updatedAt}`);
	console.log(`  Current:   ${state.currentNode}`);
	console.log(`  Completed: ${state.completedNodes.length} nodes`);
	const latestTick = latestTickArtifact(state.runId);
	console.log(`  Latest tick: ${latestTick ?? "(none)"}`);

	if (state.completedNodes.length > 0) {
		console.log("");
		console.log("  Completed nodes:");
		for (const cn of state.completedNodes) {
			console.log(`    ${cn.id} (${cn.completedAt}) ${cn.outputHash}`);
		}
	}

	const children = Object.entries(state.activeChildren);
	if (children.length > 0) {
		console.log("");
		console.log("  Children:");
		for (const [name, child] of children) {
			const wt = child.worktreeDir ? ` worktree=${child.worktreeDir}` : "";
			const failure = child.failure?.reason ? ` reason=${child.failure.reason}` : "";
			console.log(`    ${name}: ${child.status} at ${child.currentNode || "?"}${wt}${failure}`);
		}
	}

	if (state.locksHeld.length > 0) {
		console.log("");
		console.log(`  Locks: ${state.locksHeld.join(", ")}`);
	}

	if (isStale || state.status === "suspended") {
		console.log("");
		console.log(`  Recover: hatch recover ${state.runId}`);
	}
}

function toStatusActiveRow(run: RunState): ActiveRunLike {
	const startedAt = String(run.startedAt || "").trim();
	const updatedAt = String(run.updatedAt || "").trim();
	const updatedAtMs = Date.parse(updatedAt);
	const ageMs = Number.isFinite(updatedAtMs) ? Math.max(0, Date.now() - updatedAtMs) : 0;
	const issue = pickString(run.context["current_issue_number"], run.context["issue_number"], run.context["target_issue_number"]);
	const children = Object.entries(run.activeChildren || {}).map(([name, child]) => ({
		name,
		runId: child.childRunId,
		status: child.status,
		current_node: child.currentNode || "",
	}));
	return {
		id: run.runId,
		run_id: run.runId,
		status: isStaleRun(run) ? "stale" : run.status,
		node: run.currentNode || "?",
		current_node: run.currentNode || "?",
		graph: basename(run.pipelineFile),
		issue,
		milestone: run.context["milestone_title"] || "",
		started_at: startedAt,
		startedAt,
		updated_at: updatedAt,
		updatedAt,
		age_ms: ageMs,
		age: formatAge(new Date(run.updatedAt)),
		children,
		active_children: children,
	};
}

function activeStatusPayloadFromRuns(runs: RunState[], extras: Record<string, unknown> = {}): FactoryStatusLike {
	const active = runs.map(toStatusActiveRow);
	return {
		context: {},
		active,
		runs: active,
		completed: 0,
		failed: 0,
		blocked_control_plane: [],
		managed_state: null,
		control_plane: null,
		...extras,
	};
}

function cmdRunsActive(args: string[]): void {
	const asJson = args.includes("--json");
	const staleArg = args.find((a) => a.startsWith("--stale-seconds="));
	const staleSeconds = staleArg ? Number(staleArg.split("=")[1]) : 60;
	const staleMs = Number.isFinite(staleSeconds) && staleSeconds > 0 ? staleSeconds * 1000 : 60000;

	const active = listRuns().filter((r) => r.status === "running");
	const rows = active.map((run) => {
		const updatedAt = new Date(run.updatedAt);
		const heartbeatStale = Date.now() - updatedAt.getTime() > staleMs;
		const children = Object.entries(run.activeChildren || {}).map(([name, child]) => ({
			name,
			status: child.status,
			currentNode: child.currentNode || "",
			pipeline: basename(child.pipelineFile || ""),
			failureReason: child.failure?.reason || "",
			failureChildNode: child.failure?.nodeId || "",
			failureChildRun: child.failure?.runId || "",
		}));
		return {
			runId: run.runId,
			pipeline: basename(run.pipelineFile),
			status: isStaleRun(run) ? "stale" : run.status,
			currentNode: run.currentNode,
			pid: run.pid,
			pidAlive: isPidAlive(run.pid),
			updatedAt: run.updatedAt,
			updatedAge: formatAge(updatedAt),
			startedAge: formatAge(new Date(run.startedAt)),
			completedNodes: run.completedNodes.length,
			heartbeatStale,
			activeChildren: children,
		};
	});
	const context = resolvePresenterContext(active[0] || null);
	const statusLike = activeStatusPayloadFromRuns(active, {
		context,
		count: rows.length,
		staleSeconds: staleSeconds || 60,
		human_rows: rows,
	});

	if (asJson) {
		process.stdout.write(JSON.stringify(statusLike, null, 2));
		return;
	}

	process.stdout.write(renderFactoryPresentation(presentFactoryStatus(statusLike)));
}

function cmdRunsRecoverable(args: string[]): void {
	const asJson = args.includes("--json");
	const recoverable = listRuns().filter((r) => r.status === "suspended" || isStaleRun(r));
	const rows = recoverable.map((run) => ({
		runId: run.runId,
		pipeline: basename(run.pipelineFile),
		status: isStaleRun(run) ? "stale" : run.status,
		pid: run.pid,
		pidAlive: isPidAlive(run.pid),
		currentNode: run.currentNode,
		updatedAt: run.updatedAt,
		updatedAge: formatAge(new Date(run.updatedAt)),
		startedAge: formatAge(new Date(run.startedAt)),
		completedNodes: run.completedNodes.length,
	}));
	const context = resolvePresenterContext(recoverable[0] || null);
	const statusLike = activeStatusPayloadFromRuns(recoverable, {
		context,
		count: rows.length,
		failed: recoverable.filter((run) => run.status === "suspended" || isStaleRun(run)).length,
		human_rows: rows,
	});

	if (asJson) {
		process.stdout.write(JSON.stringify(statusLike, null, 2));
		return;
	}

	process.stdout.write(renderFactoryPresentation(presentFactoryStatus(statusLike)));
}

function cmdRunsReconcile(args: string[]): void {
	const asJson = args.includes("--json");
	const gc = args.includes("--gc");
	const skipLeaseSweep = args.includes("--no-lease-sweep");
	const abandonArg = args.find((a) => a.startsWith("--abandon-seconds="));
	const abandonSecondsRaw = abandonArg ? Number(abandonArg.split("=")[1]) : 600;
	const abandonSeconds = Number.isFinite(abandonSecondsRaw) && abandonSecondsRaw >= 0 ? abandonSecondsRaw : 600;
	const now = Date.now();

	const recoverable = listRuns().filter((r) => r.status === "suspended" || isStaleRun(r));
	const terminalized: Array<{ runId: string; previousStatus: string; reason: string; ageSeconds: number }> = [];
	let cleaned = 0;

	for (const run of recoverable) {
		const ageSeconds = Math.floor((now - new Date(run.updatedAt).getTime()) / 1000);
		if (ageSeconds < abandonSeconds) continue;

		const previousStatus = isStaleRun(run) ? "stale" : run.status;
		run.status = "failed";
		run.context["__reconcile_reason"] = "recoverable_ttl_exceeded";
		run.context["__reconcile_at"] = new Date(now).toISOString();
		saveRunState(run);
		terminalized.push({ runId: run.runId, previousStatus, reason: "recoverable_ttl_exceeded", ageSeconds });

		if (gc) {
			cleanupRun(run.runId);
			cleaned += 1;
		}
	}

	const leaseSweep = skipLeaseSweep ? null : sweepLeases({ now: new Date(now) });

	if (asJson) {
		process.stdout.write(
			JSON.stringify(
				{
					abandonSeconds,
					terminalizedCount: terminalized.length,
					cleanedCount: cleaned,
					terminalized,
					leaseSweep,
				},
				null,
				2,
			),
		);
		return;
	}

	if (terminalized.length === 0) {
		console.log(`No recoverable runs exceeded abandon TTL (${abandonSeconds}s).`);
	} else {
		for (const row of terminalized) {
			console.log(`Terminalized run ${row.runId} (${row.previousStatus}) reason=${row.reason} age=${row.ageSeconds}s`);
		}
		if (gc) console.log(`Cleaned ${cleaned} terminalized run(s).`);
	}

	if (leaseSweep) {
		if (leaseSweep.reclaimedLeases.length === 0) {
			console.log("No stale leases reclaimed.");
		} else {
			for (const lease of leaseSweep.reclaimedLeases) {
				console.log(
					`Reclaimed lease ${lease.leaseName} reason=${lease.reason} previous_owner=${lease.previousOwnerId ?? "unknown"} artifact=${lease.artifactPath}`,
				);
			}
			console.log(`Lease sweep artifact: ${leaseSweep.sweepArtifactPath}`);
		}
	}
}

function cmdRunsRecoverySweep(args: string[]): void {
	const asJson = args.includes("--json");
	const apply = args.includes("--apply");
	const staleArg = args.find((a) => a.startsWith("--stale-seconds="));
	const runsDirArg = args.find((a) => a.startsWith("--runs-dir="));
	const repoArg = args.find((a) => a.startsWith("--repo="));
	const lockDirArg = args.find((a) => a.startsWith("--lock-dir="));
	const runIdArg = args.find((a) => a.startsWith("--run-id="));
	const worktreeArg = args.find((a) => a.startsWith("--worktree="));
	const branchArg = args.find((a) => a.startsWith("--branch="));
	const skipWorktreeScan = args.includes("--skip-worktree-scan");
	const protectedPaths = args.filter((a) => a.startsWith("--protected-path=")).map((a) => a.split("=").slice(1).join("="));

	const staleSecondsRaw = staleArg ? Number(staleArg.split("=")[1]) : 1200;
	const staleSeconds = Number.isFinite(staleSecondsRaw) && staleSecondsRaw > 0 ? staleSecondsRaw : 1200;
	const runsDir = runsDirArg ? runsDirArg.split("=")[1] : (defaultRunsDir() || LEGACY_RUNS_DIR_HINT);
	const repoPath = repoArg ? repoArg.split("=")[1] : process.cwd();
	const lockDir = lockDirArg ? lockDirArg.split("=")[1] : undefined;
	const runId = runIdArg ? runIdArg.split("=")[1] : "";
	const worktree = worktreeArg ? worktreeArg.split("=")[1] : "";
	const branch = branchArg ? branchArg.split("=")[1] : "";
	const now = new Date();

	const report = scanRuntimeRecoverySweep({
		runsDir,
		repoPath,
		lockDir,
		now,
		staleSeconds,
		runId,
		worktree,
		branch,
		protectedPaths: protectedPaths.length > 0 ? protectedPaths : undefined,
		skipWorktreeScan,
	});
	const applied = apply ? applyRuntimeRecoverySweep({ report, runsDir, now }) : null;
	const ok = applied ? applied.ok : true;

	if (asJson) {
		const json = JSON.stringify({ ok, apply, report, applied }, null, 2);
		for (let pos = 0; pos < json.length; pos += 16384) {
			process.stdout.write(json.slice(pos, pos + 16384));
		}
		if (!ok) process.exit(1);
		return;
	}

	console.log(`Recovery sweep report (${report.schemaVersion})`);
	console.log(`  stale_runs=${report.stats.staleRunCount}`);
	console.log(`  unresolved_active_child_refs=${report.stats.unresolvedActiveChildRefCount}`);
	console.log(`  orphaned_worktrees=${report.stats.orphanedWorktreeCount}`);
	console.log(`  orphaned_branches=${report.stats.orphanedBranchCount}`);
	console.log(`  safe_actions=${report.stats.safeActionCount}`);
	if (!apply) {
		console.log("  Mode: dry-run (add --apply to execute safe actions)");
		return;
	}

	console.log(`  Applied=${applied?.appliedCount || 0} Failed=${applied?.failedCount || 0}`);
	if (!ok) process.exit(1);
}

function cmdRunsLatest(args: string[]): void {
	const asJson = args.includes("--json");
	const pipelineArg = args.find((a) => a.startsWith("--pipeline="));
	const statusArg = args.find((a) => a.startsWith("--status="));
	const pipelineFilter = (pipelineArg ? pipelineArg.split("=")[1] : "").trim().toLowerCase();
	const statusFilter = (statusArg ? statusArg.split("=")[1] : "").trim().toLowerCase();

	const runs = listRuns()
		.filter((r) => !pipelineFilter || basename(r.pipelineFile).toLowerCase().includes(pipelineFilter))
		.filter((r) => {
			if (!statusFilter) return true;
			const status = isStaleRun(r) ? "stale" : r.status;
			return status.toLowerCase() === statusFilter;
		});

	if (runs.length === 0) {
		if (asJson) {
			process.stdout.write(JSON.stringify({ found: false }, null, 2));
			return;
		}
		console.log("No matching runs.");
		return;
	}

	const latest = runs[0];
	if (asJson) {
		process.stdout.write(JSON.stringify({ found: true, run: buildRunDetail(latest) }, null, 2));
		return;
	}
	printRunDetail(latest);
}

function cmdRunsWhy(args: string[]): void {
	const asJson = args.includes("--json");
	const runIdArg = args.find((a) => !a.startsWith("-")) || "";
	const state = runIdArg ? loadRunState(runIdArg) : listRuns()[0] || null;
	if (!state) {
		const payload = {
			context: resolvePresenterContext(null),
			ticks: [],
			found: false,
		};
		if (asJson) {
			process.stdout.write(JSON.stringify(payload, null, 2));
			return;
		}
		process.stdout.write(renderFactoryPresentation(presentTickStatus(payload)));
		return;
	}

	const why = buildRunWhy(state);
	const tickLike = {
		context: resolvePresenterContext(state),
		ticks: [{
			id: why.runId,
			status: why.status,
			stage: why.currentNode || "",
			stageLabel: why.currentNode || "",
			progress: "",
			startedAt: state.startedAt,
			elapsed: why.updatedAge,
			goalCount: parseGoalCount(state.context),
			child: why.activeChildren.length > 0
				? {
					runId: why.activeChildren[0]?.name || "",
					node: why.activeChildren[0]?.currentNode || "",
					status: why.activeChildren[0]?.status || "",
					issue: parseIssueNumber(state.context["issue_number"] || state.context["current_issue_number"] || "") || "",
					milestone: state.context["milestone_title"] || "",
				  }
				: null,
			blocked_control_plane: [],
		}],
		why,
		found: true,
	};

	if (asJson) {
		process.stdout.write(JSON.stringify(tickLike, null, 2));
		return;
	}

	process.stdout.write(renderFactoryPresentation(presentTickStatus(tickLike)));
}

function cmdRunsContext(args: string[]): void {
	const asJson = args.includes("--json");
	const runId = args.find((a) => !a.startsWith("-")) || "";
	if (!runId) {
		console.error("usage: hatch runs context <run-id> [--key=<name>] [--json]");
		process.exit(1);
		return;
	}
	const state = loadRunState(runId);
	if (!state) {
		console.error(`Run "${runId}" not found.`);
		process.exit(1);
		return;
	}
	const keyArg = args.find((a) => a.startsWith("--key="));
	const key = keyArg ? keyArg.split("=")[1] : "";
	if (key) {
		const value = state.context[key] ?? "";
		if (asJson) {
			process.stdout.write(JSON.stringify({ runId, key, value }, null, 2));
			return;
		}
		process.stdout.write(String(value));
		return;
	}

	if (asJson) {
		process.stdout.write(JSON.stringify(buildRunContext(state), null, 2));
		return;
	}
	console.log(Object.keys(state.context || {}).sort().join("\n"));
}

function cmdRunsGuardReset(args: string[]): void {
	const runId = args.find((a) => !a.startsWith("-")) || "";
	if (!runId) {
		console.error("usage: hatch runs guard-reset <run-id> [--actor=<id>] [--force] [--json]");
		process.exit(1);
		return;
	}
	const state = loadRunState(runId);
	if (!state) {
		console.error(`Run "${runId}" not found.`);
		process.exit(1);
		return;
	}

	const actorArg = args.find((a) => a.startsWith("--actor="));
	const actor = actorArg ? actorArg.split("=")[1] : "";
	const force = args.includes("--force");
	const asJson = args.includes("--json");
	const result = resetGuardBudgets({
		runState: state,
		actorId: actor || state.guard.owner.ownerId || `run:${runId}`,
		force,
	});

	if (asJson) {
		process.stdout.write(JSON.stringify(result, null, 2));
		return;
	}

	if (!result.ok) {
		console.error(`Guard reset failed: ${result.reason}`);
		process.exit(1);
		return;
	}

	console.log(`Guard reset applied for run ${runId}.`);
	console.log(`  Artifact: ${result.artifactPath}`);
	console.log(`  Factory scope: ${result.factoryState.factoryScope}`);
	console.log(`  Worker period: ${result.factoryState.workerPeriod}`);
}

async function cmdRunsGc(args: string[]) {
	const cleanWorktrees = args.includes("--worktrees");
	const specificRunId = args.find((a) => !a.startsWith("-"));

	const runs = specificRunId ? [loadRunState(specificRunId)].filter(Boolean) as RunState[] : listRuns();

	let cleaned = 0;
	for (const run of runs) {
		if (run.status === "completed" || run.status === "failed" || isStaleRun(run)) {
			if (cleanWorktrees) {
				for (const [, child] of Object.entries(run.activeChildren)) {
					if (child.worktreeDir && existsSync(child.worktreeDir) && child.branch) {
						try {
							const repoContext = run.context["__worktree_repo"];
							if (repoContext && isApprovedDisposableWorktreePath(child.worktreeDir, repoContext)) {
								execFileSync("git", ["-C", repoContext, "worktree", "remove", child.worktreeDir], { stdio: "pipe" });
								execFileSync("git", ["-C", repoContext, "branch", "-D", child.branch], { stdio: "pipe" });
								console.log(`  Removed worktree: ${child.worktreeDir}`);
							}
						} catch {
							// Best-effort
						}
					}
				}
			}

			cleanupRun(run.runId);
			console.log(`  Cleaned: ${run.runId} (${run.status}${isStaleRun(run) ? "/stale" : ""})`);
			cleaned++;
		}
	}

	console.log(`Cleaned ${cleaned} run(s).`);
}

export async function cmdRuns(args: string[]) {
	if (args.length > 0 && args[0] === "gc") {
		await cmdRunsGc(args.slice(1));
		return;
	}
	if (args.length > 0 && args[0] === "active") {
		cmdRunsActive(args.slice(1));
		return;
	}
	if (args.length > 0 && args[0] === "recoverable") {
		cmdRunsRecoverable(args.slice(1));
		return;
	}
	if (args.length > 0 && args[0] === "reconcile") {
		cmdRunsReconcile(args.slice(1));
		return;
	}
	if (args.length > 0 && args[0] === "recovery-sweep") {
		cmdRunsRecoverySweep(args.slice(1));
		return;
	}
	if (args.length > 0 && args[0] === "latest") {
		cmdRunsLatest(args.slice(1));
		return;
	}
	if (args.length > 0 && args[0] === "why") {
		cmdRunsWhy(args.slice(1));
		return;
	}
	if (args.length > 0 && args[0] === "context") {
		cmdRunsContext(args.slice(1));
		return;
	}
	if (args.length > 0 && args[0] === "guard-reset") {
		cmdRunsGuardReset(args.slice(1));
		return;
	}

	// Show specific run
	if (args.length > 0 && !args[0].startsWith("-")) {
		const state = loadRunState(args[0]);
		if (!state) {
			console.error(`Run "${args[0]}" not found.`);
			process.exit(1);
			return;
		}
		const asJson = args.includes("--json");
		if (asJson) {
			process.stdout.write(JSON.stringify(buildRunDetail(state), null, 2));
			return;
		}
		printRunDetail(state);
		return;
	}

	// List all runs
	const runs = listRuns();
	if (runs.length === 0) {
		console.log("No runs found.");
		return;
	}

	console.log("ID        PIPELINE                        STATUS       AGE        PROGRESS");
	for (const run of runs) {
		const pipelineName = basename(run.pipelineFile);
		let status: string = run.status;
		if (isStaleRun(run)) status = "stale";

		const age = formatAge(new Date(run.startedAt));
		const childCount = Object.keys(run.activeChildren).length;
		const childInfo = childCount > 0 ? ` (${childCount} children)` : "";
		const progress = `${run.completedNodes.length} nodes${childInfo}`;

		console.log(
			`${run.runId.padEnd(10)}${pipelineName.padEnd(32)}${status.padEnd(13)}${age.padEnd(11)}${progress}`,
		);
	}
}
