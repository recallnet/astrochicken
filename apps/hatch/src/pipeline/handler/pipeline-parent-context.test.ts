import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HandlerExecutionControls } from "../handler-registry.js";

const { registerAllMock } = vi.hoisted(() => ({
	registerAllMock: vi.fn(),
}));

vi.mock("./register.js", async () => {
	const actual = await vi.importActual<typeof import("./register.js")>("./register.js");
	registerAllMock.mockImplementation((registry: any, config: any) => actual.registerAll(registry, config));
	return {
		...actual,
		registerAll: ((registry: any, config: any) => registerAllMock(registry, config)) as typeof actual.registerAll,
	};
});

import { Context, StageStatus } from "../context.js";
import * as runModule from "../run.js";
import { createRunState, loadRunState } from "../run.js";
import { PipelineHandler, syncActiveChildProbeState } from "./pipeline.js";

import type { ActiveChild } from "../run.js";

function buildHandler(workDir: string, runId?: string, runsDir?: string): PipelineHandler {
	return new PipelineHandler({
		modelRegistry: { find: vi.fn() } as any,
		authStorage: {} as any,
		resourceLoader: {} as any,
		defaultModel: "claude-sonnet-4-6",
		defaultProvider: "anthropic",
		workDir,
		runState: runId ? createRunState(runId, join(workDir, "parent.dot"), runsDir ? { runsDir } : undefined) : undefined,
	} as any);
}

