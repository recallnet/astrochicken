import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parse } from "./parse.js";

import type { Graph } from "./graph.js";

const SUPERVISOR_TICK_DOT = join(import.meta.dirname, "../../../../docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot");
const SUPERVISOR_ACTIONS_TS = join(import.meta.dirname, "action-registry-supervisor.ts");

function loadSupervisorTickGraph(): Graph {
	return parse(readFileSync(SUPERVISOR_TICK_DOT, "utf8"));
}

function hasEdge(graph: Graph, from: string, to: string, condition?: string): boolean {
	return graph.edges.some((edge) => {
		if (edge.from !== from || edge.to !== to) return false;
		if (condition === undefined) return true;
		return String(edge.attrs.condition || "") === condition;
	});
}

function reachable(
	graph: Graph,
	from: string,
	to: string,
	blockedNodes: Set<string> = new Set(),
): boolean {
	const queue = [from];
	const seen = new Set<string>();
	while (queue.length > 0) {
		const current = queue.shift()!;
		if (current === to) return true;
		if (seen.has(current)) continue;
		seen.add(current);
		for (const edge of graph.edges) {
			if (edge.from !== current) continue;
			if (blockedNodes.has(edge.to)) continue;
			queue.push(edge.to);
		}
	}
	return false;
}

describe("supervisor fast-route graph contract", () => {
	it("keeps required fast-route nodes and ordered preflight chain", () => {
		const graph = loadSupervisorTickGraph();
		for (const nodeId of [
			"snapshot_state_fast",
			"evaluate_open_bug_gate_fast",
			"bug_fast_gate",
			"supervisor_review_bug_fast",
			"recovery_sweep_runtime",
		]) {
			expect(graph.nodes[nodeId], `missing node ${nodeId}`).toBeDefined();
		}

		expect(hasEdge(graph, "snapshot_state_fast", "evaluate_open_bug_gate_fast")).toBe(true);
		expect(hasEdge(graph, "evaluate_open_bug_gate_fast", "bug_fast_gate")).toBe(true);
	});

	it("routes open-bug branch through supervisor_review_bug_fast before maintenance flow resumes", () => {
		const graph = loadSupervisorTickGraph();
		const openBranchEdge = graph.edges.find(
			(edge) => edge.from === "bug_fast_gate" && String(edge.attrs.condition || "") === "has_open_bugs=true",
		);
		expect(openBranchEdge).toBeDefined();

		const openBranchStart = String(openBranchEdge?.to || "");
		expect(reachable(graph, openBranchStart, "supervisor_review_bug_fast")).toBe(true);
		expect(reachable(graph, openBranchStart, "recovery_sweep_runtime", new Set(["supervisor_review_bug_fast"]))).toBe(false);
	});

	it("routes clean branch away from bug review and into normal maintenance flow", () => {
		const graph = loadSupervisorTickGraph();
		const cleanBranchEdge = graph.edges.find(
			(edge) => edge.from === "bug_fast_gate" && String(edge.attrs.condition || "") === "has_open_bugs!=true",
		);
		expect(cleanBranchEdge).toBeDefined();

		const cleanBranchStart = String(cleanBranchEdge?.to || "");
		expect(reachable(graph, cleanBranchStart, "recovery_sweep_runtime")).toBe(true);
		expect(reachable(graph, cleanBranchStart, "supervisor_review_bug_fast")).toBe(false);
		expect(reachable(graph, "recovery_sweep_runtime", "supervisor_review_bug_fast")).toBe(false);
	});

	it("makes the fast snapshot route skip recovery sweep in the action executor", () => {
		const source = readFileSync(SUPERVISOR_ACTIONS_TS, "utf8");
		expect(source).toMatch(/const isFastSnapshotRoute = request\.node\.id === "snapshot_state_fast"/);
		expect(source).toMatch(/skipRecoverySweep: isFastSnapshotRoute/);
	});
});
