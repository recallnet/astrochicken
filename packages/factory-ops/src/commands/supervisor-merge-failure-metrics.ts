import { emitSupervisorArtifact } from "./supervisor-artifact.ts";
import { trim, parseJson, ghJson } from "../lib/cli-helpers.ts";



function extractPayload(body = "") {
  const m = String(body || "").match(/```json\n([\s\S]*?)\n```/);
  if (!m?.[1]) return null;
  return parseJson(m[1], null);
}

export function aggregateMergeFailureMetrics(artifactIssues = []) {
  const totals = new Map();
  let artifactsScanned = 0;

  for (const issue of Array.isArray(artifactIssues) ? artifactIssues : []) {
    const payload = extractPayload(issue?.body || "");
    if (!payload || String(payload?.artifact_type || "") !== "wave-merge-failures") continue;
    artifactsScanned += 1;
    const evidence = parseJson(String(payload?.evidence || "{}"), {});

    for (const f of evidence?.followups || []) {
      const c = String(f?.category || "generic_merge_failure").trim() || "generic_merge_failure";
      totals.set(c, (totals.get(c) || 0) + 1);
    }
  }

  const categories = Array.from(totals.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  const total_count = categories.reduce((n, x) => n + x.count, 0);
  return { artifacts_scanned: artifactsScanned, total_count, categories };
}

export function emitMergeFailureMetrics({ repo, runId = "", pipeline = "factory_supervisor_tick" } = {}) {
  if (!repo) return { artifacts_scanned: 0, total_count: 0, categories: [], artifact_url: "", artifact_error: "missing_repo" };

  const issues = ghJson([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--label",
    "artifacts",
    "--search",
    "\"factory-supervisor: wave-merge-failures\" in:title",
    "--limit",
    "200",
    "--json",
    "number,title,body",
  ], []);

  const metrics = aggregateMergeFailureMetrics(issues);
  if (metrics.total_count <= 0) return { ...metrics, artifact_url: "", artifact_error: "" };

  const summary = `Merge failure category metrics: ${metrics.categories.map((c) => `${c.category}=${c.count}`).join(", ")}`;
  const artifact = emitSupervisorArtifact({
    repo,
    runId,
    pipeline,
    artifactType: "merge-failure-category-metrics",
    summary,
    evidence: JSON.stringify(metrics),
    goalIngest: false,
  });

  return { ...metrics, artifact_url: artifact.issue_url, artifact_error: artifact.error };
}
