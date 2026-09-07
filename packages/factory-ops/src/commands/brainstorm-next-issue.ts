import { readBrainstormCursor } from "./brainstorm-cursor.ts";
import { ghJson } from "../lib/cli-helpers.ts";

function normalizeText(value = "") {
  return String(value ?? "").trim();
}

function requireRepo(repo = "") {
  const normalized = normalizeText(repo);
  if (!normalized) {
    throw new Error("brainstorm_next_issue:missing_repo");
  }
  return normalized;
}

function normalizeLabel(label = "") {
  const normalized = normalizeText(label);
  return normalized || "brainstorm";
}

function requireIssueObject(issue, errorCode = "brainstorm_next_issue:malformed_issue_payload") {
  if (!issue || typeof issue !== "object" || Array.isArray(issue)) {
    throw new Error(errorCode);
  }
  return issue;
}

function normalizeIssueNumber(raw = "", errorCode = "brainstorm_next_issue:malformed_issue_number") {
  const parsed = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(errorCode);
  }
  return parsed;
}

function normalizeIssueBody(raw = "", errorCode = "brainstorm_next_issue:malformed_issue_body") {
  if (raw === null || raw === undefined) return "";
  if (typeof raw !== "string") {
    throw new Error(errorCode);
  }
  return raw;
}

function normalizeIssueRecord(issue) {
  const record = requireIssueObject(issue);
  const issueNumber = normalizeIssueNumber(record.number);
  const issueBody = normalizeIssueBody(record.body);
  const issueTitle = normalizeText(record.title);

  return {
    issue_number: String(issueNumber),
    issue_number_numeric: issueNumber,
    issue_title: issueTitle,
    issue_body: issueBody,
  };
}

function hasLabel(issue = {}, label = "") {
  return (Array.isArray(issue.labels) ? issue.labels : []).some(
    (item) => normalizeText(item?.name).toLowerCase() === normalizeText(label).toLowerCase(),
  );
}

function normalizeBacklogIssue(issue) {
  const record = requireIssueObject(issue, "brainstorm_next_issue:malformed_backlog_issue_payload");
  const issueNumber = normalizeIssueNumber(record.number, "brainstorm_next_issue:malformed_backlog_issue_number");
  const issueState = normalizeText(record.state).toLowerCase();
  if (issueState && issueState !== "open") {
    throw new Error("brainstorm_next_issue:malformed_backlog_issue_state");
  }
  return {
    number: issueNumber,
    labels: Array.isArray(record.labels) ? record.labels : [],
  };
}

function normalizeClosedGoalIssue(issue) {
  const record = requireIssueObject(issue, "brainstorm_next_issue:malformed_shipped_goal_payload");
  const issueNumber = normalizeIssueNumber(record.number, "brainstorm_next_issue:malformed_shipped_goal_number");
  const issueTitle = normalizeText(record.title);
  const issueUrl = normalizeText(record.url);
  const closedAt = normalizeText(record.closedAt);
  return {
    issue_number: String(issueNumber),
    issue_number_numeric: issueNumber,
    issue_title: issueTitle,
    issue_url: issueUrl,
    closed_at: closedAt,
  };
}

