import { readAllRunStates } from "./factory-status.ts";
import { trim } from "../lib/cli-helpers.ts";

const ACTIVE_RUN_STATUSES = new Set(["running", "queued", "suspended"]);
const WAVE_OWNER_PIPELINE_MARKERS = ["/wave_execute.dot", "/wave_issue_execute.dot"];


function parseIsoMs(value = "") {
  const parsed = Date.parse(trim(value));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function resolveUpdatedEpochMs(state = {}) {
  const updatedAt = trim(state?.updatedAt || state?.updated_at || state?.heartbeatAt || state?.heartbeat_at);
  const parsed = parseIsoMs(updatedAt);
  if (Number.isFinite(parsed)) return parsed;
  const mtime = Number(state?._mtime || 0);
  return Number.isFinite(mtime) && mtime > 0 ? mtime : Number.NaN;
}

function resolveMilestoneTitle(state = {}) {
  const context = state?.context && typeof state.context === "object" ? state.context : {};
  return trim(context.milestone_title || context.milestone || state.milestone || "");
}

function resolveIssueNumber(state = {}) {
  const context = state?.context && typeof state.context === "object" ? state.context : {};
  const issueNumber = Number(context.issue_number || context.current_issue_number || context.target_issue_number || 0);
  return Number.isFinite(issueNumber) && issueNumber > 0 ? String(Math.trunc(issueNumber)) : "";
}

function resolvePipeline(state = {}) {
  return trim(state?.pipelineFile || state?.pipeline || "");
}

function isWaveOwnerPipeline(state = {}) {
  const pipeline = resolvePipeline(state).toLowerCase();
  if (!pipeline) return false;
  return WAVE_OWNER_PIPELINE_MARKERS.some((marker) => pipeline.includes(marker));
}

function sortOwners(left = {}, right = {}) {
  const byMilestone = trim(left.milestone_title).localeCompare(trim(right.milestone_title));
  if (byMilestone !== 0) return byMilestone;
  const byPipeline = trim(left.pipeline).localeCompare(trim(right.pipeline));
  if (byPipeline !== 0) return byPipeline;
  return trim(left.run_id).localeCompare(trim(right.run_id));
}

export function collectActiveWaveMilestoneOwners({
  runStates = new Map(),
  nowEpochMs = Date.now(),
  staleRunMinutes = 20,
} = {}) {
  const states = runStates instanceof Map
    ? [...runStates.values()]
    : (Array.isArray(runStates) ? runStates : []);
  const staleThresholdMs = Number(staleRunMinutes) > 0
    ? Number(staleRunMinutes) * 60 * 1000
    : Number.POSITIVE_INFINITY;
  const owners = [];
  const activeMilestones = new Set();

  for (const state of states) {
    if (!state || typeof state !== "object") continue;
    const status = trim(state.status).toLowerCase();
    if (!ACTIVE_RUN_STATUSES.has(status)) continue;
    if (!isWaveOwnerPipeline(state)) continue;

    const milestoneTitle = resolveMilestoneTitle(state);
    if (!milestoneTitle) continue;

    const updatedEpochMs = resolveUpdatedEpochMs(state);
    if (Number.isFinite(updatedEpochMs) && Number.isFinite(staleThresholdMs) && staleThresholdMs !== Number.POSITIVE_INFINITY) {
      if ((nowEpochMs - updatedEpochMs) > staleThresholdMs) continue;
    }

    activeMilestones.add(milestoneTitle);
    owners.push({
      run_id: trim(state.runId || state.id || ""),
      status,
      milestone_title: milestoneTitle,
      issue_number: resolveIssueNumber(state),
      pipeline: resolvePipeline(state),
      updated_at: trim(state.updatedAt || state.updated_at || ""),
      worktree_dir: trim(state?.context?.worktree_dir || ""),
    });
  }

  owners.sort(sortOwners);

  return {
    active_milestones: [...activeMilestones].sort((a, b) => a.localeCompare(b)),
    owner_count: owners.length,
    owners,
  };
}

export function loadActiveWaveMilestoneOwners({
  runsDir = ".hatch/runs",
  nowEpochMs = Date.now(),
  staleRunMinutes = 20,
  readRunStates = readAllRunStates,
} = {}) {
  const runStates = readRunStates({ runsDir });
  return collectActiveWaveMilestoneOwners({
    runStates,
    nowEpochMs,
    staleRunMinutes,
  });
}

export function mergeLocalActiveMilestones(activeLeases = {}, activeRunOwnership = {}) {
  const activeLeaseList = Array.isArray(activeLeases?.active_leases) ? [...activeLeases.active_leases] : [];
  const activeMilestones = new Set(
    (Array.isArray(activeLeases?.active_milestones) ? activeLeases.active_milestones : [])
      .map((milestone) => trim(milestone))
      .filter(Boolean),
  );
  const existingByMilestone = new Set(activeLeaseList.map((lease) => trim(lease?.milestone_title)).filter(Boolean));
  const owners = Array.isArray(activeRunOwnership?.owners) ? activeRunOwnership.owners : [];

  for (const owner of owners) {
    const milestoneTitle = trim(owner?.milestone_title);
    if (!milestoneTitle) continue;
    activeMilestones.add(milestoneTitle);
    if (existingByMilestone.has(milestoneTitle)) continue;
    activeLeaseList.push({
      run_id: trim(owner?.run_id),
      milestone_title: milestoneTitle,
      status: trim(owner?.status) || "running",
      updated_at: trim(owner?.updated_at),
      worktree_dir: trim(owner?.worktree_dir),
      ready_issue_number: "",
      source: "local_run_guard",
    });
    existingByMilestone.add(milestoneTitle);
  }

  activeLeaseList.sort((a, b) => {
    const byMilestone = trim(a?.milestone_title).localeCompare(trim(b?.milestone_title));
    if (byMilestone !== 0) return byMilestone;
    return trim(a?.run_id).localeCompare(trim(b?.run_id));
  });

  return {
    ...activeLeases,
    active_lease_count: activeLeaseList.length,
    active_milestones: [...activeMilestones].sort((a, b) => a.localeCompare(b)),
    active_leases: activeLeaseList,
  };
}
