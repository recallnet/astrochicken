import { formatFactoryContextHeaderLines as formatContextHeaderLines } from "./context-resolver.js";

/**
 * Presenter contract for operator-facing factory status surfaces.
 *
 * Every presenter helper must return deterministic text sections and a canonical JSON
 * payload fragment. Keep these helpers pure (no fs/process/network side effects) so
 * hatch and hatch-ops can reuse identical rendering across control-plane and external
 * factory contexts.
 */
export interface FactoryPresentation<TJson extends object = Record<string, unknown>> {
	sections: string[];
	json: TJson;
}

export interface ActiveRunChildLike {
	runId?: string;
	run_id?: string;
	[key: string]: unknown;
}

export interface ActiveRunLike {
	id?: string;
	run_id?: string;
	node?: string;
	current_node?: string;
	issue?: string | number;
	milestone?: string;
	graph?: string;
	age?: string;
	goal_execution_path?: string;
	children?: ActiveRunChildLike[];
	[key: string]: unknown;
}

export interface FactoryStatusLike extends Record<string, unknown> {
	context?: Record<string, unknown>;
	active?: ActiveRunLike[];
	completed?: number;
	failed?: number;
	open_packets?: Array<Record<string, unknown>>;
	blocked_control_plane?: Array<Record<string, unknown>>;
	managed_state?: Record<string, unknown> | null;
	control_plane?: Record<string, unknown> | null;
	runtime_version?: string;
	kind_version?: string;
	rollout_channel?: string;
	rollout_status?: string;
	upgrade_verification_outcome?: string;
	drift_state?: string;
	gate_reason?: string;
}

export interface FactoryActiveSummaryLike extends Record<string, unknown> {
	context?: Record<string, unknown>;
	active_run_count?: number;
	active_wave_count?: number;
	managed_state?: Record<string, unknown> | null;
	blocked_control_plane?: Array<Record<string, unknown>>;
	control_plane?: Record<string, unknown> | null;
	waves?: Array<Record<string, unknown>>;
	non_wave_active?: Array<Record<string, unknown>>;
	runtime_version?: string;
	kind_version?: string;
	rollout_channel?: string;
	rollout_status?: string;
	upgrade_verification_outcome?: string;
	drift_state?: string;
	gate_reason?: string;
}

export interface TickStatusLike extends Record<string, unknown> {
	context?: Record<string, unknown>;
	error?: string;
	ticks?: Array<Record<string, unknown>>;
	goal_executions?: Array<Record<string, unknown>>;
	goal_execution_summary?: Record<string, unknown>;
}

function formatTickChildLine(
	prefix: string,
	childInput: Record<string, unknown> = {},
): string {
	const child = toRecord(childInput);
	const issue = toString(child["issue"]);
	const issueLabel = issue ? ` #${issue}` : "";
	const milestone = toString(child["milestone"]);
	const milestoneLabel = milestone ? ` [${milestone}]` : "";
	const goalExecutionPath = resolveGoalExecutionPathLabel(
		child["goal_execution_path"],
		child["goal_execution_mode"],
		child["is_direct_goal_execution"],
		child["provisional_hard"] ?? child["provisional"],
		child["goal_routing_state"],
	);
	const goalExecutionPathVersion = resolveGoalExecutionPathVersionLabel(child["goal_execution_path_version"]);
	const planningHold = resolvePlanningHoldLabel(child["planning_state"] ?? toRecord(child["goal_routing_state"])["planning_state"]);
	const goalPathLabel = goalExecutionPath !== "unknown" || planningHold
		? `  goal_execution_path=${goalExecutionPath}  goal_execution_path_version=${goalExecutionPathVersion}${planningHold ? `  planning_state=${planningHold}` : ""}`
		: "";
	const childId = toString(child["runId"] ?? child["run_id"], "(unknown)");
	return `${prefix}${childId.substring(0, 8)}  node=${toString(child["node"], "(unknown node)")}${issueLabel}${milestoneLabel}${goalPathLabel}`;
}

