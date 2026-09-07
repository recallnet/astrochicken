import { trim } from "../lib/cli-helpers.ts";

const MANAGED_SNAPSHOT_SCHEMA = "managed-factory-snapshot/v1";

function parseJsonSafe(raw = "", fallback = {}) {
  try {
    const parsed = JSON.parse(String(raw || "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    return fallback;
  } catch {
    return fallback;
  }
}

function parseNumbers(raw = "") {
  const text = trim(raw);
  if (!text) return [];

  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed
          .map((value) => Number.parseInt(String(value ?? "").trim(), 10))
          .filter((value) => Number.isFinite(value) && value > 0);
      }
    } catch {
      // fall through to csv parsing
    }
  }

  return text
    .split(",")
    .map((value) => Number.parseInt(String(value ?? "").trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function truthy(value = "") {
  return trim(value) === "true";
}

function parseNonNegativeInt(value = 0, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parseIncidents(raw = "") {
  const text = trim(raw);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const incidentFingerprint = trim(entry.incident_fingerprint);
        const severity = trim(entry.severity);
        if (!incidentFingerprint || !severity) return null;
        return {
          incident_fingerprint: incidentFingerprint,
          severity,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function buildManagedSnapshotV1({
  lifecycleState = "idle",
  failureReason = "",
  failureClassification = "none",
  hasOpenUpstreamBugs = "false",
  openUpstreamBugCount = "0",
  openUpstreamBugNumbers = "[]",
  hasActionItems = "false",
  actionItemCount = "0",
  unresolvedActions = "",
  queueDepth = "0",
  oldestWorkAgeSeconds = "0",
  latestIncidents = "[]",
} = {}) {
  const normalizedActionItemCount = parseNonNegativeInt(actionItemCount, 0);
  return {
    schema_version: MANAGED_SNAPSHOT_SCHEMA,
    lifecycle_state: trim(lifecycleState) || "idle",
    lifecycle_reason: trim(failureReason),
    lifecycle_failure_classification: trim(failureClassification) || "none",
    lifecycle_failure_reason: trim(failureReason),
    lifecycle_updated_at: "",
    lifecycle_updated_by: "",
    blockers: {
      upstream: {
        has_open_upstream_bugs: truthy(hasOpenUpstreamBugs),
        open_upstream_bug_count: parseNonNegativeInt(openUpstreamBugCount, 0),
        open_upstream_bug_numbers: parseNumbers(openUpstreamBugNumbers),
      },
      action_items: {
        has_action_items: truthy(hasActionItems),
        action_item_count: normalizedActionItemCount,
      },
    },
    unresolved_actions: trim(unresolvedActions)
      ? parseNonNegativeInt(unresolvedActions, normalizedActionItemCount)
      : normalizedActionItemCount,
    queue_depth: parseNonNegativeInt(queueDepth, 0),
    oldest_work_age_seconds: parseNonNegativeInt(oldestWorkAgeSeconds, 0),
    latest_incidents: parseIncidents(latestIncidents),
  };
}

export function buildManagedRunSummary({
  factoryId = "",
  instanceId = "",
  kindId = "",
  targetRepo = "",
  controlPlaneRepo = "",
  trustDomain = "",
  trustRole = "",
  lifecycleState = "idle",
  healthState = "idle",
  failureClassification = "none",
  failureReason = "",
  controlGate = "run",
  controlStateAction = "none",
  controlStateReason = "",
  hasOpenUpstreamBugs = "false",
  openUpstreamBugCount = "0",
  openUpstreamBugNumbers = "[]",
  hasActionItems = "false",
  actionItemCount = "0",
  unresolvedActions = "",
  queueDepth = "0",
  oldestWorkAgeSeconds = "0",
  latestIncidents = "[]",
  hasIssue = "false",
  selectedIssueNumber = "",
  domainResult = "",
  manifestOk = "true",
  manifestError = "",
  parseError = "",
} = {}) {
  const parsedDomainResult = parseJsonSafe(domainResult, {});
  const selectedIssue = Number.parseInt(trim(selectedIssueNumber), 10);

  const snapshot = buildManagedSnapshotV1({
    lifecycleState,
    failureReason,
    failureClassification,
    hasOpenUpstreamBugs,
    openUpstreamBugCount,
    openUpstreamBugNumbers,
    hasActionItems,
    actionItemCount,
    unresolvedActions,
    queueDepth,
    oldestWorkAgeSeconds,
    latestIncidents,
  });

  const summary = {
    schema_version: "managed_supervisor_run_summary/v1",
    factory_id: trim(factoryId),
    instance_id: trim(instanceId),
    kind_id: trim(kindId),
    context: {
      target_repo: trim(targetRepo),
      control_plane_repo: trim(controlPlaneRepo),
      trust_domain: trim(trustDomain),
      trust_role: trim(trustRole),
    },
    lifecycle: {
      state: trim(lifecycleState) || "idle",
      health_state: trim(healthState) || "idle",
      control_gate: trim(controlGate) || "run",
      control_state_action: trim(controlStateAction) || "none",
      control_state_reason: trim(controlStateReason),
    },
    blockers: snapshot.blockers,
    intake: {
      has_issue: truthy(hasIssue),
      selected_issue_number: Number.isFinite(selectedIssue) && selectedIssue > 0 ? selectedIssue : null,
    },
    manifest: {
      ok: trim(manifestOk) === "true",
      error: trim(manifestError),
    },
    failure: {
      classification: trim(failureClassification) || "none",
      reason: trim(failureReason),
      parse_error: trim(parseError),
    },
    domain_result: parsedDomainResult,
    managed_snapshot: snapshot,
    telemetry: {
      event_name: "factory.managed_supervisor.run_summary",
      lifecycle_state: trim(lifecycleState) || "idle",
      failure_classification: trim(failureClassification) || "none",
    },
  };

  return summary;
}
