import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dotPath = "docs/contracts/workflow-ir/capability-goal-decomposition/write_issue_item.dot";

test("write_issue_item uses dedicated issue_writer role for issue spec drafting, not supervisor/codergen", () => {
  const dot = readFileSync(dotPath, "utf8");
  const writeNode = dot.match(/draft_issue_spec\s*\[[\s\S]*?\]/)?.[0] || "";

  assert.match(writeNode, /class="issue_writer"/);
  assert.doesNotMatch(writeNode, /class="supervisor"/);
  assert.doesNotMatch(writeNode, /class="knowledge_worker"/);
  assert.doesNotMatch(writeNode, /type="codergen"/);
});

test("write_issue_item parameterizes issue-writing and judging timeouts via goal_decomposition_timeouts context", () => {
  const dot = readFileSync(dotPath, "utf8");
  const expectedTimeoutByNode = {
    draft_issue_spec: "issue_draft",
    repair_issue_spec: "issue_repair",
    judge_issue: "issue_judge",
    revise_issue_spec: "issue_revise",
  };

  for (const [nodeName, stageKey] of Object.entries(expectedTimeoutByNode)) {
    const node = dot.match(new RegExp(`${nodeName}\\s*\\[[\\s\\S]*?\\]`))?.[0] || "";
    assert.match(node, new RegExp(`timeout=\"\\$\\{goal_decomposition_timeouts\\.${stageKey}\\}\"`), `${nodeName} should resolve timeout from goal_decomposition_timeouts.${stageKey}`);
    assert.doesNotMatch(node, /timeout="30m"/, `${nodeName} should not hardcode 30m`);
  }
});

test("write_issue_item shares the goal-decomposer session and keeps judge isolated", () => {
  const dot = readFileSync(dotPath, "utf8");
  for (const nodeName of ["draft_issue_spec", "repair_issue_spec", "revise_issue_spec"]) {
    const node = dot.match(new RegExp(`${nodeName}\\s*\\[[\\s\\S]*?\\]`))?.[0] || "";
    assert.match(node, /session_id="goal-decomposer-\$\{issue_number\}"/, `${nodeName} should share the goal-decomposer session`);
  }
  const judgeNode = dot.match(/judge_issue\s*\[[\s\S]*?\]/)?.[0] || "";
  assert.doesNotMatch(judgeNode, /session_id=/);
});

test("write_issue_item binds Example Trading-compatible writer and judge model overrides", () => {
  const dot = readFileSync(dotPath, "utf8");
  for (const nodeName of ["draft_issue_spec", "judge_issue", "repair_issue_spec", "revise_issue_spec"]) {
    const node = dot.match(new RegExp(`${nodeName}\\s*\\[[\\s\\S]*?\\]`))?.[0] || "";
    assert.match(node, /llm_model="openai\/gpt-5\.3-codex"/, `${nodeName} should use the allowed managed-factory model`);
    assert.doesNotMatch(node, /llm_model="openai\/gpt-5\.1-codex-mini"/, `${nodeName} must not hardcode the disallowed mini model`);
  }
});

test("write_issue_item drafts JSON issue specs and never asks the LLM to call gh directly", () => {
  const dot = readFileSync(dotPath, "utf8");
  const draftNode = dot.match(/draft_issue_spec\s*\[[\s\S]*?\]/)?.[0] || "";
  const reviseNode = dot.match(/revise_issue_spec\s*\[[\s\S]*?\]/)?.[0] || "";

  for (const node of [draftNode, reviseNode]) {
    assert.match(node, /Return JSON only with issue_title, issue_body, and issue_labels/);
    assert.match(node, /Do not call gh directly/);
    assert.doesNotMatch(node, /gh issue create/);
    assert.doesNotMatch(node, /gh issue edit/);
  }
});