function toString(value: unknown, fallback = ""): string {
	const normalized = String(value ?? "").trim();
	return normalized || fallback;
}

function toNumber(value: unknown, fallback = 0): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toArray<T = Record<string, unknown>>(value: unknown): T[] {
	return Array.isArray(value) ? value as T[] : [];
}

export function formatFactoryContextHeaderLines(context: Record<string, unknown> = {}): string[] {
	return formatContextHeaderLines(context);
}

export function formatControlPlaneGateSection(controlPlane: Record<string, unknown> | null | undefined): string[] {
	const gate = toRecord(controlPlane);
	const canResumeRaw = gate["can_resume"];
	const canResume = typeof canResumeRaw === "boolean"
		? (canResumeRaw ? "true" : "false")
		: "unknown";
	const lines: string[] = [
		`Control plane gate: channel=${toString(gate["selected_channel"], "unknown")} reason=${toString(gate["resume_reason"], "unknown")} can_resume=${canResume}`,
	];

	const requiredFloor = toString(gate["required_release_floor"]);
	if (requiredFloor) lines.push(`  Required release floor: ${requiredFloor}`);

	const manifest = toRecord(gate["manifest"]);
	const manifestPath = toString(manifest["path"]);
	const manifestRef = toString(manifest["ref"]);
	if (manifestPath || manifestRef) {
		lines.push(`  Manifest: ${toString(manifest["source"], "local_fs")} ${manifestPath || "(unavailable)"} @ ${manifestRef || "(unknown)"}`);
	}

	const publish = toRecord(gate["publish"]);
	const publishAssetId = toString(publish["asset_id"]);
	const publishAssetUrl = toString(publish["asset_url"]);
	if (publishAssetId || publishAssetUrl) {
		lines.push(`  Published asset: id=${publishAssetId || "(unknown)"} url=${publishAssetUrl || "(unknown)"}`);
	}

	const resumeWhen = toString(gate["resume_when"]);
	if (resumeWhen) lines.push(`  Resume condition: ${resumeWhen}`);

	return lines;
}

export function formatManagedStateLine(managedState: Record<string, unknown> | null | undefined): string[] {
	const state = toRecord(managedState);
	const lines: string[] = [
		`Managed state: action=${toString(state["state_action"], "none")} health=${toString(state["health_classification"], "unknown")}`,
	];

	const reason = toString(state["reason"]);
	if (reason) lines.push(`  Reason: ${reason}`);

	const retryTarget = toString(state["retry_target"]);
	if (retryTarget) lines.push(`  Retry target: ${retryTarget}`);

	return lines;
}

export function formatRuntimeDriftSection(input: Record<string, unknown> | null | undefined): string[] {
	const value = toRecord(input);
	const runtimeVersion = toString(value["runtime_version"]);
	const kindVersion = toString(value["kind_version"]);
	const channel = toString(value["rollout_channel"]);
	const rolloutStatus = toString(value["rollout_status"]);
	const upgradeVerification = toString(value["upgrade_verification_outcome"]);
	const drift = toString(value["drift_state"]);
	const gateReason = toString(value["gate_reason"]);

	if (!runtimeVersion && !kindVersion && !channel && !rolloutStatus && !upgradeVerification && !drift && !gateReason) {
		return [];
	}

	const lines: string[] = ["Runtime drift:"];
	if (runtimeVersion) lines.push(`  Runtime version: ${runtimeVersion}`);
	if (kindVersion) lines.push(`  Kind version: ${kindVersion}`);
	if (channel) lines.push(`  Channel: ${channel}`);
	if (rolloutStatus) lines.push(`  Rollout status: ${rolloutStatus}`);
	if (upgradeVerification) lines.push(`  Upgrade verification: ${upgradeVerification}`);
	if (drift) lines.push(`  Drift: ${drift}`);
	if (gateReason) lines.push(`  Gate reason: ${gateReason}`);
	return lines;
}

