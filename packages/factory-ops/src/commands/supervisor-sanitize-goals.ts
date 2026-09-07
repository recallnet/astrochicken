import { listGoalSubIssues } from "./goal-sub-issues.ts";
import { emitSupervisorArtifact } from "./supervisor-artifact.ts";
import { extractParentGoalRefs, identifyOrphanFeatures } from "./supervisor-detect-orphan-features.ts";
import { orphanSignature } from "./supervisor-remediate-orphan-features.ts";
import { gh, ghJson } from "../lib/cli-helpers.ts";




// Pure: check if all milestones matching goal-{N}-wave-* are closed.
// Returns true only if at least one milestone exists and ALL are closed.
export function areAllWavesComplete(goalNumber, allMilestones = []) {
  const prefix = `goal-${goalNumber}-wave-`;
  const waveMilestones = allMilestones.filter((m) => String(m?.title || "").startsWith(prefix));
  if (waveMilestones.length === 0) return false;
  return waveMilestones.every((m) => String(m?.state || "").toLowerCase() === "closed");
}

const ORPHAN_FEATURE_REMEDIATION_PREFIX = "Goal: Supervisor Remediation — Orphan Features";
const ORPHAN_FEATURE_MILESTONE_REMEDIATION_PREFIX = "Goal: Supervisor Remediation — Orphan Feature Milestones";

export function extractOrphanFeatureSignature(body = "") {
  const match = String(body || "").match(/Orphan-Feature-Signature:\s*(sha256:[0-9a-f]+)/i);
  return String(match?.[1] || "").trim();
}

export function determineSupervisorGoalsToClose({
  goals = [],
  allMilestones = [],
  orphanFeatures = [],
  listGoalSubIssuesFn = null,
  repoForSubIssues = "",
} = {}) {
  const toClose = [];
  const currentOrphanSignature = orphanFeatures.length > 0
    ? orphanSignature(orphanFeatures.map((feature) => feature.number))
    : "";

  for (const g of Array.isArray(goals) ? goals : []) {
    const title = String(g?.title || "");
    if (title.startsWith("[artifact] ")) {
      toClose.push({ issue_number: String(g.number), reason: "not planned", note: "Closing stale artifact-derived goal; artifacts are telemetry and should not remain as backlog goals." });
      continue;
    }
    if (title.startsWith(ORPHAN_FEATURE_MILESTONE_REMEDIATION_PREFIX) && orphanFeatures.length === 0) {
      toClose.push({ issue_number: String(g.number), reason: "completed", note: "Closing remediation goal; orphan feature invariant is clean." });
      continue;
    }
    if (title.startsWith(ORPHAN_FEATURE_REMEDIATION_PREFIX)) {
      const goalSignature = extractOrphanFeatureSignature(g?.body || "");
      if (!currentOrphanSignature) {
        toClose.push({ issue_number: String(g.number), reason: "completed", note: "Closing remediation goal; orphan feature invariant is clean." });
        continue;
      }
      if (goalSignature && goalSignature !== currentOrphanSignature) {
        // @context:regression !critical Orphan-feature remediation goals are keyed to the
        // exact orphan set signature. Once the live orphan set changes, old goals become
        // dangerous stale state because they describe/link the wrong features and can trap
        // the supervisor in review loops around obsolete remediation work.
        toClose.push({
          issue_number: String(g.number),
          reason: "not planned",
          note: `Closing superseded remediation goal; current orphan feature signature is ${currentOrphanSignature}.`,
        });
        continue;
      }
    }
    // @context:regression !critical Wave milestone closure alone is not sufficient
    // to close a goal. Goals can be re-decomposed into sub-issues after waves
    // complete. If the goal still has open sub-issues, it must remain open
    // regardless of milestone state — otherwise the sweep closes goals with
    // unfinished work from later decomposition passes.
    if (areAllWavesComplete(g.number, allMilestones)) {
      const subs = listGoalSubIssuesFn
        ? listGoalSubIssuesFn({ repo: repoForSubIssues, goalNumber: g.number })
        : [];
      const hasOpenSubs = Array.isArray(subs) && subs.some((s) => String(s?.state || "").toUpperCase() === "OPEN");
      if (!hasOpenSubs) {
        toClose.push({ issue_number: String(g.number), reason: "completed", note: "All wave milestones for this goal are closed and no open sub-issues remain. Goal is complete." });
      }
    }
  }

  return toClose;
}

