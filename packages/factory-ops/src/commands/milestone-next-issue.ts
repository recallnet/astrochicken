import { waveComplexityEstimate } from "./wave-complexity-estimate.ts";
import { createGhCliAdapter } from "../../../github-adapter/src/github-adapter.ts";
import { trim, parseJson } from "../lib/cli-helpers.ts";



function normalizeCandidateLimit(raw = 3) {
  const numeric = Number.parseInt(String(raw ?? "3"), 10);
  if (!Number.isFinite(numeric)) return 3;
  return Math.min(Math.max(numeric, 1), 3);
}

function normalizeComplexityClass(raw = "") {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "low") return "low";
  if (value === "medium" || value === "high") return "high";
  return "unknown";
}

function encodeBase64Json(value = []) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function defaultEstimateComplexityClass({ issueTitle = "" } = {}) {
  const out = waveComplexityEstimate({ issueTitle });
  return normalizeComplexityClass(out?.complexity_class);
}

export function buildOrderedCandidateIssues({
  nextIssueNumber = "",
  orderedUnblockedIssues = [],
  candidateLimit = 3,
  estimateComplexityClass = defaultEstimateComplexityClass,
} = {}) {
  const normalizedNext = String(nextIssueNumber || "").trim();
  const normalizedLimit = normalizeCandidateLimit(candidateLimit);
  const normalized = (Array.isArray(orderedUnblockedIssues) ? orderedUnblockedIssues : [])
    .map((issue) => ({
      issue_number: String(issue?.issue_number ?? issue?.number ?? "").trim(),
      issue_title: String(issue?.issue_title ?? issue?.title ?? ""),
    }))
    .filter((issue) => issue.issue_number);

  if (normalized.length === 0) return [];

  const startIndex = normalizedNext
    ? Math.max(0, normalized.findIndex((issue) => issue.issue_number === normalizedNext))
    : 0;
  const fromIndex = startIndex >= 0 ? startIndex : 0;

  return normalized.slice(fromIndex, fromIndex + normalizedLimit).map((issue) => ({
    issue_number: issue.issue_number,
    issue_title: issue.issue_title,
    complexity_class: normalizeComplexityClass(
      estimateComplexityClass({
        issueNumber: issue.issue_number,
        issueTitle: issue.issue_title,
      }),
    ),
  }));
}

export function computeNextMilestoneIssue({
  milestoneTitle,
  completed = [],
  processed = [],
  issues = [],
  getBlockedBy,
  getControlPlaneBlocker,
} = {}) {
  const seen = new Set((Array.isArray(processed) ? processed : []).map((x) => String(x)));
  const activeIssues = (Array.isArray(issues) ? issues : []).filter((i) => !String(i?.title || "").startsWith("Wave Ready:"));

  const pending = activeIssues
    .filter((i) => !seen.has(String(i.number)))
    .sort((a, b) => Number(a.number) - Number(b.number));

  // Wave execution does NOT check blockers. Triage already ordered features into
  // waves — once a wave is executing, every feature in it is processable.
  // Control-plane blockers and blocked-by relationships are dispatch/triage concerns,
  // not execution-time concerns. Production incident 2026-03-10: control-plane blocker
  // on #1616 prevented wave-3 from completing despite the feature being triaged into it.
  const orderedUnblockedIssues = pending.map((issue) => ({
    issue_number: String(issue.number),
    issue_title: String(issue.title || ""),
  }));

  if (orderedUnblockedIssues.length > 0) {
    const first = orderedUnblockedIssues[0];
    return {
      has_next: true,
      next_issue_number: first.issue_number,
      next_issue_title: first.issue_title,
      remaining_count: pending.length,
      blocked_count: 0,
      no_next_reason: "",
      ordered_unblocked_issues: orderedUnblockedIssues,
    };
  }

  return {
    has_next: false,
    next_issue_number: "",
    next_issue_title: "",
    remaining_count: pending.length,
    blocked_count: 0,
    no_next_reason: "none_pending",
    ordered_unblocked_issues: [],
  };
}

export function pickNextMilestoneIssue({
  repo,
  milestoneTitle,
  completed = [],
  processed = [],
  candidateLimit = 3,
  adapter,
  estimateComplexityClass = defaultEstimateComplexityClass,
} = {}) {
  const emptyCandidates = [];
  if (!repo || !milestoneTitle) {
    return {
      has_next: false,
      next_issue_number: "",
      next_issue_title: "",
      remaining_count: 0,
      blocked_count: 0,
      no_next_reason: "missing_repo_or_milestone",
      ordered_unblocked_issues: [],
      ordered_candidate_issues: emptyCandidates,
      ordered_candidate_issues_b64: encodeBase64Json(emptyCandidates),
    };
  }
  const issues = (adapter || createGhCliAdapter({ repo })).issueList({
    state: "open",
    milestone: milestoneTitle,
    fields: "number,title,milestone,labels,body",
    limit: 300,
  }).filter((i) => !String(i?.title || "").startsWith("Wave Ready:"));
  const next = computeNextMilestoneIssue({
    milestoneTitle,
    completed,
    processed,
    issues,
  });

  if (next.has_next !== true) {
    return {
      ...next,
      ordered_candidate_issues: emptyCandidates,
      ordered_candidate_issues_b64: encodeBase64Json(emptyCandidates),
    };
  }

  const orderedCandidateIssues = buildOrderedCandidateIssues({
    nextIssueNumber: next.next_issue_number,
    orderedUnblockedIssues: next.ordered_unblocked_issues,
    candidateLimit,
    estimateComplexityClass,
  });

  return {
    ...next,
    ordered_candidate_issues: orderedCandidateIssues,
    ordered_candidate_issues_b64: encodeBase64Json(orderedCandidateIssues),
  };
}

export function pickNextMilestoneIssueFromArgs({
  repo,
  milestoneTitle,
  completedRaw = "[]",
  processedRaw = "[]",
  candidateLimit = 3,
} = {}) {
  const completed = parseJson(String(completedRaw || "[]"), []);
  const processed = parseJson(String(processedRaw || "[]"), []);
  return pickNextMilestoneIssue({
    repo,
    milestoneTitle,
    completed,
    processed,
    candidateLimit,
  });
}
