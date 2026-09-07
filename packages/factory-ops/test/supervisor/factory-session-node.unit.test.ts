import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { factorySessionNode } from "../../src/commands/factory-session-node.ts";

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function createStdoutBuffer() {
  let value = "";
  return {
    write(chunk) {
      value += String(chunk);
      return true;
    },
    read() {
      return value;
    },
  };
}

test("factorySessionNode resolves and renders node-scoped session logs", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-session-node-"));
  const runsDir = join(root, ".hatch", "runs");
  mkdirSync(runsDir, { recursive: true });

  const runId = "run-abc";
  writeJson(join(runsDir, runId, "state.json"), {
    runId,
    status: "running",
    pipelineFile: "wave_issue_execute.dot",
    updatedAt: "2026-03-11T11:00:00.000Z",
  });

  const sessionPath = join(runsDir, runId, "sessions", "resolve_conflict", "session.jsonl");
  mkdirSync(dirname(sessionPath), { recursive: true });
  writeFileSync(sessionPath, `${[
    JSON.stringify({ type: "session", id: "resolve_conflict" }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-03-11T11:00:01.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", name: "bash", arguments: { command: "git status -sb" } },
          { type: "text", text: "Checking merge conflict markers." },
        ],
      },
    }),
  ].join("\n")}\n`);

  const stdout = createStdoutBuffer();
  const out = await factorySessionNode({
    runsDir,
    runId,
    node: "resolve_conflict",
    lines: 10,
    follow: false,
    pollMs: 1000,
    stdout,
  });

  assert.equal(out.ok, true);
  assert.equal(out.run_id, runId);
  assert.equal(out.node, "resolve_conflict");
  assert.match(out.session_log, /resolve_conflict\/session\.jsonl$/);

  const rendered = stdout.read();
  assert.match(rendered, /session_log=.*resolve_conflict\/session\.jsonl/);
  assert.match(rendered, /\[2026-03-11T11:00:01.000Z\] assistant bash\(/);
  assert.match(rendered, /Checking merge conflict markers\./);
});

test("factorySessionNode returns deterministic missing-node payload with available node list", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-session-node-missing-"));
  const runsDir = join(root, ".hatch", "runs");
  mkdirSync(runsDir, { recursive: true });

  const runId = "run-xyz";
  writeJson(join(runsDir, runId, "state.json"), {
    runId,
    status: "running",
    pipelineFile: "wave_issue_execute.dot",
    updatedAt: "2026-03-11T11:10:00.000Z",
  });

  mkdirSync(join(runsDir, runId, "sessions", "resolve_conflict"), { recursive: true });
  mkdirSync(join(runsDir, runId, "sessions", "review"), { recursive: true });

  const stdout = createStdoutBuffer();
  const out = await factorySessionNode({
    runsDir,
    runId,
    node: "nonexistent_node",
    lines: 20,
    follow: false,
    pollMs: 1000,
    stdout,
  });

  assert.equal(out.ok, false);
  assert.equal(out.error, "session_not_found_for_node");
  assert.deepEqual(out.available_nodes, ["resolve_conflict", "review"]);

  const rendered = stdout.read();
  assert.match(rendered, /session_log_not_found run_id=run-xyz node=nonexistent_node/);
  assert.match(rendered, /available_nodes=resolve_conflict,review/);
});
