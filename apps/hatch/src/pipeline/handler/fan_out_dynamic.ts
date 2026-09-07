import { Context, type Outcome } from "../context.js";
import { StageStatus } from "../context.js";
import { nodeTrustPartition } from "../graph.js";
import {
	buildCompositeExportWritebackContextUpdates,
	buildCompositeFailureContextUpdates,
	classifyCompositeFailure,
	formatCompositeFailureError,
	readCompositeFailureFromContextUpdates,
	resolveCompositeFailureSignals,
	validateCompositeIndexedExportOrdering,
	type CompositeFailureDetails,
} from "./composite-contract.js";
import { PipelineHandler } from "./pipeline.js";
import { createWorkflowInstrumentationHelpers } from "../instrumentation-helpers.js";

import type { Handler } from "../engine.js";
import type { HandlerConfig } from "./register.js";
import type { Node } from "../graph.js";
import type { ParallelFanInEventData, ParallelFanOutEventData } from "@recallnet/factory-telemetry";

interface DynamicFanOutChildResult {
	output: string;
	exportedUpdates: Record<string, string>;
}

interface AggregateChildExportsResult {
	ok: boolean;
	contextUpdates?: Record<string, string>;
	error?: string;
}

const FAN_OUT_EXPORT_KEY_SEGMENT_PATTERN = /^[A-Za-z0-9_.-]+$/;

/** DynamicFanOutHandler reads a JSON array from context and runs a child pipeline per item. */
export class DynamicFanOutHandler implements Handler {
	private pipelineHandler: PipelineHandler;

	constructor(private config: HandlerConfig) {
		this.pipelineHandler = new PipelineHandler(config);
	}

	private resolveAttempt(ctx: Context, nodeId: string): string {
		const explicit = String(ctx.get(`__attempt_${nodeId}`) || ctx.get("attempt") || "").trim();
		const parsed = Number(explicit);
		if (Number.isFinite(parsed) && parsed > 0) return String(Math.floor(parsed));
		return "1";
	}

	private resolveSessionId(ctx: Context, node: Node): string {
		const explicitNode = String(node.attrs["session_id"] || "").trim();
		if (explicitNode) return explicitNode;
		return String(ctx.get("session_id") || ctx.get("hatch.session_id") || "").trim();
	}

	private resolveEdge(ctx: Context): string {
		const explicitEdge = String(ctx.get("edge") || "").trim();
		if (explicitEdge) return explicitEdge;
		const from = String(ctx.get("last_stage") || "").trim();
		const to = String(ctx.get("next_stage") || "").trim();
		if (from && to) return `${from}->${to}`;
		if (from) return from;
		if (to) return to;
		return "";
	}

	private safeEmitParallelEvent(args: {
		kind: "parallel.fan_out" | "parallel.fan_in";
		node: Node;
		traceId: string;
		data: Record<string, string>;
	}): void {
		if (!this.config.eventBus) return;
		try {
			createWorkflowInstrumentationHelpers({
				eventBus: this.config.eventBus,
				workflowId: String(this.config.graph?.name || this.config.pipelineFile || "workflow"),
				resolveFactoryId: () => "",
				resolveRunId: () => String(this.config.runState?.runId || ""),
				defaultOwner: "apps.hatch.parallel",
			}).emitWorkflowEvent({
				kind: args.kind,
				nodeId: args.node.id,
				traceId: args.traceId,
				data: args.data,
			});
		} catch {
			// Telemetry failures must never alter fan-out execution semantics.
		}
	}

