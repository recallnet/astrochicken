import { EventBus, type FactoryMetadataProvider } from "@recallnet/factory-telemetry";

import { type Checkpoint, saveCheckpoint } from "./checkpoint.js";
import { parseCondition } from "./condition.js";
import { checkOutputConstraints, checkOutputFormat } from "./constraints.js";
import { type Outcome, StageStatus, type StageRecord, Context } from "./context.js";
import {
	emitDecisionArtifact,
	initializeDecisionArtifactCounter,
	DECISION_RECORD_COUNT_KEY,
} from "./decision-artifacts.js";
import { executeNodeWithRetries } from "./engine-execution.js";
import { extractNamedOutputs } from "./engine-outputs.js";
import { MatrixExecutor } from "./matrix-executor.js";
import { toCandidateResultSetJson, type CandidateResultSet } from "./types.js";
import { EngineEventBus, enrichTelemetryEvent } from "./engine-telemetry.js";
import { derivePathTakenFromSelectedEdge, resolveFastRouteHasOpenBugs } from "./fast-route.js";
import {
	nodeHandlerType,
	nodeOutputKey,
	nodeOutputs,
	nodeAgentId,
	nodeAgentRole,
	nodeTrustDomain,
	nodeTrustPartition,
	nodeTrustPartitionKey,
	nodeTrustParticipates,
	nodeTrustRole,
	outgoingEdges,
	edgeCondition,
	edgeLabel,
	edgeWeight,
	edgeInputKey,
	graphDefaultMaxRetry,
} from "./graph.js";
import {
	guardCounterForTransition,
	incrementGuardCounter,
	statusForGuardDecision,
} from "./guard.js";
import { HandlerRegistry, type Handler } from "./handler-registry.js";
import { resolveIntentBinding } from "./intent.js";
import { type RunState, saveRunState, hashOutput, sessionsDir } from "./run.js";
import { ThreadStore } from "./threads.js";
import { resolveComplexityTelemetry, complexityTelemetryEventData, mapPathTakenToExecutionPath } from "../complexity/telemetry.js";
import { createWorkflowInstrumentationHelpers } from "./instrumentation-helpers.js";

import type { Graph, Node, Edge } from "./graph.js";

/** EngineOptions configures the engine. */
export interface EngineOptions {
	eventBus?: EventBus;
	context?: Context;
	maxGlobalRetries?: number;
	/** Path to pipeline file (for checkpoint/trace). */
	pipelineFile?: string;
	/** Enable checkpointing on each node completion. */
	checkpoint?: boolean;
	/** Resume from a checkpoint (skip to this node). */
	resumeFrom?: Checkpoint;
	/** Thread store for multi-turn conversations. */
	threadStore?: ThreadStore;
	/** Run state for crash recovery. */
	runState?: RunState;
	/** Optional factory-specific metadata provider for telemetry enrichment. */
	telemetryFactoryMetadataProvider?: FactoryMetadataProvider;
}

/** Engine executes a pipeline graph. */
export class Engine {
	private graph: Graph;
	private registry: HandlerRegistry;
	private events: EngineEventBus;
	private context: Context;
	private records: StageRecord[] = [];
	private maxGlobalRetries: number;
	private pipelineFile: string;
	private checkpointEnabled: boolean;
	private resumeFrom?: Checkpoint;
	private threadStore: ThreadStore;
	private runState?: RunState;
	private readonly runHeartbeatMs: number;
	private readonly telemetryFactoryMetadataProvider?: FactoryMetadataProvider;
	private readonly graphId: string;
	private readonly instrumentation: ReturnType<typeof createWorkflowInstrumentationHelpers>;
	private readonly matrixExecutor: MatrixExecutor;
	private traceCounter = 0;
	private eventTraceCounter = 0;

