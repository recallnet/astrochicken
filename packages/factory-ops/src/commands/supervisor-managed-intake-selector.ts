import { listReadyGoals } from "./goal-queue-ops.ts";
import { resolveSupervisorGhJsonFn } from "./supervisor-backend-query-seams.ts";
import { trim } from "../lib/cli-helpers.ts";

function parseIntake(intakeJson = "") {
  const raw = trim(intakeJson);
  if (!raw) return { intake: {}, parse_error: "" };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { intake: {}, parse_error: "invalid_intake_json_object" };
    }
    return { intake: parsed, parse_error: "" };
  } catch {
    return { intake: {}, parse_error: "invalid_intake_json" };
  }
}

function normalizeRepo(repo = "") {
  const normalized = trim(repo);
  if (!normalized) return { repo: "", parse_error: "missing_target_repo" };
  if (!/^[^/\s]+\/[^/\s]+$/.test(normalized)) {
    return { repo: normalized, parse_error: "invalid_target_repo" };
  }
  return { repo: normalized, parse_error: "" };
}

function normalizeLabels({ intake = {}, labels = [] } = {}) {
  const issueSelector = intake?.issue_selector;
  if (issueSelector !== undefined && (!issueSelector || typeof issueSelector !== "object" || Array.isArray(issueSelector))) {
    return { labels: [], parse_error: "invalid_issue_selector" };
  }

  const selectorLabelsRaw = issueSelector?.labels;
  if (selectorLabelsRaw !== undefined && !Array.isArray(selectorLabelsRaw)) {
    return { labels: [], parse_error: "invalid_issue_selector_labels" };
  }

  const normalized = Array.from(new Set(
    [
      ...(Array.isArray(selectorLabelsRaw) ? selectorLabelsRaw : []),
      ...(Array.isArray(labels) ? labels : []),
    ]
      .map((value) => trim(value))
      .filter(Boolean),
  ));

  if (normalized.length === 0) {
    return { labels: [], parse_error: "missing_issue_selector_labels" };
  }

  return { labels: normalized, parse_error: "" };
}

function normalizeIssue(issue = {}) {
  const number = Number.parseInt(String(issue?.number ?? "").trim(), 10);
  if (!Number.isFinite(number) || number <= 0) return null;

  const labels = Array.isArray(issue?.labels)
    ? issue.labels
      .map((entry) => trim(entry?.name ?? entry))
      .filter(Boolean)
    : [];

  return {
    number,
    source_issue_id: String(number),
    title: trim(issue?.title || ""),
    body: typeof issue?.body === "string" ? issue.body : "",
    url: trim(issue?.url || ""),
    labels,
  };
}

function buildIntakeJson({ repo = "", labels = [], hasIssue = false, issue = null, reason = "" } = {}) {
  const payload = {
    selector: "issue_list_first_open",
    target_repo: repo,
    issue_selector: {
      labels,
    },
    has_issue: Boolean(hasIssue),
    issue: issue || null,
  };
  if (trim(reason)) payload.reason = trim(reason);
  return JSON.stringify(payload);
}

function buildFailure({ repo = "", labels = [], parseError = "", reason = "" } = {}) {
  return {
    has_issue: "false",
    selected_issue_number: "",
    selected_issue_title: "",
    selected_issue_body: "",
    intake_json: buildIntakeJson({
      repo,
      labels,
      hasIssue: false,
      issue: null,
      reason: trim(reason) || trim(parseError),
    }),
    parse_error: trim(parseError),
  };
}

export function selectManagedIntakeIssue({
  repo = "",
  factoryId = "",
  intakeJson = "",
  labels = [],
  ghJsonFn,
  backendAdapter,
} = {}) {
  const queryIssueList = resolveSupervisorGhJsonFn({ ghJsonFn, backendAdapter, repo });
  const repoResult = normalizeRepo(repo);
  if (repoResult.parse_error) {
    return buildFailure({ parseError: repoResult.parse_error, reason: repoResult.parse_error });
  }

  const parsedIntake = parseIntake(intakeJson);
  if (parsedIntake.parse_error) {
    return buildFailure({
      repo: repoResult.repo,
      parseError: parsedIntake.parse_error,
      reason: parsedIntake.parse_error,
    });
  }

  const labelResult = normalizeLabels({ intake: parsedIntake.intake, labels });
  if (labelResult.parse_error) {
    return buildFailure({
      repo: repoResult.repo,
      parseError: labelResult.parse_error,
      reason: labelResult.parse_error,
    });
  }

  const args = [
    "issue",
    "list",
    "--repo",
    repoResult.repo,
    "--state",
    "open",
    "--limit",
    "200",
    "--json",
    "number,title,body,url,labels",
  ];
  for (const label of labelResult.labels) args.push("--label", label);

  const payload = queryIssueList(args, []);
  if (!Array.isArray(payload)) {
    return buildFailure({
      repo: repoResult.repo,
      labels: labelResult.labels,
      parseError: "malformed_issue_list_payload",
      reason: "malformed_issue_list_payload",
    });
  }

  const normalizedIssues = payload
    .map((issue) => normalizeIssue(issue))
    .filter(Boolean);

  const goalReadySelection = labelResult.labels.includes("goal") && labelResult.labels.includes("ready");
  const selectableIssues = goalReadySelection
    ? (() => {
        const dispatchableGoalNumbers = new Set(
          listReadyGoals({ repo: repoResult.repo, factoryId, ghJsonFn: queryIssueList })
            .map((issue) => Number(issue?.number))
            .filter(Number.isFinite),
        );
        return normalizedIssues.filter((issue) => dispatchableGoalNumbers.has(issue.number));
      })()
    : normalizedIssues;

  const selected = selectableIssues
    .sort((left, right) => left.number - right.number)[0] || null;

  return {
    has_issue: selected ? "true" : "false",
    selected_issue_number: selected ? String(selected.number) : "",
    selected_issue_title: selected ? selected.title : "",
    selected_issue_body: selected ? selected.body : "",
    intake_json: buildIntakeJson({
      repo: repoResult.repo,
      labels: labelResult.labels,
      hasIssue: Boolean(selected),
      issue: selected,
    }),
    parse_error: "",
  };
}