describe("PipelineHandler child context propagation", () => {
	let tempRoot: string;
	let testRunsDir: string;

	function writeModelMatrix(path: string, model = "openai/gpt-5.3-codex"): void {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(
			path,
			JSON.stringify(
				{
					schema_version: "matrix/v1",
					candidates: {
						fast: { model: "openai/gpt-4o-mini" },
						balanced: { model },
					},
					primary: "balanced",
				},
				null,
				2,
			),
			"utf-8",
		);
	}

	beforeEach(() => {
		tempRoot = mkdtempSync(join(tmpdir(), "hatch-pipeline-parent-"));
		testRunsDir = join(tempRoot, ".hatch", "runs");
		mkdirSync(testRunsDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempRoot, { recursive: true, force: true });
	});

	it("seeds parent lineage in child context and propagates child pipelineFile into child config", async () => {
		registerAllMock.mockClear();

		const childPath = join(tempRoot, "child.dot");
		writeFileSync(
			childPath,
			`digraph child {
				start [shape=Mdiamond]
				done [shape=Msquare]
				start -> done
			}`,
			"utf-8",
		);

		const handler = buildHandler(tempRoot, "run-parent-1", testRunsDir);
		const parentCtx = new Context({
			__run_id: "run-parent-1",
			__root_run_id: "run-root-1",
			__root_graph_id: "factory_supervisor_tick.dot",
			__lineage_depth: "1",
			factory_id: "mothership",
			target_repo: "recallnet/astrochicken",
			runs_dir: `${tempRoot}/.hatch/mothership/runs`,
		});
		const outcome = await handler.execute(
			new AbortController().signal,
			{
				id: "child_run",
				attrs: {
					pipeline: childPath,
				export_keys: "__parent_run_id,__parent_graph_id,__root_run_id,__root_graph_id,__lineage_depth,factory_id,target_repo,runs_dir",
				},
			} as any,
			parentCtx,
			"",
		);

		expect(outcome.status).toBe(StageStatus.Completed);
		expect(outcome.contextUpdates?.["__parent_run_id"]).toBe("run-parent-1");
		expect(outcome.contextUpdates?.["__root_run_id"]).toBe("run-root-1");
		expect(outcome.contextUpdates?.["__root_graph_id"]).toBe("factory_supervisor_tick.dot");
		expect(outcome.contextUpdates?.["__lineage_depth"]).toBe("2");
		expect(outcome.contextUpdates?.["factory_id"]).toBe("mothership");
		expect(outcome.contextUpdates?.["target_repo"]).toBe("recallnet/astrochicken");
		expect(outcome.contextUpdates?.["runs_dir"]).toBe(`${tempRoot}/.hatch/mothership/runs`);
		expect(registerAllMock).toHaveBeenCalledTimes(1);
		const childConfig = registerAllMock.mock.calls[0]?.[1] as Record<string, unknown>;
		const childRunState = childConfig["runState"] as ReturnType<typeof loadRunState>;
		expect(childRunState?.context["__parent_run_id"]).toBe("run-parent-1");
		expect(childRunState?.context["__parent_graph_id"]).toBe(join(tempRoot, "parent.dot"));
		expect(childRunState?.context["__root_run_id"]).toBe("run-root-1");
		expect(childRunState?.context["__root_graph_id"]).toBe("factory_supervisor_tick.dot");
		expect(childRunState?.context["__lineage_depth"]).toBe("2");
		expect(childRunState?.context["factory_id"]).toBe("mothership");
		expect(childRunState?.context["target_repo"]).toBe("recallnet/astrochicken");
		expect(childRunState?.context["runs_dir"]).toBe(`${tempRoot}/.hatch/mothership/runs`);
		expect(childConfig["pipelineFile"]).toBe(childPath);
	});

	it("fails child pipeline before dispatch when node model_matrix is invalid", async () => {
		const configDir = join(tempRoot, "config");
		mkdirSync(configDir, { recursive: true });
		writeFileSync(
			join(configDir, "invalid-model-matrix.json"),
			JSON.stringify({
				schema_version: "matrix/v1",
				candidates: { only: { model: "openai/gpt-4o-mini" } },
				primary: "only",
			}),
			"utf-8",
		);
		const childPath = join(tempRoot, "child-invalid-model-matrix.dot");
		writeFileSync(
			childPath,
			`digraph child_invalid_model_matrix {
				start [shape=Mdiamond]
				run [type="codergen" model_matrix="config/invalid-model-matrix.json"]
				done [shape=Msquare]
				start -> run -> done
			}`,
			"utf-8",
		);

		const handler = buildHandler(tempRoot);
		const outcome = await handler.execute(
			new AbortController().signal,
			{ id: "child_invalid_model_matrix", attrs: { pipeline: childPath, export_keys: "result" } } as any,
			new Context({ result: "parent" }),
			"",
		);

		expect(outcome.status).toBe(StageStatus.Failed);
		expect(outcome.error || "").toContain("child pipeline model_matrix load failed");
		expect(outcome.error || "").toContain("model_matrix_load.schema.invalid");
		expect(outcome.contextUpdates?.result).toBeUndefined();
	});

	it("resolves imported child stylesheets using child repo root fallback, not process cwd", async () => {
		const graphDir = join(tempRoot, "graphs");
		mkdirSync(join(tempRoot, ".git"), { recursive: true });
		mkdirSync(join(tempRoot, "shared"), { recursive: true });
		mkdirSync(graphDir, { recursive: true });

		const childPath = join(graphDir, "child-import.dot");
		writeFileSync(join(tempRoot, "shared", "defaults.stylesheet"), `* { llm_model = "imported" }\n`, "utf-8");
		writeFileSync(
			childPath,
			`@import "shared/defaults.stylesheet"
			digraph child_import {
				start [shape=Mdiamond]
				done [shape=Msquare]
				start -> done
			}`,
			"utf-8",
		);

		const handler = buildHandler(graphDir);
		const outcome = await handler.execute(
			new AbortController().signal,
			{ id: "child_import", attrs: { pipeline: childPath } } as any,
			new Context(),
			"",
		);

		expect(outcome.status).toBe(StageStatus.Completed);
	});

	it("fails child pipeline before dispatch when child model_matrix file is invalid", async () => {
		registerAllMock.mockClear();
		const childPath = join(tempRoot, "child-matrix-invalid.dot");
		const missingMatrixPath = join(tempRoot, "config", "missing-matrix.json");
		writeFileSync(
			childPath,
			`digraph child_matrix_invalid {
				model_matrix = "${missingMatrixPath}"
				start [shape=Mdiamond]
				run [type="codergen"]
				done [shape=Msquare]
				start -> run -> done
			}`,
			"utf-8",
		);

		const handler = buildHandler(tempRoot, "parent-matrix-invalid", testRunsDir);
		const outcome = await handler.execute(
			new AbortController().signal,
			{ id: "child_matrix_invalid_node", attrs: { pipeline: childPath } } as any,
			new Context(),
			"",
		);

		expect(outcome.status).toBe(StageStatus.Failed);
		expect(outcome.error || "").toContain("child pipeline model_matrix load failed");
		expect(outcome.error || "").toContain("model_matrix_load.file.missing");
	});

	it("loads child model_matrix successfully before child dispatch", async () => {
		registerAllMock.mockClear();
		const childPath = join(tempRoot, "child-matrix-valid.dot");
		const matrixPath = join(tempRoot, "config", "child-matrix.json");
		writeModelMatrix(matrixPath);
		writeFileSync(
			childPath,
			`digraph child_matrix_valid {
				model_matrix = "${matrixPath}"
				start [shape=Mdiamond]
				run [type="codergen"]
				done [shape=Msquare]
				start -> run -> done
			}`,
			"utf-8",
		);

		const handler = buildHandler(tempRoot, "parent-matrix-valid", testRunsDir);
		const outcome = await handler.execute(
			new AbortController().signal,
			{ id: "child_matrix_valid_node", attrs: { pipeline: childPath } } as any,
			new Context(),
			"",
		);

		expect(outcome.status).toBe(StageStatus.Completed);
		expect(registerAllMock).toHaveBeenCalledTimes(1);
	});

	it("normalizes timeout failures to child_timeout and marks export writeback skipped", async () => {
		const childPath = join(tempRoot, "child-timeout.dot");
		writeFileSync(
			childPath,
			`digraph child_timeout {
				start [shape=Mdiamond]
				slow [type="tool" prompt="sleep 2" timeout="1s" governance="reversible" tool_id="shell" action_id="file.write"]
				done [shape=Msquare]
				start -> slow
				slow -> done [condition="outcome=success"]
			}`,
			"utf-8",
		);

		const handler = buildHandler(tempRoot, "parent-timeout", testRunsDir);
		const outcome = await handler.execute(
			new AbortController().signal,
			{ id: "child_timeout_node", attrs: { pipeline: childPath, inherit_context: "true", export_keys: "result" } } as any,
			new Context({ result: "parent" }),
			"",
		);
		expect(outcome.status).toBe(StageStatus.Failed);
		expect(outcome.contextUpdates?.["__composite_reason"]).toBe("child_timeout");
		expect(outcome.contextUpdates?.["__composite_export_writeback_status"]).toBe("skipped");
		expect(outcome.contextUpdates?.["__composite_export_writeback_reason"]).toBe("child_timeout");
		expect(outcome.contextUpdates?.result).toBeUndefined();

		const parentState = loadRunState("parent-timeout");
		const timeoutChild = Object.values(parentState?.activeChildren || {}).find((row) => row.parentNodeId === "child_timeout_node");
		expect(timeoutChild?.failure?.reason).toBe("child_timeout");
		expect(timeoutChild?.exportWriteback?.status).toBe("skipped");
		expect(timeoutChild?.childId).toBeTruthy();
		expect(timeoutChild?.childRunId).toBeTruthy();
	});

	it("finalizes child run state to failed when child engine throws", async () => {
		const childPath = join(tempRoot, "child-finalize.dot");
		writeFileSync(
			childPath,
			`digraph child_finalize {
				start [shape=Mdiamond]
				slow [type="tool" prompt="sleep 2" timeout="1s" governance="reversible" tool_id="shell" action_id="file.write"]
				done [shape=Msquare]
				start -> slow
				slow -> done [condition="outcome=success"]
			}`,
			"utf-8",
		);

		const handler = buildHandler(tempRoot, "parent-child-finalize", testRunsDir);
		const outcome = await handler.execute(
			new AbortController().signal,
			{ id: "child_finalize_node", attrs: { pipeline: childPath, inherit_context: "true" } } as any,
			new Context(),
			"",
		);
		expect(outcome.status).toBe(StageStatus.Failed);

		// The child run's own state.json must be finalized to "failed"
		// so stale-run recovery doesn't need to clean it up 10+ minutes later.
		const parentState = loadRunState("parent-child-finalize");
		const childEntry = Object.values(parentState?.activeChildren || {}).find((row) => row.parentNodeId === "child_finalize_node");
		expect(childEntry?.childRunId).toBeTruthy();
		const childState = loadRunState(childEntry!.childRunId);
		expect(childState?.status).toBe("failed");
	});

	it("keeps parent and child state in the parent's scoped runs directory", async () => {
		const childPath = join(tempRoot, "child-scoped.dot");
		writeFileSync(
			childPath,
			`digraph child_scoped {
				start [shape=Mdiamond]
				done [shape=Msquare]
				start -> done
			}`,
			"utf-8",
		);

		const parentRunId = "parent-scoped-runs";
		const handler = buildHandler(tempRoot, parentRunId, testRunsDir);
		const outcome = await handler.execute(
			new AbortController().signal,
			{ id: "child_scoped_node", attrs: { pipeline: childPath } } as any,
			new Context(),
			"",
		);

		expect(outcome.status).toBe(StageStatus.Completed);

		const parentStatePath = join(testRunsDir, parentRunId, "state.json");
		expect(existsSync(parentStatePath)).toBe(true);
		const parentState = JSON.parse(readFileSync(parentStatePath, "utf-8")) as {
			activeChildren: Record<string, { parentNodeId: string; childRunId: string; childRunDir: string; status: string }>;
		};
		const childEntry = Object.values(parentState.activeChildren).find((row) => row.parentNodeId === "child_scoped_node");
		expect(childEntry?.status).toBe("completed");
		expect(childEntry?.childRunId).toBeTruthy();
		expect(childEntry?.childRunDir).toBe(join(testRunsDir, childEntry!.childRunId));
		expect(existsSync(join(testRunsDir, childEntry!.childRunId, "state.json"))).toBe(true);
	});

	it("normalizes externally aborted child execution to child_aborted even when child has timeout", async () => {
		const childPath = join(tempRoot, "child-abort.dot");
		writeFileSync(
			childPath,
			`digraph child_abort {
				start [shape=Mdiamond]
				slow [type="tool" prompt="sleep 2" timeout="5s" governance="reversible" tool_id="shell" action_id="file.write"]
				done [shape=Msquare]
				start -> slow
				slow -> done [condition="outcome=success"]
			}`,
			"utf-8",
		);

		const handler = buildHandler(tempRoot, "parent-abort", testRunsDir);
		const ac = new AbortController();
		const outcomePromise = handler.execute(
			ac.signal,
			{ id: "child_abort_node", attrs: { pipeline: childPath, export_keys: "result" } } as any,
			new Context({ result: "parent" }),
			"",
		);
		setTimeout(() => ac.abort(), 50);
		const outcome = await outcomePromise;

		expect(outcome.status).toBe(StageStatus.Failed);
		expect(outcome.contextUpdates?.["__composite_reason"]).toBe("child_aborted");
		expect(outcome.contextUpdates?.["__composite_child_id"]).toBe("child_abort_node");
		expect(outcome.contextUpdates?.["__composite_child_node_id"]).toBe("slow");
		expect(outcome.contextUpdates?.["__composite_child_run_id"]).toBeTruthy();
		expect(outcome.contextUpdates?.["__composite_export_writeback_status"]).toBe("skipped");
		expect(outcome.contextUpdates?.result).toBeUndefined();
	});

	it("reports progress for child start, transitions, and terminal milestones", async () => {
		const childPath = join(tempRoot, "child-progress.dot");
		writeFileSync(
			childPath,
			`digraph child_progress {
				start [shape=Mdiamond]
				slow [type="tool" prompt="sleep 0.3" timeout="5s" governance="reversible" tool_id="shell" action_id="file.write"]
				done [shape=Msquare]
				start -> slow
				slow -> done [condition="outcome=success"]
			}`,
			"utf-8",
		);

		const handler = buildHandler(tempRoot, "parent-progress", testRunsDir);
		const reportProgress = vi.fn();
		const controls: HandlerExecutionControls = { reportProgress };
		const outcome = await handler.execute(
			new AbortController().signal,
			{ id: "child_progress_node", attrs: { pipeline: childPath } } as any,
			new Context(),
			"",
			controls,
		);

		expect(outcome.status).toBe(StageStatus.Completed);
		expect(reportProgress.mock.calls.length).toBeGreaterThanOrEqual(3);
	});

	it("stores concurrent child launches under deterministic child IDs without collisions", async () => {
		const childPath = join(tempRoot, "child-concurrent.dot");
		writeFileSync(
			childPath,
			`digraph child_concurrent {
				start [shape=Mdiamond]
				slow [type="tool" prompt="sleep 1" timeout="5s" governance="reversible" tool_id="shell" action_id="file.write"]
				done [shape=Msquare]
				start -> slow
				slow -> done [condition="outcome=success"]
			}`,
			"utf-8",
		);

		const handler = buildHandler(tempRoot, "parent-concurrent", testRunsDir);
		const node = { id: "shared_child", attrs: { pipeline: childPath } } as any;
		const [a, b] = await Promise.all([
			handler.execute(new AbortController().signal, node, new Context(), ""),
			handler.execute(new AbortController().signal, node, new Context(), ""),
		]);
		expect(a.status).toBe(StageStatus.Completed);
		expect(b.status).toBe(StageStatus.Completed);

		const parentState = loadRunState("parent-concurrent");
		const children = Object.values(parentState?.activeChildren || {}).filter((row) => row.parentNodeId === "shared_child");
		expect(children.length).toBe(2);
		for (const child of children) {
			expect(child.childId).toMatch(/^shared_child__/);
			expect(child.childRunId).toBeTruthy();
			expect(child.status).toBe("completed");
			expect(child.exportWriteback?.status).toBe("skipped");
		}
		expect(new Set(children.map((row) => row.childId)).size).toBe(2);
	});

	it("treats unchanged child probe payloads as no-op parent updates", () => {
		const active: ActiveChild = {
			childId: "child_stable_probe_node__1234",
			parentNodeId: "child_stable_probe_node",
			childRunId: "1234",
			childRunDir: "/tmp/1234",
			pipelineFile: "/tmp/child.dot",
			role: "reviewer",
			traceKind: "reviewer",
			sessionId: "sess-1",
			status: "running",
			currentNode: "review",
		};

		const changed = syncActiveChildProbeState(active, {
			currentNode: "review",
			status: "running",
			context: {
				agent_session_id: "sess-1",
			},
		} as ReturnType<typeof runModule.loadRunState>, active.parentNodeId);

		expect(changed).toBe(false);
		expect(active).toMatchObject({
			currentNode: "review",
			status: "running",
			role: "reviewer",
			traceKind: "reviewer",
			sessionId: "sess-1",
		});
	});

	it("flags parent updates when a child probe changes node-derived state", () => {
		const active: ActiveChild = {
			childId: "child_build_node__5678",
			parentNodeId: "child_build_node",
			childRunId: "5678",
			childRunDir: "/tmp/5678",
			pipelineFile: "/tmp/child.dot",
			role: "reviewer",
			traceKind: "reviewer",
			sessionId: "sess-1",
			status: "running",
			currentNode: "review",
		};

		const changed = syncActiveChildProbeState(active, {
			currentNode: "build",
			status: "completed",
			context: {
				agent_session_id: "sess-2",
			},
		} as ReturnType<typeof runModule.loadRunState>, active.parentNodeId);

		expect(changed).toBe(true);
		expect(active).toMatchObject({
			currentNode: "build",
			status: "completed",
			role: "coder",
			traceKind: "coder",
			sessionId: "sess-2",
		});
	});
});
