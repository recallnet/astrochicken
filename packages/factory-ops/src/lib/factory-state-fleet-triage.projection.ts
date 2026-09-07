function trim(value = "") {
  return String(value ?? "").trim();
}

function asObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return null;
}

function toEpochMs(value = "") {
  const parsed = Date.parse(trim(value));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function toIso(value = "") {
  const parsed = toEpochMs(value);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toISOString();
}

function nonNegative(value = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function normalizeQueueType(raw = "") {
  const normalized = trim(raw).toLowerCase();
  if (!normalized) return "platform_incident";
  if (normalized === "platform" || normalized === "platform_incident") return "platform_incident";
  if (normalized === "local" || normalized === "local_incident") return "local_incident";
  if (normalized === "blocked" || normalized === "blocked_instance") return "blocked_instance";
  return normalized;
}

function uniqueSorted(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((entry) => trim(entry)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function resolveIncidentContext(context = {}) {
  const incident = asObject(context?.incident);
  if (incident) return incident;

  const triage = asObject(context?.triage);
  if (!triage) return null;
  return asObject(triage?.incident) || triage;
}

function resolveAffectedInstances({ incident = {}, context = {}, fallbackFactoryId = "" } = {}) {
  const explicitList = Array.isArray(incident?.affected_instances) ? incident.affected_instances : [];
  const fromList = explicitList
    .map((entry) => {
      if (typeof entry === "string") return trim(entry);
      if (entry && typeof entry === "object") {
        return trim(entry.instance_id || entry.affected_instance_id || entry.factory_id);
      }
      return "";
    })
    .filter(Boolean);

  const singleton = trim(
    incident?.affected_instance_id
    || incident?.instance_id
    || context?.affected_instance_id
    || context?.instance_id
    || context?.factory_id
    || fallbackFactoryId,
  );

  return uniqueSorted([...fromList, singleton]);
}

function resolveTimestampCandidate(run = {}) {
  return trim(
    run?.state?.updatedAt
    || run?.state?.startedAt
    || run?.state?.createdAt,
  );
}

function normalizeRunCandidate(run = {}, { nowEpochMs = Date.now() } = {}) {
  const context = asObject(run?.state?.context) || {};
  const incident = resolveIncidentContext(context);
  if (!incident) {
    return { ok: false, reason: "missing_incident_context" };
  }

  const fingerprint = trim(
    incident?.fingerprint
    || incident?.incident_fingerprint
    || context?.incident_fingerprint,
  );
  if (!fingerprint) {
    return {
      ok: false,
      reason: "missing_fingerprint",
      run_id: trim(run?.runId),
    };
  }

  const updatedAt = resolveTimestampCandidate(run);
  const blockedSince = toIso(
    incident?.blocked_since
    || incident?.blockedSince
    || context?.blocked_since
    || context?.blockedSince
    || updatedAt,
  );

  const blockedSinceEpoch = toEpochMs(blockedSince);
  const backlogAge = Number.isFinite(blockedSinceEpoch)
    ? nonNegative(Math.floor((nowEpochMs - blockedSinceEpoch) / 1000))
    : 0;

  return {
    ok: true,
    fingerprint,
    queue_type: normalizeQueueType(incident?.queue_type || incident?.queueType || context?.queue_type),
    support_owner: trim(incident?.support_owner || incident?.supportOwner || context?.support_owner) || "unknown",
    service_tier: trim(incident?.service_tier || incident?.serviceTier || context?.service_tier) || "unknown",
    affected_instances: resolveAffectedInstances({
      incident,
      context,
      fallbackFactoryId: trim(run?.state?.context?.factory_id),
    }),
    blocked_since: blockedSince || null,
    backlog_age: backlogAge,
  };
}

function queueTypeTotals(rows = []) {
  const totals = {};
  for (const row of rows) {
    const queueType = trim(row?.queue_type) || "unknown";
    totals[queueType] = nonNegative(totals[queueType]) + 1;
  }
  return totals;
}

function buildEmptyProjection({ nowEpochMs = Date.now(), warnings = [], ok = true, errorCode = "" } = {}) {
  return {
    ok,
    error_code: trim(errorCode) || null,
    schema_version: "fleet_triage_incidents.v1",
    generated_at: new Date(nowEpochMs).toISOString(),
    queue: [],
    totals: {
      queue_items: 0,
      fingerprints: 0,
      affected_instances: 0,
      by_queue_type: {},
    },
    warnings: uniqueSorted(warnings),
  };
}

export function projectFleetIncidents(runs = [], opts = {}) {
  const nowEpochMs = Number.isFinite(Number(opts?.now)) ? Number(opts.now) : Date.now();
  const lookbackHours = nonNegative(opts?.lookbackHours ?? opts?.lookback_hours ?? 24);
  const lookbackWindowMs = lookbackHours > 0 ? lookbackHours * 3600 * 1000 : 0;

  const warnings = [];
  const byFingerprint = new Map();

  for (const run of Array.isArray(runs) ? runs : []) {
    const runUpdatedAt = resolveTimestampCandidate(run);
    const runUpdatedAtEpoch = toEpochMs(runUpdatedAt);
    if (lookbackWindowMs > 0 && Number.isFinite(runUpdatedAtEpoch)) {
      const isOutsideWindow = runUpdatedAtEpoch < (nowEpochMs - lookbackWindowMs);
      if (isOutsideWindow) continue;
    }

    const normalized = normalizeRunCandidate(run, { nowEpochMs });
    if (!normalized.ok) {
      if (normalized.reason === "missing_fingerprint") {
        warnings.push(`missing_fingerprint:${trim(normalized.run_id) || "unknown"}`);
      }
      continue;
    }

    const current = byFingerprint.get(normalized.fingerprint) || {
      fingerprint: normalized.fingerprint,
      queue_type: normalized.queue_type,
      support_owner: normalized.support_owner,
      service_tier: normalized.service_tier,
      affected_instances: [],
      blocked_since: normalized.blocked_since,
      backlog_age: normalized.backlog_age,
      hit_count: 0,
    };

    const nextBlockedSince = (() => {
      const currentEpoch = toEpochMs(current.blocked_since || "");
      const candidateEpoch = toEpochMs(normalized.blocked_since || "");
      if (!Number.isFinite(currentEpoch)) return normalized.blocked_since || current.blocked_since;
      if (!Number.isFinite(candidateEpoch)) return current.blocked_since;
      return candidateEpoch < currentEpoch ? normalized.blocked_since : current.blocked_since;
    })();

    const supportOwner = current.support_owner === normalized.support_owner
      ? current.support_owner
      : "mixed";

    const serviceTier = current.service_tier === normalized.service_tier
      ? current.service_tier
      : "mixed";

    const queueType = current.queue_type === normalized.queue_type
      ? current.queue_type
      : "platform_incident";

    const mergedAffected = uniqueSorted([
      ...current.affected_instances,
      ...normalized.affected_instances,
    ]);

    byFingerprint.set(normalized.fingerprint, {
      ...current,
      queue_type: queueType,
      support_owner: supportOwner,
      service_tier: serviceTier,
      affected_instances: mergedAffected,
      blocked_since: nextBlockedSince,
      backlog_age: nonNegative(Math.floor((nowEpochMs - toEpochMs(nextBlockedSince || "")) / 1000)),
      hit_count: current.hit_count + 1,
    });
  }

  const queue = [...byFingerprint.values()]
    .sort((left, right) => {
      if (right.backlog_age !== left.backlog_age) return right.backlog_age - left.backlog_age;
      return left.fingerprint.localeCompare(right.fingerprint);
    });

  const affectedInstances = uniqueSorted(queue.flatMap((item) => item.affected_instances));

  return {
    ok: true,
    error_code: null,
    schema_version: "fleet_triage_incidents.v1",
    generated_at: new Date(nowEpochMs).toISOString(),
    queue,
    totals: {
      queue_items: queue.length,
      fingerprints: queue.length,
      affected_instances: affectedInstances.length,
      by_queue_type: queueTypeTotals(queue),
    },
    warnings: uniqueSorted(warnings),
  };
}

export function emptyFleetIncidentProjection(opts = {}) {
  return buildEmptyProjection(opts);
}
