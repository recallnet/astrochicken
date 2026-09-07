import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { nodeClass, nodeHandlerType, nodeLLMModel, nodeLLMProvider, nodeTrustRole, type Graph, type Node } from "./graph.js";
import { parseWithAst } from "./parse.js";
import { applyGraphStylesheetImports } from "./stylesheet-imports.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../../../");

interface PromptPackCase {
	graphPath: string;
	nodeId: string;
	expectedClass: string;
	expectedHandlerType: string;
	expectedProvider: string;
	expectedModel: string;
	expectedTrustRole: string;
	expectedSessionId?: string;
	systemPromptSource: string;
	taskPromptSource: string;
	promptInputKeys: string[];
}

function loadGraph(graphPath: string): Graph {
	const absoluteGraphPath = join(REPO_ROOT, graphPath);
	return parseWithAst(readFileSync(absoluteGraphPath, "utf8")).graph;
}

function loadResolvedGraph(graphPath: string): Graph {
	const absoluteGraphPath = join(REPO_ROOT, graphPath);
	const parsed = parseWithAst(readFileSync(absoluteGraphPath, "utf8"));
	applyGraphStylesheetImports({
		graph: parsed.graph,
		graphFile: absoluteGraphPath,
		stylesheetImports: parsed.stylesheetImports,
		repoRootPath: REPO_ROOT,
	});
	return parsed.graph;
}

function findPromptLoader(graph: Graph, outputKey: string): Node {
	const matches = Object.values(graph.nodes).filter((node) => String(node.attrs.output_key || "") === outputKey);
	expect(matches, `must declare exactly one prompt loader for output_key=${outputKey}`).toHaveLength(1);
	return matches[0]!;
}

