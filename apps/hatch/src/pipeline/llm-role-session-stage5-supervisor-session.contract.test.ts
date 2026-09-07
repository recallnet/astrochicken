import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { Context } from "./context.js";
import { enrichTelemetryEvent } from "./engine-telemetry.js";
import { expandVariables } from "./engine.js";
import { nodeClass, type Graph } from "./graph.js";
import { parseWithAst } from "./parse.js";
import { applyGraphStylesheetImports } from "./stylesheet-imports.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../../../");
const SUPERVISOR_SESSION_TEMPLATE = "supervisor-${factory_id}";

interface FactoryCase {
	graphPath: string;
	factoryId: string;
	factoryName: string;
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

function stageStartTelemetry(args: {
	graphPath: string;
	graph: Graph;
	nodeId: string;
	runId: string;
	factoryId: string;
	factoryName: string;
}): Record<string, string> {
	const context = new Context({
		__run_id: args.runId,
		factory: args.factoryName,
		factory_id: args.factoryId,
		repo: "recallnet/astrochicken",
		prompt_hash: `sha256:${args.nodeId}`,
	});
	const enriched = enrichTelemetryEvent(
		{
			kind: "stage.start",
			nodeId: args.nodeId,
			data: {},
		},
		{
			graph: args.graph,
			graphId: args.graph.name,
			pipelineFile: args.graphPath,
			context,
			nextTelemetrySequence: () => 1,
			latestAttemptForNode: () => 1,
		},
	);
	return enriched.data || {};
}

describe("Stage 5 persistent supervisor session contract", () => {
	const factories: FactoryCase[] = [
		{
			graphPath: "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot",
			factoryId: "mothership/factory_supervisor",
			factoryName: "mothership",
		},
		{
			graphPath: "factories/example-trading/graphs/domain_example_trading.dot",
			factoryId: "example-trading/factory_supervisor",
			factoryName: "example-trading",
		},
	];

	it("binds bug-fast and tick-review supervisor nodes to one deterministic factory-scoped session id", () => {
		const resolvedSessionIds = new Map<string, string>();

		for (const testCase of factories) {
			const graph = loadResolvedGraph(testCase.graphPath);
			const bugNode = graph.nodes.supervisor_review_bug_fast;
			const tickNode = graph.nodes.supervisor_review;

			expect(String(bugNode?.attrs.session_id || "")).toBe(SUPERVISOR_SESSION_TEMPLATE);
			expect(String(tickNode?.attrs.session_id || "")).toBe(SUPERVISOR_SESSION_TEMPLATE);

			const runOneContext = new Context({ factory_id: testCase.factoryId, __run_id: "tick-run-1" });
			const runTwoContext = new Context({ factory_id: testCase.factoryId, __run_id: "tick-run-2" });

			const bugSessionRunOne = expandVariables(String(bugNode?.attrs.session_id || ""), runOneContext);
			const tickSessionRunOne = expandVariables(String(tickNode?.attrs.session_id || ""), runOneContext);
			const bugSessionRunTwo = expandVariables(String(bugNode?.attrs.session_id || ""), runTwoContext);
			const tickSessionRunTwo = expandVariables(String(tickNode?.attrs.session_id || ""), runTwoContext);

			expect(bugSessionRunOne).toBe(`supervisor-${testCase.factoryId}`);
			expect(tickSessionRunOne).toBe(bugSessionRunOne);
			expect(bugSessionRunTwo).toBe(bugSessionRunOne);
			expect(tickSessionRunTwo).toBe(bugSessionRunOne);
			resolvedSessionIds.set(testCase.factoryId, bugSessionRunOne);
		}

		expect(resolvedSessionIds.get("mothership/factory_supervisor")).not.toBe(
			resolvedSessionIds.get("example-trading/factory_supervisor"),
		);
	});

	it("keeps merge resolver outside the persistent supervisor session", () => {
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
				expect(nodeClass(node)).toBe("merge_resolver");
				expect(String(node.attrs.session_id || "")).toBe("");
			}
		}
	});

	it("exposes supervisor session, role, prompt family, run, and graph attribution in enriched telemetry", () => {
		for (const testCase of factories) {
			const graph = loadResolvedGraph(testCase.graphPath);
			for (const [nodeId, expectedPromptFamily] of [
				["supervisor_review_bug_fast", "supervisor_bug_fast_task_prompt"],
				["supervisor_review", "supervisor_review_task_prompt"],
			] as const) {
				const data = stageStartTelemetry({
					graphPath: testCase.graphPath,
					graph,
					nodeId,
					runId: "tick-run-42",
					factoryId: testCase.factoryId,
					factoryName: testCase.factoryName,
				});
				expect(data.session_id).toBe(`supervisor-${testCase.factoryId}`);
				expect(data["hatch.session_id"]).toBe(`supervisor-${testCase.factoryId}`);
				expect(data.role).toBe("supervisor");
				expect(data["hatch.role"]).toBe("supervisor");
				expect(data.prompt_family).toBe(expectedPromptFamily);
				expect(data.prompt_source).toBe(expectedPromptFamily);
				expect(data.task_prompt_source).toBe(expectedPromptFamily);
				expect(data.system_prompt_source).toBe("supervisor_system_prompt");
				expect(data.run_id).toBe("tick-run-42");
				expect(data.graph_id).toBe(graph.name);
				expect(data.node_id).toBe(nodeId);
				expect(data.factory_id).toBe(testCase.factoryId);
				expect(data.handler_type).toBe("stack.manager_loop");
			}
		}
	});
});
