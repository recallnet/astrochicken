import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { trim } from "../lib/cli-helpers.ts";
import { parseVerdictEnvelopeRaw, validateVerdictEnvelope } from "../lib/verdict-envelope.ts";


export function buildReviewMessagePayload({ verdictRaw = "", issueNumber = "", issueTitle = "", agentSessionId = "" } = {}) {
  const validated = validateVerdictEnvelope(parseVerdictEnvelopeRaw(verdictRaw) || {}, {
    expectedKind: "code_review",
    allowedTransitions: new Set(["approved", "revise"]),
    requiredReasonCodes: true,
  });
  const verdict = validated.ok ? validated.verdict : null;
  const disposition = trim(verdict?.disposition).toLowerCase();
  const notes = trim(verdict?.notes);
  const sessionId = trim(agentSessionId);
  const issue = trim(issueNumber);
  const title = trim(issueTitle);

  if (disposition === "approve") {
    return { should_send: false, reason: "review_approved", session_id: sessionId, message: "" };
  }
  if (!sessionId) {
    return { should_send: false, reason: "missing_agent_session_id", session_id: "", message: "" };
  }
  if (!notes) {
    return { should_send: false, reason: "missing_review_notes", session_id: sessionId, message: "" };
  }

  const header = issue ? `Issue #${issue}${title ? `: ${title}` : ""}` : "Issue review feedback";
  const message = `${header}\n\nReviewer requested changes:\n${notes}`;
  return { should_send: true, reason: "ready", session_id: sessionId, message };
}

function defaultSend({ sessionId = "", message = "" } = {}) {
  // Write message to temp file to avoid shell quoting issues with multi-line content
  const dir = mkdtempSync(join(tmpdir(), "taxi-review-msg-"));
  const msgPath = join(dir, "message.txt");
  writeFileSync(msgPath, message, "utf8");
  const p = spawnSync("pi-messenger", ["send", "--session", sessionId, "--file", msgPath], { encoding: "utf8" });
  return { ok: p.status === 0, stdout: String(p.stdout || ""), stderr: String(p.stderr || "") };
}

export function sendReviewMessage({ verdictRaw = "", issueNumber = "", issueTitle = "", agentSessionId = "", sendFn = defaultSend } = {}) {
  const payload = buildReviewMessagePayload({ verdictRaw, issueNumber, issueTitle, agentSessionId });
  if (!payload.should_send) {
    return { sent: "false", reason: payload.reason, error: "", session_id: payload.session_id };
  }

  const result = sendFn({ sessionId: payload.session_id, message: payload.message });
  if (!result?.ok) {
    return {
      sent: "false",
      reason: "messenger_failed",
      error: trim(result?.stderr || result?.stdout || "messenger_send_failed"),
      session_id: payload.session_id,
    };
  }

  return { sent: "true", reason: "sent", error: "", session_id: payload.session_id };
}
