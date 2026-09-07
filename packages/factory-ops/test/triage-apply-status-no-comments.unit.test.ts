import assert from "node:assert/strict";
import test from "node:test";

import { applyTriageStatus } from "../src/commands/triage-apply-status.ts";
import { buildRelationshipComment, postRelationshipComment } from "../src/commands/triage-relationships.ts";

// ── applyTriageStatus must not post blocker comments ──────────────────

test("applyTriageStatus accept path adds triaged label, no comments", () => {
  const calls = [];
  const result = applyTriageStatus({
    repo: "recallnet/astrochicken",
    issueNumber: 100,
    status: "accept",
    runGhFn: (args) => {
      calls.push(args);
      return { ok: true, stdout: "{}", stderr: "" };
    },
  });
  assert.equal(result.ok, true);
  // Only one call: add triaged label
  assert.equal(calls.length, 1, `expected 1 gh call (label), got ${calls.length}: ${JSON.stringify(calls)}`);
  const labelCall = calls[0];
  assert.ok(
    labelCall.some((a) => String(a).includes("triaged")),
    "single call must be the triaged label",
  );
});

test("applyTriageStatus blocked path adds triaged label, no comments", () => {
  const calls = [];
  const result = applyTriageStatus({
    repo: "recallnet/astrochicken",
    issueNumber: 200,
    status: "blocked",
    blockedByRaw: "[100,101]",
    controlPlaneBlockerRaw: "control_plane_blocker.v1:{\"kind\":\"upstream_bug\",\"status\":\"blocked\"}",
    runGhFn: (args) => {
      calls.push(args);
      return { ok: true, stdout: "{}", stderr: "" };
    },
  });
  assert.equal(result.ok, true);
  // Only one call: add triaged label. No comment calls.
  assert.equal(calls.length, 1, `expected 1 gh call (label only), got ${calls.length}: ${JSON.stringify(calls)}`);
  // Verify none of the calls are "issue comment"
  for (const call of calls) {
    const joined = call.join(" ");
    assert.ok(
      !joined.includes("issue comment"),
      `must not post comments: ${joined}`,
    );
  }
});

test("applyTriageStatus blocked path does not post control-plane blocker comment", () => {
  const calls = [];
  applyTriageStatus({
    repo: "recallnet/astrochicken",
    issueNumber: 300,
    status: "blocked",
    blockedByRaw: "[100]",
    controlPlaneBlockerRaw: "control_plane_blocker.v1:{\"kind\":\"upstream_bug\",\"blockerRef\":\"\",\"unblockCondition\":\"Wait\",\"status\":\"blocked\"}",
    runGhFn: (args) => {
      calls.push(args);
      return { ok: true, stdout: "{}", stderr: "" };
    },
  });
  const commentCalls = calls.filter((c) => c.includes("comment") || c.join(" ").includes("comment"));
  assert.equal(commentCalls.length, 0, "no comment calls should be made for blocked status");
});

// ── record_relationships comment is removed ───────────────────────────

test("postRelationshipComment is a no-op — returns commented:false", () => {
  const result = postRelationshipComment({
    repo: "recallnet/astrochicken",
    issueNumber: "100",
    parentIssue: "50",
    blockingIssuesRaw: "[200]",
    blockedByRaw: "[50]",
  });
  assert.equal(result.commented, false, "must not post relationship comments");
});

test("buildRelationshipComment returns empty string", () => {
  const comment = buildRelationshipComment({
    parentIssue: "50",
    blockingIssues: [200],
    blockedBy: [50],
  });
  assert.equal(comment, "", "relationship comment must be empty — use native blocked_by");
});
