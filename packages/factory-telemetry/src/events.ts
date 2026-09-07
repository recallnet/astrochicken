export interface IntentMetadataLike {
	handlerType: string;
	kind: string;
	digest: string;
	intentRef?: string;
	intentProfile?: string;
	intentPatches?: string[];
	data?: unknown;
}

export const STAGE_FINISH_COMPLEXITY_CLASS_KEY = "complexity_class";
export const STAGE_FINISH_COMPLEXITY_SIGNALS_KEY = "complexity_signals";
export const STAGE_FINISH_COMPLEXITY_REASON_KEY = "complexity_reason";
export const STAGE_FINISH_COMPLEXITY_OTEL_KEY = "complexity_otel_key";
export const STAGE_FINISH_EXECUTION_PATH_KEY = "hatch.execution.path";
export const STAGE_FINISH_PATH_TAKEN_KEY = "path_taken";
export const STAGE_FINISH_MERGE_RESOLVER_KEY = "hatch.merge.resolver";

export interface StageFinishComplexityData {
	[STAGE_FINISH_COMPLEXITY_CLASS_KEY]: string;
	[STAGE_FINISH_COMPLEXITY_SIGNALS_KEY]: string;
	[STAGE_FINISH_COMPLEXITY_REASON_KEY]: string;
	[STAGE_FINISH_COMPLEXITY_OTEL_KEY]: string;
	[key: string]: string;
}

export type EventData = Record<string, string>;

/**
 * Dynamic fan-out metadata contract.
 * Counts remain metadata for observability; low-cardinality dimensions are
 * represented by trust/handler fields.
 */
export type ParallelFanOutEventData = EventData & {
	node_id: string;
	session_id?: string;
	graph?: string;
	run_id?: string;
	attempt: string;
	trust_partition: "builder" | "judge";
	edge?: string;
	path_taken?: string;
	fan_out_count: string;
	max_concurrency: string;
	child_handler_type?: string;
	handler_type?: string;
};

/** Dynamic fan-in metadata contract. */
export type ParallelFanInEventData = EventData & {
	node_id: string;
	session_id?: string;
	edge?: string;
	path_taken?: string;
	graph?: string;
	run_id?: string;
	attempt: string;
	trust_partition: "builder" | "judge";
	item_count: string;
	failed_items: string;
	child_count: string;
	handler_type?: string;
};

/** EventKind identifies the type of pipeline event. */
export type EventKind =
	| "pipeline.start"
	| "pipeline.finish"
	| "pipeline.error"
	| "pipeline.warning"
	| "pipeline.heartbeat"
	| "pipeline.suspend"
	| "stage.start"
	| "stage.finish"
	| "stage.error"
	| "stage.retry"
	| "stage.skip"
	| "quality.signal"
	| "edge.selected"
	| "fast-route.branch"
	| "context.update"
	| "checkpoint.saved"
	| "guard.decision"
	| "guard.transition"
	| "guard.reset"
	| "goal_gate.check"
	| "goal_gate.pass"
	| "goal_gate.fail"
	| "parallel.fan_out"
	| "parallel.fan_in"
	| "human.wait"
	| "human.response"
	| "telemetry.langfuse.generation"
	| "telemetry.langfuse.session"
	| "telemetry.langfuse.flush"
	| "telemetry.langfuse.retry"
	| "telemetry.langfuse.transport";

/** Event represents a pipeline execution event. */
export interface Event {
	kind: EventKind;
	timestamp: Date;
	nodeId?: string;
	edgeFrom?: string;
	edgeTo?: string;
	message?: string;
	data?: EventData;
	error?: Error;
	intent?: IntentMetadataLike;
	traceId?: string;
}

/** EventHandler receives pipeline events. */
export type EventHandler = (event: Event) => void;

/** EventBus distributes events to registered handlers. */
export class EventBus {
	private handlers = new Set<EventHandler>();

	on(handler: EventHandler): () => void {
		this.handlers.add(handler);
		return () => {
			this.off(handler);
		};
	}

	off(handler: EventHandler): void {
		this.handlers.delete(handler);
	}

	emit(event: Omit<Event, "timestamp"> & { timestamp?: Date }): void {
		const full: Event = {
			...event,
			timestamp: event.timestamp ?? new Date(),
		};
		for (const h of this.handlers) {
			h(full);
		}
	}
}