	constructor(graph: Graph, registry: HandlerRegistry, options?: EngineOptions) {
		this.graph = graph;
		this.registry = registry;
		this.context = options?.context ?? new Context();
		this.maxGlobalRetries = options?.maxGlobalRetries ?? graphDefaultMaxRetry(graph);
		this.pipelineFile = options?.pipelineFile ?? "";
		this.graphId = this.pipelineFile || this.graph.name;
		this.telemetryFactoryMetadataProvider = options?.telemetryFactoryMetadataProvider;
		const sinkEvents = options?.eventBus ?? new EventBus();
		this.events = new EngineEventBus(sinkEvents, (event) => enrichTelemetryEvent(event, {
			graph: this.graph,
			graphId: this.graphId,
			pipelineFile: this.pipelineFile,
			context: this.context,
			runState: this.runState,
			factoryMetadataProvider: this.telemetryFactoryMetadataProvider,
			nextTelemetrySequence: () => this.nextTelemetrySequence(),
			latestAttemptForNode: (nodeId) => this.latestAttemptForNode(nodeId),
		}));
		this.checkpointEnabled = options?.checkpoint ?? false;
		this.resumeFrom = options?.resumeFrom;
		this.threadStore = options?.threadStore ?? new ThreadStore();
		this.runState = options?.runState;
		this.matrixExecutor = new MatrixExecutor({
			onBackgroundError: (error) => {
				this.instrumentation.emitWorkflowEvent({
					kind: "pipeline.warning",
					message: `[matrix-executor] ${error.message}`,
				});
			},
		});
		this.instrumentation = createWorkflowInstrumentationHelpers({
			eventBus: this.events,
			workflowId: this.graphId,
			resolveFactoryId: () => this.context.get("factory_id") || this.context.get("factory") || "",
			resolveRunId: () => this.context.get("__run_id") || this.runState?.runId || "",
			defaultOwner: "apps.hatch.engine",
		});
		const hbMs = Number(process.env.HATCH_RUN_HEARTBEAT_MS || "15000");
		this.runHeartbeatMs = Number.isFinite(hbMs) && hbMs > 0 ? hbMs : 15000;
		// If run state is active, inject sessions dir into context for handlers
		if (this.runState) {
			this.context.set("__run_id", this.runState.runId);
			this.context.set("__run_sessions_dir", sessionsDir(this.runState.runId));
		}
		initializeDecisionArtifactCounter(this.runState, this.context);
		if (!this.context.has(DECISION_RECORD_COUNT_KEY)) {
			this.context.set(DECISION_RECORD_COUNT_KEY, "0");
		}
	}

