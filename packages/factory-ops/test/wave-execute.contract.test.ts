import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildAndPersistJudgeContextContract, validateJudgeContextCompleteness } from "../src/commands/judge-context-contract.ts";
import { buildAndPersistJudgeEvidenceContract, validateJudgeEvidenceCompleteness } from "../src/commands/judge-evidence-contract.ts";

const dotPath = "docs/contracts/workflow-ir/mothership/wave_execute.dot";

function seedScenario(registryRoot, relPath) {
  const scenarioDir = join(registryRoot, relPath);
  const scenarioPath = join(scenarioDir, "SCENARIO.md");
  const scope = relPath.split("/")[0] || "astrochicken";
  mkdirSync(scenarioDir, { recursive: true });
  writeFileSync(
    scenarioPath,
    `---\nid: ${relPath.split("/").at(-1) || "scenario"}\nscope: astrochicken\ndomain: post-merge\npriority: high\n---\n\n# ${relPath}\n`,
    "utf8",
  );
}

function writeReviewEvidence(worktreeDir, issueNumber) {
  const evidencePath = join(worktreeDir, ".hatch", "review", `${issueNumber}.json`);
  mkdirSync(join(worktreeDir, ".hatch", "review"), { recursive: true });
  writeFileSync(
    evidencePath,
    `${JSON.stringify({ qa: { status: "pass", command: "npm run test:wave-claim-gates" } }, null, 2)}\n`,
    "utf8",
  );
}

test("wave_execute resolves config defaults in a single node and enforces review failure quarantine policy", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /resolve_config/);
  assert.match(dot, /resolve_config[\s\S]*action_id="software\.resolve_wave_config"/);
  assert.match(dot, /outputs="integration_command,review_qa_command,stale_run_minutes"/);
  assert.match(dot, /handle_review_failures[\s\S]*action_id="software\.handle_wave_review_failures"/);
  assert.match(dot, /action_quarantine_threshold="\$\{review_quarantine_threshold\}"/);
  assert.match(dot, /action_cooldown_hours="\$\{review_cooldown_hours\}"/);
  assert.match(dot, /handle_merge_failures/);
  assert.match(dot, /split_results[\s\S]*action_id="software\.split_wave_results"/);
  assert.match(dot, /action_fallback="\$\{impl_results\}"/);
  // Collapsed config nodes: no separate set_integration_command, set_review_qa_command, set_stale_run_minutes
  assert.doesNotMatch(dot, /set_integration_command/);
  assert.doesNotMatch(dot, /set_review_qa_command/);
  assert.doesNotMatch(dot, /set_stale_run_minutes/);
});

