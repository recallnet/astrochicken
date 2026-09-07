const MANAGED_OBSERVABILITY_BOUNDARY_ERROR_CODE = "managed_observability_boundary_violation";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeKeySet(value, fallback = []) {
  const raw = value instanceof Set ? [...value] : Array.isArray(value) ? value : fallback;
  return new Set(raw
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean));
}

function pathHasAllowedDescendant(path, allowedKeys) {
  const dotPrefix = `${path}.`;
  const arrayPrefix = `${path}[]`;
  for (const candidate of allowedKeys) {
    if (candidate.startsWith(dotPrefix) || candidate.startsWith(arrayPrefix)) {
      return true;
    }
  }
  return false;
}

function pathAllowedOrContainer(path, allowedKeys) {
  if (allowedKeys.has(path)) {
    return true;
  }
  return pathHasAllowedDescendant(path, allowedKeys);
}

function lastPathSegment(path = "") {
  const normalized = String(path || "");
  if (!normalized) return "";
  const pieces = normalized.split(".");
  const last = pieces[pieces.length - 1] || "";
  return last.endsWith("[]") ? last.slice(0, -2) : last;
}

function pathIsForbidden(path, forbiddenKeys) {
  return forbiddenKeys.has(path) || forbiddenKeys.has(lastPathSegment(path));
}

function sanitizeNode({ value, path, allowedKeys, forbiddenKeys, droppedPaths }) {
  if (Array.isArray(value)) {
    if (!pathAllowedOrContainer(path, allowedKeys)) {
      droppedPaths.push(path);
      return { keep: false, value: [] };
    }

    const nextPath = `${path}[]`;
    const sanitizedEntries = [];
    for (const entry of value) {
      const sanitized = sanitizeNode({
        value: entry,
        path: nextPath,
        allowedKeys,
        forbiddenKeys,
        droppedPaths,
      });
      if (sanitized.keep) {
        sanitizedEntries.push(sanitized.value);
      }
    }

    return {
      keep: true,
      value: sanitizedEntries,
    };
  }

  if (isPlainObject(value)) {
    const output = {};
    let keptAny = false;

    for (const [key, nestedValue] of Object.entries(value)) {
      const nextPath = path ? `${path}.${key}` : key;

      if (pathIsForbidden(nextPath, forbiddenKeys)) {
        droppedPaths.push(nextPath);
        continue;
      }

      if (!pathAllowedOrContainer(nextPath, allowedKeys)) {
        droppedPaths.push(nextPath);
        continue;
      }

      const sanitized = sanitizeNode({
        value: nestedValue,
        path: nextPath,
        allowedKeys,
        forbiddenKeys,
        droppedPaths,
      });

      if (!sanitized.keep) {
        continue;
      }

      output[key] = sanitized.value;
      keptAny = true;
    }

    if (!path) {
      return { keep: true, value: output };
    }

    return {
      keep: keptAny || allowedKeys.has(path),
      value: output,
    };
  }

  if (pathIsForbidden(path, forbiddenKeys)) {
    droppedPaths.push(path);
    return { keep: false, value: undefined };
  }

  if (!pathAllowedOrContainer(path, allowedKeys)) {
    droppedPaths.push(path);
    return { keep: false, value: undefined };
  }

  return { keep: true, value };
}

function collectViolations({ value, path = "", allowedKeys, forbiddenKeys, violations }) {
  if (Array.isArray(value)) {
    const nextPath = path ? `${path}[]` : "[]";

    if (path && !pathAllowedOrContainer(path, allowedKeys)) {
      violations.push(`disallowed_key path=${path}`);
      return;
    }

    if (nextPath !== "[]" && !pathAllowedOrContainer(nextPath, allowedKeys)) {
      violations.push(`disallowed_key path=${nextPath}`);
      return;
    }

    for (const entry of value) {
      collectViolations({
        value: entry,
        path: nextPath,
        allowedKeys,
        forbiddenKeys,
        violations,
      });
    }
    return;
  }

  if (!isPlainObject(value)) {
    if (path && !pathAllowedOrContainer(path, allowedKeys)) {
      violations.push(`disallowed_key path=${path}`);
    }
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key;

    if (pathIsForbidden(nextPath, forbiddenKeys)) {
      violations.push(`forbidden_key path=${nextPath}`);
      continue;
    }

    if (!pathAllowedOrContainer(nextPath, allowedKeys)) {
      violations.push(`disallowed_key path=${nextPath}`);
      continue;
    }

    collectViolations({
      value: nestedValue,
      path: nextPath,
      allowedKeys,
      forbiddenKeys,
      violations,
    });
  }
}

