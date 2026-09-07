import { resolveSupervisorGhJsonFn } from "./supervisor-backend-query-seams.ts";
import { trim } from "../lib/cli-helpers.ts";
import {
  FACTORY_LABEL_KEYS,
  getFactoryLabelName,
} from "../lib/factory-label-contract.ts";

const DEFAULT_UPSTREAM_BUG_LABELS = [
  getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.MANAGED_FACTORY_BUG),
  getFactoryLabelName("example-trading", FACTORY_LABEL_KEYS.FACTORY_EXAMPLE_TRADING),
];


function asPositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeUpstreamBugLabels(labelFilters = []) {
  const normalized = Array.isArray(labelFilters) ? labelFilters : [];
  return Array.from(new Set(
    normalized
      .map((label) => trim(label))
      .filter(Boolean),
  ));
}

function extractClassificationFromBody(body = "") {
  const text = String(body || "");
  if (!text.trim()) return "";

  const fenced = Array.from(text.matchAll(/```json\s*([\s\S]*?)\s*```/gi));
  for (const block of fenced) {
    try {
      const parsed = JSON.parse(block?.[1] || "{}");
      const classification = trim(parsed?.classification || parsed?.evidence?.classification).toLowerCase();
      if (classification) return classification;
    } catch {
      // continue checking next block
    }
  }

  const inlineMatch = text.match(/"classification"\s*:\s*"([^"]+)"/i);
  return trim(inlineMatch?.[1] || "").toLowerCase();
}

function isNeedsTriageIncident(issue = {}) {
  const labels = (Array.isArray(issue?.labels) ? issue.labels : [])
    .map((label) => trim(label?.name || label).toLowerCase())
    .filter(Boolean);

  if (labels.includes("needs-triage")) return true;

  const classification = trim(issue?.classification || issue?.evidence?.classification).toLowerCase()
    || extractClassificationFromBody(issue?.body || "");

  return classification === "needs-triage";
}

function queryGhIssueList({ repo = "", labels = [], ghJsonFn } = {}) {
  const normalizedRepo = trim(repo);
  const args = [
    "issue", "list",
    "--repo", normalizedRepo,
    "--state", "open",
    "--limit", "200",
    "--json", "number,title,labels,body",
  ];

  for (const label of labels) {
    args.push("--label", label);
  }

  const payload = ghJsonFn(args, null);
  if (payload === null) {
    return {
      payload: null,
      parse_error: "gh_issue_list_failed",
    };
  }
  return { payload, parse_error: "" };
}

function safeResult(parse_error = "") {
  return {
    has_open_upstream_bugs: "false",
    open_upstream_bug_count: 0,
    open_upstream_bug_numbers: [],
    parse_error: String(parse_error || ""),
  };
}

export function evaluateUpstreamBugGate({
  repo = "",
  labelFilters = DEFAULT_UPSTREAM_BUG_LABELS,
  ghJsonFn,
  backendAdapter,
  ghIssueListFn,
} = {}) {
  const normalizedRepo = trim(repo);
  if (!normalizedRepo) {
    return safeResult("missing_repo");
  }

  const normalizedLabels = normalizeUpstreamBugLabels(labelFilters);
  const labels = normalizedLabels.length > 0 ? normalizedLabels : DEFAULT_UPSTREAM_BUG_LABELS;
  const resolvedGhJsonFn = resolveSupervisorGhJsonFn({
    ghJsonFn,
    backendAdapter,
    repo: normalizedRepo,
  });
  const issueListQueryFn = typeof ghIssueListFn === "function"
    ? ghIssueListFn
    : (args = {}) => queryGhIssueList({ ...args, ghJsonFn: resolvedGhJsonFn });
  const queried = issueListQueryFn({ repo: normalizedRepo, labels });
  if (trim(queried?.parse_error)) {
    return safeResult(queried.parse_error);
  }

  if (!Array.isArray(queried?.payload)) {
    return safeResult("open_upstream_bugs_malformed_payload");
  }

  const issueNumbers = Array.from(new Set(
    queried.payload
      .filter((issue) => issue && typeof issue === "object")
      .filter((issue) => !isNeedsTriageIncident(issue))
      .map((issue) => asPositiveInt(issue?.number))
      .filter((issueNumber) => issueNumber > 0),
  )).sort((left, right) => left - right);

  return {
    has_open_upstream_bugs: issueNumbers.length > 0 ? "true" : "false",
    open_upstream_bug_count: issueNumbers.length,
    open_upstream_bug_numbers: issueNumbers,
    parse_error: "",
  };
}
