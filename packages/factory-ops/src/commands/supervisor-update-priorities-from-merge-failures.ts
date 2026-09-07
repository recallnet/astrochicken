import { trim, parseJson, gh, ghJson } from "../lib/cli-helpers.ts";




function extractPayload(body = "") {
  const m = String(body || "").match(/```json\n([\s\S]*?)\n```/);
  if (!m?.[1]) return null;
  return parseJson(m[1], null);
}

function milestoneFromBody(body = "") {
  const m = String(body || "").match(/Wave milestone:\s*(goal-\d+-wave-\d+)/i);
  return m?.[1] ? String(m[1]) : "";
}

function parseCategoryFromTitle(title = "") {
  const m = String(title || "").match(/^Merge Conveyor Follow-up:\s*([a-z_]+)/);
  return m?.[1] ? String(m[1]) : "generic_merge_failure";
}

export function buildMergeFailurePriorityPlan({ followups = [], artifacts = [] } = {}) {
  const catCounts = new Map();

  for (const issue of Array.isArray(artifacts) ? artifacts : []) {
    const payload = extractPayload(issue?.body || "");
    if (!payload || String(payload?.artifact_type || "") !== "wave-merge-failures") continue;
    const evidence = parseJson(String(payload?.evidence || "{}"), {});
    for (const f of evidence?.followups || []) {
      const c = String(f?.category || "generic_merge_failure");
      catCounts.set(c, (catCounts.get(c) || 0) + 1);
    }
  }

  const rows = [];
  for (const f of Array.isArray(followups) ? followups : []) {
    const milestone = milestoneFromBody(f?.body || "");
    if (!milestone) continue;
    rows.push({
      number: Number(f?.number),
      title: String(f?.title || ""),
      category: parseCategoryFromTitle(f?.title || ""),
      milestone,
      url: String(f?.url || ""),
    });
  }

  rows.sort((a, b) => {
    const ac = catCounts.get(a.category) || 0;
    const bc = catCounts.get(b.category) || 0;
    if (ac !== bc) return bc - ac;
    return a.milestone.localeCompare(b.milestone);
  });

  const prioritizedWaves = [];
  for (const r of rows) {
    if (!prioritizedWaves.includes(r.milestone)) prioritizedWaves.push(r.milestone);
  }

  return {
    prioritized_waves: prioritizedWaves,
    category_counts: Array.from(catCounts.entries()).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    followups: rows,
  };
}

export function renderPrioritiesBody(plan) {
  const waves = Array.isArray(plan?.prioritized_waves) ? plan.prioritized_waves : [];
  const cats = Array.isArray(plan?.category_counts) ? plan.category_counts : [];
  const followups = Array.isArray(plan?.followups) ? plan.followups : [];

  const lines = [
    "# Factory Priorities",
    "",
    "## Wave execution order",
    ...waves.map((w, i) => `${i + 1}. ${w}`),
    "",
    "## Merge failure categories",
    ...(cats.length ? cats.map((c) => `- ${c.category}: ${c.count}`) : ["- none"]),
    "",
    "## Active merge follow-ups",
    ...(followups.length
      ? followups.map((f) => `- ${f.milestone} <- ${f.title}${f.url ? ` (${f.url})` : ""}`)
      : ["- none"]),
    "",
    "Auto-updated by supervisor from merge-failure telemetry.",
  ];

  return lines.join("\n");
}

export function updatePrioritiesFromMergeFailures({ repo, dryRun = false } = {}) {
  if (!repo) return { changed: false, dry_run: dryRun, summary: "missing_repo" };

  const followups = ghJson([
    "issue", "list", "--repo", repo, "--state", "open", "--search", "\"Merge Conveyor Follow-up:\" in:title", "--limit", "200", "--json", "number,title,body,url",
  ], []);

  const artifacts = ghJson([
    "issue", "list", "--repo", repo, "--state", "open", "--label", "artifacts", "--search", "\"factory-supervisor: wave-merge-failures\" in:title", "--limit", "200", "--json", "number,title,body",
  ], []);

  const plan = buildMergeFailurePriorityPlan({ followups, artifacts });
  const body = renderPrioritiesBody(plan);
  const hasSignal = (plan.prioritized_waves || []).length > 0 || (plan.category_counts || []).length > 0;

  gh(["label", "create", "priorities", "--repo", repo, "--description", "Current priorities", "--color", "5319e7"]);

  const existing = ghJson([
    "issue", "list", "--repo", repo, "--state", "open", "--label", "priorities", "--limit", "1", "--json", "number,title,body,url",
  ], [])[0];

  if (dryRun) {
    return {
      changed: hasSignal,
      dry_run: true,
      issue_number: Number(existing?.number || 0),
      prioritized_waves: plan.prioritized_waves,
      category_counts: plan.category_counts,
      preview: body,
      summary: hasSignal
        ? "Would update priorities from merge-failure telemetry."
        : "No merge-failure priority signal; would not update/create priorities issue.",
    };
  }

  if (existing?.number) {
    if (!hasSignal) {
      const managed = String(existing?.body || "").includes("Auto-updated by supervisor from merge-failure telemetry.");
      if (managed) {
        gh(["issue", "comment", String(existing.number), "--repo", repo, "--body", "No merge-failure priority signal remains; closing managed priorities issue."]);
        gh(["issue", "close", String(existing.number), "--repo", repo, "--reason", "not planned"]);
        return {
          changed: true,
          dry_run: false,
          issue_number: Number(existing.number),
          prioritized_waves: plan.prioritized_waves,
          category_counts: plan.category_counts,
          summary: "No merge-failure signal; closed managed priorities issue.",
        };
      }
      return {
        changed: false,
        dry_run: false,
        issue_number: Number(existing.number),
        prioritized_waves: plan.prioritized_waves,
        category_counts: plan.category_counts,
        summary: "No merge-failure priority signal; leaving existing priorities issue unchanged.",
      };
    }

    const oldBody = String(existing?.body || "").trim();
    const changed = oldBody !== body.trim();
    if (changed) gh(["issue", "edit", String(existing.number), "--repo", repo, "--body", body]);
    return {
      changed,
      dry_run: false,
      issue_number: Number(existing.number),
      prioritized_waves: plan.prioritized_waves,
      category_counts: plan.category_counts,
      summary: changed ? "Updated priorities issue from merge-failure telemetry." : "Priorities issue already up to date.",
    };
  }

  if (!hasSignal) {
    return {
      changed: false,
      dry_run: false,
      issue_number: 0,
      prioritized_waves: plan.prioritized_waves,
      category_counts: plan.category_counts,
      summary: "No merge-failure priority signal; priorities issue not created.",
    };
  }

  const out = gh(["issue", "create", "--repo", repo, "--title", "Factory Priorities", "--body", body, "--label", "priorities"]);
  return {
    changed: out.ok,
    dry_run: false,
    issue_number: 0,
    prioritized_waves: plan.prioritized_waves,
    category_counts: plan.category_counts,
    summary: out.ok ? "Created priorities issue from merge-failure telemetry." : "failed_create_priorities_issue",
    issue_url: String(out.stdout || "").trim(),
  };
}
