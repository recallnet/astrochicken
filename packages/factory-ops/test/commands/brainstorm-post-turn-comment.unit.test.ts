import assert from "node:assert/strict";
import test from "node:test";

import { postBrainstormTurnComment } from "../../src/commands/brainstorm-post-turn-comment.ts";

// --- Conversational output ---

test("postBrainstormTurnComment posts conversational red output with role header", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };

  const out = postBrainstormTurnComment({
    repo: "example-org/example-notes",
    issueNumber: "1",
    source: "red",
    round: "1",
    agentOutput: "The scope is too broad. You should split the pipeline runner from checkpoint storage.",
    isFinal: "false",
    ghExec,
  });

  assert.equal(out.ok, true);
  assert.equal(calls.length, 1);
  const body = calls[0][calls[0].indexOf("--body") + 1];
  assert.match(body, /Red Strategist.*round 1/i);
  assert.match(body, /The scope is too broad/);
});

test("postBrainstormTurnComment posts conversational blue output with role header", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };

  postBrainstormTurnComment({
    repo: "example-org/example-notes",
    issueNumber: "1",
    source: "blue",
    round: "2",
    agentOutput: "I've tightened the scope. Here's the revised proposal.",
    isFinal: "false",
    ghExec,
  });

  const body = calls[0][calls[0].indexOf("--body") + 1];
  assert.match(body, /Blue Strategist.*round 2/i);
  assert.match(body, /I've tightened the scope/);
});

// --- Final report ---

test("postBrainstormTurnComment renders final report JSON as markdown", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };

  const finalReport = JSON.stringify({
    proposal: "Build an overnight lab pipeline",
    success_criteria: ["P95 latency < 200ms", "Zero data loss on restart"],
    scope_in: ["pipeline runner", "checkpoint storage"],
    scope_out: ["UI dashboard"],
    risks: ["Rate limit on >50 sub-issues"],
  });

  postBrainstormTurnComment({
    repo: "example-org/example-notes",
    issueNumber: "1",
    source: "blue",
    round: "3",
    agentOutput: finalReport,
    isFinal: "true",
    ghExec,
  });

  const body = calls[0][calls[0].indexOf("--body") + 1];
  assert.match(body, /Final Report/i);
  assert.match(body, /Build an overnight lab pipeline/);
  assert.match(body, /P95 latency < 200ms/);
  assert.match(body, /pipeline runner/);
  assert.match(body, /UI dashboard/);
  assert.match(body, /Rate limit/);
  // Should NOT contain raw JSON
  assert.doesNotMatch(body, /"proposal":/);
});

test("postBrainstormTurnComment preserves prose and renders JSON as markdown in mixed final output", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };

  const mixedOutput = `Red strategist commentary here. The proposal is solid.

Finalizing.

{"proposal":"Build X","success_criteria":["A"],"scope_in":["B"],"scope_out":["C"],"risks":["D"]}`;

  postBrainstormTurnComment({
    repo: "example-org/example-notes",
    issueNumber: "1",
    source: "red",
    round: "2",
    agentOutput: mixedOutput,
    isFinal: "true",
    ghExec,
  });

  const body = calls[0][calls[0].indexOf("--body") + 1];
  assert.match(body, /Final Report/i);
  // Prose commentary preserved above the formatted report
  assert.match(body, /The proposal is solid/);
  assert.match(body, /Finalizing/);
  // JSON rendered as structured markdown
  assert.match(body, /Build X/);
  assert.match(body, /\*\*Success Criteria\*\*/);
  // Raw JSON stripped
  assert.doesNotMatch(body, /"proposal":/);
});

test("postBrainstormTurnComment shows only formatted report when output is pure JSON", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };

  const pureJson = JSON.stringify({
    proposal: "Pure JSON goal",
    success_criteria: ["X"],
    scope_in: ["Y"],
    scope_out: ["Z"],
  });

  postBrainstormTurnComment({
    repo: "example-org/example-notes",
    issueNumber: "1",
    source: "blue",
    round: "3",
    agentOutput: pureJson,
    isFinal: "true",
    ghExec,
  });

  const body = calls[0][calls[0].indexOf("--body") + 1];
  assert.match(body, /Final Report/i);
  assert.match(body, /Pure JSON goal/);
  // No prose preamble — starts right at report
  assert.doesNotMatch(body, /"proposal":/);
});

