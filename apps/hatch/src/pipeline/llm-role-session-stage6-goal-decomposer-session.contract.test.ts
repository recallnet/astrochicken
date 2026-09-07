import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { Context } from "./context.js";
import { expandVariables } from "./engine.js";
import { parseWithAst } from "./parse.js";
import { applyGraphStylesheetImports } from "./stylesheet-imports.js";

import type { Graph } from "./graph.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../../../");
const GOAL_DECOMPOSER_SESSION_TEMPLATE = "goal-decomposer-${issue_number}";

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

describe("Stage 6 persistent goal decomposer session contract", () => {
	it("binds goal_decomposer analyze/propose/review to one deterministic goal-scoped session id across runs", () => {
		const graph = loadResolvedGraph("docs/contracts/workflow-ir/capability-goal-decomposition/goal_intake_decompose.dot");
		const analyzeNode = graph.nodes.analyze;
		const proposeNode = graph.nodes.propose;
		const reviewNode = graph.nodes.review;

		expect(String(analyzeNode?.attrs.session_id || "")).toBe(GOAL_DECOMPOSER_SESSION_TEMPLATE);
		expect(String(proposeNode?.attrs.session_id || "")).toBe(GOAL_DECOMPOSER_SESSION_TEMPLATE);
		expect(String(reviewNode?.attrs.session_id || "")).toBe(GOAL_DECOMPOSER_SESSION_TEMPLATE);

		const sameGoalRunOne = new Context({ issue_number: "123", __run_id: "goal-run-1" });
		const sameGoalRunTwo = new Context({ issue_number: "123", __run_id: "goal-run-2" });
		const otherGoal = new Context({ issue_number: "456", __run_id: "goal-run-3" });

		const analyzeSameGoalRunOne = expandVariables(String(analyzeNode?.attrs.session_id || ""), sameGoalRunOne);
		const proposeSameGoalRunOne = expandVariables(String(proposeNode?.attrs.session_id || ""), sameGoalRunOne);
		const reviewSameGoalRunTwo = expandVariables(String(reviewNode?.attrs.session_id || ""), sameGoalRunTwo);
		const analyzeOtherGoal = expandVariables(String(analyzeNode?.attrs.session_id || ""), otherGoal);

		expect(analyzeSameGoalRunOne).toBe("goal-decomposer-123");
		expect(proposeSameGoalRunOne).toBe(analyzeSameGoalRunOne);
		expect(reviewSameGoalRunTwo).toBe(analyzeSameGoalRunOne);
		expect(analyzeOtherGoal).toBe("goal-decomposer-456");
		expect(analyzeOtherGoal).not.toBe(analyzeSameGoalRunOne);
	});

	it("limits the persistent goal session to goal_decomposer nodes only", () => {
		const goalIntakeGraph = loadResolvedGraph("docs/contracts/workflow-ir/capability-goal-decomposition/goal_intake_decompose.dot");
		const goalBatchGraph = loadResolvedGraph("docs/contracts/workflow-ir/capability-goal-decomposition/goal_batch.dot");

		const sessionBoundNodes = ["analyze", "propose", "review"].map((nodeId) => String(goalIntakeGraph.nodes[nodeId]?.attrs.session_id || ""));
		expect(new Set(sessionBoundNodes)).toEqual(new Set([GOAL_DECOMPOSER_SESSION_TEMPLATE]));

		for (const [nodeId, node] of Object.entries(goalIntakeGraph.nodes)) {
			if (["analyze", "propose", "review"].includes(nodeId)) continue;
			expect(String(node.attrs.session_id || "")).not.toBe(GOAL_DECOMPOSER_SESSION_TEMPLATE);
		}

		for (const nodeId of ["review_goals", "repair_decisions"]) {
			expect(String(goalBatchGraph.nodes[nodeId]?.attrs.session_id || "")).toBe("");
		}
	});
});