function formatBlockedControlPlaneRows(blockedControlPlane: Array<Record<string, unknown>>): string[] {
	if (blockedControlPlane.length === 0) return [];
	const lines = ["Blocked control-plane work:"];
	for (const item of blockedControlPlane) {
		const wave = toString(item["milestone"], "(no wave)");
		const issueNumber = toNumber(item["issue_number"], 0);
		const issue = issueNumber > 0 ? ` issue=#${issueNumber}` : "";
		const kind = toString(item["blockerKind"], "upstream_bug");
		const ref = toString(item["blockerRef"], "(unspecified)");
		const unblock = toString(item["unblockCondition"], "Wait for control-plane blocker status to change.");
		lines.push(`  - ${wave}${issue}: blocked on ${kind} ${ref} until ${unblock}`);
	}
	return lines;
}

function runIdForRow(run: ActiveRunLike): string {
	return toString(run.id || run.run_id);
}

function childRunId(child: ActiveRunChildLike): string {
	return toString(child.runId || child.run_id);
}

function compactGraphLabel(graph = ""): string {
	const raw = toString(graph);
	if (!raw) return "";
	const parts = raw.replace(/\\/g, "/").split("/");
	const label = parts[parts.length - 1] || raw;
	return label.endsWith(".workflow-source.mjs")
		? label.replace(/\.workflow-source\.mjs$/u, ".dot")
		: label;
}

function isGoalRelatedGraph(graph = ""): boolean {
	const label = compactGraphLabel(graph);
	return label === "goal_execute.dot"
		|| label === "goal_issue_execute.dot"
		|| label === "goal_run.dot";
}

function isProvisionalHardRoutingState(value: unknown): boolean {
	const state = toRecord(value);
	return toString(state["decomposition_state"]).toLowerCase() === "required"
		&& toString(state["planning_state"]).toLowerCase() === "not_required";
}

function resolveGoalExecutionPathLabel(
	value: unknown,
	executionMode?: unknown,
	isDirectGoalExecution?: unknown,
	provisionalHard?: unknown,
	routingState?: unknown,
): string {
	const normalized = toString(value).toLowerCase();
	const mode = toString(executionMode).toLowerCase();
	const direct = isDirectGoalExecution === true;
	const provisional = provisionalHard === true
		|| (normalized === "hard" && isProvisionalHardRoutingState(routingState));
	if (normalized === "easy" || normalized === "medium" || normalized === "hard") {
		if (normalized === "easy" && (mode === "direct" || direct)) return "easy (direct)";
		if (normalized === "hard" && provisional) return "hard (provisional)";
		return normalized;
	}
	return "unknown";
}

function resolveGoalExecutionPathVersionLabel(value: unknown): string {
	const normalized = toString(value);
	return normalized || "unknown";
}

function resolvePlanningHoldLabel(value: unknown): string {
	const normalized = toString(value).toLowerCase();
	if (normalized === "pending_review") return "pending_review";
	if (normalized === "approved") return "approved";
	return "";
}

