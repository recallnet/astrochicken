import { trim, gh, ghJson } from "../lib/cli-helpers.ts";




function categoryFromTitle(title = "") {
  const m = String(title || "").match(/^Merge Conveyor Follow-up:\s*(.+)$/);
  return m ? String(m[1] || "").trim() : "";
}

export function planMergeFollowupClosures({ followups = [], artifacts = [], nowEpoch = 0, staleHours = 24 } = {}) {
  const now = Number(nowEpoch) > 0 ? Number(nowEpoch) : Math.floor(Date.now() / 1000);
  const maxAgeSec = Math.max(1, Number(staleHours || 24)) * 3600;
  const activeCategories = new Set();

  for (const a of Array.isArray(artifacts) ? artifacts : []) {
    const body = String(a?.body || "");
    for (const c of body.match(/"category"\s*:\s*"([a-z_]+)"/g) || []) {
      const m = c.match(/"([a-z_]+)"\s*$/);
      if (m?.[1]) activeCategories.add(m[1]);
    }
    const alt = body.match(/Merge Conveyor Follow-up:\s*([a-z_]+)/g) || [];
    for (const row of alt) {
      const mm = row.match(/:\s*([a-z_]+)$/);
      if (mm?.[1]) activeCategories.add(mm[1]);
    }
  }

  return (Array.isArray(followups) ? followups : [])
    .map((f) => {
      const category = categoryFromTitle(f?.title || "");
      const updatedAt = String(f?.updatedAt || "");
      const ts = Math.floor(new Date(updatedAt || 0).getTime() / 1000) || 0;
      const ageSec = Math.max(0, now - ts);
      return {
        number: Number(f?.number),
        category,
        shouldClose: Boolean(category) && ageSec >= maxAgeSec && !activeCategories.has(category),
        ageSec,
      };
    })
    .filter((x) => Number.isFinite(x.number) && x.shouldClose);
}

export function closeStaleMergeFollowups({ repo, staleHours = 24, nowEpoch = 0, dryRun = false } = {}) {
  if (!repo) return { closed_count: 0, closed: [], dry_run: dryRun, summary: "missing_repo" };

  const followups = ghJson([
    "issue", "list", "--repo", repo, "--state", "open", "--search", "\"Merge Conveyor Follow-up:\" in:title", "--limit", "200", "--json", "number,title,updatedAt,url",
  ], []);

  const artifacts = ghJson([
    "issue", "list", "--repo", repo, "--state", "open", "--label", "artifacts", "--search", "\"wave-merge-failures\" in:title", "--limit", "200", "--json", "number,title,body,updatedAt",
  ], []);

  const plan = planMergeFollowupClosures({ followups, artifacts, nowEpoch, staleHours });
  if (dryRun) {
    return {
      closed_count: 0,
      closed: [],
      would_close: plan.map((p) => ({ number: p.number, category: p.category, age_sec: p.ageSec })),
      dry_run: true,
      summary: plan.length ? `Would close ${plan.length} stale merge follow-up issue(s).` : "No stale merge follow-up issues.",
    };
  }

  const closed = [];
  for (const p of plan) {
    gh(["issue", "comment", String(p.number), "--repo", repo, "--body", `Auto-closing stale merge follow-up for category ${p.category}; no active merge-failure artifacts remain.`]);
    const c = gh(["issue", "close", String(p.number), "--repo", repo, "--reason", "not planned"]);
    if (c.ok) closed.push({ number: p.number, category: p.category, age_sec: p.ageSec });
  }

  return {
    closed_count: closed.length,
    closed,
    dry_run: false,
    summary: closed.length ? `Closed ${closed.length} stale merge follow-up issue(s).` : "No stale merge follow-up issues.",
  };
}
