import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dotPath = "docs/contracts/workflow-ir/capability-coding/issue_execute_item.dot";

function loadDot() {
  return readFileSync(dotPath, "utf8");
}

test("issue_execute_item invokes goal-issue commands via direct subcommands (no run --op)", () => {
  const dot = loadDot();
  assert.doesNotMatch(dot, /goal-issue run --op/);
});

test("issue_execute_item commandizes setup/review bookkeeping via goal-issue ops commands", () => {
  const dot = loadDot();

  assert.match(dot, /extract_issue[\s\S]*action_runtime="in_process" action_id="coding\.extract_issue_item"/);
  assert.match(dot, /init[\s\S]*action_runtime="in_process" action_id="coding\.init_wave_issue_worktree"/);
  assert.match(dot, /setup[\s\S]*action_runtime="in_process" action_id="coding\.setup_wave_issue_worktree"/);
  assert.match(dot, /init_review[\s\S]*action_runtime="in_process" action_id="coding\.init_review_attempt"/);
  assert.match(dot, /snapshot_head[\s\S]*action_runtime="in_process" action_id="coding\.snapshot_branch_head"/);
  assert.match(dot, /commit_push[\s\S]*action_runtime="in_process" action_id="coding\.commit_local"/);
  assert.match(dot, /inspect_changes[\s\S]*action_runtime="in_process" action_id="coding\.inspect_branch_changes"/);
  assert.match(dot, /encode_builder_output[\s\S]*action_runtime="in_process" action_id="common\.encode_base64"/);
  assert.match(dot, /write_review_evidence[\s\S]*action_runtime="in_process" action_id="coding\.write_review_evidence"[\s\S]*action_snapshot_sha="\$\{snapshot_sha\}" action_builder_notes_b64="\$\{builder_output_b64\}"/);
  assert.match(dot, /build_review_context[\s\S]*action_runtime="in_process" action_id="coding\.build_review_context"/);
  assert.match(dot, /validate_review_context[\s\S]*action_runtime="in_process" action_id="coding\.validate_review_context"/);
});

