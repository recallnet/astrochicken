import { readMirroredSnapshot, readRecentEvents } from "./factory-mirror-reader.ts";
import { loadFactoryRegistry } from "./factory-registry.ts";

async function defaultReadFactoryRegistry({ registryPath = "factory-registry.json", cwd = process.cwd() } = {}) {
  try {
    const loaded = loadFactoryRegistry({ registryPath, cwd });
    const factories = Array.isArray(loaded?.registry?.instances)
      ? loaded.registry.instances.map((row) => ({
        factory_id: trim(row?.instance_id),
        target_repo: trim(row?.target_repo),
        daemon_status: row?.daemon_status && typeof row.daemon_status === "object"
          ? row.daemon_status
          : (row?.daemonStatus && typeof row.daemonStatus === "object" ? row.daemonStatus : {}),
        graphs: Array.isArray(row?.graphs) ? row.graphs : [],
      }))
      : [];

    return {
      ok: true,
      reason: "ok",
      registry_path: trim(loaded?.registryPath || registryPath),
      factories,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "registry_unavailable",
      registry_path: trim(registryPath),
      factories: [],
      error: trim(error?.message || error),
    };
  }
}

async function defaultFactoryFleetStatus({ registryPath = "factory-registry.json", now = Date.now() } = {}) {
  const registry = await defaultReadFactoryRegistry({ registryPath, cwd: process.cwd() });
  const factories = Array.isArray(registry?.factories)
    ? registry.factories.map((row) => ({
      factory_id: trim(row?.factory_id),
      target_repo: trim(row?.target_repo),
      target_repo: trim(row?.target_repo || row?.target_repo),
      release_state: "unknown",
      blocked_reason: "",
      control_plane_blocker: "",
    }))
    : [];

  return {
    generated_at: toIsoTimestamp(now),
    factories,
  };
}

async function defaultFactoryReleaseTargetingStatus() {
  return {
    generated_at: toIsoTimestamp(Date.now()),
    factories: [],
  };
}

async function defaultHostRuntimeStatus() {
  return null;
}

const TRIAGE_SCHEMA_VERSION = "fleet_triage_queues.v1";
const QUEUE_KEYS = Object.freeze([
  "platform_incidents",
  "local_instance_incidents",
  "blocked_instances",
  "repeated_failure_risk",
  "upgrade_drift",
  "host_capacity_pressure",
]);
const HOST_SIGNAL_STALE_SECONDS = 300;

const SEVERITY_WEIGHT = Object.freeze({
  critical: 50,
  error: 45,
  high: 40,
  medium: 30,
  warn: 20,
  warning: 20,
  low: 10,
  info: 5,
});

const SERVICE_TIER_WEIGHT = Object.freeze({
  mission_critical: 40,
  critical: 35,
  premium: 30,
  enterprise: 25,
  standard: 10,
  development: 5,
});

function trim(value = "") {
  return String(value ?? "").trim();
}

function toIsoTimestamp(value = Date.now()) {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? numeric : Date.now();
  return new Date(safe).toISOString();
}

