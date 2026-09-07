import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dotPath = "docs/contracts/workflow-ir/brainstorm/factory_supervisor_tick.dot";
const capabilityContractPath = "packages/capability-brainstorming/capability-contract.v1.json";

function loadText(path) {
  return readFileSync(path, "utf8");
}

test("brainstorm supervisor graph composes shared managed shell", () => {
  const dot = loadText(dotPath);
  assert.match(dot, /run_managed_supervisor_shell \[type="pipeline"[\s\S]*pipeline="packages\/factory-runtime\/graphs\/managed_supervisor\.dot"/);
  assert.match(dot, /set_kind_path[\s\S]*factories\/brainstorm\/kind\.json/);
  assert.match(dot, /set_instance_path[\s\S]*factories\/brainstorm\/instance\.template\.json/);
  assert.match(dot, /set_kind_id[\s\S]*printf 'brainstorm'/);
  assert.match(dot, /set_destinations_json[\s\S]*goal_issues/);
});

test("brainstorm domain graph preflight gate routes correctly", () => {
  const dot = loadText("docs/contracts/workflow-ir/brainstorm/domain_brainstorm.dot");
  // When context vars resolve (non-empty concat != fallback token), proceed to intake_gate
  assert.match(dot, /preflight_gate -> intake_gate \[condition="context_contract_preflight_status!=context_contract_preflight_ok"\]/);
  // When all vars empty (fallback token returned), skip to set_domain_result
  assert.match(dot, /preflight_gate -> set_domain_result \[condition="context_contract_preflight_status=context_contract_preflight_ok"\]/);
});

test("brainstorm domain graph consumes shell intake context and still satisfies capability contract", () => {
  const dot = loadText("docs/contracts/workflow-ir/brainstorm/domain_brainstorm.dot");
  const contract = JSON.parse(loadText(capabilityContractPath));
  const requiredKeys = Array.isArray(contract.requiredContextKeys) ? contract.requiredContextKeys : [];

  const nodeContracts = {
    brainstorm_issue_number: /build_intake_context[\s\S]*outputs="[^"]*brainstorm_issue_number[^"]*"/,
    brainstorm_issue_body: /build_intake_context[\s\S]*outputs="[^"]*brainstorm_issue_body[^"]*"/,
    shipped_goals_since_last: /build_intake_context[\s\S]*outputs="[^"]*shipped_goals_since_last[^"]*"/,
    open_backlog_summary: /build_intake_context[\s\S]*outputs="[^"]*open_backlog_summary[^"]*"/,
    scenario_holdouts: /build_intake_context[\s\S]*outputs="[^"]*scenario_holdouts[^"]*"/,
    intent_stack: /load_intent_stack[\s\S]*output_key="intent_stack"/,
    capability_brainstorming_skills: /set_capability_brainstorming_skills[\s\S]*output_key="capability_brainstorming_skills"/,
    trust_domain: /set_trust_domain[\s\S]*output_key="trust_domain"/,
    trust_role: /set_trust_role[\s\S]*output_key="trust_role"/,
    factory_root: /set_factory_root[\s\S]*output_key="factory_root"/,
    gh_repo: /set_gh_repo[\s\S]*output_key="gh_repo"/,
    repo: /set_repo[\s\S]*output_key="repo"/,
  };

  for (const key of requiredKeys) {
    const contract = nodeContracts[key];
    assert.ok(contract, `missing contract assertion for required context key: ${key}`);
    assert.match(dot, contract, `domain graph must wire required context key before spawn: ${key}`);
  }

  assert.match(dot, /spawn_brainstorm \[type="pipeline"[\s\S]*inherit_context="true"/);
  assert.match(dot, /pipeline="@hatch\/capability-brainstorming\/graphs\/brainstorm\.dot"/);
  assert.match(dot, /build_intake_context[\s\S]*action_runtime="in_process" action_id="brainstorm\.build_intake_context"/);
  assert.match(dot, /build_intake_context[\s\S]*action_repo="\$\{target_repo\}"[\s\S]*action_intake_json="\$\{intake_json\}"/);
  assert.doesNotMatch(dot, /hatch-ops brainstorm next-issue/);
});