export function formatActiveRunTreeRows(activeRuns: ActiveRunLike[] = []): string[] {
	if (activeRuns.length === 0) return [];

	const byId = new Map<string, ActiveRunLike>();
	for (const run of activeRuns) {
		const id = runIdForRow(run);
		if (!id) continue;
		byId.set(id, run);
	}

	const childIds = new Set<string>();
	for (const run of activeRuns) {
		for (const child of toArray<ActiveRunChildLike>(run.children)) {
			const id = childRunId(child);
			if (id) childIds.add(id);
		}
	}

	const roots = activeRuns.filter((run) => !childIds.has(runIdForRow(run)));
	const lines: string[] = [];
	const printed = new Set<string>();

	const printRun = (run: ActiveRunLike, indent: number, lineage: Set<string>) => {
		const runId = runIdForRow(run);
		if (!runId) return;
		if (lineage.has(runId)) {
			const prefix = indent > 0 ? `${"  ".repeat(indent)}└─ ` : "";
			lines.push(`${prefix}${runId.slice(0, 8)}  (cycle detected)`);
			printed.add(runId);
			return;
		}

		const prefix = indent > 0 ? `${"  ".repeat(indent)}└─ ` : "";
		const issueValue = toString(run.issue);
		const issue = issueValue ? ` #${issueValue}` : "";
		const milestone = toString(run.milestone);
		const milestoneLabel = milestone ? ` [${milestone}]` : "";
		const graph = toString(run.graph);
		const graphLabel = graph ? `(${graph})` : "";
		const node = toString(run.node || run.current_node, "(unknown node)");
		const age = toString(run.age);
		const ageLabel = age ? `  ${age} ago` : "";
		const planningHold = resolvePlanningHoldLabel(run["planning_state"] ?? toRecord(run["goal_routing_state"])["planning_state"]);
		const goalPathLabel = isGoalRelatedGraph(graph)
			? `  goal_execution_path=${resolveGoalExecutionPathLabel(run.goal_execution_path, run["goal_execution_mode"], run["is_direct_goal_execution"], run["provisional_hard"] ?? run["provisional"], run["goal_routing_state"])}  goal_execution_path_version=${resolveGoalExecutionPathVersionLabel(run.goal_execution_path_version)}${planningHold ? `  planning_state=${planningHold}` : ""}`
			: "";
		lines.push(`${prefix}${runId.slice(0, 8)}  ${graphLabel}  node=${node}${issue}${milestoneLabel}${ageLabel}${goalPathLabel}`);
		printed.add(runId);

		const nextLineage = new Set(lineage);
		nextLineage.add(runId);
		for (const child of toArray<ActiveRunChildLike>(run.children)) {
			const childId = childRunId(child);
			if (!childId) continue;
			const childRun = byId.get(childId);
			if (!childRun) continue;
			printRun(childRun, indent + 1, nextLineage);
		}
	};

	for (const root of roots) {
		printRun(root, 0, new Set());
	}

	const orphans = activeRuns.filter((run) => !printed.has(runIdForRow(run)));
	if (orphans.length > 0) {
		lines.push("");
		lines.push("Unlinked active runs:");
		for (const orphan of orphans) {
			printRun(orphan, 1, new Set());
		}
	}

	return lines;
}

export function formatTickStageLine(tick: Record<string, unknown> = {}): string {
	const stage = toString(tick["stageLabel"] || tick["stage"], "(unresolved stage)");
	const progress = toString(tick["progress"]);
	return `  Stage: ${stage}  ${progress}`;
}

export function presentFactoryStatus(statusInput: FactoryStatusLike): FactoryPresentation<FactoryStatusLike> {
	const status = toRecord(statusInput) as FactoryStatusLike;
	const lines: string[] = [];
	lines.push(...formatFactoryContextHeaderLines(toRecord(status.context)));
	lines.push(...formatControlPlaneGateSection(toRecord(status.control_plane)));
	lines.push("");
	lines.push(...formatManagedStateLine(toRecord(status.managed_state)));
	const runtimeDriftLines = formatRuntimeDriftSection(status);
	if (runtimeDriftLines.length > 0) {
		lines.push("");
		lines.push(...runtimeDriftLines);
	}
	lines.push("");

	const blockedRows = formatBlockedControlPlaneRows(toArray<Record<string, unknown>>(status.blocked_control_plane));
	if (blockedRows.length > 0) {
		lines.push(...blockedRows);
		lines.push("");
	}

	const openPackets = toArray<Record<string, unknown>>(status.open_packets);
	if (openPackets.length > 0) {
		lines.push("Open durable packets:");
		for (const packet of openPackets.slice(0, 5)) {
			const title = toString(packet["title"], "(untitled packet)");
			const packetType = toString(packet["packet_type"], "packet");
			const runId = toString(packet["run_id"]);
			const pipeline = toString(packet["pipeline"]);
			const path = toString(packet["packet_path"]);
			lines.push(`- ${packetType}  ${title}${runId ? `  run=${runId}` : ""}${pipeline ? `  pipeline=${pipeline}` : ""}`);
			if (path) lines.push(`  ${path}`);
		}
		if (openPackets.length > 5) lines.push(`- ... and ${openPackets.length - 5} more`);
		lines.push("");
	}

	const activeRuns = toArray<ActiveRunLike>(status.active);
	const completed = toNumber(status.completed, 0);
	const failed = toNumber(status.failed, 0);
	if (activeRuns.length === 0) {
		lines.push("No active runs.");
		lines.push(`(${completed} completed, ${failed} failed)`);
		return { sections: lines, json: status };
	}

	lines.push(`Active runs: ${activeRuns.length}  |  Completed: ${completed}  |  Failed: ${failed}`);
	lines.push("");
	lines.push(...formatActiveRunTreeRows(activeRuns));
	return { sections: lines, json: status };
}

