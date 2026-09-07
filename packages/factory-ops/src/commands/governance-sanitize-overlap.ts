import { emitSupervisorArtifact } from "./supervisor-artifact.ts";
import { trim, gh, ghJson } from "../lib/cli-helpers.ts";




function fp(title = "") {
  return String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function hasLabel(issue, name) {
  const labels = Array.isArray(issue?.labels) ? issue.labels : [];
  return labels.some((l) => String(l?.name || "") === name);
}

export function planGovernanceOverlap(issues = []) {
  const candidates = (Array.isArray(issues) ? issues : []).filter((i) => hasLabel(i, "feature") && !hasLabel(i, "goal"));
  const groups = new Map();

  for (const issue of candidates) {
    const key = fp(issue?.title || "");
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(issue);
  }

  const close = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const sorted = [...g].sort((a, b) => Number(a?.number || 0) - Number(b?.number || 0));
    const keep = sorted[0];
    for (let i = 1; i < sorted.length; i += 1) {
      close.push({ issue_number: String(sorted[i].number), canonical_issue: String(keep.number), title: String(sorted[i].title || "") });
    }
  }

  return { duplicate_count: close.length, close };
}

export function sanitizeGovernanceOverlap({ repo, runId = "", pipeline = "", dryRun = false } = {}) {
  if (!repo) return { duplicate_count: 0, closed: [], dry_run: dryRun, summary: "missing_repo" };

  const issues = ghJson(["issue", "list", "--repo", repo, "--state", "open", "--limit", "200", "--json", "number,title,labels"]);
  const plan = planGovernanceOverlap(issues);

  if (dryRun) {
    return {
      duplicate_count: plan.duplicate_count,
      closed: [],
      would_close: plan.close,
      dry_run: true,
      summary: plan.duplicate_count > 0 ? `Governance overlap detected (${plan.duplicate_count} duplicate feature issues).` : "Governance overlap clean.",
      supervisor_artifact_url: "",
      supervisor_artifact_error: "",
    };
  }

  const closed = [];
  for (const item of plan.close) {
    gh([
      "issue", "comment", item.issue_number, "--repo", repo,
      "--body", `Closing as duplicate governance feature issue. Canonical tracker: #${item.canonical_issue}.`,
    ]);
    const c = gh(["issue", "close", item.issue_number, "--repo", repo, "--reason", "not planned"]);
    if (c.ok) closed.push(item);
  }

  const summary = closed.length > 0
    ? `Governance overlap self-heal applied (duplicates_closed=${closed.length}).`
    : "Governance overlap clean.";

  let artifact = { ok: true, issue_url: "", error: "" };
  if (closed.length > 0) {
    artifact = emitSupervisorArtifact({
      repo,
      runId,
      pipeline,
      artifactType: "governance-overlap-self-heal",
      summary,
      evidence: JSON.stringify({ closed }),
      goalIngest: false,
    });
  }

  return {
    duplicate_count: closed.length,
    closed,
    dry_run: false,
    summary,
    supervisor_artifact_url: artifact.issue_url,
    supervisor_artifact_error: artifact.error,
  };
}
