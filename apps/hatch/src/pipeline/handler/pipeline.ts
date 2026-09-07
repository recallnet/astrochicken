import { dirname, join } from "node:path";

import { findRepoRoot } from "../../intent/loader.js";
import { Context, StageStatus, type Outcome } from "../context.js";
import { Engine, HandlerRegistry, expandVariables } from "../engine.js";
import { resolveIntentMetadata } from "../intent.js";
import { parseWithAst } from "../parse.js";
import {
	createChildId,
	createRunState,
	generateRunId,
	loadRunState,
	runDir,
	saveRunState,
	type RunState,
	type ActiveChildFailure,
	type ActiveChild,
	type ActiveChildRole,
} from "../run.js";
import { enforceModelMatrixContractsAtLoad } from "../model-matrix-resolution.js";
import { applyGraphStylesheetImports } from "../stylesheet-imports.js";
import { validate, formatValidationError, hasValidationErrors } from "../validate.js";
import { graphWorkDirForResolvedSource, loadGraphSource, resolveGraphPath } from "../graph-source.js";
import {
	buildCompositeExportWritebackContextUpdates,
	buildCompositeFailureContextUpdates,
	classifyCompositeFailure,
	formatCompositeFailureError,
	resolveCompositeFailureSignals,
	type CompositeFailureDetails,
	type CompositeExportWriteback,
} from "./composite-contract.js";
import { registerAll, type HandlerConfig } from "./register.js";

import type { Handler } from "../engine.js";
import type { Node } from "../graph.js";

/** PipelineHandler runs another .dot file as a child pipeline. */
export class PipelineHandler implements Handler {
	constructor(private config: HandlerConfig) {}

