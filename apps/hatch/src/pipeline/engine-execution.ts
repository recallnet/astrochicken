import { buildQualitySignalEventData, deriveRetryTelemetry, type EventBus } from "@recallnet/factory-telemetry";

import { type Outcome, StageStatus, type StageRecord, type Context } from "./context.js";
import {
	attachExecutionFailureSignals,
	createAbortCauseError,
	extractExecutionFailureSignals,
	type ExecutionFailureSignals,
} from "./execution-failure.js";
import {
	nodeHandlerType,
	nodeScenarios,
	nodeThreadID,
	nodeFidelity,
	nodeMaxRetries,
	nodeTimeout,
} from "./graph.js";
import {
	evaluateGuardGate,
	guardCounterForHandlerType,
	incrementGuardCounter,
} from "./guard.js";
import { createWorkflowInstrumentationHelpers } from "./instrumentation-helpers.js";
import { resolveIntentBinding } from "./intent.js";
import { loadScenarios } from "./scenarios.js";
import { resolveComplexityTelemetry, complexityTelemetryEventData } from "../complexity/telemetry.js";

import type { Graph, Node } from "./graph.js";
import type { HandlerRegistry } from "./handler-registry.js";
import type { RunState } from "./run.js";
import type { ThreadStore } from "./threads.js";


export interface ExecuteNodeParams {
	signal: AbortSignal | undefined;
	node: Node;
	input: string;
	graph: Graph;
	registry: HandlerRegistry;
	events: EventBus;
	context: Context;
	threadStore: ThreadStore;
	runState?: RunState;
	records: StageRecord[];
	instrumentation: ReturnType<typeof createWorkflowInstrumentationHelpers>;
	startRunHeartbeat: (nodeId: string) => (() => void) | null;
	lifecycleIdentityData: (node: Node) => Record<string, string>;
	mergeLifecycleData: (
		baseData: Record<string, string> | undefined,
		identityData: Record<string, string> | undefined,
	) => Record<string, string> | undefined;
	currentGuardCircuitState: () => string;
	nextTraceId: (node: Node) => string;
}

