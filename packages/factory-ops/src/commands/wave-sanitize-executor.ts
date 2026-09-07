import { rmSync } from "node:fs";

import { emitSupervisorArtifact } from "./supervisor-artifact.ts";
import { loadActiveWaveMilestoneOwners, mergeLocalActiveMilestones } from "./wave-active-run-guard.ts";
import { releaseWaveMarkerClaim } from "./wave-claim.ts";
import { collectActiveWaveLeasesFromRepo } from "./wave-claim.ts";
import { createWaveReadyMarker } from "./wave-create-ready.ts";
import {
  hasLabel,
  issueNumber,
  isOpenIssue,
  isWaveMarker,
  milestoneTitleFor,
  readRunStatuses,
  readRunMetadata,
  downgradeOrphanedLeases,
  planWaveOrphanStateRepair,
  buildEmptyPlan,
  summarizePlan,
  planRollup,
} from "./wave-sanitize-rules.ts";
import { resolveCanonicalCheckoutPath } from "../lib/canonical-worktree.ts";
import { parseJson, gh, ghJson } from "../lib/cli-helpers.ts";
import { guardDisposableCleanup } from "../lib/git-mutation-guard.ts";
import { createGithubBlockedByLoader, evaluateMilestoneExternalBlocking } from "../lib/wave-external-blocking.ts";

function ghJsonStrict(args, context = "gh_json") {
  const response = ghJson(args, null);
  if (response === null) {
    throw new Error(`requeueAfterJudgeFailure:${context}: gh_json_failed`);
  }
  return response;
}

function ghStrict(args, context = "gh") {
  const p = gh(args);
  if (!p.ok) {
    const detail = String(p.stderr || p.stdout || "gh_failed").trim();
    throw new Error(`requeueAfterJudgeFailure:${context}: ${detail}`);
  }
  return p;
}

function parseBoolish(value) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeJudgeContext(judgeContext = {}) {
  if (typeof judgeContext === "string") return parseJson(judgeContext, {});
  if (judgeContext && typeof judgeContext === "object") return judgeContext;
  return {};
}

function normalizeCooldownPolicy(cooldownPolicy = {}) {
  const parsed = typeof cooldownPolicy === "string"
    ? parseJson(cooldownPolicy, {})
    : (cooldownPolicy && typeof cooldownPolicy === "object" ? cooldownPolicy : {});
  const blocked = parseBoolish(parsed?.blocked ?? parsed?.active ?? parsed?.cooldown_active ?? false);
  const cooldownReason = String(parsed?.cooldownReason || parsed?.reason || "judge_failure_requeue_cooldown_active").trim();
  const cooldownMinutesRaw = Number(parsed?.cooldownMinutes ?? parsed?.cooldown_minutes ?? 0);
  const cooldownMinutes = Number.isFinite(cooldownMinutesRaw) && cooldownMinutesRaw > 0 ? cooldownMinutesRaw : 0;
  return {
    blocked,
    cooldownReason,
    cooldownMinutes,
  };
}

function listOpenIssuesForRepo(repo, ghJsonFn = ghJsonStrict) {
  return ghJsonFn([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--limit",
    "300",
    "--json",
    "number,title,labels,milestone,state,url",
  ], "list_open_issues");
}

function findOpenWaveMarkerForMilestone(openIssues = [], milestoneTitle = "") {
  const milestone = String(milestoneTitle || "").trim();
  const markers = (Array.isArray(openIssues) ? openIssues : [])
    .filter((issue) => isOpenIssue(issue))
    .filter((issue) => isWaveMarker(issue))
    .filter((issue) => milestoneTitleFor(issue) === milestone)
    .sort((a, b) => {
      const aReady = hasLabel(a, "ready") ? 1 : 0;
      const bReady = hasLabel(b, "ready") ? 1 : 0;
      if (aReady !== bReady) return bReady - aReady;
      return issueNumber(a) - issueNumber(b);
    });

  if (markers.length === 0) return null;
  const marker = markers[0];
  return {
    issue_number: issueNumber(marker) > 0 ? String(issueNumber(marker)) : "",
    title: String(marker?.title || ""),
    url: String(marker?.url || ""),
    has_ready_label: hasLabel(marker, "ready"),
  };
}