	async execute(
		signal: AbortSignal,
		node: Node,
		ctx: Context,
		input: string,
		controls?: { reportProgress?: () => void },
	): Promise<Outcome> {
		const reportProgress = controls?.reportProgress ?? (() => {});
		// Resolve pipeline path
		let pipelinePath = node.attrs["pipeline"] ?? "";
		if (!pipelinePath) throw new Error(`pipeline handler: node "${node.id}" has no pipeline attribute`);
		pipelinePath = expandVariables(pipelinePath, ctx);

		pipelinePath = resolveGraphPath(pipelinePath, this.config.workDir || ".");

		const inheritContext = node.attrs["inherit_context"] === "true";
		const exportKeysAttr = node.attrs["export_keys"] ?? "";
		const exportKeyList = exportKeysAttr
			? exportKeysAttr.split(",").map((k) => k.trim()).filter(Boolean)
			: [];

		const intent = resolveIntentMetadata(node.id, {
			handlerType: "pipeline",
			kind: "pipeline",
			data: {
				pipeline: pipelinePath,
				inheritContext,
				exportKeys: exportKeyList,
				input,
			},
		});

		const parentRunState = this.config.runState;

		// Read and parse
		let dotSource: string;
		let loadedPipelinePath = pipelinePath;
		try {
			const loadedGraph = loadGraphSource(pipelinePath, this.config.workDir || ".");
			loadedPipelinePath = loadedGraph.resolvedPath;
			dotSource = loadedGraph.sourceText;
		} catch (err) {
			const failure = classifyCompositeFailure({
				error: `pipeline handler: cannot read "${pipelinePath}": ${err instanceof Error ? err.message : err}`,
				signal,
				childId: node.id,
				childNodeId: "",
				childRunId: "",
			});
			return {
				status: StageStatus.Failed,
				output: "",
				error: formatCompositeFailureError("child pipeline failed", failure),
				contextUpdates: {
					...buildCompositeFailureContextUpdates(failure),
					...buildCompositeExportWritebackContextUpdates({ status: "skipped", reason: failure.reason }),
				},
				intent,
			};
		}

		const parsedChild = parseWithAst(dotSource);
		applyGraphStylesheetImports({
			graph: parsedChild.graph,
			graphFile: loadedPipelinePath,
			stylesheetImports: parsedChild.stylesheetImports,
			repoRootPath: findRepoRoot(dirname(loadedPipelinePath)),
		});
		const childGraph = parsedChild.graph;
		const childWorkDir = this.config.workDir || graphWorkDirForResolvedSource(loadedPipelinePath, pipelinePath);
		try {
			enforceModelMatrixContractsAtLoad({ graph: childGraph, workDir: childWorkDir });
		} catch (err) {
			const failure = classifyCompositeFailure({
				error: `child pipeline model_matrix load failed: ${err instanceof Error ? err.message : String(err)}`,
				signal,
				childId: node.id,
				childNodeId: "",
				childRunId: "",
			});
			return {
				status: StageStatus.Failed,
				output: "",
				error: formatCompositeFailureError("child pipeline failed", failure),
				contextUpdates: {
					...buildCompositeFailureContextUpdates(failure),
					...buildCompositeExportWritebackContextUpdates({ status: "skipped", reason: failure.reason }),
				},
				intent,
			};
		}

		// Validate
		const errs = validate(childGraph, { identityMode: this.config.identityMode });
		if (hasValidationErrors(errs)) {
			const msg = errs.map((e) => formatValidationError(e)).join("; ");
			const failure = classifyCompositeFailure({
				error: `child pipeline validation failed: ${msg}`,
				signal,
				childId: node.id,
				childNodeId: "",
				childRunId: "",
			});
			return {
				status: StageStatus.Failed,
				output: "",
				error: formatCompositeFailureError("child pipeline failed", failure),
				contextUpdates: {
					...buildCompositeFailureContextUpdates(failure),
					...buildCompositeExportWritebackContextUpdates({ status: "skipped", reason: failure.reason }),
				},
				intent,
			};
		}

		// Create child context
		const childCtx = inheritContext ? ctx.clone() : new Context();
		seedFactoryContextIntoChildContext(childCtx, ctx);
		childCtx.set("__parent_input", input);
		seedChildLineageContext(childCtx, ctx, {
			parentRunId: ctx.get("__run_id"),
			parentGraphId: this.config.pipelineFile || this.config.runState?.pipelineFile || this.config.graph?.name || "",
		});

		// Create child run state for live introspection
		const childRunId = generateRunId();
		const childId = createChildId(node.id, childRunId);
		const workerIndex = resolveWorkerIndex(node.id);
		const parentScopedRunsDir = parentRunState ? dirname(runDir(parentRunState.runId)) : "";
		const childRunState = createRunState(
			childRunId,
			pipelinePath,
			parentScopedRunsDir ? { runsDir: parentScopedRunsDir } : undefined,
		);
		childRunState.context = childCtx.all();
		saveRunState(childRunState);
		ctx.set(`__child_run_id_${node.id}`, childRunId);
		ctx.set(`__child_pipeline_${node.id}`, pipelinePath);

		if (parentRunState) {
			const initialRole = inferChildRoleFromNode(node.id);
			parentRunState.activeChildren[childId] = {
				childId,
				parentNodeId: node.id,
				childRunId,
				childRunDir: parentScopedRunsDir ? join(parentScopedRunsDir, childRunId) : runDir(childRunId),
				pipelineFile: pipelinePath,
				role: initialRole,
				workerIndex,
				sessionId: resolveChildSessionId(childCtx),
				traceKind: inferTraceKindFromRole(initialRole),
				status: "running",
				currentNode: "start",
				exportWriteback: {
					status: "pending",
					reason: exportKeyList.length > 0 ? "waiting_for_child_success" : "no_export_keys_requested",
				},
			};
			saveRunState(parentRunState);
		}

		// Create child engine with fresh handler registry
		const childConfig: HandlerConfig = {
			...this.config,
			graph: childGraph,
			pipelineFile: loadedPipelinePath,
			runState: childRunState,
			// Keep parent workDir by default so tool commands remain repo-root relative.
			// Falling back to child pipeline directory preserves prior behavior if no parent workDir is set.
			workDir: this.config.workDir || graphWorkDirForResolvedSource(loadedPipelinePath, pipelinePath),
			eventBus: this.config.eventBus,
		};
		const childReg = new HandlerRegistry();
		registerAll(childReg, childConfig);

		const childEngine = new Engine(childGraph, childReg, {
			eventBus: this.config.eventBus,
			context: childCtx,
			runState: childRunState,
			pipelineFile: pipelinePath,
		});
		reportProgress();

		let lastReportedChildNode = "";
		let lastReportedChildStatus = "";
		const updateFromChildRunState = (): void => {
			const latest = loadRunState(childRunId);
			if (!latest) return;

			const fallbackNode = latest.currentNode || "start";
			const fallbackStatus = latest.status === "running" ? "running" : latest.status === "completed" ? "completed" : "failed";

			if (fallbackNode !== lastReportedChildNode || fallbackStatus !== lastReportedChildStatus) {
				reportProgress();
				lastReportedChildNode = fallbackNode;
				lastReportedChildStatus = fallbackStatus;
			}

			if (!parentRunState) return;
			const active = parentRunState.activeChildren[childId];
			if (!active) return;
			// @context:regression !critical child probes run every 2s for each nested
			// composite pipeline. Rewriting the parent state on no-op probes causes
			// avoidable JSON churn that scales with pipeline depth and can pin the
			// supervisor on CPU while child work is still progressing normally.
			const changed = syncActiveChildProbeState(active, latest, node.id);
			if (!changed) return;
			saveRunState(parentRunState);
		};
		updateFromChildRunState();
		const childProbe = setInterval(updateFromChildRunState, 2000);

		try {
			await childEngine.run(signal);
			reportProgress();
		} catch (err) {
			reportProgress();
			const latest = loadRunState(childRunId);
			// Finalize the child's own run state so stale-run recovery doesn't
			// have to wait its full TTL to mark orphaned children as failed.
			if (latest && latest.status === "running") {
				latest.status = "failed";
				saveRunState(latest, { updateMetadata: true });
			}
			const failureSignals = resolveCompositeFailureSignals(err, signal);
			const failure = classifyCompositeFailure({
				error: err,
				signal,
				childId: node.id,
				childNodeId: latest?.currentNode || "",
				childRunId,
				timeoutTriggered: failureSignals.timeoutTriggered,
				abortTriggered: failureSignals.abortTriggered,
			});
			if (parentRunState?.activeChildren[childId]) {
				parentRunState.activeChildren[childId].status = "failed";
				if (latest?.currentNode) parentRunState.activeChildren[childId].currentNode = latest.currentNode;
				parentRunState.activeChildren[childId].role = inferChildRoleFromNode(latest?.currentNode || node.id);
				parentRunState.activeChildren[childId].traceKind = inferTraceKindFromRole(parentRunState.activeChildren[childId].role);
				parentRunState.activeChildren[childId].sessionId = resolveChildSessionId(latest?.context || childCtx, parentRunState.activeChildren[childId].sessionId);
				parentRunState.activeChildren[childId].failure = toActiveChildFailure(failure, childId);
				parentRunState.activeChildren[childId].exportWriteback = {
					status: "skipped",
					reason: failure.reason,
				};
				saveRunState(parentRunState);
			}
			return {
				status: StageStatus.Failed,
				output: "",
				error: formatCompositeFailureError("child pipeline failed", failure),
				contextUpdates: {
					...buildCompositeFailureContextUpdates(failure),
					...buildCompositeExportWritebackContextUpdates({ status: "skipped", reason: failure.reason }),
				},
				intent,
			};
		} finally {
			clearInterval(childProbe);
		}

		// Export specified keys back to parent (only after successful child completion)
		const contextUpdates: Record<string, string> = {};
		if (exportKeyList.length > 0) {
			for (const key of exportKeyList) {
				if (childCtx.has(key)) {
					contextUpdates[key] = childCtx.get(key);
				}
			}
		}

		const exportWriteback: CompositeExportWriteback = exportKeyList.length > 0
			? { status: "applied", reason: "child_success" }
			: { status: "skipped", reason: "no_export_keys_requested" };
		if (parentRunState?.activeChildren[childId]) {
			parentRunState.activeChildren[childId].status = "completed";
			const latest = loadRunState(childRunId);
			if (latest?.currentNode) parentRunState.activeChildren[childId].currentNode = latest.currentNode;
			parentRunState.activeChildren[childId].role = inferChildRoleFromNode(latest?.currentNode || node.id);
			parentRunState.activeChildren[childId].traceKind = inferTraceKindFromRole(parentRunState.activeChildren[childId].role);
			parentRunState.activeChildren[childId].sessionId = resolveChildSessionId(latest?.context || childCtx, parentRunState.activeChildren[childId].sessionId);
			parentRunState.activeChildren[childId].failure = undefined;
			parentRunState.activeChildren[childId].exportWriteback = exportWriteback;
			saveRunState(parentRunState);
		}

		Object.assign(contextUpdates, buildCompositeExportWritebackContextUpdates(exportWriteback));

		// Child's last stage output becomes this node's output
		const records = childEngine.getRecords();
		let childOutput = "";
		if (records.length > 0) {
			childOutput = records[records.length - 1].outcome?.output ?? "";
		}

		return {
			status: StageStatus.Completed,
			output: childOutput,
			contextUpdates,
			intent,
		};
	}
}

