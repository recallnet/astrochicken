import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { nodeClass, nodeHandlerType, nodeLLMModel, nodeLLMProvider, nodeTrustRole, type Graph } from "./graph.js";
import { parseWithAst } from "./parse.js";
import { applyGraphStylesheetImports } from "./stylesheet-imports.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../../../");

interface SupervisorCase {
	graphPath: string;
	factoryTrustRole: string;
	provider: string;
	model: string;
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

function readGraph(graphPath: string): string {
	return readFileSync(join(REPO_ROOT, graphPath), "utf8");
}

describe("Stage 4 supervisor role unification surface", () => {
	const supervisorGraphs: SupervisorCase[] = [
		{
			graphPath: "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot",
			factoryTrustRole: "mothership.local.stack.manager_loop",
			provider: "openrouter",
			model: "anthropic/claude-sonnet-4.6",
		},
		{
			graphPath: "factories/example-trading/graphs/domain_example_trading.dot",
			factoryTrustRole: "example-trading.local.stack.manager_loop",
			provider: "openrouter",
			model: "openai/gpt-5.3-codex",
		},
	];

	it("routes bug-fast and tick-review tasks through one canonical supervisor role without adding persistence yet", () => {
		for (const testCase of supervisorGraphs) {
			const graph = loadResolvedGraph(testCase.graphPath);
			const bugNode = graph.nodes.supervisor_review_bug_fast;
			const tickNode = graph.nodes.supervisor_review;

			expect(bugNode, `${testCase.graphPath}::supervisor_review_bug_fast must exist`).toBeTruthy();
			expect(tickNode, `${testCase.graphPath}::supervisor_review must exist`).toBeTruthy();

			for (const [nodeId, node, taskPromptSource, expectedKeys] of [
				[
					"supervisor_review_bug_fast",
					bugNode,
					"supervisor_bug_fast_task_prompt",
					[
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
				],
				[
					"supervisor_review",
					tickNode,
					"supervisor_review_task_prompt",
					[
						"target_repo",
						"date",
						"factory_id",
						"control_plane_repo",
						"gh_repo",
						"supervisor_skill_content",
						"supervisor_rules_content",
						"state_snapshot",
					],
				],
			] as const) {
				expect(nodeClass(node)).toBe("supervisor");
				expect(nodeHandlerType(node)).toBe("stack.manager_loop");
				expect(nodeLLMProvider(node)).toBe(testCase.provider);
				expect(nodeLLMModel(node)).toBe(testCase.model);
				expect(nodeTrustRole(node)).toBe(testCase.factoryTrustRole);
				expect(String(node.attrs.session_id || "")).toBe("supervisor-${factory_id}");
				expect(String(node.attrs.system_prompt_source || "")).toBe("supervisor_system_prompt");
				expect(String(node.attrs.task_prompt_source || "")).toBe(taskPromptSource);
				expect(String(node.attrs.prompt_source || "")).toBe(taskPromptSource);
				expect(String(node.attrs.prompt_input_keys || "")).toBe(expectedKeys.join(","));
				expect(String(node.attrs.prompt || "")).toContain("${supervisor_system_prompt}");
				expect(String(node.attrs.prompt || "")).toContain(`\${${taskPromptSource}}`);
				for (const key of expectedKeys) {
					expect(String(node.attrs.prompt || ""), `${testCase.graphPath}::${nodeId} prompt must reference ${key}`).toContain(`\${${key}}`);
				}
			}
		}
	});

	it("assigns distinct supervisor skill ids for bug-fast vs review while keeping the shared supervisor session", () => {
		for (const testCase of supervisorGraphs) {
			const graph = loadResolvedGraph(testCase.graphPath);
			expect(String(graph.nodes.supervisor_review_bug_fast?.attrs.skill_id || "")).toBe("supervisor.review_bug_fast");
			expect(String(graph.nodes.supervisor_review?.attrs.skill_id || "")).toBe("supervisor.review");
			expect(String(graph.nodes.supervisor_review_bug_fast?.attrs.session_id || "")).toBe("supervisor-${factory_id}");
			expect(String(graph.nodes.supervisor_review?.attrs.session_id || "")).toBe("supervisor-${factory_id}");
		}
	});

	it("keeps supervisor task packs distinct and preserves their route-specific inputs", () => {
		for (const graphPath of supervisorGraphs.map((entry) => entry.graphPath)) {
			const dot = readGraph(graphPath);
			expect(dot).toContain('load_supervisor_bug_fast_task_prompt [type="tool"');
			expect(dot).toContain('load_supervisor_review_task_prompt [type="tool"');
			expect(dot).toContain('output_key="supervisor_bug_fast_task_prompt"');
			expect(dot).toContain('output_key="supervisor_review_task_prompt"');
			expect(dot).toContain('prompt="cat packages/factory-prompts/prompts/supervisor/bug_fast.md"');
			expect(dot).toContain('prompt="cat packages/factory-prompts/prompts/supervisor/review.md"');
			if (graphPath.includes("example-trading")) {
				expect(dot).toMatch(/fast_route_telemetry_open -> supervisor_review_bug_fast/);
				expect(dot).toMatch(/action_item_gate -> supervisor_review \[condition="has_action_items=true"\]/);
			} else {
				expect(dot).toMatch(/set_date_fast -> load_supervisor_bug_fast_task_prompt/);
				expect(dot).toMatch(/load_supervisor_bug_fast_task_prompt -> supervisor_review_bug_fast/);
				expect(dot).toMatch(/action_item_gate -> load_supervisor_review_task_prompt \[condition="has_action_items=true"\]/);
				expect(dot).toMatch(/load_supervisor_review_task_prompt -> supervisor_review/);
			}
		}
	});

	it("keeps merge resolver isolated from the supervisor role family", () => {
		const mergeGraphs = [
			"docs/contracts/workflow-ir/mothership/goal_execute.dot",
			"docs/contracts/workflow-ir/capability-software-development/goal_execute.dot",
		];

		for (const graphPath of mergeGraphs) {
			const graph = loadResolvedGraph(graphPath);
			for (const nodeId of [
				"resolve_conflict",
				"retry_resolve_conflict",
				"resolve_post_merge",
				"retry_resolve_post_merge",
				"resolve_push_failure",
			]) {
				const node = graph.nodes[nodeId];
				if (!node) continue;
				expect(nodeClass(node), `${graphPath}::${nodeId} must stay isolated from supervisor`).toBe("merge_resolver");
				expect(
					["stack.manager_loop", "codergen"].includes(nodeHandlerType(node)),
					`${graphPath}::${nodeId} must remain on merge-resolver handler surface (stack.manager_loop or codergen)`,
				).toBe(true);
				expect(String(node.attrs.system_prompt_source || "")).toBe("merge_resolver_system_prompt");
				expect(String(node.attrs.task_prompt_source || "")).not.toContain("supervisor");
			}
		}
	});
});
