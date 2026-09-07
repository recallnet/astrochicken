import { readFileSync } from "node:fs";

import { buildClearedActionState } from "./daemon-control-state.ts";

export const CIRCUIT_BREAKER_MAX_EVIDENCE_CHARS = 1200;

function trim(value = "") {
  return String(value || "").trim();
}

function isCircuitBreakerReason(value = "") {
  const normalized = trim(value).toLowerCase();
  return normalized.startsWith("circuit_breaker_after_") || normalized.startsWith("circuit_breaker_blocking_after_");
}

export function normalizeBreakerThreshold(value = undefined, defaultThreshold = 6) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultThreshold;
  return parsed;
}

function trimTickEvidence(value = "", maxChars = CIRCUIT_BREAKER_MAX_EVIDENCE_CHARS) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(-maxChars);
}

export function readTickFailureEvidence(tickLogPath = "", maxChars = CIRCUIT_BREAKER_MAX_EVIDENCE_CHARS) {
  if (!tickLogPath) return "";
  try {
    const raw = readFileSync(tickLogPath, "utf8");
    return trimTickEvidence(raw, maxChars);
  } catch {
    return "";
  }
}

export function evaluateCircuitBreakerTransition({
  consecutiveFailures = 0,
  tickExitCode = 0,
  threshold = 6,
  tombstone = null,
} = {}) {
  const normalizedFailures = Math.max(0, Number(consecutiveFailures) || 0);
  const normalizedThreshold = normalizeBreakerThreshold(threshold, 6);
  const normalizedExitCode = Number(tickExitCode) || 0;
  const classification = tombstone && typeof tombstone === "object" && tombstone.classification && typeof tombstone.classification === "object"
    ? tombstone.classification
    : {};
  const severity = trim(classification.severity).toLowerCase() || "degrading";
  const crashType = trim(classification.crash_type).toLowerCase() || "unknown";
  const resolutionType = trim(classification.resolution_type) || "cooldown_auto_retry";
  const tombstoneId = trim(tombstone?.tombstone_id || "");

  if (normalizedExitCode === 0) {
    return {
      nextConsecutiveFailures: 0,
      shouldTrip: false,
      reset: normalizedFailures > 0,
      countFailure: false,
      threshold: normalizedThreshold,
      severity: "",
      crashType: "",
      resolutionType: "",
      action: "reset",
      tombstoneId: "",
    };
  }
  if (severity === "informational") {
    return {
      nextConsecutiveFailures: normalizedFailures,
      shouldTrip: false,
      reset: false,
      countFailure: false,
      threshold: normalizedThreshold,
      severity,
      crashType,
      resolutionType,
      action: "log",
      tombstoneId,
    };
  }
  if (severity === "blocking") {
    return {
      nextConsecutiveFailures: normalizedFailures + 1,
      shouldTrip: true,
      reset: false,
      countFailure: true,
      threshold: 1,
      severity,
      crashType,
      resolutionType,
      action: "trip_and_route_foreman",
      tombstoneId,
    };
  }
  const nextConsecutiveFailures = normalizedFailures + 1;
  return {
    nextConsecutiveFailures,
    shouldTrip: nextConsecutiveFailures >= normalizedThreshold,
    reset: false,
    countFailure: true,
    threshold: normalizedThreshold,
    severity,
    crashType,
    resolutionType,
    action: "standard",
    tombstoneId,
  };
}

export function evaluateCircuitBreakerCooldown({
  reason = "",
  notes = [],
  now = new Date(),
  cooldownMs = 30 * 60_000,
} = {}) {
  if (!isCircuitBreakerReason(reason)) {
    return { shouldRetry: false, elapsedMs: 0, cooldownMs };
  }
  const pauseNote = [...(Array.isArray(notes) ? notes : [])].reverse().find(
    (note) => trim(note?.action) === "pause" && isCircuitBreakerReason(note?.reason),
  );
  if (!pauseNote?.at) {
    return { shouldRetry: false, elapsedMs: 0, cooldownMs };
  }
  const pausedAtMs = Date.parse(pauseNote.at);
  if (!Number.isFinite(pausedAtMs)) {
    return { shouldRetry: false, elapsedMs: 0, cooldownMs };
  }
  const elapsedMs = now.getTime() - pausedAtMs;
  return { shouldRetry: elapsedMs >= cooldownMs, elapsedMs, cooldownMs };
}

