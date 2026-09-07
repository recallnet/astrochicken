import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createGhCliAdapter } from "../../../../github-adapter/src/github-adapter.ts";
import { writeTickArtifact } from "../../commands/tick-artifact.ts";
import { parseWaveReadyLeaseEventsFromComment } from "../../commands/wave-claim.ts";
import {
  classifyDuplicateClaims,
  computeCapacitySnapshot,
  measureRefillLatency,
} from "../../commands/wave-throughput-invariants.ts";
import { trim, parseJson } from "../cli-helpers.ts";
import { parseControlPlaneBlocker } from "../control-plane-blocker.ts";
import { createGithubBlockedByLoader, evaluateMilestoneExternalBlocking } from "../wave-external-blocking.ts";


function parseArrayRaw(raw = "[]") {
  if (Array.isArray(raw)) return raw;
  return parseJson(String(raw || "[]"), []);
}


function loadRunContext(runId, runsDir = ".hatch/runs") {
  if (!runId) return {};
  const statePath = join(runsDir, runId, "state.json");
  const state = parseJson(readFileSync(statePath, "utf8"), {});
  return state?.context || {};
}

function sortBy(list, selector) {
  return [...list].sort((a, b) => String(selector(a)).localeCompare(String(selector(b))));
}

function normalizeMilestones(milestones) {
  const items = (Array.isArray(milestones) ? milestones : [])
    .map((ms) => ({
      title: String(ms?.title || "").trim(),
      number: Number.isFinite(Number(ms?.number)) ? Number(ms.number) : null,
    }))
    .filter((ms) => ms.title);
  return sortBy(items, (ms) => ms.title);
}

function normalizeReadyIssues(readyIssues) {
  const items = (Array.isArray(readyIssues) ? readyIssues : []).map((issue) => {
    const labels = (issue?.labels || [])
      .map((l) => l?.name || l?.get?.("name"))
      .filter(Boolean)
      .map((l) => String(l))
      .sort((a, b) => a.localeCompare(b));
    return {
      number: Number.isFinite(Number(issue?.number)) ? Number(issue.number) : null,
      title: String(issue?.title || "").trim(),
      labels,
      milestone: String(issue?.milestone?.title || "").trim(),
    };
  }).filter((issue) => issue.number !== null || issue.title);
  return sortBy(items, (issue) => issue.number ?? issue.title);
}

function normalizeMilestoneIssues(milestoneIssues) {
  const items = (Array.isArray(milestoneIssues) ? milestoneIssues : []).map((entry) => {
    const issues = (entry?.issues || []).map((issue) => ({
      number: Number.isFinite(Number(issue?.number)) ? Number(issue.number) : null,
      title: String(issue?.title || "").trim(),
    })).filter((issue) => issue.number !== null || issue.title);
    return {
      milestone: String(entry?.milestone || "").trim(),
      issues: sortBy(issues, (issue) => issue.number ?? issue.title),
    };
  }).filter((entry) => entry.milestone);
  return sortBy(items, (entry) => entry.milestone);
}

function normalizeBlockedBy(blockedBy) {
  const items = (Array.isArray(blockedBy) ? blockedBy : []).map((entry) => {
    const blocked = (entry?.blocked_by || []).map((blocker) => ({
      number: Number.isFinite(Number(blocker?.number)) ? Number(blocker.number) : null,
      state: String(blocker?.state || "").toUpperCase(),
      milestone: String(blocker?.milestone?.title || "").trim(),
    })).filter((blocker) => blocker.number !== null || blocker.milestone || blocker.state);
    return {
      issue_number: Number.isFinite(Number(entry?.issue_number)) ? Number(entry.issue_number) : null,
      blocked_by: sortBy(blocked, (blocker) => blocker.number ?? blocker.milestone),
    };
  }).filter((entry) => entry.issue_number !== null);
  return sortBy(items, (entry) => entry.issue_number);
}

