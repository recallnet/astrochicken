import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "./parse.js";
import type { Graph, Node } from "./graph.js";

const EXAMPLE_TRADING_DOMAIN_DOT = join(
	import.meta.dirname,
	"../../../../factories/example-trading/graphs/domain_example_trading.dot",
);

const GOAL_EXEC_TEMPLATE = "docs/contracts/workflow-ir/capability-software-development/goal_execute.dot";
const FORBIDDEN_WAVE_DISPATCH_TEMPLATE = "docs/contracts/workflow-ir/capability-wave-dispatch/wave_dispatch.dot";
const FORBIDDEN_EXAMPLE_TRADING_LOCAL_WAVE_TEMPLATES = [
	"factories/example-trading/graphs/wave_execute.dot",
	"factories/example-trading/graphs/wave_issue_execute.dot",
	"factories/example-trading/graphs/milestone_execute.dot",
	"factories/example-trading/graphs/milestone_execute_parallel_item.dot",
] as const;

const REQUIRED_GOAL_EXECUTION_NODES = ["list_executable_goals", "goal_execute_gate", "spawn_goal_execute"] as const;

const REQUIRED_CHAIN_EDGES: ReadonlyArray<readonly [string, string]> = [
	["sync_release_manifest", "list_executable_goals"],
	["list_executable_goals", "goal_execute_gate"],
	["spawn_goal_execute", "evaluate_action_item_gate"],
];

const FORBIDDEN_ACTIVE_PATH_WAVE_NODES = [
	"release_wave_quarantine",
	"set_max_concurrent_waves",
	"wave_dispatch",
	"set_max_issues_per_wave",
	"enumerate_wave_slots",
	"fan_out_wave_execute",
	"fan_in_wave_execute",
	"detect_stalled_wave",
] as const;

const FORBIDDEN_ACTIVE_PATH_WAVE_EDGES: ReadonlyArray<readonly [string, string]> = [
	["release_wave_quarantine", "set_release_sha"],
	["set_max_concurrent_waves", "wave_dispatch"],
	["wave_dispatch", "set_max_issues_per_wave"],
	["set_max_issues_per_wave", "enumerate_wave_slots"],
	["enumerate_wave_slots", "fan_out_wave_execute"],
	["fan_out_wave_execute", "fan_in_wave_execute"],
	["fan_in_wave_execute", "detect_stalled_wave"],
	["detect_stalled_wave", "evaluate_action_item_gate"],
] as const;

function loadGraph(): Graph {
	return parse(readFileSync(EXAMPLE_TRADING_DOMAIN_DOT, "utf8"));
}

function cloneGraph(graph: Graph): Graph {
	return {
		name: graph.name,
		attrs: { ...graph.attrs },
		nodes: Object.fromEntries(Object.entries(graph.nodes).map(([id, node]) => [id, { id, attrs: { ...node.attrs } }])),
		edges: graph.edges.map((edge) => ({ from: edge.from, to: edge.to, attrs: { ...edge.attrs } })),
	};
}

function expectNode(graph: Graph, id: string, predicate?: (node: Node) => boolean, message?: string): Node {
	const node = graph.nodes[id];
	if (!node) throw new Error(`missing node invariant: ${id}${message ? ` (${message})` : ""}`);
	if (predicate && !predicate(node)) {
		throw new Error(`ownership drift invariant: ${id}${message ? ` (${message})` : ""}`);
	}
	return node;
}

function expectEdge(graph: Graph, from: string, to: string, message?: string): void {
	const edge = graph.edges.find((candidate) => candidate.from === from && candidate.to === to);
	if (!edge) {
		throw new Error(`missing edge invariant: ${from} -> ${to}${message ? ` (${message})` : ""}`);
	}
}

function expectConditionalEdge(graph: Graph, from: string, to: string, condition: string, message?: string): void {
	const edge = graph.edges.find(
		(candidate) => candidate.from === from && candidate.to === to && String(candidate.attrs.condition || "") === condition,
	);
	if (!edge) {
		throw new Error(`missing conditional edge invariant: ${from} -> ${to} [${condition}]${message ? ` (${message})` : ""}`);
	}
}

function expectForbiddenNode(graph: Graph, id: string, message?: string): void {
	if (graph.nodes[id]) {
		throw new Error(`forbidden node invariant: ${id}${message ? ` (${message})` : ""}`);
	}
}

function expectForbiddenEdge(graph: Graph, from: string, to: string, message?: string): void {
	const edge = graph.edges.find((candidate) => candidate.from === from && candidate.to === to);
	if (edge) {
		throw new Error(`forbidden edge invariant: ${from} -> ${to}${message ? ` (${message})` : ""}`);
	}
}