export function tripCircuitBreaker({
  runtime = {},
  repoRoot = process.cwd(),
  controlState = {},
  tickResult = {},
  failureCount = 0,
  threshold = 6,
  writeControlStateFn,
  emitBugIssueFn,
  readTickFailureEvidenceFn = readTickFailureEvidence,
  nowIso = new Date().toISOString(),
} = {}) {
  const normalizedFailureCount = Math.max(0, Number(failureCount) || 0);
  const normalizedThreshold = normalizeBreakerThreshold(threshold, 6);
  const lastExitCode = Number(tickResult?.exitCode) || 1;
  const tombstoneClassification = tickResult?.failureTombstone?.classification && typeof tickResult.failureTombstone.classification === "object"
    ? tickResult.failureTombstone.classification
    : {};
  const normalizedSeverity = trim(tombstoneClassification.severity).toLowerCase() || "degrading";
  const normalizedCrashType = trim(tombstoneClassification.crash_type).toLowerCase() || "daemon_circuit_breaker";
  const normalizedResolutionType = trim(tombstoneClassification.resolution_type) || "cooldown_auto_retry";
  const normalizedClassification = trim(tombstoneClassification.classification).toLowerCase();
  const tombstoneId = trim(tickResult?.failureTombstone?.tombstone_id || "");
  const defaultBreakerReason = `circuit_breaker_after_${normalizedFailureCount}_failures`;
  const resolvedBreakerReason = normalizedSeverity === "blocking"
    ? `circuit_breaker_blocking_after_${normalizedFailureCount}_failures`
    : defaultBreakerReason;
  const stderrSnippet = readTickFailureEvidenceFn(tickResult?.tickLogPath || "");

  const evidence = {
    factory_id: runtime.factoryId,
    target_repo: runtime.targetRepo,
    threshold: normalizedThreshold,
    consecutive_failures: normalizedFailureCount,
    last_exit_code: lastExitCode,
    run_id: tickResult?.runId || "",
    tick_log_path: tickResult?.tickLogPath || "",
    stderr_snippet: stderrSnippet,
    tombstone_id: tombstoneId,
    severity: normalizedSeverity,
    crash_type: normalizedCrashType,
    resolution_type: normalizedResolutionType,
    classification: normalizedClassification,
    observed_behavior: `Daemon paused ${runtime.factoryId} after ${normalizedFailureCount} consecutive ${normalizedSeverity || "degrading"} tick failures.`,
    expected_behavior: "Managed factory ticks should keep running until the control-plane incident is triaged or the operator resumes the daemon.",
    remediation_attempts: "Circuit breaker paused the daemon, preserved retry_target, and routed the incident to the control-plane bug owner.",
  };

  const nextState = writeControlStateFn({
    factoryId: runtime.factoryId,
    rootDir: repoRoot,
    actor: "daemon",
    reason: resolvedBreakerReason,
    nextState: {
      action_state: {
        ...buildClearedActionState(controlState?.action_state || {}),
        pause: { active: true },
      },
      reason: resolvedBreakerReason,
      retry_target: tickResult?.runId || "",
      notes: [
        ...(Array.isArray(controlState?.notes) ? controlState.notes : []),
        {
          at: nowIso,
          actor: "daemon",
          action: "pause",
          reason: resolvedBreakerReason,
          retry_target: tickResult?.runId || "",
          resolution_type: normalizedResolutionType,
          tombstone_id: tombstoneId,
        },
      ],
    },
  });

  const emitted = emitBugIssueFn({
    repo: runtime.controlPlaneRepo || runtime.targetRepo,
    bugType: "managed-daemon-circuit-breaker",
    summary: `Daemon paused ${runtime.factoryId} after ${normalizedFailureCount} consecutive tick failures`,
    evidence,
    labels: [`kind:${runtime.factoryId}`, "managed-factory-bug", "incident-fingerprint"],
    runId: tickResult?.runId || "daemon-loop",
    pipeline: "daemon",
    factoryId: runtime.factoryId,
    sourceFactory: runtime.factoryId,
    sourceRepo: runtime.targetRepo,
    severity: normalizedSeverity,
    crashType: normalizedCrashType,
    classification: normalizedClassification,
  });

  return {
    breakerReason: resolvedBreakerReason,
    evidence,
    emitted,
    nextState,
    threshold: normalizedThreshold,
    failureCount: normalizedFailureCount,
    severity: normalizedSeverity,
    resolutionType: normalizedResolutionType,
    tombstoneId,
  };
}
