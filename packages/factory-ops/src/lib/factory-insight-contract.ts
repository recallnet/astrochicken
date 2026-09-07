const FACTORY_INSIGHT_UNKNOWN = "unknown";

export const FACTORY_INSIGHT_SCHEMA_VERSION = "factory_insight_event/v1";

export const REQUIRED_FIELDS = Object.freeze([
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
]);

// Aligned with telemetry EventKind vocabulary from packages/factory-telemetry/src/events.ts.
const TELEMETRY_EVENT_KIND_BY_TYPE = Object.freeze({
  "run-start": "stage.start",
  "node-change": "stage.start",
  complete: "stage.finish",
  fail: "stage.error",
  merge: "stage.finish",
  artifact: "context.update",
  progress: "pipeline.heartbeat",
});

const CANONICAL_EVENT_NAME_BY_TYPE = Object.freeze({
  "run-start": "factory.run.start",
  "node-change": "factory.run.node_change",
  complete: "factory.run.complete",
  fail: "factory.run.fail",
  merge: "factory.run.merge",
  artifact: "factory.run.artifact",
  progress: "factory.progress.heartbeat",
});

export const FACTORY_INSIGHT_EVENTS = Object.freeze({
  RUN_START: "run-start",
  NODE_CHANGE: "node-change",
  COMPLETE: "complete",
  FAIL: "fail",
  MERGE: "merge",
  ARTIFACT: "artifact",
  PROGRESS: "progress",
});

export const FACTORY_INSIGHT_EVENT_TYPES = Object.freeze(Object.values(FACTORY_INSIGHT_EVENTS));

export const FACTORY_INSIGHT_TARGETS = Object.freeze([
  "next-goal-progress",
  "next-issue",
  "next-review",
  "next-merge",
  "next-release-report",
]);

const EVENT_TYPE_ALIASES = Object.freeze({
  "factory.run.start": "run-start",
  "factory.run.node_change": "node-change",
  "factory.run.complete": "complete",
  "factory.run.fail": "fail",
  "factory.run.merge": "merge",
  "factory.run.artifact": "artifact",
  "factory.progress.heartbeat": "progress",
});

function trim(value = "") {
  return String(value || "").trim();
}

function asObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function normalizeIsoTimestamp(value = "") {
  const explicit = trim(value);
  if (!explicit) return new Date().toISOString();
  const parsed = Date.parse(explicit);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function nonEmptyStringOrFallback(value = "", fallback = "") {
  const normalized = trim(value);
  return normalized || trim(fallback);
}

export function normalizeGraphLabel(graph = "") {
  return trim(graph)
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/\.workflow-source\.mjs$/i, "")
    .replace(/\.dot$/i, "")
    .trim() || "";
}

function resolveGraphFromState(state = {}) {
  const context = asObject(state.context);
  const fromState = nonEmptyStringOrFallback(
    state.pipeline || state.pipelineFile || state.graph,
    "",
  );
  if (fromState) return fromState;

  for (const [key, value] of Object.entries(context)) {
    if (!key.startsWith("__child_pipeline_")) continue;
    const candidate = trim(value);
    if (candidate) return candidate;
  }

  return "";
}

function resolveIssueFromState(state = {}) {
  const context = asObject(state.context);
  return nonEmptyStringOrFallback(
    context.issue_number || context.current_issue_number || context.goal_issue_number,
    "",
  );
}

function resolveMilestoneFromState(state = {}) {
  const context = asObject(state.context);
  return nonEmptyStringOrFallback(
    context.milestone_title || context.milestone || context.goal_title,
    "",
  );
}

