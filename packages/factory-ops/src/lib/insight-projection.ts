import { normalizeGraphLabel } from "./factory-insight-contract.ts";
import { readAllRunStates } from "./factory-status-support.ts";

const INSIGHT_PROJECTION_SCHEMA_VERSION = "factory_insight_projection/v1";
const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_TOP = 5;

/**
 * Stable projection contract for first-party insight queries.
 *
 * Event names are aligned with `Event.kind` in
 * `packages/factory-telemetry/src/events.ts`:
 * - failures -> stage.error
 * - retries  -> stage.retry
 * - latency  -> stage.finish
 */
export const INSIGHT_PROJECTION_CONTRACT = Object.freeze({
  schema_version: INSIGHT_PROJECTION_SCHEMA_VERSION,
  source_event_contract: "packages/factory-telemetry/src/events.ts#Event",
  projections: {
    failure_signatures: {
      event_name: "stage.error",
      metric_names: ["failure_count", "run_count"],
      required_fields: [
        "signature",
        "graph_id",
        "node_name",
        "error_class",
        "failure_count",
        "run_count",
        "first_timestamp",
        "last_timestamp",
      ],
    },
    retry_hotspots: {
      event_name: "stage.retry",
      metric_names: ["retry_count", "run_count", "max_attempt", "avg_attempt"],
      required_fields: [
        "graph_id",
        "node_name",
        "retry_count",
        "run_count",
        "max_attempt",
        "avg_attempt",
        "last_timestamp",
      ],
    },
    latency_drift: {
      event_name: "stage.finish",
      metric_names: [
        "baseline_p50_ms",
        "baseline_p95_ms",
        "recent_p50_ms",
        "recent_p95_ms",
        "p95_drift_ms",
      ],
      required_fields: [
        "graph_id",
        "node_name",
        "baseline_sample_count",
        "recent_sample_count",
        "baseline_p95_ms",
        "recent_p95_ms",
        "p95_drift_ms",
        "drift_direction",
      ],
    },
  },
});

function trim(value = "") {
  return String(value || "").trim();
}

function toPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTimestampMs(value = "") {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function percentile(sortedValues = [], p = 0.5) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return null;
  const rank = Math.ceil(sortedValues.length * p);
  const index = Math.max(0, Math.min(sortedValues.length - 1, rank - 1));
  return sortedValues[index] ?? null;
}

function normalizeErrorClass(error = "") {
  const raw = trim(error).toLowerCase();
  if (!raw) return "unknown";
  if (raw.includes("timeout") || raw.includes("timed out")) return "timeout";
  if (raw.includes("rate limit")) return "rate_limit";
  if (raw.includes("assert")) return "assertion";
  if (raw.includes("typeerror")) return "type_error";
  if (raw.includes("syntax") || raw.includes("parse")) return "parse_error";
  if (raw.includes("auth") || raw.includes("unauthorized") || raw.includes("forbidden")) return "auth";
  if (raw.includes("network") || raw.includes("econn") || raw.includes("connection")) return "network";
  return "other";
}

function normalizeErrorFingerprint(error = "") {
  const head = trim(error).split("\n")[0] || "unknown_error";
  return head
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .slice(0, 120)
    .trim() || "unknown_error";
}

function matchFilter(value = "", filter = "") {
  const expected = trim(filter).toLowerCase();
  if (!expected) return true;
  return trim(value).toLowerCase().includes(expected);
}

function normalizeFilters({ lookbackHours = DEFAULT_LOOKBACK_HOURS, top = DEFAULT_TOP, graph = "", node = "" } = {}) {
  return {
    lookback_hours: toPositiveNumber(lookbackHours, DEFAULT_LOOKBACK_HOURS),
    top: Math.max(1, Math.trunc(toPositiveNumber(top, DEFAULT_TOP))),
    graph: trim(graph),
    node: trim(node),
  };
}

