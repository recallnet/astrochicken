import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { Context, StageStatus, type Outcome } from "./context.js";
import {
	MATRIX_CANDIDATE_RESULT_SET_CONTEXT_KEY,
	MatrixExecutor,
} from "./matrix-executor.js";
import { parseCandidateResultSetJson } from "./types.js";

import type { Graph, Node } from "./graph.js";

function createMatrixDocument(args: {
	strategy: "shadow" | "all_sync" | "rotate";
	primary: string;
	candidates: Record<string, { model: string; provider?: string }>;
}) {
	return {
		schema_version: "matrix/v1",
		candidates: args.candidates,
		primary: args.primary,
		strategy: args.strategy,
	};
}

function createGraphNode(args: {
	workDir: string;
	matrixPath?: string;
	graphMatrixPath?: string;
}): { graph: Graph; node: Node } {
	const node: Node = {
		id: "run",
		attrs: {
			type: "tool",
			workdir: args.workDir,
			...(args.matrixPath ? { model_matrix: args.matrixPath } : {}),
		},
	};
	const graph: Graph = {
		name: "matrix-test",
		attrs: {
			workdir: args.workDir,
			...(args.graphMatrixPath ? { model_matrix: args.graphMatrixPath } : {}),
		},
		nodes: { run: node },
		edges: [],
	};
	return { graph, node };
}

function writeMatrix(root: string, fileName: string, doc: unknown): string {
	const path = join(root, fileName);
	writeFileSync(path, JSON.stringify(doc, null, 2), "utf-8");
	return fileName;
}