export function sanitizeSupervisorGoals({ repo, runId = "", pipeline = "factory_supervisor_tick", dryRun = false } = {}) {
  if (!repo) return { closed_count: 0, closed: [], dry_run: dryRun, summary: "missing_repo" };

  const goals = ghJson([
    "issue", "list", "--repo", repo, "--state", "open", "--label", "goal", "--limit", "200",
    "--json", "number,title,body,labels",
  ], []);

  const openFeatures = ghJson([
    "issue", "list", "--repo", repo, "--state", "open", "--label", "feature", "--limit", "300",
    "--json", "number,title,body,milestone,createdAt,labels,url",
  ], []);
  const goalSubIssueNumbers = new Set();
  for (const goal of goals) {
    const subs = listGoalSubIssues({ repo, goalNumber: goal.number });
    for (const sub of subs) goalSubIssueNumbers.add(sub.number);
  }

  const issueMetadataByNumber = new Map();
  for (const goal of goals) {
    issueMetadataByNumber.set(Number(goal.number), {
      number: Number(goal.number),
      state: "OPEN",
      title: String(goal.title || ""),
      labels: Array.isArray(goal.labels) ? goal.labels : [],
    });
  }
  for (const feature of openFeatures) {
    for (const goalNumber of extractParentGoalRefs(feature?.body || "")) {
      if (issueMetadataByNumber.has(goalNumber)) continue;
      const meta = ghJson([
        "issue", "view", String(goalNumber), "--repo", repo, "--json", "number,state,labels,title",
      ], {});
      issueMetadataByNumber.set(goalNumber, {
        number: Number(meta?.number || goalNumber),
        state: String(meta?.state || "").trim().toUpperCase(),
        title: String(meta?.title || ""),
        labels: Array.isArray(meta?.labels) ? meta.labels : [],
      });
    }
  }
  const orphanFeatures = identifyOrphanFeatures(openFeatures, {
    goalSubIssueNumbers,
    issueMetadataByNumber,
    nowMs: Date.now(),
  });

  // Fetch all milestones (open + closed) to detect completed goals
  const allMilestones = ghJson([
    "api", "-X", "GET", `repos/${repo}/milestones`, "-F", "state=all", "--paginate",
    "--jq", "[.[] | {title: .title, number: .number, state: .state}]",
  ], []);

  const toClose = determineSupervisorGoalsToClose({
    goals,
    allMilestones,
    orphanFeatures,
    listGoalSubIssuesFn: ({ repo: subRepo, goalNumber }) =>
      listGoalSubIssues({ repo: subRepo || repo, goalNumber }),
    repoForSubIssues: repo,
  });

  if (dryRun) {
    return { closed_count: toClose.length, closed: [], would_close: toClose, dry_run: true, summary: toClose.length ? `Would close ${toClose.length} stale supervisor goals.` : "Supervisor goals clean." };
  }

  const closed = [];
  for (const item of toClose) {
    gh(["issue", "comment", item.issue_number, "--repo", repo, "--body", item.note]);
    const c = gh(["issue", "close", item.issue_number, "--repo", repo, "--reason", item.reason]);
    if (c.ok) closed.push(item);
  }

  const summary = closed.length ? `Supervisor goal sanitize applied (closed=${closed.length}).` : "Supervisor goals clean.";
  let artifact = { issue_url: "", error: "" };
  if (closed.length > 0) {
    artifact = emitSupervisorArtifact({
      repo,
      runId,
      pipeline,
      artifactType: "supervisor-goal-sanitize",
      summary,
      evidence: JSON.stringify({ closed, orphan_feature_count: orphanFeatures.length }),
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
