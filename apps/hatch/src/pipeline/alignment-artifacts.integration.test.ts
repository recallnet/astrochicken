import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  deriveAlignmentCountersFromDecisionRecords,
  isTerminalRunStatus,
  loadRunAlignmentSummary,
  RUN_ALIGNMENT_COUNTER_TAXONOMY_VERSION,
  RUN_ALIGNMENT_SUMMARY_FILE,
  RUN_ALIGNMENT_SUMMARY_SCHEMA_VERSION,
  runAlignmentSummaryPath,
  runAlignmentSummaryPathFromRunDir,
  writeRunAlignmentSummary,
} from "./alignment-summary.js";
import {
  defaultCheckpointPath,
  loadCheckpoint,
  saveCheckpoint,
} from "./checkpoint.js";
import { Context, StageStatus, type StageRecord } from "./context.js";
import {
  BLOCKED_ACTIONS_COUNT_KEY,
  DECISION_RECORD_COUNT_KEY,
  DECISION_RECORD_SCHEMA_VERSION,
  DECISION_RECORD_SEQ_KEY,
  decisionsDir,
  emitDecisionArtifact,
  ESCALATIONS_COUNT_KEY,
  initializeDecisionArtifactCounter,
  INTENT_VIOLATIONS_COUNT_KEY,
  isDecisionArtifactEligible,
  JUDGE_FAIL_COUNT_KEY,
  JUDGE_PASS_COUNT_KEY,
  listDecisionArtifacts,
  NEEDS_REVIEW_COUNT_KEY,
} from "./decision-artifacts.js";
import { configureRunStorageScope, createRunState, runDir, saveRunState } from "./run.js";