function catPathFromLoader(loaderNode: Node): string {
	const prompt = String(loaderNode.attrs.prompt || "").trim();
	const match = prompt.match(/^cat\s+(.+)$/);
	expect(match, `${loaderNode.id} must load a prompt file with cat`).toBeTruthy();
	return String(match?.[1] || "").replace(/^['"]|['"]$/g, "");
}

describe("Stage 3 prompt pack extraction contract", () => {
	const cases: PromptPackCase[] = [
		{
			graphPath: "docs/contracts/workflow-ir/capability-goal-decomposition/goal_intake_decompose.dot",
			nodeId: "analyze",
			expectedClass: "goal_decomposer",
			expectedHandlerType: "codergen",
			expectedProvider: "",
			expectedModel: "",
			expectedTrustRole: "unknown",
			expectedSessionId: "goal-decomposer-${issue_number}",
			systemPromptSource: "goal_decomposer_system_prompt",
			taskPromptSource: "goal_decompose_analyze_task_prompt",
			promptInputKeys: [
				"gh_repo",
				"goal_analyzer_skill",
				"intent_stack",
				"goal_issue",
				"external_bug_report",
				"external_bug_errors",
				"external_bug_present",
				"external_bug_intake_activated",
				"existing_issues",
				"feature_inventory",
			],
		},
		{
			graphPath: "docs/contracts/workflow-ir/capability-goal-decomposition/goal_intake_decompose.dot",
			nodeId: "propose",
			expectedClass: "goal_decomposer",
			expectedHandlerType: "codergen",
			expectedProvider: "",
			expectedModel: "",
			expectedTrustRole: "unknown",
			expectedSessionId: "goal-decomposer-${issue_number}",
			systemPromptSource: "goal_decomposer_system_prompt",
			taskPromptSource: "goal_decompose_propose_task_prompt",
			promptInputKeys: ["gh_repo", "intent_stack", "goal_context", "review_notes"],
		},
		{
			graphPath: "docs/contracts/workflow-ir/capability-goal-decomposition/goal_intake_decompose.dot",
			nodeId: "review",
			expectedClass: "goal_decomposer",
			expectedHandlerType: "codergen",
			expectedProvider: "",
			expectedModel: "",
			expectedTrustRole: "unknown",
			expectedSessionId: "goal-decomposer-${issue_number}",
			systemPromptSource: "goal_decomposer_system_prompt",
			taskPromptSource: "goal_decompose_review_task_prompt",
			promptInputKeys: ["gh_repo", "intent_stack", "goal_context", "proposed_features", "decompose_complexity", "reason"],
		},

		{
			graphPath: "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot",
			nodeId: "supervisor_review_bug_fast",
			expectedClass: "supervisor",
			expectedHandlerType: "stack.manager_loop",
			expectedProvider: "openrouter",
			expectedModel: "anthropic/claude-sonnet-4.6",
			expectedTrustRole: "mothership.local.stack.manager_loop",
			systemPromptSource: "supervisor_system_prompt",
			taskPromptSource: "supervisor_bug_fast_task_prompt",
			promptInputKeys: [
				"target_repo",
				"date",
				"factory_id",
				"control_plane_repo",
				"gh_repo",
				"intent_stack",
				"supervisor_skill_content",
				"supervisor_rules_content",
				"state_snapshot",
			],
		},
		{
			graphPath: "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot",
			nodeId: "supervisor_review",
			expectedClass: "supervisor",
			expectedHandlerType: "stack.manager_loop",
			expectedProvider: "openrouter",
			expectedModel: "anthropic/claude-sonnet-4.6",
			expectedTrustRole: "mothership.local.stack.manager_loop",
			systemPromptSource: "supervisor_system_prompt",
			taskPromptSource: "supervisor_review_task_prompt",
			promptInputKeys: [
				"target_repo",
				"date",
				"factory_id",
				"control_plane_repo",
				"gh_repo",
				"supervisor_skill_content",
				"supervisor_rules_content",
				"state_snapshot",
			],
		},
		{
			graphPath: "factories/example-trading/graphs/domain_example_trading.dot",
			nodeId: "supervisor_review_bug_fast",
			expectedClass: "supervisor",
			expectedHandlerType: "stack.manager_loop",
			expectedProvider: "openrouter",
			expectedModel: "openai/gpt-5.3-codex",
			expectedTrustRole: "example-trading.local.stack.manager_loop",
			systemPromptSource: "supervisor_system_prompt",
			taskPromptSource: "supervisor_bug_fast_task_prompt",
			promptInputKeys: [
				"target_repo",
				"date",
				"factory_id",
				"control_plane_repo",
				"gh_repo",
				"intent_stack",
				"supervisor_skill_content",
				"supervisor_rules_content",
				"state_snapshot",
			],
		},
		{
			graphPath: "factories/example-trading/graphs/domain_example_trading.dot",
			nodeId: "supervisor_review",
			expectedClass: "supervisor",
			expectedHandlerType: "stack.manager_loop",
			expectedProvider: "openrouter",
			expectedModel: "openai/gpt-5.3-codex",
			expectedTrustRole: "example-trading.local.stack.manager_loop",
			systemPromptSource: "supervisor_system_prompt",
			taskPromptSource: "supervisor_review_task_prompt",
			promptInputKeys: [
				"target_repo",
				"date",
				"factory_id",
				"control_plane_repo",
				"gh_repo",
				"supervisor_skill_content",
				"supervisor_rules_content",
				"state_snapshot",
			],
		},
		{
			graphPath: "docs/contracts/workflow-ir/capability-merge/merge_item.dot",
			nodeId: "resolve_conflict",
			expectedClass: "merge_resolver",
			expectedHandlerType: "codergen",
			expectedProvider: "",
			expectedModel: "",
			expectedTrustRole: "unknown",
			expectedSessionId: "",
			systemPromptSource: "merge_resolver_system_prompt",
			taskPromptSource: "merge_resolve_conflict_task_prompt",
			promptInputKeys: ["capability_merge_skills", "conflict_packet_path"],
		},
		{
			graphPath: "docs/contracts/workflow-ir/capability-merge/merge_item.dot",
			nodeId: "retry_resolve_conflict",
			expectedClass: "merge_resolver",
			expectedHandlerType: "codergen",
			expectedProvider: "",
			expectedModel: "",
			expectedTrustRole: "unknown",
			expectedSessionId: "",
			systemPromptSource: "merge_resolver_system_prompt",
			taskPromptSource: "merge_resolve_conflict_retry_task_prompt",
			promptInputKeys: ["capability_merge_skills", "conflict_packet_path"],
		},
		{
			graphPath: "docs/contracts/workflow-ir/mothership/goal_execute.dot",
			nodeId: "resolve_conflict",
			expectedClass: "merge_resolver",
			expectedHandlerType: "stack.manager_loop",
			expectedProvider: "openrouter",
			expectedModel: "anthropic/claude-sonnet-4.6",
			expectedTrustRole: "mothership.local.stack.manager_loop",
			expectedSessionId: "",
			systemPromptSource: "merge_resolver_system_prompt",
			taskPromptSource: "merge_resolve_conflict_task_prompt",
			promptInputKeys: ["capability_merge_skills", "conflict_packet_path"],
		},
		{
			graphPath: "docs/contracts/workflow-ir/capability-software-development/goal_execute.dot",
			nodeId: "resolve_conflict",
			expectedClass: "merge_resolver",
			expectedHandlerType: "stack.manager_loop",
			expectedProvider: "",
			expectedModel: "",
			expectedTrustRole: "manager.supervisor",
			expectedSessionId: "",
			systemPromptSource: "merge_resolver_system_prompt",
			taskPromptSource: "merge_resolve_conflict_task_prompt",
			promptInputKeys: ["capability_merge_skills", "conflict_packet_path"],
		},
		{
			graphPath: "docs/contracts/workflow-ir/mothership/goal_execute.dot",
			nodeId: "retry_resolve_conflict",
			expectedClass: "merge_resolver",
			expectedHandlerType: "stack.manager_loop",
			expectedProvider: "openrouter",
			expectedModel: "anthropic/claude-sonnet-4.6",
			expectedTrustRole: "mothership.local.stack.manager_loop",
			expectedSessionId: "",
			systemPromptSource: "merge_resolver_system_prompt",
			taskPromptSource: "merge_finalize_retry_task_prompt",
			promptInputKeys: ["finalize_reason", "finalize_detail", "conflict_packet_path"],
		},
		{
			graphPath: "docs/contracts/workflow-ir/capability-software-development/goal_execute.dot",
			nodeId: "retry_resolve_conflict",
			expectedClass: "merge_resolver",
			expectedHandlerType: "stack.manager_loop",
			expectedProvider: "",
			expectedModel: "",
			expectedTrustRole: "manager.supervisor",
			expectedSessionId: "",
			systemPromptSource: "merge_resolver_system_prompt",
			taskPromptSource: "merge_finalize_retry_task_prompt",
			promptInputKeys: ["finalize_reason", "finalize_detail", "conflict_packet_path"],
		},
		{
			graphPath: "docs/contracts/workflow-ir/mothership/goal_execute.dot",
			nodeId: "resolve_post_merge",
			expectedClass: "merge_resolver",
			expectedHandlerType: "stack.manager_loop",
			expectedProvider: "openrouter",
			expectedModel: "anthropic/claude-sonnet-4.6",
			expectedTrustRole: "mothership.local.stack.manager_loop",
			expectedSessionId: "",
			systemPromptSource: "merge_resolver_system_prompt",
			taskPromptSource: "merge_resolve_post_merge_task_prompt",
			promptInputKeys: ["capability_merge_skills", "merge_stderr", "conflict_packet_path"],
		},
		{
			graphPath: "docs/contracts/workflow-ir/capability-software-development/goal_execute.dot",
			nodeId: "resolve_post_merge",
			expectedClass: "merge_resolver",
			expectedHandlerType: "stack.manager_loop",
			expectedProvider: "",
			expectedModel: "",
			expectedTrustRole: "manager.supervisor",
			expectedSessionId: "",
			systemPromptSource: "merge_resolver_system_prompt",
			taskPromptSource: "merge_resolve_post_merge_task_prompt",
			promptInputKeys: ["capability_merge_skills", "merge_stderr", "conflict_packet_path"],
		},
		{
			graphPath: "docs/contracts/workflow-ir/mothership/goal_execute.dot",
			nodeId: "retry_resolve_post_merge",
			expectedClass: "merge_resolver",
			expectedHandlerType: "stack.manager_loop",
			expectedProvider: "openrouter",
			expectedModel: "anthropic/claude-sonnet-4.6",
			expectedTrustRole: "mothership.local.stack.manager_loop",
			expectedSessionId: "",
			systemPromptSource: "merge_resolver_system_prompt",
			taskPromptSource: "merge_post_merge_retry_task_prompt",
			promptInputKeys: ["finalize_reason", "finalize_detail"],
		},
		{
			graphPath: "docs/contracts/workflow-ir/capability-software-development/goal_execute.dot",
			nodeId: "retry_resolve_post_merge",
			expectedClass: "merge_resolver",
			expectedHandlerType: "stack.manager_loop",
			expectedProvider: "",
			expectedModel: "",
			expectedTrustRole: "manager.supervisor",
			expectedSessionId: "",
			systemPromptSource: "merge_resolver_system_prompt",
			taskPromptSource: "merge_post_merge_retry_task_prompt",
			promptInputKeys: ["finalize_reason", "finalize_detail"],
		},
		{
			graphPath: "docs/contracts/workflow-ir/mothership/goal_execute.dot",
			nodeId: "resolve_push_failure",
			expectedClass: "merge_resolver",
			expectedHandlerType: "stack.manager_loop",
			expectedProvider: "openrouter",
			expectedModel: "anthropic/claude-sonnet-4.6",
			expectedTrustRole: "mothership.local.stack.manager_loop",
			expectedSessionId: "",
			systemPromptSource: "merge_resolver_system_prompt",
			taskPromptSource: "merge_resolve_push_failure_task_prompt",
			promptInputKeys: ["capability_merge_skills", "push_stderr", "push_failure_packet_path"],
		},
		{
			graphPath: "docs/contracts/workflow-ir/capability-software-development/goal_execute.dot",
			nodeId: "resolve_push_failure",
			expectedClass: "merge_resolver",
			expectedHandlerType: "stack.manager_loop",
			expectedProvider: "",
			expectedModel: "",
			expectedTrustRole: "manager.supervisor",
			expectedSessionId: "",
			systemPromptSource: "merge_resolver_system_prompt",
			taskPromptSource: "merge_resolve_push_failure_task_prompt",
			promptInputKeys: ["capability_merge_skills", "push_stderr", "push_failure_packet_path"],
		},
	];

	it("keeps Stage 3 nodes on the same role/session/model runtime semantics while declaring prompt sources", () => {
		for (const testCase of cases) {
			const graph = loadResolvedGraph(testCase.graphPath);
			const node = graph.nodes[testCase.nodeId];
			expect(node, `${testCase.graphPath}::${testCase.nodeId} must exist`).toBeTruthy();
			expect(nodeClass(node)).toBe(testCase.expectedClass);
			expect(nodeHandlerType(node)).toBe(testCase.expectedHandlerType);
			expect(nodeLLMProvider(node)).toBe(testCase.expectedProvider);
			expect(nodeLLMModel(node)).toBe(testCase.expectedModel);
			expect(nodeTrustRole(node)).toBe(testCase.expectedTrustRole);
			if (testCase.expectedSessionId !== undefined) {
				expect(String(node.attrs.session_id || "")).toBe(testCase.expectedSessionId);
			}
			expect(String(node.attrs.system_prompt_source || "")).toBe(testCase.systemPromptSource);
			expect(String(node.attrs.task_prompt_source || "")).toBe(testCase.taskPromptSource);
			expect(String(node.attrs.prompt_source || "")).toBe(testCase.taskPromptSource);
			expect(String(node.attrs.prompt_input_keys || "")).toBe(testCase.promptInputKeys.join(","));
			expect(String(node.attrs.prompt || "")).toContain(`\${${testCase.systemPromptSource}}`);
			expect(String(node.attrs.prompt || "")).toContain(`\${${testCase.taskPromptSource}}`);
			for (const key of testCase.promptInputKeys) {
				expect(String(node.attrs.prompt || ""), `${testCase.graphPath}::${testCase.nodeId} prompt must reference ${key}`).toContain(`\${${key}}`);
			}
		}
	});

	it("loads every declared Stage 3 prompt source from a checked-in file", () => {
		const sourceRefs = new Map<string, { graphPath: string; filePath: string }>();
		for (const testCase of cases) {
			const graph = loadGraph(testCase.graphPath);
			for (const outputKey of [testCase.systemPromptSource, testCase.taskPromptSource]) {
				const loaderNode = findPromptLoader(graph, outputKey);
				const promptPath = catPathFromLoader(loaderNode);
				sourceRefs.set(`${testCase.graphPath}::${outputKey}`, { graphPath: testCase.graphPath, filePath: promptPath });
			}
		}

		for (const { graphPath, filePath } of sourceRefs.values()) {
			expect(existsSync(join(REPO_ROOT, filePath)), `${graphPath} prompt source missing on disk: ${filePath}`).toBe(true);
		}
	});
});
