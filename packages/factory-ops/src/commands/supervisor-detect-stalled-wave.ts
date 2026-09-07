import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { readAllRunStates } from "./factory-status.ts";
import { emitBugIssue } from "./supervisor-artifact.ts";
import { parseWaveMarkerClaimSnapshot } from "./wave-claim.ts";
import { collectActiveWaveLeases, sanitizeWaveState } from "./wave-sanitize-state.ts";
import { trim, parseJson, gh, ghJson, toEpochMs } from "../lib/cli-helpers.ts";
import { FACTORY_LABEL_KEYS, getFactoryLabelName } from "../lib/factory-label-contract.ts";

const MAX_FEATURE_SAMPLE_PER_WAVE = 25;
const MAX_RUN_CONTEXTS_PER_MILESTONE = 3;
const MAX_LEASE_SNAPSHOT_BYTES = 2000;
const STALLED_WAVE_HISTORY_LIMIT = 50;
const STALLED_WAVE_REPEAT_THRESHOLD = 3;
const STALLED_WAVE_REPEAT_WINDOW_MINUTES = 60;
const MAX_STALLED_WAVE_LOG_LINES = 10;
const FEATURE_LABEL = getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.FEATURE);
const WAVE_IN_PROGRESS_LABEL = getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.WAVE_IN_PROGRESS);

function parseEpochMs(value = "") {
  const ms = Date.parse(String(value || "").trim());
  return Number.isFinite(ms) ? ms : 0;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}


function summarizePendingStalls(stalled = []) {
  const entries = Array.isArray(stalled) ? stalled : [];
  if (entries.length === 0) return "No stalled waves detected.";
  const lines = entries.slice(0, MAX_STALLED_WAVE_LOG_LINES).map((entry) => {
    const wave = Number(entry?.wave_issue_number || 0) || "?";
    const milestone = String(entry?.milestone || "").trim();
    const reason = String(entry?.reason || "").trim() || "unknown";
    const staleMinutes = Number(entry?.wave_stale_minutes || 0) || 0;
    const features = Number(entry?.open_feature_count || 0) || (Array.isArray(entry?.open_features) ? entry.open_features.length : 0);
    return `- wave #${wave}${milestone ? ` (${milestone})` : ""}: ${reason}, stale=${staleMinutes}m, open_features=${features}`;
  });
  const suffix = entries.length > MAX_STALLED_WAVE_LOG_LINES
    ? `\n...and ${entries.length - MAX_STALLED_WAVE_LOG_LINES} more`
    : "";
  return `Pending stalled wave entries (${entries.length}):\n${lines.join("\n")}${suffix}`;
}

