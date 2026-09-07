import { trim, gh, ghJson } from "../lib/cli-helpers.ts";




function ageHours(iso) {
  const t = Date.parse(String(iso || ""));
  if (!Number.isFinite(t)) return 0;
  return (Date.now() - t) / 3600000;
}

function hasLabel(issue, name) {
  return (issue?.labels || []).some((l) => String(l?.name || "") === name);
}

function waveMilestoneFromIssue(issue) {
  const byMilestone = String(issue?.milestone?.title || "").trim();
  if (byMilestone) return byMilestone;
  const m = String(issue?.title || "").match(/^Wave Ready:\s*(.+)$/i);
  return m?.[1] ? String(m[1]).trim() : "";
}

export function closeStaleNonGoalIssues({ repo, staleHours = 6, dryRun = false } = {}) {
  if (!repo) return { closed_count: 0, considered: 0, summary: "missing_repo", dry_run: dryRun };

  const threshold = Math.max(0, Number(staleHours ?? 6));
  const open = ghJson([
    "issue", "list", "--repo", repo, "--state", "open", "--limit", "500",
    "--json", "number,title,updatedAt,url,milestone,labels",
  ], []);

  const candidates = [];
  for (const issue of open) {
    if (hasLabel(issue, "goal")) continue;
    if (hasLabel(issue, "artifacts")) continue;
    if (hasLabel(issue, "release-report")) continue;

    const hrs = ageHours(issue.updatedAt);
    if (hrs < threshold) continue;

    const isWaveMarker = /^Wave Ready:/i.test(String(issue?.title || "")) || hasLabel(issue, "wave-in-progress") || hasLabel(issue, "ready");
    if (isWaveMarker) {
      const milestone = waveMilestoneFromIssue(issue);
      if (milestone) {
        const openFeatures = ghJson([
          "issue", "list", "--repo", repo, "--state", "open", "--milestone", milestone, "--label", "feature", "--limit", "200",
          "--json", "number",
        ], []);
        if (openFeatures.length > 0) continue;
      }
    }

    candidates.push({
      number: Number(issue.number),
      title: String(issue.title || ""),
      age_hours: Number(hrs.toFixed(1)),
      labels: (issue.labels || []).map((l) => String(l?.name || "")).filter(Boolean),
    });
  }

  if (dryRun) {
    return {
      dry_run: true,
      considered: candidates.length,
      closed_count: 0,
      would_close: candidates,
      summary: candidates.length ? `Would close ${candidates.length} stale non-goal issue(s).` : "No stale non-goal issues.",
    };
  }

  const closed = [];
  for (const c of candidates) {
    gh([
      "issue", "comment", String(c.number), "--repo", repo,
      "--body", "Supervisor burn-down policy: closing stale non-goal issue and rolling scope to parent goals.",
    ]);
    const out = gh(["issue", "close", String(c.number), "--repo", repo, "--reason", "not planned"]);
    if (out.ok) closed.push(c);
  }

  return {
    dry_run: false,
    considered: candidates.length,
    closed_count: closed.length,
    closed,
    summary: closed.length ? `Closed ${closed.length} stale non-goal issue(s).` : "No stale non-goal issues.",
  };
}
