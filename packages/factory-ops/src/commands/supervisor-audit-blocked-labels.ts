import { ghJson } from "../lib/cli-helpers.ts";



function fetchBlockedBy(repo, issueNumber) {
  const [owner, name] = String(repo || "").split("/");
  if (!owner || !name || !issueNumber) return [];
  const query = `query { repository(owner:\"${owner}\", name:\"${name}\") { i: issue(number:${Number(issueNumber)}) { blockedBy(first:100){nodes{number state}} } } }`;
  const out = ghJson(["api", "graphql", "-f", `query=${query}`], {});
  return out?.data?.repository?.i?.blockedBy?.nodes || [];
}

export function auditBlockedLabels({ repo } = {}) {
  if (!repo) return { repo, blocked_count: 0, without_relationship_count: 0, issues: [] };

  const blocked = ghJson([
    "issue", "list", "--repo", repo, "--state", "open", "--label", "blocked", "--limit", "300",
    "--json", "number,title,url",
  ], []);

  const issues = blocked.map((i) => {
    const nodes = fetchBlockedBy(repo, i.number);
    const open = nodes.filter((n) => String(n?.state || "").toUpperCase() === "OPEN").map((n) => Number(n.number));
    return {
      issue_number: Number(i.number),
      title: String(i.title || ""),
      url: String(i.url || ""),
      blocked_by_open: open,
      has_relationship: open.length > 0,
    };
  });

  const withoutRelationship = issues.filter((i) => !i.has_relationship);
  return {
    repo,
    blocked_count: issues.length,
    without_relationship_count: withoutRelationship.length,
    without_relationship: withoutRelationship,
    issues,
  };
}
