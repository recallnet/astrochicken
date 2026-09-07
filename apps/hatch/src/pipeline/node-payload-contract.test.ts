import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

import { parse } from "./parse.js";

import type { Graph, Node } from "./graph.js";

const MOTHERSHIP_GRAPHS_DIR = join(import.meta.dirname, "../../../../factories/mothership/graphs");

const REQUIRED_PROMPT_KEYS_BY_GRAPH_NODE: Record<string, string[]> = {
	"wave_issue_execute.dot::review": [
		"issue_number",
		"issue_title",
		"issue_body",
		"goal_issue_number",
		"goal_issue",
		"intent_stack",
		"milestone_title",
		"review_evidence_path",
		"review_context_path",
		"review_context_sha256",
		"worktree_dir",
		"branch",
		"builder_notes",
		"commits_ahead",
		"changed_files",
		"latest_issue_change_summary",
		"gh_repo",
	],
	"goal_execute.dot::judge": ["gh_repo", "merged_results"],
	"write_issue_item.dot::judge": ["gh_repo", "feature", "issue_spec"],
};

const REQUIRED_PROMPT_FRAGMENTS_BY_GRAPH_NODE: Record<string, string[]> = {
	"wave_issue_execute.dot::review": [
		"gh issue view ${issue_number}",
		"gh issue view ${goal_issue_number}",
		"${worktree_dir}",
		"${branch}",
	],
};

const REQUIRED_JUDGE_GATE_OUTPUTS = [
	"judge_evidence_gate_pass",
	"judge_evidence_gate_code",
	"judge_evidence_error",
	"judge_route_code",
	"disposition",
	"confidence",
	"recommended_transition",
	"reason_codes",
	"notes",
	"verdict",
];

function loadAllGraphs(): Array<{ file: string; graph: Graph }> {
	const files = readdirSync(MOTHERSHIP_GRAPHS_DIR)
		.filter((f) => f.endsWith(".dot") && f !== "issue_execute_item.dot")
		.sort();
	return files.map((file) => {
		const content = readFileSync(join(MOTHERSHIP_GRAPHS_DIR, file), "utf8");
		return { file, graph: parse(content) };
	});
}

function getPromptVars(prompt: string): Array<{ raw: string; name: string; optionalSyntax: boolean }> {
	const vars: Array<{ raw: string; name: string; optionalSyntax: boolean }> = [];
	for (const match of prompt.matchAll(/\$\{([^}]+)\}/g)) {
		const raw = String(match[1] || "").trim();
		const nameMatch = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
		if (!nameMatch) continue;
		const name = nameMatch[1];
		const tail = raw.slice(name.length);
		const optionalSyntax = /^(?::[-=?+]|[-=?+])/.test(tail.trim());
		vars.push({ raw, name, optionalSyntax });
	}
	return vars;
}

function findNode(graph: Graph, nodeId: string): Node {
	const node = graph.nodes[nodeId];
	expect(node, `missing node ${nodeId}`).toBeTruthy();
	return node;
}

function hasEdge(graph: Graph, from: string, to: string, condition?: string): boolean {
	return graph.edges.some((edge) => {
		if (edge.from !== from || edge.to !== to) return false;
		if (condition === undefined) return true;
		return String(edge.attrs["condition"] || "") === condition;
	});
}