function normalizePayload(rawEvent = {}, state = {}) {
  const context = asObject(state.context);
  const rawPayload = asObject(rawEvent.payload);
  const payload = {
    ...rawPayload,
    review_verdict: nonEmptyStringOrFallback(rawEvent.review_verdict, context.review_verdict),
    review_failed: nonEmptyStringOrFallback(rawEvent.review_failed, context.review_failed),
    review_attempt: nonEmptyStringOrFallback(rawEvent.review_attempt, context.review_attempt),
    merge_status: nonEmptyStringOrFallback(rawEvent.mergeStatus || rawEvent.merge_status, context.merge_status),
    merged_count: nonEmptyStringOrFallback(rawEvent.merged_count, context.merged_count),
    failed_count: nonEmptyStringOrFallback(rawEvent.failed_count, context.failed_count),
    artifact_url: nonEmptyStringOrFallback(rawEvent.artifactUrl || rawEvent.artifact_url, context.artifact_url),
  };

  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => trim(value)),
  );
}

function normalizeStatus({ eventType = "", status = "" } = {}) {
  const explicit = trim(status).toLowerCase();
  if (explicit) return explicit;

  if (eventType === "run-start") return "started";
  if (eventType === "node-change") return "in_progress";
  if (eventType === "complete" || eventType === "merge" || eventType === "artifact") return "succeeded";
  if (eventType === "fail") return "failed";
  if (eventType === "progress") return "heartbeat";
  return FACTORY_INSIGHT_UNKNOWN;
}

function normalizeAttempt(rawEvent = {}, state = {}) {
  const context = asObject(state.context);
  const raw = nonEmptyStringOrFallback(
    rawEvent.attempt || rawEvent.review_attempt,
    context.review_attempt || context.attempt,
  );
  return raw || "1";
}

function isIssueExecutionGraph(graphLabel = "") {
  return graphLabel === "goal_issue_execute" || graphLabel === "wave_issue_execute";
}

function isReviewNode(node = "") {
  const normalized = trim(node).toLowerCase();
  return normalized === "review" || normalized.startsWith("review_") || normalized.includes("review");
}

function normalizeSemanticTargets(targets = []) {
  const resolved = [];
  for (const target of targets) {
    const normalized = normalizeInsightTarget(target);
    if (!normalized || resolved.includes(normalized)) continue;
    resolved.push(normalized);
  }
  return resolved;
}

export function normalizeInsightTarget(target = "") {
  const normalized = trim(target).toLowerCase();
  return FACTORY_INSIGHT_TARGETS.includes(normalized) ? normalized : "";
}

export function resolveInsightEventType(type = "") {
  const normalized = trim(type).toLowerCase();
  if (!normalized) return "";
  if (FACTORY_INSIGHT_EVENT_TYPES.includes(normalized)) return normalized;
  if (EVENT_TYPE_ALIASES[normalized]) return EVENT_TYPE_ALIASES[normalized];
  return "";
}

export function canonicalEventName(type = "", subtype = "") {
  const resolvedType = resolveInsightEventType(type);
  if (resolvedType) return CANONICAL_EVENT_NAME_BY_TYPE[resolvedType];

  const normalizedType = trim(type).toLowerCase();
  const normalizedSubtype = trim(subtype).toLowerCase();

  // Telemetry-compatible fallback for direct (type, subtype) callers.
  if (normalizedType === "stage" && normalizedSubtype === "start") return "stage.start";
  if (normalizedType === "stage" && normalizedSubtype === "finish") return "stage.finish";
  if (normalizedType === "stage" && normalizedSubtype === "error") return "stage.error";
  if (normalizedType === "pipeline" && normalizedSubtype === "heartbeat") return "pipeline.heartbeat";

  if (normalizedType) return `factory.${normalizedType}${normalizedSubtype ? `.${normalizedSubtype}` : ""}`;
  return "factory.event.unknown";
}

