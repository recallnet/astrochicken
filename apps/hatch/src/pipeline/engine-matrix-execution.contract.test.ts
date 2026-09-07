import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { Context, StageStatus, type Outcome } from "./context.js";
import { Engine, HandlerRegistry, type Handler } from "./engine.js";
import { MATRIX_CANDIDATE_RESULT_SET_CONTEXT_KEY } from "./matrix-executor.js";
import { parse } from "./parse.js";
import { parseCandidateResultSetJson } from "./types.js";

import type { Node } from "./graph.js";

class ContractToolHandler implements Handler {
	public readonly calls: string[] = [];

	async execute(_signal: AbortSignal, node: Node): Promise<Outcome> {
		const model = String(node.attrs["llm_model"] || "");
		this.calls.push(model);
		return {
			status: StageStatus.Completed,
			output: model ? `out:${model}` : "out:none",
		};
	}
}

describe("engine matrix execution contract", () => {
	it("keeps nodes without model_matrix on single-dispatch pass-through path", async () => {
		const graph = parse(`
			digraph plain {
				start [shape=Mdiamond]
				run [type="tool" llm_model="legacy-model" output_key="result"]
				done [shape=Msquare]
				start -> run -> done
			}
		`);
		const handler = new ContractToolHandler();
		const registry = new HandlerRegistry();
		registry.register("tool", handler);
		const engine = new Engine(graph, registry, { context: new Context() });

		await engine.run();

		expect(handler.calls).toEqual(["legacy-model"]);
		expect(engine.getContext().get("result")).toBe("out:legacy-model");
		expect(engine.getContext().get(MATRIX_CANDIDATE_RESULT_SET_CONTEXT_KEY)).toBe("");
		expect(engine.getContext().get("matrix_result_set::run::attempt::1")).toBe("");
	});

	it("routes model_matrix nodes through matrix path and preserves primary-output invariance", async () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-engine-matrix-contract-"));
		try {
			writeFileSync(
				join(root, "matrix.json"),
				JSON.stringify({
					schema_version: "matrix/v1",
					strategy: "all_sync",
					primary: "beta",
					candidates: {
						alpha: { model: "model-alpha", provider: "openai" },
						beta: { model: "model-beta", provider: "openai" },
					},
				}),
				"utf-8",
			);

			const graph = parse(`
				digraph matrix_enabled {
					workdir="${root}"
					start [shape=Mdiamond]
					run [type="tool" model_matrix="matrix.json" output_key="result"]
					done [shape=Msquare]
					start -> run -> done
				}
			`);
			const handler = new ContractToolHandler();
			const registry = new HandlerRegistry();
			registry.register("tool", handler);
			const engine = new Engine(graph, registry, { context: new Context() });

			await engine.run();

			expect(handler.calls.sort()).toEqual(["model-alpha", "model-beta"]);
			// Explicit regression gate: downstream output must always come from configured primary candidate.
			expect(engine.getContext().get("result")).toBe("out:model-beta");

			const persisted = engine.getContext().get("matrix_result_set::run::attempt::1");
			expect(persisted).not.toBe("");
			const resultSet = parseCandidateResultSetJson(persisted);
			expect(resultSet.primary).toBe("beta");
			expect(resultSet.candidates.map((candidate) => candidate.candidateName)).toEqual(["alpha", "beta"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