	/** Run the pipeline from the start node to completion. */
	async run(signal?: AbortSignal): Promise<void> {
		const startNode = Object.values(this.graph.nodes).find((n) => nodeHandlerType(n) === "start");
		if (!startNode) throw new Error("no start node found");

		this.instrumentation.emitWorkflowEvent({
			kind: "pipeline.start",
			message: this.graph.name,
			data: {
				run_id: this.context.get("__run_id") || this.runState?.runId || "no_run_id",
				graph_name: this.graph.name,
			},
		});

		let currentID = startNode.id;
		let lastOutput = "";

		// Resume from checkpoint if provided
		if (this.resumeFrom) {
			currentID = this.resumeFrom.currentNodeId;
			lastOutput = this.resumeFrom.lastOutput;
			this.context.merge(this.resumeFrom.context);
			this.records.push(...this.resumeFrom.records);
			this.instrumentation.emitWorkflowEvent({
				kind: "pipeline.start",
				message: `resuming from ${currentID}`,
				data: {
					run_id: this.context.get("__run_id") || this.runState?.runId || "no_run_id",
					graph_name: this.graph.name,
					resume_node_id: currentID,
				},
			});
		}

		while (true) {
			if (signal?.aborted) {
				this.instrumentation.emitWorkflowEvent({ kind: "pipeline.error", message: "aborted" });
				throw new Error("aborted");
			}

			const node = this.graph.nodes[currentID];
			if (!node) throw new Error(`node "${currentID}" not found`);

			// Save run state before node execution
			if (this.runState) {
				this.runState.currentNode = currentID;
				this.runState.nodeStartedAt = new Date().toISOString();
				this.runState.context = this.context.all();
				this.runState.records = this.records;
				saveRunState(this.runState, { updateMetadata: true });
			}

			let outcome: Outcome;
			try {
				outcome = await this.executeNode(signal, node, lastOutput);
			} catch (execErr) {
				// When fail_open is set, convert thrown exceptions into a
				// Failed outcome so the engine can continue past the node.
				// Without this, thrown errors bypass the fail_open check
				// and crash the entire pipeline.
				const isFailOpen = String(node.attrs["fail_open"] || "").trim() === "true";
				if (!isFailOpen) {
					// Record the error in run state before propagating so
					// diagnostics can see the failure reason even when the
					// pipeline crashes.
					if (this.runState) {
						this.runState.status = "failed";
						this.runState.context = this.context.all();
						this.runState.records = this.records;
						saveRunState(this.runState, { updateMetadata: true });
					}
					throw execErr;
				}
				outcome = {
					status: StageStatus.Failed,
					output: "",
					error: execErr instanceof Error ? execErr.message : String(execErr),
				};
			}

			if (outcome.status === StageStatus.Skipped && outcome.contextUpdates?.__guard_blocked === "true") {
				if (outcome.contextUpdates) this.context.merge(outcome.contextUpdates);
				if (this.runState) {
					const decisionState = outcome.contextUpdates?.guard_circuit_state || "open";
					this.runState.status = decisionState === "terminal" ? "guarded_terminal" : "guarded";
					this.runState.context = this.context.all();
					this.runState.records = this.records;
					saveRunState(this.runState, { updateMetadata: true });
				}
				this.instrumentation.emitWorkflowEvent({ kind: "pipeline.finish", message: "guarded" });
				return;
			}

			// Set built-in context keys
			let outcomeStr: string;
			if (outcome.status === StageStatus.Completed) outcomeStr = "success";
			else if (outcome.status === StageStatus.Failed) outcomeStr = "fail";
			else outcomeStr = outcome.status;

			this.context.set("outcome", outcomeStr);
			this.context.set("last_stage", currentID);
			if (outcome.preferredLabel) {
				this.context.set("preferred_label", outcome.preferredLabel);
			}

			if (outcome.contextUpdates) {
				this.context.merge(outcome.contextUpdates);
				const contextTelemetry = complexityTelemetryEventData(
					resolveComplexityTelemetry({
						context: this.context.all(),
						outcome,
					}),
				);
				this.instrumentation.emitWorkflowEvent({ kind: "context.update", nodeId: currentID, data: contextTelemetry });
			}

			const intentBinding = resolveIntentBinding(this.graph, node);

			// Check output constraints
			if (outcome.status === StageStatus.Completed) {
				const formatResult = checkOutputFormat(node, outcome.output);
				if (!formatResult.passed) {
					outcome.status = StageStatus.Failed;
					outcome.error = formatResult.violations.join("; ");
					outcomeStr = "fail";
					this.context.set("outcome", outcomeStr);
				} else if (formatResult.cleaned) {
					// Use fence-stripped output for downstream consumers
					outcome.output = formatResult.cleaned;
				}

				const constraintResult = checkOutputConstraints(node, outcome.output, this.context, intentBinding);
				if (!constraintResult.passed) {
					outcome.status = StageStatus.Failed;
					outcome.error = constraintResult.violations.join("; ");
					outcomeStr = "fail";
					this.context.set("outcome", outcomeStr);
				} else if (constraintResult.normalizedOutput) {
					outcome.output = constraintResult.normalizedOutput;
				}
			}

			if (outcome.status !== StageStatus.Skipped) {
				const decisionResult = emitDecisionArtifact({
					runState: this.runState,
					node,
					outcome,
					ctx: this.context,
					intentBinding,
					attempt: this.latestAttemptForNode(node.id),
					pipeline: this.pipelineFile || this.graph.name,
				});
				if (!decisionResult.ok) {
					outcome.status = StageStatus.Failed;
					outcome.error = decisionResult.error || "decision artifact emission failed";
					outcomeStr = "fail";
					this.context.set("outcome", outcomeStr);
				}
			}

			// Store output in named context key if configured
			const outputKey = nodeOutputKey(node);
			if (outputKey && outcome.output) {
				this.context.set(outputKey, outcome.output);
			} else if (outputKey && outcome.status === StageStatus.Completed && !outcome.output) {
				const ht = nodeHandlerType(node);
				if (ht === "codergen" || ht === "stack.manager_loop" || ht === "agent.worktree" || ht === "agent.kw") {
					this.instrumentation.emitWorkflowEvent({ kind: "pipeline.warning", nodeId: currentID, message: `empty_llm_output node="${currentID}" output_key="${outputKey}" handler="${ht}"` });
				}
			}

			// Fail closed for composite handoff nodes and irreversible tool
			// mutations unless the graph provides an explicit failure route.
			if (this.shouldFailClosed(node, outcome) && !this.hasExplicitFailureRoute(node)) {
				if (this.runState) {
					this.runState.status = "failed";
					saveRunState(this.runState, { updateMetadata: true });
				}
				this.instrumentation.emitWorkflowEvent({
					kind: "pipeline.error",
					message: `node "${node.id}" failed: ${outcome.error || "empty output"}`,
				});
				throw new Error(
					`pipeline halted: node "${node.id}" failed with no fail branch: ${outcome.error || "empty output"}`,
				);
			}

			// Handle named outputs (outputs="key1,key2" splits output into JSON fields)
			const outputsAttr = nodeOutputs(node);
			if (outcome.status === StageStatus.Failed && outputsAttr && outcome.output) {
				// SAFETY NET: Emit telemetry when named outputs are dropped due to
				// constraint failure. This is the class of bug where output is silently
				// eaten and downstream routing takes the wrong branch.
				this.instrumentation.emitWorkflowEvent({
					kind: "pipeline.warning",
					nodeId: currentID,
					message: `named_outputs_dropped node="${currentID}" outputs="${outputsAttr}" reason="outcome_failed" error="${outcome.error || "unknown"}"`,
				});
			}
			if (outcome.status === StageStatus.Completed && outputsAttr && outcome.output) {
				const extracted = extractNamedOutputs(outputsAttr, outcome.output);
				for (const [key, value] of extracted) {
					this.context.set(key, value);
				}
			}

			lastOutput = outcome.output;

			// Check if this is an exit node
			if (nodeHandlerType(node) === "exit") {
				if (this.runState) {
					this.runState.status = "completed";
					saveRunState(this.runState, { updateMetadata: true });
				}
				this.instrumentation.emitWorkflowEvent({ kind: "pipeline.finish", message: "completed" });
				return;
			}

			// Select next edge
			const { nextId: nextID, edge: selectedEdge } = this.selectNextEdge(node, outcome);

			if (currentID === "bug_fast_gate") {
				const hasOpenBugs = resolveFastRouteHasOpenBugs(this.context);
				const fastRouteTelemetry: Record<string, string> = {
					"fast_route.last_gate": currentID,
					"fast_route.branch": nextID,
					"fast_route.has_open_bugs": hasOpenBugs,
				};
				this.context.merge(fastRouteTelemetry);
				this.events.emit({
					kind: "fast-route.branch",
					nodeId: currentID,
					edgeFrom: currentID,
					edgeTo: nextID,
					data: fastRouteTelemetry,
				});
			}

			const transitionCounter = guardCounterForTransition(currentID, nextID, this.context.all());
			if (transitionCounter && this.runState) {
				const transitionIdentityData = this.lifecycleIdentityData(node);
				const transitionGuardContext = this.mergeLifecycleData(this.context.all(), transitionIdentityData) || this.context.all();
				const decision = incrementGuardCounter({
					runState: this.runState,
					counter: transitionCounter,
					nodeId: currentID,
					eventBus: this.events,
					context: transitionGuardContext,
					reasonCodeOverride: "recursive_reentry_overflow",
				});
				if (!decision.allowed) {
					this.context.set("guard_reason_code", decision.reasonCode || "guard_backoff_active");
					this.context.set("guard_circuit_state", decision.circuitState);
					this.context.set("guard_next_attempt_at", decision.nextAttemptAt || "");
					this.context.set("guard_backoff_ms", String(decision.backoffMs));
					this.context.set("guard_threshold", String(decision.threshold));
					this.context.set("guard_policy_revision", decision.policyRevision);
					this.context.set("gate_name", decision.gateName || (decision.counter ? `guard.${decision.counter}` : "guard.circuit"));
					this.context.set("gate_outcome", decision.gateOutcome || (decision.allowed ? "pass" : "fail"));
					this.context.set("gate_evidence_ref", decision.gateEvidenceRef || "");
					this.runState.status = statusForGuardDecision(decision);
					this.runState.context = this.context.all();
					this.runState.records = this.records;
					saveRunState(this.runState, { updateMetadata: true });
					this.instrumentation.emitActionEvent({
						kind: "stage.skip",
						nodeId: currentID,
						message: decision.reasonCode,
						data: this.mergeLifecycleData({
							guard_reason_code: decision.reasonCode,
							guard_circuit_state: decision.circuitState,
							guard_next_attempt_at: decision.nextAttemptAt,
							gate_name: decision.gateName || (decision.counter ? `guard.${decision.counter}` : "guard.circuit"),
							gate_outcome: decision.gateOutcome || (decision.allowed ? "pass" : "fail"),
							gate_evidence_ref: decision.gateEvidenceRef || "",
						}, transitionIdentityData),
					});
					this.instrumentation.emitWorkflowEvent({ kind: "pipeline.finish", message: "guarded" });
					return;
				}
			}

			const selectedPathTaken = derivePathTakenFromSelectedEdge(selectedEdge, nextID);
			const edgeData: Record<string, string> = {};
			if (selectedPathTaken) {
				this.context.set("path_taken", selectedPathTaken);
				this.context.set("hatch.execution.path", mapPathTakenToExecutionPath(selectedPathTaken, this.context.get("complexity_class")));
				edgeData.path_taken = selectedPathTaken;
				edgeData["hatch.execution.path"] = this.context.get("hatch.execution.path");
				this.instrumentation.emitWorkflowEvent({
					kind: "context.update",
					nodeId: currentID,
					data: complexityTelemetryEventData(
						resolveComplexityTelemetry({
							context: this.context.all(),
						}),
					),
				});
			}
			this.events.emit({
				kind: "edge.selected",
				edgeFrom: currentID,
				edgeTo: nextID,
				...(Object.keys(edgeData).length > 0 ? { data: edgeData } : {}),
			});

			// If edge has input_key, override lastOutput with context value
			if (selectedEdge) {
				const inputKey = edgeInputKey(selectedEdge);
				if (inputKey) {
					lastOutput = this.context.get(inputKey);
				}
			}

			// Update run state after node completion
			if (this.runState) {
				this.runState.completedNodes.push({
					id: currentID,
					completedAt: new Date().toISOString(),
					outputHash: hashOutput(lastOutput),
				});
				this.runState.lastOutput = lastOutput;
				this.runState.context = this.context.all();
				this.runState.records = this.records;
				saveRunState(this.runState, { updateMetadata: true });
			}

			// Save checkpoint if enabled
			if (this.checkpointEnabled && this.pipelineFile) {
				const { defaultCheckpointPath } = await import("./checkpoint.js");
				const cp: Checkpoint = {
					pipelineFile: this.pipelineFile,
					currentNodeId: nextID,
					lastOutput,
					context: this.context.all(),
					records: this.records,
					savedAt: new Date().toISOString(),
				};
				saveCheckpoint(defaultCheckpointPath(this.pipelineFile), cp);
				this.events.emit({ kind: "checkpoint.saved", nodeId: nextID });
			}

			currentID = nextID;
		}
	}

