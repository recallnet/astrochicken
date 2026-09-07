import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { resolveSessionTrace } from "../../src/lib/factory-session-log.ts";

function writeJsonl(path) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '{"type":"session","id":"test"}\n', "utf8");
}

test("resolveSessionTrace honors explicit child role metadata before node heuristics", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-session-log-"));
  const runSessionsDir = join(root, "runs", "abc", "sessions");

  const buildLog = join(runSessionsDir, "build", "sess-coder", "events.jsonl");
  const reviewLog = join(runSessionsDir, "review", "sess-review", "events.jsonl");
  const managerLog = join(runSessionsDir, "resolve_conflict", "sess-manager", "events.jsonl");
  const judgeLog = join(runSessionsDir, "judge", "sess-judge", "events.jsonl");
  writeJsonl(buildLog);
  writeJsonl(reviewLog);
  writeJsonl(managerLog);
  writeJsonl(judgeLog);

  const runState = {
    runId: "abc",
    currentNode: "build",
    context: {},
  };

  const reviewer = resolveSessionTrace(runState, {
    runSessionsDir,
    childMetadata: {
      childId: "child-review",
      role: "reviewer",
      traceKind: "reviewer",
      sessionId: "sess-review",
    },
  });
  assert.equal(reviewer.traceKind, "reviewer");
  assert.equal(reviewer.sessionLog, reviewLog);

  const manager = resolveSessionTrace(runState, {
    runSessionsDir,
    childMetadata: {
      childId: "child-manager",
      role: "manager",
      traceKind: "manager",
      sessionId: "sess-manager",
    },
  });
  assert.equal(manager.traceKind, "manager");
  assert.equal(manager.sessionLog, managerLog);

  const judge = resolveSessionTrace(runState, {
    runSessionsDir,
    childMetadata: {
      childId: "child-judge",
      role: "judge",
      traceKind: "judge",
      sessionId: "sess-judge",
    },
  });
  assert.equal(judge.traceKind, "judge");
  assert.equal(judge.sessionLog, judgeLog);

  const coder = resolveSessionTrace(runState, {
    runSessionsDir,
    childMetadata: {
      childId: "child-coder",
      role: "coder",
      traceKind: "coder",
      sessionId: "sess-coder",
    },
  });
  assert.equal(coder.traceKind, "coder");
  assert.equal(coder.sessionLog, buildLog);
});

test("resolveSessionTrace uses explicit coder session metadata for wave session directories", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-session-wave-"));
  const runSessionsDir = join(root, "runs", "abc", "sessions");
  const waveSessionLog = join(root, "wave-sessions", "sess-coder", "events.jsonl");
  writeJsonl(join(runSessionsDir, "build", "fallback", "events.jsonl"));
  writeJsonl(waveSessionLog);

  const runState = {
    runId: "abc",
    currentNode: "build",
    context: {
      repo: root,
      wave_sessions_dir: "wave-sessions",
      agent_session_id: "old-session",
    },
  };

  const out = resolveSessionTrace(runState, {
    runSessionsDir,
    childMetadata: {
      childId: "child-coder",
      role: "coder",
      traceKind: "coder",
      sessionId: "sess-coder",
    },
  });

  assert.equal(out.traceKind, "coder");
  assert.equal(out.sessionLog, waveSessionLog);
});
