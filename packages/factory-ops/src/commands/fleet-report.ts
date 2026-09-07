import { compareReleases } from "./artifact-linkage.ts";
import { factoryReleaseTargetingStatus } from "./factory-release-targeting-status.ts";
import { getHostRuntimeStatus, resolveHostRuntimePaths } from "./host-runtime-lifecycle.ts";
import { readFactoryRegistry } from "../lib/factory-fleet-projection-support.ts";
import { readRecentEvents, readMirroredSnapshot } from "../lib/factory-mirror-reader.ts";

export const FLEET_REPORT_SCHEMA = "fleet-report.v1";
export const FLEET_REPORT_VIEWS = Object.freeze([
  "throughput",
  "failure-rates",
  "backlog-age",
  "model-cost",
  "version-drift",
  "host-pressure",
  "time-to-resolution",
]);

function trim(value = "") {
  return String(value ?? "").trim();
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function nonNegative(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function toEpochMs(value = "") {
  const parsed = Date.parse(trim(value));
  if (!Number.isFinite(parsed)) return Number.NaN;
  return parsed;
}

function normalizeFactoryIds(registry = {}, fallbackFactoryId = "") {
  const factoryIds = new Set();
  for (const row of Array.isArray(registry?.factories) ? registry.factories : []) {
    const id = trim(row?.factory_id);
    if (id) factoryIds.add(id);
  }
  const fallback = trim(fallbackFactoryId);
  if (fallback) factoryIds.add(fallback);
  return [...factoryIds].sort((left, right) => left.localeCompare(right));
}

function dedupeEvents(events = []) {
  const byKey = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== "object") continue;
    const key = [
      trim(event.factory_id),
      trim(event.instance_id),
      trim(event.run_id),
      trim(event.tick_id),
      trim(event.event_type),
      trim(event.status),
      trim(event.started_at),
      trim(event.ended_at),
      trim(event.incident_fingerprint),
    ].join("|");
    if (!byKey.has(key)) byKey.set(key, event);
  }
  return [...byKey.values()];
}

function dedupeSnapshots(snapshots = []) {
  const byInstance = new Map();
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    if (!snapshot || typeof snapshot !== "object") continue;
    const key = `${trim(snapshot.factory_id)}|${trim(snapshot.instance_id)}`;
    const current = byInstance.get(key);
    const currentMs = toEpochMs(current?.mirror_updated_at);
    const nextMs = toEpochMs(snapshot?.mirror_updated_at);
    if (!current || (Number.isFinite(nextMs) && (!Number.isFinite(currentMs) || nextMs >= currentMs))) {
      byInstance.set(key, snapshot);
    }
  }
  return [...byInstance.values()];
}

function normalizeWindow({ from = "", to = "", nowEpochMs = Date.now() } = {}) {
  const fromRaw = trim(from);
  const toRaw = trim(to);
  const fromMs = fromRaw ? toEpochMs(fromRaw) : Number.NEGATIVE_INFINITY;
  const toMs = toRaw ? toEpochMs(toRaw) : nowEpochMs;

  if (fromRaw && !Number.isFinite(fromMs)) {
    throw new Error("invalid_from");
  }
  if (toRaw && !Number.isFinite(toMs)) {
    throw new Error("invalid_to");
  }
  if (Number.isFinite(fromMs) && Number.isFinite(toMs) && fromMs > toMs) {
    throw new Error("invalid_window:from_after_to");
  }

  return {
    from_ms: fromMs,
    to_ms: toMs,
    from: fromRaw ? new Date(fromMs).toISOString() : "",
    to: new Date(toMs).toISOString(),
  };
}

function eventTimestampMs(event = {}) {
  return toEpochMs(event?.ended_at || event?.started_at || event?.timestamp);
}

function snapshotTimestampMs(snapshot = {}) {
  return toEpochMs(snapshot?.mirror_updated_at || snapshot?.lifecycle_updated_at);
}

function withinWindow(timestampMs, window = {}) {
  if (!Number.isFinite(timestampMs)) return false;
  if (Number.isFinite(window?.from_ms) && timestampMs < window.from_ms) return false;
  if (Number.isFinite(window?.to_ms) && timestampMs > window.to_ms) return false;
  return true;
}

