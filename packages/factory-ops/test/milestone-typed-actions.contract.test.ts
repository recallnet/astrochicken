import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dotPath = "docs/contracts/workflow-ir/mothership/milestone_execute.dot";
const parallelItemPath = "docs/contracts/workflow-ir/mothership/milestone_execute_parallel_item.dot";

function loadDot(path) {
  return readFileSync(path, "utf8");
}

// ---------- milestone_execute.dot ----------

test("milestone_execute opts into enforced typed action transport", () => {
  const dot = loadDot(dotPath);
  assert.match(dot, /typed_action_transport_mode = "enforced"/);
});

test("milestone_execute has zero nodes with prompt=\"hatch-ops", () => {
  const dot = loadDot(dotPath);
  assert.doesNotMatch(dot, /prompt="hatch-ops /);
});

test("milestone_execute routes all tool nodes through typed actions", () => {
  const dot = loadDot(dotPath);

  // seed_state
  assert.match(dot, /seed_state[\s\S]*action_runtime="in_process" action_id="software\.seed_milestone_state"/);
  assert.match(dot, /seed_state[\s\S]*action_runs_dir="\$\{runs_dir\}"/);
  // init_branch
  assert.match(dot, /init_branch[\s\S]*action_runtime="in_process" action_id="software\.empty_milestone_branch_context"/);
  // resolve_parallel_low_enabled
  assert.match(dot, /resolve_parallel_low_enabled[\s\S]*action_runtime="in_process" action_id="common\.resolve_boolean"/);
  // resolve_max_parallel_low
  assert.match(dot, /resolve_max_parallel_low[\s\S]*action_runtime="in_process" action_id="common\.resolve_default"/);
  // next_issue
  assert.match(dot, /next_issue[\s\S]*action_runtime="in_process" action_id="software\.pick_next_milestone_issue"/);
  // estimate_next_issue_complexity
  assert.match(dot, /estimate_next_issue_complexity[\s\S]*action_runtime="in_process" action_id="coding\.estimate_issue_complexity"/);
  // classify_next_issue_complexity
  assert.match(dot, /classify_next_issue_complexity[\s\S]*action_runtime="in_process" action_id="ceremony\.classify_milestone"/);
  // build_parallel_batch
  assert.match(dot, /build_parallel_batch[\s\S]*action_runtime="in_process" action_id="ceremony\.build_milestone_batch"/);
  // accumulate
  assert.match(dot, /accumulate \[[\s\S]*?action_runtime="in_process" action_id="software\.accumulate_milestone_result"/);
  // accumulate_parallel
  assert.match(dot, /accumulate_parallel[\s\S]*action_runtime="in_process" action_id="software\.accumulate_milestone_batch"/);
  // postmortem
  assert.match(dot, /postmortem[\s\S]*action_runtime="in_process" action_id="software\.milestone_postmortem"/);
});

// ---------- milestone_execute_parallel_item.dot ----------

test("milestone_execute_parallel_item opts into enforced typed action transport", () => {
  const dot = loadDot(parallelItemPath);
  assert.match(dot, /typed_action_transport_mode = "enforced"/);
});

test("milestone_execute_parallel_item has zero nodes with prompt=\"hatch-ops", () => {
  const dot = loadDot(parallelItemPath);
  assert.doesNotMatch(dot, /prompt="hatch-ops /);
});

test("milestone_execute_parallel_item routes all tool nodes through typed actions", () => {
  const dot = loadDot(parallelItemPath);

  // extract_parallel_issue
  assert.match(dot, /extract_parallel_issue[\s\S]*action_runtime="in_process" action_id="coding\.extract_issue_item"/);
  // isolate_parallel_context
  assert.match(dot, /isolate_parallel_context[\s\S]*action_runtime="in_process" action_id="software\.build_milestone_parallel_context"/);
});
