import { describe, expect, it } from "vitest";

import { MODEL_MATRIX_RESOLUTION_RULE_CODES } from "./model-matrix-resolution.js";
import { parse } from "./parse.js";
import { validate } from "./validate.js";

describe("model_matrix validation", () => {
	it("emits validation error when graph sets model_matrix and llm_model", () => {
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

		const errors = validate(graph).filter((error) => error.rule === "model_matrix_resolution");
		expect(errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					rule: "model_matrix_resolution",
					code: MODEL_MATRIX_RESOLUTION_RULE_CODES.GRAPH_SCOPE_CONFLICT,
					message: expect.stringContaining('graph sets both "model_matrix" and "llm_model"'),
				}),
			]),
		);
	});

	it("emits validation error when node sets model_matrix and llm_model", () => {
		const graph = parse(`
	digraph node_conflict {
		start [shape=Mdiamond]
		run [type="codergen" model_matrix="config/model-matrix.json" llm_model="openai/gpt-4o-mini"]
		done [shape=Msquare]

		start -> run -> done
	}
		`);

		const errors = validate(graph).filter((error) => error.rule === "model_matrix_resolution");
		expect(errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					rule: "model_matrix_resolution",
					code: MODEL_MATRIX_RESOLUTION_RULE_CODES.NODE_SCOPE_CONFLICT,
					nodeId: "run",
					message: expect.stringContaining('node "run" sets both "model_matrix" and "llm_model"'),
				}),
			]),
		);
	});

	it("keeps llm_model-only graph behavior unchanged", () => {
		const graph = parse(`
	digraph llm_only {
		llm_model = "openai/gpt-4o-mini"
		start [shape=Mdiamond]
		run [type="codergen" llm_model="anthropic/claude-sonnet-4-6"]
		done [shape=Msquare]

		start -> run -> done
	}
		`);

		const errors = validate(graph).filter((error) => error.rule === "model_matrix_resolution");
		expect(errors).toHaveLength(0);
	});
});
