import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { trim, parseJson } from "../lib/cli-helpers.ts";

export const WAVE_ORPHAN_REPAIR_SCHEMA_VERSION = "wave_orphan_repair/v1";

export function hasLabel(issue, name) {
  const labels = Array.isArray(issue?.labels) ? issue.labels : [];
  return labels.some((l) => String(l?.name || "") === name);
}

export function issueNumber(issue) {
  const n = Number(issue?.number || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function isWaveMarker(issue) {
  return /^Wave Ready:\s+/.test(String(issue?.title || ""));
}

export function milestoneTitleFor(issue) {
  const fromMilestone = String(issue?.milestone?.title || "").trim();
  if (fromMilestone) return fromMilestone;
  const m = String(issue?.title || "").match(/^Wave Ready:\s*(.+)$/);
  return m ? m[1].trim() : "";
}

export function isOpenIssue(issue) {
  const state = String(issue?.state || "OPEN").toUpperCase();
  return state !== "CLOSED";
}

function isWaveExecutePipeline(run) {
  const pipeline = String(run?.pipelineFile || run?.pipeline || "").toLowerCase();
  if (!pipeline) return false;
  return pipeline.includes("wave_execute.dot") || pipeline.endsWith("wave_execute");
}

function updatedEpochMsForRun(run) {
  const iso = String(run?.updatedAt || "").trim();
  if (iso) {
    const t = Date.parse(iso);
    if (Number.isFinite(t)) return t;
  }
  const mt = Number(run?._mtime || 0);
  if (Number.isFinite(mt) && mt > 0) return mt;
  return Number.NaN;
}

function sortAction(a, b) {
  const rank = {
    close_issue: 0,
    release_claim: 1,
    cleanup_worktree: 2,
    remove_label: 3,
    add_label: 4,
  };
  const ar = rank[a?.type] ?? 99;
  const br = rank[b?.type] ?? 99;
  if (ar !== br) return ar - br;

  const an = Number(a?.issue_number || 0);
  const bn = Number(b?.issue_number || 0);
  if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;

  const am = String(a?.milestone_title || "");
  const bm = String(b?.milestone_title || "");
  if (am !== bm) return am.localeCompare(bm);

  const al = String(a?.label || "");
  const bl = String(b?.label || "");
  if (al !== bl) return al.localeCompare(bl);

  return String(a?.reason || "").localeCompare(String(b?.reason || ""));
}

function setAction(map, key, action) {
  if (!map.has(key)) map.set(key, action);
}

export function buildEmptyPlan() {
  return {
    schema_version: WAVE_ORPHAN_REPAIR_SCHEMA_VERSION,
    action_count: 0,
    actions: [],
    stats: {
      close_issue_count: 0,
      remove_label_count: 0,
      add_label_count: 0,
      duplicate_marker_count: 0,
      stale_marker_count: 0,
      stale_in_progress_release_count: 0,
      stale_claim_release_count: 0,
      invalid_label_count: 0,
      restored_ready_count: 0,
      restored_in_progress_count: 0,
    },
  };
}

export function summarizePlan(plan, { dryRun = true, appliedCount = 0, failedCount = 0, activeLeaseCount = 0, activeMilestones = [] } = {}) {
  const close = Number(plan?.stats?.close_issue_count || 0);
  const remove = Number(plan?.stats?.remove_label_count || 0);
  const add = Number(plan?.stats?.add_label_count || 0);
  const cleanup = Number(plan?.stats?.cleanup_worktree_count || 0);
  const total = Number(plan?.action_count || 0);
  const activeCount = Number(activeLeaseCount || 0);
  const milestoneList = Array.isArray(activeMilestones) && activeMilestones.length > 0
    ? activeMilestones.join(", ")
    : "(none)";
  const leaseNote = activeCount > 0
    ? ` Active lease guard: ${activeCount} active lease(s) for milestones: ${milestoneList}.`
    : " Active lease guard: no active leases detected.";
  if (total === 0) return `Wave orphan-state already clean.${leaseNote}`;
  if (dryRun) {
    return `Wave orphan-state dry-run plan: actions=${total} (close=${close}, cleanup_worktree=${cleanup}, remove_label=${remove}, add_label=${add}).${leaseNote}`;
  }
  return `Wave orphan-state apply complete: applied=${appliedCount}, failed=${failedCount} (planned=${total}, cleanup_worktree=${cleanup}).${leaseNote}`;
}

export function planRollup(plan, { openIssues = [] } = {}) {
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  const issueByNumber = new Map(
    (Array.isArray(openIssues) ? openIssues : []).map((issue) => [String(issue?.number || ""), issue]),
  );
  const closeIssueNumbers = actions.filter((a) => a.type === "close_issue").map((a) => String(a.issue_number));
  const addReadyIssueNumbers = actions
    .filter((a) => a.type === "add_label" && a.label === "ready")
    .map((a) => String(a.issue_number));
  const releaseIssueNumbers = actions
    .filter((a) => a.type === "remove_label" && a.label === "wave-in-progress")
    .map((a) => String(a.issue_number));
  const releaseClaimIssueNumbers = actions
    .filter((a) => a.type === "release_claim")
    .map((a) => String(a.issue_number));

  return {
    closeIssueNumbers,
    addReadyIssueNumbers,
    releaseIssueNumbers,
    releaseClaimIssueNumbers,
    closeIssueDetails: closeIssueNumbers.map((issueNumberValue) => ({
      issue_number: issueNumberValue,
      title: String(issueByNumber.get(issueNumberValue)?.title || ""),
      url: String(issueByNumber.get(issueNumberValue)?.url || ""),
    })),
    relabelReadyDetails: addReadyIssueNumbers.map((issueNumberValue) => ({
      issue_number: issueNumberValue,
      title: String(issueByNumber.get(issueNumberValue)?.title || ""),
      url: String(issueByNumber.get(issueNumberValue)?.url || ""),
    })),
    releaseLabelDetails: releaseIssueNumbers.map((issueNumberValue) => ({
      issue_number: issueNumberValue,
      title: String(issueByNumber.get(issueNumberValue)?.title || ""),
      url: String(issueByNumber.get(issueNumberValue)?.url || ""),
    })),
  };
}

export function collectActiveWaveLeases(runStates = [], { nowEpochMs = Date.now(), staleRunMinutes = 20 } = {}) {
  const thresholdMs = Number(staleRunMinutes) > 0 ? Number(staleRunMinutes) * 60 * 1000 : Number.POSITIVE_INFINITY;
  const activeLeases = [];
  const staleCandidates = [];

  for (const run of Array.isArray(runStates) ? runStates : []) {
    if (!isWaveExecutePipeline(run)) continue;

    const status = String(run?.status || "").toLowerCase();
    if (!["running", "queued", "suspended"].includes(status)) continue;

    const milestoneTitle = String(run?.context?.milestone_title || "").trim();
    if (!milestoneTitle) continue;

    const updatedEpochMs = updatedEpochMsForRun(run);
    const stale = Number.isFinite(updatedEpochMs)
      ? (nowEpochMs - updatedEpochMs) > thresholdMs
      : false;

    const readyIssueNumberRaw = Number(run?.context?.ready_issue_number || run?.context?.ready_issue || 0);
    const lease = {
      run_id: String(run?.runId || run?.id || "").trim(),
      milestone_title: milestoneTitle,
      status,
      updated_at: String(run?.updatedAt || ""),
      worktree_dir: String(run?.context?.worktree_dir || ""),
      ready_issue_number: Number.isFinite(readyIssueNumberRaw) && readyIssueNumberRaw > 0 ? String(Math.trunc(readyIssueNumberRaw)) : "",
    };

    if (stale) {
      staleCandidates.push(lease);
      continue;
    }
    activeLeases.push(lease);
  }

  activeLeases.sort((a, b) => {
    if (a.milestone_title !== b.milestone_title) return a.milestone_title.localeCompare(b.milestone_title);
    if (a.ready_issue_number !== b.ready_issue_number) return String(a.ready_issue_number || "").localeCompare(String(b.ready_issue_number || ""));
    if (a.run_id !== b.run_id) return a.run_id.localeCompare(b.run_id);
    return a.worktree_dir.localeCompare(b.worktree_dir);
  });

  staleCandidates.sort((a, b) => {
    if (a.milestone_title !== b.milestone_title) return a.milestone_title.localeCompare(b.milestone_title);
    if (a.ready_issue_number !== b.ready_issue_number) return String(a.ready_issue_number || "").localeCompare(String(b.ready_issue_number || ""));
    if (a.run_id !== b.run_id) return a.run_id.localeCompare(b.run_id);
    return a.worktree_dir.localeCompare(b.worktree_dir);
  });

  return {
    stale_run_minutes: Number(staleRunMinutes) > 0 ? Number(staleRunMinutes) : 20,
    active_lease_count: activeLeases.length,
    stale_candidate_count: staleCandidates.length,
    active_milestones: [...new Set(activeLeases.map((lease) => lease.milestone_title))],
    active_leases: activeLeases,
    stale_candidates: staleCandidates,
  };
}

export function readRunStatuses(runsDir = ".hatch/runs") {
  const statusByRunId = new Map();
  try {
    const entries = readdirSync(runsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const runId = String(entry.name || "").trim();
      if (!runId) continue;
      const statePath = join(runsDir, runId, "state.json");
      if (!existsSync(statePath)) continue;
      const parsed = parseJson(readFileSync(statePath, "utf8"), null);
      if (!parsed || typeof parsed !== "object") continue;
      const status = String(parsed?.status || "").trim().toLowerCase();
      if (!status) continue;
      statusByRunId.set(runId, status);
    }
  } catch {
    // best-effort introspection; missing runs dir is treated as empty
  }
  return statusByRunId;
}

export function readRunMetadata(runsDir = ".hatch/runs") {
  /** @type {Map<string, { status: string, heartbeatAt: string }>} */
  const metadata = new Map();
  if (!existsSync(runsDir)) return metadata;
  let entries;
  try { entries = readdirSync(runsDir, { withFileTypes: true }); } catch { return metadata; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = join(runsDir, entry.name, "metadata.json");
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
      const status = String(meta?.status || "").trim().toLowerCase();
      const heartbeatAt = String(meta?.heartbeatAt || meta?.updatedAt || "").trim();
      if (status) metadata.set(entry.name, { status, heartbeatAt });
    } catch { /* corrupt metadata — skip */ }
  }
  return metadata;
}

/**
 * Cross-reference active lease run_ids against known run statuses.
 * If a lease's run is completed/failed/guarded_terminal/missing, downgrade
 * it from active to stale so the repair plan releases it immediately.
 *
 * Also detects zombie runs: status="running" but heartbeat is older than
 * `staleHeartbeatMinutes`. This catches processes that died without updating
 * their state file (e.g. OOM, kill -9, daemon restart).
 *
 * Pure function — no I/O. The caller provides `runStatuses` (Map<runId, status>)
 * and optionally `runMetadata` (Map<runId, { status, heartbeatAt }>) for
 * heartbeat-based zombie detection.
 */
export function downgradeOrphanedLeases({ activeLeases = {}, runStatuses = new Map(), runMetadata = new Map(), staleHeartbeatMinutes = 0, nowEpochMs = Date.now() } = {}) {
  const DEAD_STATUSES = new Set(["completed", "failed", "guarded_terminal", "guarded"]);
  const active = [...(Array.isArray(activeLeases.active_leases) ? activeLeases.active_leases : [])];
  const stale = [...(Array.isArray(activeLeases.stale_candidates) ? activeLeases.stale_candidates : [])];
  const heartbeatThresholdMs = Number(staleHeartbeatMinutes) > 0 ? Number(staleHeartbeatMinutes) * 60 * 1000 : 0;

  const remaining = [];
  for (const lease of active) {
    const runId = String(lease?.run_id || "").trim();
    if (!runId) {
      remaining.push(lease);
      continue;
    }
    const status = runStatuses.has(runId) ? String(runStatuses.get(runId) || "").toLowerCase() : null;
    if (status === null) {
      // Run state missing entirely — orphaned
      stale.push({ ...lease, status: "orphaned_missing_run" });
    } else if (DEAD_STATUSES.has(status)) {
      stale.push({ ...lease, status: `orphaned_run_${status}` });
    } else if (heartbeatThresholdMs > 0 && runMetadata.has(runId)) {
      // Zombie detection: run claims to be "running" but heartbeat is stale.
      const meta = runMetadata.get(runId);
      const heartbeatEpoch = Date.parse(String(meta?.heartbeatAt || ""));
      if (Number.isFinite(heartbeatEpoch) && (nowEpochMs - heartbeatEpoch) > heartbeatThresholdMs) {
        stale.push({ ...lease, status: "orphaned_zombie_stale_heartbeat" });
      } else {
        remaining.push(lease);
      }
    } else {
      remaining.push(lease);
    }
  }

  const activeMilestones = [...new Set(remaining.map((l) => String(l?.milestone_title || "").trim()).filter(Boolean))].sort();

  return {
    ...activeLeases,
    active_lease_count: remaining.length,
    stale_candidate_count: stale.length,
    active_milestones: activeMilestones,
    active_leases: remaining,
    stale_candidates: stale,
  };
}

export function planWaveOrphanStateRepair({
  openIssues = [],
  activeLeases = {},
  externallyBlockedMilestones = [],
} = {}) {
  const issues = (Array.isArray(openIssues) ? openIssues : []).filter(isOpenIssue);
  const waveMarkers = issues.filter((i) => isWaveMarker(i));
  const externallyBlocked = new Set(
    (Array.isArray(externallyBlockedMilestones) ? externallyBlockedMilestones : [])
      .map((milestone) => String(milestone || "").trim())
      .filter(Boolean),
  );

  if (waveMarkers.length === 0 && issues.every((i) => !hasLabel(i, "wave-in-progress"))) {
    return buildEmptyPlan();
  }

  const closeByIssue = new Map();
  const releaseClaimByIssue = new Map();
  const removeByIssueLabel = new Map();
  const addByIssueLabel = new Map();

  function addClose(issue, reason) {
    const n = issueNumber(issue);
    if (!n) return;
    setAction(closeByIssue, String(n), {
      type: "close_issue",
      issue_number: String(n),
      milestone_title: milestoneTitleFor(issue),
      reason,
    });
  }

  function addRemove(issue, label, reason) {
    const n = issueNumber(issue);
    if (!n || !label) return;
    const key = `${n}:${label}`;
    setAction(removeByIssueLabel, key, {
      type: "remove_label",
      issue_number: String(n),
      milestone_title: milestoneTitleFor(issue),
      label,
      reason,
    });
  }

  function addAdd(issue, label, reason) {
    const n = issueNumber(issue);
    if (!n || !label) return;
    const key = `${n}:${label}`;
    setAction(addByIssueLabel, key, {
      type: "add_label",
      issue_number: String(n),
      milestone_title: milestoneTitleFor(issue),
      label,
      reason,
    });
  }

  function addReleaseClaim(issue, reason) {
    const n = issueNumber(issue);
    if (!n) return;
    setAction(releaseClaimByIssue, String(n), {
      type: "release_claim",
      issue_number: String(n),
      milestone_title: milestoneTitleFor(issue),
      reason,
    });
  }

  const activeMilestones = new Set((Array.isArray(activeLeases?.active_milestones) ? activeLeases.active_milestones : [])
    .map((m) => String(m || "").trim())
    .filter(Boolean));

  const leaseOwnedMarkerByMilestone = new Map();
  for (const lease of Array.isArray(activeLeases?.active_leases) ? activeLeases.active_leases : []) {
    const milestone = String(lease?.milestone_title || "").trim();
    const leasedIssueNumber = Number(lease?.ready_issue_number || 0);
    if (!milestone || !activeMilestones.has(milestone)) continue;
    if (!Number.isFinite(leasedIssueNumber) || leasedIssueNumber <= 0) continue;
    if (!leaseOwnedMarkerByMilestone.has(milestone)) leaseOwnedMarkerByMilestone.set(milestone, new Set());
    leaseOwnedMarkerByMilestone.get(milestone).add(leasedIssueNumber);
  }

  const groupedMarkers = new Map();
  for (const marker of waveMarkers) {
    const milestoneTitle = milestoneTitleFor(marker);
    if (!milestoneTitle) {
      addClose(marker, "invalid_wave_marker_missing_milestone");
      continue;
    }

    const ready = hasLabel(marker, "ready");
    const inProgress = hasLabel(marker, "wave-in-progress");

    if (!ready && !inProgress) {
      const leaseOwnedMarkers = leaseOwnedMarkerByMilestone.get(milestoneTitle) || new Set();
      if (!leaseOwnedMarkers.has(issueNumber(marker))) {
        addClose(marker, "stale_wave_marker_without_active_labels");
        continue;
      }
    }

    if (!groupedMarkers.has(milestoneTitle)) groupedMarkers.set(milestoneTitle, []);
    groupedMarkers.get(milestoneTitle).push(marker);
  }

  for (const [milestoneTitle, group] of groupedMarkers.entries()) {
    const sorted = [...group].sort((a, b) => {
      const aProg = hasLabel(a, "wave-in-progress") ? 1 : 0;
      const bProg = hasLabel(b, "wave-in-progress") ? 1 : 0;
      if (aProg !== bProg) return bProg - aProg;
      const aReady = hasLabel(a, "ready") ? 1 : 0;
      const bReady = hasLabel(b, "ready") ? 1 : 0;
      if (aReady !== bReady) return bReady - aReady;
      return issueNumber(a) - issueNumber(b);
    });

    const leaseOwnedMarkers = leaseOwnedMarkerByMilestone.get(milestoneTitle) || new Set();
    let keep = sorted[0];
    if (leaseOwnedMarkers.size > 0) {
      const ownedMarker = sorted.find((marker) => leaseOwnedMarkers.has(issueNumber(marker)));
      if (ownedMarker) keep = ownedMarker;
    }

    const milestoneExternallyBlocked = externallyBlocked.has(milestoneTitle) && !activeMilestones.has(milestoneTitle);

    if (milestoneExternallyBlocked && keep && hasLabel(keep, "ready")) {
      addRemove(keep, "ready", "externally_blocked_milestone_not_runnable");
      addReleaseClaim(keep, "externally_blocked_claim_body_cleanup");
    }

    if (!milestoneExternallyBlocked && keep && !hasLabel(keep, "ready")) {
      addAdd(keep, "ready", "restore_ready_trigger_label");
    }

    if (!milestoneExternallyBlocked && keep && activeMilestones.has(milestoneTitle) && !hasLabel(keep, "wave-in-progress")) {
      const milestoneHasInProgress = sorted.some((marker) => hasLabel(marker, "wave-in-progress"));
      if (leaseOwnedMarkers.has(issueNumber(keep))) {
        addAdd(keep, "wave-in-progress", "restore_in_progress_from_active_lease");
      } else if (!milestoneHasInProgress) {
        addAdd(keep, "wave-in-progress", "restore_in_progress_from_active_milestone");
      }
    }

    for (const marker of sorted) {
      if (issueNumber(marker) === issueNumber(keep)) continue;
      addClose(marker, "duplicate_wave_marker");
    }

    // Resolve stale in-progress state against durable active leases.
    // Also clear the embedded claim JSON from the issue body so subsequent ticks
    // don't see a stale "already claimed" block.
    for (const marker of sorted) {
      if (!hasLabel(marker, "wave-in-progress")) continue;
      if (activeMilestones.has(milestoneTitle)) continue;
      addRemove(marker, "wave-in-progress", "stale_wave_in_progress_without_active_lease");
      addReleaseClaim(marker, "stale_wave_claim_body_cleanup");
      if (!hasLabel(marker, "ready")) addAdd(marker, "ready", "restore_ready_trigger_label");
    }
  }

  // Invalid issue/label combinations outside marker state:
  // wave-in-progress is only valid for active wave marker issues.
  for (const issue of issues) {
    if (isWaveMarker(issue)) continue;
    if (hasLabel(issue, "wave-in-progress")) {
      addRemove(issue, "wave-in-progress", "invalid_non_marker_wave_in_progress_label");
    }
  }

  // Closing an issue supersedes claim and label edits for the same issue.
  for (const action of closeByIssue.values()) {
    const issueKey = String(action.issue_number);
    releaseClaimByIssue.delete(issueKey);
    for (const key of [...removeByIssueLabel.keys()]) {
      if (key.startsWith(`${issueKey}:`)) removeByIssueLabel.delete(key);
    }
    for (const key of [...addByIssueLabel.keys()]) {
      if (key.startsWith(`${issueKey}:`)) addByIssueLabel.delete(key);
    }
  }

  const actions = [
    ...closeByIssue.values(),
    ...releaseClaimByIssue.values(),
    ...planStaleWorktreeCleanupActions(activeLeases.stale_candidates),
    ...removeByIssueLabel.values(),
    ...addByIssueLabel.values(),
  ].sort(sortAction);

  const stats = {
    close_issue_count: actions.filter((a) => a.type === "close_issue").length,
    remove_label_count: actions.filter((a) => a.type === "remove_label").length,
    add_label_count: actions.filter((a) => a.type === "add_label").length,
    duplicate_marker_count: actions.filter((a) => a.reason === "duplicate_wave_marker").length,
    stale_marker_count: actions.filter((a) => a.reason === "stale_wave_marker_without_active_labels").length,
    stale_in_progress_release_count: actions.filter((a) => a.reason === "stale_wave_in_progress_without_active_lease").length,
    stale_claim_release_count: actions.filter((a) => a.type === "release_claim").length,
    cleanup_worktree_count: actions.filter((a) => a.type === "cleanup_worktree").length,
    invalid_label_count: actions.filter((a) => a.reason === "invalid_non_marker_wave_in_progress_label").length,
    restored_ready_count: actions.filter((a) => a.type === "add_label" && a.label === "ready").length,
    restored_in_progress_count: actions.filter((a) => a.type === "add_label" && a.label === "wave-in-progress").length,
  };

  return {
    schema_version: WAVE_ORPHAN_REPAIR_SCHEMA_VERSION,
    action_count: actions.length,
    actions,
    stats,
  };
}

export function planWaveReadyNormalization(issues = []) {
  const plan = planWaveOrphanStateRepair({
    openIssues: issues,
    activeLeases: collectActiveWaveLeases([], {}),
  });
  const rollup = planRollup(plan);
  return {
    duplicate_count: rollup.closeIssueNumbers.length,
    relabeled_count: rollup.addReadyIssueNumbers.length,
    close_issue_numbers: rollup.closeIssueNumbers,
    add_ready_issue_numbers: rollup.addReadyIssueNumbers,
  };
}

export function planStaleWorktreeCleanupActions(staleCandidates = []) {
  const actions = [];
  const seen = new Set();

  for (const lease of Array.isArray(staleCandidates) ? staleCandidates : []) {
    const worktreeDir = String(lease?.worktree_dir || "").trim();
    if (!worktreeDir || seen.has(worktreeDir)) continue;
    seen.add(worktreeDir);
    actions.push({
      type: "cleanup_worktree",
      worktree_dir: worktreeDir,
      milestone_title: String(lease?.milestone_title || "").trim(),
      run_id: String(lease?.run_id || "").trim(),
      reason: "orphaned_wave_worktree",
    });
  }

  return actions.sort(sortAction);
}
