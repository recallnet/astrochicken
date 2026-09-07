import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { guardDuplicateGoalDecomposition } from "../../src/commands/goal-duplicate-decompose-guard.ts";
import { buildGoalDecompositionPacket, persistGoalDecompositionPacket } from "../../src/lib/goal-decomposition-packet.ts";

test("guardDuplicateGoalDecomposition passes when no durable packet or open sub-issues exist", () => {
  const out = guardDuplicateGoalDecomposition({
    repo: "recallnet/astrochicken",
    issueNumber: "2304",
    factoryId: "mothership",
    listSubIssuesFn: () => [],
  });

  assert.equal(out.ok, true);
  assert.equal(out.goal_issue_number, "2304");
  assert.equal(out.already_decomposed, "false");
});

test("guardDuplicateGoalDecomposition throws deterministic reset-required error when open sub-issues already exist", () => {
  assert.throws(
    () => guardDuplicateGoalDecomposition({
      repo: "recallnet/astrochicken",
      issueNumber: "2304",
      factoryId: "mothership",
      runId: "run-123",
      pipeline: "goal_run",
      nodeId: "duplicate_decompose_guard",
      listSubIssuesFn: () => [{ state: "open" }],
    }),
    /goal_already_decomposed:2304:operator_reset_required:use_hatch-ops_goal_admission-reset:factory_id=mothership:run_id=run-123:pipeline=goal_run:node_id=duplicate_decompose_guard/,
  );
});

test("guardDuplicateGoalDecomposition fails closed from packet state even when GitHub sub-issues are missing", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-duplicate-decompose-guard-"));
  const packet = buildGoalDecompositionPacket({
    goalIssueNumber: "2304",
    approvedFeaturesRaw: JSON.stringify([{ name: "deterministic guard", summary: "fail closed" }]),
    issueUrlsRaw: JSON.stringify(["https://github.com/recallnet/astrochicken/issues/2305"]),
    factoryId: "mothership",
  });
  persistGoalDecompositionPacket({ repo: repoRoot, packet });

  assert.throws(
    () => guardDuplicateGoalDecomposition({
      repo: "recallnet/astrochicken",
      repoRoot,
      issueNumber: "2304",
      factoryId: "mothership",
      listSubIssuesFn: () => [],
    }),
    /goal_already_decomposed:2304:operator_reset_required:use_hatch-ops_goal_admission-reset/,
  );
});
