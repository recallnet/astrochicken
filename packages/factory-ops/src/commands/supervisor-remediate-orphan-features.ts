import { createHash } from "node:crypto";

import { addSubIssue, listGoalSubIssues } from "./goal-sub-issues.ts";
import { emitSupervisorArtifact } from "./supervisor-artifact.ts";
import { extractParentGoalRefs, identifyOrphanFeatures } from "./supervisor-detect-orphan-features.ts";
import { trim, gh, ghJson } from "../lib/cli-helpers.ts";
import { FACTORY_LABEL_KEYS, getFactoryLabelName } from "../lib/factory-label-contract.ts";

const FEATURE_LABEL = getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.FEATURE);
const GOAL_LABEL = getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.GOAL);

export function orphanSignature(orphanNumbers = []) {
  const nums = [...new Set(orphanNumbers.map((n) => Number(n)).filter(Number.isFinite))].sort((a, b) => a - b);
  const seed = JSON.stringify({ type: "orphan_feature_set", issues: nums });
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}

function ensureGoalForSignature({ repo, signature, orphanFeatures }) {
  const existing = ghJson([
    "issue", "list", "--repo", repo, "--state", "open", "--label", GOAL_LABEL, "--limit", "200",
    "--json", "number,title,body,url",
  ], []).find((i) => String(i?.body || "").includes(`Orphan-Feature-Signature: ${signature}`));

  if (existing?.number) {
    return { goalNumber: Number(existing.number), created: false, url: String(existing.url || "") };
  }

  const featureList = orphanFeatures.map((f) => `- #${f.number} ${f.title}`).join("\n");
  const title = `Goal: Supervisor Remediation — Orphan Features (${orphanFeatures.length})`;
  const body = [
    "Auto-generated remediation goal to link orphan feature issues as sub-issues.",
    "",
    "Detected orphan features:",
    featureList || "- none",
    "",
    `Orphan-Feature-Signature: ${signature}`,
  ].join("\n");

  const created = gh(["issue", "create", "--repo", repo, "--title", title, "--body", body, "--label", GOAL_LABEL]);
  if (!created.ok) return { goalNumber: 0, created: false, error: (created.stderr || created.stdout || "goal_create_failed").trim(), url: "" };

  const url = created.stdout.trim();
  const m = url.match(/\/issues\/(\d+)/);
  const goalNumber = m ? Number(m[1]) : 0;
  return { goalNumber, created: true, url };
}

export function remediateOrphanFeatures({ repo, runId = "", pipeline = "factory_supervisor_tick", dryRun = false } = {}) {
  if (!repo) return { ok: false, fixed_count: 0, error: "missing_repo" };

  const openFeatures = ghJson([
    "issue", "list", "--repo", repo, "--state", "open", "--label", FEATURE_LABEL, "--limit", "300",
    "--json", "number,title,body,milestone,url,createdAt",
  ], []);

  // Build set of feature numbers already sub-issued to a goal.
  // This prevents creating remediation goals for features that are already
  // parented via the sub-issues API (even if they lack a milestone).
  const openGoals = ghJson([
    "issue", "list", "--repo", repo, "--state", "open", "--label", GOAL_LABEL, "--limit", "200",
    "--json", "number",
  ], []);
  const goalSubIssueNumbers = new Set();
  for (const g of openGoals) {
    const subs = listGoalSubIssues({ repo, goalNumber: g.number });
    for (const s of subs) goalSubIssueNumbers.add(s.number);
  }

  const parentGoalMetadataByNumber = new Map();
  for (const feature of openFeatures) {
    for (const goalNumber of extractParentGoalRefs(feature?.body || "")) {
      if (parentGoalMetadataByNumber.has(goalNumber)) continue;
      const goalMeta = ghJson([
        "issue", "view", String(goalNumber), "--repo", repo, "--json", "number,state,labels,title",
      ], {});
      parentGoalMetadataByNumber.set(goalNumber, {
        number: Number(goalMeta?.number || goalNumber),
        state: String(goalMeta?.state || "").trim().toUpperCase(),
        title: String(goalMeta?.title || ""),
        labels: Array.isArray(goalMeta?.labels) ? goalMeta.labels : [],
      });
    }
  }

  const orphanFeatures = identifyOrphanFeatures(openFeatures, {
    goalSubIssueNumbers,
    issueMetadataByNumber: parentGoalMetadataByNumber,
    nowMs: Date.now(),
  });

  if (orphanFeatures.length === 0) {
    return { ok: true, fixed_count: 0, goal_number: 0, changed: [] };
  }

  const signature = orphanSignature(orphanFeatures.map((f) => f.number));
  if (dryRun) {
    return {
      ok: true,
      fixed_count: orphanFeatures.length,
      signature,
      dry_run: true,
      would_fix: orphanFeatures,
    };
  }

  const goal = ensureGoalForSignature({ repo, signature, orphanFeatures });
  if (!goal.goalNumber) {
    return { ok: false, fixed_count: 0, error: goal.error || "goal_create_failed" };
  }

  // Link orphan features as sub-issues of the remediation goal (no milestones)
  const changed = [];
  for (const f of orphanFeatures) {
    const res = addSubIssue({ repo, parentNumber: goal.goalNumber, childNumber: f.number });
    if (res.ok) changed.push(f.number);
  }

  if (changed.length > 0) {
    gh(["issue", "comment", String(goal.goalNumber), "--repo", repo, "--body", `Supervisor remediation linked ${changed.length} orphan feature issue(s) as sub-issues.`]);
  }

  const artifact = emitSupervisorArtifact({
    repo,
    runId,
    pipeline,
    artifactType: "orphan-feature-sub-issue-link",
    summary: `Linked ${changed.length} orphan feature issue(s) as sub-issues.`,
    evidence: JSON.stringify({ signature, goal_number: goal.goalNumber, issues: changed }),
    goalIngest: false,
  });

  return {
    ok: true,
    fixed_count: changed.length,
    signature,
    goal_number: goal.goalNumber,
    goal_created: goal.created,
    goal_url: goal.url,
    changed,
    supervisor_artifact_url: artifact.issue_url,
    supervisor_artifact_error: artifact.error,
  };
}
