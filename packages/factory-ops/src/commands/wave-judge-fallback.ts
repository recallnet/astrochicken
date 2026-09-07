import { emitGovernedOtelEvent } from "@recallnet/factory-telemetry";

import { buildVerdictEnvelope, parseVerdictEnvelopeRaw, validateVerdictEnvelope } from "../lib/verdict-envelope.ts";

function trim(value = "") {
  return String(value || "").trim();
}

export function fallbackJudgeDecision({ verdictRaw = "", error = "", factoryId = "", runId = "", workflowId = "", capabilityId = "" } = {}) {
  const validated = validateVerdictEnvelope(parseVerdictEnvelopeRaw(verdictRaw) || {}, {
    expectedKind: "post_merge_judge",
    requiredReasonCodes: true,
  });
  const verdict = validated.ok ? validated.verdict : null;
  const disposition = String(verdict?.disposition || "").trim().toLowerCase();
  const notes = String(verdict?.notes || "").trim();

  if (disposition === "approve") {
    return verdict;
  }

  if (disposition && disposition !== "approve") {
    emitGovernedOtelEvent({
      event_name: "wave.judge.fail_forward",
      severity_text: "WARN",
      correlation: {
        factory_id: trim(factoryId) || trim(process.env.HATCH_FACTORY_ID || process.env.FACTORY_ID || "") || "manual",
        run_id: trim(runId) || trim(process.env.HATCH_RUN_ID || process.env.RUN_ID || "") || "manual-cli",
        workflow_id: trim(workflowId) || "wave_fallback_judge",
        capability_id: trim(capabilityId) || "wave_execution",
        owner: "factory_ops.wave_judge_fallback",
      },
      body: { original_disposition: disposition, notes },
      attributes: { "judge.original_disposition": disposition, "judge.fail_forward": "true" },
    });
    return buildVerdictEnvelope({
      verdictKind: "post_merge_judge",
      disposition: "approve",
      confidence: "low",
      recommendedTransition: "close_milestone",
      observation: { fallback: "fail_forward_override", original_disposition: disposition },
      recommendation: { action: "close_milestone" },
      reasonCodes: ["POST_MERGE_ALIGNED"],
      notes: `Fail-forward override: LLM judge returned ${disposition}. Original notes: ${notes}`,
    });
  }

  emitGovernedOtelEvent({
    event_name: "wave.judge.fallback",
    severity_text: "WARN",
    correlation: {
      factory_id: trim(factoryId) || trim(process.env.HATCH_FACTORY_ID || process.env.FACTORY_ID || "") || "manual",
      run_id: trim(runId) || trim(process.env.HATCH_RUN_ID || process.env.RUN_ID || "") || "manual-cli",
      workflow_id: trim(workflowId) || "wave_fallback_judge",
      capability_id: trim(capabilityId) || "wave_execution",
      owner: "factory_ops.wave_judge_fallback",
    },
    body: { error: String(error || "judge_unavailable").trim() },
    attributes: { "judge.fallback": "true", "judge.error": String(error || "judge_unavailable").trim() },
  });
  return buildVerdictEnvelope({
    verdictKind: "post_merge_judge",
    disposition: "approve",
    confidence: "low",
    recommendedTransition: "close_milestone",
    observation: { fallback: "llm_unavailable", error: String(error || "judge_unavailable").trim() },
    recommendation: { action: "close_milestone" },
    reasonCodes: ["POST_MERGE_ALIGNED"],
    notes: `Deterministic fallback judge pass: LLM judge unavailable (${String(error || "judge_unavailable").trim()}).`,
  });
}
