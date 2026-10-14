import { reconcileRuntimeRecoverySweep } from "./factory-recovery-sweep.ts";
import { factoryReleaseTargetingStatus } from "./factory-release-targeting-status.ts";
import { buildControlPlaneBlockerActionItems } from "./supervisor-blocker-review.ts";
import {
  extractParentGoalRefs,
  identifyFeaturesUnderClosedGoals,
  identifyOrphanFeatures,
} from "./supervisor-detect-orphan-features.ts";
import { fetchBugBlockedByBatch, filterSnapshotVisibleOpenBugs } from "./supervisor-open-bug-gate.ts";
import { addActionItem } from "./supervisor-ownership-routing.ts";
import { resolveSnapshotIdentity, collectStaleTelemetry } from "./supervisor-snapshot-identity.ts";
import { extractWaveGiveupSourceIssueNumber, collectClosedFallbackDefectBugHistory, scanRecentCliCrashes } from "./supervisor-state-collector.ts";
import { appendSupervisorStateSnapshotActionItems } from "./supervisor-state-snapshot-actions.ts";
import { fetchIssueMetadataBatch, fetchIssueStateBatch } from "../lib/batched-github-queries.ts";
import { fetchAllOpenIssues, filterByLabel, filterBySearch, filterUnlabeled } from "../lib/batched-issue-fetch.ts";
import { trim } from "../lib/cli-helpers.ts";
import { computeFactoryContractHash, detectWaveContractDrift, buildContractDriftActionItems } from "../lib/factory-contract-drift.ts";
import { buildFallbackDefectActionItems, loadFallbackDefectSignals } from "../lib/fallback-defect-snapshot.ts";
import { buildFleetRolloutActionItems } from "../lib/fleet-rollout-action-items.ts";
import { resolveSnapshotGitHubReaders } from "../lib/supervisor-state-snapshot-gh.ts";
import { loadOpenDurablePacketActionItems, shouldSuppressSynthesisActionItem } from "../lib/supervisor-state-snapshot-packet-first.ts";

