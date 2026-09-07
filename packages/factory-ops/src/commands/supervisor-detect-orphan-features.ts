import { emitGovernedOtelEvent } from "@recallnet/factory-telemetry";

import { listGoalSubIssues } from "./goal-sub-issues.ts";
import { emitSupervisorArtifact, emitBugIssue } from "./supervisor-artifact.ts";
import { gh, ghJson, ghJsonPaginated } from "../lib/cli-helpers.ts";




const ORPHAN_EXCLUDE_LABELS = new Set(["daily-lens-candidate", "daily-lens", "release-report"]);

function hasExcludedLabel(issue) {
  const labels = Array.isArray(issue?.labels) ? issue.labels : [];
  return labels.some((l) => ORPHAN_EXCLUDE_LABELS.has(String(l?.name || l || "")));
}

const PARENT_GOAL_BODY_PATTERNS = [
  /closes?\s+as\s+part\s+of\s+#(\d+)/ig,
  /part\s+of\s+#(\d+)/ig,
  /parent\s+goal\s*:\s*#?(\d+)/ig,
];

export function extractParentGoalRefs(body = "") {
  const refs = new Set();
  const text = String(body || "");
  for (const pattern of PARENT_GOAL_BODY_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const goalNumber = Number(match?.[1] || 0);
      if (Number.isFinite(goalNumber) && goalNumber > 0) refs.add(goalNumber);
    }
  }
  return [...refs].sort((a, b) => a - b);
}

function normalizeIssueMetadataMap(issueMetadataByNumber = new Map()) {
  if (issueMetadataByNumber instanceof Map) return issueMetadataByNumber;
  const map = new Map();
  if (issueMetadataByNumber && typeof issueMetadataByNumber === "object") {
    for (const [key, value] of Object.entries(issueMetadataByNumber)) {
      const num = Number(key);
      if (Number.isFinite(num) && num > 0) map.set(num, value);
    }
  }
  return map;
}

const ORPHAN_GRACE_PERIOD_MS = 60 * 60 * 1000; // 60 minutes

export function classifyFeatureOwnership(
  feature = {},
  {
    goalSubIssueNumbers = new Set(),
    issueMetadataByNumber = new Map(),
    nowMs = 0,
  } = {},
) {
  const featureNumber = Number(feature?.number || 0);
  if (!Number.isFinite(featureNumber) || featureNumber <= 0) {
    return { orphaned: false, classification: "invalid_feature", parent_goal_numbers: [], open_goal_numbers: [], closed_goal_numbers: [] };
  }
  if (hasExcludedLabel(feature)) {
    return { orphaned: false, classification: "excluded", parent_goal_numbers: [], open_goal_numbers: [], closed_goal_numbers: [] };
  }
  if (goalSubIssueNumbers.has(featureNumber)) {
    return { orphaned: false, classification: "goal_sub_issue", parent_goal_numbers: [], open_goal_numbers: [], closed_goal_numbers: [] };
  }

  const metadataMap = normalizeIssueMetadataMap(issueMetadataByNumber);
  const parentGoalNumbers = extractParentGoalRefs(feature?.body || "");
  if (parentGoalNumbers.length === 0) {
    // Grace period: don't flag recently-created features as orphans — the pipeline
    // may not have linked them to a goal yet.
    const createdAtRaw = feature?.created_at || feature?.createdAt;
    if (nowMs > 0 && createdAtRaw) {
      const createdMs = new Date(createdAtRaw).getTime();
      if (Number.isFinite(createdMs) && (nowMs - createdMs) < ORPHAN_GRACE_PERIOD_MS) {
        return { orphaned: false, classification: "too_recent", parent_goal_numbers: [], open_goal_numbers: [], closed_goal_numbers: [] };
      }
    }
    return { orphaned: true, classification: "missing_parent_evidence", parent_goal_numbers: [], open_goal_numbers: [], closed_goal_numbers: [] };
  }

  const governedParentGoalNumbers = parentGoalNumbers.filter((goalNumber) => {
    const meta = metadataMap.get(goalNumber);
    if (!meta) return false;
    const labels = Array.isArray(meta?.labels) ? meta.labels : [];
    const labelNames = labels.map((l) => String(l?.name || l || "").toLowerCase());
    return labelNames.includes("goal");
  });

  if (governedParentGoalNumbers.length === 0) {
    return { orphaned: true, classification: "unverified_parent_reference", parent_goal_numbers: parentGoalNumbers, open_goal_numbers: [], closed_goal_numbers: [] };
  }

  const openGoalNumbers = [];
  const closedGoalNumbers = [];
  for (const goalNumber of governedParentGoalNumbers) {
    const meta = metadataMap.get(goalNumber) || {};
    const state = String(meta?.state || "").toUpperCase();
    if (state === "OPEN") openGoalNumbers.push(goalNumber);
    if (state === "CLOSED") closedGoalNumbers.push(goalNumber);
  }

  if (openGoalNumbers.length > 0) {
    return {
      orphaned: false,
      classification: "owned_by_open_goal",
      parent_goal_numbers: governedParentGoalNumbers,
      open_goal_numbers: openGoalNumbers,
      closed_goal_numbers: closedGoalNumbers,
    };
  }
  if (closedGoalNumbers.length > 0) {
    return {
      orphaned: false,
      classification: "owned_by_closed_goal",
      parent_goal_numbers: governedParentGoalNumbers,
      open_goal_numbers: openGoalNumbers,
      closed_goal_numbers: closedGoalNumbers,
    };
  }

  return {
    orphaned: true,
    classification: "unverified_parent_reference",
    parent_goal_numbers: parentGoalNumbers,
    open_goal_numbers: [],
    closed_goal_numbers: [],
  };
}