function buildStalledWaveSignature({ repo, detection = {} } = {}) {
  const payload = {
    repo: String(repo || "").trim(),
    wave_issue_number: Number(detection?.wave_issue_number || detection?.waveIssueNumber || 0) || 0,
    milestone: String(detection?.milestone || detection?.milestone_title || "").trim(),
    reason: String(detection?.reason || "").trim(),
    guard_reason_code: String(detection?.guard_metadata?.reason_code || "").trim(),
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

function sanitizeRepoKey(repo = "") {
  return String(repo || "default").trim().replace(/[^a-zA-Z0-9._-]/g, "_") || "default";
}

function isWaveExecutePipeline(run = {}) {
  const pipeline = String(run?.pipelineFile || run?.pipeline || run?.graph?.label || "").toLowerCase();
  return pipeline.includes("wave_execute");
}

function resolveRunGraph(run = {}) {
  const pipeline = String(run?.pipelineFile || run?.pipeline || run?.graph?.label || "").trim();
  if (pipeline) return pipeline;
  const ctx = run?.context || {};
  for (const key of Object.keys(ctx)) {
    if (key.startsWith("__child_pipeline_")) return key.replace("__child_pipeline_", "");
  }
  return "";
}

function resolveRunNode(run = {}) {
  const records = Array.isArray(run?.records) ? run.records : [];
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const nodeId = String(records[i]?.nodeId || "").trim();
    if (nodeId) return nodeId;
  }
  return String(run?.currentNode || "").trim();
}

function resolveRunUpdatedAt(run = {}) {
  const updatedAt = String(run?.updatedAt || "").trim();
  const updatedMs = parseEpochMs(updatedAt);
  if (updatedMs > 0) return { iso: updatedAt, ms: updatedMs };
  const mtime = Number(run?._mtime || 0);
  if (Number.isFinite(mtime) && mtime > 0) {
    return { iso: new Date(mtime).toISOString(), ms: mtime };
  }
  return { iso: "", ms: 0 };
}

function extractClaimContext(run = {}) {
  const ctx = run?.context || {};
  const claimContext = {
    claim_owner_id: String(ctx.claim_owner_id || ""),
    claim_run_id: String(ctx.claim_run_id || ""),
    claim_lease_expires_at: String(ctx.claim_lease_expires_at || ""),
    claim_reason: String(ctx.claim_reason || ""),
    claim_acquired: String(ctx.claim_acquired || ""),
    claim_token: String(ctx.claim_token || ""),
  };
  const present = Object.values(claimContext).some((value) => String(value || "").trim());
  return {
    ...claimContext,
    claim_context_present: present,
    claim_context_missing_reason: present ? "" : "claim_context_missing",
  };
}

function buildRunContext(run = {}) {
  const ctx = run?.context || {};
  const updated = resolveRunUpdatedAt(run);
  const guard = run?.guard || {};
  const guardMetadata = normalizeGuardMetadata(guard?.metadata, run);
  return {
    run_id: String(run?.runId || run?.id || ""),
    graph: resolveRunGraph(run),
    node: resolveRunNode(run),
    status: String(run?.status || ""),
    last_updated: updated.iso,
    last_updated_ms: updated.ms,
    milestone_title: String(ctx.milestone_title || ""),
    ready_issue_number: String(ctx.ready_issue_number || ctx.ready_issue || ""),
    worktree_dir: String(ctx.worktree_dir || ""),
    guard_status: String(guard?.circuitState || ""),
    guard_reason_code: String(guard?.reasonCode || ""),
    guard_terminal_at: String(guard?.terminalAt || ""),
    guard_metadata: guardMetadata,
    guard_metadata_present: Boolean(guardMetadata),
    claim_context: extractClaimContext(run),
  };
}

function buildRunContextIndex(runStates = []) {
  const byMilestone = new Map();
  const byRunId = new Map();

  for (const run of Array.isArray(runStates) ? runStates : []) {
    if (!isWaveExecutePipeline(run)) continue;
    const context = buildRunContext(run);
    const runId = String(context.run_id || "").trim();
    if (runId) byRunId.set(runId, context);
    const milestone = String(context.milestone_title || "").trim();
    if (!milestone) continue;
    if (!byMilestone.has(milestone)) byMilestone.set(milestone, []);
    byMilestone.get(milestone).push(context);
  }

  for (const [milestone, contexts] of byMilestone.entries()) {
    contexts.sort((a, b) => Number(b.last_updated_ms || 0) - Number(a.last_updated_ms || 0));
    if (contexts.length > MAX_RUN_CONTEXTS_PER_MILESTONE) {
      byMilestone.set(milestone, contexts.slice(0, MAX_RUN_CONTEXTS_PER_MILESTONE));
    }
  }

  return { byMilestone, byRunId };
}

function stripRunContextMeta(runContext = {}) {
  const { last_updated_ms, ...rest } = runContext;
  return rest;
}

function selectRunContextForWave({ runIndex, runIds = [], guardMeta = null, milestone = "" } = {}) {
  if (!runIndex) return null;
  const candidateIds = new Set();
  if (guardMeta?.run_id) candidateIds.add(String(guardMeta.run_id || "").trim());
  for (const runId of Array.isArray(runIds) ? runIds : []) {
    const candidate = String(runId || "").trim();
    if (candidate) candidateIds.add(candidate);
  }
  for (const candidate of candidateIds) {
    const match = runIndex.byRunId.get(candidate);
    if (match) return match;
  }
  const milestoneKey = String(milestone || "").trim();
  if (milestoneKey && runIndex.byMilestone.has(milestoneKey)) {
    const list = runIndex.byMilestone.get(milestoneKey) || [];
    return list[0] || null;
  }
  return null;
}

function buildMissingRunContext({ milestone = "", reason = "" } = {}) {
  return {
    run_id: "",
    graph: "",
    node: "",
    status: "missing",
    last_updated: "",
    milestone_title: String(milestone || "").trim(),
    ready_issue_number: "",
    worktree_dir: "",
    guard_status: "",
    guard_reason_code: "",
    guard_terminal_at: "",
    guard_metadata: null,
    guard_metadata_present: false,
    claim_context: {
      claim_owner_id: "",
      claim_run_id: "",
      claim_lease_expires_at: "",
      claim_reason: "",
      claim_acquired: "",
      claim_token: "",
      claim_context_present: false,
      claim_context_missing_reason: "claim_context_missing",
    },
    run_context_missing_reason: String(reason || ""),
  };
}

export function attachRunContextToStalledWaves({ stale = [], runStates = [] } = {}) {
  const runIndex = buildRunContextIndex(runStates);
  const hasRunData = runIndex.byRunId.size > 0 || runIndex.byMilestone.size > 0;

  return (Array.isArray(stale) ? stale : []).map((entry) => {
    const runContextRaw = selectRunContextForWave({
      runIndex,
      runIds: Array.isArray(entry?.active_run_ids) ? entry.active_run_ids : [],
      guardMeta: entry?.guard_metadata || null,
      milestone: entry?.milestone || "",
    });
    const missingReason = hasRunData ? "run_state_missing_for_milestone" : "run_state_unavailable";
    const runContext = runContextRaw
      ? stripRunContextMeta(runContextRaw)
      : buildMissingRunContext({ milestone: entry?.milestone || "", reason: missingReason });

    return {
      ...entry,
      run_context: runContext,
      run_context_present: Boolean(runContextRaw),
    };
  });
}

export function buildStalledWaveTelemetry({ stalledWaves = [], threshold = 20 } = {}) {
  return (Array.isArray(stalledWaves) ? stalledWaves : []).map((s) => {
    const openFeatures = Array.isArray(s.open_features) ? s.open_features : [];
    const featureIds = openFeatures
      .map((f) => Number(f.number))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    return {
      wave_issue_number: Number(s.wave_issue_number),
      milestone: String(s.milestone || ""),
      reason: String(s.reason || ""),
      wave_stale_minutes: Number(s.wave_stale_minutes || 0),
      threshold_minutes: Number(s.threshold_minutes || threshold),
      open_feature_count: Number(s.open_feature_count || featureIds.length || 0),
      open_feature_numbers: featureIds.slice(0, MAX_FEATURE_SAMPLE_PER_WAVE),
      guard_reason_text: String(s.guard_reason_text || ""),
      guard_reason_code: String(s.guard_metadata?.reason_code || ""),
      guard_issue_number: String(s.guard_metadata?.issue_number || ""),
      guard_branch: String(s.guard_metadata?.branch || ""),
      run_context: s.run_context || null,
      run_context_present: Boolean(s.run_context_present),
      run_context_missing_reason: String(s.run_context?.run_context_missing_reason || ""),
      run_id: String(s.run_context?.run_id || ""),
      run_graph: String(s.run_context?.graph || ""),
      run_node: String(s.run_context?.node || ""),
      run_status: String(s.run_context?.status || ""),
      run_last_updated: String(s.run_context?.last_updated || ""),
      run_worktree_dir: String(s.run_context?.worktree_dir || ""),
      guard_status: String(s.run_context?.guard_status || ""),
      guard_reason_code: String(s.run_context?.guard_reason_code || ""),
      guard_terminal_at: String(s.run_context?.guard_terminal_at || ""),
      guard_snapshot: s.run_context?.guard_metadata || null,
      guard_snapshot_present: Boolean(s.run_context?.guard_metadata_present),
      claim_context_present: Boolean(s.run_context?.claim_context?.claim_context_present),
      claim_owner_id: String(s.run_context?.claim_context?.claim_owner_id || ""),
      claim_run_id: String(s.run_context?.claim_context?.claim_run_id || ""),
      claim_reason: String(s.run_context?.claim_context?.claim_reason || ""),
      lease_status: String(s.lease_context?.lease_status || ""),
      lease_active: Boolean(s.lease_context?.lease_active),
      lease_present: Boolean(s.lease_context?.lease_present),
      lease_missing_reason: String(s.lease_context?.lease_missing_reason || ""),
      lease_snapshot_truncated: Boolean(s.lease_context?.lease_snapshot_truncated),
      lease_snapshot: s.lease_context?.lease_snapshot || null,
      lease_claim_owner_id: String(s.lease_context?.claim_owner_id || ""),
      lease_claim_run_id: String(s.lease_context?.claim_run_id || ""),
      lease_claim_token: String(s.lease_context?.claim_token || ""),
      lease_claim_lease_expires_at: String(s.lease_context?.claim_lease_expires_at || ""),
      lease_claim_reason: String(s.lease_context?.claim_reason || ""),
      lease_claim_updated_at: String(s.lease_context?.claim_updated_at || ""),
      active_milestone: Boolean(s.active_milestone),
      signature_hash: String(s.signature_hash || ""),
      repeat_count: Number(s.repeat_count || 0),
      repeat_first_observed_at: String(s.repeat_first_observed_at || ""),
      repeat_last_observed_at: String(s.repeat_last_observed_at || ""),
    };
  });
}

function collectRemediationMilestones({ plan, planResult, stalledWaves } = {}) {
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  const milestones = new Set();

  for (const action of actions) {
    const milestone = String(action?.milestone_title || "").trim();
    if (milestone) milestones.add(milestone);
  }

  if (milestones.size === 0) {
    const stalled = Array.isArray(stalledWaves) ? stalledWaves : [];
    for (const wave of stalled) {
      const milestone = String(wave?.milestone || wave?.milestone_title || "").trim();
      if (milestone) milestones.add(milestone);
    }
  }

  if (milestones.size === 0) {
    const leaseMilestones = Array.isArray(planResult?.active_lease_milestones) ? planResult.active_lease_milestones : [];
    for (const milestone of leaseMilestones) {
      const value = String(milestone || "").trim();
      if (value) milestones.add(value);
    }
  }

  return [...milestones].sort((a, b) => a.localeCompare(b));
}

export function buildRemediationPlanSummary(planResult = {}, { apply = false, stalledWaves = [] } = {}) {
  const plan = planResult?.repair_plan || {};
  const stats = plan?.stats || {};
  const milestones = collectRemediationMilestones({ plan, planResult, stalledWaves });
  const milestoneList = milestones.length > 0 ? milestones.join(", ") : "(none)";
  const closeCount = Number(stats.close_issue_count || 0);
  const removeCount = Number(stats.remove_label_count || 0);
  const addCount = Number(stats.add_label_count || 0);
  const claimReleaseCount = Number(planResult?.claim_release_count || stats.stale_claim_release_count || 0);
  const releaseCount = Number(planResult?.release_count || stats.stale_in_progress_release_count || 0);
  const duplicateCount = Number(stats.duplicate_marker_count || 0);
  const actionCount = Number(plan?.action_count || 0);
  const mode = apply ? "apply" : "dry-run";
  return {
    mode,
    action_count: actionCount,
    close_issue_count: closeCount,
    remove_label_count: removeCount,
    add_label_count: addCount,
    release_in_progress_count: releaseCount,
    claim_release_count: claimReleaseCount,
    duplicate_marker_count: duplicateCount,
    milestones,
    milestones_summary: milestoneList,
    summary_line: `${mode} remediation plan: actions=${actionCount} close=${closeCount} remove_label=${removeCount} add_label=${addCount} release_in_progress=${releaseCount} claim_release=${claimReleaseCount} duplicates=${duplicateCount} milestones=${milestoneList}.`,
  };
}

function remediationPlanConfig({ applyRemediation, dryRunRemediation } = {}) {
  if (typeof applyRemediation === "boolean") return { apply: applyRemediation, dryRun: !applyRemediation };
  if (typeof dryRunRemediation === "boolean") return { apply: !dryRunRemediation, dryRun: dryRunRemediation };
  const apply = String(applyRemediation || "").trim().toLowerCase();
  const dryRun = String(dryRunRemediation || "").trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(apply)) return { apply: true, dryRun: false };
  if (["0", "false", "no", "n", "off"].includes(apply)) return { apply: false, dryRun: true };
  if (["1", "true", "yes", "y", "on"].includes(dryRun)) return { apply: false, dryRun: true };
  if (["0", "false", "no", "n", "off"].includes(dryRun)) return { apply: true, dryRun: false };
  return { apply: false, dryRun: true };
}


