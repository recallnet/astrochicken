
import { loadActiveWaveMilestoneOwners } from "./wave-active-run-guard.ts";
import {
  acquireWaveMarkerClaim,
  buildDeterministicClaimToken,
  milestoneTitleForWaveMarker,
} from "./wave-claim.ts";
import { findPriorWave, isPriorWaveComplete } from "./wave-dispatch-select.ts";
import { createGhCliAdapter } from "../../../github-adapter/src/github-adapter.ts";
import { FACTORY_LABEL_KEYS, getFactoryLabelName } from "../lib/factory-label-contract.ts";

const READY_LABEL = getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.READY);
const WAVE_IN_PROGRESS_LABEL = getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.WAVE_IN_PROGRESS);

function listReadyWaveMarkers(repo, adapter) {
  if (!repo) return [];
  return adapter.issueList({
    state: "open",
    labels: [READY_LABEL],
    fields: "number,title,labels,milestone,body,state",
  });
}

function listMilestoneOpenIssues(repo, milestoneTitle, adapter) {
  if (!repo || !milestoneTitle || !adapter) return [];
  return adapter.issueList({
    state: "open",
    milestone: milestoneTitle,
    fields: "number,title,labels",
  });
}

function issueMilestoneTitle(issue) {
  return milestoneTitleForWaveMarker(issue) || String(issue?.milestone?.title || "").trim();
}

function readyMarkerByMilestone(issues = []) {
  const map = new Map();
  for (const issue of Array.isArray(issues) ? issues : []) {
    const milestoneTitle = issueMilestoneTitle(issue);
    if (!milestoneTitle) continue;
    const list = map.get(milestoneTitle) || [];
    list.push(issue);
    map.set(milestoneTitle, list);
  }
  return map;
}

function assertPriorWaveComplete({ candidate, readyByMilestone, getMilestoneOpenIssues, repo }) {
  const priorWave = findPriorWave(candidate.milestone_title);
  if (!priorWave) return { ok: true, prior_wave: "" };

  const priorWaveTitle = priorWave;
  const priorComplete = isPriorWaveComplete(priorWaveTitle, {
    milestones: [{ title: priorWaveTitle }],
    readyByMilestone,
    getMilestoneOpenIssues: (title) => {
      if (typeof getMilestoneOpenIssues !== "function") return null;
      return getMilestoneOpenIssues(repo, title);
    },
    closedMarkers: [],
  });

  return {
    ok: priorComplete,
    prior_wave: priorWaveTitle,
    milestone_title: String(candidate.milestone_title || ""),
  };
}

export function rankReadyWaves(issues = [], { activeMilestones = [] } = {}) {
  const activeMilestoneSet = new Set(
    (Array.isArray(activeMilestones) ? activeMilestones : [])
      .map((milestone) => String(milestone || "").trim())
      .filter(Boolean),
  );
  const ready = [];
  for (const issue of Array.isArray(issues) ? issues : []) {
    const labels = (issue?.labels || []).map((l) => l?.name).filter(Boolean);
    const title = String(issue?.title || "");
    const m = title.match(/^Wave Ready:\s*(.+)$/);
    if (!m) continue;
    // Exclude wave-in-progress markers — they already have an active owner.
    // Concurrent fan_out.detached slots must never race to claim the same marker.
    if (labels.includes(WAVE_IN_PROGRESS_LABEL)) continue;
    const milestoneTitle = milestoneTitleForWaveMarker(issue) || m[1].trim();
    if (!milestoneTitle) continue;
    if (activeMilestoneSet.has(milestoneTitle)) continue;
    ready.push({
      milestone_title: milestoneTitle,
      ready_issue_number: Number(issue?.number || 0),
      in_progress: false,
    });
  }

  ready.sort((a, b) => {
    if (String(a.milestone_title) !== String(b.milestone_title)) {
      return String(a.milestone_title).localeCompare(String(b.milestone_title));
    }
    return Number(a.ready_issue_number || 0) - Number(b.ready_issue_number || 0);
  });
  const deduped = [];
  const seenMilestones = new Set();
  for (const item of ready) {
    if (seenMilestones.has(item.milestone_title)) continue;
    seenMilestones.add(item.milestone_title);
    deduped.push(item);
  }
  return deduped;
}

export function pickReadyWave(issues = [], { activeMilestones = [] } = {}) {
  const ranked = rankReadyWaves(issues, { activeMilestones });
  if (!ranked.length) return { milestone_title: "", ready_issue_number: "" };
  return {
    milestone_title: ranked[0].milestone_title,
    ready_issue_number: ranked[0].ready_issue_number,
  };
}

