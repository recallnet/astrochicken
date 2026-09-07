import { trim } from "./cli-helpers.ts";
import {
  compactGraphLabel,
  withRunIdentity,
} from "../commands/factory-dashboard-filters.ts";
import {
  readAllRunStates,
  resolveGraph as resolveRunGraph,
  resolveIssue as resolveRunIssue,
} from "../commands/factory-status.ts";

const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "failed",
  "suspended",
  "guarded",
  "guarded_terminal",
  "blocked",
  "terminal",
]);

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stableCompare(a = "", b = "") {
  return String(a || "").localeCompare(String(b || ""), "en");
}

function parseIsoMs(value = "") {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function humanizeGraphLabel(graph = "") {
  return compactGraphLabel(graph)
    .replace(/\.dot$/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function goalRunKey(run = {}) {
  const goalIssueNumber = toNumber(run.goal_issue_number, 0);
  if (goalIssueNumber > 0) return `goal:${goalIssueNumber}`;
  const issueNumber = toNumber(run.issue_number, 0);
  if (issueNumber > 0) return `goal:${issueNumber}`;
  return `run:${trim(run.run_id || run.id || "")}`;
}

export function resolveGoalRunIssueNumber(run = {}) {
  const goalIssueNumber = toNumber(run.goal_issue_number, 0);
  if (goalIssueNumber > 0) return goalIssueNumber;
  return toNumber(run.issue_number, 0);
}

function newestRunFirst(left = {}, right = {}) {
  const leftMs = parseIsoMs(left.last_progress_at || left.updated_at || "");
  const rightMs = parseIsoMs(right.last_progress_at || right.updated_at || "");
  if (leftMs !== rightMs) return rightMs - leftMs;
  return stableCompare(trim(left.run_id || left.id || ""), trim(right.run_id || right.id || ""));
}

export function buildGroupedGoalRuns(summary = {}, isGoalRunFamily = () => false) {
  const grouped = new Map();
  for (const run of Array.isArray(summary.non_wave_active) ? summary.non_wave_active : []) {
    if (!isGoalRunFamily(run)) continue;
    const key = goalRunKey(run);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(run);
  }
  return [...grouped.values()]
    .map((runs) => runs.slice().sort(newestRunFirst))
    .sort((left, right) => {
      const leftIssue = resolveGoalRunIssueNumber(left[0]);
      const rightIssue = resolveGoalRunIssueNumber(right[0]);
      if (leftIssue !== rightIssue) return leftIssue - rightIssue;
      return stableCompare(goalRunKey(left[0]), goalRunKey(right[0]));
    });
}

function resolveRecentRunUpdatedAt(state = {}) {
  return trim(
    state?.updatedAt
    || state?.updated_at
    || state?.completedAt
    || state?.finishedAt
    || state?.endedAt
    || state?.createdAt,
  );
}

function resolveRecentRunNode(state = {}) {
  return trim(state?.currentNodeId || state?.current_node || state?.currentNode || state?.node || "");
}

export function buildRecentHandoffRows({
  runsDir = "",
  nowMs = Date.now(),
  goalTitles = {},
  readAllRunStatesFn = readAllRunStates,
  formatAge = () => "",
  normalizeDetail = (lines) => lines,
  limit = 3,
} = {}) {
  const runs = [];
  for (const [runId, state] of readAllRunStatesFn({ runsDir })) {
    const status = trim(state?.status || "").toLowerCase();
    if (!TERMINAL_RUN_STATUSES.has(status)) continue;
    const updatedAt = resolveRecentRunUpdatedAt(state);
    const updatedMs = parseIsoMs(updatedAt);
    if (!updatedMs) continue;
    const graph = compactGraphLabel(resolveRunGraph(state));
    const issueNumber = toNumber(resolveRunIssue(state), 0) || toNumber(state?.issue_number || state?.issueNumber, 0);
    runs.push({
      run_id: runId,
      status,
      updated_at: updatedAt,
      updated_ms: updatedMs,
      graph: graph || compactGraphLabel(state?.graph || state?.graph_label || ""),
      node: resolveRecentRunNode(state),
      issue_number: issueNumber,
    });
  }

  return runs
    .sort((left, right) => right.updated_ms - left.updated_ms || stableCompare(left.run_id, right.run_id))
    .slice(0, limit)
    .map((run) => {
      const issueLabel = run.issue_number > 0 ? `#${run.issue_number}` : "";
      const title = run.issue_number > 0
        ? trim(goalTitles[run.issue_number] || "") || humanizeGraphLabel(run.graph || "") || `Goal #${run.issue_number}`
        : humanizeGraphLabel(run.graph || "") || "recent handoff";
      return withRunIdentity({
        id: `recent-handoff:${run.run_id}`,
        kind: "recent_handoff",
        issue: issueLabel,
        title,
        status: run.status,
        summary: [trim(run.node || ""), "recent handoff"].filter(Boolean).join(" • "),
        progress_label: trim(run.node || ""),
        updated_at: run.updated_at,
        updated_age: formatAge(nowMs, run.updated_at),
        badges: [trim(run.graph || ""), "recent"].filter(Boolean),
        refs: {
          run_id: run.run_id,
          graph: trim(run.graph || ""),
          issue_number: run.issue_number,
        },
        detail: normalizeDetail([
          `Recent handoff: ${run.status}`,
          run.graph ? `Graph: ${run.graph}` : "",
          run.node ? `Last node: ${run.node}` : "",
        ]),
      }, {
        run_id: run.run_id,
        graph: trim(run.graph || ""),
        node: trim(run.node || ""),
        issue_number: run.issue_number,
      });
    });
}
