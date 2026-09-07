import { emitSupervisorArtifact } from "./supervisor-artifact.ts";
import { trim, parseJson, gh, ghJson } from "../lib/cli-helpers.ts";
import { findFactoryLabelByName } from "../lib/factory-label-registry.ts";
import { mothershipFactoryLabelRegistry } from "../lib/mothership-label-overlay.ts";




export function categorizeMergeFailure({ mergeStatus = "", notes = "" } = {}) {
  const status = String(mergeStatus || "").trim().toLowerCase();
  const text = String(notes || "").toLowerCase();
  if (status === "conflict" || text.includes("merge conflict") || text.includes("conflict")) return "merge_conflict";
  if (text.includes("would be overwritten by merge") || text.includes("local changes")) return "dirty_worktree";
  if (text.includes("not something we can merge") || text.includes("not a valid object name") || text.includes("unknown revision")) return "missing_branch_or_ref";
  return "generic_merge_failure";
}

function categoryTemplate(category) {
  if (category === "dirty_worktree") {
    return "Root cause: merge attempted with uncommitted local changes in target repo. Action: enforce clean-merge preflight or isolate merge in clean worktree before retry.";
  }
  if (category === "merge_conflict") {
    return "Root cause: branch conflicts with main. Action: run deterministic conflict resolver path and validate integration before closing.";
  }
  if (category === "missing_branch_or_ref") {
    return "Root cause: merge source ref missing/invalid. Action: verify branch lifecycle + source ref existence before merge step.";
  }
  return "Root cause: generic merge failure. Action: inspect notes and codify deterministic remediation in merge conveyor.";
}

function resolveMergeFailureNotes(item) {
  const directNotes = String(item?.notes || "").trim();
  if (directNotes) return directNotes;

  const mergeNotes = String(item?.merge_notes || "").trim();
  if (mergeNotes) return mergeNotes;

  const stderr = String(item?.merge_stderr || "").trim();
  if (stderr) return stderr;

  const stdout = String(item?.merge_stdout || "").trim();
  if (stdout) return stdout;

  return "";
}

export function buildMergeFailureComments(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const issue = String(item?.issue_number || "").trim();
      const status = String(item?.merge_status || "").trim() || "failed";
      const resolvedNotes = resolveMergeFailureNotes(item);
      const notes = resolvedNotes || "No merge diagnostics captured.";
      if (!issue) return { issue_number: "", body: "", category: "" };
      const category = categorizeMergeFailure({ mergeStatus: status, notes: resolvedNotes });
      return {
        issue_number: issue,
        category,
        body: [
          "Merge step failed for this issue in wave execution.",
          "",
          `merge_status: ${status}`,
          `merge_failure_category: ${category}`,
          "",
          notes,
          "",
          "Resume policy: keep issue branch intact, fix merge blockers deterministically, then rerun wave_execute.",
        ].join("\n"),
      };
    })
    .filter((x) => x.issue_number && x.body);
}

function renderFollowupBody(category, rows, milestoneTitle = "", readyIssueNumber = "") {
  const lines = rows.map((r) => `- #${r.issue_number} (${r.merge_status || "failed"})`);
  return [
    "Deterministic merge conveyor follow-up (auto-generated).",
    "",
    `Category: ${category}`,
    categoryTemplate(category),
    "",
    milestoneTitle ? `Wave milestone: ${milestoneTitle}` : "",
    readyIssueNumber ? `Wave ready issue: #${readyIssueNumber}` : "",
    `MERGE-FOLLOWUP-CATEGORY: ${category}`,
    "",
    "Affected issues:",
    ...lines,
    "",
    "This issue is auto-maintained. Do not close until remediation is in conveyor logic/tests.",
  ].filter(Boolean).join("\n");
}

function ensureFollowupIssue(repo, category, rows, milestoneTitle = "", readyIssueNumber = "") {
  const title = `Merge Conveyor Follow-up: ${category}`;
  const existing = ghJson([
    "issue", "list", "--repo", repo, "--state", "open", "--search", `\"${title}\" in:title`, "--limit", "20", "--json", "number,title,url",
  ], []).find((i) => String(i?.title || "") === title);

  const body = renderFollowupBody(category, rows, milestoneTitle, readyIssueNumber);
  if (existing?.number) {
    gh(["issue", "comment", String(existing.number), "--repo", repo, "--body", body]);
    return { created: false, number: Number(existing.number), url: String(existing.url || "") };
  }

  const registry = mothershipFactoryLabelRegistry();
  const mergeFollowupLabel = findFactoryLabelByName("merge-followup", registry);
  if (mergeFollowupLabel) {
    gh([
      "label",
      "create",
      mergeFollowupLabel.name,
      "--repo",
      repo,
      "--description",
      mergeFollowupLabel.description,
      "--color",
      mergeFollowupLabel.color,
    ]);
  }
  const followupLabelName = mergeFollowupLabel?.name || "merge-followup";
  const out = gh(["issue", "create", "--repo", repo, "--title", title, "--body", body, "--label", followupLabelName]);
  return { created: out.ok, number: 0, url: String(out.stdout || "").trim() };
}

export function commentMergeFailures({ repo, mergeFailuresRaw = "[]", runId = "", pipeline = "wave_execute", milestoneTitle = "", readyIssueNumber = "" } = {}) {
  const failures = parseJson(String(mergeFailuresRaw || "[]"), []);
  const comments = buildMergeFailureComments(failures);
  const posted = [];

  for (const c of comments) {
    const r = gh(["issue", "comment", c.issue_number, "--repo", repo, "--body", c.body]);
    if (r.ok) posted.push(Number(c.issue_number));
  }

  const byCategory = new Map();
  for (const f of failures) {
    const issue = String(f?.issue_number || "").trim();
    if (!issue) continue;
    const category = categorizeMergeFailure({
      mergeStatus: f?.merge_status,
      notes: resolveMergeFailureNotes(f),
    });
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push({ issue_number: Number(issue), merge_status: String(f?.merge_status || "failed") });
  }

  const followups = [];
  for (const [category, rows] of byCategory.entries()) {
    followups.push({ category, ...ensureFollowupIssue(repo, category, rows, milestoneTitle, readyIssueNumber) });
  }

  let artifact = { ok: true, issue_url: "", error: "" };
  if (posted.length > 0 || followups.length > 0) {
    artifact = emitSupervisorArtifact({
      repo,
      runId,
      pipeline,
      artifactType: "wave-merge-failures",
      summary: `Wave merge failures posted (${posted.length}); follow-ups touched (${followups.length}).`,
      evidence: JSON.stringify({ posted_issues: posted, followups, failures: failures.filter((f) => posted.includes(Number(f?.issue_number))) }),
      goalIngest: false,
    });
  }

  return {
    posted_count: posted.length,
    posted_issues: posted,
    followup_count: followups.length,
    followups,
    supervisor_artifact_url: artifact.issue_url,
    supervisor_artifact_error: artifact.error,
  };
}
