import assert from "node:assert/strict";
import test from "node:test";

import { checkBrainstormOutput } from "../../src/commands/brainstorm-check-output.ts";

// --- Final report detection (requires terminate: true) ---

test("checkBrainstormOutput detects final report when terminate is true", () => {
  const finalReport = JSON.stringify({
    proposal: "Build an overnight lab pipeline",
    success_criteria: ["P95 latency < 200ms", "Zero data loss on restart"],
    scope_in: ["pipeline runner", "checkpoint storage"],
    scope_out: ["UI dashboard"],
    terminate: true,
  });
  const out = checkBrainstormOutput({ agentOutput: finalReport, source: "blue" });
  assert.equal(out.is_final, "true");
  assert.equal(out.source, "blue");
  const parsed = JSON.parse(out.final_report);
  assert.equal(parsed.proposal, "Build an overnight lab pipeline");
  assert.equal(out.conversational_output, "");
  // New verdict fields — final report is not a force-wrap candidate
  assert.equal(out.should_force_wrap, "false");
  assert.equal(out.termination_reason, "");
  assert.equal(out.is_empty_output, "false");
});

test("checkBrainstormOutput treats proposal fields WITHOUT terminate as conversational", () => {
  const conversational = JSON.stringify({
    proposal: "Build an overnight lab pipeline",
    success_criteria: ["P95 latency < 200ms"],
    scope_in: ["pipeline runner"],
    scope_out: ["UI dashboard"],
    terminate: false,
  });
  const out = checkBrainstormOutput({ agentOutput: conversational, source: "blue" });
  assert.equal(out.is_final, "false");
  assert.equal(out.conversational_output, conversational);
  assert.equal(out.final_report, "");
});

test("checkBrainstormOutput treats proposal fields with missing terminate as conversational", () => {
  const noTerminate = JSON.stringify({
    proposal: "Build X",
    success_criteria: ["A"],
    scope_in: ["B"],
    scope_out: ["C"],
  });
  const out = checkBrainstormOutput({ agentOutput: noTerminate, source: "blue" });
  assert.equal(out.is_final, "false");
  assert.equal(out.conversational_output, noTerminate);
});

test("checkBrainstormOutput detects final report with markdown fences and terminate true", () => {
  const inner = JSON.stringify({
    proposal: "Ship overnight lab",
    success_criteria: ["metric A"],
    scope_in: ["deliverable B"],
    scope_out: ["excluded C"],
    terminate: true,
  });
  const fenced = "```json\n" + inner + "\n```";
  const out = checkBrainstormOutput({ agentOutput: fenced, source: "red" });
  assert.equal(out.is_final, "true");
  assert.equal(out.source, "red");
  const parsed = JSON.parse(out.final_report);
  assert.equal(parsed.proposal, "Ship overnight lab");
});

test("checkBrainstormOutput detects final report with preamble text and terminate true", () => {
  const report = {
    proposal: "Build X",
    success_criteria: ["A"],
    scope_in: ["B"],
    scope_out: ["C"],
    terminate: true,
  };
  const output = "Here is my final report:\n\n" + JSON.stringify(report, null, 2);
  const out = checkBrainstormOutput({ agentOutput: output, source: "blue" });
  assert.equal(out.is_final, "true");
});

test("checkBrainstormOutput treats terminate as string 'true' as final", () => {
  const report = JSON.stringify({
    proposal: "Build X",
    success_criteria: ["A"],
    scope_in: ["B"],
    scope_out: ["C"],
    terminate: "true",
  });
  const out = checkBrainstormOutput({ agentOutput: report, source: "blue" });
  assert.equal(out.is_final, "true");
});

// --- Conversational output detection ---

test("checkBrainstormOutput treats plain prose as conversational", () => {
  const prose = "I think we should focus on the pipeline runner first. The current approach has too much scope.";
  const out = checkBrainstormOutput({ agentOutput: prose, source: "red" });
  assert.equal(out.is_final, "false");
  assert.equal(out.source, "red");
  assert.equal(out.conversational_output, prose);
  assert.equal(out.final_report, "");
});

test("checkBrainstormOutput treats old-style strategist JSON as conversational", () => {
  // Old red format with position/recommended_changes but no proposal/success_criteria
  const oldRedJson = JSON.stringify({
    position: "The scope is too broad",
    recommended_changes: ["Split into two phases"],
    risks: ["Rate limit exceeded"],
    terminate: false,
  });
  const out = checkBrainstormOutput({ agentOutput: oldRedJson, source: "red" });
  assert.equal(out.is_final, "false");
  assert.equal(out.conversational_output, oldRedJson);
});

test("checkBrainstormOutput treats JSON missing required final fields as conversational", () => {
  // Has proposal but missing success_criteria
  const partial = JSON.stringify({ proposal: "Build X" });
  const out = checkBrainstormOutput({ agentOutput: partial, source: "blue" });
  assert.equal(out.is_final, "false");
  assert.equal(out.conversational_output, partial);
});

test("checkBrainstormOutput treats JSON with empty success_criteria as conversational", () => {
  const empty = JSON.stringify({
    proposal: "Build X",
    success_criteria: [],
    scope_in: ["Y"],
    scope_out: ["Z"],
  });
  const out = checkBrainstormOutput({ agentOutput: empty, source: "blue" });
  assert.equal(out.is_final, "false");
});

