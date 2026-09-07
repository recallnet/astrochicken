import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadGraphSemanticsText } from "../../../../scripts/lib/load-graph-semantics.ts";

const JUDGE_GRAPH_CANDIDATES = [
  "factories/mothership/workflows/goal-execution/goal_execute.workflow-source.mjs",
  "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
  "packages/capability-goal-decomposition/workflows/write_issue_item/write_issue_item.workflow-source.mjs",
  "packages/capability-product-judge/workflows/product_judge/product_judge.workflow-source.mjs",
  "packages/capability-software-development/workflows/goal_execute/goal_execute.workflow-source.mjs",
];

function listJudgeGraphs() {
  return JUDGE_GRAPH_CANDIDATES.filter((graphPath) => {
    const dot = loadGraphSemanticsText(graphPath);
    return /class="(?:issue_quality_judge|post_merge_judge)"/.test(dot) || /output_key="judge_result"/.test(dot) || /judge="true"/.test(dot);
  }).sort((a, b) => a.localeCompare(b));
}

function assertJudgeGraphHasDeterministicPreflight(dotPath, { successTarget = "judge" } = {}) {
  const dot = loadGraphSemanticsText(dotPath);

  assert.match(dot, /build_judge_evidence \[type="tool"/);
  assert.match(dot, /build_judge_context \[type="tool"/);
  assert.match(dot, /validate_judge_context \[type="tool"/);
  assert.match(dot, /judge_context_gate \[shape="?diamond"? label="Judge context complete\?"\]/);
  assert.match(dot, /validate_judge_evidence \[type="tool"/);
  assert.match(dot, /judge_evidence_gate \[shape="?diamond"? label="Judge evidence complete\?"\]/);

  assert.match(dot, /outputs="judge_evidence_path,judge_evidence_sha256,judge_evidence_valid,judge_evidence_error"/);
  assert.match(dot, /outputs="judge_context_path,judge_context_sha256,judge_context_valid,judge_context_error,judge_scenario_selection_path,judge_scenario_selection_sha256,judge_scenario_selection_signature_sha256"/);
  assert.match(
    dot,
    /outputs="judge_context_gate_pass,judge_context_gate_code,judge_context_error,judge_context_path,judge_context_sha256,judge_scenario_selection_path,judge_scenario_selection_sha256,judge_scenario_selection_signature_sha256,judge_route_code,disposition,confidence,recommended_transition,reason_codes,notes,verdict"/,
  );
  assert.match(
    dot,
    /outputs="judge_evidence_gate_pass,judge_evidence_gate_code,judge_evidence_error,judge_route_code,disposition,confidence,recommended_transition,reason_codes,notes,verdict"/,
  );

  const buildEvidenceKindMatch = /(?:judge (?:run --op )?build-evidence-contract --judge-kind '([^']+)'|action_id="judge\.build_evidence_contract"[\s\S]*?action_judge_kind="([^"]+)")/.exec(dot);
  const buildContextKindMatch = /(?:judge (?:run --op )?build-context-contract --judge-kind '([^']+)'|action_id="judge\.build_context_contract"[\s\S]*?action_judge_kind="([^"]+)")/.exec(dot);
  const validateContextKindMatch = /(?:judge (?:run --op )?validate-context-contract --judge-kind '([^']+)'|action_id="judge\.validate_context_contract"[\s\S]*?action_judge_kind="([^"]+)")/.exec(dot);
  const validateEvidenceKindMatch = /(?:judge (?:run --op )?validate-evidence-contract --judge-kind '([^']+)'|action_id="judge\.validate_evidence_contract"[\s\S]*?action_judge_kind="([^"]+)")/.exec(dot);
  assert.ok(buildEvidenceKindMatch, `${dotPath} must declare judge build-evidence-contract --judge-kind`);
  assert.ok(buildContextKindMatch, `${dotPath} must declare judge build-context-contract --judge-kind`);
  assert.ok(validateContextKindMatch, `${dotPath} must declare judge validate-context-contract --judge-kind`);
  assert.ok(validateEvidenceKindMatch, `${dotPath} must declare judge validate-evidence-contract --judge-kind`);
  const buildEvidenceKind = buildEvidenceKindMatch?.[1] || buildEvidenceKindMatch?.[2];
  const buildContextKind = buildContextKindMatch?.[1] || buildContextKindMatch?.[2];
  const validateContextKind = validateContextKindMatch?.[1] || validateContextKindMatch?.[2];
  const validateEvidenceKind = validateEvidenceKindMatch?.[1] || validateEvidenceKindMatch?.[2];
  assert.equal(buildContextKind, buildEvidenceKind);
  assert.equal(validateContextKind, buildEvidenceKind);
  assert.equal(validateEvidenceKind, buildEvidenceKind);

  assert.match(dot, /build_judge_evidence -> build_judge_context(?: \[input_key="[^"]+"\])?/);
  assert.match(dot, /build_judge_context -> validate_judge_context(?: \[input_key="[^"]+"\])?/);
  assert.match(dot, /validate_judge_context -> judge_context_gate/);
  assert.match(dot, /judge_context_gate -> validate_judge_evidence \[condition="judge_context_gate_pass=true"( input_key="[^"]+")?\]/);
  assert.match(dot, /validate_judge_evidence -> judge_evidence_gate/);
  assert.match(dot, new RegExp(`judge_evidence_gate -> ${successTarget} \\[condition="judge_evidence_gate_pass=true"\\]`));

  const contextFailEdgeMatch = /judge_context_gate -> ([a-zA-Z0-9_]+) \[condition="judge_context_gate_pass!=true"\]/.exec(dot);
  assert.ok(contextFailEdgeMatch, `${dotPath} must route judge_context_gate_pass!=true`);
  assert.notEqual(contextFailEdgeMatch?.[1], "judge", `${dotPath} context fail edge must bypass judge node`);

  const evidenceFailEdgeMatch = /judge_evidence_gate -> ([a-zA-Z0-9_]+) \[condition="judge_evidence_gate_pass!=true"\]/.exec(dot);
  assert.ok(evidenceFailEdgeMatch, `${dotPath} must route judge_evidence_gate_pass!=true`);
  assert.notEqual(evidenceFailEdgeMatch?.[1], "judge", `${dotPath} evidence fail edge must bypass judge node`);
}

test("judge graph inventory remains deterministic for #479/#480 preflight coverage", () => {
  const judgeGraphs = listJudgeGraphs();
  // write_issue_item uses issue_quality_judge but has no evidence/context
  // preflight — it uses a simplified judge-after-creation pattern.
  // Only graphs with full judge preflight ceremony are in this inventory.
  assert.deepEqual(judgeGraphs.filter((p) => !p.endsWith("write_issue_item.workflow-source.mjs")), [
    "factories/mothership/workflows/goal-execution/goal_execute.workflow-source.mjs",
    "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs",
    "packages/capability-product-judge/workflows/product_judge/product_judge.workflow-source.mjs",
    "packages/capability-software-development/workflows/goal_execute/goal_execute.workflow-source.mjs",
  ]);
});

const PREFLIGHT_SUCCESS_TARGET_BY_GRAPH = new Map([
  ["factories/mothership/workflows/goal-execution/goal_execute.workflow-source.mjs", "build_merge_commit_message"],
  ["factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs", "build_merge_commit_message"],
  ["packages/capability-software-development/workflows/goal_execute/goal_execute.workflow-source.mjs", "build_merge_commit_message"],
]);

// write_issue_item uses a simplified judge (no evidence/context preflight)
for (const dotPath of listJudgeGraphs().filter((p) => !p.endsWith("write_issue_item.workflow-source.mjs"))) {
  test(`${dotPath} requires deterministic judge preflight routing`, () => {
    assertJudgeGraphHasDeterministicPreflight(dotPath, {
      successTarget: PREFLIGHT_SUCCESS_TARGET_BY_GRAPH.get(dotPath) || "judge",
    });

    if (dotPath.includes("goal_execute.dot") && !dotPath.includes("goal_issue_execute.dot")) {
      const dot = loadGraphSemanticsText(dotPath);
      assert.match(dot, /merged_results_gate -> judge \[condition="merged_count!=0"\]/);
      assert.match(dot, /encode_merge_candidates_b64[\s\S]*(?:action_id="common\.encode_base64"[\s\S]*action_(?:raw|value)="\$\{merge_candidates\}"|common (run --op )?encode-base64 --raw '\$\{merge_candidates\}')/);
      assert.match(dot, /(?:action_judge_context_b64="\$\{merge_candidates_b64\}"|--judge-context-b64 '\$\{merge_candidates_b64\}')/);
      assert.match(dot, /judge_context_gate -> build_judge_context_recovery_packet \[condition="judge_context_gate_pass!=true"\]/);
      assert.match(dot, /judge_evidence_gate -> build_judge_evidence_recovery_packet \[condition="judge_evidence_gate_pass!=true"\]/);
      assert.match(dot, /build_judge_context_recovery_packet -> no_merge_exit/);
      assert.match(dot, /build_judge_evidence_recovery_packet -> no_merge_exit/);
      assert.match(dot, /build_judge_context_recovery_packet[\s\S]*(?:action_id="judge\.build_recovery_packet"[\s\S]*action_packet_type="judge_context_contract_recovery"|judge build-recovery-packet[^\n]*judge_context_contract_recovery)/);
      assert.match(dot, /build_judge_evidence_recovery_packet[\s\S]*(?:action_id="judge\.build_recovery_packet"[\s\S]*action_packet_type="judge_evidence_contract_recovery"|judge build-recovery-packet[^\n]*judge_evidence_contract_recovery)/);
    }

    if (dotPath.endsWith("wave_execute.dot")) {
      const dot = loadGraphSemanticsText(dotPath);
      assert.match(dot, /merge_gate -> (?:judge|run_demo_gate) \[condition="merged_count!=0"\]/);
      if (/merge_gate -> run_demo_gate \[condition="merged_count!=0"\]/.test(dot)) {
        assert.match(dot, /run_demo_gate -> judge \[condition="demo_strategy_policy=none"\]/);
        assert.match(dot, /run_demo_gate -> run_wave_demo_generate \[condition="demo_strategy_policy!=none"\]/);
        assert.match(dot, /run_wave_demo_generate -> judge/);
      }
      assert.match(dot, /encode_merge_candidates_b64[\s\S]*(?:action_id="common\.encode_base64"[\s\S]*action_(?:raw|value)="\$\{merge_candidates\}"|common (run --op )?encode-base64 --raw '\$\{merge_candidates\}')/);
      assert.match(dot, /(?:action_judge_context_b64="\$\{merge_candidates_b64\}"|--judge-context-b64 '\$\{merge_candidates_b64\}')/);
      assert.match(dot, /judge_context_gate -> build_judge_context_recovery_packet \[condition="judge_context_gate_pass!=true"\]/);
      assert.match(dot, /judge_evidence_gate -> build_judge_evidence_recovery_packet \[condition="judge_evidence_gate_pass!=true"\]/);
      assert.match(dot, /build_judge_context_recovery_packet -> unlock_ready_issue/);
      assert.match(dot, /build_judge_evidence_recovery_packet -> unlock_ready_issue/);
      assert.match(dot, /build_judge_context_recovery_packet[\s\S]*(?:action_id="judge\.build_recovery_packet"[\s\S]*action_packet_type="judge_context_contract_recovery"|judge build-recovery-packet[^\n]*judge_context_contract_recovery)/);
      assert.match(dot, /build_judge_evidence_recovery_packet[\s\S]*(?:action_id="judge\.build_recovery_packet"[\s\S]*action_packet_type="judge_evidence_contract_recovery"|judge build-recovery-packet[^\n]*judge_evidence_contract_recovery)/);
    }

    if (dotPath === "packages/capability-software-development/workflows/goal_execute/goal_execute.workflow-source.mjs") {
      const dot = loadGraphSemanticsText(dotPath);
      assert.match(dot, /merged_results_gate -> judge \[condition="merged_count!=0"\]/);
      assert.match(dot, /encode_merge_candidates_b64[\s\S]*(?:action_id="common\.encode_base64"[\s\S]*action_(?:raw|value)="\$\{merge_candidates\}"|common (run --op )?encode-base64 --raw '\$\{merge_candidates\}')/);
      assert.match(dot, /(?:action_judge_context_b64="\$\{merge_candidates_b64\}"|--judge-context-b64 '\$\{merge_candidates_b64\}')/);
      assert.match(dot, /judge_context_gate -> build_judge_context_recovery_packet \[condition="judge_context_gate_pass!=true"\]/);
      assert.match(dot, /judge_evidence_gate -> build_judge_evidence_recovery_packet \[condition="judge_evidence_gate_pass!=true"\]/);
      assert.match(dot, /build_judge_context_recovery_packet -> no_merge_exit/);
      assert.match(dot, /build_judge_evidence_recovery_packet -> no_merge_exit/);
      assert.match(dot, /build_judge_context_recovery_packet[\s\S]*(?:action_id="judge\.build_recovery_packet"[\s\S]*action_packet_type="judge_context_contract_recovery"|judge build-recovery-packet[^\n]*judge_context_contract_recovery)/);
      assert.match(dot, /build_judge_evidence_recovery_packet[\s\S]*(?:action_id="judge\.build_recovery_packet"[\s\S]*action_packet_type="judge_evidence_contract_recovery"|judge build-recovery-packet[^\n]*judge_evidence_contract_recovery)/);
      assert.match(
        dot,
        /(?:action_scenario_selector="\$\{judge_scenario_selector\}"|--scenario-selector '\$\{judge_scenario_selector\}')/,
        "shared goal_execute must use ${judge_scenario_selector} context variable, not a hardcoded selector",
      );
      assert.doesNotMatch(
        dot,
        /--scenario-selector 'astrochicken'/,
        "shared goal_execute must not hardcode 'astrochicken' as scenario selector",
      );
      assert.match(
        dot,
        /seed_state[\s\S]*(?:action_id="software\.seed_goal_state"[\s\S]*action_runs_dir="\$\{runs_dir\}"|seed-state[^\n]*--runs-dir '\$\{runs_dir\}')/,
        "shared goal_execute seed_state must pass --runs-dir for incremental resume across restarts",
      );
    }

    if (dotPath === "packages/capability-product-judge/workflows/product_judge/product_judge.workflow-source.mjs") {
      const dot = loadGraphSemanticsText(dotPath);
      assert.match(dot, /typed_action_transport_mode = "enforced"/);
      assert.match(dot, /build_judge_evidence[\s\S]*action_id="judge\.build_evidence_contract"/);
      assert.match(dot, /build_judge_context[\s\S]*action_id="judge\.build_context_contract"/);
      assert.match(dot, /validate_judge_context[\s\S]*action_id="judge\.validate_context_contract"/);
      assert.match(dot, /validate_judge_evidence[\s\S]*action_id="judge\.validate_evidence_contract"/);
      assert.match(dot, /build_judge_context_recovery_packet[\s\S]*action_id="judge\.build_recovery_packet"/);
      assert.match(dot, /build_judge_evidence_recovery_packet[\s\S]*action_id="judge\.build_recovery_packet"/);
      assert.match(dot, /open_followup[\s\S]*action_id="wave\.open_judge_followup"/);
      assert.match(dot, /action_judge_context_raw="\$\{merge_candidates\}"/);
    }

  });
}