export function presentFactoryActiveSummary(summaryInput: FactoryActiveSummaryLike): FactoryPresentation<FactoryActiveSummaryLike> {
	const summary = toRecord(summaryInput) as FactoryActiveSummaryLike;
	const lines: string[] = [];
	lines.push(...formatFactoryContextHeaderLines(toRecord(summary.context)));
	lines.push(...formatControlPlaneGateSection(toRecord(summary.control_plane)));
	lines.push("");
	lines.push(...formatManagedStateLine(toRecord(summary.managed_state)));
	const runtimeDriftLines = formatRuntimeDriftSection(summary);
	if (runtimeDriftLines.length > 0) {
		lines.push("");
		lines.push(...runtimeDriftLines);
	}
	lines.push("");

	const blockedRows = formatBlockedControlPlaneRows(toArray<Record<string, unknown>>(summary.blocked_control_plane));
	if (blockedRows.length > 0) {
		lines.push(...blockedRows);
		lines.push("");
	}

	lines.push(`Active runs: ${toNumber(summary.active_run_count, 0)}`);
	lines.push(`Active waves: ${toNumber(summary.active_wave_count, 0)}`);

	const waves = toArray<Record<string, unknown>>(summary.waves);
	if (waves.length > 0) {
		lines.push("");
		for (const wave of waves) {
			const waveIssue = toString(wave["wave_issue_number"]) || "n/a";
			const currentIssue = toString(wave["current_issue_number"]) || "n/a";
			const childId = toString(wave["trace_child_id"]);
			const childRole = toString(wave["trace_child_role"]);
			const traceIdentity = childId ? ` child_id=${childId}${childRole ? ` role=${childRole}` : ""}` : "";
			const traceAvailable = wave["trace_available"] === true;
			const traceStatus = traceAvailable
				? `trace_kind=${toString(wave["trace_kind"], "run")} trace_run=${toString(wave["trace_run_id"], "n/a")}${traceIdentity}`
				: "trace=unavailable";
			const goalExecutionPath = resolveGoalExecutionPathLabel(
				wave["goal_execution_path"],
				wave["goal_execution_mode"],
				wave["is_direct_goal_execution"],
				wave["provisional_hard"] ?? wave["provisional"],
				wave["goal_routing_state"],
			);
			const goalExecutionPathVersion = resolveGoalExecutionPathVersionLabel(wave["goal_execution_path_version"]);
			const planningHold = resolvePlanningHoldLabel(wave["planning_state"] ?? toRecord(wave["goal_routing_state"])["planning_state"]);
			lines.push(`${toString(wave["milestone_title"], "(no milestone)")}  wave_issue=#${waveIssue}  current_issue=#${currentIssue}  progress=${toNumber(wave["completed_issues"], 0)}/${toNumber(wave["total_issues"], 0)}  node=${toString(wave["current_issue_node"], "(unknown node)")}  goal_execution_path=${goalExecutionPath}  goal_execution_path_version=${goalExecutionPathVersion}${planningHold ? `  planning_state=${planningHold}` : ""}  ${traceStatus}`);
			const traceCommand = toString(wave["trace_command"]);
			if (traceCommand) lines.push(`  ${traceCommand}`);
		}
	}

	const nonWave = toArray<Record<string, unknown>>(summary.non_wave_active);
	if (nonWave.length > 0) {
		lines.push("");
		lines.push("Active non-wave runs:");
		for (const run of nonWave.slice(0, 5)) {
			const issueNumber = toString(run["issue_number"]);
			const issue = issueNumber ? ` #${issueNumber}` : "";
			const milestone = toString(run["milestone_title"]);
			const milestoneLabel = milestone ? ` [${milestone}]` : "";
			const graphLabel = toString(run["graph_label"] || run["graph"], "(unknown graph)");
			const planningHold = resolvePlanningHoldLabel(run["planning_state"] ?? toRecord(run["goal_routing_state"])["planning_state"]);
			const goalExecutionPath = isGoalRelatedGraph(graphLabel)
				? `  goal_execution_path=${resolveGoalExecutionPathLabel(run["goal_execution_path"], run["goal_execution_mode"], run["is_direct_goal_execution"], run["provisional_hard"] ?? run["provisional"], run["goal_routing_state"])}  goal_execution_path_version=${resolveGoalExecutionPathVersionLabel(run["goal_execution_path_version"])}${planningHold ? `  planning_state=${planningHold}` : ""}`
				: "";
			const traceAvailable = run["trace_available"] === true;
			const traceStatus = traceAvailable
				? `trace_kind=${toString(run["trace_kind"], "run")} trace_run=${toString(run["trace_run_id"], "n/a")}`
				: "trace=unavailable";
			const row = `- ${graphLabel}  node=${toString(run["node"], "(unknown node)")}${issue}${milestoneLabel}${goalExecutionPath}  ${toString(run["age"])}  ${traceStatus}`.trim();
			lines.push(row);
			const traceCommand = toString(run["trace_command"]);
			if (traceCommand) lines.push(`  ${traceCommand}`);
		}
		if (nonWave.length > 5) lines.push(`- ... and ${nonWave.length - 5} more`);
	}

	return { sections: lines, json: summary };
}

