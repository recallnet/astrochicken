import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { attachPlanningArtifacts, markGoalPlanned } from "../../src/commands/goal-hard-planning.ts";
import { classifyGoalExecutionPath } from "../../src/commands/goal-execution-path.ts";

function seedExecutionPathPacket(repoRoot, goalIssueNumber = "2332") {
  classifyGoalExecutionPath({
    repo: repoRoot,
    goalIssueNumber,
    executionPath: "hard",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v1",
    decompositionState: "required",
    planningState: "not_required",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "hard path target",
    classificationSignalsRaw: JSON.stringify({ test: true }),
    factoryId: "mothership",
  });
}

test("attachPlanningArtifacts does not read issue comments before posting the hold artifact", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push({ type: "exec", args });
    return { ok: true, stdout: "", stderr: "" };
  };

  const out = attachPlanningArtifacts({
    repo: "recallnet/astrochicken",
    goalIssueNumber: "2332",
    planningArtifactPath: "/tmp/hard_plan.json",
    planningPacketId: "hard_plan_packet_abc",
    runId: "run-hard-3",
    summary: "hard_path_planning_completed",
    ghExec,
  });

  assert.equal(out.planning_attachment_posted, "true");
  assert.equal(calls.length, 1);
});

test("markGoalPlanned does not read live labels or comments before writing the hold transition", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-plan-mark-no-reads-"));
  seedExecutionPathPacket(repoRoot, "2440");

  const ghCalls = [];
  const ghExec = (args) => {
    ghCalls.push({ type: "exec", args });
    return { ok: true, stdout: "", stderr: "" };
  };

  const out = markGoalPlanned({
    repoRoot,
    repo: "recallnet/astrochicken",
    goalIssueNumber: "2440",
    goalExecutionPath: "hard",
    goalRoutingStateRaw: JSON.stringify({ decomposition_state: "required", planning_state: "not_required" }),
    planningArtifactPath: "/tmp/hard_plan_packet.json",
    factoryId: "mothership",
    runId: "run-hard-no-read",
    pipeline: "goal_hard_plan",
    nodeId: "mark_hard_plan_pending_review",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
    ghExec,
  });

  assert.equal(out.planning_state, "pending_review");
  assert.equal(ghCalls.some((entry) => entry.args[0] === "issue" && entry.args[1] === "comment"), true);
});
