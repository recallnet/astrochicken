import {
	EventBus,
	createLangfuseTelemetry,
	emitGovernedOtelEvent,
	registerTelemetryFlushHook,
	registerTelemetryShutdownHook,
	type Event,
	type FactoryMetadataProvider,
} from "@recallnet/factory-telemetry";

import type { RunLifecycleEvent } from "./run-lifecycle.js";

export interface ReactorInstrumentationOptions {
	eventBus: EventBus;
	workflowId: string;
	resolveRunId?: () => string;
	resolveFactoryId?: () => string;
	capabilityId?: string;
	defaultOwner?: string;
	// Langfuse lifecycle context — when provided, creates and registers
	// a Langfuse client that flushes/shuts down alongside the OTel runtime.
	langfuseContext?: {
		runId: string;
		graphName: string;
		pipelineFile: string;
		factoryMetadataProvider?: FactoryMetadataProvider;
	};
}

function trim(value: unknown): string {
	return String(value || "").trim();
}

function sanitizeSegment(value: string): string {
	const cleaned = trim(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
	return cleaned || "unknown";
}

function resolveCapabilityId(workflowId: string, capabilityId = ""): string {
	if (trim(capabilityId)) return trim(capabilityId);
	const capabilityMatch = workflowId.match(/packages\/capability-([^/]+)/);
	if (capabilityMatch?.[1]) return sanitizeSegment(capabilityMatch[1]);
	const factoryMatch = workflowId.match(/factories\/([^/]+)/);
	if (factoryMatch?.[1]) return `factory_${sanitizeSegment(factoryMatch[1])}`;
	return sanitizeSegment(workflowId);
}

function resolveStatusFromGuardEvent(event: Event): string {
	if (event.kind === "guard.transition") return trim(event.data?.guard_circuit_state) || "transition";
	if (event.kind === "guard.reset") return "reset";
	if (trim(event.data?.allowed) === "true") return "allowed";
	if (trim(event.data?.allowed) === "false") return "blocked";
	return trim(event.data?.guard_circuit_state) || "observed";
}

function resolveFactoryId(event: Event, options: ReactorInstrumentationOptions): string {
	return trim(event.data?.factory_id) || trim(options.resolveFactoryId?.()) || "standalone";
}

function resolveRunId(event: Event, options: ReactorInstrumentationOptions): string {
	return trim(event.data?.run_id) || trim(options.resolveRunId?.()) || "no_run_id";
}

export function createReactorInstrumentationHelpers(options: ReactorInstrumentationOptions) {
	// @context:regression !critical Langfuse telemetry was disconnected in
	// e6b77eec (March 20) — no traces ingested for 9 days. Re-create the
	// client here (owned by the reactor layer) and register flush/shutdown
	// as auxiliary hooks so traces are delivered when the OTel runtime flushes.
	if (options.langfuseContext) {
		const lf = createLangfuseTelemetry({
			runId: options.langfuseContext.runId,
			graphName: options.langfuseContext.graphName,
			pipelineFile: options.langfuseContext.pipelineFile,
			factoryMetadataProvider: options.langfuseContext.factoryMetadataProvider,
		});
		if (lf) {
			registerTelemetryFlushHook(() => lf.flush());
			registerTelemetryShutdownHook(() => lf.shutdown());
		}
	}

	const workflowId = trim(options.workflowId) || "workflow";
	const capabilityId = resolveCapabilityId(workflowId, options.capabilityId);
	const owner = trim(options.defaultOwner) || "apps.hatch.reactor";

	const emitReactorOtel = (event: Event) => {
		const severityText = trim(event.data?.allowed) === "false" ? "WARN" : "INFO";
		const factoryId = resolveFactoryId(event, options);
		const runId = resolveRunId(event, options);
		const resolvedWorkflowId = trim(event.data?.workflow_id) || workflowId;
		const resolvedCapabilityId = trim(event.data?.capability_id) || capabilityId;
		const resolvedOwner = trim(event.data?.owner) || owner;
		const summary = trim(event.message) || trim(event.data?.reason_code) || trim(event.nodeId) || undefined;
		const triggerReason = trim(event.data?.reason_code) || undefined;
		const traceId = trim(event.traceId) || trim(event.data?.guard_trace_id) || undefined;
		switch (event.kind) {
			case "guard.decision":
				emitGovernedOtelEvent({
					event_name: "hatch.reactor.guard_decision",
					severity_text: severityText,
					correlation: {
						factory_id: factoryId,
						run_id: runId,
						workflow_id: resolvedWorkflowId,
						capability_id: resolvedCapabilityId,
						owner: resolvedOwner,
					},
					attributes: {
						pipeline: workflowId,
						status: resolveStatusFromGuardEvent(event),
						event_type: event.kind,
						summary,
						trigger_reason: triggerReason,
						trace_id: traceId,
					},
					body: {
						node_id: trim(event.nodeId),
						message: trim(event.message),
						trace_id: trim(event.traceId),
						data: event.data || {},
					},
				});
				return;
			case "guard.transition":
				emitGovernedOtelEvent({
					event_name: "hatch.reactor.guard_transition",
					severity_text: severityText,
					correlation: {
						factory_id: factoryId,
						run_id: runId,
						workflow_id: resolvedWorkflowId,
						capability_id: resolvedCapabilityId,
						owner: resolvedOwner,
					},
					attributes: {
						pipeline: workflowId,
						status: resolveStatusFromGuardEvent(event),
						event_type: event.kind,
						summary,
						trigger_reason: triggerReason,
						trace_id: traceId,
					},
					body: {
						node_id: trim(event.nodeId),
						message: trim(event.message),
						trace_id: trim(event.traceId),
						data: event.data || {},
					},
				});
				return;
			case "guard.reset":
				emitGovernedOtelEvent({
					event_name: "hatch.reactor.guard_reset",
					severity_text: severityText,
					correlation: {
						factory_id: factoryId,
						run_id: runId,
						workflow_id: resolvedWorkflowId,
						capability_id: resolvedCapabilityId,
						owner: resolvedOwner,
					},
					attributes: {
						pipeline: workflowId,
						status: resolveStatusFromGuardEvent(event),
						event_type: event.kind,
						summary,
						trigger_reason: triggerReason,
						trace_id: traceId,
					},
					body: {
						node_id: trim(event.nodeId),
						message: trim(event.message),
						trace_id: trim(event.traceId),
						data: event.data || {},
					},
				});
				return;
			default:
				return;
		}
	};

	const bind = () => options.eventBus.on((event) => {
		emitReactorOtel(event);
	});

	const emitRunLifecycleEvents = (events: RunLifecycleEvent[]) => {
		for (const event of events || []) {
			const severityText = event.event === "fail" ? "WARN" : "INFO";
			const factoryId = trim(options.resolveFactoryId?.()) || "standalone";
			const runId = trim(event.runId) || trim(options.resolveRunId?.()) || "no_run_id";
			const summary = trim(event.node) || trim(event.graph) || trim(event.mergeStatus) || undefined;
			const triggerReason = event.event === "fail" ? "run_failed" : undefined;
			switch (event.event) {
				case "run-start":
					emitGovernedOtelEvent({
						event_name: "hatch.reactor.run_start",
						severity_text: severityText,
						correlation: {
							factory_id: factoryId,
							run_id: runId,
							workflow_id: workflowId,
							capability_id: capabilityId,
							owner,
						},
						attributes: {
							pipeline: workflowId,
							status: event.event,
							event_type: `reactor.${event.event}`,
							summary,
							trigger_reason: triggerReason,
						},
						body: {
							graph: trim(event.graph),
							node: trim(event.node),
							prev_node: trim(event.prevNode),
							issue: trim(event.issue),
							milestone: trim(event.milestone),
							artifact_url: trim(event.artifactUrl),
							merge_status: trim(event.mergeStatus),
							ts: trim(event.ts),
						},
					});
					break;
				case "complete":
					emitGovernedOtelEvent({
						event_name: "hatch.reactor.complete",
						severity_text: severityText,
						correlation: {
							factory_id: factoryId,
							run_id: runId,
							workflow_id: workflowId,
							capability_id: capabilityId,
							owner,
						},
						attributes: {
							pipeline: workflowId,
							status: event.event,
							event_type: `reactor.${event.event}`,
							summary,
							trigger_reason: triggerReason,
						},
						body: {
							graph: trim(event.graph),
							node: trim(event.node),
							prev_node: trim(event.prevNode),
							issue: trim(event.issue),
							milestone: trim(event.milestone),
							artifact_url: trim(event.artifactUrl),
							merge_status: trim(event.mergeStatus),
							ts: trim(event.ts),
						},
					});
					break;
				case "fail":
					emitGovernedOtelEvent({
						event_name: "hatch.reactor.fail",
						severity_text: severityText,
						correlation: {
							factory_id: factoryId,
							run_id: runId,
							workflow_id: workflowId,
							capability_id: capabilityId,
							owner,
						},
						attributes: {
							pipeline: workflowId,
							status: event.event,
							event_type: `reactor.${event.event}`,
							summary,
							trigger_reason: triggerReason,
						},
						body: {
							graph: trim(event.graph),
							node: trim(event.node),
							prev_node: trim(event.prevNode),
							issue: trim(event.issue),
							milestone: trim(event.milestone),
							artifact_url: trim(event.artifactUrl),
							merge_status: trim(event.mergeStatus),
							ts: trim(event.ts),
						},
					});
					break;
				case "node-change":
					emitGovernedOtelEvent({
						event_name: "hatch.reactor.node_change",
						severity_text: severityText,
						correlation: {
							factory_id: factoryId,
							run_id: runId,
							workflow_id: workflowId,
							capability_id: capabilityId,
							owner,
						},
						attributes: {
							pipeline: workflowId,
							status: event.event,
							event_type: `reactor.${event.event}`,
							summary,
							trigger_reason: triggerReason,
						},
						body: {
							graph: trim(event.graph),
							node: trim(event.node),
							prev_node: trim(event.prevNode),
							issue: trim(event.issue),
							milestone: trim(event.milestone),
							artifact_url: trim(event.artifactUrl),
							merge_status: trim(event.mergeStatus),
							ts: trim(event.ts),
						},
					});
					break;
				case "merge":
					emitGovernedOtelEvent({
						event_name: "hatch.reactor.merge",
						severity_text: severityText,
						correlation: {
							factory_id: factoryId,
							run_id: runId,
							workflow_id: workflowId,
							capability_id: capabilityId,
							owner,
						},
						attributes: {
							pipeline: workflowId,
							status: event.event,
							event_type: `reactor.${event.event}`,
							summary,
							trigger_reason: triggerReason,
						},
						body: {
							graph: trim(event.graph),
							node: trim(event.node),
							prev_node: trim(event.prevNode),
							issue: trim(event.issue),
							milestone: trim(event.milestone),
							artifact_url: trim(event.artifactUrl),
							merge_status: trim(event.mergeStatus),
							ts: trim(event.ts),
						},
					});
					break;
				case "artifact":
					emitGovernedOtelEvent({
						event_name: "hatch.reactor.artifact",
						severity_text: severityText,
						correlation: {
							factory_id: factoryId,
							run_id: runId,
							workflow_id: workflowId,
							capability_id: capabilityId,
							owner,
						},
						attributes: {
							pipeline: workflowId,
							status: event.event,
							event_type: `reactor.${event.event}`,
							summary,
							trigger_reason: triggerReason,
						},
						body: {
							graph: trim(event.graph),
							node: trim(event.node),
							prev_node: trim(event.prevNode),
							issue: trim(event.issue),
							milestone: trim(event.milestone),
							artifact_url: trim(event.artifactUrl),
							merge_status: trim(event.mergeStatus),
							ts: trim(event.ts),
						},
					});
					break;
				default:
					break;
			}
		}
	};

	return {
		bind,
		emitRunLifecycleEvents,
	};
}
