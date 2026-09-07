import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { nodeClass, nodeHandlerType, nodeLLMModel, nodeLLMProvider, nodeTrustRole, type Graph } from "./graph.js";
import { parseWithAst } from "./parse.js";
import { applyGraphStylesheetImports } from "./stylesheet-imports.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../../../");

function loadResolvedGraph(graphPath: string, applyImports = true): Graph {
	const absoluteGraphPath = join(REPO_ROOT, graphPath);
	const parsed = parseWithAst(readFileSync(absoluteGraphPath, "utf8"));
	if (applyImports) {
		applyGraphStylesheetImports({
			graph: parsed.graph,
			graphFile: absoluteGraphPath,
			stylesheetImports: parsed.stylesheetImports,
			repoRootPath: REPO_ROOT,
		});
	}
	return parsed.graph;
}

describe("Stage 1 explicit functional role rename contract", () => {
	it("preserves runtime semantics for remaining renamed nodes", () => {
		const cases = [
			{
				graphPath: "docs/contracts/workflow-ir/capability-goal-decomposition/goal_intake_decompose.dot",
				nodeIds: ["analyze", "propose", "review"],
				expectedClass: "goal_decomposer",
				expectedHandlerType: "codergen",
				expectedProvider: "",
				expectedModel: "",
				expectedTrustRole: "unknown",
			},
			{
				graphPath: "docs/contracts/workflow-ir/capability-goal-decomposition/goal_batch.dot",
				nodeIds: ["review_goals", "repair_decisions"],
				expectedClass: "goal_batch_reviewer",
				expectedHandlerType: "codergen",
				expectedProvider: "",
				expectedModel: "",
				expectedTrustRole: "unknown",
			},
			{
				graphPath: "docs/contracts/workflow-ir/capability-goal-decomposition/write_issue_item.dot",
				nodeIds: ["judge_issue"],
				expectedClass: "issue_quality_judge",
				expectedHandlerType: "codergen",
				expectedProvider: "",
				expectedModel: "openai/gpt-5.3-codex",
				expectedTrustRole: "unknown",
			},
			{
				graphPath: "docs/contracts/workflow-ir/capability-product-judge/product_judge.dot",
				nodeIds: ["judge"],
				expectedClass: "post_merge_judge",
				expectedHandlerType: "codergen",
				expectedProvider: "",
				expectedModel: "",
				expectedTrustRole: "unknown",
			},
			{
				graphPath: "docs/contracts/workflow-ir/mothership/goal_execute.dot",
				nodeIds: ["judge"],
				expectedClass: "post_merge_judge",
				expectedHandlerType: "codergen",
				expectedProvider: "",
				expectedModel: "",
				expectedTrustRole: "unknown",
				applyImports: false,
			},
			{
				graphPath: "docs/contracts/workflow-ir/capability-software-development/goal_execute.dot",
				nodeIds: ["judge"],
				expectedClass: "post_merge_judge",
				expectedHandlerType: "codergen",
				expectedProvider: "",
				expectedModel: "",
				expectedTrustRole: "unknown",
				applyImports: false,
			},
			// Note: factory-local triage.dot files were removed as part of the
		// @hatch/capability-triage extraction. Triage planner semantics are
		// now verified by the capability-triage-manifest.contract.test.ts.
		];

		for (const testCase of cases) {
			const graph = loadResolvedGraph(testCase.graphPath, testCase.applyImports ?? true);
			for (const nodeId of testCase.nodeIds) {
				const node = graph.nodes[nodeId];
				expect(node, `${testCase.graphPath}::${nodeId} must exist`).toBeTruthy();
				expect(nodeClass(node)).toBe(testCase.expectedClass);
				expect(nodeHandlerType(node)).toBe(testCase.expectedHandlerType);
				expect(nodeLLMProvider(node)).toBe(testCase.expectedProvider);
				expect(nodeLLMModel(node)).toBe(testCase.expectedModel);
				expect(nodeTrustRole(node)).toBe(testCase.expectedTrustRole);
			}
		}
	});

	it("keeps the mothership role bundle aligned with the prior broad-role semantics", () => {
		const stylesheet = readFileSync(join(REPO_ROOT, "factories/mothership/roles.stylesheet"), "utf8");

		expect(stylesheet).toMatch(/\.goal_decomposer\s*\{/);
		expect(stylesheet).toMatch(/\.goal_batch_reviewer\s*\{/);
		expect(stylesheet).toMatch(/\.issue_quality_judge\s*\{/);
		expect(stylesheet).toMatch(/\.post_merge_judge\s*\{/);
		expect(stylesheet).toContain('llm_model = "anthropic/claude-sonnet-4.6"');
		expect(stylesheet).toContain('trust_role = "mothership.local.codergen"');
	});
});