	private latestAttemptForNode(nodeId: string): number {
		for (let i = this.records.length - 1; i >= 0; i--) {
			const record = this.records[i];
			if (record.nodeId === nodeId) return Math.max(1, record.attempt || 1);
		}
		return 1;
	}

	private startRunHeartbeat(nodeId: string): (() => void) | null {
		const timer = setInterval(() => {
			if (this.runState) {
				this.runState.status = "running";
				this.runState.currentNode = nodeId;
				this.runState.context = this.context.all();
				this.runState.records = this.records;
				saveRunState(this.runState);
			}
			const runId = this.runState?.runId || this.context.get("__run_id") || "no_run_id";
			this.events.emit({
				kind: "pipeline.heartbeat",
				nodeId,
				data: {
					run_id: runId,
					run_status: this.runState?.status || "running",
					heartbeat_interval_ms: String(this.runHeartbeatMs),
				},
			});
		}, this.runHeartbeatMs);
		return () => clearInterval(timer);
	}
	private lifecycleIdentityData(node: Node): Record<string, string> {
		const trustPartition = nodeTrustPartition(node);
		const trustDomain = nodeTrustDomain(node);
		const trustRole = nodeTrustRole(node);
		const partitionData: Record<string, string> = {
			trust_partition: trustPartition,
			trust_domain: trustDomain,
			trust_partition_key: nodeTrustPartitionKey(node),
			trust_role: trustRole,
		};
		if (!nodeTrustParticipates(node)) return partitionData;
		return {
			...partitionData,
			agent_id: nodeAgentId(node),
			agent_role: nodeAgentRole(node),
		};
	}
	private mergeLifecycleData(
		baseData: Record<string, string> | undefined,
		identityData: Record<string, string> | undefined,
	): Record<string, string> | undefined {
		if (!identityData) return baseData;
		if (!baseData) return identityData;
		return { ...baseData, ...identityData };
	}
	private tracePartition(node: Node): string {
		return nodeTrustPartition(node);
	}
	private nextTraceId(node: Node): string {
		const partition = this.tracePartition(node);
		this.traceCounter += 1;
		return `${partition}-${String(this.traceCounter).padStart(6, "0")}`;
	}
	private nextTelemetrySequence(): number {
		this.eventTraceCounter += 1;
		return this.eventTraceCounter;
	}
	private currentGuardCircuitState(): string {
		const fromRunState = this.runState?.guard?.circuitState;
		if (fromRunState && fromRunState.trim()) return fromRunState;
		const fromContext = this.context.get("guard_circuit_state");
		if (fromContext && fromContext.trim()) return fromContext;
		return "closed";
	}

