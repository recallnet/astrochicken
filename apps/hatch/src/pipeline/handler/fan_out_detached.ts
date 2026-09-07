import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync, openSync, closeSync } from "node:fs";
import { resolve, join, dirname } from "node:path";

import { Context, type Outcome, StageStatus } from "../context.js";
import { nodeTrustPartition } from "../graph.js";
import { createChildId, generateRunId, runDir, saveRunState } from "../run.js";
import { createWorkflowInstrumentationHelpers } from "../instrumentation-helpers.js";
import { resolveGraphPath } from "../graph-source.js";

import type { Handler } from "../engine.js";
import type { Node } from "../graph.js";
import type { HandlerConfig } from "./register.js";
import type { ParallelFanOutEventData } from "@recallnet/factory-telemetry";

interface SpawnResult {
	childRunId: string;
	pid: number | null;
	template: string;
	item: unknown;
	error?: string;
}

/**
 * DetachedFanOutHandler reads a JSON array from context and spawns an independent
 * OS process (`hatch run`) for each item. The processes are detached and unref'd —
 * they outlive the parent pipeline. The handler returns immediately with spawn metadata.
 *
 * This is the fire-and-forget counterpart to DynamicFanOutHandler (fan_out.dynamic),
 * which blocks until all children complete. Use this handler when children are
 * long-running and the parent should not wait (e.g., wave execution from supervisor tick).
 *
 * Lifecycle management of spawned runs is handled by existing infrastructure:
 * - Run state files track each child's progress
 * - Recovery sweep detects dead PIDs and terminates orphaned runs
 * - Wave claims (labels) prevent double-dispatch
 * - Stall detection flags stuck runs
 */
export class DetachedFanOutHandler implements Handler {
	constructor(private config: HandlerConfig) {}

	async execute(_signal: AbortSignal, node: Node, ctx: Context, _input: string): Promise<Outcome> {
		const sourceKey = node.attrs["source_key"] ?? "";
		if (!sourceKey) {
			return {
				status: StageStatus.Failed,
				output: "",
				error: `fan_out.detached: node "${node.id}" missing source_key`,
			};
		}

		const itemKey = node.attrs["item_key"] ?? "item";
		const templatePath = node.attrs["template"] ?? "";
		if (!templatePath) {
			return {
				status: StageStatus.Failed,
				output: "",
				error: `fan_out.detached: node "${node.id}" missing template`,
			};
		}

		const maxConcurrency = parseInt(node.attrs["max_concurrency"] || "0", 10);

		// Parse source array from context.
		const raw = ctx.get(sourceKey);
		let items: unknown[];
		try {
			items = JSON.parse(raw);
			if (!Array.isArray(items)) throw new Error("not an array");
		} catch {
			return {
				status: StageStatus.Failed,
				output: "",
				error: `fan_out.detached: source_key "${sourceKey}" is not a JSON array`,
			};
		}

		// Immutable parent snapshot for all children.
		const parentSnapshot = ctx.all();
		const parentRunState = this.config.runState;
		const workDir = this.config.workDir || process.cwd();
		const trustPartition = nodeTrustPartition(node);
		const runId = String(ctx.get("__run_id") || parentRunState?.runId || "").trim();
		const graphName = String(this.config.graph?.name || "").trim();

		// Emit fan_out telemetry.
		const effectiveMax = Number.isFinite(maxConcurrency) && maxConcurrency > 0 ? maxConcurrency : items.length;
		const spawnCount = Math.min(effectiveMax, items.length);
		this.emitFanOutEvent(node, trustPartition, {
			node_id: node.id,
			attempt: "1",
			trust_partition: trustPartition,
			fan_out_count: String(items.length),
			max_concurrency: String(effectiveMax),
			child_handler_type: "detached_process",
			handler_type: "parallel.fan_out",
			context_inheritance: "immutable_parent_snapshot",
			parent_snapshot_key_count: String(Object.keys(parentSnapshot).length),
			...(graphName ? { graph: graphName } : {}),
			...(runId ? { run_id: runId } : {}),
		});

		if (items.length === 0) {
			return { status: StageStatus.Completed, output: "[]" };
		}

		// Resolve hatch binary. Use the CLI entry point directly with node
		// to avoid PATH dependency in detached processes.
		const hatchBin = resolveHatchBin(workDir);

		// Spawn each item as a detached process.
		const itemsToSpawn = spawnCount > 0 ? items.slice(0, spawnCount) : items;
		const results: SpawnResult[] = [];

		for (let index = 0; index < itemsToSpawn.length; index++) {
			const item = itemsToSpawn[index];
			const result = this.spawnChild({
				node,
				item,
				index,
				itemKey,
				templatePath,
				parentSnapshot,
				parentRunState,
				workDir,
				hatchBin,
			});
			results.push(result);
		}

		// Write spawn summary to output_key if specified.
		const output = JSON.stringify(results);
		const outputKey = node.attrs["output_key"] ?? "";
		const contextUpdates: Record<string, string> = {};
		if (outputKey) {
			contextUpdates[outputKey] = output;
		}
		contextUpdates["__fan_out_detached_spawn_count"] = String(results.length);
		contextUpdates["__fan_out_detached_success_count"] = String(results.filter((r) => r.pid !== null).length);
		contextUpdates["__fan_out_detached_error_count"] = String(results.filter((r) => r.error).length);

		return {
			status: StageStatus.Completed,
			output,
			contextUpdates,
		};
	}

