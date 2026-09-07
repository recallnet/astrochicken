import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	MODEL_MATRIX_LOAD_ERROR_CODES,
	ModelMatrixLoadError,
	collectModelMatrixReferences,
	loadAndValidateModelMatricesForGraph,
	loadModelMatrixFile,
	resolveModelMatrixPath,
} from "./model-matrix-loader.js";
import { parse } from "./parse.js";

describe("model-matrix-loader", () => {
	let root = "";

	afterEach(() => {
		if (!root) return;
		rmSync(root, { recursive: true, force: true });
		root = "";
	});

	it("resolves relative and absolute paths against workDir", () => {
		const relative = resolveModelMatrixPath("config/model-matrix.json", "/repo/factory");
		expect(relative).toBe(resolve("/repo/factory", "config/model-matrix.json"));

		const absoluteInput = resolve("/tmp/matrix.json");
		expect(resolveModelMatrixPath(absoluteInput, "/ignored")).toBe(absoluteInput);
	});

	it("collects graph and node model_matrix references deterministically", () => {
		const graph = parse(`
	digraph matrix_refs {
		model_matrix = "config/graph.json"
		start [shape=Mdiamond]
		a [type="codergen" model_matrix="config/node-a.json"]
		b [type="codergen" model_matrix="config/node-b.json"]
		done [shape=Msquare]
		start -> a -> b -> done
	}
		`);

		expect(collectModelMatrixReferences(graph)).toEqual([
			{ scope: "graph", rawPath: "config/graph.json" },
			{ scope: "node", nodeId: "a", rawPath: "config/node-a.json" },
			{ scope: "node", nodeId: "b", rawPath: "config/node-b.json" },
		]);
	});

	it("fails with FILE_MISSING when referenced file is absent", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-model-matrix-loader-"));
		expect(() =>
			loadModelMatrixFile({
				modelMatrixPath: "config/missing.json",
				workDir: root,
				source: 'graph model_matrix="config/missing.json"',
			}),
		).toThrow(ModelMatrixLoadError);

		try {
			loadModelMatrixFile({
				modelMatrixPath: "config/missing.json",
				workDir: root,
				source: 'graph model_matrix="config/missing.json"',
			});
			expect.unreachable("expected missing file error");
		} catch (error) {
			expect(error).toBeInstanceOf(ModelMatrixLoadError);
			const loadError = error as ModelMatrixLoadError;
			expect(loadError.code).toBe(MODEL_MATRIX_LOAD_ERROR_CODES.FILE_MISSING);
			expect(loadError.message).toContain("model_matrix_load.file.missing");
		}
	});

	it("fails with JSON_INVALID when matrix file is malformed JSON", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-model-matrix-loader-"));
		mkdirSync(join(root, "config"), { recursive: true });
		writeFileSync(join(root, "config", "broken.json"), "{\n  \"schema_version\": \"matrix/v1\",\n", "utf-8");

		try {
			loadModelMatrixFile({
				modelMatrixPath: "config/broken.json",
				workDir: root,
				source: 'node "run" model_matrix="config/broken.json"',
			});
			expect.unreachable("expected invalid json error");
		} catch (error) {
			expect(error).toBeInstanceOf(ModelMatrixLoadError);
			const loadError = error as ModelMatrixLoadError;
			expect(loadError.code).toBe(MODEL_MATRIX_LOAD_ERROR_CODES.JSON_INVALID);
			expect(loadError.message).toContain("invalid JSON");
		}
	});

	it("fails with SCHEMA_INVALID when matrix schema is invalid", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-model-matrix-loader-"));
		mkdirSync(join(root, "config"), { recursive: true });
		writeFileSync(
			join(root, "config", "invalid-schema.json"),
			JSON.stringify({
				schema_version: "matrix/v1",
				candidates: {
					only: { model: "openai/gpt-4o-mini" },
				},
				primary: "missing",
			}),
			"utf-8",
		);

		try {
			loadModelMatrixFile({
				modelMatrixPath: "config/invalid-schema.json",
				workDir: root,
				source: 'graph model_matrix="config/invalid-schema.json"',
			});
			expect.unreachable("expected schema validation error");
		} catch (error) {
			expect(error).toBeInstanceOf(ModelMatrixLoadError);
			const loadError = error as ModelMatrixLoadError;
			expect(loadError.code).toBe(MODEL_MATRIX_LOAD_ERROR_CODES.SCHEMA_INVALID);
			expect(loadError.validationIssues.length).toBeGreaterThan(0);
			expect(loadError.message).toContain("model_matrix.candidates.min_count");
		}
	});

	it("is a no-op when graph has no model_matrix references", () => {
		const graph = parse(`
	digraph no_matrix {
		start [shape=Mdiamond]
		run [type="codergen" llm_model="openai/gpt-4o-mini"]
		done [shape=Msquare]
		start -> run -> done
	}
		`);

		const loaded = loadAndValidateModelMatricesForGraph({ graph, workDir: process.cwd() });
		expect(loaded).toEqual([]);
	});

	it("deduplicates repeated references to the same resolved matrix file", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-model-matrix-loader-"));
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
	digraph dedupe {
		model_matrix = "config/matrix.json"
		start [shape=Mdiamond]
		a [type="codergen" model_matrix="config/matrix.json"]
		b [type="codergen" model_matrix="config/matrix.json"]
		done [shape=Msquare]
		start -> a -> b -> done
	}
		`);

		const loaded = loadAndValidateModelMatricesForGraph({ graph, workDir: root });
		expect(loaded).toHaveLength(1);
		expect(loaded[0]?.resolvedPath).toBe(resolve(root, "config/matrix.json"));
	});
});