function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function readHistory(path) {
  if (!existsSync(path)) return [];
  try {
    const parsed = parseJson(readFileSync(path, "utf8"), []);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistoryAtomic(path, history) {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(history, null, 2));
  renameSync(tmp, path);
}

function loadStalledWaveHistory({ runsDir = ".hatch/runs", repo = "" } = {}) {
  const repoKey = sanitizeRepoKey(repo);
  const dir = join(runsDir, "supervisor", "stalled-wave");
  const path = join(dir, `${repoKey}.history.json`);
  const exists = existsSync(path);
  return { path, history: readHistory(path), exists };
}

function trimHistory(history, limit) {
  const max = parsePositiveInt(limit, STALLED_WAVE_HISTORY_LIMIT);
  if (history.length <= max) return history;
  return history.slice(history.length - max);
}

function appendStalledWaveHistory({ history = [], entries = [], limit } = {}) {
  const base = Array.isArray(history) ? history : [];
  const additions = Array.isArray(entries) ? entries.filter((entry) => entry && typeof entry === "object") : [];
  const next = additions.length > 0 ? [...base, ...additions] : base;
  return trimHistory(next, limit);
}

function trimString(value = "") {
  return String(value || "").trim();
}

function buildHistoryEntry({ repo, detection, signature, observedAtMs } = {}) {
  const observedMs = Number.isFinite(observedAtMs) ? observedAtMs : Date.now();
  const guardMeta = detection?.guard_metadata || {};
  const runContext = detection?.run_context || {};
  return {
    schema_version: "stalled_wave_history.v1",
    signature_hash: String(signature || ""),
    repo: String(repo || "").trim(),
    wave_issue_number: Number(detection?.wave_issue_number || 0) || 0,
    milestone: String(detection?.milestone || "").trim(),
    reason: String(detection?.reason || "").trim(),
    guard_reason_code: String(guardMeta?.reason_code || ""),
    run_id: String(runContext?.run_id || detection?.run_id || ""),
    run_node: String(runContext?.node || detection?.run_node || ""),
    observed_at: new Date(observedMs).toISOString(),
    observed_at_ms: observedMs,
  };
}

function normalizeHistoryEntry(raw = {}) {
  if (!raw || typeof raw !== "object") return null;
  const observedMs = Number.isFinite(Number(raw.observed_at_ms))
    ? Number(raw.observed_at_ms)
    : toEpochMs(raw.observed_at || "");
  if (!Number.isFinite(observedMs)) return null;
  return {
    schema_version: String(raw.schema_version || "stalled_wave_history.v1"),
    signature_hash: String(raw.signature_hash || ""),
    repo: String(raw.repo || ""),
    wave_issue_number: Number(raw.wave_issue_number || 0) || 0,
    milestone: String(raw.milestone || ""),
    reason: String(raw.reason || ""),
    guard_reason_code: String(raw.guard_reason_code || ""),
    run_id: String(raw.run_id || ""),
    run_node: String(raw.run_node || ""),
    observed_at: new Date(observedMs).toISOString(),
    observed_at_ms: observedMs,
  };
}

function filterHistoryWindow(history = [], windowMs, nowMs) {
  const windowMillis = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : STALLED_WAVE_REPEAT_WINDOW_MINUTES * 60 * 1000;
  const nowEpoch = Number.isFinite(nowMs) ? nowMs : Date.now();
  return (Array.isArray(history) ? history : [])
    .map((entry) => normalizeHistoryEntry(entry))
    .filter(Boolean)
    .filter((entry) => nowEpoch - entry.observed_at_ms <= windowMillis);
}

function summarizeHistoryRepeats({ history = [], signature = "" } = {}) {
  const matches = (Array.isArray(history) ? history : [])
    .filter((entry) => String(entry?.signature_hash || "") === String(signature || ""));
  if (matches.length === 0) {
    return { repeat_count: 0, first_observed_at: "", last_observed_at: "" };
  }
  const sorted = matches
    .map((entry) => normalizeHistoryEntry(entry))
    .filter(Boolean)
    .sort((a, b) => a.observed_at_ms - b.observed_at_ms);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return {
    repeat_count: sorted.length,
    first_observed_at: first?.observed_at || "",
    last_observed_at: last?.observed_at || "",
  };
}

export function attachStalledWaveHistory({
  repo,
  detections = [],
  history = [],
  nowMs = Date.now(),
  windowMs,
} = {}) {
  const historyWindow = filterHistoryWindow(history, windowMs, nowMs);
  const historyBySignature = new Map();
  for (const entry of historyWindow) {
    const signature = String(entry?.signature_hash || "");
    if (!signature) continue;
    if (!historyBySignature.has(signature)) historyBySignature.set(signature, []);
    historyBySignature.get(signature).push(entry);
  }

  const historyEntries = [];
  const detectionsWithSignature = (Array.isArray(detections) ? detections : []).map((detection) => {
    const signature = buildStalledWaveSignature({ repo, detection });
    const historyEntry = buildHistoryEntry({ repo, detection, signature, observedAtMs: nowMs });
    historyEntries.push(historyEntry);
    if (!historyBySignature.has(signature)) historyBySignature.set(signature, []);
    historyBySignature.get(signature).push(historyEntry);
    return { ...detection, signature_hash: signature };
  });

  const repeatStats = new Map();
  for (const [signature, entries] of historyBySignature.entries()) {
    repeatStats.set(signature, summarizeHistoryRepeats({ history: entries, signature }));
  }

  const detectionsWithRepeat = detectionsWithSignature.map((detection) => {
    const stats = repeatStats.get(detection.signature_hash) || { repeat_count: 0, first_observed_at: "", last_observed_at: "" };
    return {
      ...detection,
      repeat_count: stats.repeat_count,
      repeat_first_observed_at: stats.first_observed_at,
      repeat_last_observed_at: stats.last_observed_at,
    };
  });

  return {
    detections: detectionsWithRepeat,
    history_entries: historyEntries,
    repeat_stats: repeatStats,
    history_window: historyWindow,
    history_window_count: historyWindow.length,
  };
}

export function shouldEmitStalledWaveBug({ detections = [], repeatThreshold } = {}) {
  const thresholdValue = parsePositiveInt(repeatThreshold, STALLED_WAVE_REPEAT_THRESHOLD);
  return (Array.isArray(detections) ? detections : [])
    .some((entry) => Number(entry?.repeat_count || 0) >= thresholdValue);
}

function summarizeLeaseClaim(claim = null) {
  if (!claim || typeof claim !== "object") return null;
  return {
    status: trimString(claim.status),
    claim_id: trimString(claim.claim_id),
    claim_token: trimString(claim.claim_token),
    owner_id: trimString(claim.owner_id),
    run_id: trimString(claim.run_id),
    ready_issue_number: trimString(claim.ready_issue_number),
    milestone_title: trimString(claim.milestone_title),
    lease_started_at: trimString(claim.lease_started_at),
    lease_expires_at: trimString(claim.lease_expires_at),
    heartbeat_at: trimString(claim.heartbeat_at),
    updated_at: trimString(claim.updated_at),
    reclaim_count: Number(claim.reclaim_count || 0) || 0,
    reclaimed_from_owner_id: trimString(claim.reclaimed_from_owner_id),
    reclaimed_from_run_id: trimString(claim.reclaimed_from_run_id),
    reclaimed_at: trimString(claim.reclaimed_at),
    released_at: trimString(claim.released_at),
    release_reason: trimString(claim.release_reason),
  };
}

function summarizeLeaseSnapshot(snapshot = null, { maxBytes = MAX_LEASE_SNAPSHOT_BYTES } = {}) {
  const claimSummary = summarizeLeaseClaim(snapshot?.claim || null);
  const summary = snapshot && typeof snapshot === "object"
    ? {
      present: Boolean(snapshot.present),
      status: String(snapshot.status || ""),
      active: Boolean(snapshot.active),
      stale: Boolean(snapshot.stale),
      released: Boolean(snapshot.released),
      claim: claimSummary,
    }
    : null;
  const raw = summary ? JSON.stringify(summary) : "";
  if (!raw) return { summary: null, truncated: false };
  if (raw.length <= maxBytes) return { summary, truncated: false };
  const minimalClaim = claimSummary
    ? {
      status: claimSummary.status,
      claim_id: claimSummary.claim_id,
      owner_id: claimSummary.owner_id,
      run_id: claimSummary.run_id,
      lease_expires_at: claimSummary.lease_expires_at,
      updated_at: claimSummary.updated_at,
    }
    : null;
  const trimmedSummary = {
    ...summary,
    claim: minimalClaim,
    _truncated: true,
    _truncated_bytes: Math.max(0, raw.length - maxBytes),
  };
  return { summary: trimmedSummary, truncated: true };
}

function extractLeaseStatus({ issue = null, nowMs = Date.now() } = {}) {
  if (!issue) {
    return {
      lease_status: "unknown",
      lease_active: false,
      lease_present: false,
      lease_snapshot: null,
      lease_snapshot_truncated: false,
      lease_missing_reason: "issue_missing",
    };
  }
  const snapshot = parseWaveMarkerClaimSnapshot(issue, { nowEpochMs: nowMs });
  const status = snapshot?.present ? String(snapshot.status || "unknown") : "missing";
  const summary = summarizeLeaseSnapshot(snapshot);
  return {
    lease_status: status,
    lease_active: Boolean(snapshot?.active),
    lease_present: Boolean(snapshot?.present),
    lease_snapshot: summary.summary,
    lease_snapshot_truncated: Boolean(summary.truncated),
    lease_missing_reason: snapshot?.present ? "" : "lease_missing",
    claim_owner_id: trimString(snapshot?.claim?.owner_id),
    claim_run_id: trimString(snapshot?.claim?.run_id),
    claim_token: trimString(snapshot?.claim?.claim_token),
    claim_lease_expires_at: trimString(snapshot?.claim?.lease_expires_at),
    claim_reason: trimString(snapshot?.claim?.release_reason),
    claim_updated_at: trimString(snapshot?.claim?.updated_at),
  };
}

function normalizeGuardMetadata(raw, run = {}) {
  if (!raw || typeof raw !== "object") return null;
  const meta = raw || {};
  const context = run?.context || {};
  return {
    reason_code: String(meta.reasonCode || run?.guard?.reasonCode || ""),
    node_id: String(meta.nodeId || ""),
    issue_number: String(meta.issueNumber || context.current_issue_number || context.issue_number || context.target_issue_number || ""),
    branch: String(meta.branch || context.branch || context.last_branch || ""),
    milestone_title: String(meta.milestoneTitle || context.milestone_title || ""),
    captured_at: String(meta.capturedAt || ""),
    run_id: String(run?.runId || run?.id || ""),
  };
}

function guardMetadataEpoch(meta, run = {}) {
  const captured = Date.parse(String(meta?.captured_at || ""));
  if (Number.isFinite(captured)) return captured;
  const updated = Date.parse(String(run?.updatedAt || ""));
  if (Number.isFinite(updated)) return updated;
  const mtime = Number(run?._mtime || 0);
  return Number.isFinite(mtime) ? mtime : 0;
}

function selectNewestGuardMeta(current, candidate, run) {
  if (!candidate) return current;
  if (!current) return candidate;
  const candidateEpoch = guardMetadataEpoch(candidate, run);
  const currentEpoch = guardMetadataEpoch(current);
  return candidateEpoch >= currentEpoch ? candidate : current;
}

function selectNewestGuardMetaFromList(entries = [], runIndex = new Map()) {
  let selected = null;
  for (const entry of entries) {
    if (!entry) continue;
    const run = runIndex.get(entry.run_id) || {};
    selected = selectNewestGuardMeta(selected, entry, run);
  }
  return selected;
}

function buildGuardMetadataIndex(runStates = []) {
  const byIssue = new Map();
  const byMilestone = new Map();
  const byRun = new Map();
  const runIndex = new Map();
  for (const run of Array.isArray(runStates) ? runStates : []) {
    const meta = normalizeGuardMetadata(run?.guard?.metadata, run);
    if (!meta) continue;
    if (meta.run_id) byRun.set(meta.run_id, meta);
    if (meta.issue_number) {
      byIssue.set(meta.issue_number, selectNewestGuardMeta(byIssue.get(meta.issue_number), meta, run));
    }
    if (meta.milestone_title) {
      byMilestone.set(meta.milestone_title, selectNewestGuardMeta(byMilestone.get(meta.milestone_title), meta, run));
    }
    runIndex.set(meta.run_id, run);
  }
  return { byIssue, byMilestone, byRun, runIndex };
}

function resolveGuardMatch({ openFeatures = [], milestone = "", guardIndex, runIds = [] }) {
  const featureList = Array.isArray(openFeatures) ? openFeatures : [];
  const runIdList = Array.isArray(runIds) ? runIds : [];
  const runMatches = runIdList.map((runId) => guardIndex.byRun.get(String(runId || ""))).filter(Boolean);
  let selected = selectNewestGuardMetaFromList(runMatches, guardIndex.runIndex);

  for (const feature of featureList) {
    const issueNumber = String(feature?.number || "");
    if (!issueNumber) continue;
    const meta = guardIndex.byIssue.get(issueNumber);
    selected = selectNewestGuardMeta(selected, meta, guardIndex.runIndex.get(meta?.run_id) || {});
  }
  if (!selected && milestone) {
    selected = guardIndex.byMilestone.get(String(milestone || "")) || null;
  }
  return selected;
}

function formatGuardReasonText({ waveIssueNumber = "", guardMeta = null, fallbackReason = "" } = {}) {
  const waveId = String(waveIssueNumber || "").trim();
  if (!guardMeta) {
    const reason = fallbackReason ? ` (${fallbackReason})` : "";
    return `Wave ${waveId || "(unknown)"} stalled with no guard metadata${reason}.`;
  }
  const reasonCode = String(guardMeta.reason_code || "guard_blocked");
  const issue = guardMeta.issue_number ? `feature #${guardMeta.issue_number}` : "";
  const target = issue ? ` on ${issue}` : guardMeta.branch ? ` on branch ${guardMeta.branch}` : "";
  return `Wave ${waveId || "(unknown)"} stalled due to ${reasonCode}${target}.`;
}

export function attachGuardMetadataToStalledWaves({ stale = [], runStates = [] } = {}) {
  const guardIndex = buildGuardMetadataIndex(runStates);
  return (Array.isArray(stale) ? stale : []).map((entry) => {
    const guardMeta = resolveGuardMatch({
      openFeatures: entry?.open_features || [],
      milestone: entry?.milestone || "",
      guardIndex,
      runIds: entry?.active_run_ids || [],
    });
    return {
      ...entry,
      guard_metadata: guardMeta,
      guard_reason_text: formatGuardReasonText({
        waveIssueNumber: entry?.wave_issue_number || entry?.waveIssueNumber || "",
        guardMeta,
        fallbackReason: String(entry?.reason || ""),
      }),
      guard_metadata_present: Boolean(guardMeta),
    };
  });
}

function buildLeaseIndex(issues = []) {
  const byNumber = new Map();
  for (const issue of Array.isArray(issues) ? issues : []) {
    const number = Number(issue?.number || 0);
    if (!Number.isFinite(number) || number <= 0) continue;
    if (byNumber.has(String(number))) continue;
    byNumber.set(String(number), issue);
  }
  return { byNumber };
}

export function attachLeaseContextToStalledWaves({ stale = [], waveIssues = [], nowMs = Date.now() } = {}) {
  const leaseIndex = buildLeaseIndex(waveIssues);
  return (Array.isArray(stale) ? stale : []).map((entry) => {
    const waveIssueNumber = Number(entry?.wave_issue_number || entry?.waveIssueNumber || 0);
    const issue = Number.isFinite(waveIssueNumber) && waveIssueNumber > 0
      ? leaseIndex.byNumber.get(String(waveIssueNumber))
      : null;
    const leaseContext = extractLeaseStatus({ issue, nowMs });
    return {
      ...entry,
      lease_context: leaseContext,
      lease_context_present: Boolean(leaseContext?.lease_present || leaseContext?.lease_status),
    };
  });
}


function ageMinutes(iso, nowMs = Date.now()) {
  const t = Date.parse(String(iso || ""));
  if (!Number.isFinite(t)) return 0;
  return Math.floor((nowMs - t) / 60000);
}

/**
 * Pure evaluation: given in-progress waves (with pre-fetched features) and active milestones,
 * return the list of stale wave entries. No side effects, no gh calls.
 */
export function evaluateStalledWaves({ inProgressWaves = [], activeMilestones = new Set(), staleMinutes = 20, nowMs = Date.now() } = {}) {
  const threshold = Number(staleMinutes || 20);
  const stale = [];

  for (const wave of inProgressWaves) {
    const milestone = String(wave?.milestone?.title || String(wave?.title || "").replace(/^Wave Ready:\s*/, "")).trim();

    // Skip waves that have an active (non-stale) pipeline run — the coding agent
    // is working in a worktree with no GitHub issue API activity until pipeline completes.
    if (activeMilestones.has(milestone)) continue;

    const waveAge = ageMinutes(wave.updatedAt, nowMs);
    const features = Array.isArray(wave.features) ? wave.features : [];
    const featureAges = features.map((f) => ({
      number: Number(f.number),
      title: String(f.title || ""),
      url: String(f.url || ""),
      updated_at: String(f.updatedAt || ""),
      stale_minutes: ageMinutes(f.updatedAt, nowMs),
    }));

    const staleByWaveMarker = waveAge >= threshold;
    const hasFeatures = featureAges.length > 0;
    const staleByFeatureInactivity = hasFeatures && featureAges.every((f) => f.stale_minutes >= threshold);
    const hasRecentFeatureActivity = hasFeatures && featureAges.some((f) => f.stale_minutes < threshold);

    if (hasRecentFeatureActivity) continue;
    if (!staleByWaveMarker && !staleByFeatureInactivity) continue;

    const reason = staleByWaveMarker && staleByFeatureInactivity
      ? "wave_and_feature_stale"
      : staleByWaveMarker
        ? "wave_marker_stale"
        : "feature_inactivity_stale";

    stale.push({
      reason,
      wave_issue_number: Number(wave.number),
      wave_title: String(wave.title || ""),
      wave_url: String(wave.url || ""),
      milestone,
      wave_stale_minutes: waveAge,
      threshold_minutes: threshold,
      open_feature_count: featureAges.length,
      open_features: featureAges,
      active_run_ids: Array.isArray(wave.active_run_ids) ? wave.active_run_ids : [],
    });
  }

  return stale;
}

export function detectStalledWaveExecution({
  repo,
  runId = "",
  pipeline = "factory_supervisor_tick",
  staleMinutes = 20,
  runsDir = ".hatch/runs",
  applyRemediation = false,
  remediationDryRun = true,
  historyLimit,
  repeatThreshold,
  repeatWindowMinutes,
} = {}) {
  if (!repo) return { ok: false, stale_count: 0, summary: "missing_repo" };

  const threshold = Number(staleMinutes || 20);
  const nowMs = Date.now();
  const repeatWindowMinutesValue = parsePositiveInt(repeatWindowMinutes, STALLED_WAVE_REPEAT_WINDOW_MINUTES);
  const repeatThresholdValue = parsePositiveInt(repeatThreshold, STALLED_WAVE_REPEAT_THRESHOLD);
  const historyLimitValue = parsePositiveInt(historyLimit, STALLED_WAVE_HISTORY_LIMIT);

  // Check active pipeline runs to avoid false positives (#454):
  // GitHub issue updatedAt doesn't change during active worktree builds.
  const allStates = readAllRunStates({ runsDir });
  const { active_milestones } = collectActiveWaveLeases(
    Array.from(allStates.values()),
    { nowEpochMs: nowMs, staleRunMinutes: threshold },
  );
  const activeMilestoneSet = new Set(active_milestones);

  const ready = ghJson([
    "issue", "list", "--repo", repo, "--state", "open", "--search", '"Wave Ready:" in:title', "--limit", "50",
    "--json", "number,title,updatedAt,url,milestone,labels,body",
  ], []);

  const inProgress = ready.filter((i) => (i.labels || []).some((l) => String(l?.name || "") === WAVE_IN_PROGRESS_LABEL));

  // Enrich each wave with its open features for the pure evaluator
  const milestoneToRuns = new Map();
  for (const run of Array.from(allStates.values())) {
    const title = String(run?.context?.milestone_title || "").trim();
    const runId = String(run?.runId || run?.id || "").trim();
    if (!title || !runId) continue;
    if (!milestoneToRuns.has(title)) milestoneToRuns.set(title, new Set());
    milestoneToRuns.get(title).add(runId);
  }

  const enriched = inProgress.map((wave) => {
    const milestone = String(wave?.milestone?.title || String(wave?.title || "").replace(/^Wave Ready:\s*/, "")).trim();
    const features = milestone
      ? ghJson([
        "issue", "list", "--repo", repo, "--state", "open", "--milestone", milestone, "--label", FEATURE_LABEL, "--limit", "200",
        "--json", "number,title,url,updatedAt",
      ], [])
      : [];
    const runIds = milestone ? [...(milestoneToRuns.get(milestone) || new Set())] : [];
    return { ...wave, features, active_run_ids: runIds };
  });

  const stale = evaluateStalledWaves({ inProgressWaves: enriched, activeMilestones: activeMilestoneSet, staleMinutes: threshold, nowMs });
  const staleWithGuard = attachGuardMetadataToStalledWaves({ stale, runStates: Array.from(allStates.values()) });
  const staleWithContext = attachRunContextToStalledWaves({ stale: staleWithGuard, runStates: Array.from(allStates.values()) });
  const staleWithLease = attachLeaseContextToStalledWaves({ stale: staleWithContext, waveIssues: inProgress, nowMs });
  const staleWithActiveFlag = staleWithLease.map((entry) => ({
    ...entry,
    active_milestone: activeMilestoneSet.has(String(entry?.milestone || "").trim()),
  }));

  const staleWithMetadata = staleWithActiveFlag;

  const historyStore = loadStalledWaveHistory({ runsDir, repo });
  const historyWindowMs = repeatWindowMinutesValue * 60 * 1000;
  const historyResult = attachStalledWaveHistory({
    repo,
    detections: staleWithMetadata,
    history: historyStore.history,
    nowMs,
    windowMs: historyWindowMs,
  });
  const staleWithRepeat = historyResult.detections;
  if (historyResult.history_entries.length > 0) {
    const baseHistory = historyStore.exists ? readHistory(historyStore.path) : historyStore.history || [];
    const mergedHistory = appendStalledWaveHistory({
      history: baseHistory,
      entries: historyResult.history_entries,
      limit: historyLimitValue,
    });
    writeHistoryAtomic(historyStore.path, mergedHistory);
  }

  const stalledWaveTelemetry = buildStalledWaveTelemetry({ stalledWaves: staleWithRepeat, threshold });
  const shouldEmitBug = shouldEmitStalledWaveBug({ detections: staleWithRepeat, repeatThreshold: repeatThresholdValue });

  if (staleWithRepeat.length > 0) {
    const summary = summarizePendingStalls(staleWithRepeat);
    console.error(`[stall-gate] ${summary}`);
  }

  const remediationConfig = remediationPlanConfig({
    applyRemediation,
    dryRunRemediation: remediationDryRun,
  });

  let remediationPlan = null;
  let remediationPlanSummary = null;

  if (staleWithRepeat.length > 0) {
    remediationPlan = sanitizeWaveState({
      repo,
      dryRun: remediationConfig.dryRun,
      apply: remediationConfig.apply,
      runId,
      pipeline,
      runsDir,
      staleRunMinutes: threshold,
    });
    remediationPlanSummary = buildRemediationPlanSummary(remediationPlan, { apply: remediationConfig.apply, stalledWaves: staleWithRepeat });
  }

  let artifact = { ok: true, issue_url: "", error: "" };
  if (staleWithRepeat.length > 0 && shouldEmitBug) {
    const stableEvidence = staleWithRepeat.map((s) => ({
      reason: s.reason,
      wave_issue_number: s.wave_issue_number,
      milestone: s.milestone,
      guard_reason_text: s.guard_reason_text,
      guard_metadata: s.guard_metadata,
      run_context: s.run_context,
      run_context_present: s.run_context_present,
      run_worktree_dir: String(s.run_context?.worktree_dir || ""),
      guard_status: String(s.run_context?.guard_status || ""),
      guard_reason_code: String(s.run_context?.guard_reason_code || ""),
      guard_terminal_at: String(s.run_context?.guard_terminal_at || ""),
      guard_snapshot: s.run_context?.guard_metadata || null,
      guard_snapshot_present: Boolean(s.run_context?.guard_metadata_present),
      lease_context: s.lease_context,
      lease_context_present: s.lease_context_present,
      active_milestone: s.active_milestone,
      open_feature_numbers: (s.open_features || []).map((f) => Number(f.number)).sort((a, b) => a - b),
      signature_hash: String(s.signature_hash || ""),
      repeat_count: Number(s.repeat_count || 0),
      repeat_first_observed_at: String(s.repeat_first_observed_at || ""),
      repeat_last_observed_at: String(s.repeat_last_observed_at || ""),
    }));

    const guardSummary = staleWithRepeat
      .map((s) => s.guard_reason_text)
      .filter(Boolean)
      .join(" ");

    const runSummary = staleWithRepeat
      .map((s) => {
        const runIdValue = String(s.run_context?.run_id || "").trim();
        const nodeValue = String(s.run_context?.node || "").trim();
        const statusValue = String(s.run_context?.status || "").trim();
        if (!runIdValue && !nodeValue && !statusValue) return "";
        return `run=${runIdValue || "unknown"} node=${nodeValue || "unknown"} status=${statusValue || "unknown"}`;
      })
      .filter(Boolean)
      .slice(0, 2)
      .join(" ");

    const remediationSummaryLine = remediationPlanSummary?.summary_line ? ` ${remediationPlanSummary.summary_line}` : "";
    const runSummaryLine = runSummary ? ` Run context: ${runSummary}.` : "";
    const remediationMode = remediationPlanSummary?.mode || (remediationConfig.apply ? "apply" : "dry-run");
    const remediationPlanEvidence = remediationPlan
      ? {
        remediation_plan_mode: remediationMode,
        remediation_plan_summary: remediationPlanSummary,
        remediation_plan: remediationPlan.repair_plan,
        remediation_plan_actions: remediationPlan.repair_plan?.actions,
        remediation_plan_stats: remediationPlan.repair_plan?.stats,
        remediation_plan_lease_evidence: remediationPlan.lease_evidence,
      }
      : {
        remediation_plan_mode: remediationMode,
        remediation_plan_summary: remediationPlanSummary,
      };

    const repeatTotal = stableEvidence
      .reduce((max, entry) => Math.max(max, Number(entry.repeat_count || 0)), 0);
    const bugSignature = stableEvidence.find((entry) => entry.signature_hash)?.signature_hash || "";

    artifact = emitBugIssue({
      repo,
      runId,
      pipeline,
      bugType: "stalled-wave-execution",
      summary: `Detected ${staleWithRepeat.length} stalled in-progress wave marker(s) or feature inactivity older than ${threshold} minutes.${guardSummary ? ` ${guardSummary}` : ""}${runSummaryLine}${remediationSummaryLine}`,
      evidence: JSON.stringify({
        stale: stableEvidence,
        threshold_minutes: threshold,
        remediation_plan: remediationPlanEvidence,
        repeat_threshold: repeatThresholdValue,
        repeat_window_minutes: repeatWindowMinutesValue,
        repeat_count: repeatTotal,
        observed_behavior: `Detected ${staleWithRepeat.length} stalled wave marker(s) with repeated inactivity beyond threshold.`,
        expected_behavior: "In-progress waves should continue producing commits, reviews, or merges within the configured stale window.",
        remediation_attempts: remediationPlanSummary?.summary_line
          ? `Supervisor generated remediation plan: ${remediationPlanSummary.summary_line}`
          : "Supervisor captured stale-wave diagnostics and prepared remediation actions.",
        ownership_hint: "control_plane",
        next_step_hint: "Apply remediation plan actions, then rerun stalled-wave diagnostics.",
      }),
      signatureHash: bugSignature,
    });
  }

  return {
    ok: true,
    stale_count: staleWithMetadata.length,
    stalled_wave_count: staleWithMetadata.length,
    threshold_minutes: threshold,
    stale: staleWithRepeat,
    stalled_wave_telemetry: stalledWaveTelemetry,
    stalled_wave_telemetry_count: stalledWaveTelemetry.length,
    remediation_plan_summary: remediationPlanSummary,
    remediation_plan: remediationPlan?.repair_plan || null,
    remediation_plan_mode: remediationPlanSummary?.mode || (remediationConfig.apply ? "apply" : "dry-run"),
    remediation_plan_actions: remediationPlan?.repair_plan?.actions || [],
    remediation_plan_stats: remediationPlan?.repair_plan?.stats || null,
    remediation_plan_lease_evidence: remediationPlan?.lease_evidence || null,
    remediation_plan_active_milestones: remediationPlan?.active_lease_milestones || [],
    active_milestones: [...activeMilestoneSet].sort((a, b) => a.localeCompare(b)),
    artifact_url: artifact.issue_url,
    stalled_wave_artifact_url: artifact.issue_url,
    artifact_error: artifact.error,
    stalled_wave_artifact_error: artifact.error,
    history_store_path: historyStore.path,
    history_entry_count: historyResult.history_entries.length,
    history_window_count: historyResult.history_window_count,
    repeat_threshold: repeatThresholdValue,
    repeat_window_minutes: repeatWindowMinutesValue,
    summary: staleWithMetadata.length > 0
      ? `Detected ${staleWithMetadata.length} stalled in-progress wave marker(s).`
      : "No stalled in-progress wave markers.",
  };
}