function matchesInstance(value = {}, instance = "") {
  const target = trim(instance);
  if (!target) return true;
  return [trim(value?.instance_id), trim(value?.factory_id)].includes(target);
}

function isFailureStatus(status = "") {
  const normalized = trim(status).toLowerCase();
  return ["failed", "error", "blocked", "timeout"].includes(normalized);
}

function isSuccessStatus(status = "") {
  const normalized = trim(status).toLowerCase();
  return ["completed", "complete", "success", "succeeded", "done", "closed"].includes(normalized);
}

function buildRateRow(key, totals = {}) {
  const total = nonNegative(totals.total, 0);
  const failed = nonNegative(totals.failed, 0);
  return {
    key: trim(key) || "unknown",
    total_events: total,
    failed_events: failed,
    failure_rate: total > 0 ? Number((failed / total).toFixed(4)) : 0,
  };
}

function collectReleaseRowsWithinWindow({ releaseReport = {}, window = {} } = {}) {
  const generatedMs = toEpochMs(releaseReport?.generated_at);
  if (Number.isFinite(generatedMs) && !withinWindow(generatedMs, window)) return [];
  return Array.isArray(releaseReport?.factories) ? releaseReport.factories : [];
}

function selectLatestEventByFactory(events = []) {
  const byFactory = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    const factoryId = trim(event?.factory_id || event?.instance_id);
    if (!factoryId) continue;
    const current = byFactory.get(factoryId);
    const currentMs = eventTimestampMs(current);
    const nextMs = eventTimestampMs(event);
    if (!current || (Number.isFinite(nextMs) && (!Number.isFinite(currentMs) || nextMs >= currentMs))) {
      byFactory.set(factoryId, event);
    }
  }
  return byFactory;
}

function percentile(values = [], percentileValue = 95) {
  const list = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (list.length === 0) return 0;
  const index = Math.max(0, Math.min(list.length - 1, Math.ceil((percentileValue / 100) * list.length) - 1));
  return list[index] || 0;
}

function summarizeDurations(seconds = []) {
  const list = (Array.isArray(seconds) ? seconds : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0);

  if (list.length === 0) {
    return {
      sample_count: 0,
      mean_seconds: 0,
      p95_seconds: 0,
    };
  }

  const total = list.reduce((sum, value) => sum + value, 0);
  return {
    sample_count: list.length,
    mean_seconds: Number((total / list.length).toFixed(2)),
    p95_seconds: percentile(list, 95),
  };
}

function extractTokenUsage(event = {}) {
  const tokenUsage = event?.token_usage && typeof event.token_usage === "object" ? event.token_usage : {};
  const promptTokens = nonNegative(event?.prompt_tokens, nonNegative(tokenUsage?.prompt_tokens, 0));
  const completionTokens = nonNegative(event?.completion_tokens, nonNegative(tokenUsage?.completion_tokens, 0));
  const totalTokens = nonNegative(
    event?.total_tokens,
    nonNegative(tokenUsage?.total_tokens, promptTokens + completionTokens),
  );

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}

function extractCostUsd(event = {}) {
  const estimates = [
    event?.estimated_cost_usd,
    event?.cost_usd,
    event?.model_cost_usd,
    event?.token_usage?.estimated_cost_usd,
  ];
  for (const value of estimates) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Number(parsed.toFixed(6));
  }
  return null;
}

export function computeThroughput({ events = [] } = {}) {
  const completedEvents = (Array.isArray(events) ? events : []).filter((event) => isSuccessStatus(event?.status));
  const byInstance = new Map();
  const byKind = new Map();

  for (const event of completedEvents) {
    const instanceId = trim(event?.instance_id || event?.factory_id) || "unknown";
    const kindId = trim(event?.kind_id) || "unknown";
    byInstance.set(instanceId, nonNegative(byInstance.get(instanceId), 0) + 1);
    byKind.set(kindId, nonNegative(byKind.get(kindId), 0) + 1);
  }

  return {
    completed_total: completedEvents.length,
    by_instance: [...byInstance.entries()]
      .map(([instance_id, completed_count]) => ({ instance_id, completed_count }))
      .sort((left, right) => right.completed_count - left.completed_count || left.instance_id.localeCompare(right.instance_id)),
    by_kind: [...byKind.entries()]
      .map(([kind_id, completed_count]) => ({ kind_id, completed_count }))
      .sort((left, right) => right.completed_count - left.completed_count || left.kind_id.localeCompare(right.kind_id)),
  };
}

