import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dotPath = "docs/contracts/workflow-ir/capability-brainstorming/brainstorm.dot";

function loadDot() {
  return readFileSync(dotPath, "utf8");
}

test("brainstorm graph uses conversational red->check->early-exit-gate->comment->blue->check->loop-guard->early-exit-gate->comment loop", () => {
  const dot = loadDot();
  // @context:regression Graph edges may be emitted as individual or chained declarations by the
  // workflow-source generator; assert each edge independently to avoid format-coupling.
  // Red path: red -> check_red -> red_early_exit_gate -[normal]-> post_red_comment -> red_gate
  assert.match(dot, /start -> load_context/);
  assert.match(dot, /load_context -> init_round/);
  assert.match(dot, /init_round -> red/);
  assert.match(dot, /red -> check_red/);
  assert.match(dot, /check_red -> red_early_exit_gate/);
  assert.match(dot, /red_early_exit_gate -> post_red_comment \[condition="should_force_wrap!=true"\]/);
  assert.match(dot, /post_red_comment -> red_gate/);
  assert.match(dot, /red_gate -> close_issue \[condition="is_final=true"\]/);
  assert.match(dot, /red_gate -> blue \[condition="is_final!=true"\]/);
  // Blue path: blue -> check_blue -> loop_guard_blue -> blue_early_exit_gate -[normal]-> post_blue_comment -> blue_gate
  assert.match(dot, /blue -> check_blue/);
  assert.match(dot, /check_blue -> loop_guard_blue/);
  assert.match(dot, /loop_guard_blue -> blue_early_exit_gate/);
  assert.match(dot, /blue_early_exit_gate -> post_blue_comment \[condition="trigger_force_wrap!=true"\]/);
  assert.match(dot, /post_blue_comment -> blue_gate/);
  assert.match(dot, /blue_gate -> close_issue \[condition="is_final=true"\]/);
  assert.match(dot, /blue_gate -> bump_round \[condition="is_final!=true"\]/);
  assert.match(dot, /round_gate -> red \[condition="has_next=true"\]/);
});

