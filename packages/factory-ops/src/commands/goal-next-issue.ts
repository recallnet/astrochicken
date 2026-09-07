import { listGoalSubIssues } from "./goal-sub-issues.ts";
import { parseJson } from "../lib/cli-helpers.ts";

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

function defaultEstimateComplexityClass() {
  return "unknown";
}

/**
 * Build ordered candidate issues from the unblocked list starting at nextIssueNumber.
 */
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

const QUARANTINED_LABELS = new Set(["quarantined"]);

function isBlocked(issue) {
  // Blocked = GitHub native blocked_by relationship (auto-resolves when blocker closes)
  // OR quarantined label (factory-owned cooldown state)
  if (Number(issue.blocked_by_count ?? 0) > 0) return true;
  const labels = Array.isArray(issue.labels) ? issue.labels : [];
  return labels.some((l) => QUARANTINED_LABELS.has(String(l.name || l || "").toLowerCase()));
}

/**
 * Compute next goal sub-issue to execute.
 *
 * Replaces computeNextMilestoneIssue: works with sub-issues instead of
 * milestone issues. Issues are #-ordered (lowest number first).
 * Skips issues labeled `blocked` or `quarantined` — runtime dependency
 * failures create these labels after triage, so dispatch must re-check.
 *
 * @param {{ goalNumber: string, completed?: string[], processed?: string[], issues?: Array }} opts
 */
export function computeNextGoalIssue({
  goalNumber,
  completed = [],
  processed = [],
  issues = [],
} = {}) {
  const seen = new Set((Array.isArray(processed) ? processed : []).map((x) => String(x)));

  const openNotProcessed = (Array.isArray(issues) ? issues : [])
    .filter((i) => !seen.has(String(i.number)))
    .filter((i) => String(i.state || "").toLowerCase() === "open")
    .sort((a, b) => Number(a.number) - Number(b.number));

  const blocked = openNotProcessed.filter((i) => isBlocked(i));
  const pending = openNotProcessed.filter((i) => !isBlocked(i));

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
      blocked_count: blocked.length,
      no_next_reason: "",
      ordered_unblocked_issues: orderedUnblockedIssues,
    };
  }

  return {
    has_next: false,
    next_issue_number: "",
    next_issue_title: "",
    remaining_count: pending.length,
    blocked_count: blocked.length,
    no_next_reason: "none_pending",
    ordered_unblocked_issues: [],
  };
}

/**
 * Pick next goal sub-issue (IO wrapper).
 *
 * Replaces pickNextMilestoneIssue: queries goal sub-issues instead of
 * milestone issues.
 */
export function pickNextGoalIssue({
  repo,
  goalNumber,
  completed = [],
  processed = [],
  candidateLimit = 3,
  estimateComplexityClass = defaultEstimateComplexityClass,
  adapter,
  listSubIssuesFn = listGoalSubIssues,
} = {}) {
  const emptyCandidates = [];
  const effectiveRepo = repo || adapter?.repo;
  if (!effectiveRepo || !goalNumber) {
    return {
      has_next: false,
      next_issue_number: "",
      next_issue_title: "",
      remaining_count: 0,
      blocked_count: 0,
      no_next_reason: "missing_repo_or_goal",
      ordered_unblocked_issues: [],
      ordered_candidate_issues: emptyCandidates,
      ordered_candidate_issues_b64: encodeBase64Json(emptyCandidates),
    };
  }

  const subIssues = adapter
    ? listGoalSubIssues({ goalNumber, adapter })
    : listSubIssuesFn({ repo: effectiveRepo, goalNumber });
  const next = computeNextGoalIssue({
    goalNumber,
    completed,
    processed,
    issues: subIssues,
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

/**
 * CLI argument wrapper for pickNextGoalIssue.
 */
export function pickNextGoalIssueFromArgs({
  repo,
  goalNumber,
  completedRaw = "[]",
  processedRaw = "[]",
  candidateLimit = 3,
} = {}) {
  const completed = parseJson(String(completedRaw || "[]"), []);
  const processed = parseJson(String(processedRaw || "[]"), []);
  return pickNextGoalIssue({
    repo,
    goalNumber,
    completed,
    processed,
    candidateLimit,
  });
}