function runGraphId(state = {}) {
  const graph = trim(state.pipelineFile || state.pipeline || state.graph || "");
  return normalizeGraphLabel(graph) || "unknown";
}

function runRecords(state = {}) {
  return Array.isArray(state.records) ? state.records : [];
}

function recordNodeId(record = {}, state = {}) {
  return trim(record.nodeId || state.currentNode || "") || "unknown";
}

function recordStatus(record = {}) {
  return trim(record?.outcome?.status || record.status || "").toLowerCase();
}

function recordTimestampMs(record = {}, state = {}) {
  return parseTimestampMs(record.endedAt)
    || parseTimestampMs(record.startedAt)
    || parseTimestampMs(state.updatedAt)
    || parseTimestampMs(state.startedAt)
    || 0;
}

function recordDurationMs(record = {}) {
  return Math.max(0, Math.trunc(safeNumber(record?.outcome?.durationMs, 0)));
}

function collectStageRecords({ runsDir = ".hatch/runs", lookbackHours = DEFAULT_LOOKBACK_HOURS, graph = "", node = "", nowMs = Date.now() } = {}) {
  const filters = normalizeFilters({ lookbackHours, graph, node });
  const cutoffMs = nowMs - (filters.lookback_hours * 60 * 60 * 1000);
  const states = readAllRunStates({ runsDir });
  const events = [];

  for (const [runId, state] of states.entries()) {
    const graphId = runGraphId(state);
    if (!matchFilter(graphId, filters.graph)) continue;

    for (const record of runRecords(state)) {
      const nodeName = recordNodeId(record, state);
      if (!matchFilter(nodeName, filters.node)) continue;

      const timestampMs = recordTimestampMs(record, state);
      if (timestampMs > 0 && timestampMs < cutoffMs) continue;

      events.push({
        run_id: runId,
        graph_id: graphId,
        node_name: nodeName,
        status: recordStatus(record),
        error: trim(record?.outcome?.error || ""),
        attempt: Math.max(1, Math.trunc(safeNumber(record?.attempt, 1))),
        duration_ms: recordDurationMs(record),
        timestamp_ms: timestampMs,
        timestamp: timestampMs > 0 ? new Date(timestampMs).toISOString() : "",
      });
    }
  }

  return {
    filters,
    cutoff_ms: cutoffMs,
    events,
  };
}

function buildProjectionEnvelope({ projectionType = "", runsDir = ".hatch/runs", filters = {}, nowMs = Date.now(), eventName = "", metricNames = [] } = {}) {
  return {
    schema_version: INSIGHT_PROJECTION_SCHEMA_VERSION,
    projection_type: projectionType,
    source_event_contract: INSIGHT_PROJECTION_CONTRACT.source_event_contract,
    generated_at: new Date(nowMs).toISOString(),
    runs_dir: runsDir,
    filters,
    event_name: eventName,
    metric_names: metricNames,
  };
}