export function computeFailureRates({ events = [], releaseRows = [] } = {}) {
  const byKind = new Map();
  const byRuntime = new Map();
  const byCapability = new Map();
  const byInstance = new Map();

  for (const event of Array.isArray(events) ? events : []) {
    const failed = isFailureStatus(event?.status);
    const kindKey = trim(event?.kind_id) || "unknown";
    const runtimeKey = trim(event?.runtime_version) || "unknown";
    const capabilityKey = trim(event?.capability_version || event?.policy_profile) || "unknown";
    const instanceKey = trim(event?.instance_id || event?.factory_id) || "unknown";

    const update = (bucket, key) => {
      const row = bucket.get(key) || { total: 0, failed: 0 };
      row.total += 1;
      if (failed) row.failed += 1;
      bucket.set(key, row);
    };

    update(byKind, kindKey);
    update(byRuntime, runtimeKey);
    update(byCapability, capabilityKey);
    update(byInstance, instanceKey);
  }

  const releaseByFactory = new Map();
  for (const row of Array.isArray(releaseRows) ? releaseRows : []) {
    const factoryId = trim(row?.factory_id);
    if (!factoryId) continue;
    releaseByFactory.set(factoryId, row);
  }

  const totals = {
    total_events: 0,
    failed_events: 0,
    failure_rate: 0,
  };

  for (const row of byInstance.values()) {
    totals.total_events += nonNegative(row.total, 0);
    totals.failed_events += nonNegative(row.failed, 0);
  }
  totals.failure_rate = totals.total_events > 0
    ? Number((totals.failed_events / totals.total_events).toFixed(4))
    : 0;

  return {
    totals,
    by_kind: [...byKind.entries()].map(([key, value]) => ({
      kind_id: key,
      ...buildRateRow(key, value),
    })).sort((left, right) => right.failed_events - left.failed_events || left.kind_id.localeCompare(right.kind_id)),
    by_runtime_version: [...byRuntime.entries()].map(([key, value]) => ({
      runtime_version: key,
      ...buildRateRow(key, value),
    })).sort((left, right) => right.failed_events - left.failed_events || left.runtime_version.localeCompare(right.runtime_version)),
    by_capability_version: [...byCapability.entries()].map(([key, value]) => ({
      capability_version: key,
      ...buildRateRow(key, value),
    })).sort((left, right) => right.failed_events - left.failed_events || left.capability_version.localeCompare(right.capability_version)),
    by_instance: [...byInstance.entries()].map(([instance_id, value]) => {
      const release = releaseByFactory.get(instance_id) || {};
      return {
        instance_id,
        ...buildRateRow(instance_id, value),
        rollout_status: trim(release?.rollout_status) || "unknown",
        drift_state: trim(release?.rollout_status) || "unknown",
      };
    }).sort((left, right) => right.failed_events - left.failed_events || left.instance_id.localeCompare(right.instance_id)),
  };
}

export function computeBacklogAge({ snapshots = [] } = {}) {
  const rows = (Array.isArray(snapshots) ? snapshots : [])
    .map((snapshot) => ({
      instance_id: trim(snapshot?.instance_id || snapshot?.factory_id) || "unknown",
      queue_depth: nonNegative(snapshot?.queue_depth, 0),
      oldest_work_age_seconds: nonNegative(snapshot?.oldest_work_age_seconds, 0),
      unresolved_actions: nonNegative(snapshot?.unresolved_actions, 0),
      lifecycle_state: trim(snapshot?.lifecycle_state) || "unknown",
    }))
    .sort((left, right) => right.oldest_work_age_seconds - left.oldest_work_age_seconds || left.instance_id.localeCompare(right.instance_id));

  const totals = {
    queue_depth_total: rows.reduce((sum, row) => sum + row.queue_depth, 0),
    instances_with_backlog: rows.filter((row) => row.queue_depth > 0).length,
    max_oldest_work_age_seconds: rows.length > 0 ? rows[0].oldest_work_age_seconds : 0,
  };

  return {
    totals,
    by_instance: rows,
  };
}

