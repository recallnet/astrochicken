const DEFAULT_READY_LABEL = "ready";

const BLOCKING_STATES = new Set(["OPEN", "IN_PROGRESS"]);
const CLOSED_STATES = new Set(["CLOSED", "DONE", "COMPLETED", "MERGED", "RESOLVED"]);
const RELATIONSHIP_KEYS = {
  blocked_by: ["blocked_by", "blockedBy"],
  blocks: ["blocks", "blocking_issues", "blockingIssues"],
  related_to: ["related_to", "relatedTo"],
};

/**
 * Dispatch scheduler (deterministic).
 *
 * Snapshot issue requirements (fields are snake or camel case):
 * - id or number (required for stable identity)
 * - state (OPEN/CLOSED/IN_PROGRESS; missing treated as OPEN)
 * - labels (array of strings or {name}); missing => not ready
 * - factory_id (string; missing => "unknown")
 * - relationships: blocked_by / blocks / related_to (arrays of {id/number, state})
 *   missing relationship lists are treated as empty and noted in decision notes.
 *
 * Ordering (stable):
 * 1) ready_at timestamp if present (ascending)
 * 2) priority (numeric, ascending) when ready_at missing
 * 3) issue number (ascending)
 * 4) stable string key "<factory_id>#<id|number>"
 */
export function computeIssueSchedule({
  issues = [],
  readyLabel = DEFAULT_READY_LABEL,
  maxConcurrentGlobal = 1,
  maxConcurrentPerFactory = {},
  defaultMaxConcurrentPerFactory,
} = {}) {
  const normalized = (Array.isArray(issues) ? issues : []).map((issue, index) =>
    normalizeIssueSnapshot(issue, { index }),
  );

  const issueByKey = new Map(normalized.map((item) => [item.key, item]));

  const inFlight = normalized.filter((item) => item.isInFlight);
  const inFlightCounts = countByFactory(inFlight);

  const globalLimit = clampCount(maxConcurrentGlobal);
  const globalSlots = Math.max(0, globalLimit - inFlight.length);
  const perFactoryDefault = Number.isFinite(Number(defaultMaxConcurrentPerFactory))
    ? Number(defaultMaxConcurrentPerFactory)
    : globalLimit;

  const factoryLimits = new Map();
  for (const item of normalized) {
    const factoryId = item.factoryId;
    if (!factoryLimits.has(factoryId)) {
      const configured = Number(maxConcurrentPerFactory?.[factoryId]);
      const limit = Number.isFinite(configured) ? configured : perFactoryDefault;
      factoryLimits.set(factoryId, clampCount(limit));
    }
  }

  const factorySlots = new Map();
  for (const [factoryId, limit] of factoryLimits.entries()) {
    const inFlightCount = inFlightCounts.get(factoryId) || 0;
    factorySlots.set(factoryId, Math.max(0, limit - inFlightCount));
  }

  const sorted = [...normalized].sort(compareIssueOrder);
  const eligible = [];
  const skipped = [];

  for (const item of sorted) {
    const decision = buildDecision(item);

    if (item.labelsMissing || !item.labels.includes(readyLabel)) {
      decision.decision = "skipped";
      decision.reason_code = "not_ready";
      decision.reason_details = { ready_label: readyLabel, labels_missing: item.labelsMissing };
      skipped.push(decision);
      continue;
    }

    if (item.isClosed) {
      decision.decision = "skipped";
      decision.reason_code = "state_closed";
      decision.reason_details = { state: item.state || "" };
      skipped.push(decision);
      continue;
    }

    if (item.isInFlight) {
      decision.decision = "skipped";
      decision.reason_code = "in_flight";
      decision.reason_details = { state: item.state || "" };
      skipped.push(decision);
      continue;
    }

    const relationship = analyzeRelationships(item, issueByKey);
    if (relationship.blocking.length > 0) {
      decision.decision = "skipped";
      decision.reason_code = "blocked_by_open";
      decision.reason_details = {
        blocked_by: relationship.blocking.map((b) => ({
          issue_key: b.key,
          issue_number: b.number,
          state: b.state,
        })),
        blocks_confirmed_by: relationship.blocksConfirmedBy,
      };
      if (relationship.missingState.length > 0) {
        decision.notes.push("blocked_by_state_missing");
      }
      skipped.push(decision);
      continue;
    }

    if (relationship.missingState.length > 0) {
      decision.notes.push("blocked_by_state_missing");
    }

    if (relationship.relatedTo.length > 0) {
      decision.notes.push("related_to");
      decision.reason_details = {
        ...decision.reason_details,
        related_to: relationship.relatedTo.map((r) => ({
          issue_key: r.key,
          issue_number: r.number,
        })),
      };
    }

    eligible.push({ item, decision });
  }

  const selected = [];
  const requeued = [];
  let remainingGlobal = globalSlots;

  for (const entry of eligible) {
    const { item, decision } = entry;

    if (remainingGlobal <= 0) {
      decision.decision = "requeued";
      decision.reason_code = "global_slots_full";
      requeued.push(decision);
      continue;
    }

    const remainingFactory = factorySlots.get(item.factoryId) ?? 0;
    if (remainingFactory <= 0) {
      decision.decision = "requeued";
      decision.reason_code = "factory_slots_full";
      decision.reason_details = { factory_id: item.factoryId };
      requeued.push(decision);
      continue;
    }

    decision.decision = "selected";
    decision.reason_code = "selected";
    selected.push(decision);
    remainingGlobal -= 1;
    factorySlots.set(item.factoryId, remainingFactory - 1);
  }

  return {
    selected_issues: selected,
    skipped_issues: skipped,
    requeued_issues: requeued,
    stats: {
      total_issues: normalized.length,
      eligible_count: eligible.length,
      selected_count: selected.length,
      skipped_count: skipped.length,
      requeued_count: requeued.length,
      global_limit: globalLimit,
      global_in_flight: inFlight.length,
      global_slots: globalSlots,
      per_factory: buildFactoryStats(factoryLimits, factorySlots, inFlightCounts),
    },
  };
}