test("wave_execute enforces deterministic post-merge judge scenario registry contract before merge lock (bug #1042, run 0932c093)", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /build_judge_evidence/);
  assert.match(dot, /build_judge_context/);
  assert.match(dot, /validate_judge_context/);
  assert.match(dot, /judge_context_gate/);
  assert.match(dot, /validate_judge_evidence/);
  assert.match(dot, /judge_evidence_gate/);
  assert.match(dot, /build_judge_evidence[\s\S]*action_id="judge\.build_evidence_contract"/);
  assert.match(dot, /build_judge_context[\s\S]*action_id="judge\.build_context_contract"/);
  assert.match(dot, /build_judge_context[\s\S]*action_scenario_registry_root="\$\{scenarios_root\}"/);
  assert.match(dot, /validate_judge_context[\s\S]*action_id="judge\.validate_context_contract"/);
  assert.match(dot, /validate_judge_context[\s\S]*action_scenario_registry_root="\$\{scenarios_root\}"/);
  assert.match(dot, /validate_judge_evidence[\s\S]*action_id="judge\.validate_evidence_contract"/);
  assert.match(dot, /action_objective_id="post_merge_alignment"/);
  assert.match(dot, /action_scenario_selector="astrochicken"/);
  const legacySelector = String.fromCharCode(101, 110, 118, 111, 105);
  assert.doesNotMatch(dot, new RegExp(`action_scenario_selector="${legacySelector}"`));
  assert.match(dot, /action_scenario_context="post-merge"/);
  assert.match(dot, /action_scope="judge"/);
  assert.match(dot, /action_scenario_registry_root="\$\{scenarios_root\}"/);
  assert.match(dot, /action_judge_context_scope_identity="wave_execute"/);
  assert.match(dot, /action_require_qa_markers="true"/);
  assert.match(dot, /action_subject_id="\$\{milestone_title\}"/);
  assert.match(dot, /action_milestone_title="\$\{milestone_title\}"/);
  assert.match(dot, /action_gh_repo="recallnet\/astrochicken"/);
  assert.match(dot, /action_worktree_dir="\$\{repo\}"/);
  assert.match(dot, /encode_merge_candidates_b64/);
  assert.match(dot, /encode_merge_candidates_b64[\s\S]*action_id="common\.encode_base64"/);
  assert.match(dot, /action_value="\$\{merge_candidates\}"/);
  assert.match(dot, /action_judge_context_b64="\$\{merge_candidates_b64\}"/);
  assert.match(dot, /build_judge_context_recovery_packet/);
  assert.match(dot, /build_judge_evidence_recovery_packet/);
  assert.match(dot, /build_judge_context_recovery_packet[\s\S]*action_id="judge\.build_recovery_packet"/);
  assert.match(dot, /build_judge_context_recovery_packet[\s\S]*action_packet_type="judge_context_contract_recovery"/);
  assert.match(dot, /build_judge_evidence_recovery_packet[\s\S]*action_id="judge\.build_recovery_packet"/);
  assert.match(dot, /build_judge_evidence_recovery_packet[\s\S]*action_packet_type="judge_evidence_contract_recovery"/);
  assert.match(dot, /merge_gate -> judge \[condition="merged_count!=0"\]/);
  assert.match(dot, /judge -> ensure_judge_decision -> decide/);
  assert.match(dot, /ensure_judge_decision[\s\S]*action_id="software\.fallback_wave_judge"/);
  // Judge surveys astrochicken scenarios and keeps scenario use sparse
  assert.match(dot, /scenarios="astrochicken"/);
  assert.match(dot, /survey the existing scenario registry/i);
  assert.match(dot, /use zero, one, or at most two scenarios/i);
});