export function computeModelCost({ events = [], profile = "" } = {}) {
  const normalizedProfile = trim(profile);
  const rows = [];
  for (const event of Array.isArray(events) ? events : []) {
    const eventProfile = trim(event?.policy_profile) || "unknown";
    if (normalizedProfile && eventProfile !== normalizedProfile) continue;

    const tokenUsage = extractTokenUsage(event);
    const costUsd = extractCostUsd(event);
    rows.push({
      instance_id: trim(event?.instance_id || event?.factory_id) || "unknown",
      profile: eventProfile,
      total_tokens: tokenUsage.total_tokens,
      cost_usd: costUsd,
    });
  }

  const byInstance = new Map();
  const byProfile = new Map();
  let totalTokens = 0;
  let totalCost = 0;
  let missingEstimateEvents = 0;

  const update = (bucket, key, row) => {
    const current = bucket.get(key) || {
      event_count: 0,
      total_tokens: 0,
      total_cost_usd: 0,
      missing_estimate_events: 0,
    };

    current.event_count += 1;
    current.total_tokens += nonNegative(row.total_tokens, 0);
    if (row.cost_usd === null) {
      current.missing_estimate_events += 1;
    } else {
      current.total_cost_usd += row.cost_usd;
    }

    bucket.set(key, current);
  };

  for (const row of rows) {
    totalTokens += nonNegative(row.total_tokens, 0);
    if (row.cost_usd === null) {
      missingEstimateEvents += 1;
    } else {
      totalCost += row.cost_usd;
    }
    update(byInstance, row.instance_id, row);
    update(byProfile, row.profile, row);
  }

  const toSortedRows = (map, keyName) => [...map.entries()]
    .map(([key, value]) => ({
      [keyName]: key,
      event_count: value.event_count,
      total_tokens: value.total_tokens,
      total_cost_usd: Number(value.total_cost_usd.toFixed(6)),
      missing_estimate_events: value.missing_estimate_events,
    }))
    .sort((left, right) => right.total_tokens - left.total_tokens || trim(left[keyName]).localeCompare(trim(right[keyName])));

  return {
    cost_state: totalCost > 0 ? "estimated" : "unknown",
    totals: {
      event_count: rows.length,
      total_tokens: totalTokens,
      total_cost_usd: Number(totalCost.toFixed(6)),
      missing_estimate_events: missingEstimateEvents,
    },
    by_instance: toSortedRows(byInstance, "instance_id"),
    by_profile: toSortedRows(byProfile, "profile"),
    filter_profile: normalizedProfile || "",
  };
}

export function computeVersionDrift({ releaseRows = [], events = [] } = {}) {
  const latestEventByFactory = selectLatestEventByFactory(events);
  const rows = [];

  const releaseList = Array.isArray(releaseRows) ? releaseRows : [];
  for (const row of releaseList) {
    const factoryId = trim(row?.factory_id) || "unknown";
    const latest = latestEventByFactory.get(factoryId) || {};
    rows.push({
      instance_id: factoryId,
      rollout_channel: trim(row?.rollout_channel) || "unknown",
      rollout_status: trim(row?.rollout_status) || "unknown",
      drift_state: trim(row?.rollout_status) || "unknown",
      gate_reason: trim(row?.gate_reason) || "unknown",
      current_runtime_version: trim(latest?.runtime_version || row?.local_factory_release) || "unknown",
      target_runtime_version: trim(row?.required_factory_release) || "unknown",
      current_kind_version: trim(latest?.kind_version) || "unknown",
      required_factory_release: trim(row?.required_factory_release) || "",
    });
  }

  if (rows.length === 0) {
    for (const [factoryId, latest] of latestEventByFactory.entries()) {
      rows.push({
        instance_id: factoryId,
        rollout_channel: "unknown",
        rollout_status: "unknown",
        drift_state: "unknown",
        gate_reason: "unknown",
        current_runtime_version: trim(latest?.runtime_version) || "unknown",
        target_runtime_version: "unknown",
        current_kind_version: trim(latest?.kind_version) || "unknown",
        required_factory_release: "",
      });
    }
  }

  rows.sort((left, right) => left.instance_id.localeCompare(right.instance_id));

  const totals = {
    instance_count: rows.length,
    ready: 0,
    blocked: 0,
    lagging: 0,
    unknown: 0,
  };

  for (const row of rows) {
    const state = trim(row?.drift_state);
    if (Object.hasOwn(totals, state)) totals[state] += 1;
    else totals.unknown += 1;
  }

  return {
    totals,
    by_instance: rows,
  };
}

