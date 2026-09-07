import {
	EventBus,
	emitGovernedOtelEvent,
	type Event,
} from "@recallnet/factory-telemetry";

const WORKFLOW_OTEL_EVENT_NAMES: Partial<Record<Event["kind"], string>> = {
	"pipeline.start": "hatch.workflow.start",
	"pipeline.finish": "hatch.workflow.finish",
	"pipeline.error": "hatch.workflow.error",
	"pipeline.warning": "hatch.workflow.warning",
	"context.update": "hatch.workflow.context_update",
	"quality.signal": "hatch.workflow.quality_signal",
	"parallel.fan_out": "hatch.workflow.parallel_fan_out",
	"parallel.fan_in": "hatch.workflow.parallel_fan_in",
};

export interface WorkflowInstrumentationOptions {
	eventBus: EventBus;
	workflowId: string;
	resolveRunId?: () => string;
	resolveFactoryId?: () => string;
	capabilityId?: string;
	defaultOwner?: string;
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

function resolveWorkflowStatus(event: Omit<Event, "timestamp"> & { timestamp?: Date }): string {
	if (trim(event.data?.status)) return trim(event.data?.status);
	if (event.kind === "pipeline.start") return "started";
	if (event.kind === "pipeline.finish") return trim(event.message) || "completed";
	if (event.kind === "pipeline.error" || event.kind === "stage.error") return "failed";
	if (event.kind === "pipeline.warning") return "warning";
	if (event.kind === "context.update") return "updated";
	if (event.kind === "quality.signal") return trim(event.data?.outcome) || "signal";
	if (event.kind === "parallel.fan_out") return "fan_out";
	if (event.kind === "parallel.fan_in") return "fan_in";
	return "ok";
}

function resolveSummary(event: Omit<Event, "timestamp"> & { timestamp?: Date }): string {
	return trim(event.message)
		|| trim(event.nodeId)
		|| trim(event.error?.message)
		|| trim(event.data?.summary)
		|| trim(event.data?.node_id)
		|| trim(event.data?.event_kind);
}

function resolveTriggerReason(event: Omit<Event, "timestamp"> & { timestamp?: Date }): string {
	return trim(event.data?.trigger_reason)
		|| trim(event.data?.guard_reason_code)
		|| trim(event.error?.name)
		|| (event.kind === "pipeline.error" ? "pipeline_error" : "");
}

function resolveActionOwner(
	event: Omit<Event, "timestamp"> & { timestamp?: Date },
	defaultOwner: string,
): string {
	return trim(event.data?.owner)
		|| trim(event.data?.action_id)
		|| trim(event.data?.handler_type)
		|| trim(event.nodeId)
		|| defaultOwner;
}

export function createWorkflowInstrumentationHelpers(options: WorkflowInstrumentationOptions) {
	const workflowId = trim(options.workflowId) || "workflow";
	const capabilityId = resolveCapabilityId(workflowId, options.capabilityId);
	const workflowOwner = trim(options.defaultOwner) || "apps.hatch.workflow";

	const emitToBus = (event: Omit<Event, "timestamp"> & { timestamp?: Date }) => {
		options.eventBus.emit(event);
	};

	const emitWorkflowOtel = (event: Omit<Event, "timestamp"> & { timestamp?: Date }, ownerOverride = "") => {
		if (!WORKFLOW_OTEL_EVENT_NAMES[event.kind]) return;
		const summary = resolveSummary(event);
		const triggerReason = resolveTriggerReason(event);
		const severity_text = event.error ? "ERROR" : event.kind === "pipeline.warning" ? "WARN" : "INFO";
		const body = {
			node_id: trim(event.nodeId),
			trace_id: trim(event.traceId),
			message: trim(event.message),
			error: trim(event.error?.message),
			data: event.data || {},
		};
		switch (event.kind) {
			case "pipeline.start":
				emitGovernedOtelEvent({
					event_name: "hatch.workflow.start",
					severity_text,
					correlation: {
						factory_id: trim(event.data?.factory_id) || trim(options.resolveFactoryId?.()) || "standalone",
						run_id: trim(event.data?.run_id) || trim(options.resolveRunId?.()) || "no_run_id",
						workflow_id: trim(event.data?.workflow_id) || workflowId,
						capability_id: trim(event.data?.capability_id) || capabilityId,
						owner: trim(ownerOverride) || trim(event.data?.owner) || workflowOwner,
					},
					attributes: {
						pipeline: workflowId,
						status: resolveWorkflowStatus(event),
						event_type: event.kind,
						summary: summary || undefined,
						trigger_reason: triggerReason || undefined,
					},
					body,
				});
				return;
			case "pipeline.finish":
				emitGovernedOtelEvent({
					event_name: "hatch.workflow.finish",
					severity_text,
					correlation: {
						factory_id: trim(event.data?.factory_id) || trim(options.resolveFactoryId?.()) || "standalone",
						run_id: trim(event.data?.run_id) || trim(options.resolveRunId?.()) || "no_run_id",
						workflow_id: trim(event.data?.workflow_id) || workflowId,
						capability_id: trim(event.data?.capability_id) || capabilityId,
						owner: trim(ownerOverride) || trim(event.data?.owner) || workflowOwner,
					},
					attributes: {
						pipeline: workflowId,
						status: resolveWorkflowStatus(event),
						event_type: event.kind,
						summary: summary || undefined,
						trigger_reason: triggerReason || undefined,
					},
					body,
				});
				return;
			case "pipeline.error":
				emitGovernedOtelEvent({
					event_name: "hatch.workflow.error",
					severity_text,
					correlation: {
						factory_id: trim(event.data?.factory_id) || trim(options.resolveFactoryId?.()) || "standalone",
						run_id: trim(event.data?.run_id) || trim(options.resolveRunId?.()) || "no_run_id",
						workflow_id: trim(event.data?.workflow_id) || workflowId,
						capability_id: trim(event.data?.capability_id) || capabilityId,
						owner: trim(ownerOverride) || trim(event.data?.owner) || workflowOwner,
					},
					attributes: {
						pipeline: workflowId,
						status: resolveWorkflowStatus(event),
						event_type: event.kind,
						summary: summary || undefined,
						trigger_reason: triggerReason || undefined,
					},
					body,
				});
				return;
			case "pipeline.warning":
				emitGovernedOtelEvent({
					event_name: "hatch.workflow.warning",
					severity_text,
					correlation: {
						factory_id: trim(event.data?.factory_id) || trim(options.resolveFactoryId?.()) || "standalone",
						run_id: trim(event.data?.run_id) || trim(options.resolveRunId?.()) || "no_run_id",
						workflow_id: trim(event.data?.workflow_id) || workflowId,
						capability_id: trim(event.data?.capability_id) || capabilityId,
						owner: trim(ownerOverride) || trim(event.data?.owner) || workflowOwner,
					},
					attributes: {
						pipeline: workflowId,
						status: resolveWorkflowStatus(event),
						event_type: event.kind,
						summary: summary || undefined,
						trigger_reason: triggerReason || undefined,
					},
					body,
				});
				return;
			case "context.update":
				emitGovernedOtelEvent({
					event_name: "hatch.workflow.context_update",
					severity_text,
					correlation: {
						factory_id: trim(event.data?.factory_id) || trim(options.resolveFactoryId?.()) || "standalone",
						run_id: trim(event.data?.run_id) || trim(options.resolveRunId?.()) || "no_run_id",
						workflow_id: trim(event.data?.workflow_id) || workflowId,
						capability_id: trim(event.data?.capability_id) || capabilityId,
						owner: trim(ownerOverride) || trim(event.data?.owner) || workflowOwner,
					},
					attributes: {
						pipeline: workflowId,
						status: resolveWorkflowStatus(event),
						event_type: event.kind,
						summary: summary || undefined,
						trigger_reason: triggerReason || undefined,
					},
					body,
				});
				return;
			case "quality.signal":
				emitGovernedOtelEvent({
					event_name: "hatch.workflow.quality_signal",
					severity_text,
					correlation: {
						factory_id: trim(event.data?.factory_id) || trim(options.resolveFactoryId?.()) || "standalone",
						run_id: trim(event.data?.run_id) || trim(options.resolveRunId?.()) || "no_run_id",
						workflow_id: trim(event.data?.workflow_id) || workflowId,
						capability_id: trim(event.data?.capability_id) || capabilityId,
						owner: trim(ownerOverride) || trim(event.data?.owner) || workflowOwner,
					},
					attributes: {
						pipeline: workflowId,
						status: resolveWorkflowStatus(event),
						event_type: event.kind,
						summary: summary || undefined,
						trigger_reason: triggerReason || undefined,
					},
					body,
				});
				return;
			case "parallel.fan_out":
				emitGovernedOtelEvent({
					event_name: "hatch.workflow.parallel_fan_out",
					severity_text,
					correlation: {
						factory_id: trim(event.data?.factory_id) || trim(options.resolveFactoryId?.()) || "standalone",
						run_id: trim(event.data?.run_id) || trim(options.resolveRunId?.()) || "no_run_id",
						workflow_id: trim(event.data?.workflow_id) || workflowId,
						capability_id: trim(event.data?.capability_id) || capabilityId,
						owner: trim(ownerOverride) || trim(event.data?.owner) || workflowOwner,
					},
					attributes: {
						pipeline: workflowId,
						status: resolveWorkflowStatus(event),
						event_type: event.kind,
						summary: summary || undefined,
						trigger_reason: triggerReason || undefined,
					},
					body,
				});
				return;
			case "parallel.fan_in":
				emitGovernedOtelEvent({
					event_name: "hatch.workflow.parallel_fan_in",
					severity_text,
					correlation: {
						factory_id: trim(event.data?.factory_id) || trim(options.resolveFactoryId?.()) || "standalone",
						run_id: trim(event.data?.run_id) || trim(options.resolveRunId?.()) || "no_run_id",
						workflow_id: trim(event.data?.workflow_id) || workflowId,
						capability_id: trim(event.data?.capability_id) || capabilityId,
						owner: trim(ownerOverride) || trim(event.data?.owner) || workflowOwner,
					},
					attributes: {
						pipeline: workflowId,
						status: resolveWorkflowStatus(event),
						event_type: event.kind,
						summary: summary || undefined,
						trigger_reason: triggerReason || undefined,
					},
					body,
				});
				return;
			default:
				return;
		}
	};

	return {
		emitActionEvent(
			event: Omit<Event, "timestamp"> & { timestamp?: Date },
			optionsOverride: { owner?: string } = {},
		): void {
			emitToBus({
				...event,
				data: {
					...(event.data || {}),
					owner: resolveActionOwner(event, trim(optionsOverride.owner) || workflowOwner),
				},
			});
		},
		emitWorkflowEvent(
			event: Omit<Event, "timestamp"> & { timestamp?: Date },
			optionsOverride: { owner?: string } = {},
		): void {
			const normalizedEvent = {
				...event,
				data: {
					...(event.data || {}),
					workflow_id: trim(event.data?.workflow_id) || workflowId,
					capability_id: trim(event.data?.capability_id) || capabilityId,
					owner: trim(optionsOverride.owner) || trim(event.data?.owner) || workflowOwner,
				},
			};
			emitToBus(normalizedEvent);
			emitWorkflowOtel(normalizedEvent, optionsOverride.owner);
		},
	};
}