export function presentTickStatus(resultInput: TickStatusLike): FactoryPresentation<TickStatusLike> {
	const result = toRecord(resultInput) as TickStatusLike;
	const lines: string[] = [...formatFactoryContextHeaderLines(toRecord(result.context))];
	const error = toString(result.error);
	if (error) {
		lines.push(`Error: ${error}`);
		return { sections: lines, json: result };
	}

	const ticks = toArray<Record<string, unknown>>(result.ticks);
	if (ticks.length === 0) {
		lines.push("No supervisor ticks found.");
		return { sections: lines, json: result };
	}

	const latestIsRunning = toString(ticks[0]?.["status"]) === "running";
	for (let i = 0; i < ticks.length; i++) {
		const tick = ticks[i] || {};
		const status = toString(tick["status"]);
		const label = i === 0
			? (status === "running" ? "CURRENT TICK" : "LAST TICK")
			: (latestIsRunning && i === 1 ? "LAST TICK" : `TICK -${i}`);
		const statusIcon = status === "running" ? ">>>" : status === "completed" ? "OK" : "FAIL";

		lines.push(`${label}  ${statusIcon}  ${toString(tick["id"], "(unknown run)")}`);
		lines.push(formatTickStageLine(tick));
		lines.push(`  Elapsed: ${toString(tick["elapsed"], "0s")}  (started ${toString(tick["startedAt"], "(unknown)")})`);

		const stuckWarning = toString(tick["stuck_warning"]);
		if (stuckWarning) {
			lines.push(`  \u26A0 STUCK: ${stuckWarning}`);
		}

		const tickProgress = toRecord(tick["tick_progress"]);
		if (Object.keys(tickProgress).length > 0 && tickProgress["made_progress"] === false) {
			lines.push(`  \u26A0 No progress: ${toString(tickProgress["summary"], "no progress")}`);
		}

		const goalAdmission = toRecord(tick["goal_admission"]);
		const admissionSkippedReasons = toArray<Record<string, unknown>>(goalAdmission["skipped_reasons"]);
		if (admissionSkippedReasons.length > 0) {
			for (const entry of admissionSkippedReasons) {
				const goalNum = toNumber(entry["goal_number"], 0);
				const reason = toString(entry["reason"], "unknown");
				lines.push(`  Skipped goal #${goalNum}: ${reason}`);
			}
		}

		const goalCount = toString(tick["goalCount"]);
		if (goalCount) lines.push(`  Goals: ${goalCount}`);

		const children = toArray<Record<string, unknown>>(tick["children"]);
		if (children.length > 0) {
			const visibleChildren = children.slice(0, 4);
			lines.push(`  Active children: ${children.length}`);
			for (const child of visibleChildren) {
				lines.push(formatTickChildLine("  - ", child));
				const grandchild = toRecord(child["child"]);
				if (Object.keys(grandchild).length > 0) {
					lines.push(formatTickChildLine("    └─ ", grandchild));
				}
			}
			if (children.length > visibleChildren.length) {
				lines.push(`  ... and ${children.length - visibleChildren.length} more`);
			}
		}

		const child = toRecord(tick["child"]);
		if (children.length === 0 && Object.keys(child).length > 0) {
			lines.push(`  Active: ${formatTickChildLine("", child).trim()}`);

			const grandchild = toRecord(child["child"]);
			if (Object.keys(grandchild).length > 0) {
				lines.push(formatTickChildLine("    └─ ", grandchild));
			}
		}

		for (const blocked of toArray<Record<string, unknown>>(tick["blocked_control_plane"])) {
			const wave = toString(blocked["milestone"], "(no wave)");
			const issueNumber = toNumber(blocked["issue_number"], 0);
			const issue = issueNumber > 0 ? ` issue=#${issueNumber}` : "";
			const kind = toString(blocked["blockerKind"], "upstream_bug");
			const ref = toString(blocked["blockerRef"], "(unspecified)");
			const unblock = toString(blocked["unblockCondition"], "Wait for control-plane blocker status to change.");
			lines.push(`  Blocked: ${wave}${issue} on ${kind} ${ref} until ${unblock}`);
		}

		if (i < ticks.length - 1) lines.push("");
	}

	// ── Goal execution health ──────────────────────────────────────────────
	const goalExecs = toArray<Record<string, unknown>>(result.goal_executions);
	const goalSummary = toRecord(result.goal_execution_summary);
	if (goalExecs.length > 0) {
		lines.push("");
		const total = toNumber(goalSummary["total"], goalExecs.length);
		const healthy = toNumber(goalSummary["healthy"], 0);
		const stale = toNumber(goalSummary["stale"], 0);
		const zombie = toNumber(goalSummary["zombie"], 0);

		let summaryTag = `GOAL EXECUTIONS  ${total} active`;
		if (zombie > 0) summaryTag += `  ⚠ ${zombie} zombie`;
		if (stale > 0) summaryTag += `  ${stale} stale`;
		lines.push(summaryTag);

		for (const ge of goalExecs) {
			const health = toString(ge["health"], "?");
			const icon = health === "zombie" ? "☠" : health === "stale" ? "⏳" : "✓";
			const goalNum = toNumber(ge["goalIssueNumber"], 0);
			const goalTag = goalNum > 0 ? `#${goalNum}` : "";
			const node = toString(ge["currentNode"], "?");
			const elapsed = toString(ge["elapsed"], "?");
			const runId = toString(ge["runId"], "?").slice(0, 8);
			const milestone = toString(ge["milestone"]);
			const milestoneTag = milestone ? ` [${milestone}]` : "";
			lines.push(`  ${icon} ${runId}  goal=${goalTag}  node=${node}  elapsed=${elapsed}  health=${health}${milestoneTag}`);
		}
	}

	return { sections: lines, json: result };
}

export function renderFactoryPresentation(presentation: FactoryPresentation): string {
	return presentation.sections.join("\n");
}