// --- Trace links ---

test("postBrainstormTurnComment appends trace links when langfuse env is available", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };

  postBrainstormTurnComment({
    repo: "example-org/example-notes",
    issueNumber: "1",
    source: "blue",
    round: "3",
    agentOutput: JSON.stringify({
      proposal: "Ship X",
      success_criteria: ["A"],
      scope_in: ["B"],
      scope_out: ["C"],
    }),
    isFinal: "true",
    runId: "run_abc",
    langfuseProjectUrl: "https://us.cloud.langfuse.com/project/p123",
    ghExec,
  });

  const body = calls[0][calls[0].indexOf("--body") + 1];
  assert.match(body, /Red Strategist.*langfuse/i);
  assert.match(body, /Blue Strategist.*langfuse/i);
  assert.match(body, /https:\/\/us\.cloud\.langfuse\.com\/project\/p123\/traces\/lf_trace_/);
});

test("postBrainstormTurnComment omits trace links when langfuse env is missing", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };

  postBrainstormTurnComment({
    repo: "example-org/example-notes",
    issueNumber: "1",
    source: "red",
    round: "1",
    agentOutput: "some critique",
    isFinal: "false",
    ghExec,
  });

  const body = calls[0][calls[0].indexOf("--body") + 1];
  assert.doesNotMatch(body, /langfuse/i);
});

// --- Error handling ---

test("postBrainstormTurnComment surfaces gh comment failure", () => {
  const ghExec = () => ({ ok: false, status: 1, stdout: "", stderr: "forbidden" });

  assert.throws(() => postBrainstormTurnComment({
    repo: "example-org/example-notes",
    issueNumber: "1",
    source: "red",
    round: "1",
    agentOutput: "critique",
    isFinal: "false",
    ghExec,
  }), /comment_failed/);
});

test("postBrainstormTurnComment skips comment when output is empty", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };

  const out = postBrainstormTurnComment({
    repo: "example-org/example-notes",
    issueNumber: "1",
    source: "red",
    round: "1",
    agentOutput: "",
    isFinal: "false",
    ghExec,
  });

  assert.equal(out.ok, true);
  assert.equal(out.skipped, "true");
  assert.equal(calls.length, 0);
});

// --- Role name formatting ---

test("postBrainstormTurnComment uses proper role names for force_wrap and format_repair", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };

  postBrainstormTurnComment({
    repo: "example-org/example-notes",
    issueNumber: "1",
    source: "force_wrap",
    round: "10",
    agentOutput: "wrapped output",
    isFinal: "false",
    ghExec,
  });

  const body = calls[0][calls[0].indexOf("--body") + 1];
  assert.match(body, /Blue Strategist.*final wrap/i);
});

// --- Suppression signal ---

test("postBrainstormTurnComment skips comment when suppressRoundComment is true even with non-empty output", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };

  const out = postBrainstormTurnComment({
    repo: "example-org/example-notes",
    issueNumber: "1",
    source: "red",
    round: "2",
    agentOutput: "I think we should terminate. The proposal is solid.",
    isFinal: "false",
    suppressRoundComment: "true",
    ghExec,
  });

  assert.equal(out.ok, true);
  assert.equal(out.skipped, "true");
  assert.equal(calls.length, 0);
});

test("postBrainstormTurnComment posts comment when suppressRoundComment is false", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };

  const out = postBrainstormTurnComment({
    repo: "example-org/example-notes",
    issueNumber: "1",
    source: "blue",
    round: "2",
    agentOutput: "Normal conversational output here.",
    isFinal: "false",
    suppressRoundComment: "false",
    ghExec,
  });

  assert.equal(out.ok, true);
  assert.equal(out.skipped, "false");
  assert.equal(calls.length, 1);
});

test("postBrainstormTurnComment posts comment when suppressRoundComment is omitted (default behavior)", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push(args);
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };

  const out = postBrainstormTurnComment({
    repo: "example-org/example-notes",
    issueNumber: "1",
    source: "red",
    round: "1",
    agentOutput: "Some critique here.",
    isFinal: "false",
    ghExec,
  });

  assert.equal(out.ok, true);
  assert.equal(out.skipped, "false");
  assert.equal(calls.length, 1);
});
