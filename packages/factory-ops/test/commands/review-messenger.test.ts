import assert from "node:assert/strict";
import test from "node:test";

import { buildReviewMessagePayload, sendReviewMessage } from "../../src/commands/review-messenger.ts";
import { buildVerdictEnvelope } from "../../src/lib/verdict-envelope.ts";

function reviewVerdict({ disposition = "approve", notes = "", reasonCodes = ["APPROVED"] } = {}) {
  return JSON.stringify(buildVerdictEnvelope({
    verdictKind: "code_review",
    disposition,
    confidence: "high",
    recommendedTransition: disposition === "approve" ? "approved" : "revise",
    observation: { scope_status: "aligned" },
    recommendation: { action: disposition === "approve" ? "report_approved" : "revise_issue" },
    reasonCodes,
    notes,
  }));
}

test("buildReviewMessagePayload returns skipped for approve verdict", () => {
  const out = buildReviewMessagePayload({ verdictRaw: reviewVerdict({ disposition: "approve", notes: "" }), issueNumber: "101" });
  assert.equal(out.should_send, false);
  assert.equal(out.reason, "review_approved");
});

test("buildReviewMessagePayload requires session id + notes for revise", () => {
  const noSession = buildReviewMessagePayload({
    verdictRaw: reviewVerdict({ disposition: "reject", notes: "Fix X", reasonCodes: ["SCOPE_MISMATCH"] }),
    issueNumber: "101",
    agentSessionId: "",
  });
  assert.equal(noSession.should_send, false);
  assert.equal(noSession.reason, "missing_agent_session_id");

  const noNotes = buildReviewMessagePayload({
    verdictRaw: reviewVerdict({ disposition: "reject", notes: "", reasonCodes: ["SCOPE_MISMATCH"] }),
    issueNumber: "101",
    agentSessionId: "abc",
  });
  assert.equal(noNotes.should_send, false);
  assert.equal(noNotes.reason, "missing_review_notes");
});

test("sendReviewMessage calls messenger transport when payload is valid", () => {
  const calls = [];
  const out = sendReviewMessage({
    verdictRaw: reviewVerdict({ disposition: "reject", notes: "Please add regression test", reasonCodes: ["TESTS_MISSING"] }),
    issueNumber: "101",
    issueTitle: "Example issue",
    agentSessionId: "sess-1",
    sendFn: ({ sessionId, message }) => {
      calls.push({ sessionId, message });
      return { ok: true, stdout: "sent", stderr: "" };
    },
  });

  assert.equal(out.sent, "true");
  assert.equal(out.reason, "sent");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sessionId, "sess-1");
  assert.match(calls[0].message, /Issue #101/);
  assert.match(calls[0].message, /Please add regression test/);
});

test("sendReviewMessage degrades gracefully when messenger transport fails", () => {
  const out = sendReviewMessage({
    verdictRaw: reviewVerdict({ disposition: "reject", notes: "Fix scope mismatch", reasonCodes: ["SCOPE_MISMATCH"] }),
    issueNumber: "101",
    issueTitle: "Example issue",
    agentSessionId: "sess-1",
    sendFn: () => ({ ok: false, stdout: "", stderr: "transport error" }),
  });

  assert.equal(out.sent, "false");
  assert.equal(out.reason, "messenger_failed");
  assert.match(out.error, /transport error/);
});