function seedFactoryContextIntoChildContext(childCtx: Context, parentCtx: Context): void {
	const keys = [
		"factory_root",
		"factory_config_path",
		"factory_id",
		"target_repo",
		"control_plane_repo",
		"runs_dir",
		"scenarios_root",
		"factory",
		"repo",
	] as const;
	for (const key of keys) {
		if (childCtx.has(key)) continue;
		if (!parentCtx.has(key)) continue;
		const value = parentCtx.get(key);
		if (!String(value || "").trim()) continue;
		childCtx.set(key, value);
	}
}

function seedChildLineageContext(
	childCtx: Context,
	parentCtx: Context,
	args: { parentRunId?: string; parentGraphId?: string; parentTraceId?: string },
): void {
	const parentRunId = String(args.parentRunId || "").trim();
	const parentGraphId = String(args.parentGraphId || "").trim();
	const parentTraceId = String(args.parentTraceId || parentCtx.get("__trace_id") || "").trim();
	const inheritedRootRunId = String(parentCtx.get("__root_run_id") || "").trim();
	const inheritedRootGraphId = String(parentCtx.get("__root_graph_id") || "").trim();
	const inheritedDepth = Number.parseInt(String(parentCtx.get("__lineage_depth") || "0"), 10);
	const nextDepth = Number.isFinite(inheritedDepth) && inheritedDepth >= 0 ? inheritedDepth + 1 : 1;

	if (parentRunId) childCtx.set("__parent_run_id", parentRunId);
	if (parentGraphId) childCtx.set("__parent_graph_id", parentGraphId);
	if (parentTraceId) childCtx.set("__parent_trace_id", parentTraceId);
	if (inheritedRootRunId || parentRunId) childCtx.set("__root_run_id", inheritedRootRunId || parentRunId);
	if (inheritedRootGraphId || parentGraphId) childCtx.set("__root_graph_id", inheritedRootGraphId || parentGraphId);
	childCtx.set("__lineage_depth", String(nextDepth));
}