function parseEpochMs(value = "") {
  const parsed = Date.parse(trim(value));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function nonNegative(value = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function uniqueSorted(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((entry) => trim(entry)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function severityToWeight(value = "") {
  return SEVERITY_WEIGHT[trim(value).toLowerCase()] || 0;
}

function tierToWeight(value = "") {
  return SERVICE_TIER_WEIGHT[trim(value).toLowerCase()] || 0;
}

function initializeProjectionMetadata() {
  const metadata = {};
  for (const queueKey of QUEUE_KEYS) {
    metadata[queueKey] = {
      degraded: false,
      warnings: [],
      deprecation: null,
    };
  }
  return metadata;
}

function appendQueueWarning(metadata = {}, queueKey = "", warning = "") {
  const normalizedKey = trim(queueKey);
  if (!normalizedKey || !metadata[normalizedKey]) return;
  const normalizedWarning = trim(warning);
  if (!normalizedWarning) return;

  metadata[normalizedKey].degraded = true;
  if (!metadata[normalizedKey].warnings.includes(normalizedWarning)) {
    metadata[normalizedKey].warnings.push(normalizedWarning);
  }
  metadata[normalizedKey].deprecation = {
    status: "partial_data",
    warning_count: metadata[normalizedKey].warnings.length,
  };
}

function buildProfileLookups({ registryPath = "factory-registry.json", cwd = process.cwd(), loadFactoryRegistryFn = loadFactoryRegistry } = {}) {
  const byInstanceId = new Map();
  const byTargetRepo = new Map();
  const byFactoryId = new Map();

  try {
    const loaded = loadFactoryRegistryFn({ registryPath, cwd });
    for (const row of Array.isArray(loaded?.registry?.instances) ? loaded.registry.instances : []) {
      const instanceId = trim(row?.instance_id);
      const targetRepo = trim(row?.target_repo);
      const normalized = {
        instance_id: instanceId,
        factory_id: instanceId,
        kind_id: trim(row?.kind_id),
        target_repo: targetRepo,
        service_tier: trim(row?.service_tier) || "standard",
        support_owner: trim(row?.support_owner) || "ops",
      };

      if (instanceId) {
        byInstanceId.set(instanceId, normalized);
        byFactoryId.set(instanceId, normalized);
      }
      if (targetRepo) byTargetRepo.set(targetRepo, normalized);
    }

    return {
      byInstanceId,
      byTargetRepo,
      byFactoryId,
      warning: "",
    };
  } catch (error) {
    return {
      byInstanceId,
      byTargetRepo,
      byFactoryId,
      warning: `service_profile_unavailable:${trim(error?.message || error) || "unknown"}`,
    };
  }
}

function normalizeRegistryRows(registry = {}) {
  return Array.isArray(registry?.factories) ? registry.factories : [];
}

function normalizeFleetRows(fleetStatus = {}) {
  return Array.isArray(fleetStatus?.factories) ? fleetStatus.factories : [];
}

function resolveInstanceMeta({
  snapshot = {},
  fallbackFactoryId = "",
  registryRowsByFactory = new Map(),
  fleetRowsByFactory = new Map(),
  profiles = {},
} = {}) {
  const instanceId = trim(snapshot?.instance_id || fallbackFactoryId);
  const factoryId = trim(snapshot?.factory_id || fallbackFactoryId || instanceId);
  const registryRow = registryRowsByFactory.get(factoryId) || {};
  const fleetRow = fleetRowsByFactory.get(factoryId) || {};
  const profileByInstance = profiles.byInstanceId?.get(instanceId) || {};
  const targetRepoCandidate = trim(fleetRow?.target_repo || registryRow?.target_repo || snapshot?.target_repo || profileByInstance?.target_repo);
  const profileByRepo = profiles.byTargetRepo?.get(targetRepoCandidate) || {};
  const profileByFactory = profiles.byFactoryId?.get(factoryId) || {};

  const supportOwner = trim(
    profileByInstance?.support_owner
    || profileByFactory?.support_owner
    || profileByRepo?.support_owner,
  ) || "ops";

  const serviceTier = trim(
    profileByInstance?.service_tier
    || profileByFactory?.service_tier
    || profileByRepo?.service_tier,
  ) || "standard";

  const kindId = trim(
    profileByInstance?.kind_id
    || profileByFactory?.kind_id
    || profileByRepo?.kind_id,
  );

  return {
    instance_id: instanceId || factoryId || "unknown",
    factory_id: factoryId || instanceId || "unknown",
    target_repo: targetRepoCandidate || null,
    support_owner: supportOwner,
    service_tier: serviceTier,
    kind_id: kindId || null,
  };
}

function inferIncidentScope(snapshot = {}, affectedInstanceCount = 1) {
  const lifecycleState = trim(snapshot?.lifecycle_state).toLowerCase();
  const classification = trim(snapshot?.lifecycle_failure_classification).toLowerCase();
  if (lifecycleState.includes("blocked_platform") || lifecycleState.includes("platform")) return "platform";
  if (classification === "infrastructure" || classification === "platform") return "platform";
  if (affectedInstanceCount > 1) return "platform";
  return "local";
}

function ensureIncidentFingerprintOrThrow(incident = {}, context = {}) {
  const fingerprint = trim(incident?.incident_fingerprint);
  if (fingerprint) return fingerprint;
  const instanceId = trim(context?.instance_id) || "unknown";
  throw new Error(`[fleet-triage-projection] missing incident_fingerprint instance_id=${instanceId}`);
}

function computeDurationSeconds({ from = "", toEpochMs = Date.now() } = {}) {
  const fromEpochMs = parseEpochMs(from);
  if (!Number.isFinite(fromEpochMs)) return 0;
  const delta = Math.max(0, Number(toEpochMs) - fromEpochMs);
  return Math.floor(delta / 1000);
}

function isBlockedSnapshot(snapshot = {}) {
  const lifecycleState = trim(snapshot?.lifecycle_state).toLowerCase();
  const hasBlockedState = lifecycleState.startsWith("blocked") || lifecycleState.includes("waiting_for_release");
  const hasUpstreamBlockers = snapshot?.blockers?.upstream?.has_open_upstream_bugs === true;
  const hasActionItems = snapshot?.blockers?.action_items?.has_action_items === true;
  return hasBlockedState || hasUpstreamBlockers || hasActionItems;
}

function deriveBlockedSeverity(snapshot = {}) {
  const lifecycleState = trim(snapshot?.lifecycle_state).toLowerCase();
  if (lifecycleState.includes("platform")) return "high";
  if (lifecycleState.includes("local")) return "medium";
  return "warning";
}

function collectMirroredSignals({
  factoryIds = [],
  readMirroredSnapshotFn = readMirroredSnapshot,
  readRecentEventsFn = readRecentEvents,
  context = {},
  rootDir = process.cwd(),
  mirrorDir = "",
  eventLimit = 200,
  queueMetadata = {},
} = {}) {
  const snapshots = [];
  const events = [];

  for (const factoryId of factoryIds) {
    try {
      const mirrored = readMirroredSnapshotFn(factoryId, {
        context,
        rootDir,
        mirrorDir,
      });
      for (const snapshot of Array.isArray(mirrored?.snapshots) ? mirrored.snapshots : []) {
        snapshots.push(snapshot);
      }
    } catch (error) {
      appendQueueWarning(queueMetadata, "platform_incidents", `${factoryId}:snapshot_feed:${trim(error?.code || error?.message || error)}`);
      appendQueueWarning(queueMetadata, "local_instance_incidents", `${factoryId}:snapshot_feed:${trim(error?.code || error?.message || error)}`);
      appendQueueWarning(queueMetadata, "blocked_instances", `${factoryId}:snapshot_feed:${trim(error?.code || error?.message || error)}`);
    }

    try {
      const recent = readRecentEventsFn(factoryId, {
        context,
        rootDir,
        mirrorDir,
        limit: eventLimit,
      });
      for (const event of Array.isArray(recent?.events) ? recent.events : []) {
        events.push(event);
      }
    } catch (error) {
      appendQueueWarning(queueMetadata, "repeated_failure_risk", `${factoryId}:events_feed:${trim(error?.code || error?.message || error)}`);
      appendQueueWarning(queueMetadata, "upgrade_drift", `${factoryId}:events_feed:${trim(error?.code || error?.message || error)}`);
    }
  }

  return {
    snapshots,
    events,
  };
}

function collectLastSuccessfulReleaseByFactory(events = []) {
  const byFactory = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    const status = trim(event?.status).toLowerCase();
    if (status !== "completed") continue;

    const factoryId = trim(event?.factory_id || event?.instance_id);
    const endedAt = trim(event?.ended_at || event?.started_at);
    if (!factoryId || !endedAt) continue;

    const current = byFactory.get(factoryId);
    if (!current || parseEpochMs(endedAt) > parseEpochMs(current)) {
      byFactory.set(factoryId, endedAt);
    }
  }
  return byFactory;
}

function buildIncidentQueues({
  snapshots = [],
  events = [],
  registryRowsByFactory = new Map(),
  fleetRowsByFactory = new Map(),
  profiles = {},
} = {}) {
  const incidentRecords = [];

  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    const meta = resolveInstanceMeta({
      snapshot,
      fallbackFactoryId: trim(snapshot?.factory_id),
      registryRowsByFactory,
      fleetRowsByFactory,
      profiles,
    });

    for (const incident of Array.isArray(snapshot?.latest_incidents) ? snapshot.latest_incidents : []) {
      const fingerprint = ensureIncidentFingerprintOrThrow(incident, meta);
      incidentRecords.push({
        fingerprint,
        severity: trim(incident?.severity).toLowerCase() || "warning",
        instance_id: meta.instance_id,
        factory_id: meta.factory_id,
        target_repo: meta.target_repo,
        support_owner: meta.support_owner,
        service_tier: meta.service_tier,
        kind_id: meta.kind_id,
        lifecycle_state: trim(snapshot?.lifecycle_state),
        lifecycle_reason: trim(snapshot?.lifecycle_reason),
        scope_hint: inferIncidentScope(snapshot, 1),
      });
    }
  }

  for (const event of Array.isArray(events) ? events : []) {
    const fingerprint = trim(event?.incident_fingerprint);
    const status = trim(event?.status).toLowerCase();
    if (!fingerprint || !["failed", "error"].includes(status)) continue;

    const meta = resolveInstanceMeta({
      snapshot: {
        instance_id: trim(event?.instance_id || event?.factory_id),
        factory_id: trim(event?.factory_id || event?.instance_id),
      },
      fallbackFactoryId: trim(event?.factory_id),
      registryRowsByFactory,
      fleetRowsByFactory,
      profiles,
    });

    incidentRecords.push({
      fingerprint,
      severity: "error",
      instance_id: meta.instance_id,
      factory_id: meta.factory_id,
      target_repo: meta.target_repo,
      support_owner: meta.support_owner,
      service_tier: meta.service_tier,
      kind_id: meta.kind_id,
      lifecycle_state: "",
      lifecycle_reason: "",
      scope_hint: "local",
    });
  }

  const incidentGroups = new Map();
  for (const record of incidentRecords) {
    const list = incidentGroups.get(record.fingerprint) || [];
    list.push(record);
    incidentGroups.set(record.fingerprint, list);
  }

  const platformIncidents = [];
  const localIncidents = [];

  for (const [fingerprint, records] of incidentGroups.entries()) {
    const affectedInstances = uniqueSorted(records.map((entry) => entry.instance_id));
    const servicesImpacted = uniqueSorted(records.map((entry) => entry.target_repo));
    const supportOwners = uniqueSorted(records.map((entry) => entry.support_owner));
    const serviceTiers = uniqueSorted(records.map((entry) => entry.service_tier));
    const highestSeverity = [...records]
      .sort((left, right) => severityToWeight(right.severity) - severityToWeight(left.severity))[0]?.severity || "warning";

    const supportOwner = supportOwners.length === 1 ? supportOwners[0] : "mixed";
    const serviceTier = serviceTiers.length === 1 ? serviceTiers[0] : "mixed";
    const queueReasons = uniqueSorted([
      ...records.map((entry) => entry.lifecycle_state),
      ...records.map((entry) => entry.lifecycle_reason),
      `severity=${highestSeverity}`,
    ]);

    const incidentScope = records.some((entry) => entry.scope_hint === "platform") || affectedInstances.length > 1
      ? "platform"
      : "local";

    const baseItem = {
      fingerprint,
      incident_fingerprint: fingerprint,
      severity: highestSeverity,
      queue_reasons: queueReasons.length > 0 ? queueReasons : ["incident_detected"],
      affected_instances: affectedInstances,
      support_owner: supportOwner,
      support_owners: supportOwners,
      service_tier: serviceTier,
      service_tiers: serviceTiers,
      blast_radius: {
        affected_instance_count: affectedInstances.length,
        services_impacted: servicesImpacted,
        support_owner: supportOwner,
        service_tier: serviceTier,
      },
    };

    if (incidentScope === "platform") {
      platformIncidents.push(baseItem);
      continue;
    }

    localIncidents.push({
      ...baseItem,
      instance_id: affectedInstances[0] || records[0]?.instance_id || "unknown",
      factory_id: records[0]?.factory_id || records[0]?.instance_id || "unknown",
      blast_radius: {
        affected_instance_count: 1,
        services_impacted: servicesImpacted.slice(0, 1),
        support_owner: supportOwner,
        service_tier: serviceTier,
      },
    });
  }

  return {
    platform_incidents: platformIncidents,
    local_instance_incidents: localIncidents,
  };
}

function buildBlockedQueue({
  snapshots = [],
  fleetRowsByFactory = new Map(),
  registryRowsByFactory = new Map(),
  profiles = {},
  nowEpochMs = Date.now(),
} = {}) {
  const blockedItems = [];
  const seenFingerprints = new Set();

  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    if (!isBlockedSnapshot(snapshot)) continue;

    const meta = resolveInstanceMeta({
      snapshot,
      fallbackFactoryId: trim(snapshot?.factory_id),
      registryRowsByFactory,
      fleetRowsByFactory,
      profiles,
    });

    const fingerprint = `blocked:${meta.instance_id}`;
    if (seenFingerprints.has(fingerprint)) continue;
    seenFingerprints.add(fingerprint);

    const blockedDurationSeconds = computeDurationSeconds({
      from: trim(snapshot?.lifecycle_updated_at),
      toEpochMs: nowEpochMs,
    });

    const backlogFromSnapshot = nonNegative(snapshot?.oldest_work_age_seconds);
    const backlogFromLifecycle = nonNegative(snapshot?.queue_depth) > 0
      ? computeDurationSeconds({
        from: trim(snapshot?.lifecycle_updated_at),
        toEpochMs: nowEpochMs,
      })
      : 0;

    blockedItems.push({
      fingerprint,
      instance_id: meta.instance_id,
      factory_id: meta.factory_id,
      support_owner: meta.support_owner,
      service_tier: meta.service_tier,
      severity: deriveBlockedSeverity(snapshot),
      queue_reasons: uniqueSorted([
        trim(snapshot?.lifecycle_state),
        trim(snapshot?.lifecycle_reason),
        trim(snapshot?.lifecycle_failure_reason),
      ]).filter(Boolean),
      blocked_duration_seconds: nonNegative(blockedDurationSeconds),
      backlog_age_seconds: Math.max(backlogFromSnapshot, backlogFromLifecycle, 0),
      queue_depth: nonNegative(snapshot?.queue_depth),
      unresolved_actions: nonNegative(snapshot?.unresolved_actions),
      oldest_work_age_seconds: nonNegative(snapshot?.oldest_work_age_seconds),
    });
  }

  for (const [factoryId, row] of fleetRowsByFactory.entries()) {
    const releaseState = trim(row?.release_state);
    const hasBlockSignal = releaseState === "blocked" || trim(row?.blocked_reason);
    if (!hasBlockSignal) continue;

    const fingerprint = `blocked:${factoryId}`;
    if (seenFingerprints.has(fingerprint)) continue;
    seenFingerprints.add(fingerprint);

    const meta = resolveInstanceMeta({
      snapshot: {
        factory_id: factoryId,
        instance_id: factoryId,
      },
      fallbackFactoryId: factoryId,
      registryRowsByFactory,
      fleetRowsByFactory,
      profiles,
    });

    blockedItems.push({
      fingerprint,
      instance_id: meta.instance_id,
      factory_id: factoryId,
      support_owner: meta.support_owner,
      service_tier: meta.service_tier,
      severity: "medium",
      queue_reasons: uniqueSorted([
        trim(row?.blocked_reason),
        trim(row?.control_plane_blocker),
        `release_state=${releaseState || "unknown"}`,
      ]),
      blocked_duration_seconds: 0,
      backlog_age_seconds: 0,
      queue_depth: 0,
      unresolved_actions: 0,
      oldest_work_age_seconds: 0,
    });
  }

  for (const item of blockedItems) {
    item.queue_reasons = item.queue_reasons.length > 0 ? item.queue_reasons : ["blocked_state_detected"];
  }

  return blockedItems;
}

function buildRepeatedFailureQueue({
  events = [],
  fleetRowsByFactory = new Map(),
  registryRowsByFactory = new Map(),
  profiles = {},
} = {}) {
  const failedByInstance = new Map();

  for (const event of Array.isArray(events) ? events : []) {
    const status = trim(event?.status).toLowerCase();
    const instanceId = trim(event?.instance_id || event?.factory_id);
    if (!instanceId) continue;

    const bucket = failedByInstance.get(instanceId) || {
      instance_id: instanceId,
      factory_id: trim(event?.factory_id || instanceId),
      failed_events: 0,
      total_events: 0,
      fingerprints: [],
      latest_failed_at: "",
    };

    bucket.total_events += 1;
    if (["failed", "error"].includes(status)) {
      bucket.failed_events += 1;
      const incidentFingerprint = trim(event?.incident_fingerprint);
      if (incidentFingerprint) bucket.fingerprints.push(incidentFingerprint);
      const failedAt = trim(event?.ended_at || event?.started_at);
      if (failedAt && (!bucket.latest_failed_at || parseEpochMs(failedAt) > parseEpochMs(bucket.latest_failed_at))) {
        bucket.latest_failed_at = failedAt;
      }
    }

    failedByInstance.set(instanceId, bucket);
  }

  const queue = [];
  for (const bucket of failedByInstance.values()) {
    if (bucket.failed_events < 2) continue;

    const meta = resolveInstanceMeta({
      snapshot: {
        instance_id: bucket.instance_id,
        factory_id: bucket.factory_id,
      },
      fallbackFactoryId: bucket.factory_id,
      registryRowsByFactory,
      fleetRowsByFactory,
      profiles,
    });

    queue.push({
      fingerprint: uniqueSorted(bucket.fingerprints)[0] || `repeated_failure:${bucket.instance_id}`,
      instance_id: bucket.instance_id,
      factory_id: bucket.factory_id,
      support_owner: meta.support_owner,
      service_tier: meta.service_tier,
      severity: bucket.failed_events >= 5 ? "high" : "medium",
      queue_reasons: [
        `failed_events=${bucket.failed_events}`,
        `total_events=${bucket.total_events}`,
      ],
      failed_events: bucket.failed_events,
      total_events: bucket.total_events,
      latest_failed_at: bucket.latest_failed_at || null,
    });
  }

  return queue;
}

function buildUpgradeDriftQueue({
  releaseReport = {},
  events = [],
  registryRowsByFactory = new Map(),
  fleetRowsByFactory = new Map(),
  profiles = {},
} = {}) {
  const releaseRows = Array.isArray(releaseReport?.factories) ? releaseReport.factories : [];
  const lastSuccessfulByFactory = collectLastSuccessfulReleaseByFactory(events);
  const queue = [];

  for (const row of releaseRows) {
    const rolloutStatus = trim(row?.rollout_status);
    if (rolloutStatus !== "lagging" && rolloutStatus !== "blocked") continue;

    const factoryId = trim(row?.factory_id) || "unknown";
    const phase = rolloutStatus === "lagging" ? "lagging" : "blocked_gate";
    const reason = trim(row?.status_detail || row?.gate_reason) || "state_unknown";
    const meta = resolveInstanceMeta({
      snapshot: {
        factory_id: factoryId,
        instance_id: factoryId,
      },
      fallbackFactoryId: factoryId,
      registryRowsByFactory,
      fleetRowsByFactory,
      profiles,
    });

    queue.push({
      fingerprint: `upgrade_drift:${factoryId}`,
      factory_id: factoryId,
      instance_id: meta.instance_id,
      support_owner: meta.support_owner,
      service_tier: meta.service_tier,
      severity: rolloutStatus === "blocked" ? "high" : "medium",
      queue_reasons: uniqueSorted([
        rolloutStatus,
        trim(row?.gate_reason),
      ]),
      phase,
      reason,
      rollout_status: rolloutStatus,
      required_factory_release: trim(row?.required_factory_release) || null,
      local_factory_release: trim(row?.local_factory_release) || null,
      last_successful_release_at: lastSuccessfulByFactory.get(factoryId) || null,
    });
  }

  return queue;
}

function buildHostCapacityQueue({
  hostStatus = {},
  nowEpochMs = Date.now(),
  queueMetadata = {},
  staleAfterSeconds = HOST_SIGNAL_STALE_SECONDS,
} = {}) {
  const queue = [];

  const safeHostStatus = hostStatus && typeof hostStatus === "object" ? hostStatus : null;
  if (!safeHostStatus) {
    appendQueueWarning(queueMetadata, "host_capacity_pressure", "host_pressure_feed_empty");
    queue.push({
      fingerprint: "host:unknown:capacity_pressure",
      severity: "warning",
      queue_reasons: ["host_pressure_feed_empty"],
      host_id: "unknown",
      degradation_warning: true,
    });
    return queue;
  }

  const hostId = trim(safeHostStatus.hostId || safeHostStatus.host_id) || "unknown";
  const pressure = Number(safeHostStatus.host_capacity_pressure);
  const queueDepth = nonNegative(safeHostStatus.host_queue_depth);
  const pendingInstallations = nonNegative(safeHostStatus.host_pending_installations);
  const schedulerUpdatedAt = trim(safeHostStatus?.scheduler?.updated_at || safeHostStatus.updated_at);
  const schedulerAgeSeconds = computeDurationSeconds({ from: schedulerUpdatedAt, toEpochMs: nowEpochMs });
  const staleSignal = !schedulerUpdatedAt || schedulerAgeSeconds > staleAfterSeconds;

  if (!Number.isFinite(pressure)) {
    appendQueueWarning(queueMetadata, "host_capacity_pressure", "host_pressure_feed_empty");
    queue.push({
      fingerprint: `host:${hostId}:capacity_pressure`,
      severity: "warning",
      queue_reasons: ["host_pressure_feed_empty"],
      host_id: hostId,
      degradation_warning: true,
    });
    return queue;
  }

  const severity = pressure >= 1
    ? "critical"
    : (pressure >= 0.85 ? "high" : (pressure >= 0.65 ? "medium" : "low"));

  if (staleSignal || pressure >= 0.8 || queueDepth > 0 || pendingInstallations > 0 || safeHostStatus.ok !== true) {
    const reasons = [];
    if (pressure >= 0.8) reasons.push(`capacity_pressure=${pressure.toFixed(4)}`);
    if (queueDepth > 0) reasons.push(`host_queue_depth=${queueDepth}`);
    if (pendingInstallations > 0) reasons.push(`host_pending_installations=${pendingInstallations}`);
    if (safeHostStatus.ok !== true) reasons.push(`host_status=${trim(safeHostStatus.status) || "degraded"}`);
    if (staleSignal) {
      reasons.push(`signal_stale_seconds=${schedulerAgeSeconds}`);
      appendQueueWarning(queueMetadata, "host_capacity_pressure", "host_pressure_signal_stale");
    }

    queue.push({
      fingerprint: `host:${hostId}:capacity_pressure`,
      severity,
      queue_reasons: reasons.length > 0 ? reasons : ["capacity_pressure_degraded"],
      host_id: hostId,
      host_capacity_pressure: Number(pressure.toFixed(4)),
      host_queue_depth: queueDepth,
      host_pending_installations: pendingInstallations,
      signal_updated_at: schedulerUpdatedAt || null,
      signal_age_seconds: schedulerAgeSeconds,
      degradation_warning: staleSignal,
    });
  }

  return queue;
}

function validateQueueItemOrThrow(item = {}, queueKey = "") {
  if (!trim(item?.fingerprint)) {
    throw new Error(`[fleet-triage-projection] ${queueKey} item missing fingerprint`);
  }
  if (!Array.isArray(item?.queue_reasons)) {
    throw new Error(`[fleet-triage-projection] ${queueKey} item missing queue_reasons`);
  }
}

function validateProjectionShapeOrThrow(projection = {}) {
  for (const queueKey of QUEUE_KEYS) {
    if (!Array.isArray(projection?.[queueKey])) {
      throw new Error(`[fleet-triage-projection] queue_missing:${queueKey}`);
    }
    for (const item of projection[queueKey]) {
      validateQueueItemOrThrow(item, queueKey);
    }
  }
}

function scorePlatformIncident(item = {}) {
  const affectedCount = nonNegative(item?.blast_radius?.affected_instance_count);
  return (affectedCount * 100)
    + severityToWeight(item?.severity)
    + tierToWeight(item?.service_tier);
}

function scoreLocalIncident(item = {}) {
  return severityToWeight(item?.severity) + tierToWeight(item?.service_tier);
}

function scoreBlocked(item = {}) {
  return nonNegative(item?.backlog_age_seconds)
    + (nonNegative(item?.blocked_duration_seconds) * 0.5)
    + severityToWeight(item?.severity)
    + tierToWeight(item?.service_tier);
}

function scoreRepeatedFailure(item = {}) {
  return (nonNegative(item?.failed_events) * 100)
    + (nonNegative(item?.total_events) * 5)
    + severityToWeight(item?.severity)
    + tierToWeight(item?.service_tier);
}

function scoreUpgradeDrift(item = {}) {
  const phase = trim(item?.phase);
  const phaseWeight = phase === "blocked_gate" ? 120 : 80;
  return phaseWeight
    + severityToWeight(item?.severity)
    + tierToWeight(item?.service_tier);
}

function scoreHostPressure(item = {}) {
  return (nonNegative(item?.host_capacity_pressure) * 100)
    + (nonNegative(item?.host_queue_depth) * 10)
    + (nonNegative(item?.host_pending_installations) * 10)
    + severityToWeight(item?.severity);
}

function rankQueueItems(items = [], scoreFn = () => 0) {
  const scored = (Array.isArray(items) ? items : []).map((item) => {
    const score = Number(scoreFn(item)) || 0;
    return {
      ...item,
      _priority_score: score,
    };
  });

  scored.sort((left, right) => {
    if (right._priority_score !== left._priority_score) return right._priority_score - left._priority_score;
    return trim(left.fingerprint).localeCompare(trim(right.fingerprint));
  });

  return scored.map((item, index) => {
    const { _priority_score: score, ...rest } = item;
    return {
      ...rest,
      ranking: {
        rank: index + 1,
        priority_score: Number(score.toFixed(2)),
      },
    };
  });
}

export function rankFleetQueueItems(projection = {}) {
  const rankedProjection = {
    ...projection,
    platform_incidents: rankQueueItems(projection?.platform_incidents, scorePlatformIncident),
    local_instance_incidents: rankQueueItems(projection?.local_instance_incidents, scoreLocalIncident),
    blocked_instances: rankQueueItems(projection?.blocked_instances, scoreBlocked),
    repeated_failure_risk: rankQueueItems(projection?.repeated_failure_risk, scoreRepeatedFailure),
    upgrade_drift: rankQueueItems(projection?.upgrade_drift, scoreUpgradeDrift),
    host_capacity_pressure: rankQueueItems(projection?.host_capacity_pressure, scoreHostPressure),
  };

  return rankedProjection;
}

export async function buildFleetTriageQueues({
  context = {},
  factoryId = "mothership",
  registryPath = "factory-registry.json",
  mirrorDir = "",
  hostBaseDir = "",
  hostRepoRoot = process.cwd(),
  eventLimit = 200,
  now = Date.now(),
  readFactoryRegistryFn = defaultReadFactoryRegistry,
  loadFactoryRegistryFn = loadFactoryRegistry,
  readMirroredSnapshotFn = readMirroredSnapshot,
  readRecentEventsFn = readRecentEvents,
  factoryFleetStatusFn = defaultFactoryFleetStatus,
  factoryReleaseTargetingStatusFn = defaultFactoryReleaseTargetingStatus,
  getHostRuntimeStatusFn = defaultHostRuntimeStatus,
} = {}) {
  const nowEpochMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const generatedAt = toIsoTimestamp(nowEpochMs);

  const queueMetadata = initializeProjectionMetadata();
  const rootDir = process.cwd();

  const registry = await readFactoryRegistryFn({ context, registryPath, cwd: rootDir });
  if (!registry?.ok) {
    appendQueueWarning(queueMetadata, "platform_incidents", `registry:${trim(registry?.reason || "missing")}`);
    appendQueueWarning(queueMetadata, "local_instance_incidents", `registry:${trim(registry?.reason || "missing")}`);
    appendQueueWarning(queueMetadata, "blocked_instances", `registry:${trim(registry?.reason || "missing")}`);
    appendQueueWarning(queueMetadata, "repeated_failure_risk", `registry:${trim(registry?.reason || "missing")}`);
    appendQueueWarning(queueMetadata, "upgrade_drift", `registry:${trim(registry?.reason || "missing")}`);
  }

  const registryRows = normalizeRegistryRows(registry);
  const registryRowsByFactory = new Map(
    registryRows
      .map((row) => [trim(row?.factory_id), row])
      .filter(([factoryIdKey]) => Boolean(factoryIdKey)),
  );

  const profileLookups = buildProfileLookups({
    registryPath,
    cwd: rootDir,
    loadFactoryRegistryFn,
  });

  if (profileLookups.warning) {
    for (const queueKey of QUEUE_KEYS) {
      appendQueueWarning(queueMetadata, queueKey, profileLookups.warning);
    }
  }

  const fleetStatus = await factoryFleetStatusFn({
    context,
    registryPath,
    now: nowEpochMs,
  });

  const fleetRows = normalizeFleetRows(fleetStatus);
  const fleetRowsByFactory = new Map(
    fleetRows
      .map((row) => [trim(row?.factory_id), row])
      .filter(([factoryIdKey]) => Boolean(factoryIdKey)),
  );

  const fleetFactoryIds = uniqueSorted([
    ...registryRows.map((row) => trim(row?.factory_id)),
    ...fleetRows.map((row) => trim(row?.factory_id)),
    trim(factoryId),
  ]);

  const mirroredSignals = collectMirroredSignals({
    factoryIds: fleetFactoryIds,
    readMirroredSnapshotFn,
    readRecentEventsFn,
    context,
    rootDir,
    mirrorDir,
    eventLimit,
    queueMetadata,
  });

  const incidentQueues = buildIncidentQueues({
    snapshots: mirroredSignals.snapshots,
    events: mirroredSignals.events,
    registryRowsByFactory,
    fleetRowsByFactory,
    profiles: profileLookups,
  });

  const blockedInstances = buildBlockedQueue({
    snapshots: mirroredSignals.snapshots,
    fleetRowsByFactory,
    registryRowsByFactory,
    profiles: profileLookups,
    nowEpochMs,
  });

  const repeatedFailureRisk = buildRepeatedFailureQueue({
    events: mirroredSignals.events,
    fleetRowsByFactory,
    registryRowsByFactory,
    profiles: profileLookups,
  });

  const releaseTargetingReport = await factoryReleaseTargetingStatusFn({
    registryPath,
    now: nowEpochMs,
  });

  const upgradeDrift = buildUpgradeDriftQueue({
    releaseReport: releaseTargetingReport,
    events: mirroredSignals.events,
    registryRowsByFactory,
    fleetRowsByFactory,
    profiles: profileLookups,
  });

  if (!Array.isArray(releaseTargetingReport?.factories) || releaseTargetingReport.factories.length === 0) {
    appendQueueWarning(queueMetadata, "upgrade_drift", "release_targeting_feed_empty");
  }

  let hostStatus;
  try {
    hostStatus = await getHostRuntimeStatusFn({
      hostBaseDir,
      hostRepoRoot,
    });
  } catch (error) {
    appendQueueWarning(queueMetadata, "host_capacity_pressure", `host_status_error:${trim(error?.message || error)}`);
    hostStatus = null;
  }

  const hostCapacityPressure = buildHostCapacityQueue({
    hostStatus,
    nowEpochMs,
    queueMetadata,
  });

  const rawProjection = {
    schema_version: TRIAGE_SCHEMA_VERSION,
    generated_at: generatedAt,
    queue_metadata: queueMetadata,
    platform_incidents: incidentQueues.platform_incidents,
    local_instance_incidents: incidentQueues.local_instance_incidents,
    blocked_instances: blockedInstances,
    repeated_failure_risk: repeatedFailureRisk,
    upgrade_drift: upgradeDrift,
    host_capacity_pressure: hostCapacityPressure,
  };

  validateProjectionShapeOrThrow(rawProjection);
  return rankFleetQueueItems(rawProjection);
}
