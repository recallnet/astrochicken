import { factoryStatus } from "./factory-status.ts";
import { emitSupervisorArtifact } from "./supervisor-artifact.ts";
import {
  extractParentGoalRefs,
  identifyFeaturesUnderClosedGoals,
  identifyOrphanFeatures,
} from "./supervisor-detect-orphan-features.ts";
import { trim, ghJson } from "../lib/cli-helpers.ts";
import { resolveRunsDir } from "../lib/runs-dir-resolver.ts";

export const CLOSED_ISSUE_ACTIVE_RUN_THRESHOLD_MS = 5 * 60 * 1000;
export const TERMINAL_CLEANUP_NODES = new Set([
  "clean_main",
  "recheck_main_clean",
  "advance_clean_attempt",
  "build_merged_results",
  "release_merge_lock",
  "assert_main_after_merge",
  "cleanup_merge_worktree",
  "cleanup_goal_worktree",
]);


export function countByMilestone(readyIssues = []) {
  const counts = new Map();
  for (const i of readyIssues) {
    const m = String(i?.milestone?.title || "").trim();
    if (!m) continue;
    counts.set(m, (counts.get(m) || 0) + 1);
  }
  return Array.from(counts.entries()).filter(([, c]) => c > 1).map(([milestone, count]) => ({ milestone, count }));
}