export function classifySemanticEvent(event = {}) {
  const graphLabel = normalizeGraphLabel(event.graph || event.graphId);
  const eventType = resolveInsightEventType(event.event) || "";
  const node = trim(event.node || event.nodeName);
  const reviewVerdict = trim(event.review_verdict || event.reviewVerdict);
  const reviewFailed = trim(event.review_failed || event.reviewFailed);
  const mergeStatus = trim(event.mergeStatus || event.merge_status);

  const result = {
    graph_label: graphLabel,
    semantic_family: "infra",
    semantic_target: "",
    semantic_targets: [],
  };

  if (eventType === "merge" || graphLabel === "merge_item" || (graphLabel === "wave_execute" && mergeStatus)) {
    result.semantic_family = "merge";
    result.semantic_targets = ["next-merge", "next-goal-progress"];
    result.semantic_target = "next-merge";
    return result;
  }

  if (graphLabel === "release_report_flow") {
    result.semantic_family = "release";
    result.semantic_targets = ["next-release-report"];
    result.semantic_target = "next-release-report";
    return result;
  }

  if (isIssueExecutionGraph(graphLabel)) {
    const isReview = isReviewNode(node) || (eventType !== "node-change" && (reviewVerdict || reviewFailed));
    if (isReview) {
      result.semantic_family = "review";
      result.semantic_targets = ["next-review", "next-goal-progress"];
      if (eventType === "complete" || eventType === "fail") result.semantic_targets.push("next-issue");
      result.semantic_target = "next-review";
      return result;
    }

    if (eventType === "complete" || eventType === "fail") {
      result.semantic_family = "issue";
      result.semantic_targets = ["next-issue", "next-goal-progress"];
      result.semantic_target = "next-issue";
      return result;
    }
  }

  if (graphLabel === "goal_execute" && (eventType === "complete" || eventType === "fail")) {
    result.semantic_family = "goal";
    result.semantic_targets = ["next-goal-progress"];
    result.semantic_target = "next-goal-progress";
    return result;
  }

  return result;
}

function buildNormalizedEvent(rawEvent = {}, { state = {}, eventType = "", allowFallback = true } = {}) {
  const context = asObject(state.context);

  const resolvedRunId = nonEmptyStringOrFallback(rawEvent.runId || rawEvent.run_id, state.runId);
  const resolvedGraph = nonEmptyStringOrFallback(rawEvent.graph, resolveGraphFromState(state));
  const resolvedNode = nonEmptyStringOrFallback(rawEvent.node, state.currentNode);
  const resolvedIssue = nonEmptyStringOrFallback(rawEvent.issue, resolveIssueFromState(state));
  const resolvedMilestone = nonEmptyStringOrFallback(rawEvent.milestone, resolveMilestoneFromState(state));
  const graphLabel = normalizeGraphLabel(resolvedGraph);

  const semantic = classifySemanticEvent({
    ...rawEvent,
    event: eventType,
    graph: resolvedGraph,
    node: resolvedNode,
  });

  const semanticTargets = normalizeSemanticTargets(semantic.semantic_targets);
  const semanticTarget = normalizeInsightTarget(rawEvent.semantic_target || rawEvent.semanticTarget)
    || semanticTargets[0]
    || (allowFallback ? FACTORY_INSIGHT_UNKNOWN : "");

  const goalId = nonEmptyStringOrFallback(
    rawEvent.goalId || rawEvent.goal_id,
    resolvedMilestone || resolvedIssue || context.goal_issue_number,
  ) || (allowFallback ? FACTORY_INSIGHT_UNKNOWN : "");

  const runId = resolvedRunId || (allowFallback ? FACTORY_INSIGHT_UNKNOWN : "");
  const graphId = nonEmptyStringOrFallback(rawEvent.graphId || rawEvent.graph_id, graphLabel) || (allowFallback ? FACTORY_INSIGHT_UNKNOWN : "");
  const nodeName = nonEmptyStringOrFallback(rawEvent.nodeName || rawEvent.node_name, resolvedNode) || (allowFallback ? FACTORY_INSIGHT_UNKNOWN : "");

  const normalized = {
    schemaVersion: FACTORY_INSIGHT_SCHEMA_VERSION,
    event: eventType,
    eventName: canonicalEventName(eventType),
    telemetryEventKind: TELEMETRY_EVENT_KIND_BY_TYPE[eventType] || "",
    runId,
    goalId,
    graphId,
    nodeName,
    semanticFamily: semantic.semantic_family || (allowFallback ? FACTORY_INSIGHT_UNKNOWN : ""),
    semanticTarget,
    semanticTargets,
    status: normalizeStatus({ eventType, status: rawEvent.status }),
    timestamp: normalizeIsoTimestamp(rawEvent.ts || rawEvent.timestamp),
    attempt: normalizeAttempt(rawEvent, state),
    payload: normalizePayload(rawEvent, state),

    // Back-compat fields used by existing command formatters/tests.
    graph: resolvedGraph,
    graph_label: graphLabel,
    node: resolvedNode,
    prevNode: trim(rawEvent.prevNode || rawEvent.prev_node),
    issue: resolvedIssue,
    milestone: resolvedMilestone,
    artifactUrl: trim(rawEvent.artifactUrl || rawEvent.artifact_url),
    mergeStatus: trim(rawEvent.mergeStatus || rawEvent.merge_status),
    deliveryDecision: nonEmptyStringOrFallback(rawEvent.delivery_decision, context.delivery_decision),
    shouldGenerateReport: nonEmptyStringOrFallback(rawEvent.should_generate_report, context.should_generate_report),
    shouldPostToSlack: nonEmptyStringOrFallback(rawEvent.should_post_to_slack, context.should_post_to_slack),
    worthinessScore: nonEmptyStringOrFallback(rawEvent.worthiness_score, context.worthiness_score),
    releaseReportIssueDelivery: nonEmptyStringOrFallback(rawEvent.release_report_issue_delivery, context.release_report_issue_delivery),
    releaseSlackDelivery: nonEmptyStringOrFallback(rawEvent.release_slack_delivery, context.release_slack_delivery),
    ts: normalizeIsoTimestamp(rawEvent.ts || rawEvent.timestamp),

    semantic_family: semantic.semantic_family,
    semantic_target: semanticTarget,
    semantic_targets: semanticTargets,
  };

  const payloadWithKnownExtras = {
    ...normalized.payload,
    ...(normalized.deliveryDecision ? { delivery_decision: normalized.deliveryDecision } : {}),
    ...(normalized.shouldGenerateReport ? { should_generate_report: normalized.shouldGenerateReport } : {}),
    ...(normalized.shouldPostToSlack ? { should_post_to_slack: normalized.shouldPostToSlack } : {}),
    ...(normalized.worthinessScore ? { worthiness_score: normalized.worthinessScore } : {}),
    ...(normalized.releaseReportIssueDelivery ? { release_report_issue_delivery: normalized.releaseReportIssueDelivery } : {}),
    ...(normalized.releaseSlackDelivery ? { release_slack_delivery: normalized.releaseSlackDelivery } : {}),
  };

  return {
    ...normalized,
    payload: payloadWithKnownExtras,
  };
}