	private async executeNode(signal: AbortSignal | undefined, node: Node, input: string): Promise<Outcome> {
		let primaryAttempt = this.latestAttemptForNode(node.id);
		return this.matrixExecutor.run({
			graph: this.graph,
			node,
			context: this.context,
			execute: async (candidateNode, execution) => {
				try {
					return await executeNodeWithRetries({
						signal,
						node: candidateNode,
						input,
						graph: this.graph,
						registry: this.registry,
						events: this.events,
						context: this.context,
						threadStore: this.threadStore,
						runState: this.runState,
						records: this.records,
						instrumentation: this.instrumentation,
						startRunHeartbeat: (nodeId) => this.startRunHeartbeat(nodeId),
						lifecycleIdentityData: (n) => this.lifecycleIdentityData(n),
						mergeLifecycleData: (baseData, identityData) => this.mergeLifecycleData(baseData, identityData),
						currentGuardCircuitState: () => this.currentGuardCircuitState(),
						nextTraceId: (n) => this.nextTraceId(n),
					});
				} finally {
					if (execution?.isPrimary) {
						primaryAttempt = this.latestAttemptForNode(node.id);
					}
				}
			},
			onResultSet: (resultSet) => {
				this.persistMatrixResultSet(node.id, primaryAttempt, resultSet);
			},
		});
	}