// Pure: identify open features with no current or historical parent-goal evidence.
export function identifyOrphanFeatures(
  openFeatures = [],
  {
    goalSubIssueNumbers = new Set(),
    issueMetadataByNumber = new Map(),
    nowMs = 0,
  } = {},
) {
  return (Array.isArray(openFeatures) ? openFeatures : [])
    .filter((i) => classifyFeatureOwnership(i, { goalSubIssueNumbers, issueMetadataByNumber, nowMs }).orphaned)
    .map(i => ({ number: Number(i.number), title: String(i.title || ""), url: String(i.url || "") }));
}

export function identifyFeaturesUnderClosedGoals(
  openFeatures = [],
  {
    goalSubIssueNumbers = new Set(),
    issueMetadataByNumber = new Map(),
    nowMs = 0,
  } = {},
) {
  return (Array.isArray(openFeatures) ? openFeatures : [])
    .map((feature) => {
      const ownership = classifyFeatureOwnership(feature, { goalSubIssueNumbers, issueMetadataByNumber, nowMs });
      return { feature, ownership };
    })
    .filter(({ ownership }) => ownership.classification === "owned_by_closed_goal")
    .map(({ feature, ownership }) => ({
      number: Number(feature.number),
      title: String(feature.title || ""),
      url: String(feature.url || ""),
      parent_goal_numbers: ownership.parent_goal_numbers,
      closed_goal_numbers: ownership.closed_goal_numbers,
    }));
}

// Pure: try to match orphan to a parent goal by milestone naming convention
export function inferParentGoal(orphanNumber, milestones = [], goalIssues = [], orphanTitle = "") {
  const goals = Array.isArray(goalIssues) ? goalIssues : [];
  // Strategy 1: goal body references the orphan issue number
  for (const goal of goals) {
    const body = String(goal.body || "");
    if (body.includes("#" + orphanNumber) || body.includes("/" + orphanNumber)) {
      return { goal_number: Number(goal.number), confidence: "high", reason: "Referenced in goal body" };
    }
  }
  // Strategy 2: orphan title starts with "GOAL-N", "N-N:", or "[Feature N-N]" pattern
  const title = String(orphanTitle || "");
  for (const goal of goals) {
    const gn = String(goal.number);
    const prefixes = [`${gn}-`, `[Feature ${gn}-`, `[Feature ${gn}]`];
    if (prefixes.some((p) => title.startsWith(p) || title.includes(p))) {
      return { goal_number: Number(goal.number), confidence: "high", reason: "Title contains goal number prefix" };
    }
  }
  // Strategy 3: milestone naming convention — if a milestone goal-N-wave-M exists, check if orphan could belong
  const ms = Array.isArray(milestones) ? milestones : [];
  for (const goal of goals) {
    const gn = Number(goal.number);
    if (ms.some((m) => String(m?.title || "").startsWith(`goal-${gn}-wave-`))) {
      // Check if the orphan title has any textual overlap with goal title/body
      const goalText = `${goal.title || ""} ${goal.body || ""}`.toLowerCase();
      const orphanWords = title.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
      const overlap = orphanWords.filter((w) => goalText.includes(w)).length;
      if (overlap >= 2) {
        return { goal_number: gn, confidence: "medium", reason: `Title word overlap (${overlap} words) with goal that has milestones` };
      }
    }
  }
  return { goal_number: 0, confidence: "low", reason: "No parent goal found" };
}

// Pure: find the best open wave milestone for a given goal number.
// Returns the highest-numbered wave milestone (latest wave) so new orphans land at the end.
export function findBestMilestoneForGoal(goalNumber, milestones = []) {
  const prefix = `goal-${goalNumber}-wave-`;
  const matches = (Array.isArray(milestones) ? milestones : [])
    .filter((m) => String(m?.title || "").startsWith(prefix))
    .sort((a, b) => {
      // Sort descending by wave number so we pick the latest wave
      const aWave = Number(String(a.title || "").replace(prefix, "")) || 0;
      const bWave = Number(String(b.title || "").replace(prefix, "")) || 0;
      return bWave - aWave;
    });
  return matches[0] || null;
}