export function computeHostPressure({ hostStatus = null, events = [] } = {}) {
  const eventCountsByHost = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    const hostId = trim(event?.host_id);
    if (!hostId) continue;
    eventCountsByHost.set(hostId, nonNegative(eventCountsByHost.get(hostId), 0) + 1);
  }

  const status = hostStatus && typeof hostStatus === "object" ? hostStatus : null;
  const hostId = trim(status?.hostId || status?.host_id) || "unknown";
  const activeSlots = nonNegative(status?.host_active_slots, 0);
  const maxSlots = Math.max(1, nonNegative(status?.host_max_active_slots, 0));
  const activeInstallations = nonNegative(status?.installationCount, 0);
  const pendingInstallations = nonNegative(status?.host_pending_installations, 0);
  const capacityPressure = nonNegative(status?.host_capacity_pressure, 0);
  const leaseSaturation = maxSlots > 0
    ? Number((Math.min(activeInstallations, maxSlots) / maxSlots).toFixed(4))
    : 0;

  const byHost = [{
    host_id: hostId,
    status: trim(status?.status) || (status ? "installed" : "unknown"),
    active_installations: activeInstallations,
    active_slots: activeSlots,
    max_active_slots: maxSlots,
    capacity_utilization: Number((activeSlots / maxSlots).toFixed(4)),
    capacity_pressure: Number(capacityPressure.toFixed(4)),
    pending_installations: pendingInstallations,
    lease_saturation: leaseSaturation,
    recent_event_count: nonNegative(eventCountsByHost.get(hostId), 0),
  }];

  return {
    totals: {
      host_count: byHost.length,
      active_installations: byHost.reduce((sum, row) => sum + row.active_installations, 0),
      pending_installations: byHost.reduce((sum, row) => sum + row.pending_installations, 0),
      max_capacity_pressure: byHost.reduce((max, row) => Math.max(max, row.capacity_pressure), 0),
    },
    by_host: byHost,
  };
}

export function computeTimeToResolution({ events = [] } = {}) {
  const ordered = (Array.isArray(events) ? events : [])
    .map((event) => ({
      ...event,
      _timestamp_ms: eventTimestampMs(event),
      _instance_id: trim(event?.instance_id || event?.factory_id) || "unknown",
      _incident_key: trim(event?.incident_fingerprint) || trim(event?.instance_id || event?.factory_id) || "unknown",
    }))
    .filter((event) => Number.isFinite(event._timestamp_ms))
    .sort((left, right) => left._timestamp_ms - right._timestamp_ms);

  const openIncidents = new Map();
  const durations = [];
  const byInstance = new Map();

  for (const event of ordered) {
    const incidentKey = event._incident_key;
    const instanceId = event._instance_id;
    const open = openIncidents.get(incidentKey);

    if (isFailureStatus(event?.status)) {
      if (!open) {
        openIncidents.set(incidentKey, {
          started_at_ms: event._timestamp_ms,
          instance_id: instanceId,
        });
      }
      continue;
    }

    if (isSuccessStatus(event?.status) && open) {
      const durationSeconds = Math.max(0, Math.round((event._timestamp_ms - open.started_at_ms) / 1000));
      durations.push(durationSeconds);
      const bucket = byInstance.get(open.instance_id) || { resolved_durations: [], unresolved_incident_count: 0 };
      bucket.resolved_durations.push(durationSeconds);
      byInstance.set(open.instance_id, bucket);
      openIncidents.delete(incidentKey);
    }
  }

  for (const open of openIncidents.values()) {
    const bucket = byInstance.get(open.instance_id) || { resolved_durations: [], unresolved_incident_count: 0 };
    bucket.unresolved_incident_count += 1;
    byInstance.set(open.instance_id, bucket);
  }

  const summary = summarizeDurations(durations);

  const byInstanceRows = [...byInstance.entries()]
    .map(([instance_id, bucket]) => ({
      instance_id,
      ...summarizeDurations(bucket.resolved_durations),
      unresolved_incident_count: nonNegative(bucket.unresolved_incident_count, 0),
    }))
    .sort((left, right) => right.sample_count - left.sample_count || left.instance_id.localeCompare(right.instance_id));

  return {
    ...summary,
    unresolved_incident_count: [...openIncidents.values()].length,
    by_instance: byInstanceRows,
  };
}

