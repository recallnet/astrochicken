import { createGhCliAdapter } from "../../../github-adapter/src/github-adapter.ts";
import { parseJson } from "../lib/cli-helpers.ts";

function hasAwaitingHuman(issue = {}) {
  const labels = Array.isArray(issue?.labels) ? issue.labels : [];
  const names = labels
    .map((label) => {
      if (label && typeof label === "object") return String(label.name || "").trim().toLowerCase();
      return String(label || "").trim().toLowerCase();
    })
    .filter(Boolean);
  return names.includes("awaiting-human");
}

function hasOpenBlockers(nodes = []) {
  if (!Array.isArray(nodes) || nodes.length === 0) return false;
  return nodes.some((node) => String(node?.state || "").trim().toUpperCase() !== "CLOSED");
}

function normalizeReadyIssue(issue = {}) {
  return {
    issue_number: issue?.number ?? "",
    issue_title: String(issue?.title || ""),
  };
}

export function filterReadyIssues({
  milestoneIssuesRaw = "[]",
  repo = "recallnet/astrochicken",
  adapter,
  queryBlockedBy,
} = {}) {
  const items = parseJson(String(milestoneIssuesRaw || "[]"), []);
  if (!Array.isArray(items)) return [];

  const githubAdapter = adapter || (repo ? createGhCliAdapter({ repo }) : null);
  const query = githubAdapter
    ? ({ issueNumber }) => {
      if (!issueNumber) return { ok: false, nodes: [] };
      return { ok: true, nodes: githubAdapter.issueBlockedBy({ number: issueNumber }) };
    }
    : (typeof queryBlockedBy === "function"
      ? queryBlockedBy
      : () => ({ ok: false, nodes: [] }));

  const ready = [];
  for (const rawIssue of items) {
    const issue = rawIssue && typeof rawIssue === "object" ? rawIssue : {};
    const issueNumber = issue?.number;
    if (!issueNumber && issueNumber !== 0) continue;

    if (hasAwaitingHuman(issue)) continue;

    const blocked = query({ issueNumber: issueNumber, issue, repo });
    if (blocked?.ok === true && hasOpenBlockers(blocked.nodes)) continue;

    ready.push(normalizeReadyIssue(issue));
  }

  return ready;
}
