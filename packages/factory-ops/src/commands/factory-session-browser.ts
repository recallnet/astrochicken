import { readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { factoryActiveSummary, readAllRunStates } from "./factory-status.ts";
import {
  excerpt,
  parseIsoMs,
  readSessionTail,
  resolveSessionTrace,
} from "../lib/factory-session-log.ts";
import { resolveHistoricalResumeTarget } from "../lib/session-resume.ts";

function trim(value = "") {
  return String(value || "").trim();
}

function formatAge(nowMs, iso = "") {
  const ms = Date.parse(String(iso || ""));
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const diff = Math.max(0, nowMs - ms);
  if (diff < 1000) return `${Math.round(diff)}ms`;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d${hours % 24}h`;
}

function readLastSessionSummary(sessionLog = "") {
  if (!sessionLog) return "";
  try {
    statSync(sessionLog);
  } catch {
    return "";
  }
  const tail = readSessionTail(sessionLog, 1);
  if (trim(tail.latestAssistantText)) return excerpt(tail.latestAssistantText, 120);
  if (tail.toolResults[0]?.output) return excerpt(tail.toolResults[0].output, 120);
  if (tail.toolCalls[0]?.name) return `${tail.toolCalls[0].name}()`;
  try {
    const raw = readFileSync(sessionLog, "utf8").trim().split(/\r?\n/).filter(Boolean).pop() || "";
    return excerpt(raw, 120);
  } catch {
    return "";
  }
}

function normalizeIssue(value = "") {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? `#${num}` : "";
}

function normalizeIssueNumber(value = "") {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function stableCompare(left, right) {
  return String(left || "").localeCompare(String(right || ""), "en");
}

function kindRank(kind = "") {
  switch (trim(kind)) {
    case "supervisor":
      return 0;
    case "goal_run":
      return 1;
    case "goal_issue":
      return 2;
    case "session":
      return 3;
    default:
      return 4;
  }
}

function deriveHistoricalKind(state = {}) {
  const pipeline = basename(trim(state?.pipelineFile || ""));
  const context = state?.context || {};
  if (trim(context.issue_number)) return "goal_issue";
  if (trim(context.goal_issue_number)) return "goal_run";
  if (pipeline === "factory_supervisor_tick.dot") return "supervisor";
  return "session";
}

function buildOpenMode({ liveAttachTarget = null, resumeTarget = null, sessionLog = "" } = {}) {
  if (liveAttachTarget && typeof liveAttachTarget === "object" && trim(liveAttachTarget.run_id)) return "live";
  if (resumeTarget && typeof resumeTarget === "object" && trim(resumeTarget.session_id)) return "resume";
  if (trim(sessionLog)) return "transcript";
  return "none";
}

function buildSessionRow({
  id = "",
  view = "",
  factoryId = "",
  runId = "",
  issueNumber = "",
  goalIssueNumber = "",
  title = "",
  status = "",
  updatedAt = "",
  kind = "",
  progressLabel = "",
  traceKind = "",
  liveAttachTarget = null,
  resumeTarget = null,
  sessionLog = "",
  summary = "",
} = {}, nowMs = Date.now()) {
  const mode = buildOpenMode({ liveAttachTarget, resumeTarget, sessionLog });
  return {
    id,
    view,
    factory_id: trim(factoryId),
    run_id: trim(runId),
    issue: normalizeIssue(issueNumber),
    goal_issue: normalizeIssue(goalIssueNumber),
    issue_number: normalizeIssueNumber(issueNumber),
    goal_issue_number: normalizeIssueNumber(goalIssueNumber),
    title: trim(title) || trim(runId) || "Session",
    kind: trim(kind) || "session",
    status: trim(status) || "unknown",
    progress_label: trim(progressLabel) || trim(traceKind) || "",
    updated_at: trim(updatedAt),
    updated_age: formatAge(nowMs, updatedAt),
    trace_kind: trim(traceKind) || "none",
    live_attach_target: liveAttachTarget || null,
    resume_target: resumeTarget || null,
    session_log: trim(sessionLog),
    mode,
    summary: trim(summary) || readLastSessionSummary(sessionLog) || basename(sessionLog || ""),
  };
}

function buildActiveRows({ summary = {}, nowMs = Date.now(), factoryId = "" } = {}) {
  const rows = [];
  const activeRows = [
    ...(Array.isArray(summary.waves) ? summary.waves : []),
    ...(Array.isArray(summary.non_wave_active) ? summary.non_wave_active : []),
  ];

  for (const row of activeRows) {
    const runId = trim(row.trace_run_id || row.run_id || row.wave_run_id);
    if (!runId) continue;
    const title = trim(row.title || row.issue_title || row.milestone_title)
      || (row.issue_number ? `Issue #${row.issue_number}` : runId);
    rows.push(buildSessionRow({
      id: `active:${runId}`,
      view: "active",
      factoryId,
      runId,
      issueNumber: row.issue_number || row.current_issue_number,
      goalIssueNumber: row.goal_issue_number || "",
      title,
      kind: trim(row.kind || ""),
      status: "running",
      updatedAt: trim(row.updated_at || row.last_progress_at || ""),
      progressLabel: trim(row.progress_label || row.current_issue_node || row.node || ""),
      traceKind: trim(row.trace_kind || row.trace_child_trace_kind || ""),
      liveAttachTarget: row.live_attachable === true ? row.live_attach_target : null,
      sessionLog: trim(row.trace_session_log || ""),
      summary: trim(row.summary || row.current_issue_node || row.node || ""),
    }, nowMs));
  }

  rows.sort((left, right) => kindRank(left.kind) - kindRank(right.kind)
    || left.issue_number - right.issue_number
    || left.goal_issue_number - right.goal_issue_number
    || stableCompare(left.title, right.title)
    || stableCompare(left.run_id, right.run_id)
    || stableCompare(left.id, right.id));
  return rows;
}

function buildHistoricalRows({
  runsDir = ".hatch/runs",
  factoryId = "",
  nowMs = Date.now(),
  activeRunIds = new Set(),
  readAllRunStatesFn = readAllRunStates,
  repoRoot = ".",
} = {}) {
  const rawStates = typeof readAllRunStatesFn === "function" ? readAllRunStatesFn({ runsDir }) : [];
  const states = rawStates instanceof Map
    ? Array.from(rawStates.values())
    : (Array.isArray(rawStates) ? rawStates : []);
  const rows = [];

  for (const state of states) {
    const runId = trim(state?.runId);
    if (!runId) continue;
    const trace = resolveSessionTrace(state, {
      runSessionsDir: join(runsDir, runId, "sessions"),
    });
    const sessionLog = trim(trace.sessionLog || "");
    if (!sessionLog) continue;
    const liveAttachTarget = String(state?.status || "").toLowerCase() === "running" && activeRunIds.has(runId)
      ? {
        factory_id: factoryId,
        run_id: runId,
        session_id: trim(state?.context?.agent_session_id || state?.context?.session_id || ""),
        trace_kind: trim(trace.traceKind || ""),
        node: trim(state?.currentNode || ""),
      }
      : null;
    const resumeTarget = liveAttachTarget
      ? null
      : resolveHistoricalResumeTarget({
        state,
        factoryId,
        traceKind: trim(trace.traceKind || ""),
        repoRoot,
      });
    rows.push(buildSessionRow({
      id: `history:${runId}`,
      view: "history",
      factoryId,
      runId,
      issueNumber: state?.context?.issue_number || "",
      goalIssueNumber: state?.context?.goal_issue_number || "",
      title: trim(state?.context?.issue_title || state?.context?.milestone_title || state?.pipelineFile || runId),
      status: trim(state?.status || ""),
      updatedAt: trim(state?.updatedAt || state?.createdAt || ""),
      kind: deriveHistoricalKind(state),
      progressLabel: trim(state?.currentNode || ""),
      traceKind: trim(trace.traceKind || ""),
      liveAttachTarget,
      resumeTarget,
      sessionLog,
    }, nowMs));
  }

  rows.sort((left, right) => parseIsoMs(right.updated_at) - parseIsoMs(left.updated_at) || String(left.id).localeCompare(String(right.id), "en"));
  return rows;
}

export function buildFactorySessionBrowserSnapshot({
  runsDir = ".hatch/runs",
  nowMs = Date.now(),
  lookbackHours = 24,
  context = {},
  factoryActiveSummaryFn = factoryActiveSummary,
  readAllRunStatesFn = readAllRunStates,
  repoRoot = "",
} = {}) {
  const summary = typeof factoryActiveSummaryFn === "function"
    ? (factoryActiveSummaryFn({ runsDir, now: nowMs, context }) || {})
    : {};
  const factoryId = trim(context.factory_id || summary?.context?.factory_id || "");
  const activeRows = buildActiveRows({ summary, nowMs, factoryId });
  const activeRunIds = new Set(activeRows.map((row) => row.run_id));
  const resolvedRepoRoot = trim(repoRoot || context.repo || summary?.context?.repo || process.cwd());
  const historyRows = buildHistoricalRows({
    runsDir,
    factoryId,
    nowMs,
    activeRunIds,
    readAllRunStatesFn,
    repoRoot: resolvedRepoRoot,
  });
  const recentCutoff = Number(nowMs) - Math.max(1, Number(lookbackHours) || 24) * 60 * 60 * 1000;
  const recentRows = historyRows.filter((row) => parseIsoMs(row.updated_at) >= recentCutoff && !activeRunIds.has(row.run_id));

  return {
    generated_at: new Date(nowMs).toISOString(),
    context: {
      factory_id: factoryId,
      runs_dir: runsDir,
      repo_root: resolvedRepoRoot,
      lookback_hours: Math.max(1, Number(lookbackHours) || 24),
    },
    views: {
      active: {
        id: "active",
        title: "Active",
        rows: activeRows,
        empty_message: "No active sessions.",
      },
      recent: {
        id: "recent",
        title: "Recent",
        rows: recentRows,
        empty_message: "No recent sessions.",
      },
      history: {
        id: "history",
        title: "History",
        rows: historyRows,
        empty_message: "No historical sessions.",
      },
    },
  };
}

export function resolveSessionBrowserOpenSpec(row = {}) {
  const mode = buildOpenMode({
    liveAttachTarget: row.live_attach_target,
    resumeTarget: row.resume_target,
    sessionLog: row.session_log,
  });
  if (mode === "live") {
    return {
      mode: "live",
      read_only: false,
      target: row.live_attach_target,
      session_log: trim(row.session_log),
    };
  }
  if (mode === "resume") {
    return {
      mode: "resume",
      read_only: false,
      target: row.resume_target,
      session_log: trim(row.session_log),
    };
  }
  if (mode === "transcript") {
    return {
      mode: "transcript",
      read_only: true,
      target: null,
      session_log: trim(row.session_log),
    };
  }
  return {
    mode: "none",
    read_only: true,
    target: null,
    session_log: "",
  };
}