function readCandidateResultSet(ctx: Context) {
	const raw = ctx.get(MATRIX_CANDIDATE_RESULT_SET_CONTEXT_KEY);
	expect(raw).not.toBe("");
	return parseCandidateResultSetJson(raw);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("MatrixExecutor", () => {
	it("passes through unchanged when node has no effective model_matrix routing", async () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-matrix-executor-pass-through-"));
		try {
			const { graph, node } = createGraphNode({ workDir: root });
			const context = new Context();
			const executor = new MatrixExecutor();
			const seen: Node[] = [];

			const outcome = await executor.run({
				graph,
				node,
				context,
				execute: async (candidateNode) => {
					seen.push(candidateNode);
					return {
						status: StageStatus.Completed,
						output: "single-path",
					};
				},
			});

			expect(outcome.output).toBe("single-path");
			expect(seen).toHaveLength(1);
			expect(seen[0]).toBe(node);
			expect(context.get(MATRIX_CANDIDATE_RESULT_SET_CONTEXT_KEY)).toBe("");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("shadow strategy returns primary immediately and records shadows asynchronously", async () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-matrix-executor-shadow-"));
		try {
			const matrixPath = writeMatrix(
				root,
				"matrix.json",
				createMatrixDocument({
					strategy: "shadow",
					primary: "alpha",
					candidates: {
						alpha: { model: "model-alpha", provider: "openai" },
						beta: { model: "model-beta", provider: "openai" },
						gamma: { model: "model-gamma", provider: "anthropic" },
					},
				}),
			);
			const { graph, node } = createGraphNode({ workDir: root, matrixPath });
			const context = new Context();
			const executor = new MatrixExecutor();
			let shadowGateOpen = false;
			const calls: string[] = [];

			const outcome = await executor.run({
				graph,
				node,
				context,
				execute: async (candidateNode) => {
					const model = candidateNode.attrs["llm_model"];
					calls.push(model);
					if (model !== "model-alpha") {
						while (!shadowGateOpen) {
							await delay(5);
						}
					}
					return {
						status: StageStatus.Completed,
						output: `out:${model}`,
						durationMs: model === "model-alpha" ? 5 : 25,
					};
				},
			});

			expect(outcome.output).toBe("out:model-alpha");
			expect(calls[0]).toBe("model-alpha");
			expect(context.get(MATRIX_CANDIDATE_RESULT_SET_CONTEXT_KEY)).toBe("");

			shadowGateOpen = true;
			await executor.waitForIdle();

			const resultSet = readCandidateResultSet(context);
			expect(resultSet.strategy).toBe("shadow");
			expect(resultSet.primary).toBe("alpha");
			expect(resultSet.candidates.map((entry) => entry.candidateName)).toEqual([
				"alpha",
				"beta",
				"gamma",
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("shadow strategy isolates shadow failures and still returns primary outcome", async () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-matrix-executor-shadow-failure-"));
		try {
			const matrixPath = writeMatrix(
				root,
				"matrix.json",
				createMatrixDocument({
					strategy: "shadow",
					primary: "alpha",
					candidates: {
						alpha: { model: "model-alpha" },
						beta: { model: "model-beta" },
					},
				}),
			);
			const { graph, node } = createGraphNode({ workDir: root, matrixPath });
			const context = new Context();
			const backgroundErrors: string[] = [];
			const executor = new MatrixExecutor({
				onBackgroundError: (error) => backgroundErrors.push(error.message),
			});

			const outcome = await executor.run({
				graph,
				node,
				context,
				execute: async (candidateNode) => {
					if (candidateNode.attrs["llm_model"] === "model-beta") {
						throw new Error("shadow provider unavailable");
					}
					return {
						status: StageStatus.Completed,
						output: "primary-ok",
					} satisfies Outcome;
				},
			});

			expect(outcome.output).toBe("primary-ok");
			await executor.waitForIdle();
			expect(backgroundErrors).toEqual([]);

			const resultSet = readCandidateResultSet(context);
			const beta = resultSet.candidates.find((entry) => entry.candidateName === "beta");
			expect(beta?.status).toBe("failed");
			expect(beta?.error).toContain("shadow provider unavailable");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("all_sync waits for every candidate and records full result set", async () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-matrix-executor-all-sync-"));
		try {
			const matrixPath = writeMatrix(
				root,
				"matrix.json",
				createMatrixDocument({
					strategy: "all_sync",
					primary: "alpha",
					candidates: {
						alpha: { model: "model-alpha", provider: "openai" },
						beta: { model: "model-beta", provider: "openai" },
						gamma: { model: "model-gamma", provider: "anthropic" },
					},
				}),
			);
			const { graph, node } = createGraphNode({ workDir: root, matrixPath });
			const context = new Context();
			const executor = new MatrixExecutor();
			const startedAt = Date.now();
			const callModels: string[] = [];

			const outcome = await executor.run({
				graph,
				node,
				context,
				execute: async (candidateNode) => {
					expect(candidateNode.attrs["model_matrix"]).toBe("");
					const model = candidateNode.attrs["llm_model"];
					callModels.push(model);
					if (model === "model-beta") await delay(60);
					if (model === "model-alpha") await delay(20);
					return {
						status: StageStatus.Completed,
						output: `sync:${model}`,
						durationMs: model === "model-beta" ? 60 : 20,
						usage: {
							inputTokens: 11,
							outputTokens: 13,
							totalTokens: 24,
						},
					};
				},
			});

			const elapsed = Date.now() - startedAt;
			expect(elapsed).toBeGreaterThanOrEqual(55);
			expect(outcome.output).toBe("sync:model-alpha");
			expect(callModels.sort()).toEqual(["model-alpha", "model-beta", "model-gamma"]);

			const resultSet = readCandidateResultSet(context);
			expect(resultSet.strategy).toBe("all_sync");
			expect(resultSet.matrixId).toBe("matrix.json");
			expect(resultSet.candidates).toHaveLength(3);
			expect(resultSet.candidates.every((entry) => entry.status === "success")).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rotate runs exactly one comparison candidate per invocation and persists cursor atomically", async () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-matrix-executor-rotate-"));
		try {
			const matrixPath = writeMatrix(
				root,
				"matrix.json",
				createMatrixDocument({
					strategy: "rotate",
					primary: "alpha",
					candidates: {
						alpha: { model: "model-alpha" },
						beta: { model: "model-beta" },
						gamma: { model: "model-gamma" },
					},
				}),
			);
			const { graph, node } = createGraphNode({ workDir: root, matrixPath });
			const context = new Context({ factory_id: "mothership" });

			const writes: string[] = [];
			const renames: Array<{ from: string; to: string }> = [];
			const executor = new MatrixExecutor({
				fs: {
					existsSync,
					mkdirSync,
					readFileSync,
					writeFileSync: (path, content) => {
						writes.push(path);
						writeFileSync(path, content);
					},
					renameSync: (from, to) => {
						renames.push({ from, to });
						renameSync(from, to);
					},
				},
			});

			const runModels: string[] = [];
			const execute = async (candidateNode: Node): Promise<Outcome> => {
				runModels.push(candidateNode.attrs["llm_model"]);
				return {
					status: StageStatus.Completed,
					output: candidateNode.attrs["llm_model"],
				};
			};

			await executor.run({ graph, node, context, execute });
			await executor.waitForIdle();
			const first = readCandidateResultSet(context);
			expect(first.candidates).toHaveLength(2);
			expect(first.candidates.map((entry) => entry.candidateName)).toEqual(["alpha", "beta"]);

			await executor.run({ graph, node, context, execute });
			await executor.waitForIdle();
			const second = readCandidateResultSet(context);
			expect(second.candidates).toHaveLength(2);
			expect(second.candidates.map((entry) => entry.candidateName)).toEqual(["alpha", "gamma"]);

			expect(runModels).toEqual([
				"model-alpha",
				"model-beta",
				"model-alpha",
				"model-gamma",
			]);

			expect(writes.some((path) => path.endsWith(".tmp"))).toBe(true);
			expect(renames.some((entry) => entry.from.endsWith(".tmp") && entry.to.endsWith("matrix-rotation.json"))).toBe(
				true,
			);
			const rotationPath = join(root, ".hatch", "mothership", "matrix-rotation.json");
			expect(existsSync(rotationPath)).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rotate recovers from invalid cursor state with deterministic fallback and rewrites valid JSON", async () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-matrix-executor-rotate-recovery-"));
		try {
			const matrixPath = writeMatrix(
				root,
				"matrix.json",
				createMatrixDocument({
					strategy: "rotate",
					primary: "alpha",
					candidates: {
						alpha: { model: "model-alpha" },
						beta: { model: "model-beta" },
						gamma: { model: "model-gamma" },
					},
				}),
			);
			const { graph, node } = createGraphNode({ workDir: root, matrixPath });
			const context = new Context({ factory_id: "mothership" });
			const rotationDir = join(root, ".hatch", "mothership");
			const rotationPath = join(rotationDir, "matrix-rotation.json");
			mkdirSync(rotationDir, { recursive: true });
			writeFileSync(rotationPath, "{\n  \"run::matrix.json\": 1", "utf-8");

			const runModels: string[] = [];
			const executor = new MatrixExecutor();
			await executor.run({
				graph,
				node,
				context,
				execute: async (candidateNode) => {
					runModels.push(candidateNode.attrs["llm_model"]);
					return {
						status: StageStatus.Completed,
						output: candidateNode.attrs["llm_model"],
					};
				},
			});
			await executor.waitForIdle();

			expect(runModels).toEqual(["model-alpha", "model-beta"]);
			const resultSet = readCandidateResultSet(context);
			expect(resultSet.candidates.map((entry) => entry.candidateName)).toEqual(["alpha", "beta"]);

			const persisted = JSON.parse(readFileSync(rotationPath, "utf-8")) as Record<string, unknown>;
			expect(persisted["run::matrix.json"]).toBe(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("normalizes missing and invalid usage metrics to null sentinels", async () => {
		const root = mkdtempSync(join(tmpdir(), "hatch-matrix-executor-metrics-"));
		try {
			const matrixPath = writeMatrix(
				root,
				"matrix.json",
				createMatrixDocument({
					strategy: "all_sync",
					primary: "alpha",
					candidates: {
						alpha: { model: "model-alpha" },
						beta: { model: "model-beta" },
					},
				}),
			);
			const { graph, node } = createGraphNode({ workDir: root, matrixPath });
			const context = new Context();
			const executor = new MatrixExecutor();

			await executor.run({
				graph,
				node,
				context,
				execute: async (candidateNode) => {
					if (candidateNode.attrs["llm_model"] === "model-alpha") {
						return {
							status: StageStatus.Completed,
							output: "alpha",
							durationMs: -1,
							usage: {
								inputTokens: -5,
								outputTokens: Number.NaN,
								totalTokens: Number.POSITIVE_INFINITY,
							},
						};
					}
					return {
						status: StageStatus.Completed,
						output: "beta",
					};
				},
			});

			const resultSet = readCandidateResultSet(context);
			for (const candidate of resultSet.candidates) {
				expect(candidate.inputTokens).toBeNull();
				expect(candidate.outputTokens).toBeNull();
				expect(candidate.totalTokens).toBeNull();
				expect(candidate.costUsd).toBeNull();
				expect(candidate.ttftMs).toBeNull();
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
