import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { Context, StageStatus, type Outcome } from "./context.js";
import { Engine, HandlerRegistry, type Handler } from "./engine.js";
import { parse } from "./parse.js";
import { parseCandidateResultSetJson } from "./types.js";

import type { Node } from "./graph.js";

class RecordingToolHandler implements Handler {
	public readonly calls: Array<{ model: string; matrixAttr: string }> = [];
	public alphaAttempts = 0;

	constructor(private readonly failPrimaryFirstAttempt = false) {}

	async execute(_signal: AbortSignal, node: Node): Promise<Outcome> {
		const model = String(node.attrs["llm_model"] || "");
		this.calls.push({
			model,
			matrixAttr: String(node.attrs["model_matrix"] || ""),
		});

		if (this.failPrimaryFirstAttempt && model === "model-alpha") {
			this.alphaAttempts += 1;
			if (this.alphaAttempts === 1) {
				throw new Error("alpha-first-attempt-failed");
			}
		}

		return {
			status: StageStatus.Completed,
			output: `model:${model}`,
		};
	}
}

function writeMatrix(root: string, strategy: "all_sync" | "shadow" | "rotate" = "all_sync"): void {
	writeFileSync(
		join(root, "matrix.json"),
		JSON.stringify({
			schema_version: "matrix/v1",
			strategy,
			primary: "alpha",
			candidates: {
				alpha: { model: "model-alpha", provider: "openai" },
				beta: { model: "model-beta", provider: "openai" },
			},
		}),
		"utf-8",
	);
}

describe("engine matrix dispatch integration", () => {
	it("keeps non-matrix nodes on the legacy executeNodeWithRetries path", async () => {
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

		expect(handler.calls).toEqual([{ model: "legacy-model", matrixAttr: "" }]);
		expect(engine.getContext().get("result")).toBe("model:legacy-model");
		expect(engine.getContext().get("matrix_result_set::run::attempt::1")).toBe("");
		expect(engine.getRecords().filter((record) => record.nodeId === "run")).toHaveLength(1);
		expect(engine.getRecords().find((record) => record.nodeId === "run")?.attempt).toBe(1);
	});

	it("routes model_matrix nodes through MatrixExecutor and persists deterministic node+attempt result set keys", async () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-engine-matrix-dispatch-"));
		try {
			writeMatrix(root);
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

			expect(handler.calls.map((entry) => entry.model).sort()).toEqual(["model-alpha", "model-beta"]);
			expect(handler.calls.every((entry) => entry.matrixAttr === "")).toBe(true);
			expect(engine.getContext().get("result")).toBe("model:model-alpha");

			const persisted = engine.getContext().get("matrix_result_set::run::attempt::1");
			expect(persisted).not.toBe("");
			const resultSet = parseCandidateResultSetJson(persisted);
			expect(resultSet.primary).toBe("alpha");
			expect(resultSet.strategy).toBe("all_sync");
			expect(resultSet.candidates).toHaveLength(2);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps retry/stage accounting owned by executeNodeWithRetries without matrix-level duplication", async () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-engine-matrix-retries-"));
		try {
			writeMatrix(root);
			const graph = parse(`
				digraph matrix_retry {
					workdir="${root}"
					start [shape=Mdiamond]
					run [type="tool" model_matrix="matrix.json" output_key="result" max_retries="2"]
					done [shape=Msquare]
					start -> run -> done
				}
			`);
			const handler = new RecordingToolHandler(true);
			const registry = new HandlerRegistry();
			registry.register("tool", handler);
			const engine = new Engine(graph, registry, { context: new Context() });

			await engine.run();

			expect(handler.alphaAttempts).toBe(2);
			expect(engine.getContext().get("result")).toBe("model:model-alpha");

			const runRecords = engine.getRecords().filter((record) => record.nodeId === "run");
			expect(runRecords).toHaveLength(3);
			const alphaRecords = runRecords
				.filter((record) =>
					(record.outcome?.error || "").includes("alpha-first-attempt-failed")
					|| record.outcome?.output === "model:model-alpha",
				)
				.map((record) => record.attempt);
			expect(alphaRecords).toEqual([1, 2]);

			expect(engine.getContext().get("matrix_result_set::run::attempt::1")).toBe("");
			const persisted = engine.getContext().get("matrix_result_set::run::attempt::2");
			expect(persisted).not.toBe("");
			const resultSet = parseCandidateResultSetJson(persisted);
			expect(resultSet.primary).toBe("alpha");
			expect(resultSet.candidates).toHaveLength(2);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