describe("pipeline alignment artifacts", () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    for (const dir of cleanupDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    configureRunStorageScope({ runsDir: ".hatch/runs" });
  });

  it("persists and restores checkpoints with serialized stage dates", () => {
    const root = mkdtempSync(join(tmpdir(), "hatch-checkpoint-"));
    cleanupDirs.push(root);
    const checkpointPath = join(root, "tmp", "checkpoint.json");
    const record: StageRecord = {
      nodeId: "build",
      status: StageStatus.Completed,
      attempt: 1,
      startedAt: new Date("2026-03-10T00:00:00.000Z"),
      endedAt: new Date("2026-03-10T00:00:05.000Z"),
      outcome: { status: StageStatus.Completed, output: "{\"ok\":true}" },
    };

    saveCheckpoint(checkpointPath, {
      pipelineFile: "graphs/example.dot",
      currentNodeId: "review",
      lastOutput: "{\"ok\":true}",
      context: { issue_number: "42" },
      records: [record],
      savedAt: "2026-03-10T00:00:05.000Z",
    });

    const loaded = loadCheckpoint(checkpointPath);
    expect(loaded.records[0].startedAt).toBeInstanceOf(Date);
    expect(loaded.records[0].endedAt).toBeInstanceOf(Date);
    expect(defaultCheckpointPath("/tmp/factories/demo/graph.dot")).toContain(".hatch-checkpoint-graph.json");
  });

  it("emits decision artifacts and derives alignment summary files from durable run state", () => {
    const root = mkdtempSync(join(tmpdir(), "hatch-alignment-"));
    cleanupDirs.push(root);
    const runsDir = join(root, ".hatch", "runs");
    configureRunStorageScope({ runsDir });

    const runState = createRunState("run-align-1", "graphs/demo.dot");
    runState.status = "running";
    saveRunState(runState, { updatePid: false });

    const ctx = new Context();
    const initialCount = initializeDecisionArtifactCounter(runState, ctx);
    expect(initialCount).toBeGreaterThanOrEqual(0);
    expect(ctx.get(DECISION_RECORD_SEQ_KEY)).toBe(String(initialCount));
    expect(ctx.get(DECISION_RECORD_COUNT_KEY)).toBe(String(initialCount));
    for (const key of [
      JUDGE_PASS_COUNT_KEY,
      JUDGE_FAIL_COUNT_KEY,
      NEEDS_REVIEW_COUNT_KEY,
      INTENT_VIOLATIONS_COUNT_KEY,
      ESCALATIONS_COUNT_KEY,
      BLOCKED_ACTIONS_COUNT_KEY,
    ]) {
      expect(Number.parseInt(ctx.get(key), 10)).toBeGreaterThanOrEqual(0);
    }

    const node = {
      id: "review_decision",
      attrs: {
        judge: "true",
        objective_id: "goal-1564",
      },
    } as any;
    expect(isDecisionArtifactEligible(node)).toBe(true);

    const emitted = emitDecisionArtifact({
      runState,
      node,
      outcome: {
        status: StageStatus.Completed,
        output: JSON.stringify({
          decision: "approved",
          judge_verdict: "pass",
          needs_review: false,
          blocked_action: false,
          intent_violation: false,
          escalation: false,
        }),
      },
      ctx,
      attempt: 1,
      pipeline: "graphs/demo.dot",
      now: new Date("2026-03-10T00:00:10.000Z"),
    });

    expect(emitted.ok).toBe(true);
    expect(emitted.written).toBe(true);
    expect(emitted.count).toBe(initialCount + 1);
    expect(listDecisionArtifacts(runState.runId)).toHaveLength(emitted.count);

    const artifactPath = join(decisionsDir(runState.runId), listDecisionArtifacts(runState.runId)[0]);
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    expect(artifact.schema_version).toBe(DECISION_RECORD_SCHEMA_VERSION);
    expect(artifact.objective_id).toBe("goal-1564");

    const runDirectory = runDir(runState.runId);
    expect(runAlignmentSummaryPathFromRunDir(runDirectory)).toBe(join(runDirectory, RUN_ALIGNMENT_SUMMARY_FILE));
    expect(runAlignmentSummaryPath(runState.runId, root)).toBe(join(root, ".hatch", "runs", runState.runId, RUN_ALIGNMENT_SUMMARY_FILE));

    const summary = writeRunAlignmentSummary({
      runId: runState.runId,
      runDirectory,
      pipelineFile: "graphs/demo.dot",
      status: "completed",
      startedAt: "2026-03-10T00:00:00.000Z",
      terminalAt: "2026-03-10T00:00:11.000Z",
      context: { decision_records_count: "1" },
      records: [{
        nodeId: "review_decision",
        status: StageStatus.Completed,
        attempt: 1,
        startedAt: new Date("2026-03-10T00:00:00.000Z"),
        endedAt: new Date("2026-03-10T00:00:05.000Z"),
        outcome: { status: StageStatus.Completed, output: JSON.stringify({ pass: true }) },
      }],
      now: new Date("2026-03-10T00:00:12.000Z"),
    });

    expect(isTerminalRunStatus("completed")).toBe(true);
    expect(isTerminalRunStatus("running")).toBe(false);
    expect(summary?.schema_version).toBe(RUN_ALIGNMENT_SUMMARY_SCHEMA_VERSION);
    expect(summary?.counter_taxonomy_version).toBe(RUN_ALIGNMENT_COUNTER_TAXONOMY_VERSION);
    expect(summary?.decision_records_count).toBeGreaterThanOrEqual(1);
    const loadedSummary = loadRunAlignmentSummary(runState.runId, root);
    expect(loadedSummary === null || loadedSummary.run_id === runState.runId).toBe(true);

    const derived = deriveAlignmentCountersFromDecisionRecords([
      {
        decision_id: "record-1",
        objective_id: "goal-1564",
        objective_id_source: "node.objective_id",
        judge_verdict: "pass",
        needs_review: false,
        blocked_action: false,
        intent_violation: false,
        escalation: false,
      },
    ]);
    expect(derived.totals.judge_pass_count).toBe(1);
    expect(derived.objectives.get("node.objective_id|goal-1564")?.judge_pass_count).toBe(1);
  });
});
