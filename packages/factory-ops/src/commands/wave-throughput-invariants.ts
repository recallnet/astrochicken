function toNonNegativeInteger(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

function eventEpochMs(event = {}) {
  const candidates = [
    String(event?.at || "").trim(),
    String(event?.comment_created_at || "").trim(),
    String(event?.created_at || "").trim(),
  ].filter(Boolean);

  for (const iso of candidates) {
    const parsed = Date.parse(iso);
    if (Number.isFinite(parsed)) return parsed;
  }

  return Number.NaN;
}

function normalizeLeaseEvent(raw = {}) {
  const action = String(raw?.action || "").trim().toLowerCase();
  if (action !== "claim" && action !== "release") return null;

  const milestoneTitle = String(raw?.milestone_title || "").trim();
  const readyIssueRaw = Number(raw?.ready_issue_number || 0);
  const readyIssueNumber = Number.isFinite(readyIssueRaw) && readyIssueRaw > 0
    ? String(Math.trunc(readyIssueRaw))
    : "";

  if (!milestoneTitle || !readyIssueNumber) return null;

  return {
    action,
    at: String(raw?.at || "").trim(),
    milestone_title: milestoneTitle,
    ready_issue_number: readyIssueNumber,
    sort_epoch_ms: eventEpochMs(raw),
  };
}

function sortEpoch(value) {
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function sortEvents(a, b) {
  const ae = sortEpoch(a.sort_epoch_ms);
  const be = sortEpoch(b.sort_epoch_ms);
  if (ae !== be) return ae - be;
  if (a.action !== b.action) {
    const order = { release: 0, claim: 1 };
    return (order[a.action] ?? 99) - (order[b.action] ?? 99);
  }
  if (a.milestone_title !== b.milestone_title) return a.milestone_title.localeCompare(b.milestone_title);
  if (a.ready_issue_number !== b.ready_issue_number) return a.ready_issue_number.localeCompare(b.ready_issue_number);
  return String(a.at || "").localeCompare(String(b.at || ""));
}

function normalizeLeaseEvents(leaseEvents = []) {
  return (Array.isArray(leaseEvents) ? leaseEvents : [])
    .map((event) => normalizeLeaseEvent(event))
    .filter(Boolean)
    .sort(sortEvents);
}

function percentile(sortedValues = [], p = 0.5) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return null;
  const rank = Math.ceil(sortedValues.length * p);
  const index = Math.min(sortedValues.length - 1, Math.max(0, rank - 1));
  return sortedValues[index] ?? null;
}

function sortByMilestoneIssueAndAt(a, b) {
  if (a.milestone_title !== b.milestone_title) return a.milestone_title.localeCompare(b.milestone_title);
  if (a.ready_issue_number !== b.ready_issue_number) return a.ready_issue_number.localeCompare(b.ready_issue_number);
  return String(a.claim_at || "").localeCompare(String(b.claim_at || ""));
}

export function computeCapacitySnapshot({ readyWaveCount = 0, activeWaveCount = 0, maxConcurrentWaves = 1 } = {}) {
  const ready_backlog_count = toNonNegativeInteger(readyWaveCount, 0);
  const active_wave_count = toNonNegativeInteger(activeWaveCount, 0);
  const max_concurrent_waves = toNonNegativeInteger(maxConcurrentWaves, 1);
  const idle_slot_count = Math.max(0, max_concurrent_waves - active_wave_count);

  return {
    ready_backlog_count,
    active_wave_count,
    max_concurrent_waves,
    idle_slot_count,
    idle_with_runnable_backlog: ready_backlog_count > 0 && idle_slot_count > 0,
  };
}

export function measureRefillLatency({ leaseEvents = [] } = {}) {
  const normalized = normalizeLeaseEvents(leaseEvents);
  const pendingReleases = [];
  const samples = [];

  for (const event of normalized) {
    if (event.action === "release") {
      pendingReleases.push(event);
      continue;
    }

    if (event.action === "claim" && pendingReleases.length > 0) {
      const releaseEvent = pendingReleases.shift();
      const releaseMs = sortEpoch(releaseEvent.sort_epoch_ms);
      const claimMs = sortEpoch(event.sort_epoch_ms);
      if (!Number.isFinite(releaseMs) || !Number.isFinite(claimMs)) continue;

      samples.push({
        slot_freed_at: releaseEvent.at,
        slot_freed_milestone_title: releaseEvent.milestone_title,
        slot_freed_ready_issue_number: releaseEvent.ready_issue_number,
        claim_at: event.at,
        claim_milestone_title: event.milestone_title,
        claim_ready_issue_number: event.ready_issue_number,
        latency_ms: Math.max(0, Math.trunc(claimMs - releaseMs)),
      });
    }
  }

  samples.sort((a, b) => {
    const freed = String(a.slot_freed_at || "").localeCompare(String(b.slot_freed_at || ""));
    if (freed !== 0) return freed;
    const claim = String(a.claim_at || "").localeCompare(String(b.claim_at || ""));
    if (claim !== 0) return claim;
    if (a.claim_milestone_title !== b.claim_milestone_title) return a.claim_milestone_title.localeCompare(b.claim_milestone_title);
    return a.claim_ready_issue_number.localeCompare(b.claim_ready_issue_number);
  });

  const latencies = samples.map((sample) => sample.latency_ms).sort((a, b) => a - b);
  const latest = samples.length > 0 ? samples[samples.length - 1].latency_ms : null;

  return {
    sample_count: samples.length,
    samples,
    latest_ms: latest,
    p50_ms: percentile(latencies, 0.5),
    p95_ms: percentile(latencies, 0.95),
  };
}

export function classifyDuplicateClaims({ leaseEvents = [] } = {}) {
  const normalized = normalizeLeaseEvents(leaseEvents);
  const groups = new Map();

  for (const event of normalized) {
    const key = `${event.milestone_title}::${event.ready_issue_number}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }

  const expected_contention = [];
  const unsafe_drift = [];
  const markers = [];

  const groupKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  for (const key of groupKeys) {
    const groupEvents = groups.get(key) || [];
    if (groupEvents.length === 0) continue;

    const { milestone_title, ready_issue_number } = groupEvents[0];

    let depth = 0;
    const duplicateClaims = [];

    for (const event of groupEvents) {
      if (event.action === "claim") {
        if (depth >= 1) {
          duplicateClaims.push({
            milestone_title,
            ready_issue_number,
            claim_at: event.at,
            active_claims_before: depth,
          });
        }
        depth += 1;
      } else if (event.action === "release" && depth > 0) {
        depth -= 1;
      }
    }

    if (duplicateClaims.length === 0) continue;

    const unresolvedDuplicateCount = Math.max(0, depth - 1);
    const expectedCount = Math.max(0, duplicateClaims.length - unresolvedDuplicateCount);

    duplicateClaims.forEach((duplicate, index) => {
      const classification = index < expectedCount
        ? "expected_contention"
        : "unsafe_drift";

      const normalizedDuplicate = {
        ...duplicate,
        classification,
        reason: classification === "expected_contention"
          ? "loser_after_winner_with_release"
          : "concurrent_claim_without_matching_release",
      };

      if (classification === "expected_contention") {
        expected_contention.push(normalizedDuplicate);
      } else {
        unsafe_drift.push(normalizedDuplicate);
      }
    });

    markers.push({
      milestone_title,
      ready_issue_number,
      duplicate_claim_count: duplicateClaims.length,
      unresolved_duplicate_count: unresolvedDuplicateCount,
      final_claim_depth: depth,
    });
  }

  expected_contention.sort(sortByMilestoneIssueAndAt);
  unsafe_drift.sort(sortByMilestoneIssueAndAt);
  markers.sort((a, b) => {
    if (a.milestone_title !== b.milestone_title) return a.milestone_title.localeCompare(b.milestone_title);
    return a.ready_issue_number.localeCompare(b.ready_issue_number);
  });

  return {
    total_duplicate_claims: expected_contention.length + unsafe_drift.length,
    expected_contention_count: expected_contention.length,
    unsafe_drift_count: unsafe_drift.length,
    expected_contention,
    unsafe_drift,
    markers,
  };
}
