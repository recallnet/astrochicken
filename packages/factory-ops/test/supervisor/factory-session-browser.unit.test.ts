import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildFactorySessionBrowserSnapshot,
  resolveSessionBrowserOpenSpec,
} from "../../src/commands/factory-session-browser.ts";

function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function writeRun(root, runId, state, sessionEntries = []) {
  const runDir = join(root, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "state.json"), JSON.stringify(state, null, 2));
  if (sessionEntries.length > 0) {
    const sessionDir = join(runDir, "sessions", "review");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, `${runId}.jsonl`), `${sessionEntries.join("\n")}\n`);
  }
}

test("buildFactorySessionBrowserSnapshot groups active, recent, and history sessions with live and transcript modes", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-session-browser-"));
  const inventoryDir = join(runsDir, "..", "repo", "factories", "mothership", "inventory");
  mkdirSync(inventoryDir, { recursive: true });
  writeFileSync(join(inventoryDir, "llm-role-session-baseline.json"), JSON.stringify({
    schema_version: "1",
    nodes: [
      { class: "coder", provider: "openrouter", model: "openai/gpt-5.3-codex" },
      { class: "reviewer", provider: "openrouter", model: "anthropic/claude-sonnet-4.6" },
      { class: "supervisor", provider: "openrouter", model: "anthropic/claude-sonnet-4.6" },
      { class: "judge", provider: "openrouter", model: "anthropic/claude-sonnet-4.6" },
    ],
  }, null, 2));

  writeRun(runsDir, "run-live", {
    runId: "run-live",
    status: "running",
    pipelineFile: "/tmp/goal_issue_execute.dot",
    currentNode: "build",
    updatedAt: "2026-03-16T21:00:00.000Z",
    context: {
      issue_number: "2175",
      issue_title: "Issue #2175",
      goal_issue_number: "2140",
      agent_session_id: "goal-2140-issue-2175",
      repo: join(runsDir, "..", "repo"),
      worktree_dir: join(runsDir, "..", "repo", ".hatch-worktrees", "goal-2140", "2175"),
      wave_sessions_dir: ".hatch/wave-sessions",
    },
  }, [
    JSON.stringify({ type: "session", id: "goal-2140-issue-2175" }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-03-16T21:00:01.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Building the feature." }],
      },
    }),
  ]);

  writeRun(runsDir, "run-recent", {
    runId: "run-recent",
    status: "completed",
    pipelineFile: "/tmp/review.dot",
    currentNode: "review",
    updatedAt: "2026-03-16T20:30:00.000Z",
    context: {
      issue_number: "2174",
      issue_title: "Issue #2174",
      agent_session_id: "issue-2174-review",
      __run_sessions_dir: join(runsDir, "run-recent", "sessions"),
      worktree_dir: join(runsDir, "..", "repo", ".hatch-worktrees", "goal-2140", "2174"),
    },
  }, [
    JSON.stringify({ type: "session", id: "issue-2174-review" }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-03-16T20:30:01.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Review completed." }],
      },
    }),
  ]);
  mkdirSync(join(runsDir, "run-recent", "sessions", "issue-2174-review"), { recursive: true });
  mkdirSync(join(runsDir, "..", "repo", ".hatch-worktrees", "goal-2140", "2174"), { recursive: true });

  const summary = {
    context: { factory_id: "mothership", runs_dir: runsDir },
    waves: [],
    non_wave_active: [{
      kind: "goal_issue",
      run_id: "run-live",
      node: "build",
      graph: "/tmp/goal_issue_execute.dot",
      graph_label: "goal_issue_execute.dot",
      issue_number: 2175,
      goal_issue_number: 2140,
      trace_available: true,
      trace_kind: "coder",
      trace_command: `node packages/factory-ops/src/cli.ts factory session-tail --run-id run-live --runs-dir '${runsDir}' --follow`,
      trace_session_log: join(runsDir, "run-live", "sessions", "review", "run-live.jsonl"),
      live_attachable: true,
      live_attach_target: {
        factory_id: "mothership",
        run_id: "run-live",
        trace_kind: "coder",
        session_id: "goal-2140-issue-2175",
        node: "build",
      },
      updated_at: "2026-03-16T21:00:00.000Z",
      updated_age: "1m",
      summary: "build • issue run completes",
    }],
  };

  const snapshot = buildFactorySessionBrowserSnapshot({
    runsDir,
    nowMs: Date.parse("2026-03-16T21:01:00.000Z"),
    context: { factory_id: "mothership" },
    factoryActiveSummaryFn: () => summary,
    repoRoot: join(runsDir, "..", "repo"),
  });

  assert.equal(snapshot.views.active.rows.length, 1);
  assert.equal(snapshot.views.recent.rows.length, 1);
  assert.equal(snapshot.views.history.rows.length, 2);

  const activeRow = snapshot.views.active.rows[0];
  assert.equal(activeRow.mode, "live");
  assert.equal(activeRow.kind, "goal_issue");
  assert.equal(activeRow.progress_label, "build");
  assert.equal(activeRow.issue, "#2175");
  assert.equal(activeRow.goal_issue, "#2140");

  const recentRow = snapshot.views.recent.rows[0];
  assert.equal(recentRow.mode, "resume");
  assert.equal(recentRow.issue, "#2174");
  assert.match(recentRow.summary, /Review completed/);
  assert.equal(recentRow.resume_target.session_id, "issue-2174-review");
  assert.match(recentRow.resume_target.session_dir, /run-recent\/sessions\/issue-2174-review$/);
  assert.equal(recentRow.resume_target.provider, "openrouter");
  assert.equal(recentRow.resume_target.model, "anthropic/claude-sonnet-4.6");

  const openSpec = resolveSessionBrowserOpenSpec(activeRow);
  assert.equal(openSpec.mode, "live");
  assert.equal(openSpec.read_only, false);
  assert.equal(openSpec.target.run_id, "run-live");

  const transcriptSpec = resolveSessionBrowserOpenSpec(recentRow);
  assert.equal(transcriptSpec.mode, "resume");
  assert.equal(transcriptSpec.read_only, false);
  assert.match(transcriptSpec.session_log, /run-recent\.jsonl$/);
  assert.equal(transcriptSpec.target.session_id, "issue-2174-review");
});

