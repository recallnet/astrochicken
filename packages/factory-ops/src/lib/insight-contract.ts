import {
  FACTORY_INSIGHT_EVENTS,
  FACTORY_INSIGHT_SCHEMA_VERSION,
  REQUIRED_FIELDS,
  assertRequiredFields,
  canonicalEventName,
} from "./factory-insight-contract.ts";

export const InsightEventKind = Object.freeze({
  RUN_START: canonicalEventName(FACTORY_INSIGHT_EVENTS.RUN_START),
  RUN_NODE_CHANGE: canonicalEventName(FACTORY_INSIGHT_EVENTS.NODE_CHANGE),
  RUN_COMPLETE: canonicalEventName(FACTORY_INSIGHT_EVENTS.COMPLETE),
  RUN_FAIL: canonicalEventName(FACTORY_INSIGHT_EVENTS.FAIL),
  RUN_MERGE: canonicalEventName(FACTORY_INSIGHT_EVENTS.MERGE),
  RUN_ARTIFACT: canonicalEventName(FACTORY_INSIGHT_EVENTS.ARTIFACT),
  RUN_PROGRESS_HEARTBEAT: canonicalEventName(FACTORY_INSIGHT_EVENTS.PROGRESS),
  STATUS_SNAPSHOT: "factory.status.snapshot",
  TICK_SNAPSHOT: "factory.tick.snapshot",
  OUTCOMES_SNAPSHOT: "factory.outcomes.snapshot",
});

export const PROJECTION_DIMENSIONS = Object.freeze({
  factory_status: Object.freeze([
    "context",
    "active",
    "completed",
    "failed",
    "blocked_control_plane",
    "managed_state",
    "control_plane",
  ]),
  factory_tick_status: Object.freeze([
    "context",
    "ticks",
  ]),
  factory_subscribe_event: Object.freeze([
    "schemaVersion",
    "eventName",
    "runId",
    "goalId",
    "graphId",
    "nodeName",
    "semanticFamily",
    "semanticTarget",
    "status",
    "timestamp",
    "attempt",
    "payload",
  ]),
  factory_outcomes: Object.freeze([
    "repo",
    "since_iso",
    "commits",
    "goals",
    "issues",
    "merged_prs",
    "merge_commits_main",
    "closed_goals",
    "closed_features",
    "closed_feature_bug_total",
    "outcomes_degraded",
    "gh_failures",
  ]),
});

export const InsightEventShape = Object.freeze({
  schema_version: FACTORY_INSIGHT_SCHEMA_VERSION,
  required_fields: Object.freeze([...REQUIRED_FIELDS]),
  projection_dimensions: PROJECTION_DIMENSIONS,
});

function resolvePathValue(record = {}, path = "") {
  if (!path) return undefined;
  const keys = String(path).split(".").filter(Boolean);
  let cursor = record;
  for (const key of keys) {
    if (!cursor || typeof cursor !== "object" || !(key in cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

export function listMissingProjectionDimensions(surface = "", projection = {}) {
  const dimensions = PROJECTION_DIMENSIONS[surface];
  if (!dimensions) {
    throw new Error(`factory insight projection violation: unknown surface: ${surface}`);
  }
  return dimensions.filter((path) => resolvePathValue(projection, path) === undefined);
}

export function ensureProjectionDimensions(surface = "", projection = {}) {
  const missing = listMissingProjectionDimensions(surface, projection);
  if (missing.length === 0) return projection;
  throw new Error(`factory insight projection violation: ${surface} missing required dimension(s): ${missing.join(", ")}`);
}

export function ensureInsightEvent(event = {}) {
  return assertRequiredFields(event, { requiredFields: InsightEventShape.required_fields });
}
