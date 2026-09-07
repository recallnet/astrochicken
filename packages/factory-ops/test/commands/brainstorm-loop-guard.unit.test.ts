import assert from "node:assert/strict";
import test from "node:test";

import { applyBrainstormLoopGuard } from "../../src/commands/brainstorm-loop-guard.ts";

// --- Blue turn empty count increment ---

test("applyBrainstormLoopGuard increments count for empty blue output", () => {
  const out = applyBrainstormLoopGuard({
    source: "blue",
    conversationalOutput: "",
    previousEmptyBlueCount: "0",
    emptyBlueThreshold: "2",
  });
  assert.equal(out.empty_blue_count, "1");
  assert.equal(out.trigger_force_wrap, "false");
  assert.equal(out.suppress_round_comment, "false");
  assert.equal(out.guard_reason, "none");
});

test("applyBrainstormLoopGuard increments count for whitespace-only blue output", () => {
  const out = applyBrainstormLoopGuard({
    source: "blue",
    conversationalOutput: "   \n\t  ",
    previousEmptyBlueCount: "0",
    emptyBlueThreshold: "2",
  });
  assert.equal(out.empty_blue_count, "1");
  assert.equal(out.trigger_force_wrap, "false");
});

// --- Threshold trigger ---

test("applyBrainstormLoopGuard triggers force-wrap at threshold", () => {
  const out = applyBrainstormLoopGuard({
    source: "blue",
    conversationalOutput: "",
    previousEmptyBlueCount: "1",
    emptyBlueThreshold: "2",
  });
  assert.equal(out.empty_blue_count, "2");
  assert.equal(out.trigger_force_wrap, "true");
  assert.equal(out.suppress_round_comment, "true");
  assert.equal(out.guard_reason, "repeated_empty_blue");
});

test("applyBrainstormLoopGuard triggers force-wrap when count exceeds threshold", () => {
  const out = applyBrainstormLoopGuard({
    source: "blue",
    conversationalOutput: "",
    previousEmptyBlueCount: "3",
    emptyBlueThreshold: "2",
  });
  assert.equal(out.trigger_force_wrap, "true");
  assert.equal(out.guard_reason, "repeated_empty_blue");
});

// --- Counter reset on non-empty blue ---

test("applyBrainstormLoopGuard resets count on non-empty blue output", () => {
  const out = applyBrainstormLoopGuard({
    source: "blue",
    conversationalOutput: "I think we should narrow scope.",
    previousEmptyBlueCount: "1",
    emptyBlueThreshold: "2",
  });
  assert.equal(out.empty_blue_count, "0");
  assert.equal(out.trigger_force_wrap, "false");
  assert.equal(out.guard_reason, "none");
});

// --- Counter reset on red turns ---

test("applyBrainstormLoopGuard resets count on red turn regardless of content", () => {
  const out = applyBrainstormLoopGuard({
    source: "red",
    conversationalOutput: "",
    previousEmptyBlueCount: "1",
    emptyBlueThreshold: "2",
  });
  assert.equal(out.empty_blue_count, "0");
  assert.equal(out.trigger_force_wrap, "false");
  assert.equal(out.suppress_round_comment, "false");
  assert.equal(out.guard_reason, "none");
});

test("applyBrainstormLoopGuard does not trigger force-wrap on red turn even with prior empty blues", () => {
  const out = applyBrainstormLoopGuard({
    source: "red",
    conversationalOutput: "",
    previousEmptyBlueCount: "5",
    emptyBlueThreshold: "2",
  });
  assert.equal(out.trigger_force_wrap, "false");
  assert.equal(out.empty_blue_count, "0");
});

// --- Non-red/blue sources do not affect counter ---

test("applyBrainstormLoopGuard ignores force_wrap source for counter purposes", () => {
  const out = applyBrainstormLoopGuard({
    source: "force_wrap",
    conversationalOutput: "",
    previousEmptyBlueCount: "1",
    emptyBlueThreshold: "2",
  });
  // Counter preserved as-is (no increment, no reset)
  assert.equal(out.empty_blue_count, "1");
  assert.equal(out.trigger_force_wrap, "false");
  assert.equal(out.guard_reason, "none");
});

// --- Default threshold behavior ---

test("applyBrainstormLoopGuard uses default threshold of 2 when not provided", () => {
  // First empty blue — should NOT trigger at count=1
  const first = applyBrainstormLoopGuard({
    source: "blue",
    conversationalOutput: "",
    previousEmptyBlueCount: "0",
  });
  assert.equal(first.trigger_force_wrap, "false");
  assert.equal(first.empty_blue_count, "1");

  // Second empty blue — should trigger at count=2
  const second = applyBrainstormLoopGuard({
    source: "blue",
    conversationalOutput: "",
    previousEmptyBlueCount: "1",
  });
  assert.equal(second.trigger_force_wrap, "true");
  assert.equal(second.empty_blue_count, "2");
});