test("buildFactorySessionBrowserSnapshot keeps active rows in stable dashboard-like order", () => {
  const summary = {
    context: { factory_id: "mothership" },
    waves: [],
    non_wave_active: [
      {
        kind: "goal_issue",
        run_id: "run-b",
        issue_number: 2177,
        goal_issue_number: 2140,
        title: "Issue #2177",
        node: "build",
        live_attachable: false,
      },
      {
        kind: "supervisor",
        run_id: "run-supervisor",
        title: "Supervisor",
        node: "fan_out_goal_run",
        live_attachable: false,
      },
      {
        kind: "goal_issue",
        run_id: "run-a",
        issue_number: 2175,
        goal_issue_number: 2140,
        title: "Issue #2175",
        node: "review",
        live_attachable: false,
      },
    ],
  };

  const snapshot = buildFactorySessionBrowserSnapshot({
    runsDir: ".hatch/mothership/runs",
    nowMs: Date.parse("2026-03-16T21:01:00.000Z"),
    context: { factory_id: "mothership" },
    factoryActiveSummaryFn: () => summary,
    readAllRunStatesFn: () => [],
  });

  assert.deepEqual(snapshot.views.active.rows.map((row) => row.run_id), [
    "run-supervisor",
    "run-a",
    "run-b",
  ]);
});

test("buildFactorySessionBrowserSnapshot falls back to transcript when resumable session state is incomplete", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "factory-session-browser-transcript-"));
  writeRun(runsDir, "run-recent", {
    runId: "run-recent",
    status: "completed",
    pipelineFile: "/tmp/review.dot",
    currentNode: "review",
    updatedAt: "2026-03-16T20:30:00.000Z",
    context: {
      issue_number: "2174",
      issue_title: "Issue #2174",
      agent_session_id: "issue-2174-review",
      __run_sessions_dir: join(runsDir, "run-recent", "sessions"),
    },
  }, [
    JSON.stringify({
      type: "message",
      timestamp: "2026-03-16T20:30:01.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "Review completed." }] },
    }),
  ]);

  const snapshot = buildFactorySessionBrowserSnapshot({
    runsDir,
    nowMs: Date.parse("2026-03-16T21:01:00.000Z"),
    context: { factory_id: "mothership" },
    factoryActiveSummaryFn: () => ({ context: { factory_id: "mothership" }, waves: [], non_wave_active: [] }),
  });

  const recentRow = snapshot.views.recent.rows[0];
  assert.equal(recentRow.mode, "transcript");
  assert.equal(recentRow.resume_target, null);
});