function normalizeControlPlaneBlocked(blocked) {
  const items = (Array.isArray(blocked) ? blocked : []).map((entry) => ({
    issue_number: Number.isFinite(Number(entry?.issue_number)) ? Number(entry.issue_number) : null,
    milestone: String(entry?.milestone || "").trim(),
    blockerKind: String(entry?.blockerKind || "").trim(),
    blockerRef: String(entry?.blockerRef || "").trim(),
    unblockCondition: String(entry?.unblockCondition || "").trim(),
    status: String(entry?.status || "").trim(),
  })).filter((entry) => entry.issue_number !== null || entry.milestone || entry.blockerKind || entry.blockerRef || entry.unblockCondition);

  return sortBy(items, (entry) => `${entry.milestone}:${entry.issue_number ?? ""}`);
}

function buildTickArtifact({ runId, repo, maxConcurrent, milestones, readyIssues, prioritiesText, selection, leaseEvents = [] }) {
  const inputs = {
    run_id: String(runId || ""),
    repo: String(repo || ""),
    max_concurrent: Number(maxConcurrent || 1),
    milestones: normalizeMilestones(milestones),
    ready_issues: normalizeReadyIssues(readyIssues),
    priorities_text: String(prioritiesText || ""),
    milestone_issues: normalizeMilestoneIssues(selection?.milestone_issues || []),
    blocked_by: normalizeBlockedBy(selection?.blocked_by || []),
    control_plane_blocked: normalizeControlPlaneBlocked(selection?.control_plane_blocked_items || []),
  };

  const inFlight = Number(selection?.in_flight_count || 0);
  const selectedWaves = Array.isArray(selection?.selected_waves) ? selection.selected_waves : [];
  const candidates = Array.isArray(selection?.candidate_waves) ? selection.candidate_waves : [];
  const maxSlots = Number(maxConcurrent || 1);
  const padLen = String(Math.max(1, maxSlots)).length;
  const idleReason = candidates.length === 0 ? "no_candidates" : "no_additional_candidates";

  const slotByWave = new Map();
  const slots = [];
  for (let i = 0; i < maxSlots; i += 1) {
    const slotId = `slot-${String(i + 1).padStart(padLen, "0")}`;
    if (i < inFlight) {
      slots.push({ slot_id: slotId, state: "in_flight" });
      continue;
    }
    const wave = selectedWaves[i - inFlight];
    if (wave) {
      const launchedRunId = `wave:${wave}`;
      slotByWave.set(wave, slotId);
      slots.push({ slot_id: slotId, state: "launched", run_id: launchedRunId, wave });
      continue;
    }
    slots.push({ slot_id: slotId, state: "idle", skip_reason: idleReason });
  }

  const evaluations = Array.isArray(selection?.evaluations) ? selection.evaluations : [];
  const runs = sortBy(evaluations.map((entry) => {
    const milestone = String(entry?.milestone || "").trim();
    if (!milestone) return null;
    const selected = entry?.status === "selected";
    const out = { run_id: `wave:${milestone}`, wave: milestone, status: selected ? "launched" : "skipped" };
    const slotId = slotByWave.get(milestone);
    if (selected && slotId) out.slot_id = slotId;
    if (!selected && entry?.skip_reason) out.skip_reason = String(entry.skip_reason);
    return out;
  }).filter(Boolean), (entry) => entry.run_id);

  const readyBacklogCount = Math.max(0, Number(selection?.ready_count || 0) - inFlight);
  const throughputInvariants = {
    ...computeCapacitySnapshot({
      readyWaveCount: readyBacklogCount,
      activeWaveCount: inFlight,
      maxConcurrentWaves: maxSlots,
    }),
    refill_latency: measureRefillLatency({ leaseEvents }),
    duplicate_claims: classifyDuplicateClaims({ leaseEvents }),
  };

  return {
    schema_version: "tick.v1",
    inputs,
    throughput_invariants: throughputInvariants,
    slots: sortBy(slots, (slot) => slot.slot_id),
    runs,
  };
}

