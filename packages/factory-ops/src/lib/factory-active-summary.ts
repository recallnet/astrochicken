import { join } from "node:path";

import { inspectActiveRunGitSignals } from "./active-run-git-signals.ts";
import { factoryStatus } from "./factory-status-canonical.ts";
import {
  describeOperatorSignals,
  formatFactoryActiveMinimal,
  formatFactoryActiveSummary,
  parseActiveChildrenInState,
  readState,
} from "./factory-status-support.ts";

function parseJson(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function parseJsonArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return [];
  return parseJson(raw, []);
}

function asIssueNumber(value) {
  const n = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function deriveGoalRunProgressState(state = {}, runContext = {}) {
  const context = runContext && typeof runContext === "object" ? runContext : {};
  const lastOutput = parseJson(state?.lastOutput, {});
  const completedIssues = new Set();
  for (const raw of [
    ...parseJsonArray(context.completed_issues),
    ...parseJsonArray(context.processed_issues),
  ]) {
    const issueNumber = asIssueNumber(raw);
    if (issueNumber) completedIssues.add(issueNumber);
  }

  return {
    current_issue_number: asIssueNumber(context.next_issue_number || lastOutput?.next_issue_number),
    completed_issue_numbers: [...completedIssues].sort((left, right) => left - right),
  };
}

function resolveGoalRunIssueAnchor({ state = {}, runContext = {}, runsDir = "" } = {}) {
  const context = runContext && typeof runContext === "object" ? runContext : {};
  const preferredChildRunId = String(context.__child_run_id_execute_issue || "").trim();
  const children = parseActiveChildrenInState(state)
    .filter((child) => String(child.parent_node_id || "").trim() === "execute_issue");
  const selectedChild = children.find((child) => String(child.run_id || "").trim() === preferredChildRunId)
    || children.find((child) => String(child.status || "").trim().toLowerCase() === "running")
    || null;
  if (!selectedChild?.run_id) return { started_at: "", issue_number: null };

  const childState = readState(join(runsDir, selectedChild.run_id)) || {};
  return {
    started_at: String(childState.startedAt || childState.createdAt || "").trim(),
    issue_number: asIssueNumber(childState?.context?.issue_number || childState?.issue_number || childState?.issueNumber),
  };
}

function countWaveFeatureTotals(milestoneIssuesRaw) {
  const items = parseJsonArray(milestoneIssuesRaw);
  if (!Array.isArray(items)) return { total: 0, featureNumbers: new Set() };
  const featureNumbers = new Set();
  for (const item of items) {
    const title = String(item?.title || "");
    if (title.startsWith("Wave Ready:")) continue;
    const num = asIssueNumber(item?.number);
    if (num) featureNumbers.add(num);
  }
  return { total: featureNumbers.size, featureNumbers };
}

function compactGraphLabel(graph = "") {
  const raw = String(graph || "");
  if (!raw) return "";
  const parts = raw.split("/");
  return parts[parts.length - 1] || raw;
}

function shellSingleQuote(value = "") {
  return `'${String(value || "").replace(/'/g, `'\\''`)}'`;
}

function buildTraceCommand(runId = "", runsDir = "") {
  if (!runId) return "";
  const parts = [
    "node packages/factory-ops/src/cli.ts factory session-tail",
    `--run-id ${runId}`,
  ];
  const resolvedRunsDir = String(runsDir || "").trim();
  if (resolvedRunsDir) parts.push(`--runs-dir ${shellSingleQuote(resolvedRunsDir)}`);
  parts.push("--follow");
  return parts.join(" ");
}

function compareActiveSummaryWaves(left = {}, right = {}) {
  const leftMilestone = String(left?.milestone_title || "").trim();
  const rightMilestone = String(right?.milestone_title || "").trim();
  const byMilestone = leftMilestone.localeCompare(rightMilestone, "en");
  if (byMilestone !== 0) return byMilestone;

  const leftIssue = asIssueNumber(left?.current_issue_number) || 0;
  const rightIssue = asIssueNumber(right?.current_issue_number) || 0;
  if (leftIssue !== rightIssue) return leftIssue - rightIssue;

  return String(left?.current_issue_node || "").localeCompare(String(right?.current_issue_node || ""), "en");
}

function resolveSessionTrace(runState = {}, { runSessionsDir = "", childMetadata = undefined } = {}) {
  const children = parseActiveChildrenInState(runState);
  const childId = String(childMetadata?.childId || "").trim();
  if (childId) {
    const match = children.find((child) => String(child.child_id || "").trim() === childId);
    if (match?.session_log) {
      return { sessionLog: String(match.session_log), traceKind: String(match.trace_kind || "") };
    }
  }
  const direct = String(runState?.context?.session_log || runState?.session_log || "").trim();
  const traceKind = String(runState?.context?.trace_kind || runState?.trace_kind || "").trim();
  if (direct) return { sessionLog: direct, traceKind };
  return {
    sessionLog: runSessionsDir ? join(runSessionsDir, "session.jsonl") : "",
    traceKind,
  };
}

function resolveTraceInfo(runState, runsDir, runId, childMetadata = null) {
  const { sessionLog, traceKind } = resolveSessionTrace(runState, {
    runSessionsDir: join(runsDir, runId, "sessions"),
    childMetadata: childMetadata || undefined,
  });
  if (!sessionLog) {
    return {
      trace_available: false,
      trace_kind: "none",
      trace_command: "",
      trace_session_log: "",
    };
  }
  return {
    trace_available: true,
    trace_kind: traceKind,
    trace_command: buildTraceCommand(runId, runsDir),
    trace_session_log: sessionLog,
  };
}

const LIVE_ATTACH_TRACE_KINDS = new Set(["coder", "reviewer", "manager", "judge", "llm"]);

function resolveSessionIdFromContext(ctx = {}) {
  if (!ctx || typeof ctx !== "object") return "";
  return String(ctx.agent_session_id || ctx.session_id || ctx["hatch.session_id"] || "").trim();
}

function sanitizeLiveAttachTarget(raw = {}) {
  const target = raw && typeof raw === "object" ? raw : {};
  const normalized = {
    factory_id: String(target.factory_id || "").trim(),
    run_id: String(target.run_id || "").trim(),
    wave_run_id: String(target.wave_run_id || "").trim(),
    trace_kind: String(target.trace_kind || "").trim(),
    session_id: String(target.session_id || "").trim(),
    child_id: String(target.child_id || "").trim(),
    parent_node_id: String(target.parent_node_id || "").trim(),
    node: String(target.node || "").trim(),
    graph_label: String(target.graph_label || "").trim(),
    worker_index: Number.isFinite(Number(target.worker_index)) ? Number(target.worker_index) : null,
  };

  const compact = {};
  for (const [key, value] of Object.entries(normalized)) {
    if (value === "" || value === null || value === undefined) continue;
    compact[key] = value;
  }
  return compact;
}

function buildLiveAttachProjection({
  trace_available = false,
  trace_kind = "",
  target = {},
} = {}) {
  const normalizedTraceKind = String(trace_kind || "").trim().toLowerCase();
  const normalizedTarget = sanitizeLiveAttachTarget({ ...target, trace_kind: normalizedTraceKind || target.trace_kind });
  const liveAttachable = Boolean(trace_available)
    && LIVE_ATTACH_TRACE_KINDS.has(normalizedTraceKind)
    && Boolean(String(normalizedTarget.run_id || "").trim());

  return {
    live_attachable: liveAttachable,
    live_attach_target: liveAttachable ? normalizedTarget : null,
  };
}

function selectTraceChild(run = {}, byId = new Map()) {
  const activeChildren = Array.isArray(run.active_children) ? run.active_children : [];
  for (const child of activeChildren) {
    const runId = String(child?.run_id || "").trim();
    if (!runId) continue;
    const childRun = byId.get(runId);
    if (childRun) return { child, childRun };
  }
  return null;
}

export function factoryActiveSummary({ runsDir = ".hatch/runs", now = Date.now(), context = {} } = {}) {
  const nowMs = Number(now);
  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const status = factoryStatus({ runsDir, context, now: safeNow });
  const byId = new Map(status.active.map((r) => [r.id, r]));
  const waves = [];

  for (const run of status.active) {
    if (!String(run.graph || "").includes("/wave_execute.dot")) continue;

    const state = readState(join(runsDir, run.id)) || {};
    const ctx = state.context || {};
    const milestoneTitle = String(ctx.milestone_title || run.milestone || "");
    const waveIssueNumber = asIssueNumber(ctx.ready_issue_number);

    const { total, featureNumbers } = countWaveFeatureTotals(ctx.milestone_issues);
    const processed = parseJsonArray(ctx.processed_issues);
    const completedSet = new Set();
    for (const raw of processed) {
      const num = asIssueNumber(raw);
      if (num && (featureNumbers.size === 0 || featureNumbers.has(num))) completedSet.add(num);
    }

    let currentIssueNumber = asIssueNumber(ctx.next_issue_number);
    let currentIssueNode = run.node;
    let traceRunId = run.id;
    let traceChildId = "";
    let traceParentNodeId = "";
    let traceChildRole = "";
    let traceChildTraceKind = "";
    let traceChildWorkerIndex = null;
    let traceChildSessionId = "";
    let operatorSignalSourceRun = run;

    const selected = selectTraceChild(run, byId);
    if (selected) {
      const { child, childRun } = selected;
      const childIssue = asIssueNumber(childRun.issue);
      if (childIssue) currentIssueNumber = childIssue;
      currentIssueNode = childRun.node || currentIssueNode;
      traceRunId = childRun.id || traceRunId;
      traceChildId = String(child.child_id || "");
      traceParentNodeId = String(child.parent_node_id || "");
      traceChildRole = String(child.role || "");
      traceChildTraceKind = String(child.trace_kind || "");
      traceChildWorkerIndex = child.worker_index;
      traceChildSessionId = String(child.session_id || "");
      operatorSignalSourceRun = childRun;
    }

    const operatorSignals = describeOperatorSignals(operatorSignalSourceRun, {
      now: safeNow,
      node: currentIssueNode,
    });

    const traceState = readState(join(runsDir, traceRunId)) || {};
    const traceInfo = resolveTraceInfo(traceState, runsDir, traceRunId, {
      childId: traceChildId,
      parentNodeId: traceParentNodeId,
      role: traceChildRole,
      traceKind: traceChildTraceKind,
      workerIndex: traceChildWorkerIndex,
      sessionId: traceChildSessionId,
    });
    const liveAttach = buildLiveAttachProjection({
      trace_available: traceInfo.trace_available,
      trace_kind: traceInfo.trace_kind,
      target: {
        factory_id: String(status?.context?.factory_id || "").trim(),
        run_id: traceRunId,
        wave_run_id: run.id,
        trace_kind: traceInfo.trace_kind,
        session_id: traceChildSessionId || resolveSessionIdFromContext(traceState.context || {}),
        child_id: traceChildId,
        parent_node_id: traceParentNodeId,
        node: currentIssueNode,
        graph_label: compactGraphLabel(run.graph),
        worker_index: traceChildWorkerIndex,
      },
    });

    const executionMode = String(run.goal_execution_mode || "").trim();
    const issueUrls = parseJsonArray(ctx.issue_urls);
    const isDirectGoalExecution = (run.goal_execution_path || "") === "easy"
      && executionMode === "direct"
      && issueUrls.length === 0;

    waves.push({
      wave_run_id: run.id,
      milestone_title: milestoneTitle,
      wave_issue_number: waveIssueNumber,
      current_issue_number: currentIssueNumber,
      current_issue_node: currentIssueNode,
      completed_issues: completedSet.size,
      total_issues: total,
      goal_execution_path: run.goal_execution_path || "unknown",
      goal_execution_mode: executionMode,
      is_direct_goal_execution: isDirectGoalExecution,
      goal_execution_path_version: String(run.goal_execution_path_version || "").trim(),
      classification_version: String(run.classification_version || "").trim(),
      goal_routing_state: run.goal_routing_state && typeof run.goal_routing_state === "object"
        ? { ...run.goal_routing_state }
        : {},
      ...operatorSignals,
      trace_run_id: traceRunId,
      trace_child_id: traceChildId,
      trace_parent_node_id: traceParentNodeId,
      trace_child_role: traceChildRole,
      trace_child_trace_kind: traceChildTraceKind,
      trace_child_worker_index: traceChildWorkerIndex,
      trace_available: traceInfo.trace_available,
      trace_kind: traceInfo.trace_kind,
      trace_command: traceInfo.trace_command,
      trace_session_log: traceInfo.trace_session_log,
      live_attachable: liveAttach.live_attachable,
      live_attach_target: liveAttach.live_attach_target,
    });
  }

  const nonWaveActive = status.active
    .filter((run) => !String(run.graph || "").includes("/wave_execute.dot"))
    .map((run) => {
      const state = readState(join(runsDir, run.id)) || {};
      const runContext = state.context && typeof state.context === "object" ? state.context : {};
      const issueAnchor = resolveGoalRunIssueAnchor({ state, runContext, runsDir });
      const goalRunProgress = deriveGoalRunProgressState(state, runContext);
      const traceInfo = resolveTraceInfo(state, runsDir, run.id);
      const operatorSignals = describeOperatorSignals(run, {
        now: safeNow,
        node: run.node,
      });
      const worktreeDir = String(runContext.worktree_dir || "").trim();
      const branch = String(runContext.branch || "").trim();
      const snapshotSha = String(runContext.snapshot_sha || "").trim();
      // @context:regression Parent goal runs can span multiple issue slices.
      // Burn detection must anchor to the active child issue start, or a
      // thrashing current slice is masked by commits from earlier completed slices.
      const gitSignals = inspectActiveRunGitSignals({
        worktreeDir,
        snapshotSha,
        startedAt: issueAnchor.started_at || String(run.started_at || run.startedAt || state.startedAt || "").trim(),
        now: safeNow,
      });
      const liveAttach = buildLiveAttachProjection({
        trace_available: traceInfo.trace_available,
        trace_kind: traceInfo.trace_kind,
        target: {
          factory_id: String(status?.context?.factory_id || "").trim(),
          run_id: run.id,
          trace_kind: traceInfo.trace_kind,
          session_id: resolveSessionIdFromContext(state.context || {}),
          node: run.node,
          graph_label: compactGraphLabel(run.graph),
        },
      });
      return {
        run_id: run.id,
        node: run.node,
        graph: run.graph,
        graph_label: compactGraphLabel(run.graph),
        issue_number: asIssueNumber(run.issue),
        goal_issue_number: asIssueNumber(state.context?.goal_issue_number),
        current_issue_number: issueAnchor.issue_number || goalRunProgress.current_issue_number,
        completed_issues: goalRunProgress.completed_issue_numbers.length,
        completed_issue_numbers: goalRunProgress.completed_issue_numbers,
        milestone_title: String(run.milestone || ""),
        age: run.age,
        goal_execution_path: run.goal_execution_path || "unknown",
        goal_execution_mode: String(run.goal_execution_mode || "").trim(),
        goal_execution_path_version: String(run.goal_execution_path_version || "").trim(),
        classification_version: String(run.classification_version || "").trim(),
        goal_routing_state: run.goal_routing_state && typeof run.goal_routing_state === "object"
          ? { ...run.goal_routing_state }
          : {},
        worktree_dir: worktreeDir,
        branch,
        snapshot_sha: snapshotSha,
        ...operatorSignals,
        git_progress_status: String(gitSignals.status || "").trim(),
        git_progress_reason: String(gitSignals.reason || "").trim(),
        no_git_delta_since_start: gitSignals.no_git_delta_since_start === true,
        worktree_clean: gitSignals.worktree_clean,
        commits_ahead: gitSignals.commits_ahead,
        issue_commits_since_snapshot: gitSignals.issue_commits_since_snapshot,
        issue_changed_files: Array.isArray(gitSignals.issue_changed_files) ? gitSignals.issue_changed_files : [],
        head_commit_sha: String(gitSignals.head_commit_sha || "").trim(),
        head_commit_at: String(gitSignals.head_commit_at || "").trim(),
        trace_run_id: run.id,
        trace_available: traceInfo.trace_available,
        trace_kind: traceInfo.trace_kind,
        trace_command: traceInfo.trace_command,
        trace_session_log: traceInfo.trace_session_log,
        live_attachable: liveAttach.live_attachable,
        live_attach_target: liveAttach.live_attach_target,
      };
    });

  waves.sort(compareActiveSummaryWaves);

  return {
    context: status.context,
    generated_at: new Date(safeNow).toISOString(),
    active_run_count: status.active.length,
    active_wave_count: waves.length,
    managed_state: status.managed_state || null,
    blocked_control_plane: Array.isArray(status.blocked_control_plane) ? status.blocked_control_plane : [],
    control_plane: status.control_plane || null,
    waves,
    non_wave_active: nonWaveActive,
  };
}

export {
  formatFactoryActiveMinimal,
  formatFactoryActiveSummary,
};
