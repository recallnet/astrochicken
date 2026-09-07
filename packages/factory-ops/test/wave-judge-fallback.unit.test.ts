import test from "node:test";
import assert from "node:assert/strict";
import { fallbackJudgeDecision } from "../src/commands/wave-judge-fallback.ts";
import { buildVerdictEnvelope } from "../src/lib/verdict-envelope.ts";

function judgeVerdict({ disposition = "approve", notes = "all good" } = {}) {
  return JSON.stringify(buildVerdictEnvelope({
    verdictKind: "post_merge_judge",
    disposition,
    confidence: "high",
    recommendedTransition: disposition === "approve" ? "close_milestone" : "open_followup",
    observation: { alignment_score: 1 },
    recommendation: { action: disposition === "approve" ? "close_milestone" : "open_followup" },
    reasonCodes: [disposition === "approve" ? "POST_MERGE_ALIGNED" : "POST_MERGE_MISALIGNED"],
    notes,
  }));
}

test("fallbackJudgeDecision preserves explicit true verdict", () => {
  const approved = fallbackJudgeDecision({ verdictRaw: judgeVerdict({ disposition: "approve", notes: "all good" }) });
  assert.equal(approved.disposition, "approve");
  assert.equal(approved.notes, "all good");
});

test("fallbackJudgeDecision fail-forwards explicit false verdict to true with original notes", () => {
  const out = fallbackJudgeDecision({ verdictRaw: judgeVerdict({ disposition: "reject", notes: "needs work" }) });
  assert.equal(out.disposition, "approve");
  assert.match(out.notes, /Fail-forward override/);
  assert.match(out.notes, /needs work/);
});

test("fallbackJudgeDecision fail-open passes deterministically when verdict missing", () => {
  const out = fallbackJudgeDecision({ verdictRaw: "", error: "llm_unavailable" });
  assert.equal(out.disposition, "approve");
  assert.match(out.notes, /Deterministic fallback judge pass/);
  assert.match(out.notes, /llm_unavailable/);
});