async function collectFleetAnalyticsData({
  context = {},
  factoryId = "mothership",
  registryPath = "factory-registry.json",
  mirrorDir = "",
  rootDir = process.cwd(),
  nowEpochMs = Date.now(),
  eventLimit = 500,
  hostBaseDir = "",
  hostRepoRoot = process.cwd(),
  readFactoryRegistryFn = readFactoryRegistry,
  readMirroredSnapshotFn = readMirroredSnapshot,
  readRecentEventsFn = readRecentEvents,
  factoryReleaseTargetingStatusFn = factoryReleaseTargetingStatus,
  resolveHostRuntimePathsFn = resolveHostRuntimePaths,
  getHostRuntimeStatusFn = getHostRuntimeStatus,
} = {}) {
  const warnings = [];
  const registry = readFactoryRegistryFn({ context, registryPath, cwd: rootDir });
  if (!registry?.ok) {
    warnings.push(`registry:${trim(registry?.reason || "unavailable")}`);
  }

  const factoryIds = normalizeFactoryIds(registry, factoryId);
  const events = [];
  const snapshots = [];

  for (const id of factoryIds) {
    try {
      const mirrored = readMirroredSnapshotFn(id, {
        context,
        rootDir,
        mirrorDir,
      });
      snapshots.push(...(Array.isArray(mirrored?.snapshots) ? mirrored.snapshots : []));
    } catch (error) {
      warnings.push(`snapshot:${id}:${trim(error?.code || error?.message || error)}`);
    }

    try {
      const recent = readRecentEventsFn(id, {
        context,
        rootDir,
        mirrorDir,
        limit: Math.max(1, Number(eventLimit) || 500),
      });
      events.push(...(Array.isArray(recent?.events) ? recent.events : []));
    } catch (error) {
      warnings.push(`events:${id}:${trim(error?.code || error?.message || error)}`);
    }
  }

  let releaseReport = {
    generated_at: new Date(nowEpochMs).toISOString(),
    factories: [],
    warnings: ["release_targeting_unavailable"],
  };
  try {
    releaseReport = await Promise.resolve(factoryReleaseTargetingStatusFn({ registryPath, now: nowEpochMs }));
  } catch (error) {
    warnings.push(`release_targeting:${trim(error?.message || error)}`);
  }

  let hostStatus = null;
  try {
    const paths = resolveHostRuntimePathsFn({ hostBaseDir, repoRoot: hostRepoRoot });
    hostStatus = getHostRuntimeStatusFn({ paths });
  } catch (error) {
    warnings.push(`host_status:${trim(error?.message || error)}`);
  }

  return {
    registry,
    events: dedupeEvents(events),
    snapshots: dedupeSnapshots(snapshots),
    release_report: releaseReport,
    host_status: hostStatus,
    warnings,
  };
}

function filterEvents(events = [], { window = {}, instance = "" } = {}) {
  return (Array.isArray(events) ? events : []).filter((event) => (
    matchesInstance(event, instance)
    && withinWindow(eventTimestampMs(event), window)
  ));
}

function filterSnapshots(snapshots = [], { window = {}, instance = "" } = {}) {
  return (Array.isArray(snapshots) ? snapshots : []).filter((snapshot) => (
    matchesInstance(snapshot, instance)
    && withinWindow(snapshotTimestampMs(snapshot), window)
  ));
}

function normalizeDriftState(state = "") {
  const normalized = trim(state);
  if (["ready", "blocked", "lagging", "unknown"].includes(normalized)) return normalized;
  return "unknown";
}

function computeVersionDelta(currentVersion = "", targetVersion = "") {
  const current = trim(currentVersion);
  const target = trim(targetVersion);
  if (!current || !target || current === "unknown" || target === "unknown") return "unknown";

  const comparison = compareReleases(current, target);
  if (comparison === 0) return "in_sync";
  if (comparison > 0) return "ahead";
  return "behind";
}

