import assert from "node:assert/strict";
import test from "node:test";

import { countDecomposeAttempts, countDecomposeAttemptsFromIssue } from "../../src/commands/goal-queue-ops.ts";
import { postDecomposeAttemptMarker, DECOMPOSE_ATTEMPT_MARKER } from "../../src/commands/goal-run-state.ts";

test("countDecomposeAttempts counts attempt markers (not just failure markers)", () => {
  const count = countDecomposeAttempts({
    comments: [
      { body: "<!-- goal-run:decompose-attempt -->\nDecompose attempt 1" },
      { body: "Unrelated comment" },
      { body: "<!-- goal-run:decompose-attempt -->\nDecompose attempt 2" },
    ],
  });
  assert.equal(count, 2, "must count decompose-attempt markers");
});

test("countDecomposeAttempts counts attempt markers even when decompose crashes (no failure marker)", () => {
  // Simulates the bug scenario: attempt markers exist but no failure markers
  // because intake_decompose crashed before keep_open could post
  const count = countDecomposeAttempts({
    comments: [
      { body: "<!-- goal-run:decompose-attempt -->\nDecompose attempt 1" },
      { body: "<!-- goal-run:decompose-attempt -->\nDecompose attempt 2" },
      { body: "<!-- goal-run:decompose-attempt -->\nDecompose attempt 3" },
    ],
  });
  assert.equal(count, 3, "3 attempts with no failure markers should still count");
});

test("postDecomposeAttemptMarker posts comment with attempt marker", () => {
  const calls = [];
  const result = postDecomposeAttemptMarker({
    repo: "recallnet/astrochicken",
    issueNumber: "2151",
    decomposeAttemptNumber: "1",
    ghExec: (args) => {
      calls.push(args);
      return { ok: true, status: 0 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  const body = calls[0].find((_, i, arr) => arr[i - 1] === "--body");
  assert.ok(body, "must pass --body to gh issue comment");
  assert.ok(body.includes("<!-- goal-run:decompose-attempt -->"), "body must contain attempt marker");
});

test("countDecomposeAttemptsFromIssue counts attempt markers regardless of labels", () => {
  const count = countDecomposeAttemptsFromIssue({
    issue: {
      labels: [{ name: "goal" }, { name: "ready" }],
      comments: [
        { body: "<!-- goal-run:decompose-attempt -->\nAttempt 1" },
        { body: "<!-- goal-run:decompose-attempt -->\nAttempt 2" },
      ],
    },
  });
  assert.equal(count, 2);
});

test("DECOMPOSE_ATTEMPT_MARKER is exported and correct", () => {
  assert.equal(DECOMPOSE_ATTEMPT_MARKER, "<!-- goal-run:decompose-attempt -->");
});
