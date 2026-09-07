import { ghJson, trim } from "./cli-helpers.ts";

/**
 * Fetch ALL open issues in a single API call.
 * Replaces 8 separate readGhList calls in supervisor-state-snapshot.
 *
 * Fields requested are the union of all fields needed by downstream consumers:
 * number, title, body, milestone, labels, createdAt, url, comments.
 */
export function fetchAllOpenIssues({ repo, ghJsonFn = ghJson, limit = 500, snapshotErrors } = {}) {
  const normalizedRepo = trim(repo);
  if (!normalizedRepo) return [];

  let result;
  try {
    result = ghJsonFn([
      "issue", "list",
      "--repo", normalizedRepo,
      "--state", "open",
      "--limit", String(limit),
      "--json", "number,title,body,milestone,labels,createdAt,url,comments",
    ], []);
  } catch (error) {
    if (Array.isArray(snapshotErrors)) {
      snapshotErrors.push(`unified_issue_fetch_query_failed:${String(error?.message || error || "unknown_error")}`);
    }
    return [];
  }

  if (!Array.isArray(result)) {
    if (Array.isArray(snapshotErrors)) {
      snapshotErrors.push("unified_issue_fetch_malformed_payload");
    }
    return [];
  }

  return result;
}

/**
 * Filter issues that have ALL of the specified labels.
 * Accepts a single label string or array of labels (AND logic).
 */
export function filterByLabel(issues, labels) {
  const required = Array.isArray(labels) ? labels : [labels];
  const normalized = required.map((l) => String(l || "").toLowerCase());
  if (normalized.length === 0) return issues;

  return issues.filter((issue) => {
    const issueLabels = new Set(
      (Array.isArray(issue?.labels) ? issue.labels : [])
        .map((l) => String(l?.name || l || "").toLowerCase()),
    );
    return normalized.every((label) => issueLabels.has(label));
  });
}

/**
 * Filter issues whose title contains the search string (case-insensitive).
 * Mirrors the `--search "X" in:title` gh CLI behavior.
 */
export function filterBySearch(issues, search) {
  const needle = String(search || "").toLowerCase();
  if (!needle) return issues;
  return issues.filter((issue) =>
    String(issue?.title || "").toLowerCase().includes(needle),
  );
}

/**
 * Filter issues that have zero labels.
 */
export function filterUnlabeled(issues) {
  return issues.filter((issue) => {
    const labels = Array.isArray(issue?.labels) ? issue.labels : [];
    return labels.length === 0;
  });
}
