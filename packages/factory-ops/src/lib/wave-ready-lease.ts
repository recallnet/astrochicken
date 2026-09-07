import { trim, parseJson, gh, ghJson } from "./cli-helpers.ts";
import { FACTORY_LABEL_KEYS, getFactoryLabelName } from "./factory-label-contract.ts";
import {
  WAVE_READY_LEASE_CLOUDEVENT_PREFIX,
  WAVE_READY_LEASE_EVENT_SCHEMA_VERSION,
  buildWaveReadyLeaseEvent,
  buildWaveReadyLeaseCloudEvent,
  normalizeWaveReadyLeaseEvent,
  validateWaveReadyLeaseEvent,
  validateWaveReadyLeaseCloudEvent,
} from "./wave-ready-lease-cloudevents.ts";

export { WAVE_READY_LEASE_EVENT_SCHEMA_VERSION };
export const WAVE_READY_LEASE_EVENT_PREFIX = WAVE_READY_LEASE_CLOUDEVENT_PREFIX;
const WAVE_IN_PROGRESS_LABEL = getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.WAVE_IN_PROGRESS);

function hasLabel(issue, name) {
  const labels = Array.isArray(issue?.labels) ? issue.labels : [];
  return labels.some((l) => String(l?.name || "") === name);
}

function issueNumber(issue) {
  const n = Number(issue?.number || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function isWaveMarker(issue) {
  return /^Wave Ready:\s+/.test(String(issue?.title || ""));
}

function milestoneTitleFor(issue) {
  const fromMilestone = String(issue?.milestone?.title || "").trim();
  if (fromMilestone) return fromMilestone;
  const m = String(issue?.title || "").match(/^Wave Ready:\s*(.+)$/);
  return m ? m[1].trim() : "";
}

function issueUpdatedEpochMs(issue) {
  const candidates = [
    String(issue?.updated_at || "").trim(),
    String(issue?.updatedAt || "").trim(),
    String(issue?.created_at || "").trim(),
    String(issue?.createdAt || "").trim(),
  ].filter(Boolean);

  for (const iso of candidates) {
    const t = Date.parse(iso);
    if (Number.isFinite(t)) return t;
  }
  return Number.NaN;
}



function sortLeases(a, b) {
  if (a.milestone_title !== b.milestone_title) return a.milestone_title.localeCompare(b.milestone_title);
  if (a.ready_issue_number !== b.ready_issue_number) return String(a.ready_issue_number || "").localeCompare(String(b.ready_issue_number || ""));
  if (a.source !== b.source) return String(a.source || "").localeCompare(String(b.source || ""));
  if (a.run_id !== b.run_id) return String(a.run_id || "").localeCompare(String(b.run_id || ""));
  return String(a.updated_at || "").localeCompare(String(b.updated_at || ""));
}

function normalizeEvent(raw = {}, { fallbackMilestone = "", fallbackIssueNumber = "" } = {}) {
  const normalized = normalizeWaveReadyLeaseEvent({
    ...raw,
    milestone_title: String(raw?.milestone_title || fallbackMilestone || "").trim(),
    ready_issue_number: String(raw?.ready_issue_number || fallbackIssueNumber || "").trim(),
  });
  const validated = validateWaveReadyLeaseEvent(normalized);
  if (!validated.ok || !validated.value) return null;
  if (!validated.value.milestone_title || !validated.value.ready_issue_number) return null;
  return validated.value;
}

function parseEventLine(line = "", fallbacks = {}) {
  const trimmed = String(line || "").trim();
  if (!trimmed.startsWith(WAVE_READY_LEASE_EVENT_PREFIX)) return null;
  const payload = trimmed.slice(WAVE_READY_LEASE_EVENT_PREFIX.length).trim();
  if (!payload) return null;
  const parsed = parseJson(payload, null);
  if (!parsed || typeof parsed !== "object") return null;
  const validated = validateWaveReadyLeaseCloudEvent(parsed);
  if (validated.ok && validated.value) {
    return normalizeEvent(validated.value.data, fallbacks);
  }
  return normalizeEvent(parsed, fallbacks);
}

export function parseWaveReadyLeaseEventsFromComment(comment = {}, { fallbackMilestone = "", fallbackIssueNumber = "" } = {}) {
  const body = String(comment?.body || "");
  const createdAt = String(comment?.created_at || comment?.createdAt || "").trim();
  const events = [];

  for (const line of body.split(/\r?\n/)) {
    const parsed = parseEventLine(line, { fallbackMilestone, fallbackIssueNumber });
    if (!parsed) continue;
    events.push({
      ...parsed,
      comment_created_at: createdAt,
      sort_epoch_ms: Number.isFinite(Date.parse(createdAt)) ? Date.parse(createdAt) : Number.NaN,
    });
  }

  return events;
}

export function renderWaveReadyLeaseComment(event = {}) {
  const normalized = buildWaveReadyLeaseEvent(event);
  const cloudEvent = buildWaveReadyLeaseCloudEvent({
    id: `${normalized.action}:${normalized.milestone_title}:${normalized.ready_issue_number}:${normalized.run_id || "none"}`,
    subject: `wave-ready/${normalized.ready_issue_number}`,
    time: normalized.at,
    data: normalized,
  });
  return `${WAVE_READY_LEASE_EVENT_PREFIX}${JSON.stringify(cloudEvent)}`;
}

export function collectActiveWaveLeasesFromIssues({
  openIssues = [],
  commentsByIssue = new Map(),
  nowEpochMs = Date.now(),
  staleClaimMinutes = 0,
} = {}) {
  const thresholdMs = Number(staleClaimMinutes) > 0 ? Number(staleClaimMinutes) * 60 * 1000 : Number.POSITIVE_INFINITY;

  const activeLeases = [];
  const staleCandidates = [];

  const markers = (Array.isArray(openIssues) ? openIssues : []).filter((issue) => {
    if (!isWaveMarker(issue)) return false;
    const state = String(issue?.state || "OPEN").toUpperCase();
    return state !== "CLOSED";
  });

  for (const marker of markers) {
    const n = issueNumber(marker);
    const markerMilestone = milestoneTitleFor(marker);
    if (!n || !markerMilestone) continue;

    const comments = commentsByIssue.get(String(n)) || commentsByIssue.get(n) || [];
    const parsedEvents = [];

    for (const comment of Array.isArray(comments) ? comments : []) {
      parsedEvents.push(...parseWaveReadyLeaseEventsFromComment(comment, {
        fallbackMilestone: markerMilestone,
        fallbackIssueNumber: String(n),
      }));
    }

    parsedEvents.sort((a, b) => {
      const ae = Number.isFinite(a.sort_epoch_ms) ? a.sort_epoch_ms : Number.NEGATIVE_INFINITY;
      const be = Number.isFinite(b.sort_epoch_ms) ? b.sort_epoch_ms : Number.NEGATIVE_INFINITY;
      if (ae !== be) return ae - be;
      if (a.action !== b.action) return String(a.action || "").localeCompare(String(b.action || ""));
      return String(a.at || "").localeCompare(String(b.at || ""));
    });

    const latestEvent = parsedEvents.length > 0 ? parsedEvents[parsedEvents.length - 1] : null;
    const hasInProgressLabel = hasLabel(marker, WAVE_IN_PROGRESS_LABEL);

    // Expiring explicit claims is optional; default is no expiry for safety.
    let explicitClaimIsStale = false;
    if (latestEvent?.action === "claim" && Number.isFinite(latestEvent.sort_epoch_ms) && Number.isFinite(nowEpochMs)) {
      explicitClaimIsStale = (nowEpochMs - latestEvent.sort_epoch_ms) > thresholdMs;
    }

    if (latestEvent?.action === "claim" && explicitClaimIsStale) {
      staleCandidates.push({
        run_id: String(latestEvent.run_id || ""),
        milestone_title: markerMilestone,
        status: "claimed",
        updated_at: String(latestEvent.comment_created_at || latestEvent.at || ""),
        worktree_dir: "",
        ready_issue_number: String(n),
        source: "github_claim",
      });
    }

    const explicitActiveClaim = latestEvent?.action === "claim" && !explicitClaimIsStale;
    const hasExplicitLeaseHistory = parsedEvents.length > 0;

    // Legacy fallback only: if no explicit lease history exists at all,
    // treat wave-in-progress as an implicit GitHub-backed claim.
    // Once explicit events exist, they are authoritative (including stale claims).
    const implicitLabelClaim = hasInProgressLabel && !hasExplicitLeaseHistory;
    const implicitUpdatedEpochMs = issueUpdatedEpochMs(marker);
    const implicitClaimIsStale = implicitLabelClaim
      && Number.isFinite(thresholdMs)
      && Number.isFinite(nowEpochMs)
      && (
        Number.isFinite(implicitUpdatedEpochMs)
          ? (nowEpochMs - implicitUpdatedEpochMs) > thresholdMs
          : true
      );

    if (implicitClaimIsStale) {
      staleCandidates.push({
        run_id: "",
        milestone_title: markerMilestone,
        status: "implicit",
        updated_at: Number.isFinite(implicitUpdatedEpochMs) ? new Date(implicitUpdatedEpochMs).toISOString() : "",
        worktree_dir: "",
        ready_issue_number: String(n),
        source: "github_label",
      });
    }

    const implicitActiveClaim = implicitLabelClaim && !implicitClaimIsStale;

    if (!explicitActiveClaim && !implicitActiveClaim) continue;

    activeLeases.push({
      run_id: String(latestEvent?.run_id || ""),
      milestone_title: markerMilestone,
      status: explicitActiveClaim ? "claimed" : "implicit",
      updated_at: explicitActiveClaim
        ? String(latestEvent?.comment_created_at || latestEvent?.at || "")
        : (Number.isFinite(implicitUpdatedEpochMs) ? new Date(implicitUpdatedEpochMs).toISOString() : ""),
      worktree_dir: "",
      ready_issue_number: String(n),
      source: explicitActiveClaim ? "github_claim" : "github_label",
    });
  }

  activeLeases.sort(sortLeases);
  staleCandidates.sort(sortLeases);

  return {
    stale_run_minutes: Number(staleClaimMinutes) > 0 ? Number(staleClaimMinutes) : 0,
    active_lease_count: activeLeases.length,
    stale_candidate_count: staleCandidates.length,
    active_milestones: [...new Set(activeLeases.map((l) => l.milestone_title))].sort((a, b) => a.localeCompare(b)),
    active_leases: activeLeases,
    stale_candidates: staleCandidates,
  };
}

export function collectActiveWaveLeasesFromRepo({
  repo = "",
  openIssues = [],
  nowEpochMs = Date.now(),
  staleClaimMinutes = 0,
  execGhJson = ghJson,
} = {}) {
  if (!repo) {
    return {
      stale_run_minutes: Number(staleClaimMinutes) > 0 ? Number(staleClaimMinutes) : 0,
      active_lease_count: 0,
      stale_candidate_count: 0,
      active_milestones: [],
      active_leases: [],
      stale_candidates: [],
    };
  }

  const commentsByIssue = new Map();
  const waveMarkers = (Array.isArray(openIssues) ? openIssues : []).filter((issue) => {
    if (!isWaveMarker(issue)) return false;
    const state = String(issue?.state || "OPEN").toUpperCase();
    return state !== "CLOSED";
  });

  for (const marker of waveMarkers) {
    const n = issueNumber(marker);
    if (!n) continue;

    const perPage = 100;
    const pagedComments = [];

    for (let page = 1; page <= 100; page += 1) {
      const comments = execGhJson(["api", `repos/${repo}/issues/${n}/comments?per_page=${perPage}&page=${page}`], []);
      const rows = Array.isArray(comments) ? comments : [];
      if (rows.length === 0) break;
      pagedComments.push(...rows);
      if (rows.length < perPage) break;
    }

    commentsByIssue.set(String(n), pagedComments);
  }

  return collectActiveWaveLeasesFromIssues({
    openIssues,
    commentsByIssue,
    nowEpochMs,
    staleClaimMinutes,
  });
}

export function claimReadyWaveIssue({
  repo = "",
  readyIssueNumber = "",
  milestoneTitle = "",
  runId = "",
  pipeline = "wave_execute",
  execGh = gh,
} = {}) {
  const issueRaw = Number(readyIssueNumber || 0);
  const issueNumberValue = Number.isFinite(issueRaw) && issueRaw > 0 ? String(Math.trunc(issueRaw)) : "";
  const milestone = String(milestoneTitle || "").trim();
  if (!repo || !issueNumberValue || !milestone) {
    return { ok: false, error: "missing_repo_issue_or_milestone" };
  }

  const addLabelResult = execGh(["issue", "edit", issueNumberValue, "--repo", repo, "--add-label", WAVE_IN_PROGRESS_LABEL]);
  if (!addLabelResult?.ok) {
    return { ok: false, error: addLabelResult?.stderr || "gh_add_label_failed" };
  }

  const event = buildWaveReadyLeaseEvent({
    action: "claim",
    milestoneTitle: milestone,
    readyIssueNumber: issueNumberValue,
    runId,
    pipeline,
  });

  const commentResult = execGh([
    "issue",
    "comment",
    issueNumberValue,
    "--repo",
    repo,
    "--body",
    renderWaveReadyLeaseComment(event),
  ]);

  if (!commentResult?.ok) {
    const rollbackResult = execGh(["issue", "edit", issueNumberValue, "--repo", repo, "--remove-label", WAVE_IN_PROGRESS_LABEL]);
    return {
      ok: false,
      error: commentResult?.stderr || "gh_comment_failed",
      event,
      rollback_label_attempted: true,
      rollback_label_ok: Boolean(rollbackResult?.ok),
      rollback_label_error: rollbackResult?.ok ? "" : (rollbackResult?.stderr || "gh_remove_label_failed"),
    };
  }

  return { ok: true, issue_number: issueNumberValue, milestone_title: milestone, event };
}

export function releaseReadyWaveClaim({
  repo = "",
  readyIssueNumber = "",
  milestoneTitle = "",
  runId = "",
  pipeline = "wave_execute",
  reason = "released",
  removeLabel = false,
  execGh = gh,
} = {}) {
  const issueRaw = Number(readyIssueNumber || 0);
  const issueNumberValue = Number.isFinite(issueRaw) && issueRaw > 0 ? String(Math.trunc(issueRaw)) : "";
  const milestone = String(milestoneTitle || "").trim();
  if (!repo || !issueNumberValue || !milestone) {
    return { ok: false, error: "missing_repo_issue_or_milestone" };
  }

  const event = buildWaveReadyLeaseEvent({
    action: "release",
    milestoneTitle: milestone,
    readyIssueNumber: issueNumberValue,
    runId,
    pipeline,
    reason,
  });

  const commentResult = execGh([
    "issue",
    "comment",
    issueNumberValue,
    "--repo",
    repo,
    "--body",
    renderWaveReadyLeaseComment(event),
  ]);

  if (!commentResult?.ok) {
    return { ok: false, error: commentResult?.stderr || "gh_comment_failed", event };
  }

  let removeLabelResult = { ok: true, stderr: "" };
  if (removeLabel) {
    removeLabelResult = execGh(["issue", "edit", issueNumberValue, "--repo", repo, "--remove-label", WAVE_IN_PROGRESS_LABEL]);
  }

  return {
    ok: Boolean(removeLabelResult?.ok),
    issue_number: issueNumberValue,
    milestone_title: milestone,
    event,
    remove_label_ok: Boolean(removeLabelResult?.ok),
    remove_label_error: removeLabelResult?.ok ? "" : (removeLabelResult?.stderr || "gh_remove_label_failed"),
  };
}