// --- Default/fallback input handling ---

test("applyBrainstormLoopGuard handles missing options gracefully", () => {
  const out = applyBrainstormLoopGuard();
  assert.equal(out.empty_blue_count, "0");
  assert.equal(out.trigger_force_wrap, "false");
  assert.equal(out.suppress_round_comment, "false");
  assert.equal(out.guard_reason, "none");
});

test("applyBrainstormLoopGuard handles numeric previousEmptyBlueCount", () => {
  const out = applyBrainstormLoopGuard({
    source: "blue",
    conversationalOutput: "",
    previousEmptyBlueCount: 1,
    emptyBlueThreshold: 2,
  });
  assert.equal(out.empty_blue_count, "2");
  assert.equal(out.trigger_force_wrap, "true");
});

test("applyBrainstormLoopGuard handles NaN previousEmptyBlueCount as 0", () => {
  const out = applyBrainstormLoopGuard({
    source: "blue",
    conversationalOutput: "",
    previousEmptyBlueCount: "not-a-number",
    emptyBlueThreshold: "2",
  });
  assert.equal(out.empty_blue_count, "1");
  assert.equal(out.trigger_force_wrap, "false");
});

// --- Output shape contract ---

test("applyBrainstormLoopGuard always returns all four output keys", () => {
  const out = applyBrainstormLoopGuard({ source: "blue", conversationalOutput: "hello" });
  assert.ok("empty_blue_count" in out);
  assert.ok("trigger_force_wrap" in out);
  assert.ok("suppress_round_comment" in out);
  assert.ok("guard_reason" in out);
});

test("applyBrainstormLoopGuard returns string values for all outputs", () => {
  const out = applyBrainstormLoopGuard({ source: "blue", conversationalOutput: "" });
  assert.equal(typeof out.empty_blue_count, "string");
  assert.equal(typeof out.trigger_force_wrap, "string");
  assert.equal(typeof out.suppress_round_comment, "string");
  assert.equal(typeof out.guard_reason, "string");
});

// --- shouldForceWrap aggregation (blue terminate-non-final propagation) ---

test("applyBrainstormLoopGuard propagates shouldForceWrap=true into trigger_force_wrap", () => {
  // Blue with non-empty output but terminate-non-final signal from check_output
  const out = applyBrainstormLoopGuard({
    source: "blue",
    conversationalOutput: "I think we should narrow scope. Terminate.",
    previousEmptyBlueCount: "0",
    emptyBlueThreshold: "2",
    shouldForceWrap: "true",
  });
  assert.equal(out.trigger_force_wrap, "true");
  assert.equal(out.suppress_round_comment, "true");
  assert.equal(out.guard_reason, "terminate_signal_non_final");
  // Counter not incremented because output is non-empty
  assert.equal(out.empty_blue_count, "0");
});

test("applyBrainstormLoopGuard combined: empty-blue threshold already hit AND shouldForceWrap preserves trigger", () => {
  const out = applyBrainstormLoopGuard({
    source: "blue",
    conversationalOutput: "",
    previousEmptyBlueCount: "1",
    emptyBlueThreshold: "2",
    shouldForceWrap: "true",
  });
  assert.equal(out.trigger_force_wrap, "true");
  // guard_reason may be repeated_empty_blue since that trips first
  assert.ok(out.guard_reason === "repeated_empty_blue" || out.guard_reason === "terminate_signal_non_final");
  assert.equal(out.suppress_round_comment, "true");
});

test("applyBrainstormLoopGuard shouldForceWrap=false does not change trigger_force_wrap when counter not at threshold", () => {
  const out = applyBrainstormLoopGuard({
    source: "blue",
    conversationalOutput: "normal output",
    previousEmptyBlueCount: "0",
    emptyBlueThreshold: "2",
    shouldForceWrap: "false",
  });
  assert.equal(out.trigger_force_wrap, "false");
  assert.equal(out.suppress_round_comment, "false");
  assert.equal(out.guard_reason, "none");
});

test("applyBrainstormLoopGuard shouldForceWrap defaults to false when not provided", () => {
  const out = applyBrainstormLoopGuard({
    source: "blue",
    conversationalOutput: "some output",
    previousEmptyBlueCount: "0",
  });
  assert.equal(out.trigger_force_wrap, "false");
  assert.equal(out.guard_reason, "none");
});