const WAVE_TITLE_RE = /^goal-(\d+)-wave-(\d+)$/;

export function findPriorWave(milestoneTitle) {
  const m = WAVE_TITLE_RE.exec(String(milestoneTitle || ""));
  if (!m) return null;
  const waveNum = Number(m[2]);
  if (waveNum <= 1) return null;
  return `goal-${m[1]}-wave-${waveNum - 1}`;
}

export function isPriorWaveComplete(priorWaveTitle, { milestones = [], readyByMilestone = new Map(), closedMarkers = [], getMilestoneOpenIssues } = {}) {
  // If the prior wave was terminally released as wave_completed, it's done.
  const terminalEntry = (Array.isArray(closedMarkers) ? closedMarkers : []).find(
    (m) => String(m?.milestone || "") === priorWaveTitle && String(m?.releaseReason || "") === "wave_completed",
  );
  if (terminalEntry) return true;

  // If the prior wave milestone doesn't exist at all, it's complete (never created or already closed).
  const milestoneExists = (Array.isArray(milestones) ? milestones : []).some(
    (ms) => String(ms?.title || "").trim() === priorWaveTitle,
  );
  if (!milestoneExists) return true;

  // If the prior wave has an in-progress marker, it's still running.
  const readyEntries = readyByMilestone.get(priorWaveTitle) || [];
  const isInProgress = readyEntries.some((issue) => {
    const labels = (issue?.labels || []).map((l) => String(l?.name || l?.get?.("name") || "")).filter(Boolean);
    return labels.includes("wave-in-progress");
  });
  if (isInProgress) return false;

  // If the prior wave has a ready marker (not in-progress), it hasn't started yet.
  if (readyEntries.length > 0) return false;

  // Check if the prior wave milestone has open feature issues.
  // Fail-closed: if the query returns null/undefined (API error), treat as incomplete.
  const rawOpenIssues = getMilestoneOpenIssues?.(priorWaveTitle);
  if (rawOpenIssues == null) return false;
  const openIssues = rawOpenIssues
    .filter((i) => !String(i?.title || "").startsWith("Wave Ready:"));
  if (openIssues.length > 0) return false;

  // No marker, no open issues — prior wave is complete.
  return true;
}