function addVersionDelta(versionDriftPayload = {}) {
  const rows = Array.isArray(versionDriftPayload?.by_instance) ? versionDriftPayload.by_instance : [];
  return {
    ...versionDriftPayload,
    by_instance: rows.map((row) => ({
      ...row,
      version_delta: computeVersionDelta(row.current_runtime_version, row.target_runtime_version),
      drift_state: normalizeDriftState(row.drift_state),
    })),
  };
}

export async function fleetReport({
  view = "",
  context = {},
  factoryId = "mothership",
  instance = "",
  profile = "",
  from = "",
  to = "",
  registryPath = "factory-registry.json",
  mirrorDir = "",
  rootDir = process.cwd(),
  now = Date.now(),
  eventLimit = 500,
  hostBaseDir = "",
  hostRepoRoot = process.cwd(),
  collectFleetAnalyticsDataFn = collectFleetAnalyticsData,
  data = null,
} = {}) {
  const normalizedView = trim(view);
  if (!FLEET_REPORT_VIEWS.includes(normalizedView)) {
    throw new Error(`invalid_view:${normalizedView || "(missing)"}`);
  }

  const nowEpochMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const window = normalizeWindow({ from, to, nowEpochMs });

  const loaded = data || await collectFleetAnalyticsDataFn({
    context,
    factoryId,
    registryPath,
    mirrorDir,
    rootDir,
    nowEpochMs,
    eventLimit,
    hostBaseDir,
    hostRepoRoot,
  });

  const filteredEvents = filterEvents(loaded?.events, { window, instance });
  const filteredSnapshots = filterSnapshots(loaded?.snapshots, { window, instance });
  const releaseRows = collectReleaseRowsWithinWindow({ releaseReport: loaded?.release_report, window })
    .filter((row) => matchesInstance(row, instance));

  let payload = {};
  switch (normalizedView) {
    case "throughput":
      payload = computeThroughput({ events: filteredEvents });
      break;
    case "failure-rates":
      payload = computeFailureRates({ events: filteredEvents, releaseRows });
      break;
    case "backlog-age":
      payload = computeBacklogAge({ snapshots: filteredSnapshots });
      break;
    case "model-cost":
      payload = computeModelCost({ events: filteredEvents, profile });
      break;
    case "version-drift":
      payload = addVersionDelta(computeVersionDrift({ releaseRows, events: filteredEvents }));
      break;
    case "host-pressure": {
      const pointInWindow = withinWindow(nowEpochMs, window);
      payload = computeHostPressure({
        hostStatus: pointInWindow ? loaded?.host_status : null,
        events: filteredEvents,
      });
      break;
    }
    case "time-to-resolution":
      payload = computeTimeToResolution({ events: filteredEvents });
      break;
    default:
      payload = {};
  }

  return {
    schema: FLEET_REPORT_SCHEMA,
    generated_at: new Date(nowEpochMs).toISOString(),
    view: normalizedView,
    factory_id: trim(factoryId),
    instance_id: trim(instance),
    window: {
      from: window.from,
      to: window.to,
    },
    filters: {
      profile: trim(profile),
      event_limit: Math.max(1, Number(eventLimit) || 500),
    },
    warnings: Array.isArray(loaded?.warnings) ? loaded.warnings : [],
    payload,
  };
}

function formatRate(rate = 0) {
  const value = asNumber(rate, 0);
  return `${(value * 100).toFixed(2)}%`;
}

function formatDuration(seconds = 0) {
  const total = nonNegative(seconds, 0);
  if (total < 60) return `${total}s`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remain = total % 60;
  if (hours > 0) return `${hours}h${minutes}m${remain}s`;
  return `${minutes}m${remain}s`;
}

