import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  VERDICT_SCHEMA_VERSION,
  VERDICT_DISPOSITIONS,
  VERDICT_CONFIDENCE,
  buildVerdictEnvelope,
  parseVerdictEnvelopeRaw,
  validateVerdictEnvelope,
  confidenceRank,
} from "../../src/lib/verdict-envelope.ts";

// ── Constants ────────────────────────────────────────────────────────

describe("constants", () => {
  it("VERDICT_SCHEMA_VERSION equals verdict/v1", () => {
    assert.equal(VERDICT_SCHEMA_VERSION, "verdict/v1");
  });

  it("VERDICT_DISPOSITIONS contains approve, reject, defer, escalate", () => {
    for (const d of ["approve", "reject", "defer", "escalate"]) {
      assert.ok(VERDICT_DISPOSITIONS.has(d), `missing ${d}`);
    }
    assert.equal(VERDICT_DISPOSITIONS.size, 4);
  });

  it("VERDICT_CONFIDENCE contains high, medium, low", () => {
    for (const c of ["high", "medium", "low"]) {
      assert.ok(VERDICT_CONFIDENCE.has(c), `missing ${c}`);
    }
    assert.equal(VERDICT_CONFIDENCE.size, 3);
  });
});

// ── buildVerdictEnvelope ─────────────────────────────────────────────

describe("buildVerdictEnvelope", () => {
  it("returns correct defaults when called with no args", () => {
    const env = buildVerdictEnvelope();
    assert.equal(env.schema, VERDICT_SCHEMA_VERSION);
    assert.equal(env.verdict_kind, "");
    assert.equal(env.disposition, "");
    assert.equal(env.confidence, "medium");
    assert.equal(env.recommended_transition, "");
    assert.deepEqual(env.observation, {});
    assert.deepEqual(env.recommendation, {});
    assert.deepEqual(env.reason_codes, []);
    assert.equal(env.notes, "");
  });

  it("populates all fields from full params", () => {
    const obs = { file: "a.ts" };
    const rec = { action: "merge" };
    const env = buildVerdictEnvelope({
      verdictKind: "code-review",
      disposition: "approve",
      confidence: "high",
      recommendedTransition: "merge",
      observation: obs,
      recommendation: rec,
      reasonCodes: ["clean", "tested"],
      notes: "looks good",
    });
    assert.equal(env.verdict_kind, "code-review");
    assert.equal(env.disposition, "approve");
    assert.equal(env.confidence, "high");
    assert.equal(env.recommended_transition, "merge");
    assert.deepEqual(env.observation, obs);
    assert.deepEqual(env.recommendation, rec);
    assert.deepEqual(env.reason_codes, ["clean", "tested"]);
    assert.equal(env.notes, "looks good");
  });

  it("lowercases disposition", () => {
    const env = buildVerdictEnvelope({ disposition: "APPROVE" });
    assert.equal(env.disposition, "approve");
  });

  it("lowercases confidence", () => {
    const env = buildVerdictEnvelope({ confidence: "HIGH" });
    assert.equal(env.confidence, "high");
  });

  it("filters empty strings from reasonCodes", () => {
    const env = buildVerdictEnvelope({ reasonCodes: ["a", "", "  ", "b"] });
    assert.deepEqual(env.reason_codes, ["a", "b"]);
  });

  it("falls back to {} for non-object observation/recommendation", () => {
    const env = buildVerdictEnvelope({ observation: "nope", recommendation: [1] });
    assert.deepEqual(env.observation, {});
    assert.deepEqual(env.recommendation, {});
  });
});

// ── parseVerdictEnvelopeRaw ──────────────────────────────────────────

describe("parseVerdictEnvelopeRaw", () => {
  it("returns parsed object for valid JSON object", () => {
    const obj = { schema: "verdict/v1", disposition: "approve" };
    const result = parseVerdictEnvelopeRaw(JSON.stringify(obj));
    assert.deepEqual(result, obj);
  });

  it("returns null for valid JSON array", () => {
    assert.equal(parseVerdictEnvelopeRaw("[1,2]"), null);
  });

  it("returns null for invalid JSON", () => {
    assert.equal(parseVerdictEnvelopeRaw("{bad"), null);
  });

  it("returns null for empty string", () => {
    assert.equal(parseVerdictEnvelopeRaw(""), null);
  });

  it("returns null for null/undefined", () => {
    assert.equal(parseVerdictEnvelopeRaw(null), null);
    assert.equal(parseVerdictEnvelopeRaw(undefined), null);
  });
});