export function computeSelectedWaves({
  milestones = [],
  readyIssues = [],
  closedMarkers = [],
  prioritiesText = "",
  maxConcurrent = 1,
  getMilestoneOpenIssues,
  getBlockedBy,
  getControlPlaneBlocker,
}) {
  const readyByMilestone = new Map();
  let inFlight = 0;

  for (const issue of readyIssues) {
    const labels = (issue.labels || []).map((l) => l.name || l?.get?.("name")).filter(Boolean);
    const title = issue.title || "";
    const isWaveMarker = /^Wave Ready:\s*/.test(title);
    const m = title.match(/^Wave Ready:\s*(.+)$/);
    const milestoneTitle = (issue.milestone?.title || (m ? m[1].trim() : "") || "").trim();
    if (!milestoneTitle) continue;
    // Only Wave Ready: marker issues count for the already_ready check.
    // Regular feature issues in a milestone should NOT prevent dispatch.
    if (!isWaveMarker) continue;
    if (!readyByMilestone.has(milestoneTitle)) readyByMilestone.set(milestoneTitle, []);
    readyByMilestone.get(milestoneTitle).push(issue);
    if (labels.includes("wave-in-progress")) inFlight += 1;
  }

  const waveReadyCount = [...readyByMilestone.values()].reduce((sum, items) => sum + items.length, 0);

  const candidates = [];
  const milestoneIssues = [];
  const blockedBy = [];
  const controlPlaneBlockedItems = [];
  const controlPlaneBlockedWaves = [];
  const evaluations = [];

  for (const ms of milestones) {
    const title = (ms?.title || "").trim();
    if (!title) continue;
    if (readyByMilestone.has(title)) {
      evaluations.push({ milestone: title, status: "skipped", skip_reason: "already_ready" });
      continue;
    }

    const recentlyFailed = (Array.isArray(closedMarkers) ? closedMarkers : []).find(
      (m) => String(m?.milestone || "") === title
        && (String(m?.releaseReason || "") === "no_merge_candidates" || String(m?.releaseReason || "") === "judge_failed" || String(m?.releaseReason || "") === "wave_completed")
    );
    if (recentlyFailed) {
      const skipReason = String(recentlyFailed.releaseReason || "") === "wave_completed" ? "already_completed" : "recently_released_no_candidates";
      evaluations.push({ milestone: title, status: "skipped", skip_reason: skipReason });
      continue;
    }

    const issues = (getMilestoneOpenIssues?.(title) || []).filter((i) => !String(i?.title || "").startsWith("Wave Ready:"));
    milestoneIssues.push({ milestone: title, issues: issues.map((i) => ({ number: i?.number, title: i?.title })) });

    if (issues.length === 0) {
      evaluations.push({ milestone: title, status: "skipped", skip_reason: "no_open_issues" });
      continue;
    }

    const labelBlockedIssues = issues.filter((issue) => {
      const labels = (Array.isArray(issue?.labels) ? issue.labels : [])
        .map((label) => String(label?.name || label?.get?.("name") || "").trim().toLowerCase())
        .filter(Boolean);
      return labels.includes("blocked_control_plane") || labels.includes("blocked-control-plane");
    });

    const eligibility = evaluateMilestoneExternalBlocking({
      milestoneTitle: title,
      issues,
      getBlockedBy,
      getControlPlaneBlocker,
    });
    blockedBy.push(...eligibility.blocked_by);

    const milestoneControlPlaneBlocked = (eligibility.control_plane_blocked_issues || []).map((entry) => ({
      ...entry,
      milestone: title,
    }));

    for (const issue of labelBlockedIssues) {
      const issueNumber = Number(issue?.number || 0);
      if (!Number.isFinite(issueNumber) || issueNumber <= 0) continue;
      if (milestoneControlPlaneBlocked.some((entry) => Number(entry?.issue_number) === issueNumber)) continue;
      milestoneControlPlaneBlocked.push({
        issue_number: issueNumber,
        milestone: title,
        blockerKind: "label_sentinel",
        blockerRef: "",
        unblockCondition: "control_plane_blocker_active",
        status: "blocked",
      });
    }

    controlPlaneBlockedItems.push(...milestoneControlPlaneBlocked);

    if (milestoneControlPlaneBlocked.length > 0) {
      controlPlaneBlockedWaves.push({
        milestone: title,
        issues: milestoneControlPlaneBlocked,
      });
    }

    if (eligibility.all_runnable_issues_externally_blocked) {
      evaluations.push({ milestone: title, status: "skipped", skip_reason: "cross_milestone_blocked" });
      continue;
    }
    const hasLabelBlockedInMilestone = labelBlockedIssues.length > 0;
    const allIssuesLabelBlocked = hasLabelBlockedInMilestone && labelBlockedIssues.length === issues.length;

    if (eligibility.all_runnable_issues_control_plane_blocked || allIssuesLabelBlocked) {
      evaluations.push({ milestone: title, status: "skipped", skip_reason: "control_plane_blocked" });
      continue;
    }
    if (!eligibility.has_runnable_issue) {
      evaluations.push({ milestone: title, status: "skipped", skip_reason: "all_blocked" });
      continue;
    }

    // Wave sequencing gate: wave-N cannot dispatch until wave-(N-1) completes.
    const priorWave = findPriorWave(title);
    if (priorWave) {
      const priorComplete = isPriorWaveComplete(priorWave, {
        milestones, readyByMilestone, closedMarkers, getMilestoneOpenIssues,
      });
      if (!priorComplete) {
        evaluations.push({ milestone: title, status: "skipped", skip_reason: "prior_wave_open", prior_wave: priorWave });
        continue;
      }
    }

    candidates.push(title);
    evaluations.push({ milestone: title, status: "candidate" });
  }

  const parsedMax = Number(maxConcurrent);
  const effectiveMax = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : Number.MAX_SAFE_INTEGER;
  const slots = Math.max(0, effectiveMax - inFlight);
  const priorityOrder = [];
  for (const m of String(prioritiesText || "").match(/goal-\d+-wave-\d+/g) || []) {
    if (!priorityOrder.includes(m)) priorityOrder.push(m);
  }

  const ordered = [...priorityOrder.filter((x) => candidates.includes(x)), ...candidates.filter((x) => !priorityOrder.includes(x))]
    .filter((x, i, a) => a.indexOf(x) === i);

  const selectedWaves = ordered.slice(0, slots);
  const selectedSet = new Set(selectedWaves);
  const finalizedEvaluations = evaluations.map((entry) => {
    if (entry.status !== "candidate") return entry;
    if (selectedSet.has(entry.milestone)) return { ...entry, status: "selected" };
    return { ...entry, status: "skipped", skip_reason: "slots_full" };
  });

  return {
    selected_waves: selectedWaves,
    selected_count: selectedWaves.length,
    in_flight_count: inFlight,
    ready_count: waveReadyCount,
    priorities_text: prioritiesText,
    max_concurrent: effectiveMax,
    candidate_waves: candidates,
    evaluations: finalizedEvaluations,
    milestone_issues: milestoneIssues,
    blocked_by: blockedBy,
    control_plane_blocked_items: controlPlaneBlockedItems,
    control_plane_blocked_waves: controlPlaneBlockedWaves,
  };
}