test("wave_execute uses single-branch merge (no fan_out/fan_in)", () => {
  const dot = readFileSync(dotPath, "utf8");
  // Must NOT have per-issue fan_out merge
  assert.doesNotMatch(dot, /fan_out_merge/);
  assert.doesNotMatch(dot, /fan_in_merge/);
  assert.doesNotMatch(dot, /split_merge_results/);
  // Must have single-branch merge flow
  assert.match(dot, /check_merge_candidates/);
  assert.match(dot, /merge_candidates_gate/);
  assert.match(dot, /resolve_merge_context/);
  assert.match(dot, /setup_merge_worktree/);
  assert.match(dot, /rebase_shared_branch/);
  assert.match(dot, /merge_shared_branch/);
  assert.match(dot, /resolve_merge_context[\s\S]*action_id="merge\.resolve_context"/);
  assert.match(dot, /rebase_shared_branch[\s\S]*action_id="merge\.rebase_on_main"/);
  assert.match(dot, /rebase_shared_branch[\s\S]*action_merge_worktree_dir="\$\{merge_worktree_dir\}"/);
  assert.match(dot, /build_conflict_packet[\s\S]*action_id="merge\.build_conflict_packet"/);
  assert.match(dot, /build_conflict_packet[\s\S]*action_worktree_dir="\$\{merge_worktree_dir\}"/);
  assert.match(dot, /verify_resolution[\s\S]*action_id="merge\.verify_resolution"/);
  assert.match(dot, /verify_resolution[\s\S]*action_merge_worktree_dir="\$\{merge_worktree_dir\}"/);
  assert.match(dot, /resolve_conflict[^\]]*workdir="\$\{merge_worktree_dir\}"/);
  assert.match(dot, /push_main_branch[\s\S]*action_id="merge\.push_main_branch"/);
  assert.match(dot, /push_main_branch[\s\S]*action_repo="\$\{repo\}"/);
  assert.match(dot, /push_main_branch[\s\S]*action_branch="main"/);
  assert.match(dot, /push_main_branch[\s\S]*action_remote="origin"/);
  assert.match(dot, /push_main_branch[\s\S]*action_merge_worktree_dir="\$\{merge_worktree_dir\}"/);
  assert.match(dot, /push_main_branch -> push_gate/);
  assert.match(dot, /push_gate -> close_merged_issues \[condition="push_status=pushed"\]/);
  assert.match(dot, /build_push_failure_packet/);
  assert.match(dot, /push_gate -> build_push_failure_packet \[condition="push_status!=pushed"\]/);
  // Push failure routes through LLM resolver (resolve_push_failure), not straight to set_wave_merge_failed
  assert.match(dot, /build_push_failure_packet -> resolve_push_failure/);
  assert.match(dot, /build_push_failure_packet[\s\S]*action_merge_stderr="\$\{push_stderr\}"/);
  assert.match(dot, /close_merged_issues/);
  assert.match(dot, /build_merged_results/);
  // Milestone wrapper should be inlined in wave_execute (no extra composition layer)
  assert.doesNotMatch(dot, /milestone_execute\s*\[type="pipeline"/);
  assert.match(dot, /seed_state/);
  assert.match(dot, /next_issue/);
  assert.doesNotMatch(dot, /--max-issues/, "max_issues budget was removed — waves build all issues");
  assert.doesNotMatch(dot, /milestone run --op next-issue[^\n]*--blocking-mode 'ordering'/);
  assert.match(dot, /execute_issue_in_wave\s*\[type="pipeline"/);
  assert.match(dot, /issue_loop_gate/);
  assert.match(dot, /issue_loop_gate -> split_results \[condition="has_next!=true"\]/);
  assert.doesNotMatch(dot, /yield_after_budget/, "yield_after_budget node was removed");
});

test("wave_execute judge pre-merge gates must pass before acquire_merge_lock; gate failures route unlock->open_followup", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /split_results -> handle_review_failures -> check_merge_candidates -> merge_candidates_gate/);
  assert.match(dot, /merge_candidates_gate -> encode_merge_candidates_b64 \[condition="has_merge_candidates=true"\]/);
  assert.match(dot, /encode_merge_candidates_b64 -> build_judge_evidence -> build_judge_context -> validate_judge_context -> judge_context_gate/);
  assert.match(dot, /judge_context_gate -> validate_judge_evidence \[condition="judge_context_gate_pass=true"\]/);
  assert.match(dot, /validate_judge_evidence -> judge_evidence_gate/);
  assert.match(dot, /judge_evidence_gate -> build_merge_commit_message \[condition="judge_evidence_gate_pass=true"\]/);
  assert.match(dot, /build_merge_commit_message -> acquire_merge_lock/);
  assert.match(dot, /acquire_merge_lock -> resolve_merge_context -> setup_merge_worktree -> rebase_shared_branch/);

  assert.match(dot, /judge_context_gate -> build_judge_context_recovery_packet \[condition="judge_context_gate_pass!=true"\]/);
  assert.match(dot, /judge_evidence_gate -> build_judge_evidence_recovery_packet \[condition="judge_evidence_gate_pass!=true"\]/);
  assert.match(dot, /build_judge_context_recovery_packet -> unlock_ready_issue/);
  assert.match(dot, /build_judge_evidence_recovery_packet -> unlock_ready_issue/);
  assert.match(dot, /unlock_ready_issue[\s\S]*action_reason="judge_failed"/);
  assert.match(dot, /requeue_after_judge_failure/);
  assert.match(dot, /requeue_after_judge_failure[\s\S]*action_id="wave\.requeue_after_judge_failure"/);
  assert.match(dot, /outputs="wave_ready_marker_action,wave_ready_marker_issue,cooldown_reason,judge_context_scope_identity/);
  assert.match(dot, /action_judge_context_scope_identity="wave_execute"/);
  assert.match(dot, /unlock_ready_issue -> requeue_after_judge_failure -> open_followup -> finalize_from_fail -> release_merge_lock/);

  assert.doesNotMatch(dot, /judge_context_gate -> acquire_merge_lock/);
  assert.doesNotMatch(dot, /judge_evidence_gate -> resolve_merge_context/);
});

