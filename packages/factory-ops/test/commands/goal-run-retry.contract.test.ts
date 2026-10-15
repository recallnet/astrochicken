import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { countDecomposeAttempts, countDecomposeAttemptsFromIssue } from "../../src/commands/goal-queue-ops.ts";

const dotPath = "docs/contracts/workflow-ir/capability-goal-decomposition/goal_run.dot";
const IRREVERSIBLE_TYPED_ACTION_MARKERS = [
  'action_id="goal.post_decompose_attempt"',
  'action_id="goal.exhaust_decompose_retries"',
  'action_id="goal.mark_dispatched"',
  'action_id="goal.post_retry_comment"',
  'action_id="goal.guard_duplicate_decompose"',
  'action_id="triage.resolve_feature_dependencies"',
  'action_id="goal.label_created_issues"',
  'action_id="goal.apply_feature_blockers"',
  'action_id="goal.persist_decomposition_packet"',
  'action_id="goal.materialize_approved_plan"',
];
void IRREVERSIBLE_TYPED_ACTION_MARKERS;

// ────────────────────────────────────────────────────────────
// Gate: keep_open must NOT strip the ready label
// The dead-end bug: transient decompose failure → keep_open strips ready →
// goal permanently invisible to listReadyGoals. Must keep ready for retry.
// ────────────────────────────────────────────────────────────
test("keep_open node must not strip the ready label", () => {
  const dot = readFileSync(dotPath, "utf8");
  // Extract the keep_open node definition
  const keepOpenMatch = dot.match(/keep_open\s*\[[\s\S]*?\]\s*(?=\n\s*\n|\n\s*\w|\n\s*start)/);
  assert.ok(keepOpenMatch, "keep_open node must exist in goal_run.dot");
  const keepOpen = keepOpenMatch[0];

  assert.doesNotMatch(
    keepOpen,
    /--remove-label\s+ready/,
    "keep_open must NOT strip the ready label — transient failures must allow retry on next tick"
  );
});

// ────────────────────────────────────────────────────────────
// Gate: keep_open posts a machine-readable diagnostic marker
// Used by countDecomposeAttempts to track retry count.
// ────────────────────────────────────────────────────────────
test("keep_open posts machine-readable decompose-retry marker", () => {
  const dot = readFileSync(dotPath, "utf8");
  const keepOpenMatch = dot.match(/keep_open\s*\[[\s\S]*?\]\s*(?=\n\s*\n|\n\s*\w|\n\s*start)/);
  assert.ok(keepOpenMatch);
  assert.match(
    keepOpenMatch[0],
    /action_id="goal\.post_retry_comment"/,
    "keep_open must route through the typed retry-comment owner that emits the machine-readable marker"
  );
});

test("mark_dispatched must not strip the ready label", () => {
  const dot = readFileSync(dotPath, "utf8");
  const markMatch = dot.match(/mark_dispatched\s*\[[\s\S]*?\]\s*(?=\n\s*\n|\n\s*\w|\n\s*start)/);
  assert.ok(markMatch, "mark_dispatched node must exist in goal_run.dot");
  assert.doesNotMatch(markMatch[0], /--remove-label\s+ready/);
  assert.match(markMatch[0], /action_id="goal\.mark_dispatched"/);
});