export function buildStateSnapshot({
  repo,
  factoryId = "",
  targetRepo = "",
  controlPlaneRepo = "",
  factoryRoot = "",
  factoryConfigPath = "",
  factoryConfig = null,
  registryPath = "",
  policyPath = "",
  policyJson = "",
  manifestPath = "",
  manifestRef = "",
  manifestFetchCmd = "",
  skipRecoverySweep = false,
  ghJsonFn,
  ghPaginatedFn,
  backendAdapter,
  listGoalSubIssuesFn,
  recoverySweepFn = reconcileRuntimeRecoverySweep,
  scanCliCrashesFn = scanRecentCliCrashes,
  nowMs = Date.now(),
  runsDir = ".hatch/runs",
} = {}) {
  const snapshotErrors = [];
  const snapshotGithubReaders = resolveSnapshotGitHubReaders({
    ghJsonFn,
    ghPaginatedFn,
    listGoalSubIssuesFn,
  });
  ghJsonFn = snapshotGithubReaders.ghJsonFn;
  listGoalSubIssuesFn = snapshotGithubReaders.listGoalSubIssuesFn;

  const identity = resolveSnapshotIdentity({
    repo, factoryId, targetRepo, controlPlaneRepo,
    factoryRoot, factoryConfigPath, factoryConfig,
    ghJsonFn, backendAdapter, runsDir, snapshotErrors,
  });
  if (identity.error) return JSON.stringify({ error: identity.error });
  const {
    normalizedFactoryId, normalizedTargetRepo, normalizedRepo,
    normalizedControlPlaneRepo,
    resolvedRunsDir, recoverySweepScope, judgeContextScopeIdentity,
  } = identity;
  repo = normalizedRepo;
  ghJsonFn = identity.ghJsonFn || ghJsonFn;

  const allOpenIssues = fetchAllOpenIssues({ repo, ghJsonFn, limit: 500, snapshotErrors });
  const features = filterByLabel(allOpenIssues, "feature");
  const staleTelemetry = collectStaleTelemetry({ resolvedRunsDir });
  const goals = filterByLabel(allOpenIssues, "goal");
  const goalSubIssues = {};
  const goalSubIssueNumbers = new Set();
  for (const goal of goals) {
    const subs = listGoalSubIssuesFn({ repo, goalNumber: goal.number });
    goalSubIssues[goal.number] = subs;
    for (const s of subs) goalSubIssueNumbers.add(s.number);
  }

  // Batch parent goal metadata: 1 GraphQL call replaces N individual `gh issue view` calls.
  const parentGoalNumbers = new Set();
  for (const feature of features) {
    for (const goalNumber of extractParentGoalRefs(feature?.body || "")) {
      parentGoalNumbers.add(goalNumber);
    }
  }
  const parentGoalMetadataByNumber = fetchIssueMetadataBatch({
    repo,
    issueNumbers: [...parentGoalNumbers],
    ghJsonFn,
  });

  const orphanFeatures = identifyOrphanFeatures(features, {
    goalSubIssueNumbers,
    issueMetadataByNumber: parentGoalMetadataByNumber,
    nowMs: Date.now(),
  })
    .map((i) => {
      const original = features.find((f) => Number(f.number) === i.number);
      return {
        number: i.number,
        title: i.title,
        labels: (original?.labels || []).map((l) => l?.name || l),
        created: original?.createdAt,
      };
    });

  const closedGoalOwnedFeatures = identifyFeaturesUnderClosedGoals(features, {
    goalSubIssueNumbers,
    issueMetadataByNumber: parentGoalMetadataByNumber,
  }).map((feature) => {
    const original = features.find((f) => Number(f.number) === feature.number);
    return {
      number: feature.number,
      title: feature.title,
      created: original?.createdAt,
      labels: (original?.labels || []).map((l) => l?.name || l),
      parent_goal_numbers: feature.parent_goal_numbers,
      closed_goal_numbers: feature.closed_goal_numbers,
    };
  });

  // All from unified fetch — zero additional API calls.
  const openWaveReady = filterBySearch(allOpenIssues, "Wave Ready:");
  const quarantined = filterByLabel(allOpenIssues, "quarantined");
  const allOpenBugs = filterByLabel(allOpenIssues, "bug");

  const staleWaveGiveupBugs = [];
  const bugs = [];
  const bugBlockedByByIssue = fetchBugBlockedByBatch({
    repo,
    issueNumbers: allOpenBugs.map((bug) => bug?.number),
    ghJsonFn,
  });

  // Batch-fetch source issue states for wave-giveup bugs: 1 GraphQL call replaces N individual lookups.
  const waveGiveupSourceMap = new Map();
  for (const bug of allOpenBugs) {
    const sourceIssueNumber = extractWaveGiveupSourceIssueNumber({ title: bug?.title, body: bug?.body });
    if (sourceIssueNumber > 0) {
      waveGiveupSourceMap.set(bug.number, sourceIssueNumber);
    }
  }
  const sourceIssueStates = waveGiveupSourceMap.size > 0
    ? fetchIssueStateBatch({ repo, issueNumbers: [...waveGiveupSourceMap.values()], ghJsonFn })
    : new Map();

  for (const bug of allOpenBugs) {
    const sourceIssueNumber = waveGiveupSourceMap.get(bug.number);
    if (sourceIssueNumber > 0) {
      const sourceIssueState = sourceIssueStates.get(sourceIssueNumber) || "";
      if (sourceIssueState === "CLOSED") {
        staleWaveGiveupBugs.push({
          ...bug,
          source_issue_number: sourceIssueNumber,
          source_issue_state: sourceIssueState,
        });
        continue;
      }
    }
    bugs.push({
      ...bug,
      blocked_by: bugBlockedByByIssue[Number(bug?.number) || 0] || [],
    });
  }
  const visibleOpenBugs = filterSnapshotVisibleOpenBugs(bugs, { repo, ghJsonFn });

  const openHumanIssues = filterByLabel(allOpenIssues, "human");

  const mergeFollowupsMislabeled = features
    .filter((i) => /merge\s+(conveyor\s+)?follow.?up/i.test(String(i.title || "")))
    .map((i) => ({
      number: i.number,
      title: i.title,
      labels: (i.labels || []).map((l) => l.name),
    }));

  const openMergeFollowups = filterByLabel(allOpenIssues, "merge-followup")
    .map((i) => ({ number: i.number, title: i.title, body: String(i.body || ""), labels: (i.labels || []).map((l) => l.name), created: i.createdAt }));

  const unlabeled = filterUnlabeled(allOpenIssues)
    .map((i) => ({ number: i.number, title: i.title, created: i.createdAt }));

  const controlPlaneBlockerResult = buildControlPlaneBlockerActionItems({
    features,
    repo,
    ghJsonFn,
  });

  const actionItems = [];
  const appendActionItem = (item) => {
    addActionItem(actionItems, item, {
      targetRepo: normalizedTargetRepo,
      controlPlaneRepo: normalizedControlPlaneRepo,
    });
  };

  const persistedPacketActionItems = loadOpenDurablePacketActionItems({
    runsDir: resolvedRunsDir,
    factoryId: normalizedFactoryId,
    repo,
    nowMs,
    openIssueNumbers: new Set(
      allOpenIssues
        .map((issue) => Number(issue?.number))
        .filter((issueNumber) => Number.isFinite(issueNumber) && issueNumber > 0),
    ),
  });
  const scannedOpenDurablePacketCount = persistedPacketActionItems.length;
  const persistedPacketByDedupeKey = new Map(
    persistedPacketActionItems
      .map((item) => [String(item.packet_dedupe_key || ""), item])
      .filter(([key]) => Boolean(key)),
  );
  const synthesisActionItems = [];
  const appendSynthesisActionItem = (item) => {
    if (shouldSuppressSynthesisActionItem({ item, persistedPacketByDedupeKey })) {
      return;
    }
    appendActionItem(item);
    synthesisActionItems.push(item);
  };
  const appendSynthesisActionItems = (items = []) => {
    for (const item of items) appendSynthesisActionItem(item);
  };

  for (const packetItem of persistedPacketActionItems) {
    appendActionItem(packetItem);
  }

  const fallbackDefectSignals = loadFallbackDefectSignals({
    runsDir: resolvedRunsDir,
    nowMs,
    snapshotErrors,
  });
  const closedFallbackBugHistory = fallbackDefectSignals.length > 0
    ? collectClosedFallbackDefectBugHistory({ repo, ghJsonFn })
    : [];
  appendSynthesisActionItems(buildFallbackDefectActionItems({
    signals: fallbackDefectSignals,
    nowMs,
    closedBugHistory: closedFallbackBugHistory,
  }));

  const resolvedFactoryRoot = trim(factoryRoot);
  if (resolvedFactoryRoot) {
    const currentContractHash = computeFactoryContractHash({ factoryRoot: resolvedFactoryRoot });
    if (currentContractHash) {
      const driftSignals = detectWaveContractDrift({
        runsDir: resolvedRunsDir,
        currentHash: currentContractHash,
        nowMs,
      });
      appendSynthesisActionItems(buildContractDriftActionItems({ signals: driftSignals, repo }));
    }
  }

  for (const blockerItem of controlPlaneBlockerResult.actionItems) {
    if (shouldSuppressSynthesisActionItem({ item: blockerItem, persistedPacketByDedupeKey })) continue;
    actionItems.push(blockerItem);
    synthesisActionItems.push(blockerItem);
  }

  const { staleRuns, cliCrashes } = appendSupervisorStateSnapshotActionItems({
    repo,
    normalizedTargetRepo,
    normalizedControlPlaneRepo,
    normalizedFactoryId,
    resolvedRunsDir,
    nowMs,
    features,
    orphanFeatures,
    closedGoalOwnedFeatures,
    goalSubIssues,
    mergeFollowupsMislabeled,
    openMergeFollowups,
    unlabeled,
    bugs: visibleOpenBugs,
    openHumanIssues,
    staleWaveGiveupBugs,
    staleTelemetry,
    openWaveReady,
    goals,
    ghJsonFn,
    ghPaginatedFn: snapshotGithubReaders.ghPaginatedFn,
    appendActionItem,
    appendSynthesisActionItem,
    appendSynthesisActionItems,
    persistedPacketActionItems,
    persistedPacketByDedupeKey,
    snapshotErrors,
    recoverySweepFn,
    recoverySweepScope,
    scanCliCrashesFn,
    registryPath,
    skipRecoverySweep,
  });

  const rolloutRegistryPath = trim(registryPath);
  if (rolloutRegistryPath) {
    try {
      const report = factoryReleaseTargetingStatus({
        registryPath: rolloutRegistryPath,
        policyPath,
        policyJson,
        manifestPath,
        manifestRef,
        manifestFetchCmd,
      });
      const rolloutItems = buildFleetRolloutActionItems({
        report,
        repo: normalizedTargetRepo,
        controlPlaneRepo: normalizedControlPlaneRepo,
      });
      actionItems.push(...(Array.isArray(rolloutItems) ? rolloutItems : []));
    } catch (error) {
      snapshotErrors.push(`fleet_rollout_action_items_failed:${String(error?.message || error || "unknown_error")}`);
    }
  }

  const snapshot = {
    factory_id: normalizedFactoryId,
    gh_repo: normalizedRepo,
    target_repo: normalizedTargetRepo,
    control_plane_repo: normalizedControlPlaneRepo,
    context_scope: {
      factory_id: normalizedFactoryId,
      gh_repo: normalizedRepo,
      target_repo: normalizedTargetRepo,
      control_plane_repo: normalizedControlPlaneRepo,
    },
    judge_context_scope_identity: judgeContextScopeIdentity,
    judge_context_identity: judgeContextScopeIdentity,
    action_items: actionItems,
    persisted_packet_action_items: persistedPacketActionItems,
    packet_coverage_summary: {
      total_open_durable_packets: scannedOpenDurablePacketCount,
      covered_by_packet: persistedPacketActionItems.length,
      covered_by_synthesis_only: synthesisActionItems.length,
    },
    action_count: actionItems.length,
    snapshot_errors: snapshotErrors,
    stale_runs: staleRuns.length > 0 ? { count: staleRuns.length, sample: staleRuns.slice(0, 3) } : undefined,
    cli_crashes: cliCrashes,
    orphan_features: orphanFeatures,
    closed_goal_owned_features: closedGoalOwnedFeatures,
    quarantined_issues: quarantined.map((q) => ({ number: q.number, title: q.title, created: q.createdAt })),
    open_bugs: visibleOpenBugs.map((b) => {
      const entry = {
        number: b.number,
        title: b.title,
        created: b.createdAt,
        blocked_by: Array.isArray(b.blocked_by) ? b.blocked_by : [],
      };
      const milestone = String(b?.milestone?.title || "").trim();
      if (milestone) entry.milestone = milestone;
      if (goalSubIssueNumbers.has(Number(b.number))) entry.goal_managed = true;
      return entry;
    }),
    ignored_open_bugs: staleWaveGiveupBugs.map((b) => ({
      number: b.number,
      title: b.title,
      created: b.createdAt,
      ignored_reason: "wave_giveup_source_issue_closed",
      source_issue_number: b.source_issue_number,
    })),
    mislabeled_merge_followups: mergeFollowupsMislabeled,
    open_merge_followups: openMergeFollowups.map((mf) => ({
      number: mf.number,
      title: mf.title,
      created: mf.created,
    })),
    unlabeled_issues: unlabeled,
    open_wave_ready: openWaveReady.map((w) => ({
      number: Number(w.number),
      title: String(w.title || ""),
      milestone: String(w?.milestone?.title || ""),
      labels: (w.labels || []).map((l) => l.name),
    })),
    active_control_plane_blockers: controlPlaneBlockerResult.summary,
  };

  return JSON.stringify(snapshot);
}

export { determineOwnershipDecision } from "./supervisor-ownership-routing.ts";
export { detectReviewHarnessDegradation } from "./supervisor-review-harness-degradation.ts";
export { evaluateOpenBugGate } from "./supervisor-open-bug-gate.ts";