function normalizeIssueSnapshot(issue, { index }) {
  const raw = issue && typeof issue === "object" ? issue : {};
  const id = raw.id ?? raw.issue_id ?? raw.issueId ?? raw.number ?? raw.issue_number ?? "";
  const numberRaw = raw.number ?? raw.issue_number ?? raw.issueNumber ?? "";
  const number = Number.isFinite(Number(numberRaw)) ? Number(numberRaw) : null;
  const factoryId = String(raw.factory_id ?? raw.factoryId ?? "unknown").trim() || "unknown";

  const labelData = normalizeLabels(raw.labels);
  const state = normalizeState(raw.state ?? raw.status ?? "");

  const isClosed = state && CLOSED_STATES.has(state);
  const isInFlight = Boolean(raw.in_flight ?? raw.inFlight ?? state === "IN_PROGRESS");

  const { value: readyAt, missing: readyAtMissing } = parseReadyAt(raw);
  const priorityValue = parsePriority(raw);
  const sortPrimary = readyAtMissing ? priorityValue : readyAt;
  const sortSecondary = Number.isFinite(number) ? number : Number.POSITIVE_INFINITY;
  const key = `${factoryId}#${id || numberRaw || String(index)}`;

  const relationships = {
    blocked_by: normalizeRelationshipList(raw, RELATIONSHIP_KEYS.blocked_by, factoryId),
    blocks: normalizeRelationshipList(raw, RELATIONSHIP_KEYS.blocks, factoryId),
    related_to: normalizeRelationshipList(raw, RELATIONSHIP_KEYS.related_to, factoryId),
  };

  const notes = [];
  if (labelData.missing) notes.push("labels_missing");
  if (relationships.blocked_by.missing) notes.push("blocked_by_missing");
  if (relationships.blocks.missing) notes.push("blocks_missing");
  if (relationships.related_to.missing) notes.push("related_to_missing");
  if (!state) notes.push("state_missing");

  return {
    raw,
    index,
    id,
    number,
    factoryId,
    labels: labelData.labels,
    labelsMissing: labelData.missing,
    state,
    isClosed,
    isInFlight,
    readyAt,
    readyAtMissing,
    priorityValue,
    sortPrimary,
    sortSecondary,
    key,
    sortKey: key,
    relationships,
    notes,
  };
}

function normalizeLabels(labels) {
  if (!Array.isArray(labels)) return { labels: [], missing: true };
  const out = labels
    .map((l) => (typeof l === "string" ? l : l?.name ?? ""))
    .map((l) => String(l).trim())
    .filter(Boolean);
  return { labels: out, missing: false };
}

function parseReadyAt(raw) {
  const value = raw?.ready_at ?? raw?.readyAt ?? raw?.ready_timestamp ?? raw?.readyTimestamp;
  if (value === undefined || value === null || value === "") return { value: Number.POSITIVE_INFINITY, missing: true };
  if (typeof value === "number" && Number.isFinite(value)) return { value, missing: false };
  const parsed = Date.parse(String(value));
  if (Number.isFinite(parsed)) return { value: parsed, missing: false };
  return { value: Number.POSITIVE_INFINITY, missing: true };
}