export function formatFleetReportHuman(report = {}) {
  const view = trim(report?.view) || "unknown";
  const lines = [
    `Fleet report view=${view} generated_at=${trim(report?.generated_at) || "(unknown)"} window=${trim(report?.window?.from) || "(start)"}..${trim(report?.window?.to) || "(unknown)"}`,
  ];

  const payload = report?.payload && typeof report.payload === "object" ? report.payload : {};

  if (view === "throughput") {
    lines.push(`completed_total=${nonNegative(payload.completed_total, 0)}`);
    for (const row of (Array.isArray(payload.by_instance) ? payload.by_instance : []).slice(0, 5)) {
      lines.push(`  instance=${row.instance_id} completed=${nonNegative(row.completed_count, 0)}`);
    }
  } else if (view === "failure-rates") {
    lines.push(`failed_events=${nonNegative(payload?.totals?.failed_events, 0)} total_events=${nonNegative(payload?.totals?.total_events, 0)} failure_rate=${formatRate(payload?.totals?.failure_rate)}`);
    for (const row of (Array.isArray(payload.by_instance) ? payload.by_instance : []).slice(0, 5)) {
      lines.push(`  instance=${row.instance_id} failed=${nonNegative(row.failed_events, 0)} total=${nonNegative(row.total_events, 0)} rate=${formatRate(row.failure_rate)}`);
    }
  } else if (view === "backlog-age") {
    lines.push(`queue_depth_total=${nonNegative(payload?.totals?.queue_depth_total, 0)} max_oldest=${formatDuration(payload?.totals?.max_oldest_work_age_seconds)}`);
    for (const row of (Array.isArray(payload.by_instance) ? payload.by_instance : []).slice(0, 5)) {
      lines.push(`  instance=${row.instance_id} depth=${nonNegative(row.queue_depth, 0)} oldest=${formatDuration(row.oldest_work_age_seconds)}`);
    }
  } else if (view === "model-cost") {
    lines.push(`cost_state=${trim(payload.cost_state) || "unknown"} events=${nonNegative(payload?.totals?.event_count, 0)} tokens=${nonNegative(payload?.totals?.total_tokens, 0)} total_cost_usd=${Number(payload?.totals?.total_cost_usd || 0).toFixed(6)}`);
    for (const row of (Array.isArray(payload.by_profile) ? payload.by_profile : []).slice(0, 5)) {
      lines.push(`  profile=${row.profile} events=${nonNegative(row.event_count, 0)} tokens=${nonNegative(row.total_tokens, 0)} cost=${Number(row.total_cost_usd || 0).toFixed(6)} missing=${nonNegative(row.missing_estimate_events, 0)}`);
    }
  } else if (view === "version-drift") {
    lines.push(`instances=${nonNegative(payload?.totals?.instance_count, 0)} ready=${nonNegative(payload?.totals?.ready, 0)} blocked=${nonNegative(payload?.totals?.blocked, 0)} lagging=${nonNegative(payload?.totals?.lagging, 0)} unknown=${nonNegative(payload?.totals?.unknown, 0)}`);
    for (const row of (Array.isArray(payload.by_instance) ? payload.by_instance : []).slice(0, 5)) {
      lines.push(`  instance=${row.instance_id} drift=${row.drift_state} current_runtime=${row.current_runtime_version} target_runtime=${row.target_runtime_version} delta=${row.version_delta}`);
    }
  } else if (view === "host-pressure") {
    lines.push(`hosts=${nonNegative(payload?.totals?.host_count, 0)} active_installations=${nonNegative(payload?.totals?.active_installations, 0)} pending_installations=${nonNegative(payload?.totals?.pending_installations, 0)} max_capacity_pressure=${Number(payload?.totals?.max_capacity_pressure || 0).toFixed(4)}`);
    for (const row of (Array.isArray(payload.by_host) ? payload.by_host : []).slice(0, 5)) {
      lines.push(`  host=${row.host_id} status=${row.status} utilization=${Number(row.capacity_utilization || 0).toFixed(4)} lease_saturation=${Number(row.lease_saturation || 0).toFixed(4)} queue_pending=${nonNegative(row.pending_installations, 0)}`);
    }
  } else if (view === "time-to-resolution") {
    lines.push(`sample_count=${nonNegative(payload.sample_count, 0)} mean=${formatDuration(payload.mean_seconds)} p95=${formatDuration(payload.p95_seconds)} unresolved=${nonNegative(payload.unresolved_incident_count, 0)}`);
    for (const row of (Array.isArray(payload.by_instance) ? payload.by_instance : []).slice(0, 5)) {
      lines.push(`  instance=${row.instance_id} samples=${nonNegative(row.sample_count, 0)} mean=${formatDuration(row.mean_seconds)} p95=${formatDuration(row.p95_seconds)} unresolved=${nonNegative(row.unresolved_incident_count, 0)}`);
    }
  }

  if (Array.isArray(report?.warnings) && report.warnings.length > 0) {
    lines.push(`warnings=${report.warnings.length} first=${report.warnings[0]}`);
  }

  return lines.join("\n");
}
