import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { graphModelMatrix, nodeModelMatrix } from "./graph.js";
import {
	MODEL_MATRIX_RESOLUTION_RULE_CODES,
	ModelMatrixResolutionError,
	enforceModelMatrixContractsAtLoad,
	resolveEffectiveModelRoutingForGraph,
	resolveEffectiveModelRoutingForNode,
} from "./model-matrix-resolution.js";
import { parse } from "./parse.js";

describe("model matrix resolution", () => {
	let root = "";

	afterEach(() => {
		if (!root) return;
		rmSync(root, { recursive: true, force: true });
		root = "";
	});

	it("returns empty-string accessors when model_matrix attrs are unset", () => {
		const graph = parse(`
	digraph matrix_unset {
		start [shape=Mdiamond]
		run [type="codergen"]
		done [shape=Msquare]

		start -> run -> done
	}
		`);

		expect(graphModelMatrix(graph)).toBe("");
		expect(nodeModelMatrix(graph.nodes.run)).toBe("");
	});

	it("resolves graph-level model_matrix when node has no override", () => {
		const graph = parse(`
	digraph graph_matrix {
		model_matrix = "config/model-matrix.json"
		start [shape=Mdiamond]
		run [type="codergen"]
		done [shape=Msquare]

		start -> run -> done
	}
		`);

		expect(resolveEffectiveModelRoutingForGraph(graph)).toMatchObject({
			family: "model_matrix",
			value: "config/model-matrix.json",
			provenance: "graph",
			attribute: "model_matrix",
		});
		expect(resolveEffectiveModelRoutingForNode(graph, graph.nodes.run)).toMatchObject({
			family: "model_matrix",
			value: "config/model-matrix.json",
			provenance: "graph",
			attribute: "model_matrix",
		});
	});

	it("resolves node-level model_matrix override over graph-level model_matrix", () => {
		const graph = parse(`
	digraph node_matrix_override {
		model_matrix = "config/default-matrix.json"
		start [shape=Mdiamond]
		run [type="codergen" model_matrix="config/expensive-matrix.json"]
		done [shape=Msquare]

		start -> run -> done
	}
		`);

		expect(resolveEffectiveModelRoutingForNode(graph, graph.nodes.run)).toMatchObject({
			family: "model_matrix",
			value: "config/expensive-matrix.json",
			provenance: "node",
			attribute: "model_matrix",
		});
	});

	it("prioritizes graph model_matrix over node llm_model", () => {
		const graph = parse(`
	digraph mixed_precedence {
		model_matrix = "config/graph-matrix.json"
		start [shape=Mdiamond]
		run [type="codergen" llm_model="openai/gpt-5.3-codex"]
		done [shape=Msquare]

		start -> run -> done
	}
		`);

		expect(resolveEffectiveModelRoutingForNode(graph, graph.nodes.run)).toMatchObject({
			family: "model_matrix",
			value: "config/graph-matrix.json",
			provenance: "graph",
			attribute: "model_matrix",
		});
	});

	it("falls back to llm_model precedence when no model_matrix is present", () => {
		const graph = parse(`
	digraph llm_fallback {
		llm_model = "openai/gpt-4o-mini"
		start [shape=Mdiamond]
		node_override [type="codergen" llm_model="anthropic/claude-sonnet-4-6"]
		graph_default [type="codergen"]
		done [shape=Msquare]

		start -> node_override -> graph_default -> done
	}
		`);

		expect(resolveEffectiveModelRoutingForNode(graph, graph.nodes.node_override)).toMatchObject({
			family: "llm_model",
			value: "anthropic/claude-sonnet-4-6",
			provenance: "node",
			attribute: "llm_model",
		});
		expect(resolveEffectiveModelRoutingForNode(graph, graph.nodes.graph_default)).toMatchObject({
			family: "llm_model",
			value: "openai/gpt-4o-mini",
			provenance: "graph",
			attribute: "llm_model",
		});
	});

	it("throws deterministic graph conflict error when graph sets both model_matrix and llm_model", () => {
		const graph = parse(`
	digraph graph_conflict {
		model_matrix = "config/model-matrix.json"
		llm_model = "openai/gpt-4o-mini"
		start [shape=Mdiamond]
		run [type="codergen"]
		done [shape=Msquare]

		start -> run -> done
	}
		`);

		expect(() => resolveEffectiveModelRoutingForGraph(graph)).toThrow(ModelMatrixResolutionError);
		expect(() => resolveEffectiveModelRoutingForGraph(graph)).toThrow(
			'graph sets both "model_matrix" and "llm_model"',
		);
		try {
			resolveEffectiveModelRoutingForGraph(graph);
			expect.unreachable("expected graph conflict");
		} catch (error) {
			expect(error).toBeInstanceOf(ModelMatrixResolutionError);
			const resolutionError = error as ModelMatrixResolutionError;
			expect(resolutionError.code).toBe(MODEL_MATRIX_RESOLUTION_RULE_CODES.GRAPH_SCOPE_CONFLICT);
			expect(resolutionError.scope).toBe("graph");
		}
	});

	it("throws deterministic node conflict error when node sets both model_matrix and llm_model", () => {
		const graph = parse(`
	digraph node_conflict {
		start [shape=Mdiamond]
		run [type="codergen" model_matrix="config/model-matrix.json" llm_model="openai/gpt-4o-mini"]
		done [shape=Msquare]

		start -> run -> done
	}
		`);

		expect(() => resolveEffectiveModelRoutingForNode(graph, graph.nodes.run)).toThrow(ModelMatrixResolutionError);
		expect(() => resolveEffectiveModelRoutingForNode(graph, graph.nodes.run)).toThrow(
			'node "run" sets both "model_matrix" and "llm_model"',
		);
		try {
			resolveEffectiveModelRoutingForNode(graph, graph.nodes.run);
			expect.unreachable("expected node conflict");
		} catch (error) {
			expect(error).toBeInstanceOf(ModelMatrixResolutionError);
			const resolutionError = error as ModelMatrixResolutionError;
			expect(resolutionError.code).toBe(MODEL_MATRIX_RESOLUTION_RULE_CODES.NODE_SCOPE_CONFLICT);
			expect(resolutionError.scope).toBe("node");
			expect(resolutionError.nodeId).toBe("run");
		}
	});

	it("enforces exclusivity before attempting matrix file loads", () => {
		const graph = parse(`
	digraph graph_conflict_load_order {
		model_matrix = "config/model-matrix.json"
		llm_model = "openai/gpt-4o-mini"
		start [shape=Mdiamond]
		run [type="codergen"]
		done [shape=Msquare]
		start -> run -> done
	}
		`);
		const readFileSync = vi.fn(() => "{}");

		expect(() =>
			enforceModelMatrixContractsAtLoad({
				graph,
				workDir: "/repo",
				fs: { readFileSync },
			}),
		).toThrow(ModelMatrixResolutionError);
		expect(readFileSync).not.toHaveBeenCalled();
	});

	it("loads valid model_matrix files relative to workDir", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-model-matrix-resolution-"));
		mkdirSync(join(root, "config"), { recursive: true });
		writeFileSync(
			join(root, "config", "matrix.json"),
			JSON.stringify({
				schema_version: "matrix/v1",
				candidates: {
					fast: { model: "openai/gpt-4o-mini" },
					balanced: { model: "openai/gpt-5.3-codex" },
				},
				primary: "balanced",
			}),
			"utf-8",
		);
		const graph = parse(`
	digraph graph_matrix_load {
		model_matrix = "config/matrix.json"
		start [shape=Mdiamond]
		run [type="codergen"]
		done [shape=Msquare]
		start -> run -> done
	}
		`);

		const loaded = enforceModelMatrixContractsAtLoad({ graph, workDir: root });
		expect(loaded).toHaveLength(1);
		expect(loaded[0]?.resolvedPath).toBe(resolve(root, "config/matrix.json"));
	});
});