test("brainstorm graph enforces stable strategist sessions", () => {
  const dot = loadDot();
  assert.match(dot, /red \[type="agent\.kw"[\s\S]*session_id="red_strategist"/);
  assert.match(dot, /blue \[type="agent\.kw"[\s\S]*session_id="blue_strategist"/);
});

test("brainstorm graph uses distinct strategist classes and models via openrouter", () => {
  const dot = loadDot();
  assert.match(dot, /red \[type="agent\.kw"[\s\S]*class="red_strategist"[\s\S]*llm_model="anthropic\/claude-sonnet-4\.6"/);
  assert.match(dot, /blue \[type="agent\.kw"[\s\S]*class="blue_strategist"[\s\S]*llm_model="anthropic\/claude-opus-4\.6"/);
});

test("brainstorm graph loads strategist skills from capability_brainstorming_skills", () => {
  const dot = loadDot();
  assert.match(dot, /\$\{capability_brainstorming_skills\}\/red_strategist\/SKILL\.md/);
  assert.match(dot, /\$\{capability_brainstorming_skills\}\/blue_strategist\/SKILL\.md/);
});

test("brainstorm graph wires check-output and bump-round outputs", () => {
  const dot = loadDot();
  // All check nodes emit unified termination-contract output keys to avoid context drift
  const unifiedOutputs = /outputs="is_final,source,final_report,conversational_output,should_force_wrap,termination_reason,is_empty_output"/;
  assert.match(dot, /check_red[\s\S]*outputs="is_final,source,final_report,conversational_output,should_force_wrap,termination_reason,is_empty_output"/);
  assert.match(dot, /check_blue[\s\S]*outputs="is_final,source,final_report,conversational_output,should_force_wrap,termination_reason,is_empty_output"/);
  // check_wrap and check_repair must also expose unified keys so context does not drift on finalization path
  assert.match(dot, /check_wrap[\s\S]*outputs="is_final,source,final_report,conversational_output,should_force_wrap,termination_reason,is_empty_output"/);
  assert.match(dot, /check_repair[\s\S]*outputs="is_final,source,final_report,conversational_output,should_force_wrap,termination_reason,is_empty_output"/);
  assert.match(dot, /bump_round[\s\S]*outputs="round,has_next,at_limit"/);
  void unifiedOutputs; // referenced above for clarity
});

test("brainstorm graph carries next_cursor from load-context to close-issue", () => {
  const dot = loadDot();
  assert.match(dot, /load_context[\s\S]*outputs="[^"]*next_cursor[^"]*"/);
  assert.match(dot, /close_issue[\s\S]*action_runtime="in_process" action_id="brainstorm\.close_issue"/);
  assert.match(dot, /close_issue[\s\S]*action_factory_id="\$\{factory_id\}"/);
  assert.match(dot, /close_issue[\s\S]*action_next_cursor="\$\{next_cursor\}"/);
});

test("brainstorm graph does not create goal issues", () => {
  const dot = loadDot();
  assert.doesNotMatch(dot, /create_goal/);
  assert.doesNotMatch(dot, /create-goal/);
  assert.doesNotMatch(dot, /destinations_json/);
});

test("brainstorm graph has force_wrap and format_repair at round limit with comments", () => {
  const dot = loadDot();
  // @context:regression Edges may be emitted individually or chained; assert each hop independently.
  assert.match(dot, /round_gate -> force_wrap \[condition="has_next!=true"\]/);
  assert.match(dot, /force_wrap -> check_wrap/);
  assert.match(dot, /check_wrap -> post_wrap_comment/);
  assert.match(dot, /post_wrap_comment -> wrap_gate/);
  assert.match(dot, /wrap_gate -> close_issue \[condition="is_final=true"\]/);
  assert.match(dot, /wrap_gate -> format_repair \[condition="is_final!=true"\]/);
  assert.match(dot, /format_repair -> check_repair/);
  assert.match(dot, /check_repair -> post_repair_comment/);
  assert.match(dot, /post_repair_comment -> close_issue/);
});

test("brainstorm graph check-output nodes use brainstorm check-output command", () => {
  const dot = loadDot();
  assert.match(dot, /check_red[\s\S]*action_runtime="in_process" action_id="brainstorm\.check_output"/);
  assert.match(dot, /check_blue[\s\S]*action_runtime="in_process" action_id="brainstorm\.check_output"/);
  assert.match(dot, /check_wrap[\s\S]*action_runtime="in_process" action_id="brainstorm\.check_output"/);
  assert.match(dot, /check_repair[\s\S]*action_runtime="in_process" action_id="brainstorm\.check_output"/);
});

test("brainstorm graph comment nodes use brainstorm post-turn-comment command", () => {
  const dot = loadDot();
  assert.match(dot, /post_red_comment[\s\S]*action_runtime="in_process" action_id="brainstorm\.post_turn_comment"[\s\S]*action_source="red"/);
  assert.match(dot, /post_blue_comment[\s\S]*action_runtime="in_process" action_id="brainstorm\.post_turn_comment"[\s\S]*action_source="blue"/);
  assert.match(dot, /post_wrap_comment[\s\S]*action_runtime="in_process" action_id="brainstorm\.post_turn_comment"[\s\S]*action_source="force_wrap"/);
  assert.match(dot, /post_repair_comment[\s\S]*action_runtime="in_process" action_id="brainstorm\.post_turn_comment"[\s\S]*action_source="format_repair"/);
});

test("brainstorm graph comment nodes pass run_id and langfuse url for trace links", () => {
  const dot = loadDot();
  assert.match(dot, /post_red_comment[\s\S]*action_run_id="\$\{run_id\}"[\s\S]*action_langfuse_project_url="\$\{LANGFUSE_PROJECT_URL\}"/);
  assert.match(dot, /post_blue_comment[\s\S]*action_run_id="\$\{run_id\}"[\s\S]*action_langfuse_project_url="\$\{LANGFUSE_PROJECT_URL\}"/);
});

test("brainstorm graph routes red terminate-non-final signal directly to force_wrap (skipping normal round)", () => {
  const dot = loadDot();
  // Red early-exit gate: should_force_wrap=true -> force_wrap (no normal round churn)
  assert.match(dot, /red_early_exit_gate -> force_wrap \[condition="should_force_wrap=true"\]/);
  assert.match(dot, /red_early_exit_gate -> post_red_comment \[condition="should_force_wrap!=true"\]/);
  // The gate node itself must be a decision diamond
  assert.match(dot, /red_early_exit_gate \[shape="diamond"/);
});

test("brainstorm graph routes repeated empty blue turns to force_wrap via loop-guard (skipping normal round)", () => {
  const dot = loadDot();
  // Blue early-exit gate: trigger_force_wrap=true -> force_wrap (no post_blue_comment churn)
  assert.match(dot, /blue_early_exit_gate -> force_wrap \[condition="trigger_force_wrap=true"\]/);
  assert.match(dot, /blue_early_exit_gate -> post_blue_comment \[condition="trigger_force_wrap!=true"\]/);
  // The gate node itself must be a decision diamond
  assert.match(dot, /blue_early_exit_gate \[shape="diamond"/);
});

test("brainstorm graph loop_guard_blue node uses brainstorm loop_guard action with correct context keys", () => {
  const dot = loadDot();
  assert.match(dot, /loop_guard_blue[\s\S]*action_runtime="in_process" action_id="brainstorm\.loop_guard"/);
  assert.match(dot, /loop_guard_blue[\s\S]*action_source="blue"/);
  assert.match(dot, /loop_guard_blue[\s\S]*action_conversational_output="\$\{conversational_output\}"/);
  assert.match(dot, /loop_guard_blue[\s\S]*action_previous_empty_blue_count="\$\{empty_blue_count\}"/);
  // should_force_wrap from check_blue is forwarded so loop_guard aggregates both signals
  assert.match(dot, /loop_guard_blue[\s\S]*action_should_force_wrap="\$\{should_force_wrap\}"/);
  assert.match(dot, /loop_guard_blue[\s\S]*outputs="empty_blue_count,trigger_force_wrap,suppress_round_comment,guard_reason"/);
});

test("brainstorm graph comment nodes pass suppress_round_comment context to prevent post-exit churn", () => {
  const dot = loadDot();
  // post_red_comment and post_blue_comment must wire suppression context
  assert.match(dot, /post_red_comment[\s\S]*action_suppress_round_comment="\$\{suppress_round_comment\}"/);
  assert.match(dot, /post_blue_comment[\s\S]*action_suppress_round_comment="\$\{suppress_round_comment\}"/);
});
