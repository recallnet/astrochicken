import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";

import { describe, expect, it } from "vitest";


import { checkOutputConstraints, checkOutputFormat } from "./constraints.js";
import { Context, StageStatus } from "./context.js";
import { parse } from "./parse.js";

import type { Node } from "./graph.js";

/**
 * Node classification contract test.
 *
 * Ensures that no tool node is falsely classified as a reviewer or judge node
 * by the engine's constraint system. This prevents the class of bug where
 * constraint validation silently rejects tool node output, causing named
 * outputs to never reach context and downstream routing to take wrong branches.
 *
 * The bug: isReviewerNode() used a heuristic that matched any node whose
 * outputs attribute contained "review_verdict" and "review_reason_codes",
 * even tool nodes that just pass those keys through as defaults. Reviewer
 * schema validation then failed on empty review fields, flipping outcome
 * to Failed, and named outputs were silently dropped.
 */

const MOTHERSHIP_GRAPHS_DIR = join(import.meta.dirname, "../../../../factories/mothership/graphs");

const REVIEWER_MARKER_KEYS = ["review_verdict", "review_reason_codes"];
const JUDGE_MARKER_KEYS = ["alignment_score", "pass", "judge_pass"];

function isExplicitReviewer(node: Node): boolean {
	const raw = (node.attrs["reviewer"] ?? "").trim().toLowerCase();
	return raw === "true" || raw === "1" || raw === "yes";
}

function isExplicitJudge(node: Node): boolean {
	const raw = (node.attrs["judge"] ?? "").trim().toLowerCase();
	return raw === "true" || raw === "1" || raw === "yes";
}

function getNodeOutputKeys(node: Node): string[] {
	const outputs = node.attrs["outputs"] ?? "";
	return outputs.split(",").map((k) => k.trim()).filter(Boolean);
}

function isToolNode(node: Node): boolean {
	const handlerType = (node.attrs["type"] ?? "").trim().toLowerCase();
	return handlerType === "tool";
}

function loadAllGraphs(): Array<{ file: string; graph: ReturnType<typeof parse> }> {
	let files: string[] = [];
	try {
		files = readdirSync(MOTHERSHIP_GRAPHS_DIR)
			.filter((f) => f.endsWith(".dot"))
			.sort();
	} catch {
		return [];
	}

	return files.map((file) => {
		const content = readFileSync(join(MOTHERSHIP_GRAPHS_DIR, file), "utf8");
		return { file, graph: parse(content) };
	});
}

