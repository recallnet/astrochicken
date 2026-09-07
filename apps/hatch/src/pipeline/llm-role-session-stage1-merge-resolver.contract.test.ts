import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { nodeClass, nodeHandlerType, nodeLLMModel, nodeLLMProvider, nodeTrustRole, type Graph } from "./graph.js";
import { parseWithAst } from "./parse.js";
import { applyGraphStylesheetImports } from "./stylesheet-imports.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../../../");

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

describe("Stage 1 merge_resolver role rename contract", () => {
	it("preserves runtime semantics for renamed merge-resolution nodes", () => {
		const cases = [
			{
				graphPath: "docs/contracts/workflow-ir/mothership/goal_execute.dot",
				nodeIds: [
					"resolve_conflict",
					"retry_resolve_conflict",
					"resolve_post_merge",
					"retry_resolve_post_merge",
					"resolve_push_failure",
				],
				expectedHandlerType: "stack.manager_loop",
				expectedProvider: "openrouter",
				expectedModel: "anthropic/claude-sonnet-4.6",
				expectedTrustRole: "mothership.local.stack.manager_loop",
				expectedSessionId: "",
			},
			{
				graphPath: "docs/contracts/workflow-ir/capability-software-development/goal_execute.dot",
				nodeIds: [
					"resolve_conflict",
					"retry_resolve_conflict",
					"resolve_post_merge",
					"retry_resolve_post_merge",
					"resolve_push_failure",
				],
				expectedHandlerType: "stack.manager_loop",
				expectedProvider: "",
				expectedModel: "",
				expectedTrustRole: "manager.supervisor",
				expectedSessionId: "",
			},
			{
				graphPath: "docs/contracts/workflow-ir/capability-merge/merge_item.dot",
				nodeIds: ["resolve_conflict", "retry_resolve_conflict"],
				expectedHandlerType: "codergen",
				expectedProvider: "",
				expectedModel: "",
				expectedTrustRole: "unknown",
				expectedSessionId: "",
			},
		];

		for (const testCase of cases) {
			const graph = loadResolvedGraph(testCase.graphPath);
			for (const nodeId of testCase.nodeIds) {
				const node = graph.nodes[nodeId];
				expect(node, `${testCase.graphPath}::${nodeId} must exist`).toBeTruthy();
				expect(nodeClass(node)).toBe("merge_resolver");
				expect(nodeHandlerType(node)).toBe(testCase.expectedHandlerType);
				expect(nodeLLMProvider(node)).toBe(testCase.expectedProvider);
				expect(nodeLLMModel(node)).toBe(testCase.expectedModel);
				expect(nodeTrustRole(node)).toBe(testCase.expectedTrustRole);
				expect(String(node.attrs.session_id || "")).toBe(testCase.expectedSessionId);
			}
		}
	});
});