function getOutputs(node: Node): string[] {
	return String(node.attrs["outputs"] || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

describe("node payload contract (required inputs are strict, non-optional)", () => {
	const graphs = loadAllGraphs();

	it("loads production DOT graphs", () => {
		expect(graphs.length).toBeGreaterThan(0);
	});

	it("required reviewer/judge prompt keys are present with no optional fallbacks", () => {
		const violations: string[] = [];

		for (const { file, graph } of graphs) {
			for (const node of Object.values(graph.nodes)) {
				const key = `${file}::${node.id}`;
				const required = REQUIRED_PROMPT_KEYS_BY_GRAPH_NODE[key];
				if (!required) continue;
				const prompt = String(node.attrs["prompt"] || "");
				const vars = getPromptVars(prompt);
				const varNames = new Set(vars.map((v) => v.name));

				for (const req of required) {
					if (!varNames.has(req)) {
						violations.push(`${key} missing required prompt variable: \${${req}}`);
					}
					const bad = vars.find((v) => v.name === req && v.optionalSyntax);
					if (bad) {
						violations.push(`${key} uses optional/default expansion for required key ${req}: \${${bad.raw}}`);
					}
				}
			}
		}

		expect(violations).toEqual([]);
	});

	it("reviewer prompt contains required gh CLI inspection cues and local-repo references", () => {
		const violations: string[] = [];

		for (const { file, graph } of graphs) {
			for (const node of Object.values(graph.nodes)) {
				const key = `${file}::${node.id}`;
				const requiredFragments = REQUIRED_PROMPT_FRAGMENTS_BY_GRAPH_NODE[key];
				if (!requiredFragments) continue;
				const prompt = String(node.attrs["prompt"] || "");
				for (const fragment of requiredFragments) {
					if (!prompt.includes(fragment)) {
						violations.push(`${key} missing required prompt fragment: "${fragment}"`);
					}
				}
			}
		}

		expect(violations).toEqual([]);
	});

	it("every explicit judge node is guarded by deterministic judge-evidence preflight", () => {
		const violations: string[] = [];

		for (const { file, graph } of graphs) {
			const judgeNodes = Object.values(graph.nodes).filter((node) => {
				const raw = String(node.attrs["judge"] || "").toLowerCase().trim();
				return raw === "true" || raw === "1" || raw === "yes";
			});
			if (judgeNodes.length === 0) continue;

			for (const judge of judgeNodes) {
				const build = graph.nodes["build_judge_evidence"];
				const validate = graph.nodes["validate_judge_evidence"];
				const gate = graph.nodes["judge_evidence_gate"];
				if (!build) violations.push(`${file}::${judge.id} missing build_judge_evidence node`);
				if (!validate) violations.push(`${file}::${judge.id} missing validate_judge_evidence node`);
				if (!gate) violations.push(`${file}::${judge.id} missing judge_evidence_gate node`);
				if (!build || !validate || !gate) continue;

				const hasDirectEvidenceEdge = hasEdge(graph, "build_judge_evidence", "validate_judge_evidence");
				const hasContextGatedEvidencePath =
					hasEdge(graph, "build_judge_evidence", "build_judge_context") &&
					hasEdge(graph, "build_judge_context", "validate_judge_context") &&
					hasEdge(graph, "validate_judge_context", "judge_context_gate") &&
					hasEdge(graph, "judge_context_gate", "validate_judge_evidence", "judge_context_gate_pass=true");
				if (!hasDirectEvidenceEdge && !hasContextGatedEvidencePath) {
					violations.push(
						`${file}::${judge.id} missing judge evidence preflight path (expected direct build_judge_evidence -> validate_judge_evidence or context-gated path via judge_context_gate)`,
					);
				}
				if (!hasEdge(graph, "validate_judge_evidence", "judge_evidence_gate")) {
					violations.push(`${file}::${judge.id} missing edge validate_judge_evidence -> judge_evidence_gate`);
				}
				if (!hasEdge(graph, "judge_evidence_gate", judge.id, "judge_evidence_gate_pass=true")) {
					violations.push(`${file}::${judge.id} must be gated by judge_evidence_gate_pass=true`);
				}
				const failEdges = graph.edges.filter(
					(edge) => edge.from === "judge_evidence_gate" && String(edge.attrs["condition"] || "") === "judge_evidence_gate_pass!=true",
				);
				if (failEdges.length === 0) {
					violations.push(`${file}::${judge.id} missing fail-closed edge judge_evidence_gate_pass!=true`);
				}
				if (failEdges.some((edge) => edge.to === judge.id)) {
					violations.push(`${file}::${judge.id} fail-closed edge incorrectly routes back into judge node`);
				}
			}
		}

		expect(violations).toEqual([]);
	});

	it("validate_judge_evidence exports required deterministic routing keys", () => {
		const violations: string[] = [];

		for (const { file, graph } of graphs) {
			if (!graph.nodes["validate_judge_evidence"]) continue;
			const validate = findNode(graph, "validate_judge_evidence");
			const outputs = new Set(getOutputs(validate));
			const attrs = validate.attrs || {};
			for (const key of REQUIRED_JUDGE_GATE_OUTPUTS) {
				if (!outputs.has(key)) violations.push(`${file}::validate_judge_evidence missing outputs key ${key}`);
			}

			const prompt = String(validate.attrs["prompt"] || "");
			const vars = getPromptVars(prompt);
			for (const req of ["judge_evidence_path", "judge_evidence_sha256", "judge_evidence_valid", "judge_evidence_error"]) {
				if (typeof attrs[`action_${req}`] === "string" && String(attrs[`action_${req}`]).length > 0) {
					continue;
				}
				const found = vars.find((v) => v.name === req);
				if (!found) {
					violations.push(`${file}::validate_judge_evidence missing required prompt variable \${${req}}`);
					continue;
				}
				if (found.optionalSyntax) {
					violations.push(`${file}::validate_judge_evidence uses optional/default expansion for ${req}: \${${found.raw}}`);
				}
			}
		}

		expect(violations).toEqual([]);
	});
});