	async execute(signal: AbortSignal, node: Node, ctx: Context, input: string): Promise<Outcome> {
		const sourceKey = node.attrs["source_key"] ?? "";
		if (!sourceKey) throw new Error(`fan_out.dynamic: node "${node.id}" missing source_key`);

		const itemKey = node.attrs["item_key"] ?? "item";
		const templatePath = node.attrs["template"] ?? "";
		if (!templatePath) throw new Error(`fan_out.dynamic: node "${node.id}" missing template`);

		const maxConcurrency = parseInt(node.attrs["max_concurrency"] || "0", 10);

		// Parse source array from context
		const raw = ctx.get(sourceKey);
		let items: unknown[];
		try {
			items = JSON.parse(raw);
			if (!Array.isArray(items)) throw new Error("not an array");
		} catch {
			return {
				status: StageStatus.Failed,
				output: "",
				error: `fan_out.dynamic: source_key "${sourceKey}" is not a JSON array`,
			};
		}

		// Immutable base snapshot captured once for all children.
		const parentSnapshot = ctx.all();
		const parentSnapshotKeyCount = String(Object.keys(parentSnapshot).length);

		const trustPartition = nodeTrustPartition(node);
		const runId = String(ctx.get("__run_id") || this.config.runState?.runId || "").trim();
		const graphName = String(this.config.graph?.name || "").trim();
		const attempt = this.resolveAttempt(ctx, node.id);
		const sessionId = this.resolveSessionId(ctx, node);
		const pathTaken = String(ctx.get("path_taken") || ctx.get("hatch.execution.path") || "").trim();
		const edge = this.resolveEdge(ctx);
		const normalizedMaxConcurrency = Number.isFinite(maxConcurrency) && maxConcurrency > 0 ? maxConcurrency : items.length;
		const parallelTraceId = `${trustPartition}-parallel-${sanitizeForTrace(node.id)}`;

		const fanOutData: ParallelFanOutEventData = {
			node_id: node.id,
			attempt,
			trust_partition: trustPartition,
			fan_out_count: String(items.length),
			max_concurrency: String(normalizedMaxConcurrency),
			child_handler_type: "pipeline",
			handler_type: "parallel.fan_out",
			context_inheritance: "immutable_parent_snapshot",
			parent_snapshot_key_count: parentSnapshotKeyCount,
			...(sessionId ? { session_id: sessionId } : {}),
			...(graphName ? { graph: graphName } : {}),
			...(runId ? { run_id: runId } : {}),
			...(edge ? { edge } : {}),
			...(pathTaken ? { path_taken: pathTaken } : {}),
		};
		this.safeEmitParallelEvent({
			kind: "parallel.fan_out",
			node,
			traceId: parallelTraceId,
			data: fanOutData,
		});

		if (items.length === 0) {
			const fanInZero: ParallelFanInEventData = {
				node_id: node.id,
				attempt,
				trust_partition: trustPartition,
				item_count: "0",
				failed_items: "0",
				child_count: "0",
				handler_type: "parallel.fan_in",
				...(sessionId ? { session_id: sessionId } : {}),
				...(graphName ? { graph: graphName } : {}),
				...(runId ? { run_id: runId } : {}),
				...(edge ? { edge } : {}),
				...(pathTaken ? { path_taken: pathTaken } : {}),
			};
			this.safeEmitParallelEvent({
				kind: "parallel.fan_in",
				node,
				traceId: parallelTraceId,
				data: fanInZero,
			});
			return { status: StageStatus.Completed, output: "[]" };
		}

		const runOne = async (item: unknown, index: number): Promise<DynamicFanOutChildResult> => {
			// Build virtual node with pipeline attributes
			const virtualNode: Node = {
				id: `${node.id}__item_${index}`,
				attrs: {
					...node.attrs,
					pipeline: templatePath,
					inherit_context: "true",
					type: "pipeline",
				},
			};

			// Seed each child from immutable parent snapshot.
			const childCtx = new Context(parentSnapshot);
			const itemStr = typeof item === "string" ? item : JSON.stringify(item);
			childCtx.set(itemKey, itemStr);
			childCtx.set("__fan_out_index", String(index));
			childCtx.set("__fan_out_parent_snapshot_mode", "immutable");
			childCtx.set("__fan_out_parent_snapshot_key_count", parentSnapshotKeyCount);

			const outcome = await this.pipelineHandler.execute(signal, virtualNode, childCtx, input);
			if (outcome.status === StageStatus.Failed) {
				const fromOutcome = readCompositeFailureFromContextUpdates(outcome.contextUpdates);
				const failure = fromOutcome
					? { ...fromOutcome, message: outcome.error || fromOutcome.message }
					: classifyCompositeFailure({
						error: outcome.error || `fan_out.dynamic child pipeline failed at ${virtualNode.id}`,
						signal,
						childId: virtualNode.id,
						childNodeId: "",
						childRunId: childCtx.get(`__child_run_id_${virtualNode.id}`),
						...resolveCompositeFailureSignals(outcome.error, signal),
					});
				throw new CompositeChildExecutionError(failure);
			}

			const exportedUpdates = filterChildExportContextUpdates(outcome.contextUpdates);
			const output = resolveChildOutput({
				outcomeOutput: outcome.output,
				exportedUpdates,
				preferredKey: node.attrs["output_key"] ?? "",
			});

			return {
				output: output ? output.trim() : output,
				exportedUpdates,
			};
		};

		const settled =
			maxConcurrency > 0
				? await runWithConcurrencySettled(items, maxConcurrency, runOne)
				: await Promise.allSettled(items.map((item, i) => runOne(item, i)));
		const failedItems = settled.filter((entry) => entry.status === "rejected").length;
		const firstFailure = firstRejectedByInputOrder(settled);
		const compositeFailure = firstFailure
			? resolveCompositeFailure(firstFailure.reason, {
				error: firstFailure.reason,
				signal,
				childId: `${node.id}__item_${firstFailure.index}`,
				childNodeId: "",
				childRunId: "",
			})
			: null;

		const fanInData: ParallelFanInEventData = {
			node_id: node.id,
			attempt,
			trust_partition: trustPartition,
			item_count: String(items.length),
			failed_items: String(failedItems),
			child_count: String(items.length),
			handler_type: "parallel.fan_in",
			...(sessionId ? { session_id: sessionId } : {}),
			...(graphName ? { graph: graphName } : {}),
			...(runId ? { run_id: runId } : {}),
			...(edge ? { edge } : {}),
			...(pathTaken ? { path_taken: pathTaken } : {}),
			...(compositeFailure
				? {
					failure_reason: compositeFailure.reason,
					failure_child_index: String(firstFailure?.index ?? -1),
					failure_child_id: compositeFailure.child.childId,
					failure_child_node_id: compositeFailure.child.nodeId,
					failure_child_run_id: compositeFailure.child.runId,
				}
				: {}),
		};
		this.safeEmitParallelEvent({
			kind: "parallel.fan_in",
			node,
			traceId: parallelTraceId,
			data: fanInData,
		});

		if (compositeFailure) {
			return {
				status: StageStatus.Failed,
				output: "",
				error: formatCompositeFailureError("fan_out.dynamic child pipeline failed", compositeFailure),
				contextUpdates: {
					...buildCompositeFailureContextUpdates(compositeFailure),
					...buildCompositeExportWritebackContextUpdates({ status: "skipped", reason: compositeFailure.reason }),
					__fan_out_failure_index: String(firstFailure?.index ?? -1),
				},
			};
		}

		const childResults = settled.map((entry, index) => {
			if (entry.status === "fulfilled") return entry.value;
			throw new Error(`fan_out.dynamic unexpected rejected settlement at index=${index}`);
		});

		const aggregated = aggregateChildExportsByInputOrder(childResults);
		if (!aggregated.ok) {
			return {
				status: StageStatus.Failed,
				output: "",
				error: `fan_out.dynamic invalid export aggregation: ${aggregated.error}`,
				contextUpdates: {
					...buildCompositeExportWritebackContextUpdates({ status: "skipped", reason: "invalid_export_state" }),
					__fan_out_export_validation_error: String(aggregated.error || "invalid_export_state"),
				},
			};
		}

		const results = childResults.map((result) => result.output);
		const exportUpdates = aggregated.contextUpdates || {};
		const exportWriteback = Object.keys(exportUpdates).length > 0
			? { status: "applied" as const, reason: "child_success" }
			: { status: "skipped" as const, reason: "no_child_exports" };

		return {
			status: StageStatus.Completed,
			output: JSON.stringify(results),
			contextUpdates: {
				...exportUpdates,
				...buildCompositeExportWritebackContextUpdates(exportWriteback),
			},
		};
	}
}