export async function executeNodeWithRetries(params: ExecuteNodeParams): Promise<Outcome> {
	const {
		signal,
		node,
		graph,
		registry,
		events,
		context,
		threadStore,
		runState,
		records,
		instrumentation,
		startRunHeartbeat,
		lifecycleIdentityData,
		mergeLifecycleData,
		currentGuardCircuitState,
		nextTraceId,
	} = params;
	let input = params.input;

	const handlerType = nodeHandlerType(node);
	const handler = registry.get(handlerType);

	if (!handler) {
		if (handlerType === "start" || handlerType === "exit") {
			return { status: StageStatus.Completed, output: input };
		}
		throw new Error(`no handler registered for type "${handlerType}"`);
	}

	const identityData = lifecycleIdentityData(node);
	const guardContext = mergeLifecycleData(context.all(), identityData) || context.all();

	if (runState) {
		const gate = evaluateGuardGate({
			runState,
			nodeId: node.id,
			eventBus: events,
			context: guardContext,
		});
		if (!gate.allowed) {
			instrumentation.emitActionEvent({
				kind: "stage.skip",
				nodeId: node.id,
				message: gate.reasonCode,
				data: mergeLifecycleData({
					guard_reason_code: gate.reasonCode,
					guard_circuit_state: gate.circuitState,
					guard_next_attempt_at: gate.nextAttemptAt,
					gate_name: gate.gateName || (gate.counter ? `guard.${gate.counter}` : "guard.circuit"),
					gate_outcome: gate.gateOutcome || (gate.allowed ? "pass" : "fail"),
					gate_evidence_ref: gate.gateEvidenceRef || "",
				}, identityData),
			});
			return {
				status: StageStatus.Skipped,
				output: "",
				error: gate.reasonCode,
				contextUpdates: {
					__guard_blocked: "true",
					guard_reason_code: gate.reasonCode,
					guard_circuit_state: gate.circuitState,
					guard_next_attempt_at: gate.nextAttemptAt,
					guard_backoff_ms: String(gate.backoffMs),
					guard_threshold: String(gate.threshold),
					guard_policy_revision: gate.policyRevision,
					gate_name: gate.gateName || (gate.counter ? `guard.${gate.counter}` : "guard.circuit"),
					gate_outcome: gate.gateOutcome || (gate.allowed ? "pass" : "fail"),
					gate_evidence_ref: gate.gateEvidenceRef || "",
				},
			};
		}

		const handlerCounter = guardCounterForHandlerType(handlerType);
		if (handlerCounter) {
			const decision = incrementGuardCounter({
				runState,
				counter: handlerCounter,
				nodeId: node.id,
				eventBus: events,
				context: guardContext,
			});
			if (!decision.allowed) {
				instrumentation.emitActionEvent({
					kind: "stage.skip",
					nodeId: node.id,
					message: decision.reasonCode,
					data: mergeLifecycleData({
						guard_reason_code: decision.reasonCode,
						guard_circuit_state: decision.circuitState,
						guard_next_attempt_at: decision.nextAttemptAt,
						gate_name: decision.gateName || (decision.counter ? `guard.${decision.counter}` : "guard.circuit"),
						gate_outcome: decision.gateOutcome || (decision.allowed ? "pass" : "fail"),
						gate_evidence_ref: decision.gateEvidenceRef || "",
					}, identityData),
				});
				return {
					status: StageStatus.Skipped,
					output: "",
					error: decision.reasonCode,
					contextUpdates: {
						__guard_blocked: "true",
						guard_reason_code: decision.reasonCode,
						guard_circuit_state: decision.circuitState,
						guard_next_attempt_at: decision.nextAttemptAt,
						guard_backoff_ms: String(decision.backoffMs),
						guard_threshold: String(decision.threshold),
						guard_policy_revision: decision.policyRevision,
						gate_name: decision.gateName || (decision.counter ? `guard.${decision.counter}` : "guard.circuit"),
						gate_outcome: decision.gateOutcome || (decision.allowed ? "pass" : "fail"),
						gate_evidence_ref: decision.gateEvidenceRef || "",
					},
				};
			}
		}
	}

	const scenariosAttr = nodeScenarios(node);
	if (scenariosAttr) {
		const scenarioContext = loadScenarios(scenariosAttr, context.get("scenarios_root"));
		if (scenarioContext) {
			input = input ? scenarioContext + "\n\n" + input : scenarioContext;
		}
	}

	const threadId = nodeThreadID(node);
	if (threadId) {
		const fidelity = nodeFidelity(node) || "full";
		const threadContext = threadStore.buildContext(threadId, fidelity);
		if (threadContext) {
			input = input
				? "Previous conversation:\n" + threadContext + "\n\n---\n\n" + input
				: "Previous conversation:\n" + threadContext;
		}
		threadStore.addMessage(threadId, { role: "user", content: input });
	}

	let maxRetries = nodeMaxRetries(node);
	if (maxRetries === 0) maxRetries = 1;

	let lastErr: Error | undefined;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		const traceId = nextTraceId(node);
		const model = node.attrs["llm_model"] || node.attrs["agent_model"] || "";
		const guardState = currentGuardCircuitState();
		const lifecycleBaseData = {
			attempt: String(attempt),
			handler_type: handlerType,
			model,
			guard_circuit_state: guardState,
		};
		instrumentation.emitActionEvent({
			kind: "stage.start",
			nodeId: node.id,
			traceId,
			data: mergeLifecycleData(lifecycleBaseData, identityData),
		});

		const start = Date.now();

		let nodeSignal: AbortSignal;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		const timeoutMs = nodeTimeout(node, context.lookup());
		let timeoutTriggered = false;
		let abortTriggered = false;

		if (timeoutMs > 0) {
			const ac = new AbortController();
			if (signal?.aborted) {
				abortTriggered = true;
				ac.abort();
			} else if (signal) {
				signal.addEventListener(
					"abort",
					() => {
						abortTriggered = true;
						ac.abort();
					},
					{ once: true },
				);
			}
			timeoutId = setTimeout(() => {
				timeoutTriggered = true;
				ac.abort();
			}, timeoutMs);
			nodeSignal = ac.signal;
		} else {
			nodeSignal = signal ?? new AbortController().signal;
		}

		const stopHeartbeat = startRunHeartbeat(node.id);
		const executionControls = {
			reportProgress: () => {},
		};
		try {
			let outcome: Outcome;
			if (timeoutMs > 0) {
				outcome = await Promise.race([
					handler.execute(nodeSignal, node, context, input, executionControls),
					new Promise<never>((_, reject) => {
						nodeSignal.addEventListener(
							"abort",
							() => {
								const failureSignals: ExecutionFailureSignals = timeoutTriggered
									? { timeoutTriggered: true, abortTriggered: false }
									: { timeoutTriggered: false, abortTriggered: abortTriggered || Boolean(signal?.aborted) };
								reject(createAbortCauseError(node.id, timeoutMs, failureSignals));
							},
							{ once: true },
						);
					}),
				]);
			} else {
				outcome = await handler.execute(nodeSignal, node, context, input, executionControls);
			}
			if (timeoutId) clearTimeout(timeoutId);
			if (stopHeartbeat) stopHeartbeat();

			const intentBinding = resolveIntentBinding(graph, node);
			if (outcome.intent && intentBinding) {
				outcome.intent = {
					...outcome.intent,
					intentRef: intentBinding.intentRef,
					intentProfile: intentBinding.profile,
					intentPatches: intentBinding.patches,
				};
			}

			outcome.durationMs = Date.now() - start;
			records.push({
				nodeId: node.id,
				status: outcome.status === StageStatus.Failed ? StageStatus.Failed : StageStatus.Completed,
				outcome,
				startedAt: new Date(start),
				endedAt: new Date(),
				attempt,
			});

			if (threadId && outcome.output) {
				threadStore.addMessage(threadId, { role: "assistant", content: outcome.output });
			}

			const complexityTelemetry = resolveComplexityTelemetry({
				context: context.all(),
				outcome,
			});
			const complexityData = complexityTelemetryEventData(complexityTelemetry);
			const lifecycleData = mergeLifecycleData(
				{
					...complexityData,
					handler_type: handlerType,
					model,
					guard_circuit_state: guardState,
					...deriveRetryTelemetry({ attempt, outcome: "pass" }),
				},
				identityData,
			);
			instrumentation.emitActionEvent({
				kind: "stage.finish",
				nodeId: node.id,
				traceId,
				message: outcome.output,
				intent: outcome.intent,
				...(lifecycleData ? { data: lifecycleData } : {}),
			});
			if (handlerType === "parallel.fan_out" || handlerType === "parallel.fan_in") {
				instrumentation.emitWorkflowEvent({
					kind: handlerType,
					nodeId: node.id,
					traceId,
					data: mergeLifecycleData(
						{
							handler_type: handlerType,
							attempt: String(attempt),
							outcome: "pass",
						},
						identityData,
					),
				});
			}
			const qualityData = buildQualitySignalEventData({
				kind: "stage.finish",
				timestamp: new Date(),
				nodeId: node.id,
				traceId,
				data: {
					...(lifecycleData || {}),
					attempt: String(attempt),
					guard_circuit_state: guardState,
				},
			});
			if (qualityData) {
				instrumentation.emitWorkflowEvent({
					kind: "quality.signal",
					nodeId: node.id,
					traceId,
					data: qualityData,
				});
			}
			return outcome;
		} catch (err) {
			if (timeoutId) clearTimeout(timeoutId);
			if (stopHeartbeat) stopHeartbeat();
			lastErr = err instanceof Error ? err : new Error(String(err));

			records.push({
				nodeId: node.id,
				status: StageStatus.Failed,
				outcome: {
					status: StageStatus.Failed,
					output: "",
					error: lastErr.message,
					durationMs: Date.now() - start,
				},
				startedAt: new Date(start),
				endedAt: new Date(),
				attempt,
			});

			const errorLifecycleData = mergeLifecycleData(
				{
					attempt: String(attempt),
					handler_type: handlerType,
					model,
					guard_circuit_state: guardState,
					...deriveRetryTelemetry({ attempt, outcome: "fail" }),
				},
				identityData,
			);
			if (handlerType === "parallel.fan_out" || handlerType === "parallel.fan_in") {
				instrumentation.emitWorkflowEvent({
					kind: handlerType,
					nodeId: node.id,
					traceId,
					data: mergeLifecycleData(
						{
							handler_type: handlerType,
							attempt: String(attempt),
							outcome: "fail",
						},
						identityData,
					),
				});
			}
			instrumentation.emitActionEvent({
				kind: "stage.error",
				nodeId: node.id,
				traceId,
				error: lastErr,
				data: errorLifecycleData,
			});
			const qualityData = buildQualitySignalEventData({
				kind: "stage.error",
				timestamp: new Date(),
				nodeId: node.id,
				traceId,
				error: lastErr,
				data: errorLifecycleData,
			});
			if (qualityData) {
				instrumentation.emitWorkflowEvent({
					kind: "quality.signal",
					nodeId: node.id,
					traceId,
					data: qualityData,
				});
			}

			if (attempt < maxRetries) {
				instrumentation.emitActionEvent({
					kind: "stage.retry",
					nodeId: node.id,
					traceId,
					data: mergeLifecycleData(
						{
							attempt: String(attempt + 1),
							handler_type: handlerType,
							model,
							guard_circuit_state: guardState,
							"hatch.retry_class": "retry_scheduled",
							"hatch.first_attempt_pass": "false",
						},
						identityData,
					),
				});
			}
		}
	}

	const wrapped = new Error(`after ${maxRetries} attempts: ${lastErr?.message}`);
	const failureSignals = extractExecutionFailureSignals(lastErr);
	if (failureSignals) {
		throw attachExecutionFailureSignals(wrapped, failureSignals);
	}
	throw wrapped;
}