test("wave_execute passes next_issue_number/next_issue_title directly to child pipeline (no make_issue_item)", () => {
  const dot = readFileSync(dotPath, "utf8");
  // make_issue_item and init_results are removed
  assert.doesNotMatch(dot, /make_issue_item/);
  assert.doesNotMatch(dot, /init_results/);
  // issue_loop_gate routes through clear_impl_result to execute_issue_in_wave, or to split_results
  assert.match(dot, /issue_loop_gate -> clear_impl_result \[condition="has_next=true"\]/);
  assert.match(dot, /clear_impl_result -> execute_issue_in_wave/);
  assert.match(dot, /issue_loop_gate -> split_results \[condition="has_next!=true"\]/);
  // accumulate still references next_issue_number and next_issue_title
  assert.match(dot, /accumulate[\s\S]*action_issue_number="\$\{next_issue_number\}"/);
  assert.match(dot, /accumulate[\s\S]*action_issue_title="\$\{next_issue_title\}"/);
});

test("wave_execute enforces lock/release ownership flow across terminal transitions", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /find_ready_wave[\s\S]*action_id="wave\.find_ready"/);
  assert.match(dot, /find_ready_wave[\s\S]*action_run_id="\$\{__run_id\}"/);
  assert.match(dot, /outputs="milestone_title,ready_issue_number,claim_token,claim_owner_id,claim_run_id/);
  assert.match(dot, /check_cp_blocker[\s\S]*action_id="wave\.check_control_plane_blocker"/);
  assert.match(dot, /check_cp_blocker[\s\S]*action_issue="\$\{ready_issue_number\}"/);
  assert.match(dot, /gate -> check_cp_blocker \[condition="milestone_title!="\]/);
  assert.match(dot, /check_cp_blocker -> cp_blocked_exit \[condition="blocker_active=true"\]/);
  assert.match(dot, /check_cp_blocker -> lock_wave \[condition="blocker_active!=true"\]/);
  assert.match(dot, /lock_wave[\s\S]*action_id="wave\.lock_ready"/);
  assert.match(dot, /lock_wave[\s\S]*action_claim_token="\$\{claim_token\}"/);
  assert.match(dot, /unlock_ready_issue[\s\S]*action_id="wave\.block_ready"/);
  assert.match(dot, /unlock_ready_issue[\s\S]*action_run_id="\$\{__run_id\}"/);
  assert.match(dot, /close_ready_issue[\s\S]*action_id="wave\.complete_ready"/);
  assert.match(dot, /close_ready_issue[\s\S]*action_milestone_title="\$\{milestone_title\}"/);
  assert.match(dot, /finalize_from_close[\s\S]*action_reason="terminal_close"/);
  assert.match(dot, /finalize_from_no_merge[\s\S]*action_reason="terminal_no_merge"/);
  assert.match(dot, /finalize_from_fail[\s\S]*action_reason="terminal_judge_fail"/);
});

test("wave_execute does not use execution lease (moved to supervisor fan_out)", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.doesNotMatch(dot, /acquire_execution_lease/);
  assert.doesNotMatch(dot, /release_execution_lease/);
  assert.doesNotMatch(dot, /lease_gate/);
  assert.doesNotMatch(dot, /factory (run --op )?lease-acquire[^\n]*--lease-name 'wave_execute'/);
  assert.doesNotMatch(dot, /factory (run --op )?lease-release[^\n]*--lease-name 'wave_execute'/);
});

test("wave_execute serializes merges via local lock", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /acquire_merge_lock/);
  assert.match(dot, /release_merge_lock/);
  assert.match(dot, /acquire_merge_lock[\s\S]*action_id="merge\.acquire_lock"/);
  assert.match(dot, /release_merge_lock[\s\S]*action_id="merge\.release_lock"/);
  // All terminal paths converge at release_merge_lock before done
  assert.match(dot, /finalize_from_close -> release_merge_lock/);
  assert.match(dot, /finalize_from_no_merge -> release_merge_lock/);
  assert.match(dot, /finalize_from_fail -> release_merge_lock/);
  // Main branch safety guard runs after merge lock release, before final review
  assert.match(dot, /release_merge_lock -> assert_main_after_merge/);
  assert.match(dot, /assert_main_after_merge -> final_review_gate/);
  // final_state_review is gated behind wave_terminal_path=close (Bug fix: zero-work waves skip it)
  assert.match(dot, /final_review_gate -> final_state_review \[condition="wave_terminal_path=close"\]/);
  assert.match(dot, /final_review_gate -> cleanup_merge_worktree \[condition="wave_terminal_path!=close"\]/);
  assert.match(dot, /cleanup_merge_worktree -> cleanup_wave_worktree -> done/);
});