export function aggregateFailureSignatures({ runsDir = ".hatch/runs", lookbackHours = DEFAULT_LOOKBACK_HOURS, top = DEFAULT_TOP, graph = "", node = "", nowMs = Date.now() } = {}) {
  const { filters, events } = collectStageRecords({
    runsDir,
    lookbackHours,
    graph,
    node,
    nowMs,
  });

  const bySignature = new Map();
  for (const event of events) {
    if (event.status !== "failed") continue;
    const errorClass = normalizeErrorClass(event.error);
    const errorFingerprint = normalizeErrorFingerprint(event.error);
    const signature = `${event.graph_id}:${event.node_name}:${errorClass}:${errorFingerprint}`;

    if (!bySignature.has(signature)) {
      bySignature.set(signature, {
        signature,
        graph_id: event.graph_id,
        node_name: event.node_name,
        error_class: errorClass,
        error_fingerprint: errorFingerprint,
        error_message: trim(event.error).split("\n")[0] || "",
        failure_count: 0,
        run_ids: new Set(),
        first_timestamp_ms: event.timestamp_ms || Number.POSITIVE_INFINITY,
        last_timestamp_ms: event.timestamp_ms || 0,
      });
    }

    const row = bySignature.get(signature);
    row.failure_count += 1;
    row.run_ids.add(event.run_id);
    if (event.timestamp_ms > 0) {
      row.first_timestamp_ms = Math.min(row.first_timestamp_ms, event.timestamp_ms);
      row.last_timestamp_ms = Math.max(row.last_timestamp_ms, event.timestamp_ms);
    }
  }

  const rows = [...bySignature.values()]
    .map((row) => ({
      signature: row.signature,
      graph_id: row.graph_id,
      node_name: row.node_name,
      error_class: row.error_class,
      error_fingerprint: row.error_fingerprint,
      error_message: row.error_message,
      failure_count: row.failure_count,
      run_count: row.run_ids.size,
      first_timestamp: Number.isFinite(row.first_timestamp_ms) && row.first_timestamp_ms > 0
        ? new Date(row.first_timestamp_ms).toISOString()
        : "",
      last_timestamp: row.last_timestamp_ms > 0 ? new Date(row.last_timestamp_ms).toISOString() : "",
      event_name: "stage.error",
    }))
    .sort((left, right) => right.failure_count - left.failure_count
      || right.run_count - left.run_count
      || String(left.signature).localeCompare(String(right.signature)));

  const limitedRows = rows.slice(0, normalizeFilters({ top }).top);

  return {
    ...buildProjectionEnvelope({
      projectionType: "failure_signatures",
      runsDir,
      filters: {
        lookback_hours: filters.lookback_hours,
        graph: filters.graph,
        node: filters.node,
        top: normalizeFilters({ top }).top,
      },
      nowMs,
      eventName: "stage.error",
      metricNames: INSIGHT_PROJECTION_CONTRACT.projections.failure_signatures.metric_names,
    }),
    total_failure_events: rows.reduce((sum, row) => sum + row.failure_count, 0),
    total_signatures: rows.length,
    rows: limitedRows,
  };
}

export function aggregateRetryHotspots({ runsDir = ".hatch/runs", lookbackHours = DEFAULT_LOOKBACK_HOURS, top = DEFAULT_TOP, graph = "", node = "", nowMs = Date.now() } = {}) {
  const { filters, events } = collectStageRecords({
    runsDir,
    lookbackHours,
    graph,
    node,
    nowMs,
  });

  const byHotspot = new Map();
  for (const event of events) {
    if (event.attempt <= 1) continue;
    const key = `${event.graph_id}:${event.node_name}`;

    if (!byHotspot.has(key)) {
      byHotspot.set(key, {
        graph_id: event.graph_id,
        node_name: event.node_name,
        retry_count: 0,
        attempt_sum: 0,
        max_attempt: 0,
        run_ids: new Set(),
        last_timestamp_ms: 0,
      });
    }

    const row = byHotspot.get(key);
    row.retry_count += 1;
    row.attempt_sum += event.attempt;
    row.max_attempt = Math.max(row.max_attempt, event.attempt);
    row.run_ids.add(event.run_id);
    row.last_timestamp_ms = Math.max(row.last_timestamp_ms, event.timestamp_ms || 0);
  }

  const rows = [...byHotspot.values()]
    .map((row) => ({
      graph_id: row.graph_id,
      node_name: row.node_name,
      retry_count: row.retry_count,
      run_count: row.run_ids.size,
      max_attempt: row.max_attempt,
      avg_attempt: row.retry_count > 0 ? Number((row.attempt_sum / row.retry_count).toFixed(2)) : 0,
      last_timestamp: row.last_timestamp_ms > 0 ? new Date(row.last_timestamp_ms).toISOString() : "",
      event_name: "stage.retry",
    }))
    .sort((left, right) => right.retry_count - left.retry_count
      || right.max_attempt - left.max_attempt
      || String(left.graph_id).localeCompare(String(right.graph_id))
      || String(left.node_name).localeCompare(String(right.node_name)));

  const limitedRows = rows.slice(0, normalizeFilters({ top }).top);

  return {
    ...buildProjectionEnvelope({
      projectionType: "retry_hotspots",
      runsDir,
      filters: {
        lookback_hours: filters.lookback_hours,
        graph: filters.graph,
        node: filters.node,
        top: normalizeFilters({ top }).top,
      },
      nowMs,
      eventName: "stage.retry",
      metricNames: INSIGHT_PROJECTION_CONTRACT.projections.retry_hotspots.metric_names,
    }),
    total_retry_events: rows.reduce((sum, row) => sum + row.retry_count, 0),
    hotspot_count: rows.length,
    rows: limitedRows,
  };
}

