import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parse } from "./parse.js";
import {
	REVIEWER_CONTEXT_REQUIRED_KEYS,
	REVIEWER_CONTEXT_SCHEMA_VERSION,
} from "../../../../packages/factory-ops/src/commands/reviewer-context-contract.ts";

const GOAL_ISSUE_EXECUTE_DOT = join(import.meta.dirname, "../../../../docs/contracts/workflow-ir/mothership/goal_issue_execute.dot");
const ISSUE_EXECUTE_ITEM_DOT = join(import.meta.dirname, "../../../../docs/contracts/workflow-ir/capability-coding/issue_execute_item.dot");

function loadReviewPromptFromGraph(path: string, graphName: string): string {
	const graph = parse(readFileSync(path, "utf8"));
	const reviewNode = graph.nodes["review"];
	expect(reviewNode, `missing review node in ${graphName}`).toBeTruthy();
	const prompt = String(reviewNode?.attrs["prompt"] || "");
	expect(prompt.length, `review node prompt must not be empty in ${graphName}`).toBeGreaterThan(0);
	return prompt;
}

function loadReviewPrompt(): string {
	return loadReviewPromptFromGraph(GOAL_ISSUE_EXECUTE_DOT, "goal_issue_execute.dot");
}

function loadIssueExecuteItemReviewPrompt(): string {
	return loadReviewPromptFromGraph(ISSUE_EXECUTE_ITEM_DOT, "issue_execute_item.dot");
}

describe("reviewer prompt contract", () => {
	it("keeps semantic reviewer framing, required context-inspection instructions, and non-QA boundary", () => {
		const prompt = loadReviewPrompt();

		expect(
			prompt.toLowerCase(),
			"review prompt must frame reviewer as a semantic code reviewer",
		).toContain("semantic code reviewer");

		expect(
			prompt,
			"review prompt must include gh issue view instruction for current issue",
		).toContain("gh issue view ${issue_number}");
		expect(
			prompt,
			"review prompt must include gh issue view instruction for parent goal issue",
		).toContain("gh issue view ${goal_issue_number}");

		expect(
			prompt,
			"review prompt must direct reviewer to inspect local repo worktree",
		).toContain("Inspect the local repo at ${worktree_dir}");

		expect(
			prompt.toLowerCase(),
			"review prompt must require issue-scoped revision guidance",
		).toContain("issue-scoped");

		expect(
			prompt,
			"review prompt must explicitly include not-QA boundary instruction",
		).toContain("Code review is not QA");
		expect(
			prompt,
			"review prompt must prevent generic QA-executor behavior",
		).toContain("Do not turn this into a generic QA executor");

		expect(
			prompt,
			"review prompt must instruct reviewers to read the capability SKILL.md contract",
		).toContain("${capability_coding_skills}/code_review/SKILL.md");
		expect(
			prompt,
			"review prompt must instruct reviewers to read the local REPO.md addendum",
		).toContain("${capability_coding_skills}/code_review/REPO.md");
		expect(
			prompt,
			"review prompt must include reviewer context artifact path variable",
		).toContain("${review_context_path}");
		expect(
			prompt,
			"review prompt must include reviewer context hash variable",
		).toContain("${review_context_sha256}");
		expect(
			prompt,
			"review prompt must include optional builder notes handoff",
		).toContain("${builder_notes}");
		expect(
			prompt,
			"review prompt must include issue title context",
		).toContain("${issue_title}");
		expect(
			prompt,
			"review prompt must include issue body context",
		).toContain("${issue_body}");
		expect(
			prompt,
			"review prompt must include parent goal JSON context",
		).toContain("${goal_issue}");
		expect(
			prompt,
			"review prompt must include intent stack context",
		).toContain("${intent_stack}");
		expect(
			prompt,
			"review prompt must include review evidence path context",
		).toContain("${review_evidence_path}");
		expect(
			prompt,
			"review prompt must include branch context",
		).toContain("${branch}");
		expect(
			prompt,
			"review prompt must include gh repo context",
		).toContain("${gh_repo}");
	});

	it("asserts all required context variables and schema requirements are present", () => {
		const prompt = loadReviewPrompt();

		// Context variables
		expect(prompt).toContain("${intent_stack}");
		expect(prompt).toContain("${goal_issue}");
		expect(prompt).toContain("${issue_title}");
		expect(prompt).toContain("${issue_body}");
		expect(prompt).toContain("${review_evidence_path}");
		expect(prompt).toContain("${changed_files}");
		expect(prompt).toContain("${latest_issue_change_summary}");

		// Issue-scoped review scope variables (root-cause fix for force-merge recurrence)
		expect(
			prompt,
			"review prompt must include issue-scoped changed files variable from write_review_evidence output",
		).toContain("${issue_changed_files}");
		expect(
			prompt,
			"review prompt must label full branch diff as branch-wide context, not the judge scope",
		).toContain("Full branch changed files");
		expect(
			prompt,
			"review prompt must label issue-scoped files as the judge scope",
		).toContain("Issue-scoped changed files");
		expect(
			prompt,
			"review prompt must include explicit judge instruction to use issue_changed_files scope only",
		).toContain("Judge the implementation against issue_changed_files only");

		// Structural policy requirements
		expect(prompt).toContain("reviewer_context/v1");
		expect(prompt).toContain("policy_sources");
		expect(prompt).toContain("effective_policy");

		// Review-flow requirements
		expect(prompt).toContain("Restate the promised change");
		expect(prompt).toContain("issue-scoped files");
	});

	it("keeps reviewer context schema contract stable and complete", () => {
		expect(REVIEWER_CONTEXT_SCHEMA_VERSION).toBe("reviewer_context/v1");
		expect(REVIEWER_CONTEXT_REQUIRED_KEYS.length).toBe(13);

		const expectedKeys = [
			"schema_version",
			"issue_number",
			"issue_excerpt",
			"branch",
			"snapshot_sha",
			"issue_commit_subjects",
			"diff_summary",
			"changed_files",
			"evidence_artifact_path",
			"evidence_artifact_sha256",
			"policy_refs",
			"policy_sources",
			"effective_policy",
		].sort();

		const requiredKeys = new Set(REVIEWER_CONTEXT_REQUIRED_KEYS);
		expect(requiredKeys.size).toBe(REVIEWER_CONTEXT_REQUIRED_KEYS.length);
		for (const key of expectedKeys) {
			expect(requiredKeys.has(key), `missing required reviewer context key: ${key}`).toBe(true);
		}
		expect([...requiredKeys].sort()).toEqual(expectedKeys);
	});
});