	private persistMatrixResultSet(nodeId: string, attempt: number, resultSet: CandidateResultSet): void {
		const safeNodeId = String(nodeId || "").trim() || "unknown";
		const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 1;
		this.context.set(
			this.matrixResultSetKey(safeNodeId, safeAttempt),
			toCandidateResultSetJson(resultSet),
		);
	}

	private matrixResultSetKey(nodeId: string, attempt: number): string {
		return `matrix_result_set::${nodeId}::attempt::${attempt}`;
	}

	private shouldFailClosed(node: Node, outcome: Outcome): boolean {
		if (outcome.status !== StageStatus.Failed) return false;
		if (String(node.attrs["fail_open"] || "").trim() === "true") return false;
		const handlerType = nodeHandlerType(node);
		if (handlerType === "pipeline" || handlerType === "fan_out.dynamic" || handlerType === "fan_out.detached") {
			return true;
		}
		return handlerType === "tool" && String(node.attrs["governance"] || "").trim() === "irreversible";
	}

	private hasExplicitFailureRoute(node: Node): boolean {
		const edges = outgoingEdges(this.graph, node.id);
		return edges.some((edge) => {
			const condStr = edgeCondition(edge);
			if (!condStr) return false;
			const cond = parseCondition(condStr);
			return cond !== null && cond.evaluate(this.context.lookup());
		});
	}