// --- Edge cases ---

test("checkBrainstormOutput handles empty output", () => {
  const out = checkBrainstormOutput({ agentOutput: "", source: "red" });
  assert.equal(out.is_final, "false");
  assert.equal(out.conversational_output, "");
});

test("checkBrainstormOutput handles undefined output", () => {
  const out = checkBrainstormOutput({ source: "blue" });
  assert.equal(out.is_final, "false");
});

test("checkBrainstormOutput defaults source to unknown", () => {
  const out = checkBrainstormOutput({ agentOutput: "hello" });
  assert.equal(out.source, "unknown");
});

// --- New verdict fields: should_force_wrap, termination_reason, is_empty_output (#2564) ---

test("checkBrainstormOutput sets should_force_wrap=true and termination_reason for red terminate-non-final", () => {
  // Red strategist shape: terminate:true but no proposal/success_criteria — non-final
  const redNonFinal = JSON.stringify({
    position: "The scope is too broad",
    recommended_changes: ["Split into two phases"],
    risks: ["Rate limit exceeded"],
    terminate: true,
  });
  const out = checkBrainstormOutput({ agentOutput: redNonFinal, source: "red" });
  assert.equal(out.is_final, "false");
  assert.equal(out.should_force_wrap, "true");
  assert.equal(out.termination_reason, "terminate_signal_non_final");
  assert.equal(out.is_empty_output, "false");
  assert.equal(out.final_report, "");
  assert.equal(out.conversational_output, redNonFinal);
});

test("checkBrainstormOutput sets should_force_wrap=true for terminate:true with only partial final fields", () => {
  // Has proposal but missing success_criteria, scope_in, scope_out — non-final despite terminate
  const partialTerminate = JSON.stringify({
    proposal: "Build X",
    terminate: true,
  });
  const out = checkBrainstormOutput({ agentOutput: partialTerminate, source: "blue" });
  assert.equal(out.is_final, "false");
  assert.equal(out.should_force_wrap, "true");
  assert.equal(out.termination_reason, "terminate_signal_non_final");
});

test("checkBrainstormOutput handles terminate:true as string in non-final shape", () => {
  const redNonFinalStringTerminate = JSON.stringify({
    position: "Done discussing",
    terminate: "true",
  });
  const out = checkBrainstormOutput({ agentOutput: redNonFinalStringTerminate, source: "red" });
  assert.equal(out.is_final, "false");
  assert.equal(out.should_force_wrap, "true");
  assert.equal(out.termination_reason, "terminate_signal_non_final");
});

test("checkBrainstormOutput sets is_empty_output=true for empty string", () => {
  const out = checkBrainstormOutput({ agentOutput: "", source: "blue" });
  assert.equal(out.is_empty_output, "true");
  assert.equal(out.is_final, "false");
  assert.equal(out.should_force_wrap, "false");
});

test("checkBrainstormOutput sets is_empty_output=true for whitespace-only output", () => {
  const out = checkBrainstormOutput({ agentOutput: "   \n\t  ", source: "blue" });
  assert.equal(out.is_empty_output, "true");
  assert.equal(out.is_final, "false");
  assert.equal(out.should_force_wrap, "false");
});

test("checkBrainstormOutput sets is_empty_output=false for non-empty conversational output", () => {
  const out = checkBrainstormOutput({ agentOutput: "I think we should narrow the scope.", source: "red" });
  assert.equal(out.is_empty_output, "false");
  assert.equal(out.should_force_wrap, "false");
  assert.equal(out.termination_reason, "");
});

test("checkBrainstormOutput backward-compatible: valid final report still has no force-wrap", () => {
  const validFinal = JSON.stringify({
    proposal: "Ship the pipeline runner",
    success_criteria: ["P95 latency < 200ms"],
    scope_in: ["pipeline runner"],
    scope_out: ["UI"],
    terminate: true,
  });
  const out = checkBrainstormOutput({ agentOutput: validFinal, source: "blue" });
  // Legacy fields unchanged
  assert.equal(out.is_final, "true");
  assert.ok(out.final_report.length > 0);
  assert.equal(out.conversational_output, "");
  // New fields: no force wrap on valid final
  assert.equal(out.should_force_wrap, "false");
  assert.equal(out.termination_reason, "");
  assert.equal(out.is_empty_output, "false");
});

test("checkBrainstormOutput sets should_force_wrap=true for blue source terminate-non-final", () => {
  // Blue strategist shape with terminate:true but no proposal/success_criteria — non-final
  const blueNonFinal = JSON.stringify({
    position: "The proposal looks good overall",
    recommended_changes: [],
    risks: [],
    terminate: true,
  });
  const out = checkBrainstormOutput({ agentOutput: blueNonFinal, source: "blue" });
  assert.equal(out.is_final, "false");
  assert.equal(out.should_force_wrap, "true");
  assert.equal(out.termination_reason, "terminate_signal_non_final");
  assert.equal(out.source, "blue");
  assert.equal(out.final_report, "");
});
