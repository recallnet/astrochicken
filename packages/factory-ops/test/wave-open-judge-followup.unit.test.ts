import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("openJudgeFollowupArtifact must use emitBugIssue, not goalIngest artifacts", () => {
  const src = readFileSync("packages/factory-ops/src/commands/wave-open-judge-followup.ts", "utf8");
  assert.ok(
    !src.includes("goalIngest: true"),
    "wave-judge-failure must not use goalIngest: true — use emitBugIssue() for fast-track bug dispatch"
  );
  assert.ok(
    src.includes("emitBugIssue"),
    "wave-judge-failure must call emitBugIssue to file actionable bugs"
  );
  assert.ok(
    src.includes("milestone_title") && !src.includes("judge_notes: String"),
    "wave-judge-failure evidence must be stable (milestone only) to avoid duplicate signature drift"
  );
});