test("wave_execute asserts main branch at startup and after merge operations", () => {
  const dot = readFileSync(dotPath, "utf8");
  // Pipeline start: set_repo -> assert_main_branch -> set_gh_repo
  assert.match(dot, /set_repo -> assert_main_branch/);
  assert.match(dot, /assert_main_branch -> set_gh_repo/);
  assert.match(dot, /assert_main_branch[\s\S]*action_id="merge\.assert_main_branch"/);
  assert.match(dot, /assert_main_after_merge[\s\S]*action_id="merge\.assert_main_branch"/);
});

test("wave_execute conflict state-machine is complete for rebase/merge conflict resolution", () => {
  const dot = readFileSync(dotPath, "utf8");

  // Rebase branch state machine
  assert.match(dot, /rebase_shared_gate -> set_resolution_source_deterministic \[condition="rebase_status=ready"\]/);
  assert.match(dot, /set_resolution_source_deterministic -> merge_shared_branch/);
  assert.match(dot, /rebase_shared_gate -> set_resolution_source_llm \[condition="rebase_status!=ready"\]/);
  assert.match(dot, /set_resolution_source_llm -> build_conflict_packet/);

  // Conflict resolver chain must be fully connected
  assert.match(dot, /set_resolution_source_llm -> build_conflict_packet -> resolve_conflict -> finalize_merge_commit -> finalize_gate/);
  assert.match(dot, /finalize_gate -> verify_resolution \[condition="finalize_status=ok"\]/);
  assert.match(dot, /finalize_gate -> retry_resolve_conflict \[condition="finalize_status!=ok"\]/);
  assert.match(dot, /retry_resolve_conflict -> verify_resolution/);
  assert.match(dot, /resolution_gate -> emit_resolution_failure \[condition="resolution_status!=resolved"\]/);
  assert.match(dot, /emit_resolution_failure -> set_wave_merge_failed/);

  // Resolution outcomes must both be handled deterministically
  assert.match(dot, /resolution_gate -> merge_shared_branch \[condition="resolution_status=resolved"\]/);
  assert.match(dot, /resolution_gate -> emit_resolution_failure \[condition="resolution_status!=resolved"\]/);
});

test("wave_execute finalizes pending merge commits in both conflict paths", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /finalize_merge_commit[\s\S]*action_id="merge\.finalize_commit"/);
  assert.match(dot, /finalize_post_merge_commit[\s\S]*action_id="merge\.finalize_commit"/);
});

test("wave_execute build_merged_results forwards merge resolver telemetry dimensions", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /build_merged_results[\s\S]*action_id="software\.build_wave_merge_results"/);
  assert.match(dot, /build_merged_results[\s\S]*action_merge_resolver="\$\{resolution_source\}"/);
  assert.match(dot, /build_merged_results[\s\S]*action_path_taken="merge"/);
});

test("wave_execute emits explicit resolution_source for deterministic and llm merge paths", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /set_resolution_source_deterministic\s*\[.*output_key="resolution_source".*prompt="printf 'deterministic'"/s);
  assert.match(dot, /rebase_shared_gate -> set_resolution_source_deterministic \[condition="rebase_status=ready"\]/);
  assert.match(dot, /set_resolution_source_deterministic -> merge_shared_branch/);
  assert.match(dot, /set_resolution_source_llm\s*\[.*output_key="resolution_source".*prompt="printf 'llm'"/s);
  assert.match(dot, /rebase_shared_gate -> set_resolution_source_llm \[condition="rebase_status!=ready"\]/);
  assert.match(dot, /set_resolution_source_llm -> build_conflict_packet -> resolve_conflict -> finalize_merge_commit -> finalize_gate/);
  assert.match(dot, /finalize_gate -> verify_resolution \[condition="finalize_status=ok"\]/);
  assert.match(dot, /finalize_gate -> retry_resolve_conflict \[condition="finalize_status!=ok"\]/);
  assert.match(dot, /retry_resolve_conflict -> verify_resolution/);
  assert.match(dot, /resolution_gate -> emit_resolution_failure \[condition="resolution_status!=resolved"\]/);
  assert.match(dot, /build_merged_results[\s\S]*action_merge_resolver="\$\{resolution_source\}"/);
});