function classifyDriftDirection(deltaMs) {
  if (!Number.isFinite(deltaMs)) return "unknown";
  if (deltaMs > 0) return "increased";
  if (deltaMs < 0) return "decreased";
  return "flat";
}

export function measureLatencyDrift({ runsDir = ".hatch/runs", lookbackHours = DEFAULT_LOOKBACK_HOURS, top = DEFAULT_TOP, graph = "", node = "", nowMs = Date.now() } = {}) {
  const { filters, events } = collectStageRecords({
    runsDir,
    lookbackHours,
    graph,
    node,
    nowMs,
  });

  const lookbackWindowMs = filters.lookback_hours * 60 * 60 * 1000;
  const recentCutoffMs = nowMs - Math.floor(lookbackWindowMs / 2);
  const bySeries = new Map();

  for (const event of events) {
    if (event.duration_ms <= 0) continue;
    const key = `${event.graph_id}:${event.node_name}`;

    if (!bySeries.has(key)) {
      bySeries.set(key, {
        graph_id: event.graph_id,
        node_name: event.node_name,
        baseline: [],
        recent: [],
      });
    }

    const row = bySeries.get(key);
    if (event.timestamp_ms >= recentCutoffMs) {
      row.recent.push(event.duration_ms);
    } else {
      row.baseline.push(event.duration_ms);
    }
  }

  const rows = [...bySeries.values()]
    .map((row) => {
      const baseline = [...row.baseline].sort((a, b) => a - b);
      const recent = [...row.recent].sort((a, b) => a - b);
      if (baseline.length === 0 || recent.length === 0) return null;

      const baselineP50 = percentile(baseline, 0.5);
      const baselineP95 = percentile(baseline, 0.95);
      const recentP50 = percentile(recent, 0.5);
      const recentP95 = percentile(recent, 0.95);
      const drift = safeNumber(recentP95, 0) - safeNumber(baselineP95, 0);

      return {
        graph_id: row.graph_id,
        node_name: row.node_name,
        baseline_sample_count: baseline.length,
        recent_sample_count: recent.length,
        baseline_p50_ms: baselineP50,
        baseline_p95_ms: baselineP95,
        recent_p50_ms: recentP50,
        recent_p95_ms: recentP95,
        p95_drift_ms: drift,
        drift_direction: classifyDriftDirection(drift),
        event_name: "stage.finish",
      };
    })
    .filter(Boolean)
    .sort((left, right) => Math.abs(right.p95_drift_ms) - Math.abs(left.p95_drift_ms)
      || String(left.graph_id).localeCompare(String(right.graph_id))
      || String(left.node_name).localeCompare(String(right.node_name)));

  const limitedRows = rows.slice(0, normalizeFilters({ top }).top);

  return {
    ...buildProjectionEnvelope({
      projectionType: "latency_drift",
      runsDir,
      filters: {
        lookback_hours: filters.lookback_hours,
        graph: filters.graph,
        node: filters.node,
        top: normalizeFilters({ top }).top,
      },
      nowMs,
      eventName: "stage.finish",
      metricNames: INSIGHT_PROJECTION_CONTRACT.projections.latency_drift.metric_names,
    }),
    series_count: rows.length,
    rows: limitedRows,
  };
}