function toActiveChildFailure(failure: CompositeFailureDetails, childId: string): ActiveChildFailure {
	return {
		reason: failure.reason,
		childId: childId || failure.child.childId,
		nodeId: failure.child.nodeId,
		runId: failure.child.runId,
	};
}

export function syncActiveChildProbeState(
	active: ActiveChild,
	latest: Pick<RunState, "currentNode" | "status" | "context">,
	fallbackNodeId: string,
): boolean {
	const nextNode = latest.currentNode || active.currentNode;
	const nextStatus = latest.status === "running" ? "running" : latest.status === "completed" ? "completed" : "failed";
	const nextRole = inferChildRoleFromNode(latest.currentNode || fallbackNodeId || active.parentNodeId);
	const nextTraceKind = inferTraceKindFromRole(nextRole);
	const nextSessionId = resolveChildSessionId(latest.context, active.sessionId);
	const changed =
		active.currentNode !== nextNode ||
		active.status !== nextStatus ||
		active.role !== nextRole ||
		active.traceKind !== nextTraceKind ||
		active.sessionId !== nextSessionId;
	if (!changed) return false;
	active.currentNode = nextNode;
	active.status = nextStatus;
	active.role = nextRole;
	active.traceKind = nextTraceKind;
	active.sessionId = nextSessionId;
	return true;
}

function resolveWorkerIndex(nodeId: string): number | undefined {
	const match = String(nodeId || "").match(/__item_(\d+)$/);
	if (!match) return undefined;
	const parsed = Number(match[1]);
	if (!Number.isFinite(parsed) || parsed < 0) return undefined;
	return Math.floor(parsed);
}

function inferChildRoleFromNode(nodeId: string): ActiveChildRole | undefined {
	const normalized = String(nodeId || "").trim().toLowerCase();
	if (!normalized) return undefined;
	if (normalized === "build" || normalized.includes("build")) return "coder";
	if (normalized === "review" || normalized.includes("review")) return "reviewer";
	if (normalized === "judge" || normalized.includes("judge")) return "judge";
	if (normalized.startsWith("supervisor_") || normalized.includes("manager") || normalized === "resolve_conflict") {
		return "manager";
	}
	return undefined;
}

function inferTraceKindFromRole(role: ActiveChildRole | undefined): string {
	if (!role) return "run";
	return role;
}

function resolveChildSessionId(
	contextLike: Context | Record<string, string> | undefined,
	fallback = "",
): string {
	if (!contextLike) return fallback;
	const read = (key: string): string => {
		if (contextLike instanceof Context) {
			return contextLike.has(key) ? contextLike.get(key) : "";
		}
		return String((contextLike as Record<string, string>)[key] || "");
	};
	return read("agent_session_id") || read("session_id") || read("hatch.session_id") || fallback;
}