test("wave_execute fixture a92c830c reproduces judge_context_scenarios_missing and passes with astrochicken pre-merge gate inputs", () => {
  const mergeCandidatesRaw = JSON.stringify([
    {
      issue_number: "1300",
      branch: "wave/goal-1-wave-1",
      worktree_dir: "/tmp/wave-1300",
    },
  ]);

  const preFix = validateJudgeContextCompleteness({
    judgeContextPath: "",
    judgeContextSha256: "",
    judgeContextValid: "false",
    judgeContextError: "judge_context_scenarios_missing",
    judgeKind: "wave_execution_post_merge",
    judgeContextRaw: mergeCandidatesRaw,
    scenarioSelector: "",
    scenarioRegistryRoot: "",
    objectiveId: "post_merge_alignment",
    judgeRubric: "alignment.default",
    judgeEvidencePath: "",
    judgeEvidenceSha256: "",
  });

  assert.equal(preFix.judge_context_gate_pass, "false");
  assert.equal(preFix.judge_context_gate_code, "judge_context_scenarios_missing");
  assert.equal(preFix.disposition, "escalate");
  assert.match(preFix.notes, /judge_context_scenarios_missing/);

  const root = mkdtempSync(join(tmpdir(), "wave-execute-judge-a92c830c-"));
  const registry = join(root, "registry");
  const worktree = join(root, "wt-1300");
  mkdirSync(worktree, { recursive: true });
  seedScenario(registry, "astrochicken/post-merge/a");
  writeReviewEvidence(worktree, "1300");

  const postFixContextRaw = JSON.stringify([
    {
      issue_number: "1300",
      branch: "wave/goal-1-wave-1",
      worktree_dir: worktree,
    },
  ]);

  const builtEvidence = buildAndPersistJudgeEvidenceContract({
    judgeKind: "wave_execution_post_merge",
    judgeContextRaw: postFixContextRaw,
    worktreeDir: root,
    subjectId: "goal-1-wave-1",
    requireQaMarkers: "true",
  });
  assert.equal(builtEvidence.judge_evidence_valid, "true");

  const builtContext = buildAndPersistJudgeContextContract({
    judgeKind: "wave_execution_post_merge",
    judgeContextRaw: postFixContextRaw,
    scenarioSelector: "astrochicken",
    scenarioRegistryRoot: registry,
    objectiveId: "post_merge_alignment",
    judgeRubric: "alignment.default",
    judgeEvidencePath: builtEvidence.judge_evidence_path,
    judgeEvidenceSha256: builtEvidence.judge_evidence_sha256,
    subjectId: "goal-1-wave-1",
    milestoneTitle: "goal-1-wave-1",
    ghRepo: "recallnet/astrochicken",
    judgeContextScopeIdentity: "wave_execute",
    worktreeDir: root,
  });
  assert.equal(builtContext.judge_context_valid, "true");
  const builtContextArtifact = JSON.parse(readFileSync(builtContext.judge_context_path, "utf8"));
  assert.equal(builtContextArtifact.scenario_selector, "astrochicken");
  assert.equal(builtContextArtifact.scope?.milestone_title, "goal-1-wave-1");

  const validatedContext = validateJudgeContextCompleteness({
    judgeContextPath: builtContext.judge_context_path,
    judgeContextSha256: builtContext.judge_context_sha256,
    judgeContextValid: builtContext.judge_context_valid,
    judgeContextError: builtContext.judge_context_error,
    judgeKind: "wave_execution_post_merge",
    judgeContextRaw: postFixContextRaw,
    scenarioSelector: "astrochicken",
    scenarioRegistryRoot: registry,
    objectiveId: "post_merge_alignment",
    judgeRubric: "alignment.default",
    judgeContextScopeIdentity: "wave_execute",
    judgeEvidencePath: builtEvidence.judge_evidence_path,
    judgeEvidenceSha256: builtEvidence.judge_evidence_sha256,
  });
  assert.equal(validatedContext.judge_context_gate_pass, "true");

  const validatedEvidence = validateJudgeEvidenceCompleteness({
    judgeKind: "wave_execution_post_merge",
    judgeContextRaw: postFixContextRaw,
    judgeEvidencePath: builtEvidence.judge_evidence_path,
    judgeEvidenceSha256: builtEvidence.judge_evidence_sha256,
    judgeEvidenceValid: builtEvidence.judge_evidence_valid,
    judgeEvidenceError: builtEvidence.judge_evidence_error,
    requireQaMarkers: "true",
  });
  assert.equal(validatedEvidence.judge_evidence_gate_pass, "true");
});