export function fp(title = "") {
  return String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function findDuplicateFeatureTitles(features = []) {
  const groups = new Map();
  for (const f of features) {
    const key = fp(f?.title || "");
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(Number(f?.number));
  }
  return Array.from(groups.entries())
    .filter(([, nums]) => nums.length > 1)
    .map(([title_fingerprint, issues]) => ({ title_fingerprint, issues }));
}

export function parseFailureCount(body = "") {
  const m = String(body || "").match(/WAVE-REVIEW-FAILURE:\s*count=(\d+)/i);
  if (!m) return 0;
  return Number.parseInt(m[1], 10) || 0;
}

function lastFailureCount(repo, issueNumber) {
  const details = ghJson(["issue", "view", String(issueNumber), "--repo", repo, "--json", "comments"], {});
  const comments = Array.isArray(details?.comments) ? details.comments : [];
  let count = 0;
  for (const c of comments) {
    const n = parseFailureCount(c?.body || "");
    if (n > count) count = n;
  }
  return count;
}

function hasOpenBlockers(repo, issueNumber, ghJsonFn = ghJson) {
  const [owner, name] = String(repo || "").split("/");
  if (!owner || !name || !issueNumber) return false;
  const query = `query { repository(owner:\"${owner}\", name:\"${name}\") { i: issue(number:${issueNumber}) { blockedBy(first:100){nodes{number state}} } } }`;
  const out = ghJsonFn(["api", "graphql", "-f", `query=${query}`], {});
  const nodes = out?.data?.repository?.i?.blockedBy?.nodes || [];
  return nodes.some((n) => String(n?.state || "").toUpperCase() === "OPEN");
}

function parseIsoMs(value = "") {
  const ms = Date.parse(String(value || "").trim());
  return Number.isFinite(ms) ? ms : 0;
}

function readIssueState({ repo = "", issueNumber = 0, ghJsonFn = ghJson } = {}) {
  if (!repo || !issueNumber || typeof ghJsonFn !== "function") {
    return { state: "", closedAt: "" };
  }
  const out = ghJsonFn([
    "issue", "view", String(issueNumber), "--repo", repo, "--json", "state,closedAt",
  ], {});
  return {
    state: String(out?.state || "").trim().toUpperCase(),
    closedAt: String(out?.closedAt || "").trim(),
  };
}

export function detectClosedIssueActiveRuns({
  repo = "",
  activeRuns = [],
  now = Date.now(),
  issueStateFn = ({ repo: issueRepo, issueNumber }) => readIssueState({ repo: issueRepo, issueNumber }),
} = {}) {
  const safeNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const violations = [];

  for (const run of Array.isArray(activeRuns) ? activeRuns : []) {
    const issueNumber = Number.parseInt(String(run?.issue || "").trim(), 10);
    if (!Number.isFinite(issueNumber) || issueNumber <= 0) continue;

    const startedAt = String(run?.started_at || run?.startedAt || "").trim();
    const startedMs = parseIsoMs(startedAt);
    if (!startedMs || safeNow - startedMs < CLOSED_ISSUE_ACTIVE_RUN_THRESHOLD_MS) continue;

    const issueState = issueStateFn({ repo, issueNumber }) || {};
    if (String(issueState?.state || "").trim().toUpperCase() !== "CLOSED") continue;

    const node = String(run?.node || run?.current_node || "").trim();
    violations.push({
      run_id: String(run?.id || run?.run_id || "").trim(),
      issue: issueNumber,
      graph: String(run?.graph || "").trim(),
      node,
      started_at: startedAt,
      run_age_ms: Math.max(0, safeNow - startedMs),
      issue_closed_at: String(issueState?.closedAt || issueState?.closed_at || "").trim(),
      terminal_cleanup_node: TERMINAL_CLEANUP_NODES.has(node),
      threshold_ms: CLOSED_ISSUE_ACTIVE_RUN_THRESHOLD_MS,
    });
  }

  return violations;
}

export function checkSupervisorHealth({
  repo,
  runId = "",
  pipeline = "factory_supervisor_tick",
  factoryId = "",
  runsDir = ".hatch/runs",
  now = Date.now(),
  ghJsonFn = ghJson,
  emitSupervisorArtifactFn = emitSupervisorArtifact,
  factoryStatusFn = factoryStatus,
} = {}) {
  if (!repo) return { ok: false, violations: [{ type: "missing_repo" }], artifact_url: "" };

  const openWaveReady = ghJsonFn(["issue", "list", "--repo", repo, "--state", "open", "--search", "\"Wave Ready:\" in:title", "--limit", "200", "--json", "number,title,milestone,labels"]);
  const openFeatures = ghJsonFn(["issue", "list", "--repo", repo, "--state", "open", "--label", "feature", "--limit", "300", "--json", "number,title,body,url,milestone,labels,createdAt"]);
  const openQuarantined = ghJsonFn(["issue", "list", "--repo", repo, "--state", "open", "--label", "quarantined", "--limit", "200", "--json", "number,title,labels"]);
  const openGoals = ghJsonFn(["issue", "list", "--repo", repo, "--state", "open", "--label", "goal", "--limit", "300", "--json", "number,title,labels"]);

  const violations = [];

  const dupReady = countByMilestone(openWaveReady.filter((i) => (i.labels || []).some((l) => String(l?.name || "") === "ready")));
  if (dupReady.length > 0) violations.push({ type: "duplicate_wave_ready", details: dupReady });

  const staleWaveMarkers = openWaveReady
    .filter((i) => !(i.labels || []).some((l) => String(l?.name || "") === "ready"))
    .map((i) => Number(i.number));
  if (staleWaveMarkers.length > 0) violations.push({ type: "stale_wave_ready_markers", issues: staleWaveMarkers });

  const goalSubIssueNumbers = new Set();
  for (const goal of openGoals) {
    const subs = ghJsonFn(["api", `repos/${repo}/issues/${goal.number}/sub_issues?per_page=100`], []);
    for (const sub of Array.isArray(subs) ? subs : []) {
      const number = Number(sub?.number || 0);
      if (Number.isFinite(number) && number > 0) goalSubIssueNumbers.add(number);
    }
  }
  const issueMetadataByNumber = new Map();
  for (const feature of openFeatures) {
    for (const goalNumber of extractParentGoalRefs(feature?.body || "")) {
      if (issueMetadataByNumber.has(goalNumber)) continue;
      const meta = ghJsonFn(["issue", "view", String(goalNumber), "--repo", repo, "--json", "number,state,labels,title"], {});
      issueMetadataByNumber.set(goalNumber, {
        number: Number(meta?.number || goalNumber),
        state: String(meta?.state || "").trim().toUpperCase(),
        title: String(meta?.title || ""),
        labels: Array.isArray(meta?.labels) ? meta.labels : [],
      });
    }
  }

  const nowMs = Date.now();
  const orphanFeatures = identifyOrphanFeatures(openFeatures, { goalSubIssueNumbers, issueMetadataByNumber, nowMs });
  if (orphanFeatures.length > 0) violations.push({ type: "orphan_features", issues: orphanFeatures });

  const featuresUnderClosedGoals = identifyFeaturesUnderClosedGoals(openFeatures, { goalSubIssueNumbers, issueMetadataByNumber, nowMs });
  if (featuresUnderClosedGoals.length > 0) {
    violations.push({ type: "features_under_closed_goals", issues: featuresUnderClosedGoals });
  }

  const dupFeatures = findDuplicateFeatureTitles(openFeatures);
  if (dupFeatures.length > 0) violations.push({ type: "duplicate_feature_titles", details: dupFeatures });

  const readyMilestones = new Set(
    openWaveReady
      .filter((i) => (i.labels || []).some((l) => String(l?.name || "") === "ready"))
      .map((i) => String(i?.milestone?.title || "").trim())
      .filter(Boolean),
  );
  const hasInProgressWave = openWaveReady.some((i) => (i.labels || []).some((l) => String(l?.name || "") === "wave-in-progress"));
  const hasQueuedWave = readyMilestones.size > 0;
  const unscheduledUnblockedFeatures = openFeatures
    .filter((f) => String(f?.milestone?.title || "").trim())
    .filter((f) => !hasOpenBlockers(repo, Number(f.number), ghJsonFn))
    .filter((f) => !readyMilestones.has(String(f?.milestone?.title || "").trim()))
    .map((f) => ({ number: Number(f.number), title: String(f.title || ""), milestone: String(f?.milestone?.title || "") }));
  if (!hasInProgressWave && !hasQueuedWave && unscheduledUnblockedFeatures.length > 0) {
    violations.push({ type: "unscheduled_unblocked_features", issues: unscheduledUnblockedFeatures });
  }

  const repeatedReviewFailures = openQuarantined.map((i) => ({
    number: Number(i.number),
    title: String(i.title || ""),
    failure_count: lastFailureCount(repo, i.number),
  }));
  if (repeatedReviewFailures.length > 0) {
    violations.push({ type: "repeated_review_failures", issues: repeatedReviewFailures });
  }

  const artifactLabelMissing = ghJsonFn([
    "issue", "list", "--repo", repo, "--state", "open", "--limit", "300", "--json", "number,title,labels",
  ])
    .filter((i) => String(i?.title || "").startsWith("[artifact] "))
    .filter((i) => !(i.labels || []).some((l) => String(l?.name || "") === "artifacts"))
    .map((i) => Number(i.number));
  if (artifactLabelMissing.length > 0) violations.push({ type: "artifact_label_missing", issues: artifactLabelMissing });

  const artifactGoals = openGoals
    .filter((g) => String(g?.title || "").startsWith("[artifact] "))
    .map((g) => Number(g.number));
  if (artifactGoals.length > 0) violations.push({ type: "artifact_goals_open", issues: artifactGoals });

  const resolvedRunsDir = resolveRunsDir({ runsDir, factoryId });
  const activeStatus = factoryStatusFn({
    runsDir: resolvedRunsDir,
    context: factoryId ? { factory_id: factoryId } : {},
  });
  const closedIssueActiveRuns = detectClosedIssueActiveRuns({
    repo,
    activeRuns: Array.isArray(activeStatus?.active) ? activeStatus.active : [],
    now,
    issueStateFn: ({ repo: issueRepo, issueNumber }) => readIssueState({ repo: issueRepo, issueNumber, ghJsonFn }),
  });
  if (closedIssueActiveRuns.length > 0) {
    violations.push({ type: "closed_issue_active_runs", runs: closedIssueActiveRuns });
  }

  let artifact = { ok: true, issue_url: "", error: "" };
  if (violations.length > 0) {
    artifact = emitSupervisorArtifactFn({
      repo,
      runId,
      pipeline,
      artifactType: "supervisor-health-violations",
      summary: `Supervisor health violations detected (${violations.length}).`,
      evidence: JSON.stringify({ violations }),
      goalIngest: false,
    });
  }

  return {
    ok: violations.length === 0,
    violation_count: violations.length,
    violations,
    artifact_url: artifact.issue_url,
    artifact_error: artifact.error,
  };
}
