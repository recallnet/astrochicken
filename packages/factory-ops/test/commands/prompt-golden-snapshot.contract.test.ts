// prompt-golden-snapshot.test.mjs
//
// Golden prompt snapshot tests — locks down every required variable,
// instruction, and scope guard per failure route.
//
// Self-contained test file organized by route. Intentionally overlaps
// with conflict-resolution-chain.test.mjs (B1.5, B1.6, B2.4, B4.1, B4.2)
// and supervisor-tick-contract.test.mjs (D4.1–D4.3) for single-file visibility.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildConflictPacket,
} from "../../src/commands/merge-item-ops.ts";
import {
  validateReviewerContextContract,
} from "../../src/commands/reviewer-context-contract.ts";

// ── Helpers ────────────────────────────────────────────────────

const DOT_CACHE = {};
const DOT_NAME_MAP = {
  wave_execute: "goal_execute",
  wave_issue_execute: "goal_issue_execute",
};
function readDot(name) {
  const resolvedName = DOT_NAME_MAP[name] || name;
  if (!DOT_CACHE[resolvedName]) {
    if (resolvedName === "release_report_flow") {
      DOT_CACHE[resolvedName] = readFileSync("docs/contracts/workflow-ir/capability-release-reporting/release_report_flow.dot", "utf8");
    } else {
      DOT_CACHE[resolvedName] = readFileSync(`factories/mothership/graphs/${resolvedName}.dot`, "utf8");
    }
  }
  return DOT_CACHE[resolvedName];
}

function extractNode(dot, name) {
  const re = new RegExp(`${name}\\s*\\[[\\s\\S]*?\\]`);
  return dot.match(re)?.[0] || "";
}

function readPromptFileFromLoader(dot, loaderName) {
  const node = extractNode(dot, loaderName);
  const path = node.match(/prompt="cat ([^"]+)"/)?.[1] || "";
  assert.ok(path, `${loaderName} must load a prompt file via cat`);
  return readFileSync(path, "utf8");
}

function sh(args, cwd) {
  const p = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  if ((p.status ?? 1) !== 0)
    throw new Error((p.stderr || p.stdout || "cmd failed").trim());
  return String(p.stdout || "").trim();
}

