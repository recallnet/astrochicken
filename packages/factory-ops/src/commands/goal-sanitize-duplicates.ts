import { emitSupervisorArtifact } from "./supervisor-artifact.ts";
import { trim, gh, ghJson } from "../lib/cli-helpers.ts";




function fp(title = "") {
  return String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function extractSignature(body = "") {
  const m = String(body || "").match(/Artifact-Signature:\s*(sha256:[a-f0-9]+)/i);
  return m ? m[1].toLowerCase() : "";
}

function dedupeKey(goal = {}) {
  const title = String(goal?.title || "");
  const isArtifact = title.startsWith("[artifact] ");
  if (!isArtifact) return "";

  if (fp(title).includes("supervisor health violations detected")) {
    return "artifact-supervisor-health";
  }

  const sig = extractSignature(goal?.body || "");
  if (!sig) return `artifact-number:${goal?.number || ""}`;
  return `artifact-signature:${sig}`;
}

export function sanitizeGoalDuplicates({
  repo,
  runId = "",
  pipeline = "goal_queue",
  dryRun = false,
  ghFn = gh,
  ghJsonFn = ghJson,
  emitSupervisorArtifactFn = emitSupervisorArtifact,
} = {}) {
  if (!repo) return { closed_count: 0, closed: [], summary: "missing_repo", dry_run: dryRun };

  const goals = ghJsonFn([
    "issue", "list", "--repo", repo, "--state", "all", "--label", "goal", "--limit", "200",
    "--json", "number,title,body,state,labels",
  ], []);

  const byFp = new Map();
  for (const g of goals) {
    const labels = new Set((Array.isArray(g?.labels) ? g.labels : []).map((label) => String(label?.name || "").toLowerCase()));
    if (labels.has("goal") || labels.has("bug")) continue;
    const key = dedupeKey(g);
    if (!key) continue;
    if (!byFp.has(key)) byFp.set(key, []);
    byFp.get(key).push(g);
  }

  const toClose = [];
  for (const group of byFp.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => Number(a.number) - Number(b.number));
    const canonical = String(sorted[0].number);
    for (let i = 1; i < sorted.length; i += 1) {
      if (String(sorted[i]?.state || "").toLowerCase() !== "open") continue;
      toClose.push({ issue_number: String(sorted[i].number), canonical_issue: canonical });
    }
  }

  if (dryRun) return { closed_count: toClose.length, closed: [], would_close: toClose, dry_run: true };

  const closed = [];
  for (const item of toClose) {
    ghFn(["issue", "comment", item.issue_number, "--repo", repo, "--body", `Duplicate goal; canonical goal is #${item.canonical_issue}.`]);
    const c = ghFn(["issue", "close", item.issue_number, "--repo", repo, "--reason", "not planned"]);
    if (c.ok) closed.push(item);
  }

  const summary = closed.length > 0 ? `Goal duplicate self-heal applied (closed=${closed.length}).` : "Goal duplicate clean.";
  let artifact = { issue_url: "", error: "" };
  if (closed.length > 0) {
    artifact = emitSupervisorArtifactFn({
      repo,
      runId,
      pipeline,
      artifactType: "goal-duplicate-self-heal",
      summary,
      evidence: JSON.stringify({ closed }),
      goalIngest: false,
    });
  }

  return {
    closed_count: closed.length,
    closed,
    dry_run: false,
    summary,
    supervisor_artifact_url: artifact.issue_url,
    supervisor_artifact_error: artifact.error,
  };
}