test("wave_execute push failure routes through LLM resolver before failing", () => {
  const dot = readFileSync(dotPath, "utf8");

  // Push failures (rejected, non-fast-forward, dirty worktree on push) must NOT
  // go straight to set_wave_merge_failed. They must route through an LLM resolver
  // that can fix the issue (e.g. re-rebase, resolve conflicts, stash/commit dirty
  // files) and retry the push. This mirrors the post-merge recovery pattern.
  //
  // The old contract was: push_gate -> build_push_failure_packet -> set_wave_merge_failed
  // The new contract is:  push_gate -> build_push_failure_packet -> resolve_push_failure -> ... -> retry_push or set_wave_merge_failed

  // build_push_failure_packet must NOT go directly to set_wave_merge_failed
  assert.doesNotMatch(dot, /build_push_failure_packet -> set_wave_merge_failed/,
    "push failures must route through LLM resolver, not straight to set_wave_merge_failed");

  // There must be an LLM resolver node after build_push_failure_packet
  assert.match(dot, /build_push_failure_packet -> resolve_push_failure/,
    "build_push_failure_packet must route to resolve_push_failure LLM node");

  // The resolver must be a merge_resolver-class LLM node operating in the merge worktree
  assert.match(dot, /resolve_push_failure\s*\[class="merge_resolver"/,
    "resolve_push_failure must be a merge_resolver-class LLM node");
  assert.match(dot, /resolve_push_failure[^\]]*workdir="\$\{merge_worktree_dir\}"/,
    "resolve_push_failure must run in the merge worktree");
  assert.match(dot, /resolve_push_failure[^\]]*skill_id="wave.execute.merge"/,
    "resolve_push_failure must use the merge skill");

  // After resolution, there must be a push retry
  assert.match(dot, /resolve_push_failure[^\n]*\n[\s\S]*?retry_push_main/,
    "resolve_push_failure must be followed by a push retry node");
  assert.match(dot, /retry_push_main[\s\S]*action_id="merge\.push_main_branch"/,
    "retry_push_main must invoke the push-main operation");

  // Retry push must have a gate with success/failure outcomes
  assert.match(dot, /retry_push_main -> retry_push_gate/,
    "retry_push_main must route to retry_push_gate");
  assert.match(dot, /retry_push_gate -> close_merged_issues \[condition="push_status=pushed"\]/,
    "successful retry push must proceed to close_merged_issues");
  assert.match(dot, /retry_push_gate -> set_wave_merge_failed \[condition="push_status!=pushed"\]/,
    "failed retry push must route to set_wave_merge_failed (exhausted)");
});

test("wave_execute cleans up wave worktree on terminal success/failure paths", () => {
  const dot = readFileSync(dotPath, "utf8");
  // Desired conveyor model: one wave worktree plus one merge worktree, both cleaned on terminal completion.
  assert.match(dot, /cleanup_wave_worktree/);
  assert.match(dot, /cleanup_wave_worktree[\s\S]*action_id="coding\.cleanup_wave_issue_worktree"/);
  assert.match(dot, /cleanup_wave_worktree[\s\S]*action_worktree_dir="\$\{worktree_dir\}"/);
  assert.match(dot, /cleanup_merge_worktree/);
  assert.match(dot, /cleanup_merge_worktree[\s\S]*action_id="merge\.cleanup_worktree"/);
  assert.match(dot, /cleanup_merge_worktree[\s\S]*action_merge_worktree_dir="\$\{merge_worktree_dir\}"/);
  // Close path flows through final_state_review, then merge cleanup, then wave cleanup.
  assert.match(dot, /final_state_review -> cleanup_merge_worktree/);
  // Non-close paths skip final_state_review but still cleanup both worktrees.
  assert.match(dot, /final_review_gate -> cleanup_merge_worktree \[condition="wave_terminal_path!=close"\]/);
  assert.match(dot, /cleanup_merge_worktree -> cleanup_wave_worktree -> done/);
});

