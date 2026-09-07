import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dotPath = "docs/contracts/workflow-ir/mothership/wave_issue_execute.dot";
const supervisorDotPath = "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test("wave_issue_execute invokes wave-issue commands via direct subcommands (no run --op)", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.doesNotMatch(dot, /wave-issue run --op/);
});

test("factory_supervisor_tick includes emit_review_metrics_summary node", () => {
  const dot = readFileSync(supervisorDotPath, "utf8");
  assert.match(dot, /emit_review_metrics_summary\s*\[/);
  assert.match(dot, /emit_review_metrics_summary\s*\[[\s\S]*?governance="reversible"/);
  assert.match(dot, /emit_review_metrics_summary\s*\[[\s\S]*?label="Emit review metrics summary"/);
  assert.match(dot, /emit_review_metrics_summary\s*\[[\s\S]*?output_key="review_metrics_summary"/);
  assert.match(dot, /emit_review_metrics_summary\s*\[[\s\S]*?action_id="factory\.review_metrics"/);
  assert.match(dot, /emit_review_metrics_summary\s*\[[\s\S]*?action_lookback_hours="1"/);
  assert.match(dot, /emit_disposition_feedback -> emit_review_metrics_summary/);
  assert.doesNotMatch(dot, /spawn_goal_execute -> emit_review_metrics_summary/);
  assert.doesNotMatch(dot, /goal_execute_gate -> emit_review_metrics_summary \[condition="count=0"\]/);
  assert.match(dot, /emit_review_metrics_summary -> evaluate_external_factory_lifecycle/);
});

test("wave_issue_execute keeps reviewer semantic and strips deterministic reviewer gates", () => {
  const dot = readFileSync(dotPath, "utf8");
  // Retry loop control remains bounded, but reviewer semantics drive revisions.
  assert.match(dot, /set_max_review_attempts/);
  assert.match(dot, /load_intent_stack/);
  assert.match(dot, /should_retry_review/);
  assert.match(dot, /retry_gate -> snapshot_head \[condition="retry_review=true"\]/);
  assert.match(dot, /retry_gate -> report_retry_failed \[condition="retry_review!=true"\]/);
  // Review prompt explicitly frames semantic review and carries issue/goal/wave/evidence/worktree context.
  assert.match(dot, /semantic code reviewer for issue completion in this wave/);
  assert.match(dot, /Intent stack JSON:/);
  assert.match(dot, /\$\{intent_stack\}/);
  assert.match(dot, /Code review is not QA/);
  assert.match(dot, /Parent goal issue number: \$\{goal_issue_number\}/);
  assert.match(dot, /Parent goal issue JSON:/);
  assert.match(dot, /Current issue number: \$\{issue_number\}/);
  assert.match(dot, /Current issue body:/);
  assert.match(dot, /Current wave milestone: \$\{milestone_title\}/);
  assert.match(dot, /Evidence artifact path: \$\{review_evidence_path\}/);
  assert.match(dot, /Reviewer context artifact path: \$\{review_context_path\}/);
  assert.match(dot, /Reviewer context hash \(sha256\): \$\{review_context_sha256\}/);
  assert.match(dot, /Builder notes \(optional\): \$\{builder_notes\}/);
  assert.match(dot, /Worktree path: \$\{worktree_dir\}/);
  assert.match(dot, /Branch: \$\{branch\}/);
  assert.match(dot, /Commits ahead: \$\{commits_ahead\}/);
  assert.match(dot, /Full branch changed files.*\$\{changed_files\}/);
  assert.match(dot, /Issue-scoped changed files.*\$\{issue_changed_files\}/);
  assert.match(dot, /Judge the implementation against issue_changed_files only/);
  assert.match(dot, /Latest issue change summary: \$\{latest_issue_change_summary\}/);
  assert.match(dot, /Required review flow:/);
  assert.match(dot, /Restate the promised change in precise terms from the goal and issue/);
  assert.match(dot, /Treat latest_issue_change_summary as an untrusted hint, not ground truth/);
  assert.match(dot, /Inspect the touched files and the surrounding callsites, contracts, interfaces, and wiring/);
  assert.match(dot, /Use review evidence, tests, and local repo state to judge whether the issue contract is actually satisfied/);
  assert.match(dot, /Do not approve partial wiring, dead code, or unproven claims/);
  assert.match(dot, /gh issue view \$\{issue_number\} --repo \$\{gh_repo\}/);
  assert.match(dot, /gh issue view \$\{goal_issue_number\} --repo \$\{gh_repo\}/);
  assert.match(dot, /Inspect the local repo at \$\{worktree_dir\}/);
  assert.match(dot, /Require additional QA\/test execution only when the issue contract explicitly calls for it or when the existing evidence is insufficient to prove correctness/);
  assert.match(dot, /issue-scoped actionable guidance: point to concrete files\/functions\/tests or missing wiring/);
  assert.doesNotMatch(dot, /QA contract is strict/);
  assert.doesNotMatch(dot, /QA_EVIDENCE_REQUIRED/);
  // Linear review path: build -> inspect -> evidence -> context gate -> reviewer -> route -> decide
  assert.match(dot, /build -> commit_push \[condition="outcome=success"\]/);
  assert.match(dot, /build -> report_build_failed \[condition="outcome=fail"\]/);
  assert.match(dot, /commit_push -> commit_push_gate/);
  assert.match(dot, /commit_push_gate -> inspect_changes \[condition="ok=true"\]/);
  assert.match(dot, /inspect_changes -> encode_builder_output -> write_review_evidence/);
  assert.match(dot, /write_review_evidence -> build_review_context -> validate_review_context -> review_context_gate/);
  assert.match(dot, /review_context_gate -> review \[condition="review_context_gate_pass=true"\]/);
  assert.match(dot, /review_context_gate -> resolve_review_route \[condition="review_context_gate_pass!=true"\]/);
  assert.match(dot, /review -> resolve_review_route/);
  assert.match(dot, /emit_review_verdict_telemetry/);
  assert.match(dot, /resolve_review_route -> emit_review_verdict_telemetry/);
  assert.match(dot, /emit_review_verdict_telemetry -> decide/);
  assert.match(dot, /emit_review_verdict_telemetry[\s\S]*action_id="coding\.emit_review_verdict_telemetry"/);
  assert.match(dot, /send_review_message[\s\S]*action_id="coding\.send_review_message"/);
  assert.match(dot, /revise_attempt -> send_review_message -> bump_revise/);
  assert.match(dot, /should_retry_review[\s\S]*action_id="coding\.should_retry_review"/);
  assert.match(dot, /should_retry_review[\s\S]*action_review_verdict="\$\{disposition\}"/);
  assert.match(dot, /should_retry_review[\s\S]*action_attempt="\$\{review_attempt\}"/);
  assert.match(dot, /should_retry_review[\s\S]*action_max_attempts="\$\{max_review_attempts\}"/);
  assert.match(dot, /resolve_goal_number/);
  assert.match(dot, /fetch_goal_issue/);
  assert.doesNotMatch(dot, /load_review_skill/);
  assert.doesNotMatch(dot, /load_review_repo/);
  assert.doesNotMatch(dot, /\$\{judge_context_scope_identity\}/);
  assert.doesNotMatch(dot, /\$\{review_skill_content\}/);
  assert.doesNotMatch(dot, /\$\{review_repo_content\}/);
  assert.match(dot, /Load the local code review skill by reading BOTH:/);
  assert.match(dot, /\$\{capability_coding_skills\}\/code_review\/SKILL\.md/);
  assert.match(dot, /\$\{capability_coding_skills\}\/code_review\/REPO\.md/);
  assert.match(dot, /Treat the reviewer context artifact as the canonical, versioned contract/);
  assert.match(dot, /effective_policy\.values\.review\.route_override/);
  assert.match(dot, /REVIEW_CONTEXT_INVALID/);
  assert.match(dot, /build_review_context/);
  assert.match(dot, /validate_review_context/);
  assert.match(dot, /review_context_gate/);
  assert.match(dot, /resolve_review_route/);
  assert.match(dot, /resolve_review_route[\s\S]*action_id="coding\.resolve_review_route"/);
  assert.doesNotMatch(dot, /read_zero_delta_before/);
  assert.doesNotMatch(dot, /load_latest_review_evidence/);
  assert.doesNotMatch(dot, /done_elsewhere_gate/);
  assert.doesNotMatch(dot, /report_done_elsewhere/);
  assert.doesNotMatch(dot, /validate_zero_delta/);
  assert.doesNotMatch(dot, /zero_delta_gate/);
  assert.doesNotMatch(dot, /zero_delta_revise/);
  assert.doesNotMatch(dot, /fallback-review-from-json/);
  assert.doesNotMatch(dot, /ensure_review_decision/);
  assert.doesNotMatch(dot, /set-retry-decision/);
  assert.doesNotMatch(dot, /qa_infra_rerun/);
  assert.doesNotMatch(dot, /qa_infra_gate/);
  // Review output schema is inherited from reviewer role stylesheet.
  assert.match(dot, /review\s*\[class="reviewer"/);
  const roles = readFileSync("factories/mothership/roles.stylesheet", "utf8");
  const sharedRoles = readFileSync("factories/_shared/roles.stylesheet", "utf8");
  assert.match(roles, /\.reviewer[\s\S]*trust_role = "mothership\.local\.codergen"/);
  assert.match(
    sharedRoles,
    /\.reviewer[\s\S]*outputs = "disposition,confidence,recommended_transition,reason_codes,notes,verdict"/
  );
  assert.match(dot, /REVIEW_OUTPUT_SCHEMA_INVALID/);
});

test("code_review skill files referenced by reviewer prompt are non-empty", () => {
  const skillMd = join(repoRoot, "packages/factory-skills/skills/code_review/SKILL.md");
  const repoMd = join(repoRoot, "packages/factory-skills/skills/code_review/REPO.md");
  assert.ok(existsSync(skillMd), "SKILL.md must exist");
  assert.ok(existsSync(repoMd), "REPO.md must exist");
  assert.ok(readFileSync(skillMd, "utf8").trim().length > 0, "SKILL.md must be non-empty");
  assert.ok(readFileSync(repoMd, "utf8").trim().length > 0, "REPO.md must be non-empty");
});

test("wave_issue_execute: write_review_evidence must not pass issue_body as shell arg", () => {
  const dot = readFileSync(dotPath, "utf8");
  // issue_body contains arbitrary user text (newlines, quotes, shell metacharacters).
  // Passing it as a CLI --arg breaks shell parsing and swallows subsequent args
  // like --review-qa-command, causing QA evidence to always report qa.command="".
  const writeNode = dot.match(/write_review_evidence\s*\[[\s\S]*?\]/);
  assert.ok(writeNode, "write_review_evidence node must exist");
  assert.doesNotMatch(
    writeNode[0],
    /--issue-body/,
    "write_review_evidence must NOT pass --issue-body as CLI arg (shell-unsafe for multi-line content)"
  );
  assert.doesNotMatch(
    writeNode[0],
    /--issue-title/,
    "write_review_evidence must NOT pass --issue-title as CLI arg (may contain quotes)"
  );
  // Must still produce review_evidence_path and now also issue_changed_files
  assert.match(writeNode[0], /outputs="review_evidence_path,builder_notes,issue_changed_files"/);
  assert.match(writeNode[0], /action_builder_notes_b64="\$\{builder_output_b64\}"/);
});

test("wave_issue_execute uses snapshot/revert for deferred merge (no inline merge)", () => {
  const dot = readFileSync(dotPath, "utf8");
  // Must have snapshot and revert nodes
  assert.match(dot, /snapshot_head/);
  assert.match(dot, /snapshot_head[\s\S]*outputs="snapshot_sha"/);
  assert.match(dot, /snapshot_head[\s\S]*action_existing_snapshot="\$\{snapshot_sha\}"/);
  assert.match(dot, /report_approved/);
  assert.match(dot, /report_build_failed/);
  assert.match(dot, /report_retry_failed/);
  assert.match(dot, /report_build_failed[\s\S]*action_id="coding\.build_failed_result"/);
  assert.match(dot, /report_retry_failed[\s\S]*action_id="coding\.build_failed_result"/);
  // No revert or give_up terminals
  assert.doesNotMatch(dot, /revert_failed_issue/);
  assert.doesNotMatch(dot, /give_up/);
  // Must NOT have inline merge nodes
  assert.doesNotMatch(dot, /rebase_on_main/);
  assert.doesNotMatch(dot, /attempt_merge/);
  assert.doesNotMatch(dot, /inline_merge_gate/);
  assert.doesNotMatch(dot, /report_merged/);
  assert.doesNotMatch(dot, /report_deferred/);
  assert.doesNotMatch(dot, /close_issue/);
  // Approve goes to report_approved (deferred merge)
  assert.match(dot, /bump_approve -> report_approved/);
  // Exhausted retries and system failures produce a failed impl result instead of merging.
  assert.match(dot, /retry_gate -> report_retry_failed \[condition="retry_review!=true"\]/);
  assert.match(dot, /build -> report_build_failed \[condition="outcome=fail"\]/);
  assert.doesNotMatch(dot, /emit_review_fallback_defect/);
});

test("wave_issue_execute: set_issue_context replaces extract_issue (no issue_item dependency)", () => {
  const dot = readFileSync(dotPath, "utf8");
  // extract_issue removed — set_issue_context maps next_issue_number/next_issue_title to issue_number/issue_title
  assert.doesNotMatch(dot, /extract_issue/);
  assert.doesNotMatch(dot, /issue_item/);
  assert.match(dot, /set_issue_context/);
  assert.match(dot, /set_issue_context[\s\S]*action_id="coding\.set_issue_context"/);
  assert.match(dot, /set_issue_context[\s\S]*action_issue_number="\$\{next_issue_number\}"/);
  assert.match(dot, /set_issue_context[\s\S]*action_issue_title="\$\{next_issue_title\}"/);
  assert.match(dot, /outputs="issue_number,issue_title"/);
  assert.match(dot, /start -> set_issue_context -> fetch_issue -> resolve_goal_number -> fetch_goal_issue -> load_intent_stack -> estimate_complexity -> complexity_gate/);
});

test("wave_issue_execute inserts deterministic complexity routing after issue fetch", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /estimate_complexity/);
  assert.match(dot, /output_key="complexity_estimate"/);
  assert.match(dot, /outputs="complexity_class,complexity_signals,complexity_reason,complexity_otel_key"/);
  assert.match(dot, /Complexity estimate:\\n\$\{complexity_estimate\}/);
  assert.match(dot, /estimate_complexity[\s\S]*action_id="coding\.estimate_issue_complexity"/);
  assert.match(dot, /estimate_complexity[\s\S]*action_issue_title="\$\{issue_title\}"/);
  assert.match(dot, /estimate_complexity[\s\S]*action_issue_body="\$\{issue_body\}"/);
  assert.match(dot, /complexity_gate \[shape=diamond label="Complexity class route"\]/);
  assert.match(dot, /complexity_gate -> route_high_complexity \[condition="complexity_class=high"\]/);
  assert.match(dot, /complexity_gate -> route_non_high_complexity \[condition="complexity_class!=high"\]/);
  assert.match(dot, /route_non_high_complexity -> route_medium_complexity \[condition="complexity_class=medium"\]/);
  assert.match(dot, /route_non_high_complexity -> route_default_complexity \[condition="complexity_class!=medium"\]/);
  assert.match(dot, /route_high_complexity -> init/);
  assert.match(dot, /route_medium_complexity -> init/);
  assert.match(dot, /route_default_complexity -> init/);
});

test("wave_issue_execute builder prompt frames wave and parent goal but keeps implementation scoped to current issue", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /Intent stack JSON:\\n\$\{intent_stack\}/);
  assert.match(dot, /You are working inside wave \$\{milestone_title\} on a shared wave branch and shared coding session\./);
  assert.match(dot, /Parent goal: #\$\{goal_issue_number\}/);
  assert.match(dot, /Parent goal issue JSON:\\n\$\{goal_issue\}/);
  assert.match(dot, /Do not implement the whole goal in this pass\. Implement only the current issue first\./);
  assert.match(dot, /Current implementation issue #\$\{issue_number\}: \$\{issue_title\}/);
});

test("wave_issue_execute: ceremony nodes removed (report_existing, init_review_attempt, prepare_existing_attempt)", () => {
  const dot = readFileSync(dotPath, "utf8");
  // report_existing folded into decide_existing_reuse
  assert.doesNotMatch(dot, /report_existing/);
  // init_review_attempt folded into set_max_review_attempts
  assert.doesNotMatch(dot, /init_review_attempt/);
  // prepare_existing_attempt removed entirely
  assert.doesNotMatch(dot, /prepare_existing_attempt/);
  // decide_existing_reuse now outputs JSON with both reuse_existing_commits and review_notes
  assert.match(dot, /decide_existing_reuse[\s\S]*outputs="reuse_existing_commits,review_notes"/);
  assert.match(dot, /decide_existing_reuse[\s\S]*action_id="coding\.decide_existing_reuse_with_notes"/);
  // set_max_review_attempts now outputs both max_review_attempts and review_attempt
  assert.match(dot, /set_max_review_attempts[\s\S]*outputs="max_review_attempts,review_attempt"/);
  assert.match(dot, /set_max_review_attempts[\s\S]*action_id="coding\.resolve_max_review_attempts"/);
});

test("wave_issue_execute always writes review evidence before semantic review", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /inspect_changes -> encode_builder_output -> write_review_evidence/);
  assert.match(dot, /write_review_evidence -> build_review_context -> validate_review_context -> review_context_gate/);
  assert.doesNotMatch(dot, /ensure_review_decision/);
  assert.doesNotMatch(dot, /fallback-review-from-json/);
});

test("wave_issue_execute: both reuse=true and fresh build paths converge at set_max_review_attempts", () => {
  const dot = readFileSync(dotPath, "utf8");
  // reuse=true goes directly to set_max_review_attempts (no report_existing intermediary)
  assert.match(dot, /existing_gate -> set_max_review_attempts \[condition="reuse_existing_commits=true"\]/);
  // fresh build path goes through resolve_mode -> mode_gate -> set_max_review_attempts
  assert.match(dot, /mode_gate -> set_max_review_attempts \[condition="execution_mode!=smoke"\]/);
  // set_max_review_attempts leads directly into snapshot/build loop
  assert.match(dot, /set_max_review_attempts -> snapshot_head/);
  assert.match(dot, /snapshot_head -> build/);
});

test("wave_issue_execute low-path skip wiring still runs reviewer context contract only on non-smoke path", () => {
  const dot = readFileSync(dotPath, "utf8");
  assert.match(dot, /mode_gate -> smoke_skip \[condition="execution_mode=smoke"\]/);
  assert.match(dot, /mode_gate -> set_max_review_attempts \[condition="execution_mode!=smoke"\]/);
  assert.match(dot, /snapshot_head -> build/);
  assert.match(dot, /write_review_evidence -> build_review_context -> validate_review_context -> review_context_gate/);
  assert.doesNotMatch(dot, /smoke_skip -> build_review_context/);
  assert.doesNotMatch(dot, /smoke_skip -> validate_review_context/);
});

test("wave_issue_execute has setup_gate after setup that routes to report_setup_failed on failure", () => {
  const dot = readFileSync(dotPath, "utf8");
  // Gate node exists
  assert.match(dot, /setup_gate \[shape=diamond/);
  // setup routes to gate, not directly to ensure_toolchain
  assert.match(dot, /setup -> setup_gate/);
  assert.doesNotMatch(dot, /setup -> ensure_toolchain/);
  // Gate routes on success and failure
  assert.match(dot, /setup_gate -> ensure_toolchain \[condition="setup=true"\]/);
  assert.match(dot, /setup_gate -> report_setup_failed \[condition="setup!=true"\]/);
  // Infra failure terminal exists and routes to done
  assert.match(dot, /report_setup_failed\s*\[/);
  assert.match(dot, /report_setup_failed -> done/);
  // Uses infra-failure-result command with disposition=infra_failure semantics
  assert.match(dot, /report_setup_failed[\s\S]*action_id="coding\.build_infra_failure_result"/);
});