test("issue_execute_item keeps output/edge retry contract unchanged", () => {
  const dot = loadDot();
  assert.match(dot, /extract_issue[\s\S]*outputs="issue_number,issue_title"/);
  assert.match(dot, /init[\s\S]*outputs="branch,worktree_dir"/);
  assert.match(dot, /init_review[\s\S]*output_key="review_attempt"/);
  assert.match(dot, /inc_review[\s\S]*output_key="review_attempt"/);
  assert.match(dot, /build_review_context[\s\S]*outputs="review_context_path,review_context_sha256,review_context_valid,review_context_error"/);
  assert.match(dot, /validate_review_context[\s\S]*outputs="review_context_gate_pass,review_context_gate_code,review_context_error,disposition,confidence,recommended_transition,reason_codes,notes,verdict"/);
  assert.match(dot, /resolve_review_route[\s\S]*outputs="disposition,confidence,recommended_transition,reason_codes,notes,route_reason,verdict"/);
  assert.match(dot, /resolve_review_route[\s\S]*action_runtime="in_process" action_id="coding\.resolve_review_route"/);
  assert.match(dot, /review\s*\[class="reviewer"/);

  assert.match(dot, /policy_sources/);
  assert.match(dot, /effective_policy/);
  assert.match(dot, /REVIEW_CONTEXT_INVALID/);
  assert.match(dot, /REVIEW_OUTPUT_SCHEMA_INVALID/);

  assert.match(dot, /start -> extract_issue -> set_gh_repo -> fetch_issue -> resolve_milestone -> resolve_goal_number -> fetch_goal_issue -> load_intent_stack -> init -> setup -> init_review -> snapshot_head -> build/);
  assert.match(dot, /build -> commit_push -> inspect_changes -> encode_builder_output -> write_review_evidence -> build_review_context -> validate_review_context -> review_context_gate/);
  assert.match(dot, /review_context_gate -> review \[condition="review_context_gate_pass=true"\]/);
  assert.match(dot, /review_context_gate -> resolve_review_route \[condition="review_context_gate_pass!=true"\]/);
  assert.match(dot, /review -> resolve_review_route/);
  assert.match(dot, /resolve_review_route -> decide/);
  assert.doesNotMatch(dot, /review_context_gate -> review \[condition="review_context_gate_pass!=true"\]/);
  assert.doesNotMatch(dot, /review_context_gate -> decide/);
  assert.match(dot, /decide -> inc_review \[condition="disposition!=approve" label="revise"\]/);
  assert.match(dot, /check_attempt -> snapshot_head \[condition="review_attempt<3"\]/);
  assert.match(dot, /check_attempt -> give_up \[condition="review_attempt>=3" label="give-up"\]/);
});

test("issue_execute_item reviewer prompt carries full semantic context packet", () => {
  const dot = loadDot();

  assert.match(dot, /resolve_goal_number/);
  assert.match(dot, /fetch_goal_issue/);
  assert.match(dot, /load_intent_stack/);
  assert.match(dot, /inspect_changes/);

  assert.match(dot, /resolve_goal_number[\s\S]*action_id="coding\.resolve_goal_number_from_milestone"[\s\S]*action_milestone_title="\$\{milestone_title\}"/);
  assert.match(dot, /fetch_goal_issue[\s\S]*action_id="goal\.fetch_goal_issue"[\s\S]*action_repo="\$\{gh_repo\}" action_goal_number="\$\{goal_issue_number\}"/);
  assert.match(dot, /load_intent_stack[\s\S]*action_id="common\.resolve_intent_stack"[\s\S]*action_factory_root="\$\{factory_root\}"/);
  assert.match(dot, /inspect_changes[\s\S]*action_id="coding\.inspect_branch_changes"[\s\S]*action_worktree_dir="\$\{worktree_dir\}"/);

  assert.match(dot, /Load the local code review skill by reading:/);
  assert.match(dot, /\$\{capability_coding_skills\}\/code_review\/SKILL\.md/);
  assert.match(dot, /\$\{capability_coding_skills\}\/code_review\/REPO\.md/);

  assert.match(dot, /Intent stack JSON:/);
  assert.match(dot, /Parent goal issue number: \$\{goal_issue_number\}/);
  assert.match(dot, /Parent goal issue JSON:/);
  assert.match(dot, /Current issue number: \$\{issue_number\}/);
  assert.match(dot, /Current issue title: \$\{issue_title\}/);
  assert.match(dot, /Current issue body:/);
  assert.match(dot, /Current wave milestone: \$\{milestone_title\}/);
  assert.match(dot, /Evidence artifact path: \$\{review_evidence_path\}/);
  assert.match(dot, /Reviewer context artifact path: \$\{review_context_path\}/);
  assert.match(dot, /Reviewer context hash \(sha256\): \$\{review_context_sha256\}/);
  assert.match(dot, /Commits ahead: \$\{commits_ahead\}/);
  assert.match(dot, /Changed files summary: \$\{changed_files\}/);
  assert.match(dot, /Latest issue change summary: \$\{latest_issue_change_summary\}/);

  assert.match(dot, /gh issue view \$\{issue_number\} --repo \$\{gh_repo\}/);
  assert.match(dot, /gh issue view \$\{goal_issue_number\} --repo \$\{gh_repo\}/);
  assert.match(dot, /Code review is not QA/);
  assert.match(dot, /Required review flow:/);

  assert.doesNotMatch(dot, /load_review_skill/);
  assert.doesNotMatch(dot, /load_review_repo/);
  assert.doesNotMatch(dot, /\$\{review_skill_content\}/);
  assert.doesNotMatch(dot, /\$\{review_repo_content\}/);
});

test("issue_execute_item build prompt carries goal and milestone context", () => {
  const dot = loadDot();

  assert.match(dot, /Intent stack JSON:\\n\$\{intent_stack\}/);
  assert.match(dot, /Parent goal: #\$\{goal_issue_number\}/);
  assert.match(dot, /Parent goal issue JSON:\\n\$\{goal_issue\}/);
  assert.match(dot, /Current implementation issue #\$\{issue_number\}: \$\{issue_title\}/);
  assert.match(dot, /The parent goal context is for alignment only\. Implement only the current issue\./);
});

test("issue_execute_item has no inline python heredoc in commandized nodes", () => {
  const dot = loadDot();
  const extractNode = dot.match(/extract_issue\s*\[[\s\S]*?\]/)?.[0] || "";
  const initNode = dot.match(/init\s*\[[\s\S]*?\]/)?.[0] || "";
  const initReviewNode = dot.match(/init_review\s*\[[\s\S]*?\]/)?.[0] || "";
  const incrementNode = dot.match(/inc_review\s*\[[\s\S]*?\]/)?.[0] || "";

  assert.doesNotMatch(extractNode, /python3\s+-\s*<<'PY'/);
  assert.doesNotMatch(initNode, /python3\s+-\s*<<'PY'/);
  assert.doesNotMatch(initReviewNode, /python3\s+-\s*<<'PY'/);
  assert.doesNotMatch(incrementNode, /python3\s+-\s*<<'PY'/);
});

test("issue_execute_item reviewer prompt enforces semantic context and non-QA boundary", () => {
  const dot = loadDot();
  const reviewNode = dot.match(/\breview\s*\[[\s\S]*?\]/);
  assert.ok(reviewNode, "review node must exist");
  const reviewBlock = String(reviewNode?.[0] || "");

  assert.match(reviewBlock, /semantic code reviewer/i);
  assert.match(reviewBlock, /\$\{intent_stack\}/);
  assert.match(reviewBlock, /\$\{goal_issue_number\}/);
  assert.match(reviewBlock, /\$\{goal_issue\}/);
  assert.match(reviewBlock, /\$\{milestone_title\}/);
  assert.match(reviewBlock, /\$\{latest_issue_change_summary\}/);
  assert.match(reviewBlock, /\$\{gh_repo\}/);
  assert.match(reviewBlock, /\$\{issue_body\}/);
  assert.match(reviewBlock, /gh issue view \$\{issue_number\}/);
  assert.match(reviewBlock, /gh issue view \$\{goal_issue_number\}/);
  assert.match(reviewBlock, /Inspect the local repo at \$\{worktree_dir\}/);
  assert.match(reviewBlock, /Code review is not QA/);
  assert.match(reviewBlock, /Do not turn this into a generic QA executor/);
  assert.match(reviewBlock, /\$\{capability_coding_skills\}\/code_review\/SKILL\.md/);
  assert.match(reviewBlock, /\$\{capability_coding_skills\}\/code_review\/REPO\.md/);
  assert.doesNotMatch(reviewBlock, /\$\{review_skill_content\}/);
  assert.doesNotMatch(reviewBlock, /\$\{review_repo_content\}/);
});

test("issue_execute_item transports issue_item via base64 (quote-safe)", () => {
  const dot = loadDot();
  assert.match(dot, /extract_issue[\s\S]*action_issue_item="\$\{issue_item\}"/);
});