// Side-effectful: detect orphans, auto-remediate where possible, report the rest.
// Unresolvable orphans are left for the LLM review node to handle.
export function fixOrphanFeatures({ repo, runId = "", pipeline = "", ghJsonFn = ghJson, ghFn = gh, ghPaginatedFn = ghJsonPaginated } = {}) {
  if (!repo) return { ok: false, orphan_count: 0, fixed_count: 0, bug_count: 0, error: "missing_repo" };

  const openFeatures = ghJsonFn([
    "issue", "list", "--repo", repo, "--state", "open", "--label", "feature", "--limit", "300",
    "--json", "number,title,milestone,url,labels,createdAt",
  ], []);

  // Build goalSubIssueNumbers from the sub-issues API to avoid false-positive orphans.
  // Include both open AND recently-closed goals — features of a just-closed goal
  // are still valid, not orphans.
  const openGoals = ghJsonFn([
    "issue", "list", "--repo", repo, "--state", "open", "--label", "goal", "--limit", "200",
    "--json", "number",
  ], []);
  const closedGoals = ghJsonFn([
    "issue", "list", "--repo", repo, "--state", "closed", "--label", "goal", "--limit", "50",
    "--json", "number",
  ], []);
  const allGoals = [...openGoals, ...closedGoals];
  const goalSubIssueNumbers = new Set();
  for (const g of allGoals) {
    const subs = listGoalSubIssues({ repo, goalNumber: g.number, ghPaginatedFn });
    for (const s of subs) goalSubIssueNumbers.add(s.number);
  }

  const orphans = identifyOrphanFeatures(openFeatures, { goalSubIssueNumbers, nowMs: Date.now() });

  if (orphans.length === 0) {
    return { ok: true, orphan_count: 0, fixed_count: 0, bug_count: 0, fixed: [], bugs: [] };
  }

  // Fetch goal issues for parent inference
  const goalIssues = ghJsonFn([
    "issue", "list", "--repo", repo, "--state", "open", "--label", "goal", "--limit", "200",
    "--json", "number,title,body",
  ], []);

  const milestones = ghJsonFn([
    "api", "-X", "GET", "repos/" + repo + "/milestones", "-F", "state=open", "--paginate",
    "--jq", "[.[] | {title: .title, number: .number}]",
  ], []);

  const enriched = orphans.map(o => {
    const parent = inferParentGoal(o.number, milestones, goalIssues, o.title);
    return { ...o, likely_parent_goal: parent.goal_number, parent_confidence: parent.confidence, parent_reason: parent.reason };
  });

  const fixed = [];
  const bugs = [];

  for (const orphan of enriched) {
    if ((orphan.parent_confidence === "high" || orphan.parent_confidence === "medium") && orphan.likely_parent_goal > 0) {
      const milestone = findBestMilestoneForGoal(orphan.likely_parent_goal, milestones);
      if (milestone) {
        const res = ghFn(["issue", "edit", String(orphan.number), "--repo", repo, "--milestone", milestone.title]);
        if (res.ok) {
          fixed.push({ number: orphan.number, milestone: milestone.title, goal: orphan.likely_parent_goal });
          continue;
        }
      }
    }

    // Can't auto-fix — leave for LLM review node
    bugs.push({ number: orphan.number, title: orphan.title, likely_parent_goal: orphan.likely_parent_goal, confidence: orphan.parent_confidence });
  }

  // OTEL telemetry for observability
  emitGovernedOtelEvent({
    event_name: "factory.supervisor.fix_orphan_features",
    severity_text: bugs.length > 0 ? "WARN" : "INFO",
    correlation: {
      factory_id: "mothership/factory_supervisor",
      run_id: String(runId || "manual-cli"),
      workflow_id: String(pipeline || "factory_supervisor"),
      capability_id: "supervisor",
      owner: "factory_ops.supervisor_detect_orphan_features",
    },
    attributes: {
      source_repo: repo,
      orphan_count: orphans.length,
      fixed_count: fixed.length,
      bug_count: bugs.length,
      pipeline: String(pipeline || ""),
    },
    body: { fixed, bugs },
  });

  return {
    ok: true,
    orphan_count: enriched.length,
    fixed_count: fixed.length,
    bug_count: bugs.length,
    fixed,
    bugs,
  };
}

// Backward compat alias (deprecated — use fixOrphanFeatures)
export function detectOrphanFeatures(opts) {
  return fixOrphanFeatures(opts);
}