// ── validateVerdictEnvelope ──────────────────────────────────────────

function validVerdict(overrides = {}) {
  return {
    schema: VERDICT_SCHEMA_VERSION,
    verdict_kind: "code-review",
    disposition: "approve",
    confidence: "high",
    recommended_transition: "merge",
    observation: { file: "a.ts" },
    recommendation: { action: "merge" },
    reason_codes: ["clean"],
    notes: "lgtm",
    ...overrides,
  };
}

describe("validateVerdictEnvelope", () => {
  it("returns ok:true for a valid verdict", () => {
    const result = validateVerdictEnvelope(validVerdict());
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it("returns invalid_schema when schema is missing", () => {
    const result = validateVerdictEnvelope(validVerdict({ schema: "" }));
    assert.ok(result.errors.includes("invalid_schema"));
    assert.equal(result.ok, false);
  });

  it("returns missing_verdict_kind when verdict_kind is empty", () => {
    const result = validateVerdictEnvelope(validVerdict({ verdict_kind: "" }));
    assert.ok(result.errors.includes("missing_verdict_kind"));
  });

  it("returns unexpected_verdict_kind when kind does not match expectedKind", () => {
    const result = validateVerdictEnvelope(validVerdict(), { expectedKind: "release" });
    assert.ok(result.errors.includes("unexpected_verdict_kind"));
  });

  it("returns invalid_disposition for unknown disposition", () => {
    const result = validateVerdictEnvelope(validVerdict({ disposition: "yolo" }));
    assert.ok(result.errors.includes("invalid_disposition"));
  });

  it("returns invalid_confidence for unknown confidence", () => {
    const result = validateVerdictEnvelope(validVerdict({ confidence: "extreme" }));
    assert.ok(result.errors.includes("invalid_confidence"));
  });

  it("returns missing_reason_codes when requiredReasonCodes and codes empty", () => {
    const result = validateVerdictEnvelope(validVerdict({ reason_codes: [] }), {
      requiredReasonCodes: true,
    });
    assert.ok(result.errors.includes("missing_reason_codes"));
  });

  it("returns missing_notes when requireNotes and notes empty", () => {
    const result = validateVerdictEnvelope(validVerdict({ notes: "" }), {
      requireNotes: true,
    });
    assert.ok(result.errors.includes("missing_notes"));
  });

  it("returns invalid_recommended_transition when transition not in allowedTransitions", () => {
    const result = validateVerdictEnvelope(validVerdict({ recommended_transition: "deploy" }), {
      allowedTransitions: new Set(["merge", "revert"]),
    });
    assert.ok(result.errors.includes("invalid_recommended_transition"));
  });

  it("accumulates multiple errors", () => {
    const result = validateVerdictEnvelope(validVerdict({
      schema: "wrong",
      verdict_kind: "",
      disposition: "nope",
      confidence: "nope",
    }));
    assert.ok(result.errors.length >= 4);
    assert.ok(result.errors.includes("invalid_schema"));
    assert.ok(result.errors.includes("missing_verdict_kind"));
    assert.ok(result.errors.includes("invalid_disposition"));
    assert.ok(result.errors.includes("invalid_confidence"));
  });

  it("re-builds a normalized verdict in the return value", () => {
    const result = validateVerdictEnvelope(validVerdict({ disposition: " APPROVE " }));
    assert.equal(result.verdict.schema, VERDICT_SCHEMA_VERSION);
    assert.equal(result.verdict.disposition, "approve");
  });
});

// ── confidenceRank ───────────────────────────────────────────────────

describe("confidenceRank", () => {
  it("returns 3 for high", () => assert.equal(confidenceRank("high"), 3));
  it("returns 2 for medium", () => assert.equal(confidenceRank("medium"), 2));
  it("returns 1 for low", () => assert.equal(confidenceRank("low"), 1));
  it("returns 0 for empty string", () => assert.equal(confidenceRank(""), 0));
  it("returns 0 for unknown value", () => assert.equal(confidenceRank("unknown"), 0));
  it("trims and lowercases before ranking", () => assert.equal(confidenceRank(" HIGH "), 3));
});