export function pickAndClaimReadyWave({
  repo,
  issues = [],
  runId = "",
  workerId = "",
  activeMilestones = [],
  leaseSeconds = 1200,
  nowEpochMs = Date.now(),
  claimAcquire = acquireWaveMarkerClaim,
  getMilestoneOpenIssues = listMilestoneOpenIssues,
} = {}) {
  const ranked = rankReadyWaves(issues, { activeMilestones });
  if (!ranked.length) {
    return {
      milestone_title: "",
      ready_issue_number: "",
      claim_token: "",
      claim_owner_id: "",
      claim_run_id: "",
      claim_lease_expires_at: "",
      claim_reason: Array.isArray(activeMilestones) && activeMilestones.length > 0
        ? "ready_wave_owned_by_active_run"
        : "no_ready_wave",
      claim_acquired: "false",
    };
  }

  const claimOwner = String(workerId || runId || "wave-default-worker").trim();
  const claimRun = String(runId || workerId || "wave-default-run").trim();

  const readyByMilestone = readyMarkerByMilestone(issues);
  if (!repo) {
    return {
      milestone_title: "",
      ready_issue_number: "",
      claim_token: "",
      claim_owner_id: claimOwner,
      claim_run_id: claimRun,
      claim_lease_expires_at: "",
      claim_reason: "missing_repo",
      claim_acquired: "false",
    };
  }

  let firstReason = "";

  for (const candidate of ranked) {
    const issueNumber = Number(candidate.ready_issue_number || 0);
    if (!issueNumber) continue;

    const priorCheck = assertPriorWaveComplete({
      candidate,
      readyByMilestone,
      getMilestoneOpenIssues,
      repo,
    });
    if (!priorCheck.ok) {
      if (!firstReason) firstReason = "prior_wave_open";
      continue;
    }

    const token = buildDeterministicClaimToken({
      ownerId: claimOwner,
      runId: claimRun,
      issueNumber,
      milestoneTitle: candidate.milestone_title,
    });

    const claim = claimAcquire({
      repo,
      issueNumber,
      milestoneTitle: candidate.milestone_title,
      ownerId: claimOwner,
      runId: claimRun,
      claimToken: token,
      leaseSeconds,
      nowEpochMs,
    });

    if (!claim?.ok) {
      return {
        milestone_title: "",
        ready_issue_number: "",
        claim_token: "",
        claim_owner_id: claimOwner,
        claim_run_id: claimRun,
        claim_lease_expires_at: "",
        claim_reason: String(claim?.reason || "claim_error"),
        claim_acquired: "false",
        claim_error: String(claim?.error || ""),
      };
    }

    if (!claim?.acquired) {
      if (!firstReason) firstReason = String(claim?.reason || "claim_denied");
      continue;
    }

    return {
      milestone_title: candidate.milestone_title,
      ready_issue_number: issueNumber,
      claim_token: String(claim?.claim?.claim_token || token),
      claim_owner_id: claimOwner,
      claim_run_id: claimRun,
      claim_lease_expires_at: String(claim?.claim?.lease_expires_at || ""),
      claim_reason: String(claim?.reason || "claim_acquired"),
      claim_acquired: "true",
    };
  }

  return {
    milestone_title: "",
    ready_issue_number: "",
    claim_token: "",
    claim_owner_id: claimOwner,
    claim_run_id: claimRun,
    claim_lease_expires_at: "",
    claim_reason: firstReason || "claim_not_acquired",
    claim_acquired: "false",
  };
}

export function pickReadyWaveFromRepo({
  repo,
  runId = "",
  workerId = "",
  runsDir = ".hatch/runs",
  staleRunMinutes = 20,
  leaseSeconds = 1200,
  nowEpochMs = Date.now(),
  claimAcquire = acquireWaveMarkerClaim,
  activeWaveMilestonesLoader = loadActiveWaveMilestoneOwners,
  getMilestoneOpenIssues,
} = {}) {
  const adapter = createGhCliAdapter({ repo });
  const issues = listReadyWaveMarkers(repo, adapter);
  const activeOwnership = activeWaveMilestonesLoader({
    runsDir,
    nowEpochMs,
    staleRunMinutes,
  });
  return pickAndClaimReadyWave({
    repo,
    issues,
    runId,
    workerId,
    activeMilestones: activeOwnership.active_milestones,
    leaseSeconds,
    nowEpochMs,
    claimAcquire,
    getMilestoneOpenIssues: (resolvedRepo, milestoneTitle) => (
      typeof getMilestoneOpenIssues === "function"
        ? getMilestoneOpenIssues(resolvedRepo, milestoneTitle)
        : listMilestoneOpenIssues(resolvedRepo, milestoneTitle, adapter)
    ),
  });
}