// ─── Zero-work wave must NOT run final_state_review ─────────────────────────

test("wave_execute has explicit control-plane blocker early exit", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /check_cp_blocker \[type="tool" governance="reversible"/);
  assert.match(dot, /cp_blocked_exit \[type="exit" label="cp_blocked"\]/);
  assert.match(dot, /gate -> check_cp_blocker \[condition="milestone_title!="\]/);
  assert.match(dot, /check_cp_blocker -> cp_blocked_exit \[condition="blocker_active=true"\]/);
  assert.match(dot, /check_cp_blocker -> lock_wave \[condition="blocker_active!=true"\]/);
  assert.doesNotMatch(dot, /gate -> lock_wave \[condition="milestone_title!="\]/);
});

test("wave_execute.dot gates final_state_review behind work-done check", () => {
  const dot = readFileSync(dotPath, "utf8");

  // Bug: when a wave does zero work (all issues blocked → has_next=false,
  // merge_candidate_count=0), it still runs final_state_review which reconciles
  // the ENTIRE goal's milestones — closing wave markers that belong to other
  // waves that still have open work. This caused production damage: wave markers
  // for goal-1555-wave-2, goal-1549-wave-2, goal-1564-wave-2 were closed despite
  // having open features.
  //
  // The graph must gate final_state_review so it only runs when the wave actually
  // processed at least one issue (merge_candidate_count > 0 or completed_issues
  // is non-empty). The no-merge terminal path (unlock_no_merge → finalize) must
  // skip final_state_review and go directly to cleanup.

  // There must be a gate node between release_merge_lock and final_state_review.
  // The no-work path should bypass final_state_review entirely.
  const hasDirectPath = /release_merge_lock\s*->\s*final_state_review/.test(dot);

  // If the gate exists, the direct path should not exist — there should be a
  // conditional node (diamond) routing to final_state_review only when work was done.
  assert.equal(
    hasDirectPath, false,
    "release_merge_lock must NOT unconditionally flow to final_state_review. " +
    "Zero-work waves (all issues blocked) must skip final_state_review to prevent " +
    "cross-wave marker damage. Gate on merge_candidate_count or processed issue count.",
  );
});

test("wave_execute clears impl_result before each issue execution to prevent cross-issue leak", () => {
  const dot = readFileSync(dotPath, "utf8");

  // There must be a clear_impl_result node that resets impl_result to empty
  assert.match(
    dot,
    /clear_impl_result/,
    "wave_execute must contain a clear_impl_result node to prevent stale impl_result from iteration N leaking into iteration N+1",
  );

  // The clear node must set output_key="impl_result" so it overwrites the context variable
  assert.match(
    dot,
    /clear_impl_result[\s\S]*output_key="impl_result"/,
    "clear_impl_result must write to output_key=\"impl_result\" to reset the context variable",
  );

  // The clear node must be wired BEFORE execute_issue_in_wave in the loop
  // Edge: issue_loop_gate -> clear_impl_result (when has_next=true)
  assert.match(
    dot,
    /issue_loop_gate\s*->\s*clear_impl_result\s*\[condition="has_next=true"\]/,
    "issue_loop_gate must route to clear_impl_result (not directly to execute_issue_in_wave) when has_next=true",
  );

  // Edge: clear_impl_result -> execute_issue_in_wave
  assert.match(
    dot,
    /clear_impl_result\s*->\s*execute_issue_in_wave/,
    "clear_impl_result must flow into execute_issue_in_wave",
  );

  // The old direct edge must NOT exist
  assert.doesNotMatch(
    dot,
    /issue_loop_gate\s*->\s*execute_issue_in_wave/,
    "issue_loop_gate must NOT route directly to execute_issue_in_wave — impl_result must be cleared first",
  );
});
