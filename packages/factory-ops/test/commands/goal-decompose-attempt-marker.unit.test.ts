import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { countDecomposeAttempts, countDecomposeAttemptsFromIssue } from "../../src/commands/goal-queue-ops.ts";
import { postDecomposeAttemptMarker, DECOMPOSE_ATTEMPT_MARKER } from "../../src/commands/goal-run-state.ts";

// Graph: docs/contracts/workflow-ir/capability-goal-decomposition/goal_run.dot
// CLI: goal post-decompose-attempt
const dotPath = "docs/contracts/workflow-ir/capability-goal-decomposition/goal_run.dot";

// ────────────────────────────────────────────────────────────
// Bug: decompose retry counter never increments on crash
//
// When intake_decompose crashes (LLM timeout), the pipeline fails
// before reaching keep_open which posts the retry marker.
// The counter stays at 0 forever — goal retries every tick indefinitely.
//
// Fix: post an attempt marker BEFORE intake_decompose, not after.
// Count attempts, not failures.
// ────────────────────────────────────────────────────────────

test("goal_run.dot has mark_decompose_attempt node before intake_decompose", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(
    dot,
    /mark_decompose_attempt\s*\[type="tool"/,
    "goal_run must have a mark_decompose_attempt tool node"
  );
  // Verify it comes before intake_decompose in the edge chain
  assert.match(
    dot,
    /mark_decompose_attempt\s*->\s*intake_decompose/,
    "mark_decompose_attempt must connect directly to intake_decompose"
  );
});

test("decompose_retry_gate routes to mark_decompose_attempt (not directly to intake_decompose)", () => {
  const dot = readFileSync(dotPath, "utf8");
  // Under-budget path must go through the marker first
  assert.match(
    dot,
    /decompose_retry_gate\s*->\s*mark_decompose_attempt/,
    "under-budget path must go to mark_decompose_attempt before intake_decompose"
  );
});

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