function isMissingRequiredValue(key, value) {
  if (key === "payload") {
    return !value || typeof value !== "object" || Array.isArray(value);
  }
  if (typeof value === "string") return trim(value).length === 0;
  if (typeof value === "number") return !Number.isFinite(value);
  return value == null;
}

export function listMissingRequiredFields(record = {}, { requiredFields = REQUIRED_FIELDS } = {}) {
  const normalized = asObject(record);
  return requiredFields.filter((key) => isMissingRequiredValue(key, normalized[key]));
}

export function assertRequiredFields(record = {}, { requiredFields = REQUIRED_FIELDS } = {}) {
  const missing = listMissingRequiredFields(record, { requiredFields });
  if (missing.length === 0) return record;
  throw new Error(`factory insight contract violation: missing required field(s): ${missing.join(", ")}`);
}

export function normalizeLifecycleEvent(rawEvent = {}, { state = {}, allowFallback = true } = {}) {
  const eventType = resolveInsightEventType(rawEvent.event || rawEvent.eventName || rawEvent.type)
    || (allowFallback ? "node-change" : "");

  const normalized = buildNormalizedEvent(rawEvent, {
    state,
    eventType,
    allowFallback,
  });

  return assertRequiredFields(normalized);
}

export function normalizeOutcomeEvent(rawOutcome = {}, { state = {}, allowFallback = true } = {}) {
  const normalized = normalizeLifecycleEvent(rawOutcome, { state, allowFallback });
  const out = {
    ...normalized,
    payload: {
      ...normalized.payload,
      outcome_event: "true",
    },
  };

  return assertRequiredFields(out);
}
