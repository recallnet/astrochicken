import { persistCanonicalFactoryLifecycleSnapshotSync } from "../lib/canonical-control-state.ts";
import { trim } from "../lib/cli-helpers.ts";
import { writeManagedSnapshotMirror } from "../lib/mirror-managed-snapshot.ts";

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

function parseIncidentList(raw = "") {
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

function asBoolString(value = "") {
  return trim(value) === "true";
}

function parseNonNegativeInt(value = 0) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

const ALLOWED_LIFECYCLE_STATES = new Set([
  "active",
  "idle",
  "blocked_platform",
  "blocked_local",
  "degraded",
  "paused",
  "draining",
]);

function errorPayload(error, fallbackCode = "persist_lifecycle_state_failed") {
  const code = trim(error?.code) || fallbackCode;
  const message = trim(error?.message) || code;
  return {
    ok: false,
    error: code,
    message,
  };
}

export function persistManagedLifecycleState({
  factoryId = "",
  instanceId = "",
  rootDir = process.cwd(),
  lifecycleState = "",
  lifecycleReason = "",
  failureClassification = "",
  failureReason = "",
  hasOpenUpstreamBugs = "false",
  openUpstreamBugCount = "0",
  openUpstreamBugNumbers = "[]",
  hasActionItems = "false",
  actionItemCount = "0",
  unresolvedActions = "",
  queueDepth = "0",
  oldestWorkAgeSeconds = "0",
  latestIncidents = "[]",
  actor = "managed_supervisor",
  writeLifecycleProjectionFn = persistCanonicalFactoryLifecycleSnapshotSync,
  writeManagedSnapshotMirrorFn = writeManagedSnapshotMirror,
} = {}) {
  const normalizedFactoryId = trim(factoryId);
  if (!normalizedFactoryId) {
    return {
      ok: false,
      error: "missing_factory_id",
      message: "factory-id is required",
    };
  }

  const normalizedLifecycleState = trim(lifecycleState);
  if (!normalizedLifecycleState) {
    return {
      ok: false,
      error: "missing_lifecycle_state",
      message: "lifecycle-state is required",
    };
  }

  if (!ALLOWED_LIFECYCLE_STATES.has(normalizedLifecycleState)) {
    return {
      ok: false,
      error: "invalid_lifecycle_state",
      message: `unsupported lifecycle-state: ${normalizedLifecycleState}`,
    };
  }

  try {
    const normalizedActionItemCount = parseNonNegativeInt(actionItemCount);
    const normalizedUnresolvedActions = trim(unresolvedActions)
      ? parseNonNegativeInt(unresolvedActions)
      : normalizedActionItemCount;

    const lifecycleStateSnapshot = {
      schema_version: "managed-factory-snapshot/v1",
      lifecycle_state: normalizedLifecycleState,
      lifecycle_reason: trim(lifecycleReason),
      lifecycle_failure_classification: trim(failureClassification),
      lifecycle_failure_reason: trim(failureReason),
      lifecycle_updated_at: new Date().toISOString(),
      lifecycle_updated_by: actor,
      blockers: {
        upstream: {
          has_open_upstream_bugs: asBoolString(hasOpenUpstreamBugs),
          open_upstream_bug_count: parseNonNegativeInt(openUpstreamBugCount),
          open_upstream_bug_numbers: parseNumbers(openUpstreamBugNumbers),
        },
        action_items: {
          has_action_items: asBoolString(hasActionItems),
          action_item_count: normalizedActionItemCount,
        },
      },
      unresolved_actions: normalizedUnresolvedActions,
      queue_depth: parseNonNegativeInt(queueDepth),
      oldest_work_age_seconds: parseNonNegativeInt(oldestWorkAgeSeconds),
      latest_incidents: parseIncidentList(latestIncidents),
    };

    const persisted = writeLifecycleProjectionFn({
      factoryId: normalizedFactoryId,
      rootDir,
      actor,
      lifecycleState: normalizedLifecycleState,
      lifecycleStateSnapshot,
    });

    const snapshot = persisted?.lifecycle_state_snapshot && typeof persisted.lifecycle_state_snapshot === "object"
      ? persisted.lifecycle_state_snapshot
      : {};
    const normalizedStateVersion = parseNonNegativeInt(persisted?.version);
    const normalizedInstanceId = trim(instanceId);

    let mirrorPath = "";
    let mirrorVersion = 0;
    let mirrorUpdatedAt = "";
    let mirrorError = "";

    if (!normalizedInstanceId) {
      mirrorError = "missing_instance_id";
    } else {
      try {
        const mirrored = writeManagedSnapshotMirrorFn({
          factoryId: normalizedFactoryId,
          instanceId: normalizedInstanceId,
          rootDir,
          snapshot: {
            ...snapshot,
            state_version: normalizedStateVersion,
            action_item_count: parseNonNegativeInt(snapshot?.blockers?.action_items?.action_item_count),
          },
        });

        mirrorPath = trim(mirrored?.mirror_path || "");
        mirrorVersion = parseNonNegativeInt(mirrored?.mirror_version);
        mirrorUpdatedAt = trim(mirrored?.mirror_updated_at || "");
      } catch (error) {
        mirrorError = trim(error?.code) || trim(error?.message) || "managed_snapshot_mirror_write_failed";
      }
    }

    return {
      ok: true,
      factory_id: normalizedFactoryId,
      instance_id: normalizedInstanceId,
      state_path: trim(persisted?.state_path || ""),
      state_version: normalizedStateVersion,
      mirror_path: mirrorPath,
      mirror_version: mirrorVersion,
      mirror_updated_at: mirrorUpdatedAt,
      mirror_error: mirrorError,
      lifecycle_state: trim(snapshot.lifecycle_state || normalizedLifecycleState),
      lifecycle_reason: trim(snapshot.lifecycle_reason || ""),
      lifecycle_failure_classification: trim(snapshot.lifecycle_failure_classification || ""),
      lifecycle_failure_reason: trim(snapshot.lifecycle_failure_reason || ""),
      lifecycle_updated_at: trim(snapshot.lifecycle_updated_at || ""),
      blockers: snapshot?.blockers && typeof snapshot.blockers === "object"
        ? snapshot.blockers
        : {
          upstream: {
            has_open_upstream_bugs: false,
            open_upstream_bug_count: 0,
            open_upstream_bug_numbers: [],
          },
          action_items: {
            has_action_items: false,
            action_item_count: 0,
          },
        },
      unresolved_actions: parseNonNegativeInt(snapshot?.unresolved_actions),
      queue_depth: parseNonNegativeInt(snapshot?.queue_depth),
      oldest_work_age_seconds: parseNonNegativeInt(snapshot?.oldest_work_age_seconds),
      latest_incidents: Array.isArray(snapshot?.latest_incidents) ? snapshot.latest_incidents : [],
    };
  } catch (error) {
    return errorPayload(error);
  }
}
