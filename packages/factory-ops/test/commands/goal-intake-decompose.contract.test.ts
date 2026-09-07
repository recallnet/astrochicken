import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dotPath = "docs/contracts/workflow-ir/capability-goal-decomposition/goal_intake_decompose.dot";

test("goal_intake_decompose parameterizes LLM stage timeouts via goal_decomposition_timeouts context", () => {
  const dot = readFileSync(dotPath, "utf8");
  const expectedTimeoutByNode = {
    analyze: "issue_draft",
    propose: "issue_draft",
    review: "issue_judge",
  };

  for (const [nodeName, stageKey] of Object.entries(expectedTimeoutByNode)) {
    const node = dot.match(new RegExp(`${nodeName}\\s*\\[[\\s\\S]*?\\]`))?.[0] || "";
    assert.match(
      node,
      new RegExp(`timeout=\"\\$\\{goal_decomposition_timeouts\\.${stageKey}\\}\"`),
      `${nodeName} should resolve timeout from goal_decomposition_timeouts.${stageKey}`,
    );
    assert.doesNotMatch(node, /timeout="30m"/, `${nodeName} should not hardcode 30m`);
  }
});

test("goal_intake_decompose binds bounded codergen policy for decompose stages", () => {
  const dot = readFileSync(dotPath, "utf8");
  for (const nodeName of ["analyze", "propose", "review"]) {
    const node = dot.match(new RegExp(`${nodeName}\\s*\\[[\\s\\S]*?\\]`))?.[0] || "";
    assert.doesNotMatch(
      node,
      /llm_model="/,
      `${nodeName} should inherit the factory goal_decomposer model instead of hardcoding one`,
    );
    assert.match(
      node,
      /reasoning_effort="medium"/,
      `${nodeName} should use bounded medium reasoning`,
    );
  }
});