const DEFAULT_TERMINAL_COOLDOWN_MS = 30 * 60 * 1000;

function createLegacyReadAdapter({ repo, ghJsonFn } = {}) {
  const legacyRead = ghJsonFn;
  return {
    issueList({ state = "open", search = "", fields = "number,title", limit = 50 } = {}) {
      const args = ["issue", "list", "--repo", repo, "--state", state, "--search", search, "--json", fields, "--limit", String(limit)];
      return legacyRead(args);
    },
    issueComments({ number } = {}) {
      return legacyRead(["api", `repos/${repo}/issues/${number}/comments?per_page=100`]);
    },
  };
}

export function fetchTerminallyReleasedMarkers(repo, milestones, { cooldownMs = DEFAULT_TERMINAL_COOLDOWN_MS, adapter, ghJsonFn } = {}) {
  const msSet = new Set(
    (Array.isArray(milestones) ? milestones : [])
      .map((m) => (m?.title || "").trim())
      .filter(Boolean),
  );
  if (msSet.size === 0) return [];

  const githubAdapter = adapter
    || (typeof ghJsonFn === "function" ? createLegacyReadAdapter({ repo, ghJsonFn }) : null);
  if (!githubAdapter) return [];

  const closed = githubAdapter.issueList({
    state: "closed",
    search: '"Wave Ready:" in:title',
    fields: "number,title,milestone",
    limit: 200,
  });

  const relevant = (Array.isArray(closed) ? closed : []).filter(
    (i) => msSet.has((i?.milestone?.title || "").trim()),
  );

  const nowMs = Date.now();
  const seen = new Set();
  const results = [];

  for (const marker of relevant) {
    const milestoneTitle = (marker?.milestone?.title || "").trim();
    if (!milestoneTitle || seen.has(milestoneTitle)) continue;

    const comments = githubAdapter.issueComments({ number: marker.number });
    const allEvents = [];
    for (const c of Array.isArray(comments) ? comments : []) {
      allEvents.push(...parseWaveReadyLeaseEventsFromComment(c));
    }
    if (allEvents.length === 0) continue;

    allEvents.sort((a, b) => {
      const ae = Number.isFinite(a.sort_epoch_ms) ? a.sort_epoch_ms : Number.NEGATIVE_INFINITY;
      const be = Number.isFinite(b.sort_epoch_ms) ? b.sort_epoch_ms : Number.NEGATIVE_INFINITY;
      return ae - be;
    });

    const latest = allEvents[allEvents.length - 1];
    const isTerminal = latest.action === "release"
      && (latest.reason === "no_merge_candidates" || latest.reason === "judge_failed" || latest.reason === "wave_completed");
    if (!isTerminal) continue;

    // wave_completed is permanent — skip cooldown check
    if (latest.reason !== "wave_completed") {
      const eventAt = Date.parse(latest.at);
      if (Number.isFinite(eventAt) && (nowMs - eventAt) > cooldownMs) continue;
    }

    seen.add(milestoneTitle);
    results.push({ milestone: milestoneTitle, releaseReason: latest.reason });
  }

  return results;
}