function initRepo() {
  const repo = mkdtempSync(join(tmpdir(), "taxi-golden-"));
  sh(["git", "init", "-b", "main"], repo);
  sh(["git", "config", "user.email", "taxi@example.com"], repo);
  sh(["git", "config", "user.name", "Hatch"], repo);
  writeFileSync(join(repo, "file.txt"), "base\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "base"], repo);
  return repo;
}

function initConflictingRepo(branchName = "wave/test-wave") {
  const repo = initRepo();
  sh(["git", "checkout", "-b", branchName], repo);
  writeFileSync(join(repo, "file.txt"), "branch-side\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "branch change"], repo);
  sh(["git", "checkout", "main"], repo);
  writeFileSync(join(repo, "file.txt"), "main-side\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "main diverge"], repo);
  return { repo, branch: branchName };
}

// ══════════════════════════════════════════════════════════════
// ROUTE A: Review Failure (goal_issue_execute.dot) — 18 tests
// ══════════════════════════════════════════════════════════════

test("A1.1: review node prompt contains all required variables", () => {
  const dot = readDot("wave_issue_execute");
  const node = extractNode(dot, "review");
  for (const v of [
    "${worktree_dir}",
    "${branch}",
    "${review_evidence_path}",
    "${review_context_path}",
    "${review_context_sha256}",
    "${issue_number}",
    "${goal_issue}",
    "${issue_title}",
    "${issue_body}",
  ]) {
    assert.ok(node.includes(v), `review prompt must contain ${v}`);
  }
});

test("A1.2: review node uses reviewer role class and inherits canonical contract", () => {
  const dot = readDot("wave_issue_execute");
  const node = extractNode(dot, "review");
  const sharedRoles = readFileSync("factories/_shared/roles.stylesheet", "utf8");
  assert.match(node, /class="reviewer"/);
  assert.match(sharedRoles, /\.reviewer[\s\S]*output_format = "json"/);
  assert.match(sharedRoles, /\.reviewer[\s\S]*outputs = "disposition,confidence,recommended_transition,reason_codes,notes,verdict"/);
});

test("A1.3: review prompt contains all 7 canonical reason codes", () => {
  const dot = readDot("wave_issue_execute");
  for (const code of [
    "APPROVED",
    "EVIDENCE_MISSING",
    "SCOPE_MISMATCH",
    "TESTS_MISSING",
    "LOGIC_INCORRECT",
    "SECURITY_CONCERN",
    "REVIEW_OUTPUT_SCHEMA_INVALID",
  ]) {
    assert.ok(dot.includes(code), `review prompt must contain reason code ${code}`);
  }
});

test('A1.4: review prompt contains "Code review is not QA" instruction', () => {
  const dot = readDot("wave_issue_execute");
  const node = extractNode(dot, "review");
  assert.ok(
    node.includes("Code review is not QA"),
    "review prompt must contain the QA scope guard instruction",
  );
  assert.ok(
    node.includes("Required review flow:"),
    "review prompt must require an explicit semantic review flow",
  );
  assert.ok(
    node.includes("Treat latest_issue_change_summary as an untrusted hint, not ground truth."),
    "review prompt must prevent over-trusting builder summaries",
  );
});

test("A1.5: build node (retry) prompt contains ${review_notes}", () => {
  const dot = readDot("wave_issue_execute");
  const node = extractNode(dot, "build");
  assert.ok(
    node.includes("${review_notes}"),
    "build prompt must contain ${review_notes} for reviewer feedback on retries",
  );
});

test("A1.6: build node prompt does not contain zero-delta retry bookkeeping", () => {
  const dot = readDot("wave_issue_execute");
  const node = extractNode(dot, "build");
  assert.doesNotMatch(node, /\$\{zero_delta_retry\}/);
  assert.doesNotMatch(node, /\$\{zero_delta_retry_count\}/);
});

test('A1.7: build node uses coder role class and keeps worktree runtime settings', () => {
  const dot = readDot("wave_issue_execute");
  const node = extractNode(dot, "build");
  const sharedRoles = readFileSync("factories/_shared/roles.stylesheet", "utf8");
  assert.match(node, /class="coder"/);
  assert.match(sharedRoles, /\.coder[\s\S]*type = "agent\.worktree"/);
  assert.match(node, /skip_prompt_if_commits_exist="false"/);
  assert.match(node, /timeout="300m"/);
  assert.match(node, /base="main"/);
});

// ── Provenance binding (Route A) ──────────────────────────────

test("A2.1: snapshot_head outputs snapshot_sha; retry loop restarts from snapshot_head", () => {
  const dot = readDot("wave_issue_execute");
  const node = extractNode(dot, "snapshot_head");
  assert.match(node, /outputs="snapshot_sha"/);
  assert.match(dot, /set_max_review_attempts -> snapshot_head/);
  assert.match(dot, /snapshot_head -> build/);
  assert.match(dot, /retry_gate -> snapshot_head \[condition="retry_review=true"\]/);
});

test("A2.2: write_review_evidence outputs review_evidence_path and binds typed snapshot/builder-notes inputs", () => {
  const dot = readDot("wave_issue_execute");
  const node = extractNode(dot, "write_review_evidence");
  assert.match(node, /outputs="review_evidence_path,builder_notes,issue_changed_files"/);
  assert.match(node, /action_runtime="in_process" action_id="coding\.write_review_evidence"/);
  assert.match(node, /action_snapshot_sha="\$\{snapshot_sha\}"/);
  assert.match(node, /action_builder_notes_b64="\$\{builder_output_b64\}"/);
});

test("A2.2b: reviewer path uses context + visual-refinement gates and deterministic route resolver", () => {
  const dot = readDot("wave_issue_execute");
  assert.match(dot, /write_review_evidence -> build_review_context -> validate_review_context -> review_context_gate/);
  assert.match(dot, /review_context_gate -> enforce_visual_refinement_evidence \[condition="review_context_gate_pass=true"\]/);
  assert.match(dot, /review_context_gate -> resolve_review_route \[condition="review_context_gate_pass!=true"\]/);
  assert.match(dot, /enforce_visual_refinement_evidence -> visual_refinement_gate/);
  assert.match(dot, /visual_refinement_gate -> review \[condition="visual_refinement_gate_pass=true"\]/);
  assert.match(dot, /visual_refinement_gate -> report_retry_failed \[condition="visual_refinement_gate_pass!=true"\]/);
  assert.match(dot, /action_id="coding\.verify_visual_refinement_evidence"/);
  assert.match(dot, /review -> resolve_review_route/);
  assert.match(dot, /resolve_review_route -> emit_review_verdict_telemetry/);
  assert.match(dot, /emit_review_verdict_telemetry -> decide/);
  assert.match(dot, /action_id="coding\.emit_review_verdict_telemetry"/);
  assert.doesNotMatch(dot, /validate_zero_delta/);
  assert.doesNotMatch(dot, /zero_delta_gate/);
  assert.doesNotMatch(dot, /zero_delta_revise/);
});

test("A2.2c: goal issue context is resolved before review", () => {
  const dot = readDot("wave_issue_execute");
  assert.match(dot, /fetch_goal_issue[\s\S]*action_runtime="in_process" action_id="goal\.fetch_goal_issue"[\s\S]*action_repo="\$\{gh_repo\}" action_goal_number="\$\{goal_issue_number\}"/);
  assert.match(
    dot,
    /start -> set_issue_context -> fetch_issue -> fetch_goal_issue -> load_intent_stack -> load_agent_guidance_context -> estimate_complexity -> complexity_gate/,
  );
  assert.match(dot, /load_agent_guidance_context[\s\S]*action_runtime="in_process" action_id="common\.load_agent_guidance_context"[\s\S]*action_repo_root="\$\{repo\}"/);
});

test("A2.3: reviewer prompt requires reading capability SKILL and factory REPO docs", () => {
  const dot = readDot("wave_issue_execute");
  const node = extractNode(dot, "review");
  assert.match(node, /Load the local code review skill by reading BOTH:/);
  assert.match(node, /\$\{capability_coding_skills\}\/code_review\/SKILL\.md/);
  assert.match(node, /\$\{capability_coding_skills\}\/code_review\/REPO\.md/);
});

test("A2.4: load_review_skill/load_review_repo nodes are removed from wave issue path", () => {
  const dot = readDot("wave_issue_execute");
  assert.doesNotMatch(dot, /load_review_skill/);
  assert.doesNotMatch(dot, /load_review_repo/);
});

test("A2.5: set_issue_context outputs include issue_number", () => {
  const dot = readDot("wave_issue_execute");
  const node = extractNode(dot, "set_issue_context");
  assert.match(node, /outputs="issue_number,issue_title"/);
});

// ── Scope guard (Route A) ─────────────────────────────────────

test("A3.1: no prompt in goal_issue_execute.dot contains literal main...HEAD", () => {
  const dot = readDot("wave_issue_execute");
  assert.doesNotMatch(
    dot,
    /main\.\.\.HEAD/,
    "wave_issue_execute must never contain main...HEAD — use snapshot-scoped diffs",
  );
});

test("A3.2: review prompt references evidence artifact, not raw git diff/log", () => {
  const dot = readDot("wave_issue_execute");
  const node = extractNode(dot, "review");
  assert.ok(
    node.includes("review_evidence_path") || node.includes("evidence artifact"),
    "review must reference evidence artifact",
  );
  assert.doesNotMatch(node, /git diff/, "review must not shell out to git diff directly");
  assert.doesNotMatch(node, /git log/, "review must not shell out to git log directly");
});

test("A3.3: write_review_evidence command uses --snapshot-sha '${snapshot_sha}'", () => {
  const dot = readDot("wave_issue_execute");
  const node = extractNode(dot, "write_review_evidence");
  assert.match(node, /action_id="coding\.write_review_evidence"/);
  assert.match(node, /action_snapshot_sha="\$\{snapshot_sha\}"/);
});

// ── Anti-regression (Route A) ─────────────────────────────────

test('A4.1: retry edge retry_gate -> snapshot_head [condition="retry_review=true"]', () => {
  const dot = readDot("wave_issue_execute");
  assert.match(dot, /retry_gate -> snapshot_head \[condition="retry_review=true"\]/);
});

test('A4.2: exhausted retries and build failures fail closed', () => {
  // coverage: docs/contracts/workflow-ir/mothership/goal_issue_execute.dot
  // Both use the build-failed-result ops command.
  const dot = readDot("wave_issue_execute");
  assert.match(dot, /report_retry_failed\s*\[/);
  assert.match(dot, /report_build_failed\s*\[/);
  assert.match(dot, /retry_gate -> report_retry_failed \[condition="retry_review!=true"\]/);
  assert.match(dot, /visual_refinement_gate -> report_retry_failed \[condition="visual_refinement_gate_pass!=true"\]/);
  assert.match(dot, /assert_main_after_build -> report_build_failed \[condition="ok!=true"\]/);
  assert.match(dot, /report_build_failed -> done/);
  assert.match(dot, /report_retry_failed -> done/);
  assert.doesNotMatch(dot, /revert_failed_issue/);
  assert.doesNotMatch(dot, /give_up/);
  assert.doesNotMatch(dot, /emit_review_fallback_defect/);
});

test("A4.4: reviewer retries use bounded should-retry-review command, not deterministic review fallbacks", () => {
  const dot = readDot("wave_issue_execute");
  const node = extractNode(dot, "should_retry_review");
  assert.match(node, /action_runtime="in_process" action_id="coding\.should_retry_review"/);
  assert.match(node, /action_review_verdict="\$\{disposition\}"/);
  assert.match(node, /action_attempt="\$\{review_attempt\}"/);
  assert.match(node, /action_max_attempts="\$\{max_review_attempts\}"/);
  assert.doesNotMatch(dot, /fallback-review-from-json/);
  assert.doesNotMatch(dot, /ensure_review_decision/);
  assert.doesNotMatch(dot, /set-retry-decision/);
});

// ══════════════════════════════════════════════════════════════
// ROUTE B/C: Merge/Rebase Conflict (goal_execute.dot) — 14 tests
// ══════════════════════════════════════════════════════════════

// ── Golden prompt snapshot (Route B/C) ────────────────────────

test("B1.1: resolve_conflict prompt contains ${conflict_packet_path}", () => {
  const dot = readDot("wave_execute");
  const node = extractNode(dot, "resolve_conflict");
  assert.ok(node.includes("${conflict_packet_path}"), "resolve_conflict must receive conflict packet path");
});

test("B1.2: resolve_conflict prompt references merge_conflict_resolver SKILL.md", () => {
  const dot = readDot("wave_execute");
  const node = extractNode(dot, "resolve_conflict");
  assert.ok(
    node.includes("${capability_merge_skills}/merge_conflict_resolver/SKILL.md"),
    "resolve_conflict must reference the merge conflict resolver skill",
  );
});

test("B1.2b: resolve_conflict task prompt is concise and delegates to conflict packet", () => {
  const dot = readDot("wave_execute");
  const prompt = readPromptFileFromLoader(dot, "load_merge_resolve_conflict_task_prompt");
  assert.match(prompt, /conflict packet/, "must reference the conflict packet as work order");
  assert.match(prompt, /clean/, "must require clean terminal state");
  // Simplified prompt should NOT contain step-by-step git invariant checklists —
  // the conflict packet already carries verification commands.
  assert.doesNotMatch(prompt, /Required working pattern/, "should not contain procedural steps");
});

test('B1.3: resolve_conflict uses merge_resolver role class and keeps conflict runtime settings', () => {
  const dot = readDot("wave_execute");
  const node = extractNode(dot, "resolve_conflict");
  const sharedRoles = readFileSync("factories/_shared/roles.stylesheet", "utf8");
  assert.match(node, /class="merge_resolver"/);
  assert.match(sharedRoles, /\.merge_resolver[\s\S]*type = "stack\.manager_loop"/);
  assert.match(node, /workdir="\$\{merge_worktree_dir\}"/);
  assert.match(node, /timeout="90m"/);
  assert.match(node, /reasoning_effort="medium"/);
});

test("B1.4: build_conflict_packet outputs conflict_packet_path", () => {
  const dot = readDot("wave_execute");
  const node = extractNode(dot, "build_conflict_packet");
  assert.match(node, /outputs="conflict_packet_path(?:,[^"]+)?"/);
});

test("B1.5: build_conflict_packet uses --merge-stderr '${rebase_stderr}' (positive)", () => {
  const dot = readDot("wave_execute");
  assert.match(
    dot,
    /build_conflict_packet[\s\S]*action_merge_stderr="\$\{rebase_stderr\}"/,
    "build_conflict_packet must pass rebase_stderr",
  );
});

test("B1.6: rebase-path build_conflict_packet does NOT use --merge-stderr '${merge_stderr}'", () => {
  const dot = readDot("wave_execute");
  // Extract just the build_conflict_packet node definition (rebase path) — not build_post_merge_packet
  const rebaseNodeMatch = dot.match(/build_conflict_packet \[[\s\S]*?\]/);
  assert.ok(rebaseNodeMatch, "build_conflict_packet node must exist");
  assert.doesNotMatch(
    rebaseNodeMatch[0],
    /action_merge_stderr="\$\{merge_stderr\}"/,
    "rebase-path build_conflict_packet must NOT use merge_stderr — it uses rebase_stderr",
  );
});

// ── Provenance binding (Route B/C) ────────────────────────────

test("B2.1: rebase_branch outputs include rebase_stderr", () => {
  const dot = readDot("wave_execute");
  const node = extractNode(dot, "rebase_branch");
  assert.match(node, /outputs="rebase_status,rebase_stdout,rebase_stderr(?:,[^"]+)?"/);
});

test("B2.2: build_conflict_packet passes --worktree-dir '${merge_worktree_dir}'", () => {
  const dot = readDot("wave_execute");
  assert.match(dot, /build_conflict_packet[\s\S]*action_worktree_dir="\$\{merge_worktree_dir\}"/);
});

test('B2.3: edge rebase_gate -> set_resolution_source_llm [condition="rebase_status!=ready"]', () => {
  const dot = readDot("wave_execute");
  assert.match(dot, /rebase_gate -> set_resolution_source_llm \[condition="rebase_status!=ready"\]/);
});

test("B2.4: unresolved conflict resolution emits telemetry then routes to merge failure", () => {
  const dot = readDot("wave_execute");
  assert.match(dot, /set_resolution_source_llm -> build_conflict_packet -> resolve_conflict -> finalize_merge_commit -> finalize_gate/);
  assert.match(dot, /finalize_gate -> verify_resolution \[condition="finalize_status=ok"\]/);
  assert.match(dot, /finalize_gate -> retry_resolve_conflict \[condition="finalize_status!=ok"\]/);
  assert.match(dot, /retry_resolve_conflict -> verify_resolution/);
  assert.match(dot, /resolution_gate -> emit_resolution_failure \[condition="resolution_status!=resolved"\]/);
  assert.match(dot, /emit_resolution_failure -> set_goal_merge_failed/);
  // emit_merge_conflict_fallback_defect node removed — direct edge now
  assert.doesNotMatch(dot, /emit_merge_conflict_fallback_defect/);
});

test("B2.5: retry finalize conflict prompt is concise and references prior failure", () => {
  const dot = readDot("wave_execute");
  const prompt = readPromptFileFromLoader(dot, "load_merge_finalize_retry_task_prompt");
  assert.match(prompt, /previous attempt|prior attempt|retry/, "must reference failed prior attempt");
  assert.match(prompt, /conflict packet/, "must reference conflict packet");
  // Should not repeat git-state invariant checklists — the conflict packet has them
  assert.doesNotMatch(prompt, /Required working pattern|Required Git-state checks/, "should not contain procedural checklists");
});

test("B2.6: merge resolver system prompt is concise", () => {
  const prompt = readFileSync("packages/factory-prompts/prompts/merge_resolver/system.md", "utf8");
  assert.match(prompt, /merge resolver/, "must identify the role");
  assert.match(prompt, /conflict packet/, "must reference conflict packet as the work order");
  // Should not contain procedural instructions — the LLM knows git
  assert.doesNotMatch(prompt, /minimum safe git changes/, "should not contain redundant procedural framing");
});

test("B2.7: clean_main prompt addresses the LLM directly and does not contain numbered checklists", () => {
  const dot = readDot("wave_execute");
  const node = extractNode(dot, "clean_main");
  assert.ok(node.includes("You own"), "clean_main must address the LLM directly");
  assert.ok(node.includes("pnpm test:strict"), "clean_main must require test:strict");
  assert.doesNotMatch(node, /This node owns/, "should not refer to itself as 'this node'");
  assert.doesNotMatch(node, /Workflow:\n0\./, "should not contain numbered step-by-step workflow");
});

// ── Scope guard (Route B/C) ───────────────────────────────────

test("B3.1: verify_resolution passes --merge-worktree-dir '${merge_worktree_dir}'", () => {
  const dot = readDot("wave_execute");
  assert.match(dot, /verify_resolution[\s\S]*action_merge_worktree_dir="\$\{merge_worktree_dir\}"/);
});

// ── Anti-regression (Route B/C) ───────────────────────────────

test('B4.1: resolution_gate -> merge_branch [condition="resolution_status=resolved"]', () => {
  const dot = readDot("wave_execute");
  assert.match(dot, /resolution_gate -> merge_branch \[condition="resolution_status=resolved"\]/);
});

test('B4.2: resolution_gate unresolved path emits telemetry then routes to merge failure', () => {
  const dot = readDot("wave_execute");
  assert.match(dot, /resolution_gate -> emit_resolution_failure \[condition="resolution_status!=resolved"\]/);
  assert.match(dot, /emit_resolution_failure -> set_goal_merge_failed/);
  // emit_merge_conflict_fallback_defect node removed — direct edge now
  assert.doesNotMatch(dot, /emit_merge_conflict_fallback_defect/);
});

test('B4.3: rebase success path stamps deterministic resolver before merge_branch', () => {
  const dot = readDot("wave_execute");
  assert.match(dot, /rebase_gate -> set_resolution_source_deterministic \[condition="rebase_status=ready"\]/);
  assert.match(dot, /set_resolution_source_deterministic -> merge_branch/);
});

// ══════════════════════════════════════════════════════════════
// ROUTE D: Bug Fast-Route + End-of-Tick Review
//          (factory_supervisor_tick.dot) — 14 tests
// ══════════════════════════════════════════════════════════════

// ── Golden prompt snapshot (Route D) ──────────────────────────

test("D1.1: supervisor_review_bug_fast prompt contains repo/factory context vars + skill payloads", () => {
  const dot = readDot("factory_supervisor_tick");
  const node = extractNode(dot, "supervisor_review_bug_fast");
  for (const v of [
    "${gh_repo}",
    "${target_repo}",
    "${control_plane_repo}",
    "${factory_id}",
    "${date}",
    "${supervisor_skill_content}",
    "${supervisor_rules_content}",
    "${state_snapshot}",
  ]) {
    assert.ok(node.includes(v), `supervisor_review_bug_fast prompt must contain ${v}`);
  }
});

test("D1.2: supervisor_review_bug_fast prompt contains all 3 dispositions", () => {
  const dot = readDot("factory_supervisor_tick");
  const taskPrompt = readPromptFileFromLoader(dot, "load_supervisor_bug_fast_task_prompt");
  for (const disp of [
    "FIX_ON_MAIN",
    "CONVERT_TO_GOAL",
    "CONVERT_TO_GOAL_WITH_DEPENDENCIES",
  ]) {
    assert.ok(
      taskPrompt.includes(disp),
      `supervisor_review_bug_fast must contain disposition ${disp}`,
    );
  }
});

test("D1.3: supervisor_review_bug_fast prompt contains bug-only restriction text", () => {
  const dot = readDot("factory_supervisor_tick");
  const taskPrompt = readPromptFileFromLoader(dot, "load_supervisor_bug_fast_task_prompt");
  assert.ok(
    taskPrompt.includes("bug-only remediation"),
    "supervisor_review_bug_fast must contain bug-only restriction",
  );
  assert.ok(taskPrompt.includes("full bash/read/gh access"), "supervisor_review_bug_fast must declare full repo access");
  assert.ok(taskPrompt.includes("remediation_packet"), "supervisor_review_bug_fast must reference remediation_packet");
  assert.ok(taskPrompt.includes("execution_commands"), "supervisor_review_bug_fast must reference execution commands");
});

test("D1.4: supervisor_review_bug_fast uses supervisor role class with expected runtime settings", () => {
  const dot = readDot("factory_supervisor_tick");
  const node = extractNode(dot, "supervisor_review_bug_fast");
  const sharedRoles = readFileSync("factories/_shared/roles.stylesheet", "utf8");
  assert.match(node, /class="supervisor"/);
  assert.match(sharedRoles, /\.supervisor[\s\S]*type = "stack\.manager_loop"/);
  assert.match(node, /timeout="90m"/);
  assert.match(node, /workdir="\."/);
});

test('D1.5: supervisor_review_bug_fast prompt requires "fixes #<bug-number>" in commit messages', () => {
  const dot = readDot("factory_supervisor_tick");
  const taskPrompt = readPromptFileFromLoader(dot, "load_supervisor_bug_fast_task_prompt");
  assert.ok(
    taskPrompt.includes("fixes #<bug-number>") || taskPrompt.includes("fixes #"),
    "supervisor_review_bug_fast must require fixes # in commit messages",
  );
});

test("D1.6: supervisor_review (end-of-tick) prompt contains repo/factory vars + template/addendum", () => {
  const dot = readDot("factory_supervisor_tick");
  const matches = dot.matchAll(/supervisor_review\s*\[[\s\S]*?\]/g);
  let endOfTickNode = "";
  for (const m of matches) {
    if (!m[0].startsWith("supervisor_review_bug_fast")) {
      endOfTickNode = m[0];
      break;
    }
  }
  assert.ok(endOfTickNode, "must find supervisor_review end-of-tick node");
  for (const v of [
    "${gh_repo}",
    "${target_repo}",
    "${control_plane_repo}",
    "${factory_id}",
    "${date}",
    "${supervisor_skill_content}",
    "${supervisor_rules_content}",
    "${state_snapshot}",
  ]) {
    assert.ok(endOfTickNode.includes(v), `supervisor_review (end-of-tick) prompt must contain ${v}`);
  }
});

test("D1.7: supervisor_review (end-of-tick) prompt contains CLI_RUNTIME_CRASH handling", () => {
  const dot = readDot("factory_supervisor_tick");
  const taskPrompt = readPromptFileFromLoader(dot, "load_supervisor_review_task_prompt");
  assert.ok(
    taskPrompt.includes("CLI_RUNTIME_CRASH"),
    "supervisor_review must handle CLI_RUNTIME_CRASH action items",
  );
  assert.ok(taskPrompt.includes("execute-and-verify"), "supervisor_review must emphasize execution ownership");
  assert.ok(taskPrompt.includes("complete: you executed a recovery or fix"), "supervisor_review must use complete/defer/escalate outcomes");
  assert.ok(taskPrompt.includes("remediation_packet"), "supervisor_review must reference remediation packets");
});

test("D1.8: supervisor prompts require control-plane routing for factory_design_defect", () => {
  const dot = readDot("factory_supervisor_tick");
  const bugFastTask = readPromptFileFromLoader(dot, "load_supervisor_bug_fast_task_prompt");
  const reviewTask = readPromptFileFromLoader(dot, "load_supervisor_review_task_prompt");
  for (const taskPrompt of [bugFastTask, reviewTask]) {
    assert.ok(taskPrompt.includes("factory_design_defect"), "prompt must mention factory_design_defect routing");
    assert.ok(taskPrompt.includes("${control_plane_repo}"), "prompt must route defects to ${control_plane_repo}");
    assert.ok(taskPrompt.includes("source_factory=${factory_id}"), "prompt must require source_factory metadata");
    assert.ok(taskPrompt.includes("source_repo=${target_repo}"), "prompt must require source_repo metadata");
  }
});

test("D1.9: supervisor prompts include ownership_decision contract for disposition mapping", () => {
  const dot = readDot("factory_supervisor_tick");
  const bugFastTask = readPromptFileFromLoader(dot, "load_supervisor_bug_fast_task_prompt");
  const reviewTask = readPromptFileFromLoader(dot, "load_supervisor_review_task_prompt");
  for (const taskPrompt of [bugFastTask, reviewTask]) {
    assert.ok(taskPrompt.includes("ownership_decision"), "prompt must mention ownership_decision");
    assert.ok(taskPrompt.includes("ownership_reason"), "prompt must mention ownership_reason");
  }
  assert.ok(reviewTask.includes("local_fix=>complete"), "end-of-tick prompt must map local_fix to complete");
  assert.ok(reviewTask.includes("control_plane=>escalate"), "end-of-tick prompt must map control_plane to escalate");
  assert.ok(reviewTask.includes("wait=>defer"), "end-of-tick prompt must map wait to defer");
});

test("D1.10: supervisor review prompt treats human blockers as narrow re-review items", () => {
  const dot = readDot("factory_supervisor_tick");
  const reviewTask = readPromptFileFromLoader(dot, "load_supervisor_review_task_prompt");
  assert.ok(reviewTask.includes("HUMAN_BLOCKER_OPEN"), "prompt must mention HUMAN_BLOCKER_OPEN action items");
  assert.ok(reviewTask.includes("Re-review every human blocker"), "prompt must require human blocker re-review");
  assert.ok(reviewTask.includes("Do not preserve a human blocker for ambiguity"), "prompt must reject human blocker overuse");
});

// ── Provenance binding (Route D) ──────────────────────────────

test("D2.1: supervisor template + addendum are loaded via cat nodes", () => {
  const dot = readDot("factory_supervisor_tick");
  const templateNode = extractNode(dot, "load_supervisor_skill");
  const rulesNode = extractNode(dot, "load_supervisor_rules");
  const systemNode = extractNode(dot, "load_supervisor_system_prompt");

  assert.match(templateNode, /output_key="supervisor_skill_content"/);
  assert.match(templateNode, /prompt="cat /);
  assert.match(templateNode, /packages\/factory-skills\/skills\/runtime\/supervisor_review\/SKILL\.md/);

  assert.match(rulesNode, /output_key="supervisor_rules_content"/);
  assert.match(rulesNode, /prompt="cat /);
  assert.match(rulesNode, /factories\/mothership\/skills\/supervisor_rules\.md/);
  assert.match(systemNode, /output_key="supervisor_system_prompt"/);
  assert.match(systemNode, /prompt="cat packages\/factory-prompts\/prompts\/supervisor\/system\.md"/);

  assert.match(dot, /load_supervisor_skill -> load_supervisor_rules -> load_supervisor_system_prompt -> load_intent_stack -> snapshot_state_fast/);
});

test("D2.1b: shared supervisor template contains no hardcoded recallnet/astrochicken", () => {
  const template = readFileSync("packages/factory-skills/skills/runtime/supervisor_review/SKILL.md", "utf8");
  assert.doesNotMatch(template, /recallnet\/astrochicken/);
});

test("D2.2: snapshot_state_fast has output_key=state_snapshot using supervisor state-snapshot", () => {
  const dot = readDot("factory_supervisor_tick");
  const node = extractNode(dot, "snapshot_state_fast");
  assert.match(node, /output_key="state_snapshot"/);
  assert.match(node, /action_runtime="in_process" action_id="supervisor\.state_snapshot"/);
  assert.match(node, /action_factory_id="\$\{factory_id\}"/);
  assert.match(node, /action_target_repo="\$\{target_repo\}"/);
  assert.match(node, /action_control_plane_repo="\$\{control_plane_repo\}"/);
  assert.match(node, /action_runs_dir="\$\{runs_dir\}"/);
});

test("D2.3: set_date_fast has output_key=date and is reached via fast_route_telemetry_open", () => {
  const dot = readDot("factory_supervisor_tick");
  const node = extractNode(dot, "set_date_fast");
  assert.match(node, /output_key="date"/);
  assert.match(dot, /bug_fast_gate -> fast_route_telemetry_open \[condition="has_open_bugs=true"\]/);
  assert.match(dot, /fast_route_telemetry_open -> set_date_fast/);
  assert.match(dot, /set_date_fast -> load_supervisor_bug_fast_task_prompt -> supervisor_review_bug_fast/);
});

test("D2.4: snapshot_state (end-of-tick) has output_key=state_snapshot, distinct from snapshot_state_fast", () => {
  const dot = readDot("factory_supervisor_tick");
  const m = dot.match(/snapshot_state\s*\[[\s\S]*?\]/);
  assert.ok(m, "must find snapshot_state (end-of-tick) node");
  assert.ok(m[0].includes('output_key="state_snapshot"'), "snapshot_state must have output_key=state_snapshot");
  assert.match(m[0], /action_runtime="in_process" action_id="supervisor\.state_snapshot"/);
  assert.match(m[0], /action_runs_dir="\$\{runs_dir\}"/);
  assert.match(dot, /supervisor_health -> snapshot_state -> set_date -> evaluate_action_item_gate -> action_item_gate/);
});

test("D2.4b: action_item_gate uses factory-scoped runs dir", () => {
  const dot = readDot("factory_supervisor_tick");
  const node = extractNode(dot, "evaluate_action_item_gate");
  assert.match(node, /action_runtime="in_process" action_id="supervisor\.action_item_gate"/);
  assert.match(node, /action_factory_id="\$\{factory_id\}"/);
  assert.match(node, /action_runs_dir="\$\{runs_dir\}"/);
});

test("D2.4c: tick runtime nodes use resolved runs_dir context instead of relative .hatch paths", () => {
  const dot = readDot("factory_supervisor_tick");
  for (const nodeName of [
    "snapshot_state_fast",
    "recovery_sweep_runtime",
    "evaluate_tick_idle",
    "snapshot_state",
    "evaluate_action_item_gate",
  ]) {
    const node = extractNode(dot, nodeName);
    assert.match(node, /action_runs_dir="\$\{runs_dir\}"/, `${nodeName} must use the resolved runs_dir context`);
    assert.doesNotMatch(node, /--runs-dir '\.hatch\//, `${nodeName} must not hardcode a relative .hatch runs dir`);
  }
});

test("D2.5: release narrator skill is loaded before narrator prompt", () => {
  const releaseDot = readDot("release_report_flow");
  const skillNode = extractNode(releaseDot, "load_release_narrator_skill");

  assert.match(skillNode, /output_key="release_narrator_skill_content"/);
  assert.match(skillNode, /prompt="cat packages\/factory-skills\/skills\/runtime\/release_narrator\/SKILL\.md"/);
});

test("D2.6: release narrator outputs delivery_decision, headline, summary, and report_body", () => {
  const releaseDot = readDot("release_report_flow");
  const narratorNode = extractNode(releaseDot, "release_narrator");

  assert.match(narratorNode, /class="release_narrator"/);
  assert.match(narratorNode, /outputs="delivery_decision,headline,summary,report_body"/);
  assert.match(narratorNode, /\$\{release_narrator_skill_content\}/);
  assert.match(narratorNode, /Return a JSON object with the keys described in the skill contract above/);
  assert.match(narratorNode, /Release context JSON:\\n\$\{release_report_context\}/);

  const encodeContextNode = extractNode(releaseDot, "encode_release_report_context");
  const encodeNarrativeNode = extractNode(releaseDot, "encode_release_narrative");
  const publishNode = extractNode(releaseDot, "publish_release_report");
  const buildSlackBlocksNode = extractNode(releaseDot, "build_release_slack_blocks");
  const exampleWebFollowupNode = extractNode(releaseDot, "create_shaping_followup_issue");
  const encodePayloadNode = extractNode(releaseDot, "encode_release_slack_payload");
  const postSlackNode = extractNode(releaseDot, "post_release_to_slack");

  assert.match(encodeContextNode, /output_key="release_report_context_b64"/);
  assert.match(encodeContextNode, /action_runtime="in_process"/);
  assert.match(encodeContextNode, /action_id="common\.encode_base64"/);

  assert.match(encodeNarrativeNode, /output_key="release_narrative_b64"/);
  assert.match(encodeNarrativeNode, /action_id="common\.encode_base64"/);
  assert.match(encodeNarrativeNode, /action_value="\$\{release_narrative\}"/);

  assert.match(publishNode, /output_key="release_report_issue_delivery"/);
  assert.match(publishNode, /action_runtime="in_process"/);
  assert.match(publishNode, /action_id="release\.publish_report"/);
  assert.ok(publishNode.includes('action_id="release.publish_report"'));

  assert.match(buildSlackBlocksNode, /output_key="release_slack_payload"/);
  assert.match(buildSlackBlocksNode, /action_runtime="in_process"/);
  assert.match(buildSlackBlocksNode, /action_id="release\.build_slack_blocks"/);

  const emitNarrativeDocumentNode = extractNode(releaseDot, "emit_release_narrative_document");
  assert.match(emitNarrativeDocumentNode, /output_key="release_narrative_document_delivery"/);
  assert.match(emitNarrativeDocumentNode, /action_output_contract="release\.narrative_document_delivery@v1"/);
  assert.match(emitNarrativeDocumentNode, /action_runtime="in_process"/);
  assert.match(emitNarrativeDocumentNode, /action_id="release\.emit_narrative_document"/);
  assert.ok(emitNarrativeDocumentNode.includes('action_id="release.emit_narrative_document"'));

  assert.match(exampleWebFollowupNode, /output_key="release_shaping_followup_delivery"/);
  assert.match(exampleWebFollowupNode, /action_runtime="in_process"/);
  assert.match(exampleWebFollowupNode, /action_id="release\.shaping_followup"/);
  assert.ok(exampleWebFollowupNode.includes('action_id="release.shaping_followup"'));

  assert.match(encodePayloadNode, /output_key="release_slack_payload_b64"/);
  assert.match(encodePayloadNode, /action_id="common\.encode_base64"/);
  assert.match(encodePayloadNode, /action_value="\$\{release_slack_payload\}"/);

  assert.match(postSlackNode, /governance="irreversible"/);
  assert.match(postSlackNode, /output_key="release_slack_delivery"/);
  assert.match(postSlackNode, /action_runtime="in_process"/);
  assert.match(postSlackNode, /action_id="release\.post_to_slack"/);
  assert.match(postSlackNode, /action_context_b64="\$\{release_report_context_b64\}" action_payload_b64="\$\{release_slack_payload_b64\}"/);

  // Idle gate inserted between external lifecycle triage and recovery/release tail
  const dot = readDot("factory_supervisor_tick");
  assert.match(dot, /emit_review_metrics_summary -> evaluate_external_factory_lifecycle -> external_lifecycle_gate/);
  assert.match(dot, /external_lifecycle_gate -> evaluate_tick_idle \[condition="lifecycle_state!=rejected_upstream"\]/);
  assert.match(dot, /apply_rejected_upstream -> evaluate_tick_idle/);
  assert.match(dot, /evaluate_tick_idle -> tick_idle_gate/);
  assert.match(dot, /tick_idle_gate -> supervisor_health/);
  assert.match(dot, /supervisor_health -> snapshot_state -> set_date -> evaluate_action_item_gate -> action_item_gate/);
  assert.match(dot, /action_item_gate -> load_supervisor_review_task_prompt \[condition="has_action_items=true"\]/);
  assert.match(dot, /load_supervisor_review_task_prompt -> supervisor_review/);
  // Release report flow removed from supervisor tick — now a standalone scheduled graph (daily_release_report.dot).
  // Supervisor review and no-action-items both route to update_tick_idle_cursor -> done.
  assert.match(dot, /action_item_gate -> update_tick_idle_cursor \[condition="has_action_items!=true"\]/);
  assert.match(dot, /supervisor_review -> update_tick_idle_cursor/);
  assert.match(dot, /update_tick_idle_cursor -> done/);
  // Simplified release report flow: no worthiness gate or normalize step
  assert.match(releaseDot, /start -> build_release_report_context -> load_release_narrator_skill -> release_narrator -> narrative_delivery_gate/);
  assert.match(releaseDot, /narrative_delivery_gate -> done \[condition="delivery_decision=skip"\]/);
  assert.match(releaseDot, /narrative_delivery_gate -> encode_release_report_context \[condition="delivery_decision!=skip"\]/);
  assert.match(releaseDot, /encode_release_report_context -> encode_release_narrative -> publish_release_report -> emit_release_narrative_document -> create_shaping_followup_issue/);
  assert.match(releaseDot, /create_shaping_followup_issue -> update_release_dedup_cursor \[condition="delivery_decision=issue_only"\]/);
  assert.match(releaseDot, /create_shaping_followup_issue -> build_release_slack_blocks \[condition="delivery_decision=slack_and_issue"\]/);
  assert.match(releaseDot, /build_release_slack_blocks -> encode_release_slack_payload -> post_release_to_slack -> update_release_dedup_cursor/);
  assert.match(releaseDot, /update_release_dedup_cursor -> done/);
});

// ── Anti-regression (Route D) ─────────────────────────────────

test('D4.1: bug_fast_gate -> fast_route_telemetry_open [condition="has_open_bugs=true"]', () => {
  const dot = readDot("factory_supervisor_tick");
  assert.match(dot, /bug_fast_gate -> fast_route_telemetry_open \[condition="has_open_bugs=true"\]/);
  assert.match(dot, /fast_route_telemetry_open -> set_date_fast/);
  assert.doesNotMatch(dot, /bug_fast_gate -> set_date_fast \[condition="has_open_bugs=true"\]/);
});

test('D4.2: bug_fast_resolution_gate -> done [condition="has_open_bugs=true"] (unresolved bugs halt tick)', () => {
  const dot = readDot("factory_supervisor_tick");
  assert.match(dot, /bug_fast_resolution_gate -> done \[condition="has_open_bugs=true"\]/);
});

test('D4.3: bug_fast_gate clear path routes through fast_route_telemetry_clear to recovery_sweep_runtime', () => {
  const dot = readDot("factory_supervisor_tick");
  assert.match(dot, /bug_fast_gate -> fast_route_telemetry_clear \[condition="has_open_bugs!=true"\]/);
  assert.match(dot, /fast_route_telemetry_clear -> recovery_sweep_runtime/);
  assert.doesNotMatch(dot, /bug_fast_gate -> recovery_sweep_runtime \[condition="has_open_bugs!=true"\]/);
});

// ══════════════════════════════════════════════════════════════
// CATEGORY 5: Round-trip Bad Prompt Catches — 8 tests
// ══════════════════════════════════════════════════════════════

test("5.1: buildConflictPacket with empty mergeStderr + clean repo -> conflict_files: []", () => {
  const repo = initRepo();
  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "extra.txt"), "new\n", "utf8");
  sh(["git", "add", "extra.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);
  sh(["git", "checkout", "main"], repo);

  const out = buildConflictPacket({
    repo,
    branch: "wave/1",
    issueNumber: "500",
    mergeStderr: "",
  });
  const packet = JSON.parse(readFileSync(out.conflict_packet_path, "utf8"));
  assert.deepEqual(packet.conflict_files, []);
});

test("5.2: buildConflictPacket with rebase_conflict_files in stderr -> fallback produces correct array", () => {
  const repo = initRepo();
  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "extra.txt"), "new\n", "utf8");
  sh(["git", "add", "extra.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);
  sh(["git", "checkout", "main"], repo);

  const fakeStderr = "rebase_conflict_files=a.txt,b.txt";
  const out = buildConflictPacket({
    repo,
    branch: "wave/1",
    issueNumber: "501",
    mergeStderr: fakeStderr,
  });
  const packet = JSON.parse(readFileSync(out.conflict_packet_path, "utf8"));
  assert.deepEqual(packet.conflict_files, ["a.txt", "b.txt"]);
});

test("5.3: buildConflictPacket from conflicting repo has required structural fields", () => {
  const { repo, branch } = initConflictingRepo("wave/structural");

  spawnSync("git", ["-C", repo, "merge", "--no-ff", branch], { encoding: "utf8" });

  const out = buildConflictPacket({
    repo,
    branch,
    issueNumber: "502",
    mergeStderr: "",
  });
  const packet = JSON.parse(readFileSync(out.conflict_packet_path, "utf8"));

  assert.ok(Array.isArray(packet.conflict_files), "conflict_files must be array");
  assert.ok(Array.isArray(packet.branch_commits), "branch_commits must be array");
  assert.ok(
    Array.isArray(packet.main_commits_touching_conflicts),
    "main_commits_touching_conflicts must be array",
  );
  assert.ok(packet.branch, "packet must have branch");
  assert.ok(packet.repo, "packet must have repo");
});

// Tests 5.4, 5.5: writeReviewEvidence removed — goal-issue-state.mjs deleted in goal migration.

test("5.6: validateReviewerContextContract with missing effective_policy -> ok: false", () => {
  const result = validateReviewerContextContract({
    schema_version: "reviewer_context/v1",
    issue_number: "1",
    issue_excerpt: "test",
    branch: "wave/1",
    snapshot_sha: "abc123",
    issue_commit_subjects: [],
    diff_summary: "test",
    changed_files: [],
    evidence_artifact_path: "/tmp/test",
    evidence_artifact_sha256: "abc",
    policy_refs: [],
    policy_sources: [],
  });
  assert.equal(result.ok, false, "missing effective_policy must fail validation");
});

test("5.7: validateReviewerContextContract with missing policy_refs -> ok: false", () => {
  const result = validateReviewerContextContract({
    schema_version: "reviewer_context/v1",
    issue_number: "1",
    issue_excerpt: "test",
    branch: "wave/1",
    snapshot_sha: "abc123",
    issue_commit_subjects: [],
    diff_summary: "test",
    changed_files: [],
    evidence_artifact_path: "/tmp/test",
    evidence_artifact_sha256: "abc",
    policy_sources: [],
    effective_policy: {},
  });
  assert.equal(result.ok, false, "missing policy_refs must fail validation");
});

test("5.8: validateReviewerContextContract with all required fields -> ok: true", () => {
  const result = validateReviewerContextContract({
    schema_version: "reviewer_context/v1",
    packet_type: "reviewer_context_packet",
    packet_id: "reviewer_context_packet_fixture_valid",
    created_at: "2026-03-10T00:00:00.000Z",
    packet_state: "open",
    issue_number: "1",
    issue_excerpt: "test",
    branch: "wave/1",
    snapshot_sha: "abc123",
    issue_commit_subjects: [],
    diff_summary: {
      scope_mode: "snapshot_scoped",
      commits_ahead: "1",
      issue_commits: "1",
      changed_files_count: "0",
      issue_changed_files_count: "0",
      summary: "test",
    },
    changed_files: [],
    evidence_artifact_path: "/tmp/test",
    evidence_artifact_sha256: "abc",
    policy_refs: [
      { id: "global_policy", precedence: 0, loaded: true, sha256: "aaa", path: "/tmp/global" },
      { id: "repo_policy", precedence: 1, loaded: true, sha256: "bbb", path: "/tmp/repo" },
    ],
    policy_sources: [
      { id: "global_policy", order: 0, loaded: true, sha256: "aaa", path: "/tmp/global" },
      { id: "repo_policy", order: 1, loaded: true, sha256: "bbb", path: "/tmp/repo" },
    ],
    effective_policy: {
      schema_version: "review_policy/v1",
      merge_order: ["global_policy", "repo_policy"],
      values: {},
    },
  });
  assert.equal(result.ok, true, "all required fields present must pass validation");
});
