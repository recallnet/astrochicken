import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(path, "utf8");
}

test("active prompt loaders use canonical factory-prompts package paths", () => {
  const supervisorDot = read("docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot");
  const goalDecomposeDot = read("docs/contracts/workflow-ir/capability-goal-decomposition/goal_intake_decompose.dot");
  const goalExecuteDot = read("docs/contracts/workflow-ir/mothership/goal_execute.dot");
  const mergeItemDot = read("docs/contracts/workflow-ir/capability-merge/merge_item.dot");

  assert.match(supervisorDot, /cat packages\/factory-prompts\/prompts\/supervisor\/system\.md/);
  assert.match(supervisorDot, /cat packages\/factory-prompts\/prompts\/supervisor\/bug_fast\.md/);
  assert.match(supervisorDot, /cat packages\/factory-prompts\/prompts\/supervisor\/review\.md/);
  assert.doesNotMatch(supervisorDot, /cat factories\/_shared\/prompts\/supervisor\//);

  assert.match(goalDecomposeDot, /cat packages\/factory-prompts\/prompts\/goal_decomposer\/system\.md/);
  assert.match(goalDecomposeDot, /cat packages\/factory-prompts\/prompts\/goal_decomposer\/analyze\.md/);
  assert.match(goalDecomposeDot, /cat packages\/factory-prompts\/prompts\/goal_decomposer\/propose\.md/);
  assert.match(goalDecomposeDot, /cat packages\/factory-prompts\/prompts\/goal_decomposer\/review\.md/);

  assert.match(goalExecuteDot, /cat packages\/factory-prompts\/prompts\/merge_resolver\/system\.md/);
  assert.match(goalExecuteDot, /cat packages\/factory-prompts\/prompts\/merge_resolver\/resolve_conflict\.md/);
  assert.match(goalExecuteDot, /cat packages\/factory-prompts\/prompts\/merge_resolver\/resolve_post_merge\.md/);
  assert.match(goalExecuteDot, /cat packages\/factory-prompts\/prompts\/merge_resolver\/resolve_push_failure\.md/);
  assert.match(mergeItemDot, /cat packages\/factory-prompts\/prompts\/merge_resolver\/retry_resolve_conflict\.md/);
});

test("active skill references use canonical factory-skills package paths", () => {
  const supervisorDot = read("docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot");
  const releaseDot = read("docs/contracts/workflow-ir/capability-release-reporting/release_report_flow.dot");
  const goalIssueExecuteDot = read("docs/contracts/workflow-ir/mothership/goal_issue_execute.dot");
  const commonResolveDefault = read("packages/factory-ops/src/lib/command-owners/common-resolve-default.ts");

  assert.match(supervisorDot, /cat packages\/factory-skills\/skills\/runtime\/supervisor_review\/SKILL\.md/);
  assert.match(releaseDot, /cat packages\/factory-skills\/skills\/runtime\/release_narrator\/SKILL\.md/);
  assert.match(goalIssueExecuteDot, /\$\{capability_coding_skills\}\/code_review\/SKILL\.md/);
  assert.match(goalIssueExecuteDot, /\$\{capability_coding_skills\}\/code_review\/REPO\.md/);
  assert.match(commonResolveDefault, /@hatch\/capability-coding\/skills\/code_review\/SKILL\.md/);
  assert.match(commonResolveDefault, /@hatch\/capability-merge\/skills\/merge_conflict_resolver\/SKILL\.md/);
  assert.match(commonResolveDefault, /@hatch\/capability-goal-decomposition\/skills\/goal_analyzer\/current\.md/);
  assert.match(commonResolveDefault, /@hatch\/capability-brainstorming\/skills\/red_strategist\/SKILL\.md/);
});