function createIssueControlPlaneBlockerLoader({ adapter } = {}) {
  const cache = new Map();
  return (issue) => {
    const issueNumber = Number(issue?.number || 0);
    if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
      return parseControlPlaneBlocker(issue || {});
    }

    if (cache.has(issueNumber)) return cache.get(issueNumber);

    const comments = adapter ? adapter.issueComments({ number: issueNumber }) : [];
    const blocker = parseControlPlaneBlocker({
      ...issue,
      comments: Array.isArray(comments) ? comments : [],
    });
    cache.set(issueNumber, blocker);
    return blocker;
  };
}

export function selectDispatchWaves({ milestones = [], readyIssues = [], prioritiesIssue = [], repo, maxConcurrent = 1, runId = "", runsDir = ".hatch/runs", leaseEvents = [] } = {}) {
  const prioritiesText = (Array.isArray(prioritiesIssue) ? prioritiesIssue : [])[0]?.body || "";
  const adapter = createGhCliAdapter({ repo });

  const getMilestoneOpenIssues = (title) => adapter.issueList({
    state: "open",
    milestone: title,
    fields: "number,title,labels,body",
  });

  const getBlockedBy = createGithubBlockedByLoader({ repo, adapter });
  const getControlPlaneBlocker = createIssueControlPlaneBlockerLoader({ repo, adapter });

  const closedMarkers = fetchTerminallyReleasedMarkers(repo, milestones, { adapter });

  const selection = computeSelectedWaves({ milestones, readyIssues, closedMarkers, prioritiesText, maxConcurrent, getMilestoneOpenIssues, getBlockedBy, getControlPlaneBlocker });

  if (runId) {
    const tick = buildTickArtifact({
      runId,
      repo,
      maxConcurrent,
      milestones,
      readyIssues,
      prioritiesText,
      selection,
      leaseEvents,
    });
    writeTickArtifact({ runId, runsDir, tick });
  }

  return selection;
}

export function selectDispatchWavesFromRun({ runId, runsDir = ".hatch/runs", repo, maxConcurrent = 1 } = {}) {
  const ctx = loadRunContext(runId, runsDir);
  return selectDispatchWaves({
    milestones: parseArrayRaw(ctx.milestones || "[]"),
    readyIssues: parseArrayRaw(ctx.ready_issues || "[]"),
    prioritiesIssue: parseArrayRaw(ctx.priorities_issue || "[]"),
    repo,
    maxConcurrent,
    runId,
    runsDir,
    leaseEvents: parseArrayRaw(ctx.wave_ready_lease_events || "[]"),
  });
}

export function selectDispatchWavesFromArgs({ milestonesRaw = "[]", readyIssuesRaw = "[]", prioritiesIssueRaw = "[]", repo, maxConcurrent = 1 } = {}) {
  return selectDispatchWaves({
    milestones: parseArrayRaw(milestonesRaw),
    readyIssues: parseArrayRaw(readyIssuesRaw),
    prioritiesIssue: parseArrayRaw(prioritiesIssueRaw),
    repo,
    maxConcurrent,
  });
}