export const ALLOWED_MIRRORED_KEYS = Object.freeze(new Set([
  "schema_version",
  "factory_id",
  "instance_id",
  "kind_id",
  "context.target_repo",
  "context.control_plane_repo",
  "context.trust_domain",
  "context.trust_role",
  "lifecycle.state",
  "lifecycle.health_state",
  "lifecycle.control_gate",
  "lifecycle.control_state_action",
  "lifecycle.control_state_reason",
  "blockers.upstream.has_open_upstream_bugs",
  "blockers.upstream.open_upstream_bug_count",
  "blockers.upstream.open_upstream_bug_numbers",
  "blockers.upstream.open_upstream_bug_numbers[]",
  "blockers.action_items.has_action_items",
  "blockers.action_items.action_item_count",
  "intake.has_issue",
  "intake.selected_issue_number",
  "manifest.ok",
  "manifest.error",
  "failure.classification",
  "failure.reason",
  "failure.parse_error",
  "managed_snapshot.schema_version",
  "managed_snapshot.lifecycle_state",
  "managed_snapshot.lifecycle_reason",
  "managed_snapshot.lifecycle_failure_classification",
  "managed_snapshot.lifecycle_failure_reason",
  "managed_snapshot.lifecycle_updated_at",
  "managed_snapshot.lifecycle_updated_by",
  "managed_snapshot.blockers.upstream.has_open_upstream_bugs",
  "managed_snapshot.blockers.upstream.open_upstream_bug_count",
  "managed_snapshot.blockers.upstream.open_upstream_bug_numbers",
  "managed_snapshot.blockers.upstream.open_upstream_bug_numbers[]",
  "managed_snapshot.blockers.action_items.has_action_items",
  "managed_snapshot.blockers.action_items.action_item_count",
  "managed_snapshot.unresolved_actions",
  "managed_snapshot.queue_depth",
  "managed_snapshot.oldest_work_age_seconds",
  "managed_snapshot.latest_incidents",
  "managed_snapshot.latest_incidents[]",
  "managed_snapshot.latest_incidents[].incident_fingerprint",
  "managed_snapshot.latest_incidents[].severity",
  "telemetry.lifecycle_state",
  "telemetry.failure_classification",
]));

export const FORBIDDEN_HOST_LOCAL_KEYS = Object.freeze(new Set([
  "domain_result",
  "session_traces",
  "telemetry.event_name",
  "artifact_url",
  "artifact_urls",
  "raw_trace",
  "raw_traces",
]));

export {
  MANAGED_OBSERVABILITY_BOUNDARY_ERROR_CODE,
};

export function sanitizeMirroredPayload(payload, {
  allowedKeys = ALLOWED_MIRRORED_KEYS,
  forbiddenKeys = FORBIDDEN_HOST_LOCAL_KEYS,
} = {}) {
  const normalizedAllowedKeys = normalizeKeySet(allowedKeys, [...ALLOWED_MIRRORED_KEYS]);
  const normalizedForbiddenKeys = normalizeKeySet(forbiddenKeys, [...FORBIDDEN_HOST_LOCAL_KEYS]);
  const source = isPlainObject(payload) ? payload : {};
  const droppedPaths = [];

  const sanitized = sanitizeNode({
    value: source,
    path: "",
    allowedKeys: normalizedAllowedKeys,
    forbiddenKeys: normalizedForbiddenKeys,
    droppedPaths,
  }).value;

  return {
    sanitizedPayload: sanitized,
    droppedKeys: [...new Set(droppedPaths)].sort((left, right) => left.localeCompare(right, "en")),
  };
}

export function assertPayloadWithinBoundary(payload, {
  allowedKeys = ALLOWED_MIRRORED_KEYS,
  forbiddenKeys = FORBIDDEN_HOST_LOCAL_KEYS,
} = {}) {
  const normalizedAllowedKeys = normalizeKeySet(allowedKeys, [...ALLOWED_MIRRORED_KEYS]);
  const normalizedForbiddenKeys = normalizeKeySet(forbiddenKeys, [...FORBIDDEN_HOST_LOCAL_KEYS]);

  if (!isPlainObject(payload)) {
    const error = new Error("Payload must be a JSON object");
    error.code = MANAGED_OBSERVABILITY_BOUNDARY_ERROR_CODE;
    error.violations = ["invalid_payload type=non_object"];
    throw error;
  }

  const violations = [];
  collectViolations({
    value: payload,
    path: "",
    allowedKeys: normalizedAllowedKeys,
    forbiddenKeys: normalizedForbiddenKeys,
    violations,
  });

  const sortedViolations = [...new Set(violations)].sort((left, right) => left.localeCompare(right, "en"));
  if (sortedViolations.length > 0) {
    const error = new Error(`Managed observability boundary violation count=${sortedViolations.length}`);
    error.code = MANAGED_OBSERVABILITY_BOUNDARY_ERROR_CODE;
    error.violations = sortedViolations;
    throw error;
  }

  return {
    ok: true,
    code: "ok",
    violations: [],
  };
}