	/** 5-step edge selection algorithm from the spec. Returns next node ID and the selected edge. */
	private selectNextEdge(node: Node, outcome: Outcome): { nextId: string; edge: Edge | undefined } {
		const edges = outgoingEdges(this.graph, node.id);
		if (edges.length === 0) throw new Error("no outgoing edges");
		if (edges.length === 1) return { nextId: edges[0].to, edge: edges[0] };

		let condMatched = edges.filter((e) => {
			const condStr = edgeCondition(e);
			if (!condStr) return true;
			const cond = parseCondition(condStr);
			return cond !== null && cond.evaluate(this.context.lookup());
		});

		// Prefer conditional edges over unconditional fallbacks when both match.
		// Without this, unconditional edges compete with matching conditional
		// edges and the lexical tiebreak can pick the wrong target.
		const conditionalMatched = condMatched.filter((e) => edgeCondition(e));
		if (conditionalMatched.length > 0) {
			condMatched = conditionalMatched;
		}

		if (condMatched.length === 0) {
			// Fall back to unconditional edges
			condMatched = edges.filter((e) => !edgeCondition(e));
		}
		if (condMatched.length === 0) throw new Error("no matching edges (all conditions failed)");
		if (condMatched.length === 1) return { nextId: condMatched[0].to, edge: condMatched[0] };

		if (outcome.preferredLabel) {
			const labelMatched = condMatched.filter((e) => edgeLabel(e) === outcome.preferredLabel);
			if (labelMatched.length === 1) return { nextId: labelMatched[0].to, edge: labelMatched[0] };
			if (labelMatched.length > 1) condMatched = labelMatched;
		}

		// Step 3: Prefer edges targeting suggested next nodes
		if (outcome.suggestedNextNodes && outcome.suggestedNextNodes.length > 0) {
			const suggested = new Set(outcome.suggestedNextNodes);
			const suggestedEdges = condMatched.filter((e) => suggested.has(e.to));
			if (suggestedEdges.length === 1) return { nextId: suggestedEdges[0].to, edge: suggestedEdges[0] };
			if (suggestedEdges.length > 1) condMatched = suggestedEdges;
		}

		// Step 4: Highest weight wins
		const maxWeight = Math.max(...condMatched.map((e) => edgeWeight(e)));
		const heaviest = condMatched.filter((e) => edgeWeight(e) === maxWeight);
		if (heaviest.length === 1) return { nextId: heaviest[0].to, edge: heaviest[0] };

		// Step 5: Lexical tiebreak on target node ID
		heaviest.sort((a, b) => a.to.localeCompare(b.to));
		return { nextId: heaviest[0].to, edge: heaviest[0] };
	}

	/** Get the pipeline execution context. */
	getContext(): Context {
		return this.context;
	}

	/** Get all stage execution records. */
	getRecords(): StageRecord[] {
		return this.records;
	}

	/** Get the thread store. */
	getThreadStore(): ThreadStore {
		return this.threadStore;
	}

	/** Get the run state (if tracking). */
	getRunState(): RunState | undefined {
		return this.runState;
	}

	/** Suspend the pipeline (for graceful shutdown). */
	suspend(): void {
		if (this.runState) {
			this.runState.status = "suspended";
			this.runState.context = this.context.all();
			this.runState.records = this.records;
			saveRunState(this.runState, { updateMetadata: true });
			this.events.emit({
				kind: "pipeline.suspend",
				message: this.runState.runId,
				data: {
					run_id: this.runState.runId,
					run_status: this.runState.status,
				},
			});
		}
	}
}

export { HandlerRegistry } from "./handler-registry.js";
export type { Handler } from "./handler-registry.js";

/** Replace ${key} placeholders in a string with context values. */
export function expandVariables(s: string, ctx: Context): string {
	const lookup = ctx.lookup();
	let result = "";
	let i = 0;
	while (i < s.length) {
		if (i + 1 < s.length && s[i] === "$" && s[i + 1] === "{") {
			const end = s.indexOf("}", i);
			if (end < 0) {
				result += s[i];
				i++;
				continue;
			}
			const key = s.substring(i + 2, end);
			result += lookup(key);
			i = end + 1;
		} else {
			result += s[i];
			i++;
		}
	}
	return result;
}