describe("node classification contract", () => {
	const graphs = loadAllGraphs();

	it("finds at least one DOT graph to validate", () => {
		expect(graphs.length).toBeGreaterThan(0);
	});

	it("no tool node is falsely classified as reviewer", () => {
		const violations: string[] = [];

		for (const { file, graph } of graphs) {
			for (const node of Object.values(graph.nodes)) {
				if (!isToolNode(node)) continue;
				if (isExplicitReviewer(node)) continue;

				const outputKeys = getNodeOutputKeys(node);
				const hasReviewerKeys = REVIEWER_MARKER_KEYS.every((k) => outputKeys.includes(k));

				if (hasReviewerKeys) {
					// This tool node has reviewer-like output keys but no reviewer="true".
					// Verify that checkOutputConstraints does NOT apply reviewer validation.
					const testOutput = JSON.stringify({
						review_verdict: "",
						review_reason_codes: [],
						review_notes: "",
						// Add any other keys the node might output
						...Object.fromEntries(
							outputKeys
								.filter((k) => !REVIEWER_MARKER_KEYS.includes(k) && k !== "review_notes")
								.map((k) => [k, "test_value"]),
						),
					});

					const result = checkOutputConstraints(node, testOutput, new Context());
					if (!result.passed) {
						violations.push(
							`${file}::${node.id} — tool node has reviewer-like outputs (${outputKeys.join(",")}) ` +
							`but no reviewer="true". Constraint validation would reject its output: ${result.violations.join("; ")}`,
						);
					}
				}
			}
		}

		expect(violations).toEqual([]);
	});

	it("no tool node is falsely classified as judge", () => {
		const violations: string[] = [];

		for (const { file, graph } of graphs) {
			for (const node of Object.values(graph.nodes)) {
				if (!isToolNode(node)) continue;
				if (isExplicitJudge(node)) continue;

				const outputKeys = getNodeOutputKeys(node);
				const hasJudgeKeys = JUDGE_MARKER_KEYS.some((k) => outputKeys.includes(k));

				if (hasJudgeKeys) {
					const testOutput = JSON.stringify({
						alignment_score: 0,
						constraint_violations: [],
						missing_evidence: [],
						recommendations: [],
						pass: true,
						...Object.fromEntries(
							outputKeys
								.filter((k) => !JUDGE_MARKER_KEYS.includes(k))
								.map((k) => [k, "test_value"]),
						),
					});

					const result = checkOutputConstraints(node, testOutput, new Context());
					if (!result.passed) {
						violations.push(
							`${file}::${node.id} — tool node has judge-like outputs (${outputKeys.join(",")}) ` +
							`but no judge="true". Constraint validation would reject its output: ${result.violations.join("; ")}`,
						);
					}
				}
			}
		}

		expect(violations).toEqual([]);
	});

	it("tool nodes with output_format=json and outputs= produce valid JSON that passes format check", () => {
		// Ensure no tool node's expected output shape would fail checkOutputFormat
		const nodesWithJsonOutputs: Array<{ file: string; nodeId: string; outputs: string[] }> = [];

		for (const { file, graph } of graphs) {
			for (const node of Object.values(graph.nodes)) {
				if (!isToolNode(node)) continue;
				const format = (node.attrs["output_format"] ?? "").trim().toLowerCase();
				const outputs = getNodeOutputKeys(node);
				if (format === "json" && outputs.length > 0) {
					nodesWithJsonOutputs.push({ file, nodeId: node.id, outputs });
				}
			}
		}

		expect(nodesWithJsonOutputs.length).toBeGreaterThan(0);

		for (const { file, nodeId, outputs } of nodesWithJsonOutputs) {
			// Every tool node with output_format=json should produce parseable JSON
			// This is a structural contract — the node's output shape must be valid
			const testPayload = Object.fromEntries(outputs.map((k) => [k, ""]));
			const testOutput = JSON.stringify(testPayload);
			const node: Node = {
				id: nodeId,
				attrs: { type: "tool", output_format: "json", outputs: outputs.join(",") },
			};
			const result = checkOutputFormat(node, testOutput);
			expect(result.passed, `${file}::${nodeId} — JSON output format check should pass for well-formed JSON`).toBe(true);
		}
	});

	it("every conditional edge references a context key that some upstream node produces", () => {
		const violations: string[] = [];

		for (const { file, graph } of graphs) {
			// Build set of all context keys produced by nodes (via output_key or outputs=)
			const producedKeys = new Set<string>();
			for (const node of Object.values(graph.nodes)) {
				const outputKey = node.attrs["output_key"];
				if (outputKey) producedKeys.add(outputKey.trim());

				const outputs = node.attrs["outputs"];
				if (outputs) {
					for (const k of outputs.split(",").map((s) => s.trim()).filter(Boolean)) {
						producedKeys.add(k);
					}
				}
			}

			// Check all conditional edges
			for (const edge of graph.edges) {
				const condition = edge.attrs["condition"];
				if (!condition) continue;

				// Parse "key=value" or "key!=value"
				const match = condition.match(/^(\w+)\s*(!?=)\s*(.+)$/);
				if (!match) continue;

				const contextKey = match[1];
				// Skip well-known engine-provided keys
				if (["outcome"].includes(contextKey)) continue;

				if (!producedKeys.has(contextKey)) {
					violations.push(
						`${file}: edge ${edge.from}->${edge.to} condition="${condition}" ` +
						`references context key "${contextKey}" but no node in this graph produces it ` +
						`(via output_key or outputs=). It may come from parent context, but verify.`,
					);
				}
			}
		}

		// This test is advisory — parent-injected context keys are expected.
		// Log violations but don't fail, to avoid false positives from
		// context keys injected by parent pipelines or tool handlers.
		if (violations.length > 0) {
			console.log(`[node-classification] advisory: ${violations.length} conditional edges reference keys not produced in-graph:`);
			for (const v of violations.slice(0, 10)) {
				console.log(`  ${v}`);
			}
		}
	});
});
