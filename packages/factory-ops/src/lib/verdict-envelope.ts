import { parseJson, trim } from "./cli-helpers.ts";

export const VERDICT_SCHEMA_VERSION = "verdict/v1";
export const VERDICT_DISPOSITIONS = new Set(["approve", "reject", "defer", "escalate"]);
export const VERDICT_CONFIDENCE = new Set(["high", "medium", "low"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => trim(entry)).filter(Boolean);
}

function ensureObject(value) {
  if (!isPlainObject(value)) return {};
  return value;
}

export function buildVerdictEnvelope({
  verdictKind = "",
  disposition = "",
  confidence = "medium",
  recommendedTransition = "",
  observation = {},
  recommendation = {},
  reasonCodes = [],
  notes = "",
} = {}) {
  return {
    schema: VERDICT_SCHEMA_VERSION,
    verdict_kind: trim(verdictKind),
    disposition: trim(disposition).toLowerCase(),
    confidence: trim(confidence).toLowerCase(),
    recommended_transition: trim(recommendedTransition),
    observation: ensureObject(observation),
    recommendation: ensureObject(recommendation),
    reason_codes: normalizeStringArray(reasonCodes),
    notes: trim(notes),
  };
}

export function parseVerdictEnvelopeRaw(raw = "") {
  const value = parseJson(String(raw || ""), null);
  if (!isPlainObject(value)) return null;
  return value;
}

export function validateVerdictEnvelope(value = {}, {
  expectedKind = "",
  allowedTransitions = null,
  requireNotes = false,
  requiredReasonCodes = false,
} = {}) {
  const verdict = ensureObject(value);
  const errors = [];
  if (trim(verdict.schema) !== VERDICT_SCHEMA_VERSION) errors.push("invalid_schema");
  if (!trim(verdict.verdict_kind)) errors.push("missing_verdict_kind");
  if (trim(expectedKind) && trim(verdict.verdict_kind) !== trim(expectedKind)) errors.push("unexpected_verdict_kind");
  if (!VERDICT_DISPOSITIONS.has(trim(verdict.disposition).toLowerCase())) errors.push("invalid_disposition");
  if (!VERDICT_CONFIDENCE.has(trim(verdict.confidence).toLowerCase())) errors.push("invalid_confidence");
  if (!isPlainObject(verdict.observation)) errors.push("invalid_observation");
  if (!isPlainObject(verdict.recommendation)) errors.push("invalid_recommendation");
  const reasonCodes = normalizeStringArray(verdict.reason_codes);
  if (requiredReasonCodes && reasonCodes.length === 0) errors.push("missing_reason_codes");
  const notes = trim(verdict.notes);
  if (requireNotes && !notes) errors.push("missing_notes");
  const transition = trim(verdict.recommended_transition);
  if (allowedTransitions && !allowedTransitions.has(transition)) errors.push("invalid_recommended_transition");
  return {
    ok: errors.length === 0,
    errors,
    verdict: buildVerdictEnvelope({
      verdictKind: verdict.verdict_kind,
      disposition: verdict.disposition,
      confidence: verdict.confidence,
      recommendedTransition: verdict.recommended_transition,
      observation: verdict.observation,
      recommendation: verdict.recommendation,
      reasonCodes,
      notes,
    }),
  };
}

export function confidenceRank(value = "") {
  const normalized = trim(value).toLowerCase();
  if (normalized === "high") return 3;
  if (normalized === "medium") return 2;
  if (normalized === "low") return 1;
  return 0;
}
