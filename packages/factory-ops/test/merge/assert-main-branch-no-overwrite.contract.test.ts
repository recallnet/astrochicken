import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Regression: assert-main-branch nodes must NOT output "branch".
 *
 * Root cause: the assert-main-branch tool returns { ok, branch: "main", corrected }.
 * If the DOT node lists "branch" in its outputs, the engine writes "main" back
 * into context, overwriting the goal branch (e.g. "goal/2072"). This causes the
 * merge-candidates list to record branch="main", so the merge flow concludes
 * "already_merged" and skips the actual merge+push.
 */

const ASSERT_MAIN_NODES = [
  {
    graph: "docs/contracts/workflow-ir/mothership/goal_issue_execute.dot",
    node: "assert_main_after_build",
  },
  {
    graph: "docs/contracts/workflow-ir/mothership/goal_execute.dot",
    node: "assert_main_branch",
  },
  {
    graph: "docs/contracts/workflow-ir/mothership/goal_execute.dot",
    node: "assert_main_after_merge",
  },
  {
    graph: "docs/contracts/workflow-ir/mothership/wave_execute.dot",
    node: "assert_main_branch",
  },
  {
    graph: "docs/contracts/workflow-ir/mothership/wave_execute.dot",
    node: "assert_main_after_merge",
  },
];

for (const { graph, node } of ASSERT_MAIN_NODES) {
  const label = `${graph.split("/").pop()}::${node}`;

  test(`${label} outputs must NOT include branch`, () => {
    const dot = readFileSync(graph, "utf8");

    const pattern = new RegExp(
      `${node}\\s*\\[[\\s\\S]*?outputs\\s*=\\s*"([^"]*)"`,
    );
    const match = dot.match(pattern);

    assert.ok(match, `${node} node with outputs attribute not found in ${graph}`);

    const outputs = match[1].split(",").map((s) => s.trim());

    assert.ok(
      !outputs.includes("branch"),
      `${node} outputs must not include "branch" — ` +
        `it would overwrite the goal branch in context. ` +
        `Found outputs: [${outputs.join(", ")}]`,
    );

    assert.ok(
      outputs.includes("corrected"),
      "outputs must include corrected",
    );
  });
}
