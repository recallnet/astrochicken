import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
