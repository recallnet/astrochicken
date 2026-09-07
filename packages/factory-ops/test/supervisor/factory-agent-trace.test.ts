import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { factoryAgentTrace } from "../../src/commands/factory-agent-trace.ts";

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

test("factoryAgentTrace returns latest assistant text/tool outputs for active wave issue run", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-agent-trace-"));
  const runsDir = join(root, ".hatch", "runs");
  mkdirSync(runsDir, { recursive: true });

  const repo = root;
  const sessionDir = join(repo, ".hatch", "wave-sessions", "goal-1-wave-1", "milestone-goal-1-wave-1");
  mkdirSync(sessionDir, { recursive: true });
  const sessionPath = join(sessionDir, "2026-01-01T00-00-00Z_test.jsonl");
  const lines = [
    JSON.stringify({ type: "session", id: "s1" }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-01-01T00:00:01Z",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", name: "bash", arguments: { command: "git status -sb" } }],
      },
    }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-01-01T00:00:02Z",
      message: {
        role: "toolResult",
        toolName: "bash",
        isError: false,
        content: [{ type: "text", text: "## wave/goal-1-wave-1" }],
      },
    }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-01-01T00:00:03Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Implemented fix and running tests." }],
      },
    }),
  ];
  writeFileSync(sessionPath, `${lines.join("\n")}\n`);

  const runId = "abc12345";
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  writeJson(join(runDir, "state.json"), {
    runId,
    status: "running",
    pipelineFile: "/tmp/wave_issue_execute.dot",
    currentNode: "build",
    updatedAt: "2026-01-01T00:00:10Z",
    context: {
      repo,
      wave_sessions_dir: ".hatch/wave-sessions/goal-1-wave-1",
      agent_session_id: "milestone-goal-1-wave-1",
      issue_number: "583",
      issue_title: "Early empty-branch gate",
      branch: "wave/goal-1-wave-1",
      review_attempt: "1",
    },
    completedNodes: [{ id: "snapshot_head", completedAt: "2026-01-01T00:00:09Z" }],
    records: [
      {
        nodeId: "review",
        outcome: {
          output: JSON.stringify({
            schema: "verdict/v1",
            verdict_kind: "code_review",
            disposition: "reject",
            confidence: "high",
            recommended_transition: "revise",
            observation: {},
            recommendation: { action: "revise_issue", fixes: ["Narrow the implementation scope."] },
            reason_codes: ["SCOPE_MISMATCH"],
            notes: "Narrow the implementation scope.",
          }),
        },
      },
    ],
  });

  const out = factoryAgentTrace({ runsDir, maxItems: 2 });
  assert.equal(out.ok, true);
  assert.equal(out.run_id, runId);
  assert.equal(out.issue_number, "583");
  assert.match(out.latest_assistant_text, /Implemented fix/);
  assert.equal(out.last_tool_calls[0].name, "bash");
  assert.match(out.last_tool_results[0].output, /wave\/goal-1-wave-1/);
  assert.equal(out.last_review_result.disposition, "reject");
  assert.deepEqual(out.last_review_result.reason_codes, ["SCOPE_MISMATCH"]);
  assert.match(out.session_log, /2026-01-01T00-00-00Z_test\.jsonl$/);
});

test("factoryAgentTrace falls back to per-run sessions when no wave session is present", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-agent-trace-run-sessions-"));
  const runsDir = join(root, ".hatch", "runs");
  mkdirSync(runsDir, { recursive: true });

  const runId = "run-session-1";
  const runDir = join(runsDir, runId);
  const sessionDir = join(runDir, "sessions", "review");
  mkdirSync(sessionDir, { recursive: true });
  const sessionPath = join(sessionDir, "2026-01-01T00-00-00Z_review.jsonl");
  writeFileSync(sessionPath, `${[
    JSON.stringify({ type: "session", id: "review" }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-01-01T00:00:01Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Reviewing current branch changes." }],
      },
    }),
  ].join("\n")}\n`);

  mkdirSync(runDir, { recursive: true });
  writeJson(join(runDir, "state.json"), {
    runId,
    status: "running",
    pipelineFile: "/tmp/wave_issue_execute.dot",
    currentNode: "review",
    updatedAt: "2026-01-01T00:00:10Z",
    context: {
      __run_sessions_dir: sessionDir.replace(/\/review$/, ""),
      issue_number: "9002",
      issue_title: "Review fallback trace",
      branch: "wave/goal-999-wave-1",
    },
  });

  const out = factoryAgentTrace({ runsDir, runId, maxItems: 2 });
  assert.equal(out.ok, true);
  assert.equal(out.run_id, runId);
  assert.match(out.latest_assistant_text, /Reviewing current branch changes/);
  assert.match(out.session_log, /2026-01-01T00-00-00Z_review\.jsonl$/);
});