test("write_issue_item uses deterministic create and update tool nodes", () => {
  const dot = readFileSync(dotPath, "utf8");

  assert.match(dot, /typed_action_transport_mode = "enforced"/);
  assert.match(dot, /create_issue\s*\[type="tool" governance="irreversible"[\s\S]*action_runtime="in_process" action_id="common\.create_issue"/);
  assert.match(dot, /action_repo="\$\{gh_repo\}"/);
  assert.match(dot, /action_issue_spec_b64="\$\{issue_spec_b64\}"/);
  assert.match(dot, /outputs="ok,issue_url,created_issue_number,status,stderr"/);

  assert.match(dot, /update_issue\s*\[type="tool" governance="irreversible"[\s\S]*action_runtime="in_process" action_id="common\.update_issue"/);
  assert.match(dot, /action_issue_url="\$\{issue_url\}"/);
  assert.match(dot, /outputs="ok,issue_url,status,stderr"/);
});

test("write_issue_item normalizes feature issue specs before create and update", () => {
  const dot = readFileSync(dotPath, "utf8");

  assert.match(dot, /fallback_issue_spec\s*\[type="tool" governance="reversible" action_runtime="in_process" action_id="common\.fallback_issue_spec_bundle"/);
  assert.match(dot, /outputs="issue_spec,issue_spec_b64"/);
  assert.match(dot, /action_issue_spec="\$\{issue_spec_raw\}"/);
  assert.match(dot, /action_feature="\$\{feature\}"/);
  assert.match(dot, /normalize_feature_issue_spec\s*\[type="tool" governance="reversible" action_runtime="in_process" action_id="common\.normalize_feature_issue_spec_bundle"/);
  assert.match(dot, /action_issue_spec_b64="\$\{issue_spec_b64\}"/);
  assert.match(dot, /validate_issue_spec\s*\[type="tool" governance="reversible" action_runtime="in_process" action_id="common\.validate_issue_spec_draft"/);
  assert.match(dot, /repair_issue_spec\s*\[class="issue_writer"/);

  assert.match(dot, /fallback_revised_issue_spec\s*\[type="tool" governance="reversible" action_runtime="in_process" action_id="common\.fallback_issue_spec_bundle"/);
  assert.match(dot, /action_issue_spec="\$\{revised_issue_spec_raw\}"/);
  assert.match(dot, /normalize_revised_feature_issue_spec\s*\[type="tool" governance="reversible" action_runtime="in_process" action_id="common\.normalize_feature_issue_spec_bundle"/);
});

test("write_issue_item validates the normalized issue spec bundle before create and update", () => {
  const dot = readFileSync(dotPath, "utf8");
  const validateNode = dot.match(/validate_issue_spec\s*\[[\s\S]*?\]/)?.[0] || "";
  const validateRepairedNode = dot.match(/validate_repaired_issue_spec\s*\[[\s\S]*?\]/)?.[0] || "";

  assert.match(validateNode, /action_issue_spec="\$\{issue_spec\}"/);
  assert.doesNotMatch(validateNode, /action_issue_spec="\$\{issue_spec_raw\}"/);

  assert.match(validateRepairedNode, /action_issue_spec="\$\{issue_spec\}"/);
  assert.doesNotMatch(validateRepairedNode, /action_issue_spec="\$\{issue_spec_raw\}"/);
});

test("write_issue_item has no judge ceremony nodes (evidence, context, validation gates)", () => {
  const dot = readFileSync(dotPath, "utf8");

  assert.doesNotMatch(dot, /build_judge_evidence/);
  assert.doesNotMatch(dot, /build_judge_context/);
  assert.doesNotMatch(dot, /validate_judge_context/);
  assert.doesNotMatch(dot, /judge_context_gate/);
  assert.doesNotMatch(dot, /validate_judge_evidence/);
  assert.doesNotMatch(dot, /judge_evidence_gate/);
  assert.doesNotMatch(dot, /bypass_judge_decision/);
  assert.doesNotMatch(dot, /skip_judge_gate/);
  assert.doesNotMatch(dot, /assess_skip_issue_judge/);
  assert.doesNotMatch(dot, /resolve_skip_trivial_judge/);
  assert.doesNotMatch(dot, /ensure_labels/);
});

test("write_issue_item edge flow validates drafts before create and fails closed on repeated invalid specs and sub-issue link failures", () => {
  const dot = readFileSync(dotPath, "utf8");

  assert.match(dot, /start -> load_intent_stack -> draft_issue_spec -> fallback_issue_spec -> normalize_feature_issue_spec -> validate_issue_spec -> issue_spec_gate/);
  assert.match(dot, /issue_spec_gate -> create_issue \[condition="ok=true"/);
  assert.match(dot, /issue_spec_gate -> repair_issue_spec \[condition="ok!=true"/);
  assert.match(dot, /repair_issue_spec -> validate_repaired_issue_spec/);
  assert.match(dot, /validate_repaired_issue_spec -> repaired_issue_spec_gate/);
  assert.match(dot, /repaired_issue_spec_gate -> done \[condition="ok!=true" label="fail_closed"\]/);
  assert.match(dot, /create_issue -> link_sub_issue -> sub_issue_link_gate/);
  assert.match(dot, /sub_issue_link_gate -> judge_issue \[condition="ok=true"/);
  assert.match(dot, /sub_issue_link_gate -> done \[condition="ok!=true" label="fail_closed"\]/);
  assert.match(dot, /decide -> done \[condition="decision=approved"\]/);
  assert.match(dot, /decide -> revise_issue_spec \[condition="decision=revise"/);
  assert.match(dot, /revise_issue_spec -> fallback_revised_issue_spec -> normalize_revised_feature_issue_spec -> update_issue -> done/);
});

test("judge_issue validates created issue against the normalized issue spec", () => {
  const dot = readFileSync(dotPath, "utf8");
  const judgeNode = dot.match(/judge_issue\s*\[[\s\S]*?\]/)?.[0] || "";

  assert.match(judgeNode, /class="issue_quality_judge"/);
  assert.match(judgeNode, /timeout="\$\{goal_decomposition_timeouts\.issue_judge\}"/);
  assert.match(judgeNode, /outputs="pass,decision,review_notes"/);
  assert.match(judgeNode, /Created issue spec JSON:/);
  assert.match(judgeNode, /\$\{issue_spec\}/);
  assert.match(judgeNode, /Created issue URL:/);
  assert.match(judgeNode, /\$\{issue_url\}/);
  assert.match(judgeNode, /aligned to the parent goal/i);
  assert.match(judgeNode, /\\\"decision\\\": \\\"approved\|revise\\\"/);
});

test("write_issue_item writer prompts include parent goal and wave execution constraints", () => {
  const dot = readFileSync(dotPath, "utf8");
  const draftNode = dot.match(/draft_issue_spec\s*\[[\s\S]*?\]/)?.[0] || "";
  const reviseNode = dot.match(/revise_issue_spec\s*\[[\s\S]*?\]/)?.[0] || "";

  for (const node of [draftNode, reviseNode]) {
    assert.match(node, /Intent stack JSON:/);
    assert.match(node, /\$\{intent_stack\}/);
    assert.match(node, /Goal issue JSON:/);
    assert.match(node, /\$\{goal_issue\}/);
    assert.match(node, /Goal context JSON:/);
    assert.match(node, /\$\{goal_context\}/);
    assert.match(node, /shared wave branch/);
  }

  assert.match(draftNode, /single implementation issue/);
  assert.match(draftNode, /timeout="\$\{goal_decomposition_timeouts\.issue_draft\}"/);
  assert.match(draftNode, /If the feature mainly describes scaffolding/);
  assert.match(draftNode, /If this issue ships cleanly, what real part of the goal is now done/);
  assert.match(reviseNode, /timeout="\$\{goal_decomposition_timeouts\.issue_revise\}"/);
  assert.match(reviseNode, /Do not preserve weak framing just because it came from the input feature/);
  assert.match(reviseNode, /rewrite it toward one meaningful slice of the parent goal/);
});

test("normalize_decision uses deterministic ops command, not inline script", () => {
  const dot = readFileSync(dotPath, "utf8");
  const normalizeNode = dot.match(/normalize_decision\s*\[[\s\S]*?\]/)?.[0] || "";

  assert.doesNotMatch(normalizeNode, /python3\s+-\s*<<'PY'/);
  assert.match(normalizeNode, /action_runtime="in_process"/);
  assert.match(normalizeNode, /action_id="common\.normalize_decision"/);
  assert.match(normalizeNode, /action_value="\$\{decision\}"/);
});

test("write_issue_item links created issue as sub-issue of the parent goal and records canonical lifecycle identity", () => {
  const dot = readFileSync(dotPath, "utf8");

  // link_sub_issue node exists and uses typed add_sub_issue ownership
  assert.match(dot, /link_sub_issue\s*\[type="tool" governance="irreversible"[\s\S]*action_runtime="in_process" action_id="goal\.add_sub_issue"/);
  assert.match(dot, /action_parent="\$\{issue_number\}"/);
  assert.match(dot, /action_child="\$\{created_issue_number\}"/);
  assert.match(dot, /action_factory_id="\$\{factory_id\}"/);
  assert.match(dot, /action_run_id="\$\{__run_id\}"/);

  // create_issue outputs created_issue_number for link_sub_issue to consume
  const createNode = dot.match(/create_issue\s*\[[\s\S]*?\]/)?.[0] || "";
  assert.match(createNode, /created_issue_number/);
  assert.match(createNode, /action_factory_id="\$\{factory_id\}"/);
  assert.match(createNode, /action_run_id="\$\{__run_id\}"/);

  // Wired through a fail-closed link gate before judge_issue
  assert.match(dot, /create_issue -> link_sub_issue -> sub_issue_link_gate/);
});