test("goal_run fail-closed admission path emits deterministic duplicate/planning error", () => {
  const dot = readFileSync(dotPath, "utf8");
  const failMatch = dot.match(/fail_duplicate_admission\s*\[[\s\S]*?\]\s*(?=\n\s*\n|\n\s*\w|\n\s*start)/);
  assert.ok(failMatch, "fail_duplicate_admission node must exist in goal_run.dot");
  assert.match(failMatch[0], /action_id="goal\.build_admission_failure"/);
  assert.match(dot, /admission_gate\s*->\s*easy_execution_gate\s*\[condition="goal_admission_allowed=true"\]/);
  assert.match(dot, /easy_execution_gate\s*->\s*check_already_decomposed\s*\[condition="goal_execution_path=medium"\]/);
  assert.match(dot, /easy_execution_gate\s*->\s*hard_planning_gate\s*\[condition="goal_execution_path=hard"\]/);
  assert.match(dot, /hard_planning_gate\s*->\s*hard_plan\s*\[condition="planning_state!=approved"\]/);
  assert.match(dot, /hard_planning_gate\s*->\s*materialize_hard_plan\s*\[condition="planning_state=approved"\]/);
  assert.match(dot, /materialize_hard_plan\s*->\s*approved_hard_plan_resume/);
  assert.match(dot, /approved_hard_plan_resume\s*->\s*encode_goal_issue_b64/);
  assert.match(dot, /approved_hard_plan_resume\s*\[type="tool"/);
  assert.match(dot, /approved_hard_plan_resume[\s\S]*outputs="approved,decompose_attempt_number,decompose_parse_status,decompose_parse_source"/);
  assert.match(dot, /approved_hard_plan_resume[\s\S]*decompose_parse_status/);
  assert.match(dot, /approved_hard_plan_resume[\s\S]*goal_run\.materialize_hard_plan/);
  assert.match(dot, /materialize_hard_plan[\s\S]*action_id="goal\.materialize_approved_plan"/);
  assert.match(dot, /easy_execution_gate\s*->\s*set_goal_execution_mode_direct\s*\[condition="goal_execution_path=easy"\]/);
  assert.match(dot, /admission_gate\s*->\s*fail_duplicate_admission\s*\[condition="goal_admission_allowed!=true"\]/);
  assert.match(dot, /fail_duplicate_admission\s*->\s*done/);
  assert.doesNotMatch(dot, /decide_skip_decompose/);
  assert.match(dot, /check_already_decomposed\s*\[type="tool"/);
});

test("goal_run routes duplicate decomposition attempts through fail-closed duplicate guard", () => {
  const dot = readFileSync(dotPath, "utf8");
  const guardMatch = dot.match(/duplicate_decompose_guard\s*\[[\s\S]*?\]\s*(?=\n\s*\n|\n\s*\w|\n\s*start)/);
  assert.ok(guardMatch, "duplicate_decompose_guard node must exist in goal_run.dot");
  assert.match(guardMatch[0], /governance="irreversible"/);
  assert.match(guardMatch[0], /action_id="goal\.guard_duplicate_decompose"/);
  assert.match(dot, /check_decompose_retries\s*->\s*duplicate_decompose_guard/);
  assert.match(dot, /duplicate_decompose_guard\s*->\s*current_decompose_attempt/);
  assert.match(dot, /current_decompose_attempt\s*->\s*decompose_retry_gate/);
});

test("goal_run resolves execution-path metadata then enforces admission gate before decomposition", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /resolve_execution_path\s*\[type="tool"/);
  assert.match(dot, /resolve_execution_path[\s\S]*action_id="software\.resolve_goal_execution_path"/);
  assert.match(dot, /outputs="goal_issue_number,goal_execution_path,goal_routing_state,goal_execution_path_version,classification_version,goal_execution_path_packet_id,goal_execution_path_packet_path,goal_execution_path_source,understanding_risk,rationale_required"/);
  assert.match(dot, /append_rationale_feature[\s\S]*action_id="goal\.append_rationale_feature"/);
  assert.match(dot, /admission_check\s*\[type="tool"/);
  assert.match(dot, /resolve_hard_goal_state[\s\S]*action_id="goal\.inspect_hard_state"/);
  assert.match(dot, /admission_check[\s\S]*action_id="goal\.inspect_run_admission"/);
  assert.match(dot, /start\s*->\s*resolve_execution_path/);
  assert.match(dot, /resolve_execution_path\s*->\s*resolve_hard_goal_state/);
  assert.match(dot, /resolve_hard_goal_state\s*->\s*admission_check/);
  assert.match(dot, /admission_check\s*->\s*admission_gate/);
  assert.match(dot, /admission_gate -> fail_duplicate_admission \[condition="goal_admission_allowed!=true"\]/);
  assert.match(dot, /easy_execution_gate\s*\[shape="diamond" label="Direct easy execution\?"\]/);
  assert.match(dot, /execute_easy_goal\s*\[type="pipeline"[\s\S]*?pipeline="factories\/mothership\/workflows\/goal-execution\/goal_execute\.workflow-source\.mjs"/);
  assert.match(dot, /set_goal_execution_mode_direct\s*->\s*clear_direct_execution_reason/);
  assert.match(dot, /clear_direct_execution_reason\s*->\s*execute_easy_goal/);
  assert.match(dot, /execute_easy_goal\s*->\s*set_empty_issue_urls/);
  assert.match(dot, /set_empty_issue_urls\s*->\s*direct_execution_result_gate/);
  assert.match(dot, /direct_execution_result_gate\s*->\s*mark_dispatched\s*\[condition="__composite_reason!=child_failed"\]/);
  assert.match(dot, /direct_execution_result_gate\s*->\s*keep_open_direct\s*\[condition="__composite_reason=child_failed"\]/);
});

test("goal_run never reclassifies execution path after packet resolution", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /resolve_execution_path\s*\[type="tool"/);
  assert.doesNotMatch(dot, /goal execution-path classify/);
  assert.match(dot, /resolve_execution_path\s*->\s*resolve_hard_goal_state/);
  assert.match(dot, /resolve_hard_goal_state\s*->\s*admission_check/);
  assert.match(dot, /admission_check\s*->\s*admission_gate/);
  assert.match(dot, /admission_gate -> fail_duplicate_admission \[condition="goal_admission_allowed!=true"\]/);
});

test("goal_run flows through deterministic post-processing to close computation (triage eliminated)", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /intake_decompose\s*->\s*append_rationale_feature/);
  assert.match(dot, /append_rationale_feature\s*->\s*issues/);
  assert.match(dot, /issues\s*->\s*count_approved_features/);
  assert.match(dot, /count_approved_features\s*->\s*count_issues/);
  assert.match(dot, /count_issues\s*->\s*decomposition_feature_gate/);
  assert.match(dot, /decomposition_feature_gate -> decomposition_issue_gate \[condition="approved_feature_count!=0"\]/);
  assert.match(dot, /decomposition_feature_gate -> keep_open \[condition="approved_feature_count=0"\]/);
  assert.match(dot, /decomposition_issue_gate -> encode_goal_issue_b64 \[condition="issue_count!=0"\]/);
  assert.match(dot, /decomposition_issue_gate -> keep_open \[condition="issue_count=0"\]/);
  assert.match(dot, /encode_goal_issue_b64\s*->\s*encode_goal_context_b64/);
  assert.match(dot, /encode_goal_context_b64\s*->\s*encode_approved_features_b64/);
  assert.match(dot, /encode_approved_features_b64\s*->\s*encode_issue_urls_b64/);
  assert.match(dot, /encode_issue_urls_b64\s*->\s*persist_decomposition_packet/);
  assert.match(dot, /persist_decomposition_packet\s*->\s*normalize_issue_index/);
  assert.match(dot, /normalize_issue_index\s*->\s*zip_feature_map/);
  assert.match(dot, /zip_feature_map\s*->\s*resolve_deps/);
  assert.match(dot, /resolve_deps\s*->\s*label_issues/);
  assert.match(dot, /label_issues\s*->\s*apply_feature_blockers/);
  assert.match(dot, /apply_feature_blockers\s*->\s*compute_close/);
  assert.match(dot, /compute_close\s*->\s*decide_close/);
  assert.match(dot, /materialize_hard_plan\s*->\s*approved_hard_plan_resume/);
  assert.match(dot, /approved_hard_plan_resume\s*->\s*encode_goal_issue_b64/);
  assert.match(dot, /persist_decomposition_packet[\s\S]*action_id="goal\.persist_decomposition_packet"/);
  assert.doesNotMatch(dot, /triage_milestone_gate/);
  assert.doesNotMatch(dot, /milestone_gate/);
  // Triage pipeline removed
  assert.doesNotMatch(dot, /capability-triage/);
  assert.doesNotMatch(dot, /count_triaged/);

  // Irreversible deterministic post-processing nodes
  assert.match(dot, /resolve_deps\s*\[type="tool" governance="irreversible"/);
  assert.match(dot, /resolve_deps[\s\S]*action_id="triage\.resolve_feature_dependencies"/);
  assert.match(dot, /label_issues\s*\[type="tool" governance="irreversible"/);
  assert.match(dot, /label_issues[\s\S]*action_id="goal\.label_created_issues"/);
  assert.match(dot, /apply_feature_blockers\s*\[type="tool" governance="irreversible"/);
  assert.match(dot, /apply_feature_blockers[\s\S]*action_id="goal\.apply_feature_blockers"/);
});

test("goal_run does not persist decomposition packets for empty decomposition output", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /count_issues -> decomposition_feature_gate/);
  assert.match(dot, /decomposition_feature_gate\s*\[shape="diamond" label="Approved features created\?"\]/);
  assert.match(dot, /decomposition_issue_gate\s*\[shape="diamond" label="Issues created\?"\]/);
  assert.match(dot, /decomposition_feature_gate -> keep_open \[condition="approved_feature_count=0"\]/);
  assert.match(dot, /decomposition_issue_gate -> keep_open \[condition="issue_count=0"\]/);
  assert.doesNotMatch(dot, /count_issues -> compute_close/);
});

// ────────────────────────────────────────────────────────────
// Gate: decompose retry budget exists before intake_decompose
// Prevents infinite retry loop on permanent failures.
// ────────────────────────────────────────────────────────────
test("goal_run has decompose retry budget gate before intake_decompose", () => {
  const dot = readFileSync(dotPath, "utf8");

  // Must have a retry-counting tool node
  assert.match(
    dot,
    /check_decompose_retries\s*\[type="tool"/,
    "goal_run must have a check_decompose_retries tool node"
  );

  // Must use deterministic ops CLI
  assert.match(
    dot,
    /check_decompose_retries[\s\S]*?action_id="goal\.count_decompose_attempts"/,
    "check_decompose_retries must use the typed count-decompose-attempts owner"
  );

  // Must have a diamond gate for retry budget
  assert.match(
    dot,
    /decompose_retry_gate\s*\[shape="diamond"/,
    "goal_run must have a decompose_retry_gate diamond"
  );

  assert.match(
    dot,
    /current_decompose_attempt\s*\[type="tool"/,
    "goal_run must derive the current attempt number from prior retry history"
  );

  assert.match(
    dot,
    /current_decompose_attempt[\s\S]*?action_id="common\.increment_counter"[\s\S]*action_value="\$\{decompose_retry_count\}"/,
    "goal_run retry comments must use the outer retry counter, not the intake subgraph loop counter"
  );
});

// ────────────────────────────────────────────────────────────
// Gate: retry budget gate routes to intake_decompose or exhaust
// ────────────────────────────────────────────────────────────
test("decompose_retry_gate routes correctly", () => {
  const dot = readFileSync(dotPath, "utf8");

  // Under budget → mark_decompose_attempt → intake_decompose
  assert.match(
    dot,
    /decompose_retry_gate\s*->\s*mark_decompose_attempt/,
    "under-budget path must go to mark_decompose_attempt"
  );
  assert.match(
    dot,
    /mark_decompose_attempt\s*->\s*intake_decompose/,
    "mark_decompose_attempt must connect to intake_decompose"
  );

  // Over budget → exhaust node
  assert.match(
    dot,
    /decompose_retry_gate\s*->\s*exhaust_decompose_retries/,
    "over-budget path must go to exhaust_decompose_retries"
  );
});

test("mark_decompose_attempt posts attempt marker via goal post-decompose-attempt", () => {
  const dot = readFileSync(dotPath, "utf8");
  const markMatch = dot.match(/mark_decompose_attempt\s*\[[\s\S]*?\]\s*(?=\n\s*\n|\n\s*\w|\n\s*start)/);
  assert.ok(markMatch, "mark_decompose_attempt node must exist in goal_run.dot");
  assert.match(
    markMatch[0],
    /action_id="goal\.post_decompose_attempt"/,
    "mark_decompose_attempt must use the typed decompose-attempt owner"
  );
});

// ────────────────────────────────────────────────────────────
// Gate: exhaust_decompose_retries must leave labels unchanged because
// decomposition failure is a factory bug, not goal state.
// ────────────────────────────────────────────────────────────
test("exhaust_decompose_retries routes through the typed exhaustion owner without label mutation", () => {
  const dot = readFileSync(dotPath, "utf8");
  const exhaustMatch = dot.match(/exhaust_decompose_retries\s*\[[\s\S]*?\]\s*(?=\n\s*\n|\n\s*\w|\n\s*start)/);
  assert.ok(exhaustMatch, "exhaust_decompose_retries node must exist");

  assert.match(
    exhaustMatch[0],
    /action_id="goal\.exhaust_decompose_retries"/,
    "exhaust must route through the typed decompose-retry exhaustion owner"
  );
});

test("goal_run retry comments use goal ops commands without inline shell glue", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /action_id="goal\.post_retry_comment"/);
  assert.match(dot, /action_decompose_attempts="\$\{decompose_attempt_number\}"/);
  assert.doesNotMatch(dot, /action_decompose_attempts="\$\{decompose_attempts\}"/);
  assert.doesNotMatch(dot, /save_triage_plan/);
  assert.doesNotMatch(dot, /mktemp/);
  assert.doesNotMatch(dot, /body-file/);
  assert.doesNotMatch(dot, /post-closure-comment/);
});

test("goal_run close condition requires created issues to cover approved features", () => {
  const dot = readFileSync(dotPath, "utf8");
  const computeCloseMatch = dot.match(/compute_close\s*\[[\s\S]*?\]\s*(?=\n\s*\n|\n\s*\w|\n\s*start)/);
  assert.ok(computeCloseMatch, "compute_close node must exist");
  assert.match(computeCloseMatch[0], /action_id="goal\.compute_close_condition"/);
  assert.match(computeCloseMatch[0], /action_issue_count="\$\{issue_count\}"/);
  assert.match(computeCloseMatch[0], /action_approved_feature_count="\$\{approved_feature_count\}"/);
  assert.doesNotMatch(computeCloseMatch[0], /--triage-count/);
  assert.doesNotMatch(computeCloseMatch[0], /--triage-plan/);
});

// ────────────────────────────────────────────────────────────
// Unit: countDecomposeAttempts counts marker comments
// ────────────────────────────────────────────────────────────
test("countDecomposeAttempts returns 0 for no matching comments", () => {
  const count = countDecomposeAttempts({
    comments: [
      { body: "Some unrelated comment" },
      { body: "Another comment" },
    ],
  });
  assert.equal(count, 0);
});

test("countDecomposeAttempts counts goal-run:decompose-attempt markers", () => {
  const count = countDecomposeAttempts({
    comments: [
      { body: "<!-- goal-run:decompose-attempt -->\nDecompose attempt 1 starting." },
      { body: "Unrelated comment" },
      { body: "<!-- goal-run:decompose-attempt -->\nDecompose attempt 2 starting." },
    ],
  });
  assert.equal(count, 2);
});

test("countDecomposeAttemptsFromIssue resets exhausted retry budget when ready is re-added", () => {
  const count = countDecomposeAttemptsFromIssue({
    issue: {
      labels: [
        { name: "goal" },
        { name: "ready" },
      ],
      comments: [
        { body: "<!-- goal-run:decompose-attempt -->\nDecompose attempt 1 starting." },
        { body: "<!-- goal-run:decompose-attempt -->\nDecompose attempt 2 starting." },
        { body: "<!-- goal-run:decompose-attempt -->\nDecompose attempt 3 starting." },
        {
          body: [
            "<!-- goal-run:decompose-exhausted -->",
            "Decompose retry budget exhausted (3 attempts).",
            "Leaving labels unchanged because decomposition failure is a factory bug, not goal state.",
            "Fix the factory path and retry without mutating workflow labels.",
          ].join("\n"),
        },
      ],
    },
  });

  assert.equal(
    count,
    0,
    "operator re-adding ready after an exhausted run must reset the retry counter for the next fixed attempt"
  );
});

test("countDecomposeAttemptsFromIssue counts attempts after the latest exhaustion marker", () => {
  const count = countDecomposeAttemptsFromIssue({
    issue: {
      labels: [
        { name: "goal" },
        { name: "ready" },
      ],
      comments: [
        { body: "<!-- goal-run:decompose-attempt -->\nDecompose attempt 1 starting." },
        { body: "<!-- goal-run:decompose-attempt -->\nDecompose attempt 2 starting." },
        { body: "<!-- goal-run:decompose-attempt -->\nDecompose attempt 3 starting." },
        {
          body: [
            "<!-- goal-run:decompose-exhausted -->",
            "Decompose retry budget exhausted (3 attempts).",
            "Leaving labels unchanged because decomposition failure is a factory bug, not goal state.",
            "Fix the factory path and retry without mutating workflow labels.",
          ].join("\n"),
        },
        { body: "<!-- goal-run:decompose-attempt -->\nDecompose attempt 1 starting." },
        {
          body: [
            "<!-- goal-run:decompose-retry -->",
            "Goal run did not produce an executable issue flow this tick.",
            "approved_features=0",
            "issues_created=0",
            "decompose_approved=false",
            "decompose_attempts=1",
            "decompose_parse_status=empty_array",
            "decompose_parse_source=primary",
            "Keeping ready label for bounded retry on next tick.",
          ].join("\n"),
        },
      ],
    },
  });

  assert.equal(
    count,
    1,
    "after an exhausted run is retried, only attempt markers after the latest exhaustion marker should count toward the new budget"
  );
});

test("countDecomposeAttempts returns 0 for empty comments", () => {
  assert.equal(countDecomposeAttempts({ comments: [] }), 0);
  assert.equal(countDecomposeAttempts({ comments: null }), 0);
  assert.equal(countDecomposeAttempts({}), 0);
});

test("countDecomposeAttemptsFromIssue counts attempt markers regardless of ready label", () => {
  const count = countDecomposeAttemptsFromIssue({
    issue: {
      labels: [{ name: "goal" }, { name: "ready" }],
      comments: [
        { body: "<!-- goal-run:decompose-attempt -->\nDecompose attempt 1 starting." },
        { body: "<!-- goal-run:decompose-attempt -->\nDecompose attempt 2 starting." },
      ],
    },
  });
  assert.equal(count, 2);
});

test("countDecomposeAttemptsFromIssue counts attempts regardless of unrelated labels", () => {
  const count = countDecomposeAttemptsFromIssue({
    issue: {
      labels: [{ name: "goal" }, { name: "ready" }, { name: "human" }],
      comments: [
        { body: "<!-- goal-run:decompose-attempt -->\nDecompose attempt 1 starting." },
      ],
    },
  });
  assert.equal(count, 1);
});