function evaluateActionableIssuesForWave({
  repo,
  milestoneTitle,
  openIssues,
  ghJsonFn = ghJsonStrict,
} = {}) {
  const milestone = String(milestoneTitle || "").trim();
  const milestoneIssues = (Array.isArray(openIssues) ? openIssues : [])
    .filter((issue) => isOpenIssue(issue))
    .filter((issue) => !isWaveMarker(issue))
    .filter((issue) => milestoneTitleFor(issue) === milestone);

  if (milestoneIssues.length === 0) {
    return {
      has_actionable_work: false,
      actionable_issue_numbers: [],
      reason: "no_open_feature_issues",
      eligibility: {
        has_runnable_issue: false,
        all_runnable_issues_externally_blocked: false,
        externally_blocked_issue_numbers: [],
        blocked_by: [],
      },
    };
  }

  const getBlockedBy = createGithubBlockedByLoader({ repo, ghJsonFn });
  const eligibility = evaluateMilestoneExternalBlocking({
    milestoneTitle: milestone,
    issues: milestoneIssues,
    getBlockedBy,
  });

  return {
    has_actionable_work: Boolean(eligibility?.has_runnable_issue),
    actionable_issue_numbers: milestoneIssues
      .map((issue) => Number(issue?.number || 0))
      .filter((n) => Number.isFinite(n) && n > 0)
      .map((n) => String(Math.trunc(n))),
    reason: eligibility?.has_runnable_issue
      ? "has_runnable_issue"
      : (eligibility?.all_runnable_issues_externally_blocked ? "cross_milestone_blocked" : "all_issues_blocked_or_quarantined"),
    eligibility,
  };
}

function closeCommentForReason(reason = "") {
  if (reason === "duplicate_wave_marker") {
    return "Closing duplicate wave-ready marker during deterministic orphan-state reconciliation.";
  }
  return "Closing stale wave-ready marker during deterministic orphan-state reconciliation.";
}

