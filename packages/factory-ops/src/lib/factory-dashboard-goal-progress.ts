import { listGoalSubIssues } from "../commands/goal-sub-issues.ts";

function compactGraphLabel(graph = "") {
  const raw = String(graph || "");
  if (!raw) return "";
  const parts = raw.replace(/\\/g, "/").split("/");
  const label = parts[parts.length - 1] || raw;
  return label.endsWith(".workflow-source.mjs")
    ? label.replace(/\.workflow-source\.mjs$/u, ".dot")
    : label;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isGoalRunFamily(run = {}) {
  const label = compactGraphLabel(run.graph || run.graph_label || "");
  if (label === "goal_execute.dot") return true;
  if (label === "goal_run.dot" || label === "goal_intake_decompose.dot" || label === "managed_software_delivery_domain.dot") return true;
  const issueNumber = toNumber(run.issue_number, 0);
  const goalIssueNumber = toNumber(run.goal_issue_number, 0);
  return goalIssueNumber > 0 && (issueNumber <= 0 || issueNumber === goalIssueNumber);
}

function isGoalIssueFamily(run = {}) {
  const label = compactGraphLabel(run.graph || run.graph_label || "");
  if (label === "goal_issue_execute.dot") return true;
  const issueNumber = toNumber(run.issue_number, 0);
  const goalIssueNumber = toNumber(run.goal_issue_number, 0);
  return issueNumber > 0 && goalIssueNumber > 0 && issueNumber !== goalIssueNumber;
}

export function resolveGoalRunProgressLabel({ goalNumber = 0, progress = null } = {}) {
  if (!goalNumber || !progress || !Array.isArray(progress.subIssues) || progress.subIssues.length === 0) return "";
  const total = progress.subIssues.length;
  const currentIssue = toNumber(progress.currentIssueNumber, 0);
  if (currentIssue > 0) {
    const index = progress.subIssues.findIndex((issue) => toNumber(issue.number, 0) === currentIssue);
    if (index >= 0) return `${index + 1}/${total}`;
  }
  const closedCount = progress.subIssues.filter((issue) => String(issue.state || "").toLowerCase() !== "open").length;
  const nextOpenOrdinal = Math.min(total, closedCount + 1);
  return `${nextOpenOrdinal}/${total}`;
}

export function fetchGoalProgress(goalNumbers = [], {
  repo = "",
  summary = {},
  listGoalSubIssuesFn = listGoalSubIssues,
} = {}) {
  const progressByGoal = {};
  if (!repo || goalNumbers.length === 0 || typeof listGoalSubIssuesFn !== "function") return progressByGoal;

  const activeGoalIssues = Array.isArray(summary.non_wave_active)
    ? summary.non_wave_active.filter((run) => isGoalIssueFamily(run))
    : [];
  const activeGoalRuns = Array.isArray(summary.non_wave_active)
    ? summary.non_wave_active.filter((run) => isGoalRunFamily(run))
    : [];

  for (const goalNumber of goalNumbers) {
    const subIssues = listGoalSubIssuesFn({ repo, goalNumber }) || [];
    const currentIssueFromIssueRuns = activeGoalIssues
      .filter((run) => toNumber(run.goal_issue_number, 0) === goalNumber)
      .map((run) => toNumber(run.issue_number, 0))
      .sort((left, right) => left - right)[0] || 0;
    const currentIssueFromGoalRun = activeGoalRuns
      .filter((run) => toNumber(run.issue_number, 0) === goalNumber)
      .map((run) => toNumber(run.current_issue_number, 0))
      .filter((issueNumber) => issueNumber > 0)
      .sort((left, right) => left - right)[0] || 0;
    progressByGoal[goalNumber] = {
      subIssues,
      currentIssueNumber: currentIssueFromIssueRuns || currentIssueFromGoalRun,
    };
  }

  return progressByGoal;
}
