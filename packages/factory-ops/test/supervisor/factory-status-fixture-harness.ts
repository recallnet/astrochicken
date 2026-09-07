import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createRunsFixture(prefix = "factory-status-fixture-") {
  const rootDir = mkdtempSync(join(tmpdir(), prefix));
  const runsDir = join(rootDir, "runs");
  mkdirSync(runsDir, { recursive: true });
  return { rootDir, runsDir };
}

export function writeRunState(runsDir, runId, state, metadata = null) {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "state.json"), JSON.stringify({
    runId,
    ...state,
  }, null, 2));
  if (metadata) {
    writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2));
  }
  return runDir;
}

export function writeLifecycleEvent(runsDir, runId, event) {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  appendFileSync(join(runDir, "lifecycle-events.jsonl"), `${JSON.stringify(event)}\n`);
}

export function writeSessionLog(runsDir, runId, relativeDir, entries) {
  const sessionDir = join(runsDir, runId, "sessions", ...relativeDir.split("/"));
  mkdirSync(sessionDir, { recursive: true });
  const path = join(sessionDir, "session.jsonl");
  writeFileSync(path, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return path;
}

export function writeRegistryFixture(dir, registryJson) {
  const registryPath = join(dir, "registry.json");
  writeFileSync(registryPath, JSON.stringify(registryJson, null, 2));
  return registryPath;
}

export function buildRecoveredWaveFixture() {
  const { rootDir, runsDir } = createRunsFixture("factory-status-recovered-");
  const now = new Date().toISOString();
  const earlier = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  writeRunState(runsDir, "tick-1", {
    pipeline: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    pipelineFile: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    status: "running",
    currentNode: "fan_out_wave_execute",
    startedAt: earlier,
    updatedAt: now,
    context: {
      goal_count: 3,
      __child_run_id_fan_out_wave_execute: "wave-1",
    },
  });

  writeRunState(runsDir, "wave-1", {
    pipeline: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
    pipelineFile: "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
    status: "running",
    currentNode: "execute_issue_in_wave",
    startedAt: earlier,
    updatedAt: now,
    context: {
      milestone_title: "goal-1564-wave-2",
      ready_issue_number: "1646",
      current_issue_number: "1625",
      next_issue_number: "1625",
      processed_issues: JSON.stringify([1624]),
      milestone_issues: JSON.stringify([
        { number: 1624, title: "Recovered issue" },
        { number: 1625, title: "Resume worktree" },
        { number: 1626, title: "Follow-on issue" },
        { number: 1646, title: "Wave Ready: goal-1564-wave-2" },
      ]),
      __child_run_id_execute_issue_in_wave: "issue-1",
    },
    activeChildren: {
      execute_issue_in_wave__issue_1: {
        childId: "execute_issue_in_wave__issue_1",
        parentNodeId: "execute_issue_in_wave",
        childRunId: "issue-1",
        childRunDir: join(runsDir, "issue-1"),
        role: "coder",
        traceKind: "coder",
        status: "running",
        currentNode: "build",
      },
    },
  });

  writeRunState(runsDir, "issue-1", {
    pipeline: "factories/mothership/workflows/wave-execution/wave_issue_execute.workflow-source.mjs",
    pipelineFile: "factories/mothership/workflows/wave-execution/wave_issue_execute.workflow-source.mjs",
    status: "running",
    currentNode: "build",
    startedAt: earlier,
    updatedAt: now,
    context: {
      issue_number: "1625",
      milestone_title: "goal-1564-wave-2",
      reuse_existing_commits: "true",
    },
  });

  writeRunState(runsDir, "supervisor-helper", {
    pipeline: "factories/mothership/graphs/artifact_ingest.dot",
    pipelineFile: "factories/mothership/graphs/artifact_ingest.dot",
    status: "running",
    currentNode: "sanitize_state",
    startedAt: earlier,
    updatedAt: now,
    context: {},
  });

  const sessionLog = writeSessionLog(runsDir, "issue-1", "build/coder", [
    { type: "session", id: "sess-1" },
    {
      type: "message",
      timestamp: "2026-03-10T16:00:00.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", name: "apply_patch", arguments: { file: "src/index.ts" } },
          { type: "text", text: "Resuming existing worktree and validating remaining build steps." },
        ],
      },
    },
    {
      type: "message",
      timestamp: "2026-03-10T16:00:01.000Z",
      message: {
        role: "toolResult",
        toolName: "apply_patch",
        isError: false,
        content: [{ type: "text", text: "patched" }],
      },
    },
  ]);

  writeLifecycleEvent(runsDir, "issue-1", {
    event: "node-change",
    runId: "issue-1",
    graph: "wave_issue_execute",
    prevNode: "decide_existing_reuse",
    node: "build",
    issue: "1625",
    milestone: "goal-1564-wave-2",
    ts: "2026-03-10T16:00:02.000Z",
  });

  return { rootDir, runsDir, sessionLog };
}
