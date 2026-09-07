import { gh, ghJson } from "../lib/cli-helpers.ts";




function hasLabel(issue, label) {
  return (issue?.labels || []).some((l) => String(l?.name || "") === label);
}

export function computeArtifactLabelRepairs(issues = []) {
  return (Array.isArray(issues) ? issues : [])
    .filter((i) => String(i?.title || "").startsWith("[artifact] "))
    .filter((i) => !hasLabel(i, "artifacts"))
    .map((i) => Number(i.number))
    .filter(Number.isFinite);
}

export function sanitizeArtifactLabels({ repo, dryRun = false } = {}) {
  if (!repo) return { changed: 0, issues: [], dry_run: dryRun, summary: "missing_repo" };

  gh(["label", "create", "artifacts", "--repo", repo, "--description", "Machine-generated artifacts", "--color", "5319e7"]);

  const open = ghJson([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--limit",
    "300",
    "--json",
    "number,title,labels",
  ], []);

  const repairs = computeArtifactLabelRepairs(open);
  if (!dryRun) {
    for (const n of repairs) gh(["issue", "edit", String(n), "--repo", repo, "--add-label", "artifacts"]);
  }

  return {
    changed: repairs.length,
    issues: repairs,
    dry_run: dryRun,
    summary: repairs.length ? `Re-applied artifacts label to ${repairs.length} issue(s).` : "Artifact labels already normalized.",
  };
}
