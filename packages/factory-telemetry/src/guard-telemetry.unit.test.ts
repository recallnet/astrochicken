import { describe, expect, it } from "vitest";

import {
  gateEvidenceRefForArtifact,
  gateNameForDecision,
  gateOutcomeForDecision,
  toGuardEventData,
  trustEnvelopeFromContext,
} from "./guard-telemetry.js";

const decision = {
  allowed: false,
  counter: "review_retry_calls",
  reasonCode: "limit_reached",
  circuitState: "open",
  transition: "block",
  policyRevision: "v1",
  threshold: 3,
  scope: "run",
  backoffMs: 1000,
  nextAttemptAt: "2026-03-10T00:00:00.000Z",
  runCounters: {
    tool_calls: 1,
    llm_calls: 2,
    review_retry_calls: 3,
    pipeline_transition_calls: 4,
  },
  factoryCounters: {
    tool_calls: 5,
    llm_calls: 6,
    review_retry_calls: 7,
    pipeline_transition_calls: 8,
  },
  ownerId: "owner-1",
  leaseName: "lease-1",
  leaseGeneration: 9,
} as const;

describe("guard telemetry helpers", () => {
  it("maps guard decisions into stable event data", () => {
    expect(gateNameForDecision(decision)).toBe("guard.review_retry_calls");
    expect(gateOutcomeForDecision(decision)).toBe("fail");
    expect(toGuardEventData(decision, { extra: "yes" })).toMatchObject({
      allowed: "false",
      counter: "review_retry_calls",
      gate_name: "guard.review_retry_calls",
      gate_outcome: "fail",
      extra: "yes",
    });
  });

  it("derives deterministic evidence refs and trust envelopes", () => {
    const ref = gateEvidenceRefForArtifact({
      runState: { runId: "run-1" },
      nodeId: "review",
      artifactPath: "/tmp/artifact.json",
      decision,
      nowIso: "2026-03-10T00:00:00.000Z",
    });

    expect(ref).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(trustEnvelopeFromContext({
      trust_partition: "judge",
      trust_domain: "astrochicken.local",
      trust_role: "reviewer",
    })).toEqual({
      trust_partition: "judge",
      trust_domain: "astrochicken.local",
      trust_role: "reviewer",
      trust_partition_key: "judge/reviewer",
    });
  });
});
