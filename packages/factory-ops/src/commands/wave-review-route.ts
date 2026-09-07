import { existsSync, readFileSync } from "node:fs";

import { trim } from "../lib/cli-helpers.ts";
import {
  buildVerdictEnvelope,
  parseVerdictEnvelopeRaw,
  validateVerdictEnvelope,
} from "../lib/verdict-envelope.ts";

export const REVIEW_RECOMMENDED_TRANSITIONS = new Set(["approved", "revise"]);

function normalizeBoolean(value = "") {
  const normalized = trim(value).toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return "true";
  if (["false", "0", "no"].includes(normalized)) return "false";
  return "";
}

function readJson(pathValue = "") {
  const resolved = trim(pathValue);
  if (!resolved || !existsSync(resolved)) return null;
  try {
    const parsed = JSON.parse(readFileSync(resolved, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function policyForcesRevise(context = {}) {
  const values = context?.effective_policy?.values;
  const review = values && typeof values === "object" ? values.review : null;
  const routeOverride = trim(review?.route_override).toLowerCase();
  if (routeOverride === "revise") return true;
  const forceRevise = normalizeBoolean(review?.force_revise);
  if (forceRevise === "true") return true;
  return false;
}

function detectQaInfraReasonCodes(reasonCodes = []) {
  return Array.isArray(reasonCodes)
    && reasonCodes.some((code) => /QA_EVIDENCE_REQUIRED|EVIDENCE_MISSING/i.test(trim(code)));
}

function buildRejectedReview({
  routeReason = "",
  reasonCodes = [],
  notes = "",
  confidence = "high",
} = {}) {
  return {
    verdict: buildVerdictEnvelope({
      verdictKind: "code_review",
      disposition: "reject",
      confidence,
      recommendedTransition: "revise",
      observation: { route_reason: trim(routeReason) },
      recommendation: { action: "revise_issue", route_reason: trim(routeReason) },
      reasonCodes,
      notes,
    }),
    route_reason: trim(routeReason),
  };
}

export function resolveReviewRoute({
  reviewVerdictRaw = "",
  reviewContextGatePass = "",
  reviewContextGateCode = "",
  reviewContextError = "",
  reviewContextPath = "",
} = {}) {
  const gatePass = normalizeBoolean(reviewContextGatePass);
  const gateCode = trim(reviewContextGateCode);
  const gateError = trim(reviewContextError);

  if (gatePass === "false" || (gatePass === "" && (gateCode || gateError))) {
    const rejected = buildRejectedReview({
      routeReason: gateError || gateCode || "review_context_gate_failed",
      reasonCodes: ["REVIEW_CONTEXT_INVALID"],
      notes: gateError || gateCode || "Reviewer context contract failed deterministic validation.",
    });
    return {
      disposition: rejected.verdict.disposition,
      confidence: rejected.verdict.confidence,
      recommended_transition: rejected.verdict.recommended_transition,
      reason_codes: rejected.verdict.reason_codes,
      notes: rejected.verdict.notes,
      route_reason: rejected.route_reason,
      verdict: rejected.verdict,
    };
  }

  const context = readJson(reviewContextPath);
  if (context && policyForcesRevise(context)) {
    const rejected = buildRejectedReview({
      routeReason: "policy_override_revise",
      reasonCodes: ["REVIEW_POLICY_OVERRIDE"],
      notes: "Reviewer policy override forced revise.",
    });
    return {
      disposition: rejected.verdict.disposition,
      confidence: rejected.verdict.confidence,
      recommended_transition: rejected.verdict.recommended_transition,
      reason_codes: rejected.verdict.reason_codes,
      notes: rejected.verdict.notes,
      route_reason: rejected.route_reason,
      verdict: rejected.verdict,
    };
  }

  const parsed = parseVerdictEnvelopeRaw(reviewVerdictRaw);
  const validated = validateVerdictEnvelope(parsed || {}, {
    expectedKind: "code_review",
    allowedTransitions: REVIEW_RECOMMENDED_TRANSITIONS,
    requiredReasonCodes: true,
  });

  if (!validated.ok) {
    const rejected = buildRejectedReview({
      routeReason: "invalid_review_verdict",
      reasonCodes: ["REVIEW_OUTPUT_SCHEMA_INVALID"],
      notes: `Reviewer output schema invalid: ${validated.errors.join(", ")}`,
    });
    return {
      disposition: rejected.verdict.disposition,
      confidence: rejected.verdict.confidence,
      recommended_transition: rejected.verdict.recommended_transition,
      reason_codes: rejected.verdict.reason_codes,
      notes: rejected.verdict.notes,
      route_reason: rejected.route_reason,
      verdict: rejected.verdict,
    };
  }

  const verdict = validated.verdict;
  if (verdict.disposition === "approve") {
    return {
      disposition: "approve",
      confidence: verdict.confidence,
      recommended_transition: "approved",
      reason_codes: verdict.reason_codes,
      notes: verdict.notes,
      route_reason: "approved",
      verdict,
    };
  }

  const routeReason = detectQaInfraReasonCodes(verdict.reason_codes) ? "qa_infra" : "non_approve_verdict";
  return {
    disposition: "reject",
    confidence: verdict.confidence,
    recommended_transition: "revise",
    reason_codes: verdict.reason_codes,
    notes: verdict.notes,
    route_reason: routeReason,
    verdict,
  };
}
