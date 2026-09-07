import { gh, ghJson } from "../lib/cli-helpers.ts";




export function hasLabel(issue, name) {
  return (issue?.labels || []).some((l) => String(l?.name || "") === name);
}

function getOpenBlockers(repo, issueNumber) {
  const [owner, name] = String(repo || "").split("/");
  if (!owner || !name || !issueNumber) return [];
  const query = `query { repository(owner:\"${owner}\", name:\"${name}\") { i: issue(number:${Number(issueNumber)}) { blockedBy(first:100){nodes{number state}} } } }`;
  const out = ghJson(["api", "graphql", "-f", `query=${query}`], {});
  const nodes = out?.data?.repository?.i?.blockedBy?.nodes || [];
  return nodes.filter((n) => String(n?.state || "").toUpperCase() === "OPEN").map((n) => Number(n.number));
}

export function normalizeFeatureLabels({ repo, dryRun = false } = {}) {
  if (!repo) return { changed: 0, changes: [], dry_run: dryRun, summary: "missing_repo" };

  const features = ghJson([
    "issue", "list", "--repo", repo, "--state", "open", "--label", "feature", "--limit", "300",
    "--json", "number,title,labels",
  ], []);

  const changes = [];
  for (const f of features) {
    const n = String(f.number);
    const blockers = getOpenBlockers(repo, n);
    const hasBlocked = hasLabel(f, "blocked");
    const hasTriaged = hasLabel(f, "triaged");

    const remove = [];
    if (hasTriaged) remove.push("triaged");
    if (hasBlocked) remove.push("blocked");

    if (remove.length === 0) continue;
    changes.push({ issue_number: n, remove, blocker_count: blockers.length });

    if (!dryRun) {
      gh(["issue", "edit", n, "--repo", repo, ...remove.flatMap((x) => ["--remove-label", x])]);
    }
  }

  return {
    changed: changes.length,
    changes,
    dry_run: dryRun,
    summary: changes.length ? `Removed legacy feature labels on ${changes.length} issue(s).` : "Feature labels already normalized.",
  };
}