function parseCursorIssueNumber(cursor = null) {
  const parsed = Number.parseInt(String(cursor?.last_brainstorm_issue_number ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseScenarioHoldoutsFromCursor(cursor = null) {
  const raw = String(cursor?.scenario_holdouts_snapshot ?? "");
  if (!raw.trim()) return [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("brainstorm_next_issue:malformed_cursor_scenario_holdouts");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("brainstorm_next_issue:malformed_cursor_scenario_holdouts");
  }

  return parsed
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function listClosedGoals({ repo, ghJsonFn = ghJson } = {}) {
  const repoSlug = requireRepo(repo);
  const raw = ghJsonFn([
    "issue",
    "list",
    "--repo",
    repoSlug,
    "--state",
    "closed",
    "--label",
    "goal",
    "--limit",
    "200",
    "--json",
    "number,title,url,closedAt",
  ], []);

  if (!Array.isArray(raw)) {
    throw new Error("brainstorm_next_issue:malformed_shipped_goals_payload");
  }

  return raw
    .map((item) => normalizeClosedGoalIssue(item))
    .sort((a, b) => a.issue_number_numeric - b.issue_number_numeric);
}

function buildOpenBacklogSummary({ repo, ghJsonFn = ghJson } = {}) {
  const repoSlug = requireRepo(repo);
  const raw = ghJsonFn([
    "issue",
    "list",
    "--repo",
    repoSlug,
    "--state",
    "open",
    "--limit",
    "200",
    "--json",
    "number,state,labels",
  ], []);

  if (!Array.isArray(raw)) {
    throw new Error("brainstorm_next_issue:malformed_open_backlog_payload");
  }

  const normalized = raw.map((item) => normalizeBacklogIssue(item));
  const summary = {
    open_total: normalized.length,
    open_goal_count: normalized.filter((issue) => hasLabel(issue, "goal")).length,
    open_ready_goal_count: normalized.filter((issue) => hasLabel(issue, "goal") && hasLabel(issue, "ready")).length,
    open_feature_count: normalized.filter((issue) => hasLabel(issue, "feature")).length,
    open_bug_count: normalized.filter((issue) => hasLabel(issue, "bug")).length,
    open_brainstorm_count: normalized.filter((issue) => hasLabel(issue, "brainstorm")).length,
  };

  return summary;
}

export function listOpenBrainstormIssues({ repo, label = "brainstorm", ghJsonFn = ghJson } = {}) {
  const repoSlug = requireRepo(repo);
  const resolvedLabel = normalizeLabel(label);

  const raw = ghJsonFn([
    "issue",
    "list",
    "--repo",
    repoSlug,
    "--state",
    "open",
    "--label",
    resolvedLabel,
    "--limit",
    "200",
    "--json",
    "number,title,body",
  ], []);

  if (!Array.isArray(raw)) {
    throw new Error("brainstorm_next_issue:malformed_issue_list_payload");
  }

  return raw
    .map((issue) => normalizeIssueRecord(issue))
    .sort((a, b) => a.issue_number_numeric - b.issue_number_numeric);
}

function normalizeIssueSelectionRecord(issue = null) {
  const record = requireIssueObject(issue);

  if (record.issue_number_numeric !== undefined || record.issue_number !== undefined) {
    const issueNumber = normalizeIssueNumber(
      record.issue_number_numeric ?? record.issue_number,
      "brainstorm_next_issue:malformed_issue_number",
    );
    return {
      issue_number: String(issueNumber),
      issue_number_numeric: issueNumber,
      issue_title: normalizeText(record.issue_title ?? record.title),
      issue_body: normalizeIssueBody(record.issue_body ?? record.body),
    };
  }

  return normalizeIssueRecord(record);
}

export function selectNextBrainstormIssue({ issues = [] } = {}) {
  if (!Array.isArray(issues)) {
    throw new Error("brainstorm_next_issue:malformed_issues");
  }

  const normalized = issues
    .map((issue) => normalizeIssueSelectionRecord(issue))
    .sort((a, b) => a.issue_number_numeric - b.issue_number_numeric);

  return normalized.length > 0 ? normalized[0] : null;
}

export function buildBrainstormIntakeContext({
  repo,
  factoryId = "",
  rootDir = ".",
  issue = null,
  ghJsonFn = ghJson,
  readCursorFn = readBrainstormCursor,
} = {}) {
  const repoSlug = requireRepo(repo);
  const normalizedIssue = issue ? normalizeIssueSelectionRecord(issue) : null;
  const cursor = typeof readCursorFn === "function"
    ? readCursorFn({ factoryId, rootDir })
    : null;

  const lastBrainstormIssueNumber = parseCursorIssueNumber(cursor);
  const shippedGoals = listClosedGoals({ repo: repoSlug, ghJsonFn })
    .filter((goal) => (lastBrainstormIssueNumber > 0 ? goal.issue_number_numeric > lastBrainstormIssueNumber : true))
    .map(({ issue_number, issue_title, issue_url, closed_at }) => ({
      issue_number,
      issue_title,
      issue_url,
      closed_at,
    }));

  const openBacklogSummary = buildOpenBacklogSummary({ repo: repoSlug, ghJsonFn });
  const scenarioHoldouts = parseScenarioHoldoutsFromCursor(cursor);

  return {
    brainstorm_issue_number: normalizedIssue?.issue_number || "",
    brainstorm_issue_body: normalizedIssue?.issue_body || "",
    shipped_goals_since_last: JSON.stringify(shippedGoals),
    open_backlog_summary: JSON.stringify(openBacklogSummary),
    scenario_holdouts: JSON.stringify(scenarioHoldouts),
  };
}

export function nextBrainstormIssue({
  repo,
  label = "brainstorm",
  factoryId = "",
  rootDir = ".",
  ghJsonFn = ghJson,
  readCursorFn = readBrainstormCursor,
} = {}) {
  const issues = listOpenBrainstormIssues({ repo, label, ghJsonFn });
  const issue = selectNextBrainstormIssue({ issues });
  const context = buildBrainstormIntakeContext({
    repo,
    factoryId,
    rootDir,
    issue,
    ghJsonFn,
    readCursorFn,
  });

  return {
    has_issue: Boolean(issue),
    ...context,
  };
}