test("factoryAgentTrace prefers review session over wave coder log when review is active", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-agent-trace-review-priority-"));
  const runsDir = join(root, ".hatch", "runs");
  mkdirSync(runsDir, { recursive: true });

  const repo = root;
  const waveSessionDir = join(repo, ".hatch", "wave-sessions", "goal-1-wave-1", "milestone-goal-1-wave-1");
  mkdirSync(waveSessionDir, { recursive: true });
  writeFileSync(join(waveSessionDir, "2026-01-01T00-00-00Z_build.jsonl"), `${[
    JSON.stringify({ type: "session", id: "build" }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-01-01T00:00:01Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Coding in worktree session." }],
      },
    }),
  ].join("\n")}\n`);

  const runId = "run-review-priority";
  const runDir = join(runsDir, runId);
  const reviewSessionDir = join(runDir, "sessions", "review");
  mkdirSync(reviewSessionDir, { recursive: true });
  writeFileSync(join(reviewSessionDir, "2026-01-01T00-00-01Z_review.jsonl"), `${[
    JSON.stringify({ type: "session", id: "review" }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-01-01T00:00:02Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Reviewer is evaluating the issue scope." }],
      },
    }),
  ].join("\n")}\n`);

  writeJson(join(runDir, "state.json"), {
    runId,
    status: "running",
    pipelineFile: "/tmp/wave_issue_execute.dot",
    currentNode: "review",
    updatedAt: "2026-01-01T00:00:10Z",
    context: {
      repo,
      wave_sessions_dir: ".hatch/wave-sessions/goal-1-wave-1",
      agent_session_id: "milestone-goal-1-wave-1",
      __run_sessions_dir: join(runDir, "sessions"),
      issue_number: "1023",
      issue_title: "Review session selection",
      branch: "wave/goal-1-wave-1",
    },
  });

  const out = factoryAgentTrace({ runsDir, runId, maxItems: 2 });
  assert.equal(out.ok, true);
  assert.match(out.latest_assistant_text, /Reviewer is evaluating the issue scope/);
  assert.match(out.session_log, /review\.jsonl$/);
});

test("factoryAgentTrace keeps worktree session selected when build is active", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-agent-trace-build-priority-"));
  const runsDir = join(root, ".hatch", "runs");
  mkdirSync(runsDir, { recursive: true });

  const repo = root;
  const waveSessionDir = join(repo, ".hatch", "wave-sessions", "goal-1-wave-1", "milestone-goal-1-wave-1");
  mkdirSync(waveSessionDir, { recursive: true });
  writeFileSync(join(waveSessionDir, "2026-01-01T00-00-00Z_build.jsonl"), `${[
    JSON.stringify({ type: "session", id: "build" }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-01-01T00:00:01Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Coder is still building the feature." }],
      },
    }),
  ].join("\n")}\n`);

  const runId = "run-build-priority";
  const runDir = join(runsDir, runId);
  const reviewSessionDir = join(runDir, "sessions", "review");
  mkdirSync(reviewSessionDir, { recursive: true });
  writeFileSync(join(reviewSessionDir, "2026-01-01T00-00-01Z_review.jsonl"), `${[
    JSON.stringify({ type: "session", id: "review" }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-01-01T00:00:02Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Reviewer transcript should not win during build." }],
      },
    }),
  ].join("\n")}\n`);

  writeJson(join(runDir, "state.json"), {
    runId,
    status: "running",
    pipelineFile: "/tmp/wave_issue_execute.dot",
    currentNode: "build",
    updatedAt: "2026-01-01T00:00:10Z",
    context: {
      repo,
      wave_sessions_dir: ".hatch/wave-sessions/goal-1-wave-1",
      agent_session_id: "milestone-goal-1-wave-1",
      __run_sessions_dir: join(runDir, "sessions"),
      issue_number: "1023",
      issue_title: "Build session selection",
      branch: "wave/goal-1-wave-1",
    },
  });

  const out = factoryAgentTrace({ runsDir, runId, maxItems: 2 });
  assert.equal(out.ok, true);
  assert.match(out.latest_assistant_text, /Coder is still building the feature/);
  assert.match(out.session_log, /build\.jsonl$/);
});
