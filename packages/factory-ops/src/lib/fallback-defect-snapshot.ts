import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { trim } from "./cli-helpers.ts";

const FALLBACK_DEFECT_SCHEMA = "fallback_defect/v1";
const FALLBACK_DEFECT_CLASSIFICATIONS = new Set([
  "llm_output_malformed",
  "llm_output_empty",
  "pipeline_transport_defect",
  "contract_violation",
  "external_service_failure",
]);
const FALLBACK_DEFECT_LLM_WINDOW_MS = 24 * 60 * 60 * 1000;
const FALLBACK_DEFECT_EXTERNAL_WINDOW_MS = 60 * 60 * 1000;
export const FALLBACK_DEFECT_LLM_ESCALATE_THRESHOLD = 2;
export const FORCE_MERGE_ESCALATE_THRESHOLD = 3;
const FALLBACK_DEFECT_EXTERNAL_ESCALATE_THRESHOLD = 3;

function parseJson(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function asPositiveInt(value) {
  const n = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function asNullableBoolean(value) {
  const normalized = trim(value).toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return null;
}

function asNullableInteger(value) {
  const normalized = trim(value);
  if (!normalized) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

function normalizeFallbackClassification(value = "") {
  const normalized = trim(value).toLowerCase();
  if (FALLBACK_DEFECT_CLASSIFICATIONS.has(normalized)) return normalized;
  return "contract_violation";
}

function deriveFallbackSeverity(classification = "") {
  if (classification === "pipeline_transport_defect" || classification === "contract_violation") return "high";
  return "medium";
}

function asSignalTimestampMs(value, fallbackMs = 0) {
  const raw = trim(value);
  if (!raw) return fallbackMs;
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return parsed;
  return fallbackMs;
}

function signalRecurrenceKey(signal = {}) {
  return [
    trim(signal.pipeline),
    trim(signal.fallback_node),
    trim(signal.trigger_reason),
  ].join("::");
}

function buildLatestClosedBugMap(closedBugHistory = []) {
  const byKey = new Map();
  for (const item of Array.isArray(closedBugHistory) ? closedBugHistory : []) {
    const recurrenceKey = trim(item?.recurrence_key);
    const closedAtMs = asSignalTimestampMs(item?.closed_at, Number.NaN);
    if (!recurrenceKey || !Number.isFinite(closedAtMs)) continue;
    const existing = byKey.get(recurrenceKey);
    if (!Number.isFinite(existing) || closedAtMs > existing) {
      byKey.set(recurrenceKey, closedAtMs);
    }
  }
  return byKey;
}

function filterSignalsAfterLatestClosedBug({ signals = [], closedBugHistory = [] } = {}) {
  const latestClosedByKey = buildLatestClosedBugMap(closedBugHistory);
  if (latestClosedByKey.size === 0) return Array.isArray(signals) ? signals : [];
  return (Array.isArray(signals) ? signals : []).filter((signal) => {
    const recurrenceKey = signalRecurrenceKey(signal);
    const latestClosedAtMs = latestClosedByKey.get(recurrenceKey);
    if (!Number.isFinite(latestClosedAtMs)) return true;
    const emittedAtMs = Number.isFinite(signal?.emitted_at_ms) ? signal.emitted_at_ms : Number.NaN;
    if (!Number.isFinite(emittedAtMs)) return true;
    return emittedAtMs > latestClosedAtMs;
  });
}

function summarizeFallbackDefect(signal = {}) {
  const node = trim(signal.fallback_node) || "unknown_fallback_node";
  const contradiction = signal?.contradiction && typeof signal.contradiction === "object"
    ? signal.contradiction
    : {};
  const approved = contradiction.approved === true;
  const parseStatus = trim(contradiction.decompose_parse_status).toLowerCase();
  const postNormalizeCount = Number(contradiction.post_normalize_feature_count);
  const issuesCreated = Number(contradiction.issues_created);

  if (approved && parseStatus === "valid_json" && postNormalizeCount === 0) {
    if (Number.isFinite(issuesCreated) && issuesCreated === 0) {
      return `${node} produced 0 issues after an approved/valid parse`;
    }
    return `${node} produced 0 normalized features after an approved/valid parse`;
  }

  const triggerReason = trim(signal.trigger_reason) || "fallback_triggered";
  return `${node} fallback triggered (${triggerReason})`;
}

function buildFallbackRecurrenceStats({ signals = [], nowMs = Date.now() } = {}) {
  const statsByKey = new Map();
  for (const signal of signals) {
    const key = signalRecurrenceKey(signal);
    const signalTsMs = Number.isFinite(signal?.emitted_at_ms) ? signal.emitted_at_ms : nowMs;
    const ageMs = Math.max(0, nowMs - signalTsMs);
    const nextStats = statsByKey.get(key) || {
      total: 0,
      count_24h: 0,
      count_1h: 0,
    };
    nextStats.total += 1;
    if (ageMs <= FALLBACK_DEFECT_LLM_WINDOW_MS) nextStats.count_24h += 1;
    if (ageMs <= FALLBACK_DEFECT_EXTERNAL_WINDOW_MS) nextStats.count_1h += 1;
    statsByKey.set(key, nextStats);
  }
  return statsByKey;
}

function determineFallbackSuggestedAction(signal = {}, recurrence = {}) {
  const classification = normalizeFallbackClassification(signal?.classification || "");
  const pipeline = trim(signal?.pipeline || "");
  const fallbackNode = trim(signal?.fallback_node || "");
  const triggerReason = trim(signal?.trigger_reason || "");

  if (
    pipeline === "wave_issue_execute"
    && fallbackNode === "report_approved"
    && triggerReason === "review_retry_exhausted_force_merge"
  ) {
    const count24h = Number(recurrence?.count_24h || 0);
    if (count24h > FORCE_MERGE_ESCALATE_THRESHOLD) {
      return {
        suggested_action: "file_bug",
        escalated: true,
        escalation_reason: "force_merge_rate_exceeds_threshold",
      };
    }
    return {
      suggested_action: "log_and_monitor",
      escalated: false,
      escalation_reason: "force_merge_degraded_mode_expected",
    };
  }

  if (classification === "pipeline_transport_defect" || classification === "contract_violation") {
    return {
      suggested_action: "file_bug",
      escalated: true,
      escalation_reason: "classification_requires_bug",
    };
  }

  if (classification === "llm_output_malformed" || classification === "llm_output_empty") {
    const count24h = Number(recurrence?.count_24h || 0);
    if (count24h > FALLBACK_DEFECT_LLM_ESCALATE_THRESHOLD) {
      return {
        suggested_action: "file_bug",
        escalated: true,
        escalation_reason: `llm_recurrence_24h>${FALLBACK_DEFECT_LLM_ESCALATE_THRESHOLD}`,
      };
    }
    return {
      suggested_action: "monitor_retry",
      escalated: false,
      escalation_reason: "below_llm_recurrence_threshold",
    };
  }

  if (classification === "external_service_failure") {
    const count1h = Number(recurrence?.count_1h || 0);
    if (count1h > FALLBACK_DEFECT_EXTERNAL_ESCALATE_THRESHOLD) {
      return {
        suggested_action: "file_bug",
        escalated: true,
        escalation_reason: `external_failure_recurrence_1h>${FALLBACK_DEFECT_EXTERNAL_ESCALATE_THRESHOLD}`,
      };
    }
    return {
      suggested_action: "log_and_monitor",
      escalated: false,
      escalation_reason: "below_external_failure_threshold",
    };
  }

  return {
    suggested_action: "monitor_retry",
    escalated: false,
    escalation_reason: "default_monitor_retry",
  };
}

function normalizeFallbackDefectSignal(raw = {}, { runId = "", artifactPath = "", artifactMtimeMs = 0 } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const contradictionRaw = raw?.contradiction && typeof raw.contradiction === "object"
    ? raw.contradiction
    : {};
  const evidence = raw?.evidence && typeof raw.evidence === "object"
    ? raw.evidence
    : {};

  const classification = normalizeFallbackClassification(raw.classification || "");
  const severity = trim(raw.severity).toLowerCase() || deriveFallbackSeverity(classification);
  const goalIssue = asPositiveInt(
    raw.goal_issue
    || raw.goal_issue_number
    || evidence.goal_issue
    || evidence.goal_issue_number,
  );
  const emittedAt = trim(raw.emitted_at || raw.emittedAt || evidence.emitted_at || "");
  const emittedAtMs = asSignalTimestampMs(emittedAt, artifactMtimeMs);

  return {
    schema: trim(raw.schema) || FALLBACK_DEFECT_SCHEMA,
    fallback_node: trim(raw.fallback_node || raw.fallbackNode),
    pipeline: trim(raw.pipeline),
    run_id: trim(raw.run_id || raw.runId) || trim(runId),
    trigger_reason: trim(raw.trigger_reason || raw.triggerReason) || "fallback_triggered",
    contradiction: {
      approved: asNullableBoolean(firstDefined(contradictionRaw.approved, contradictionRaw.is_approved)),
      decompose_parse_status: trim(firstDefined(contradictionRaw.decompose_parse_status, contradictionRaw.decomposeParseStatus)),
      pre_normalize_feature_count: asNullableInteger(
        firstDefined(contradictionRaw.pre_normalize_feature_count, contradictionRaw.preNormalizeFeatureCount),
      ),
      post_normalize_feature_count: asNullableInteger(
        firstDefined(contradictionRaw.post_normalize_feature_count, contradictionRaw.postNormalizeFeatureCount),
      ),
      issues_created: asNullableInteger(firstDefined(contradictionRaw.issues_created, contradictionRaw.issuesCreated)),
    },
    classification,
    severity,
    goal_issue: goalIssue > 0 ? goalIssue : 0,
    otel_span: raw.otel_span || evidence.otel_span || evidence.otel || null,
    emitted_at: emittedAt || (Number.isFinite(emittedAtMs) && emittedAtMs > 0 ? new Date(emittedAtMs).toISOString() : ""),
    emitted_at_ms: Number.isFinite(emittedAtMs) ? emittedAtMs : 0,
    artifact_path: String(artifactPath || ""),
  };
}

export function loadFallbackDefectSignals({ runsDir = ".hatch/runs", nowMs = Date.now(), snapshotErrors = [] } = {}) {
  const signals = [];
  let runEntries = [];

  try {
    runEntries = readdirSync(runsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => String(a).localeCompare(String(b)));
  } catch {
    return signals;
  }

  for (const runId of runEntries) {
    const candidateDirs = [
      join(runsDir, runId, "fallback_defects"),
      join(runsDir, runId, "fallback-defects"),
      join(runsDir, runId, "artifacts", "fallback_defects"),
      join(runsDir, runId, "artifacts", "fallback-defects"),
    ];

    for (const defectsDir of candidateDirs) {
      if (!existsSync(defectsDir)) continue;
      let files = [];
      try {
        files = readdirSync(defectsDir)
          .filter((fileName) => fileName.endsWith(".json"))
          .sort((a, b) => a.localeCompare(b));
      } catch (error) {
        snapshotErrors.push(
          `fallback_defect_list_error:run=${runId}:dir=${defectsDir}:${String(error?.message || error || "unknown_error")}`,
        );
        continue;
      }

      for (const fileName of files) {
        const artifactPath = join(defectsDir, fileName);
        try {
          const raw = parseJson(readFileSync(artifactPath, "utf8"), null);
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            throw new Error("fallback_defect_invalid_json_shape");
          }
          const artifactStats = statSync(artifactPath);
          const signal = normalizeFallbackDefectSignal(raw, {
            runId,
            artifactPath,
            artifactMtimeMs: Number.isFinite(artifactStats.mtimeMs) ? artifactStats.mtimeMs : nowMs,
          });
          if (!signal || !trim(signal.fallback_node) || !trim(signal.pipeline) || !trim(signal.run_id)) {
            throw new Error("fallback_defect_missing_required_fields");
          }
          signals.push(signal);
        } catch (error) {
          snapshotErrors.push(
            `fallback_defect_parse_error:run=${runId}:file=${fileName}:${String(error?.message || error || "invalid_json")}`,
          );
        }
      }
    }
  }

  return signals.sort((a, b) => {
    const pipelineCmp = String(a.pipeline || "").localeCompare(String(b.pipeline || ""));
    if (pipelineCmp !== 0) return pipelineCmp;
    const nodeCmp = String(a.fallback_node || "").localeCompare(String(b.fallback_node || ""));
    if (nodeCmp !== 0) return nodeCmp;
    const runCmp = String(a.run_id || "").localeCompare(String(b.run_id || ""));
    if (runCmp !== 0) return runCmp;
    const tsCmp = Number(a.emitted_at_ms || 0) - Number(b.emitted_at_ms || 0);
    if (tsCmp !== 0) return tsCmp;
    return String(a.artifact_path || "").localeCompare(String(b.artifact_path || ""));
  });
}

export function buildFallbackDefectActionItems({ signals = [], nowMs = Date.now(), closedBugHistory = [] } = {}) {
  const filteredSignals = filterSignalsAfterLatestClosedBug({ signals, closedBugHistory });
  const recurrenceStats = buildFallbackRecurrenceStats({ signals: filteredSignals, nowMs });

  return filteredSignals.map((signal) => {
    const recurrenceKey = signalRecurrenceKey(signal);
    const recurrence = recurrenceStats.get(recurrenceKey) || { total: 0, count_24h: 0, count_1h: 0 };
    const actionDecision = determineFallbackSuggestedAction(signal, recurrence);
    const summary = summarizeFallbackDefect(signal);
    const recurrence24hThreshold = (
      trim(signal?.pipeline) === "wave_issue_execute"
      && trim(signal?.fallback_node) === "report_approved"
      && trim(signal?.trigger_reason) === "review_retry_exhausted_force_merge"
    )
      ? FORCE_MERGE_ESCALATE_THRESHOLD
      : FALLBACK_DEFECT_LLM_ESCALATE_THRESHOLD;

    const evidence = {
      contradiction: signal.contradiction || {},
      trigger_reason: signal.trigger_reason,
      recurrence_key: recurrenceKey,
      emitted_at: signal.emitted_at,
    };
    if (signal.goal_issue > 0) evidence.goal_issue = signal.goal_issue;
    if (signal.otel_span) evidence.otel_span = signal.otel_span;

    return {
      type: "fallback_defect",
      source_run: signal.run_id,
      source_node: signal.fallback_node,
      pipeline: signal.pipeline,
      classification: signal.classification,
      severity: signal.severity,
      summary,
      problem: `FALLBACK_DEFECT: ${summary}`,
      suggested_action: actionDecision.suggested_action,
      diagnostics: {
        schema: signal.schema,
        trigger_reason: signal.trigger_reason,
        recurrence_key: recurrenceKey,
        recurrence_total: recurrence.total,
        recurrence_24h_count: recurrence.count_24h,
        recurrence_24h_threshold: recurrence24hThreshold,
        recurrence_1h_count: recurrence.count_1h,
        recurrence_1h_threshold: FALLBACK_DEFECT_EXTERNAL_ESCALATE_THRESHOLD,
        escalated: actionDecision.escalated,
        escalation_reason: actionDecision.escalation_reason,
      },
      evidence,
    };
  });
}