function cleanupWorktreePath(worktreeDir = "", { repoPath = process.cwd() } = {}) {
  const resolvedWorktreeDir = String(worktreeDir || "").trim();
  if (!resolvedWorktreeDir) {
    return { ok: false, error: "missing_worktree_dir" };
  }
  const guard = guardDisposableCleanup({
    worktreePath: resolvedWorktreeDir,
    repoPath,
    canonicalCheckoutPath: resolveCanonicalCheckoutPath(),
    operation: "cleanup_worktree",
    enforceMutationContext: true,
  });
  if (!guard.ok) {
    return { ok: false, error: guard.reason };
  }
  try {
    rmSync(resolvedWorktreeDir, { recursive: true, force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function applyWaveOrphanStateRepair({
  repo,
  plan,
  execGh = gh,
  releaseClaim = () => ({ ok: true, released: false, reason: "no_claim_release_handler" }),
  cleanupWorktree = ({ worktreeDir }) => cleanupWorktreePath(worktreeDir),
} = {}) {
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  if (!repo) {
    return {
      ok: false,
      applied_count: 0,
      failed_count: actions.length,
      applied_actions: [],
      failed_actions: actions,
      error: "missing_repo",
    };
  }

  const appliedActions = [];
  const failedActions = [];

  for (const action of actions) {
    if (action.type === "cleanup_worktree") {
      const result = cleanupWorktree({ worktreeDir: String(action.worktree_dir || "") });
      if (result?.ok) appliedActions.push(action);
      else failedActions.push({ action, error: result?.error || "cleanup_worktree_failed" });
      continue;
    }

    const issueNumber = String(action?.issue_number || "").trim();
    if (!issueNumber) {
      failedActions.push({ action, error: "missing_issue_number" });
      continue;
    }

    if (action.type === "release_claim") {
      const result = releaseClaim({
        repo,
        issueNumber,
        reason: String(action.reason || "stale_wave_claim_expired"),
        claimToken: String(action.claim_token || ""),
      });
      if (result?.ok) appliedActions.push(action);
      else failedActions.push({ action, error: result?.error || result?.reason || "claim_release_failed" });
      continue;
    }

    if (action.type === "add_label") {
      const result = execGh(["issue", "edit", issueNumber, "--repo", repo, "--add-label", String(action.label || "")]);
      if (result?.ok) appliedActions.push(action);
      else failedActions.push({ action, error: result?.stderr || "gh_add_label_failed" });
      continue;
    }

    if (action.type === "remove_label") {
      const result = execGh(["issue", "edit", issueNumber, "--repo", repo, "--remove-label", String(action.label || "")]);
      if (result?.ok) appliedActions.push(action);
      else failedActions.push({ action, error: result?.stderr || "gh_remove_label_failed" });
      continue;
    }

    if (action.type === "close_issue") {
      execGh([
        "issue",
        "comment",
        issueNumber,
        "--repo",
        repo,
        "--body",
        closeCommentForReason(String(action.reason || "")),
      ]);
      const result = execGh(["issue", "close", issueNumber, "--repo", repo, "--reason", "not planned"]);
      if (result?.ok) appliedActions.push(action);
      else failedActions.push({ action, error: result?.stderr || "gh_close_issue_failed" });
      continue;
    }

    failedActions.push({ action, error: "unknown_action_type" });
  }

  return {
    ok: failedActions.length === 0,
    applied_count: appliedActions.length,
    failed_count: failedActions.length,
    applied_actions: appliedActions,
    failed_actions: failedActions,
  };
}

export function requeueAfterJudgeFailure({
  repo,
  wave = "",
  milestone = "",
  judgeContext = {},
  cooldownPolicy = {},
  runId = "",
  pipeline = "wave_execute",
  listOpenIssuesFn,
  evaluateActionableIssuesFn = evaluateActionableIssuesForWave,
  createWaveReadyMarkerFn = createWaveReadyMarker,
  emitSupervisorArtifactFn = emitSupervisorArtifact,
  ghJsonFn = ghJsonStrict,
  ghFn = ghStrict,
} = {}) {
  const milestoneTitle = String(milestone || wave || "").trim();
  const waveTitle = String(wave || milestoneTitle || "").trim();
  if (!repo || !milestoneTitle) {
    throw new Error("requeueAfterJudgeFailure: missing_repo_or_milestone");
  }

  const normalizedJudgeContext = normalizeJudgeContext(judgeContext);
  const judgeContextScopeIdentity = String(
    normalizedJudgeContext?.judgeContextScopeIdentity
    || normalizedJudgeContext?.judge_context_scope_identity
    || normalizedJudgeContext?.scopeIdentity
    || normalizedJudgeContext?.scope_identity
    || "wave_execute",
  ).trim() || "wave_execute";

  const cooldown = normalizeCooldownPolicy(cooldownPolicy);
  const loadOpenIssues = typeof listOpenIssuesFn === "function"
    ? listOpenIssuesFn
    : ((targetRepo) => listOpenIssuesForRepo(targetRepo, ghJsonFn));

  const openIssues = loadOpenIssues(repo);
  const existingMarker = findOpenWaveMarkerForMilestone(openIssues, milestoneTitle);

  let decision = "";
  let markerIssueNumber = "";
  let cooldownReason = "";
  let actionable = {
    has_actionable_work: false,
    actionable_issue_numbers: [],
    reason: "not_evaluated",
    eligibility: {
      has_runnable_issue: false,
      all_runnable_issues_externally_blocked: false,
      externally_blocked_issue_numbers: [],
      blocked_by: [],
    },
  };

  if (existingMarker?.issue_number && existingMarker?.has_ready_label) {
    decision = "already_ready";
    markerIssueNumber = String(existingMarker.issue_number);
  } else if (cooldown.blocked) {
    decision = "cooldown_blocked";
    cooldownReason = cooldown.cooldownReason;
  } else {
    actionable = evaluateActionableIssuesFn({
      repo,
      milestoneTitle,
      openIssues,
      ghJsonFn,
    });

    if (!actionable?.has_actionable_work) {
      decision = "cooldown_blocked";
      cooldownReason = String(actionable?.reason || "no_actionable_feature_issues");
    } else {
      const marker = createWaveReadyMarkerFn({
        repo,
        wave: milestoneTitle,
        cooldownMs: cooldown.cooldownMinutes > 0 ? cooldown.cooldownMinutes * 60 * 1000 : 0,
        ghJsonFn,
        ghFn,
      });

      if (!marker?.ok && marker?.decision !== "cooldown_blocked") {
        const markerError = String(marker?.decision || "marker_requeue_failed");
        throw new Error(`requeueAfterJudgeFailure: marker_create_failed:${markerError}`);
      }

      if (marker?.decision === "cooldown_blocked") {
        decision = "cooldown_blocked";
        cooldownReason = String(marker?.cooldownReason || "terminal_release_cooldown_active");
        markerIssueNumber = String(marker?.markerIssueNumber || "");
      } else if (marker?.decision === "already_ready") {
        decision = "already_ready";
        markerIssueNumber = String(marker?.markerIssueNumber || "");
      } else {
        decision = "created_ready_marker";
        markerIssueNumber = String(marker?.markerIssueNumber || "");
      }
    }
  }

  const payload = {
    repo,
    wave: waveTitle,
    milestone: milestoneTitle,
    decision,
    judgeContextScopeIdentity,
    judge_context_scope_identity: judgeContextScopeIdentity,
  };
  if (markerIssueNumber) payload.markerIssueNumber = Number(markerIssueNumber);
  if (cooldownReason) payload.cooldownReason = cooldownReason;

  const summary = `wave-judge-requeue ${milestoneTitle}: ${decision}`;
  const supervisorArtifact = emitSupervisorArtifactFn({
    repo,
    runId,
    pipeline,
    artifactType: "wave-judge-requeue",
    summary,
    evidence: JSON.stringify(payload),
    goalIngest: false,
  });

  return {
    ok: true,
    repo,
    wave: waveTitle,
    milestone: milestoneTitle,
    decision,
    markerIssueNumber,
    cooldownReason,
    judgeContextScopeIdentity,
    wave_ready_marker_action: decision,
    wave_ready_marker_issue: markerIssueNumber,
    cooldown_reason: cooldownReason,
    judge_context_scope_identity: judgeContextScopeIdentity,
    actionable_issue_numbers: Array.isArray(actionable?.actionable_issue_numbers)
      ? actionable.actionable_issue_numbers
      : [],
    actionable_reason: String(actionable?.reason || ""),
    supervisor_artifact_url: String(supervisorArtifact?.issue_url || ""),
    supervisor_artifact_error: String(supervisorArtifact?.error || ""),
  };
}

export function sanitizeWaveState({
  repo,
  dryRun,
  apply = false,
  runId = "",
  pipeline = "",
  runsDir = ".hatch/runs",
  staleRunMinutes = 20,
  nowEpochMs = Date.now(),
} = {}) {
  const dryRunBool = typeof dryRun === "boolean" ? dryRun : !apply;

  if (!repo) {
    const emptyPlan = buildEmptyPlan();
    return {
      ok: false,
      dry_run: dryRunBool,
      summary: "missing_repo",
      repair_plan: emptyPlan,
      duplicate_count: 0,
      relabeled_count: 0,
      closed: [],
      relabeled: [],
      released: [],
      claim_release_count: 0,
      released_claims: [],
      would_close: [],
      would_relabel: [],
      would_release: [],
      would_release_claims: [],
      supervisor_artifact_url: "",
      supervisor_artifact_error: "",
    };
  }

  const openIssues = ghJson([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--limit",
    "300",
    "--json",
    "number,title,labels,milestone,state,updatedAt,url",
  ]);

  // Source-of-truth for in-flight ownership must be durable across restarts/hosts.
  // Use GitHub-backed lease claims/labels instead of local .hatch run-state files.
  const rawLeases = collectActiveWaveLeasesFromRepo({
    repo,
    openIssues,
    nowEpochMs,
    staleClaimMinutes: staleRunMinutes,
  });

  // Cross-reference active lease run_ids against local run state.
  // If a lease's owner run is completed/failed/guarded_terminal/missing,
  // or has a stale heartbeat (zombie process), downgrade it from active
  // to stale for immediate release.
  const runStatuses = readRunStatuses(runsDir);
  const runMetadata = readRunMetadata(runsDir);
  const downgradedLeases = downgradeOrphanedLeases({ activeLeases: rawLeases, runStatuses, runMetadata, staleHeartbeatMinutes: staleRunMinutes, nowEpochMs });
  const activeRunOwnership = loadActiveWaveMilestoneOwners({ runsDir, nowEpochMs, staleRunMinutes });
  const activeLeases = mergeLocalActiveMilestones(downgradedLeases, activeRunOwnership);

  const issuesByMilestone = new Map();
  for (const issue of openIssues) {
    if (isWaveMarker(issue)) continue;
    const milestoneTitle = milestoneTitleFor(issue);
    if (!milestoneTitle) continue;
    if (!issuesByMilestone.has(milestoneTitle)) issuesByMilestone.set(milestoneTitle, []);
    issuesByMilestone.get(milestoneTitle).push(issue);
  }

  const getBlockedBy = createGithubBlockedByLoader({ repo, ghJsonFn: ghJson });
  const externallyBlockedMilestones = [];
  for (const [milestoneTitle, milestoneIssues] of issuesByMilestone.entries()) {
    const eligibility = evaluateMilestoneExternalBlocking({
      milestoneTitle,
      issues: milestoneIssues,
      getBlockedBy,
    });
    if (eligibility.all_runnable_issues_externally_blocked) externallyBlockedMilestones.push(milestoneTitle);
  }

  const plan = planWaveOrphanStateRepair({
    openIssues,
    activeLeases,
    externallyBlockedMilestones,
  });
  const rollup = planRollup(plan, { openIssues });
  const cleanupWorktreePaths = plan.actions
    .filter((action) => action.type === "cleanup_worktree")
    .map((action) => String(action.worktree_dir || ""));
  const leaseEvidence = {
    active_lease_count: activeLeases.active_lease_count,
    active_milestones: activeLeases.active_milestones,
    active_leases: activeLeases.active_leases,
    stale_candidate_count: activeLeases.stale_candidate_count,
    stale_candidates: activeLeases.stale_candidates,
  };

  if (dryRunBool) {
    const summary = summarizePlan(plan, {
      dryRun: true,
      activeLeaseCount: activeLeases.active_lease_count,
      activeMilestones: activeLeases.active_milestones,
    });
    return {
      ok: true,
      dry_run: true,
      summary,
      repair_plan: plan,
      active_lease_milestones: activeLeases.active_milestones,
      duplicate_count: rollup.closeIssueNumbers.length,
      relabeled_count: rollup.addReadyIssueNumbers.length,
      release_count: rollup.releaseIssueNumbers.length,
      claim_release_count: rollup.releaseClaimIssueNumbers.length,
      closed: [],
      relabeled: [],
      released: [],
      released_claims: [],
      cleaned_worktrees: [],
      would_close: rollup.closeIssueNumbers,
      would_close_details: rollup.closeIssueDetails,
      would_relabel: rollup.addReadyIssueNumbers,
      would_relabel_details: rollup.relabelReadyDetails,
      would_release: rollup.releaseIssueNumbers,
      would_release_details: rollup.releaseLabelDetails,
      would_release_claims: rollup.releaseClaimIssueNumbers,
      would_cleanup_worktrees: cleanupWorktreePaths,
      supervisor_artifact_url: "",
      supervisor_artifact_error: "",
      lease_evidence: leaseEvidence,
      lease_guard_summary: activeLeases.active_lease_count > 0
        ? `Active lease guard: ${activeLeases.active_lease_count} active lease(s) for milestones: ${activeLeases.active_milestones.join(", ") || "(none)"}.`
        : "Active lease guard: no active leases detected.",
    };
  }

  const applied = applyWaveOrphanStateRepair({
    repo,
    plan,
    execGh: gh,
    releaseClaim: ({ repo: r, issueNumber: n, reason: rsn, claimToken: tok }) =>
      releaseWaveMarkerClaim({ repo: r, issueNumber: n, reason: rsn, claimToken: tok, force: true }),
  });
  const appliedClose = applied.applied_actions.filter((a) => a.type === "close_issue").map((a) => String(a.issue_number));
  const appliedRelabel = applied.applied_actions
    .filter((a) => a.type === "add_label" && a.label === "ready")
    .map((a) => String(a.issue_number));
  const appliedRelease = applied.applied_actions
    .filter((a) => a.type === "remove_label" && a.label === "wave-in-progress")
    .map((a) => String(a.issue_number));
  const appliedClaimRelease = applied.applied_actions
    .filter((a) => a.type === "release_claim")
    .map((a) => String(a.issue_number));
  const appliedCleanupWorktrees = applied.applied_actions
    .filter((a) => a.type === "cleanup_worktree")
    .map((a) => String(a.worktree_dir || ""));
  const appliedCloseDetails = rollup.closeIssueDetails.filter((entry) => appliedClose.includes(entry.issue_number));
  const appliedRelabelDetails = rollup.relabelReadyDetails.filter((entry) => appliedRelabel.includes(entry.issue_number));
  const appliedReleaseDetails = rollup.releaseLabelDetails.filter((entry) => appliedRelease.includes(entry.issue_number));

  const summary = summarizePlan(plan, {
    dryRun: false,
    appliedCount: applied.applied_count,
    failedCount: applied.failed_count,
    activeLeaseCount: activeLeases.active_lease_count,
    activeMilestones: activeLeases.active_milestones,
  });

  let supervisorArtifact = { ok: true, issue_url: "", error: "" };
  supervisorArtifact = emitSupervisorArtifact({
    repo,
    runId,
    pipeline,
    artifactType: "wave-state-self-heal",
    summary,
    evidence: JSON.stringify({
      plan,
      applied_count: applied.applied_count,
      failed_count: applied.failed_count,
      applied_actions: applied.applied_actions,
      failed_actions: applied.failed_actions,
      lease_guard: {
        active_lease_count: leaseEvidence.active_lease_count,
        active_milestones: leaseEvidence.active_milestones,
        active_leases: leaseEvidence.active_leases,
        stale_candidate_count: leaseEvidence.stale_candidate_count,
        stale_candidates: leaseEvidence.stale_candidates,
      },
      applied_summary: {
        closed: appliedClose,
        relabeled_ready: appliedRelabel,
        released_in_progress: appliedRelease,
        release_claims: appliedClaimRelease,
        cleaned_worktrees: appliedCleanupWorktrees,
        closed_details: appliedCloseDetails,
        relabeled_details: appliedRelabelDetails,
        released_details: appliedReleaseDetails,
      },
    }),
    goalIngest: false,
  });

  return {
    ok: applied.ok,
    dry_run: false,
    summary,
    repair_plan: plan,
    active_lease_milestones: activeLeases.active_milestones,
    duplicate_count: appliedClose.length,
    relabeled_count: appliedRelabel.length,
    release_count: appliedRelease.length,
    claim_release_count: appliedClaimRelease.length,
    closed: appliedClose,
    relabeled: appliedRelabel,
    released: appliedRelease,
    released_claims: appliedClaimRelease,
    cleaned_worktrees: appliedCleanupWorktrees,
    closed_details: appliedCloseDetails,
    relabeled_details: appliedRelabelDetails,
    released_details: appliedReleaseDetails,
    would_close: rollup.closeIssueNumbers,
    would_close_details: rollup.closeIssueDetails,
    would_relabel: rollup.addReadyIssueNumbers,
    would_relabel_details: rollup.relabelReadyDetails,
    would_release: rollup.releaseIssueNumbers,
    would_release_details: rollup.releaseLabelDetails,
    would_release_claims: rollup.releaseClaimIssueNumbers,
    would_cleanup_worktrees: cleanupWorktreePaths,
    applied_count: applied.applied_count,
    failed_count: applied.failed_count,
    failed_actions: applied.failed_actions,
    supervisor_artifact_url: supervisorArtifact.issue_url,
    supervisor_artifact_error: supervisorArtifact.error,
    lease_evidence: leaseEvidence,
    lease_guard_summary: leaseEvidence.active_lease_count > 0
      ? `Active lease guard: ${leaseEvidence.active_lease_count} active lease(s) for milestones: ${leaseEvidence.active_milestones.join(", ") || "(none)"}.`
      : "Active lease guard: no active leases detected.",
  };
}
