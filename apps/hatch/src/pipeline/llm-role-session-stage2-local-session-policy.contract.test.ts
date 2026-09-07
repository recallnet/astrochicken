import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseWithAst } from "./parse.js";
import { applyGraphStylesheetImports } from "./stylesheet-imports.js";

import type { Graph } from "./graph.js";

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

function sessionId(graph: Graph, nodeId: string): string {
	return String(graph.nodes[nodeId]?.attrs.session_id || "");
}

describe("Stage 2 local session policy contract", () => {
	it("pins the exact run-scoped session sharing groups", () => {
		const goalDecomposeGraph = loadResolvedGraph("docs/contracts/workflow-ir/capability-goal-decomposition/goal_intake_decompose.dot");
		const issueWriterGraph = loadResolvedGraph("docs/contracts/workflow-ir/capability-goal-decomposition/write_issue_item.dot");
		expect(sessionId(goalDecomposeGraph, "analyze")).toBe("goal-decomposer-${issue_number}");
		expect(sessionId(goalDecomposeGraph, "propose")).toBe("goal-decomposer-${issue_number}");
		expect(sessionId(goalDecomposeGraph, "review")).toBe("goal-decomposer-${issue_number}");

		expect(sessionId(issueWriterGraph, "draft_issue_spec")).toBe("goal-decomposer-${issue_number}");
		expect(sessionId(issueWriterGraph, "repair_issue_spec")).toBe("goal-decomposer-${issue_number}");
		expect(sessionId(issueWriterGraph, "revise_issue_spec")).toBe("goal-decomposer-${issue_number}");
	});

	it("pins the exact non-sharing boundaries for local loops", () => {
		const goalDecomposeGraph = loadResolvedGraph("docs/contracts/workflow-ir/capability-goal-decomposition/goal_intake_decompose.dot");
		const issueWriterGraph = loadResolvedGraph("docs/contracts/workflow-ir/capability-goal-decomposition/write_issue_item.dot");
		expect(sessionId(issueWriterGraph, "draft_issue_spec")).not.toBe(sessionId(issueWriterGraph, "judge_issue"));
		expect(sessionId(issueWriterGraph, "judge_issue")).toBe("");
	});
});