function assertReplayLabSupervisorGoalExecutionTopology(graph: Graph): void {
	for (const nodeId of REQUIRED_GOAL_EXECUTION_NODES) {
		expectNode(graph, nodeId);
	}

	expectNode(
		graph,
		"list_executable_goals",
		(node) =>
			node.attrs.type === "tool" &&
			node.attrs.outputs?.includes("count") &&
			node.attrs.action_runtime === "in_process" &&
			node.attrs.action_id === "software.list_executable_goals" &&
			node.attrs.action_max_concurrent === "${max_concurrent_waves_pre}" &&
			node.attrs.action_runs_dir === "${absolute_runs_dir}",
		"must enumerate executable goals using list-executable",
	);

	expectNode(graph, "goal_execute_gate", (node) => node.attrs.shape === "diamond", "must gate on executable goal count");

	expectNode(
		graph,
		"spawn_goal_execute",
		(node) =>
			node.attrs.type === "fan_out.detached" &&
			node.attrs.source_key === "executable_goals" &&
			node.attrs.item_key === "goal_issue_number" &&
			node.attrs.template === GOAL_EXEC_TEMPLATE,
		"must dispatch detached shared goal_execute capability",
	);

	for (const [from, to] of REQUIRED_CHAIN_EDGES) {
		expectEdge(graph, from, to, "required supervisor goal-execution chain");
	}

	expectConditionalEdge(graph, "goal_execute_gate", "spawn_goal_execute", "count!=0");
	expectConditionalEdge(graph, "goal_execute_gate", "evaluate_action_item_gate", "count=0");

	const goalExecuteTemplateOwners = Object.values(graph.nodes)
		.filter((node) => node.attrs.template === GOAL_EXEC_TEMPLATE)
		.map((node) => node.id)
		.sort();
	if (goalExecuteTemplateOwners.length !== 1 || goalExecuteTemplateOwners[0] !== "spawn_goal_execute") {
		throw new Error(
			`ownership drift invariant: template ${GOAL_EXEC_TEMPLATE} must be owned only by spawn_goal_execute, got [${goalExecuteTemplateOwners.join(", ")}]`,
		);
	}

	for (const nodeId of FORBIDDEN_ACTIVE_PATH_WAVE_NODES) {
		expectForbiddenNode(graph, nodeId, "wave-native execution nodes must not exist in example-trading supervisor active path");
	}

	for (const [from, to] of FORBIDDEN_ACTIVE_PATH_WAVE_EDGES) {
		expectForbiddenEdge(graph, from, to, "wave-native execution edges must not exist in example-trading supervisor active path");
	}

	for (const node of Object.values(graph.nodes)) {
		if (node.attrs.template === FORBIDDEN_WAVE_DISPATCH_TEMPLATE || node.attrs.pipeline === FORBIDDEN_WAVE_DISPATCH_TEMPLATE) {
			throw new Error(`forbidden template invariant: ${FORBIDDEN_WAVE_DISPATCH_TEMPLATE}`);
		}
		for (const forbiddenTemplate of FORBIDDEN_EXAMPLE_TRADING_LOCAL_WAVE_TEMPLATES) {
			if (node.attrs.template === forbiddenTemplate || node.attrs.pipeline === forbiddenTemplate) {
				throw new Error(`forbidden template invariant: ${forbiddenTemplate}`);
			}
		}
	}
}

describe("example-trading supervisor goal-execution topology contract", () => {
	it("enforces detached shared goal execution topology and forbids wave-native active path", () => {
		assertReplayLabSupervisorGoalExecutionTopology(loadGraph());
	});

	it("reports missing node invariant when goal-execution node is absent", () => {
		const graph = cloneGraph(loadGraph());
		delete graph.nodes.list_executable_goals;
		graph.edges = graph.edges.filter((edge) => edge.from !== "list_executable_goals" && edge.to !== "list_executable_goals");
		expect(() => assertReplayLabSupervisorGoalExecutionTopology(graph)).toThrow("missing node invariant: list_executable_goals");
	});

	it("reports forbidden node invariant when legacy wave node reappears", () => {
		const graph = cloneGraph(loadGraph());
		graph.nodes.wave_dispatch = {
			id: "wave_dispatch",
			attrs: {
				type: "pipeline",
				pipeline: FORBIDDEN_WAVE_DISPATCH_TEMPLATE,
			},
		};
		expect(() => assertReplayLabSupervisorGoalExecutionTopology(graph)).toThrow("forbidden node invariant: wave_dispatch");
	});

	it("reports ownership drift invariant when detached goal execution template changes", () => {
		const graph = cloneGraph(loadGraph());
		graph.nodes.spawn_goal_execute.attrs.template = "factories/example-trading/graphs/goal_execute.dot";
		expect(() => assertReplayLabSupervisorGoalExecutionTopology(graph)).toThrow("ownership drift invariant: spawn_goal_execute");
	});

	it("resolve_absolute_runs_dir handles already-absolute runs_dir without double-prefixing", () => {
		const graph = loadGraph();
		const node = graph.nodes.resolve_absolute_runs_dir;
		expect(node).toBeDefined();
		expect(node.attrs.action_runtime).toBe("in_process");
		expect(node.attrs.action_id).toBe("common.resolve_default");
		expect(node.attrs.action_value).toBe("${runs_dir}");
		expect(node.attrs.action_fallback).toBe("${repo}/.hatch/example-trading/runs");
	});

	it("reports missing conditional edge invariant when goal gate routing drifts", () => {
		const graph = cloneGraph(loadGraph());
		graph.edges = graph.edges.filter(
			(edge) => !(edge.from === "goal_execute_gate" && edge.to === "spawn_goal_execute" && edge.attrs.condition === "count!=0"),
		);
		expect(() => assertReplayLabSupervisorGoalExecutionTopology(graph)).toThrow(
			"missing conditional edge invariant: goal_execute_gate -> spawn_goal_execute [count!=0]",
		);
	});
});