function sanitizeForTrace(value: string): string {
	const cleaned = String(value || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
	return cleaned || "node";
}

function resolveChildOutput(args: {
	outcomeOutput: string;
	exportedUpdates: Record<string, string>;
	preferredKey: string;
}): string {
	const preferred = String(args.preferredKey || "").trim();
	if (preferred && preferred in args.exportedUpdates) {
		return args.exportedUpdates[preferred];
	}
	if (args.outcomeOutput) return args.outcomeOutput;
	if ("issue_url" in args.exportedUpdates) {
		return args.exportedUpdates["issue_url"];
	}
	const keys = Object.keys(args.exportedUpdates);
	if (keys.length === 1) return args.exportedUpdates[keys[0]];
	return "";
}

function filterChildExportContextUpdates(contextUpdates: Record<string, string> | undefined): Record<string, string> {
	if (!contextUpdates) return {};
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(contextUpdates)) {
		if (key.startsWith("__composite_")) continue;
		out[key] = typeof value === "string" ? value : JSON.stringify(value);
	}
	return out;
}

function aggregateChildExportsByInputOrder(children: DynamicFanOutChildResult[]): AggregateChildExportsResult {
	const contextUpdates: Record<string, string> = {};
	for (let index = 0; index < children.length; index += 1) {
		const childUpdates = children[index]?.exportedUpdates || {};
		const keys = Object.keys(childUpdates).sort((left, right) => left.localeCompare(right));
		for (const key of keys) {
			if (!FAN_OUT_EXPORT_KEY_SEGMENT_PATTERN.test(key)) {
				return {
					ok: false,
					error: `child export key must match ${FAN_OUT_EXPORT_KEY_SEGMENT_PATTERN.toString()}; got "${key}" at index=${index}`,
				};
			}
			contextUpdates[`${key}__${index}`] = childUpdates[key];
		}
	}

	const ordering = validateCompositeIndexedExportOrdering(contextUpdates);
	if (!ordering.ok) {
		return {
			ok: false,
			error: ordering.error || "invalid composite export ordering",
		};
	}

	return {
		ok: true,
		contextUpdates,
	};
}

