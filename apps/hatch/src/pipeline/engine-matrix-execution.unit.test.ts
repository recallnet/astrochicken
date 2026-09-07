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

class RecordingToolHandler implements Handler {
	public readonly calls: Array<{ model: string; matrixAttr: string }> = [];

	async execute(_signal: AbortSignal, node: Node): Promise<Outcome> {
		this.calls.push({
			model: String(node.attrs["llm_model"] || ""),
			matrixAttr: String(node.attrs["model_matrix"] || ""),
		});
		return {
			status: StageStatus.Completed,
			output: `model:${String(node.attrs["llm_model"] || "none")}`,
		};
	}
}

describe("engine matrix integration", () => {
	it("keeps non-matrix node execution behavior unchanged", async () => {
		const graph = parse(`
			digraph plain {
				start [shape=Mdiamond]
				run [type="tool" llm_model="legacy-model" output_key="result"]
				done [shape=Msquare]
				start -> run -> done
			}
		`);
		const handler = new RecordingToolHandler();
		const registry = new HandlerRegistry();
		registry.register("tool", handler);
		const engine = new Engine(graph, registry, { context: new Context() });

		await engine.run();

		expect(handler.calls).toEqual([
			{ model: "legacy-model", matrixAttr: "" },
		]);
		expect(engine.getContext().get("result")).toBe("model:legacy-model");
		expect(engine.getContext().get(MATRIX_CANDIDATE_RESULT_SET_CONTEXT_KEY)).toBe("");
	});

	it("routes matrix-enabled node execution through MatrixExecutor and returns primary output", async () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-engine-matrix-integration-"));
		try {
			writeFileSync(
				join(root, "matrix.json"),
				JSON.stringify({
					schema_version: "matrix/v1",
					strategy: "all_sync",
					primary: "alpha",
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
			const handler = new RecordingToolHandler();
			const registry = new HandlerRegistry();
			registry.register("tool", handler);
			const engine = new Engine(graph, registry, { context: new Context() });

			await engine.run();

			expect(handler.calls.map((entry) => entry.model).sort()).toEqual([
				"model-alpha",
				"model-beta",
			]);
			expect(handler.calls.every((entry) => entry.matrixAttr === "")).toBe(true);
			expect(engine.getContext().get("result")).toBe("model:model-alpha");

			const resultSet = parseCandidateResultSetJson(
				engine.getContext().get(MATRIX_CANDIDATE_RESULT_SET_CONTEXT_KEY),
			);
			expect(resultSet.primary).toBe("alpha");
			expect(resultSet.strategy).toBe("all_sync");
			expect(resultSet.candidates).toHaveLength(2);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
