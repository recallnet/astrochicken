import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVerdictEnvelope,
  confidenceRank,
  parseVerdictEnvelopeRaw,
  validateVerdictEnvelope,
  VERDICT_SCHEMA_VERSION,
} from "../../src/lib/verdict-envelope.ts";

test("buildVerdictEnvelope emits normalized verdict/v1 payload", () => {
  const verdict = buildVerdictEnvelope({
    verdictKind: "code_review",
    disposition: "APPROVE",
    confidence: "HIGH",
    recommendedTransition: "approved",
    observation: { scope_status: "aligned" },
    recommendation: { action: "report_approved" },
    reasonCodes: ["APPROVED"],
    notes: "Looks good.",
  });

  assert.deepEqual(verdict, {
    schema: VERDICT_SCHEMA_VERSION,
    verdict_kind: "code_review",
    disposition: "approve",
    confidence: "high",
    recommended_transition: "approved",
    observation: { scope_status: "aligned" },
    recommendation: { action: "report_approved" },
    reason_codes: ["APPROVED"],
    notes: "Looks good.",
  });
});

test("validateVerdictEnvelope fails closed for malformed verdicts", () => {
  const out = validateVerdictEnvelope({
    schema: "wrong",
    verdict_kind: "",
    disposition: "maybe",
    confidence: "sure",
    observation: [],
    recommendation: "",
    reason_codes: [],
    notes: "",
  }, { expectedKind: "code_review", requiredReasonCodes: true, requireNotes: true });

  assert.equal(out.ok, false);
  assert.ok(out.errors.includes("invalid_schema"));
  assert.ok(out.errors.includes("missing_verdict_kind"));
  assert.ok(out.errors.includes("invalid_disposition"));
  assert.ok(out.errors.includes("invalid_confidence"));
  assert.ok(out.errors.includes("invalid_observation"));
  assert.ok(out.errors.includes("invalid_recommendation"));
  assert.ok(out.errors.includes("missing_reason_codes"));
  assert.ok(out.errors.includes("missing_notes"));
});

test("parseVerdictEnvelopeRaw parses valid JSON and rejects non-objects", () => {
  assert.equal(parseVerdictEnvelopeRaw('{"schema":"verdict/v1"}').schema, "verdict/v1");
  assert.equal(parseVerdictEnvelopeRaw("[]"), null);
  assert.equal(parseVerdictEnvelopeRaw("not json"), null);
});

test("confidenceRank orders high > medium > low", () => {
  assert.equal(confidenceRank("high") > confidenceRank("medium"), true);
  assert.equal(confidenceRank("medium") > confidenceRank("low"), true);
});