function firstRejectedByInputOrder<R>(
	settled: PromiseSettledResult<R>[],
): { index: number; reason: unknown } | null {
	for (let index = 0; index < settled.length; index += 1) {
		const entry = settled[index];
		if (entry?.status !== "rejected") continue;
		return { index, reason: entry.reason };
	}
	return null;
}

function resolveCompositeFailure(
	reason: unknown,
	fallback: {
		error: unknown;
		signal: AbortSignal;
		childId: string;
		childNodeId: string;
		childRunId: string;
	},
): CompositeFailureDetails {
	if (reason instanceof CompositeChildExecutionError) {
		return reason.failure;
	}
	const failureSignals = resolveCompositeFailureSignals(reason, fallback.signal);
	return classifyCompositeFailure({
		...fallback,
		timeoutTriggered: failureSignals.timeoutTriggered,
		abortTriggered: failureSignals.abortTriggered,
	});
}

class CompositeChildExecutionError extends Error {
	readonly failure: CompositeFailureDetails;

	constructor(failure: CompositeFailureDetails) {
		super(failure.message || "composite child execution failed");
		this.name = "CompositeChildExecutionError";
		this.failure = failure;
	}
}

async function runWithConcurrencySettled<R>(
	items: unknown[],
	max: number,
	fn: (item: unknown, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
	const settled: PromiseSettledResult<R>[] = new Array(items.length);
	let nextIdx = 0;

	const worker = async () => {
		while (nextIdx < items.length) {
			const idx = nextIdx++;
			try {
				const value = await fn(items[idx], idx);
				settled[idx] = { status: "fulfilled", value };
			} catch (reason) {
				settled[idx] = { status: "rejected", reason };
			}
		}
	};

	const workers = Array.from({ length: Math.min(max, items.length) }, () => worker());
	await Promise.all(workers);
	return settled;
}

/** DynamicFanInHandler is a pass-through for graph readability. */
export class DynamicFanInHandler implements Handler {
	async execute(_signal: AbortSignal, _node: Node, _ctx: Context, input: string): Promise<Outcome> {
		return { status: StageStatus.Completed, output: input };
	}
}
