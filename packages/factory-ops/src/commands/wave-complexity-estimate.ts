import { spawnSync } from "node:child_process";

import { trim, parseJson } from "../lib/cli-helpers.ts";


function toStringMap(obj = {}) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (value === undefined || value === null) continue;
    out[String(key)] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return out;
}

function normalizeEstimatorSignals(obj = {}) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (value === undefined || value === null) continue;
    if (typeof value === "object" && !Array.isArray(value)) {
      const detail = value;
      if (detail.value !== undefined && detail.value !== null) {
        out[String(key)] = String(detail.value);
      }
      if (detail.reason !== undefined && detail.reason !== null) {
        out[`${String(key)}.reason`] = String(detail.reason);
      }
      if (detail.score !== undefined && detail.score !== null) {
        out[`${String(key)}.score`] = String(detail.score);
      }
      if (detail._unknown !== undefined && detail._unknown !== null) {
        out[`${String(key)}._unknown`] = String(detail._unknown);
      }
      if (!(String(key) in out)) {
        out[String(key)] = JSON.stringify(value);
      }
      continue;
    }
    out[String(key)] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return out;
}

export const COMPLEXITY_ESTIMATE_FALLBACK = {
  complexity_class: "high",
  complexity_signals: "{}",
  complexity_reason: "class=high;reason=complexity_estimate_failed",
  complexity_otel_key: "hatch.complexity.class",
};

export function waveComplexityEstimate({
  input = "",
  issueTitle = "",
  issueBody = "",
  changedFiles = "",
  estimatedLinesAdded = "",
  estimatedLinesDeleted = "",
  estimatedFileCount = "",
  dependencyCount = "",
  blockedByCount = "",
  blocksCount = "",
  qaCommand = "",
} = {}) {
  const args = ["complexity", "estimate"];

  if (String(input || "").trim()) args.push("--input", String(input));
  if (String(issueTitle || "").trim()) args.push("--issue-title", String(issueTitle));
  if (String(issueBody || "").trim()) args.push("--issue-body", String(issueBody));
  if (String(changedFiles || "").trim()) args.push("--changed-files", String(changedFiles));
  if (String(estimatedLinesAdded || "").trim()) args.push("--estimated-lines-added", String(estimatedLinesAdded));
  if (String(estimatedLinesDeleted || "").trim()) args.push("--estimated-lines-deleted", String(estimatedLinesDeleted));
  if (String(estimatedFileCount || "").trim()) args.push("--estimated-file-count", String(estimatedFileCount));
  if (String(dependencyCount || "").trim()) args.push("--dependency-count", String(dependencyCount));
  if (String(blockedByCount || "").trim()) args.push("--blocked-by-count", String(blockedByCount));
  if (String(blocksCount || "").trim()) args.push("--blocks-count", String(blocksCount));
  if (String(qaCommand || "").trim()) args.push("--qa-command", String(qaCommand));

  const child = spawnSync("hatch", args, { encoding: "utf8" });
  const stderr = String(child.stderr || "").trim();
  if ((child.status ?? 1) !== 0) {
    return {
      ok: false,
      exit_code: String(child.status ?? 1),
      error: stderr || "complexity_estimate_failed",
      ...COMPLEXITY_ESTIMATE_FALLBACK,
      telemetry: {
        ...COMPLEXITY_ESTIMATE_FALLBACK,
        [COMPLEXITY_ESTIMATE_FALLBACK.complexity_otel_key]: COMPLEXITY_ESTIMATE_FALLBACK.complexity_class,
      },
    };
  }

  const parsed = parseJson(String(child.stdout || "{}"), null);
  const parsedTelemetry = parsed?.telemetry && typeof parsed.telemetry === "object"
    ? toStringMap(parsed.telemetry)
    : null;

  const complexityClass = String(
    parsed?.complexity_class || parsedTelemetry?.complexity_class || COMPLEXITY_ESTIMATE_FALLBACK.complexity_class,
  );
  const complexitySignals = parsed?.signals && typeof parsed.signals === "object"
    ? normalizeEstimatorSignals(parsed.signals)
    : {};
  const complexityReason = String(
    parsed?.reason || parsedTelemetry?.complexity_reason || `class=${COMPLEXITY_ESTIMATE_FALLBACK.complexity_class};reason=missing_reason`,
  );
  const complexityOtelKey = String(
    parsed?.otel_dimension_key || parsedTelemetry?.complexity_otel_key || "hatch.complexity.class",
  );

  const derivedTelemetry = {
    complexity_class: complexityClass,
    complexity_signals: JSON.stringify(toStringMap(complexitySignals)),
    complexity_reason: complexityReason,
    complexity_otel_key: complexityOtelKey,
    [complexityOtelKey]: complexityClass,
  };

  const telemetry = parsedTelemetry && parsedTelemetry.complexity_signals
    ? {
      ...derivedTelemetry,
      ...parsedTelemetry,
      complexity_class: complexityClass,
      complexity_reason: complexityReason,
      complexity_otel_key: complexityOtelKey,
      [complexityOtelKey]: String(parsedTelemetry[complexityOtelKey] || complexityClass),
    }
    : derivedTelemetry;

  return {
    ok: true,
    exit_code: "0",
    error: "",
    complexity_class: complexityClass,
    complexity_signals: telemetry.complexity_signals,
    complexity_reason: complexityReason,
    complexity_otel_key: complexityOtelKey,
    telemetry,
    estimate: parsed,
  };
}