	private spawnChild(args: {
		node: Node;
		item: unknown;
		index: number;
		itemKey: string;
		templatePath: string;
		parentSnapshot: Record<string, string>;
		parentRunState: HandlerConfig["runState"];
		workDir: string;
		hatchBin: string;
	}): SpawnResult {
		const { node, item, index, itemKey, templatePath, parentSnapshot, parentRunState, workDir, hatchBin } = args;
		const childRunId = generateRunId();
		const childId = createChildId(node.id, childRunId);
		const itemStr = typeof item === "string" ? item : JSON.stringify(item);

		try {
			// Build child context: immutable parent snapshot + item.
			const childContext: Record<string, string> = {
				...parentSnapshot,
				[itemKey]: itemStr,
				__fan_out_index: String(index),
				__fan_out_parent_node: node.id,
				__fan_out_mode: "detached",
				__parent_run_id: parentSnapshot["__run_id"] || parentRunState?.runId || "",
				__parent_graph_id: parentRunState?.pipelineFile || parentSnapshot["__pipeline_file"] || "",
				__parent_trace_id: parentSnapshot["__trace_id"] || "",
				__root_run_id: parentSnapshot["__root_run_id"] || parentSnapshot["__run_id"] || parentRunState?.runId || "",
				__root_graph_id: parentSnapshot["__root_graph_id"] || parentRunState?.pipelineFile || parentSnapshot["__pipeline_file"] || "",
				__lineage_depth: resolveChildLineageDepth(parentSnapshot["__lineage_depth"]),
			};

			// Create run directory and write context file. Do NOT create a run
			// state file here — `hatch run --run-id <id>` checks for an existing
			// state and exits with "already exists" if found. The child process
			// will create its own state on startup.
			const parentScopedRunsDir = parentRunState ? dirname(runDir(parentRunState.runId)) : "";
			const childDir = parentScopedRunsDir ? join(parentScopedRunsDir, childRunId) : runDir(childRunId);
			if (!existsSync(childDir)) mkdirSync(childDir, { recursive: true });
			const contextPath = join(childDir, "context.json");
			writeFileSync(contextPath, JSON.stringify(childContext), "utf8");

			// Spawn detached hatch process.
			const graphPath = resolveGraphPath(templatePath, workDir);
			const child = spawnDetachedHatch(hatchBin, graphPath, childRunId, contextPath, workDir, childDir, {
				defaultModel: this.config.defaultModel,
				defaultProvider: this.config.defaultProvider,
				runsDir: parentScopedRunsDir || undefined,
			});
			const pid = child.pid ?? null;

			// Register as active child in parent run state.
			if (parentRunState && pid) {
				parentRunState.activeChildren[childId] = {
					childId,
					parentNodeId: node.id,
					childRunId,
					childRunDir: childDir,
					pipelineFile: templatePath,
					status: "running",
					currentNode: "start",
					exportWriteback: {
						status: "skipped",
						reason: "detached_process",
					},
				};
				saveRunState(parentRunState);
			}

			return { childRunId, pid, template: templatePath, item };
		} catch (err) {
			return {
				childRunId,
				pid: null,
				template: templatePath,
				item,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}

	private emitFanOutEvent(node: Node, trustPartition: string, data: ParallelFanOutEventData): void {
		if (!this.config.eventBus) return;
		try {
			createWorkflowInstrumentationHelpers({
				eventBus: this.config.eventBus,
				workflowId: String(this.config.graph?.name || this.config.pipelineFile || "workflow"),
				resolveFactoryId: () => "",
				resolveRunId: () => String(this.config.runState?.runId || ""),
				defaultOwner: "apps.hatch.parallel",
			}).emitWorkflowEvent({
				kind: "parallel.fan_out",
				nodeId: node.id,
				traceId: `${trustPartition}-parallel-${sanitizeForTrace(node.id)}`,
				data,
			});
		} catch {
			// Telemetry failures must never alter handler execution semantics.
		}
	}
}

function resolveChildLineageDepth(rawDepth: string | undefined): string {
	const parsed = Number.parseInt(String(rawDepth || "0"), 10);
	if (!Number.isFinite(parsed) || parsed < 0) return "1";
	return String(parsed + 1);
}

function sanitizeForTrace(value: string): string {
	const cleaned = String(value || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
	return cleaned || "node";
}

/**
 * Resolve the hatch CLI entry point. Prefer the built dist/cli.js in the
 * local package, falling back to node_modules/.bin/hatch.
 */
function resolveHatchBin(workDir: string): string {
	// Try the dist CLI entry point (most reliable for detached processes).
	const distCli = resolve(workDir, "node_modules/hatch/dist/cli.js");
	if (existsSync(distCli)) return distCli;

	// Fallback: resolve from this package's location.
	const localCli = resolve(import.meta.dirname, "../../../../dist/cli.js");
	if (existsSync(localCli)) return localCli;

	// Last resort: rely on PATH.
	return "hatch";
}

/**
 * Spawn a detached hatch run process. The child is fully independent:
 * - detached: true → own process group
 * - stdout/stderr written to log files in run directory for debugging
 * - child.unref() → parent can exit without waiting
 */
function spawnDetachedHatch(
	hatchBin: string,
	graphPath: string,
	runId: string,
	contextPath: string,
	cwd: string,
	runDir: string,
	modelDefaults?: { defaultModel: string; defaultProvider: string; runsDir?: string },
): ChildProcess {
	const isNodeScript = hatchBin.endsWith(".js") || hatchBin.endsWith(".mjs");
	const command = isNodeScript ? process.execPath : hatchBin;
	const args = isNodeScript
		? [hatchBin, "run", graphPath, "--run-id", runId, "--context", contextPath, "--checkpoint"]
		: ["run", graphPath, "--run-id", runId, "--context", contextPath, "--checkpoint"];

	// Write stdout/stderr to log files for post-mortem debugging. The file
	// descriptors are opened here and closed immediately after spawn — the
	// child process keeps them open via its own fd table.
	const outFd = openSync(join(runDir, "stdout.log"), "w");
	const errFd = openSync(join(runDir, "stderr.log"), "w");

	const child = spawn(command, args, {
		cwd,
		detached: true,
		stdio: ["ignore", outFd, errFd],
		env: {
			...process.env,
			...(modelDefaults?.defaultModel ? { HATCH_MODEL: modelDefaults.defaultModel } : {}),
			...(modelDefaults?.defaultProvider ? { HATCH_PROVIDER: modelDefaults.defaultProvider } : {}),
			...(modelDefaults?.runsDir ? { HATCH_RUNS_DIR: modelDefaults.runsDir } : {}),
		},
	});

	child.unref();
	closeSync(outFd);
	closeSync(errFd);
	return child;
}
