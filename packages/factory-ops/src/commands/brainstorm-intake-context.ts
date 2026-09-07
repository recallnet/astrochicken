import { buildBrainstormIntakeContext } from "./brainstorm-next-issue.ts";
import { parseJson, trim } from "../lib/cli-helpers.ts";

function normalizeRepo(repo = "") {
  const normalized = trim(repo);
  if (!normalized) return { repo: "", parse_error: "missing_target_repo" };
  if (!/^[^/\s]+\/[^/\s]+$/.test(normalized)) {
    return { repo: normalized, parse_error: "invalid_target_repo" };
  }
  return { repo: normalized, parse_error: "" };
}

function parseIntake(intakeJson = "") {
  const raw = trim(intakeJson);
  if (!raw) return { intake: {}, parse_error: "missing_intake_json" };

  const parsed = parseJson(raw, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { intake: {}, parse_error: "invalid_intake_json" };
  }

  return { intake: parsed, parse_error: "" };
}

function validateSelectorLabels(intake = {}) {
  const selector = intake?.issue_selector;
  if (!selector || typeof selector !== "object" || Array.isArray(selector)) {
    return { labels: [], parse_error: "missing_issue_selector" };
  }

  const labels = selector.labels;
  if (!Array.isArray(labels)) {
    return { labels: [], parse_error: "invalid_issue_selector_labels" };
  }

  const normalized = labels.map((value) => trim(value)).filter(Boolean);
  if (normalized.length === 0) {
    return { labels: [], parse_error: "missing_issue_selector_labels" };
  }

  return { labels: normalized, parse_error: "" };
}

function normalizeSelectedIssue(intake = {}) {
  const issue = intake?.issue;
  if (!issue || typeof issue !== "object" || Array.isArray(issue)) {
    return { issue: null, parse_error: "missing_selected_issue" };
  }

  const number = Number.parseInt(String(issue.number ?? issue.source_issue_id ?? "").trim(), 10);
  if (!Number.isFinite(number) || number <= 0) {
    return { issue: null, parse_error: "invalid_selected_issue_number" };
  }

  const body = typeof issue.body === "string" ? issue.body : "";

  return {
    issue: {
      number,
      title: trim(issue.title || ""),
      body,
    },
    parse_error: "",
  };
}

function emptyResult(parseError = "") {
  return {
    has_issue: "false",
    brainstorm_issue_number: "",
    brainstorm_issue_body: "",
    shipped_goals_since_last: "[]",
    open_backlog_summary: "{}",
    scenario_holdouts: "[]",
    parse_error: trim(parseError),
  };
}

export function buildBrainstormContextFromShellIntake({
  repo = "",
  factoryId = "",
  rootDir = ".",
  intakeJson = "",
  ghJsonFn,
  readCursorFn,
} = {}) {
  const repoResult = normalizeRepo(repo);
  if (repoResult.parse_error) return emptyResult(repoResult.parse_error);

  const intakeResult = parseIntake(intakeJson);
  if (intakeResult.parse_error) return emptyResult(intakeResult.parse_error);

  const selectorResult = validateSelectorLabels(intakeResult.intake);
  if (selectorResult.parse_error) return emptyResult(selectorResult.parse_error);

  const selectedIssueResult = normalizeSelectedIssue(intakeResult.intake);
  if (selectedIssueResult.parse_error) return emptyResult(selectedIssueResult.parse_error);

  try {
    const context = buildBrainstormIntakeContext({
      repo: repoResult.repo,
      factoryId,
      rootDir,
      issue: selectedIssueResult.issue,
      ...(typeof ghJsonFn === "function" ? { ghJsonFn } : {}),
      ...(typeof readCursorFn === "function" ? { readCursorFn } : {}),
    });

    return {
      has_issue: "true",
      ...context,
      parse_error: "",
    };
  } catch (error) {
    return emptyResult(String(error?.message || error || "brainstorm_intake_context_error"));
  }
}