function parsePriority(raw) {
  const value = raw?.priority ?? raw?.priority_rank ?? raw?.priorityRank ?? "";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.POSITIVE_INFINITY;
}

function normalizeState(state) {
  const raw = String(state || "").trim();
  if (!raw) return "";
  return raw.toUpperCase().replace(/[\s-]+/g, "_");
}

function normalizeRelationshipList(raw, keys, defaultFactoryId) {
  const direct = extractRelationshipList(raw, keys);
  const list = Array.isArray(direct.list) ? direct.list : [];
  const entries = list
    .map((entry) => normalizeRelationshipEntry(entry, defaultFactoryId))
    .filter((entry) => entry.key);

  return {
    entries,
    missing: direct.missing,
  };
}

function extractRelationshipList(raw, keys) {
  for (const key of keys) {
    const value = raw?.[key];
    if (Array.isArray(value)) return { list: value, missing: false };
  }

  const rel = raw?.relationships;
  if (rel && typeof rel === "object") {
    for (const key of keys) {
      const value = rel?.[key];
      if (Array.isArray(value)) return { list: value, missing: false };
    }
  }

  return { list: [], missing: true };
}

function normalizeRelationshipEntry(entry, defaultFactoryId) {
  const raw = entry && typeof entry === "object" ? entry : {};
  const id = raw.id ?? raw.issue_id ?? raw.issueId ?? raw.number ?? raw.issue_number ?? "";
  const numberRaw = raw.number ?? raw.issue_number ?? raw.issueNumber ?? "";
  const number = Number.isFinite(Number(numberRaw)) ? Number(numberRaw) : null;
  const factoryId = String(raw.factory_id ?? raw.factoryId ?? defaultFactoryId ?? "").trim();
  const state = normalizeState(raw.state ?? raw.status ?? "");
  const key = `${factoryId || "unknown"}#${id || numberRaw}`;
  return {
    id,
    number,
    factoryId,
    state,
    key,
  };
}

function analyzeRelationships(item, issueByKey) {
  const blocking = [];
  const missingState = [];
  const blocksConfirmedBy = [];

  for (const blocker of item.relationships.blocked_by.entries) {
    let effectiveState = blocker.state;
    if (!effectiveState) {
      missingState.push(blocker);
      const blockerIssue = issueByKey.get(blocker.key);
      effectiveState = blockerIssue?.state || "";
    }
    if (effectiveState && BLOCKING_STATES.has(effectiveState)) {
      blocking.push({ ...blocker, state: effectiveState });
    }
  }

  if (blocking.length > 0) {
    for (const blocker of blocking) {
      const blockerIssue = issueByKey.get(blocker.key);
      if (!blockerIssue) continue;
      const confirms = blockerIssue.relationships.blocks.entries.some((entry) => entry.key === item.sortKey);
      if (confirms) blocksConfirmedBy.push(blocker.key);
    }
  }

  return {
    blocking,
    missingState,
    blocksConfirmedBy,
    relatedTo: item.relationships.related_to.entries,
  };
}

function compareIssueOrder(a, b) {
  if (a.sortPrimary !== b.sortPrimary) return a.sortPrimary - b.sortPrimary;
  if (a.sortSecondary !== b.sortSecondary) return a.sortSecondary - b.sortSecondary;
  return String(a.sortKey).localeCompare(String(b.sortKey));
}

function buildDecision(item) {
  return {
    issue_id: item.id || "",
    issue_number: item.number ?? "",
    factory_id: item.factoryId,
    sort_key: item.sortKey,
    decision: "",
    reason_code: "",
    reason_details: {},
    notes: [...item.notes],
  };
}

function countByFactory(items) {
  const counts = new Map();
  for (const item of items) {
    counts.set(item.factoryId, (counts.get(item.factoryId) || 0) + 1);
  }
  return counts;
}

function buildFactoryStats(factoryLimits, factorySlots, inFlightCounts) {
  const out = {};
  for (const [factoryId, limit] of factoryLimits.entries()) {
    out[factoryId] = {
      limit,
      in_flight: inFlightCounts.get(factoryId) || 0,
      slots_available: factorySlots.get(factoryId) ?? 0,
    };
  }
  return out;
}

function clampCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

export const READY_LABEL = DEFAULT_READY_LABEL;