describe("capability issue_execute_item.dot reviewer prompt contract", () => {
	it("keeps semantic reviewer framing, full context inspection instructions, and non-QA boundary", () => {
		const prompt = loadIssueExecuteItemReviewPrompt();

		expect(prompt.toLowerCase()).toContain("semantic code reviewer");
		expect(prompt).toContain("gh issue view ${issue_number}");
		expect(prompt).toContain("gh issue view ${goal_issue_number}");
		expect(prompt).toContain("Inspect the local repo at ${worktree_dir}");
		expect(prompt.toLowerCase()).toContain("issue-scoped");
		expect(prompt).toContain("Code review is not QA");
		expect(prompt).toContain("Do not turn this into a generic QA executor");
		expect(prompt).toContain("${capability_coding_skills}/code_review/SKILL.md");
		expect(prompt).toContain("${capability_coding_skills}/code_review/REPO.md");
		expect(prompt).toContain("${review_context_path}");
		expect(prompt).toContain("${review_context_sha256}");
		expect(prompt).toContain("${goal_issue_number}");
		expect(prompt).toContain("${intent_stack}");
		expect(prompt).toContain("${milestone_title}");
		expect(prompt).toContain("${latest_issue_change_summary}");
		expect(prompt).toContain("${gh_repo}");
		expect(prompt).toContain("${issue_title}");
		expect(prompt).toContain("${issue_body}");
		expect(prompt).toContain("${builder_notes}");
		expect(prompt).toContain("${commits_ahead}");
		expect(prompt).toContain("${changed_files}");
	});
});
