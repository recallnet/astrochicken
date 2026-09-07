import { createHash } from "node:crypto";

import type { RunLifecycleEvent } from "../pipeline/run-lifecycle.js";

import {
	buildCanonicalEventEnvelope,
	type CanonicalEventEnvelope,
	type CanonicalEventOrigin,
} from "./envelope.js";
import {
	createCanonicalPostgresEventStore,
	type CanonicalEventStore,
} from "./postgres-store.js";

type LifecycleEmitterController = {
	emit(events: RunLifecycleEvent[]): void;
	flush(): Promise<void>;
	close(): Promise<void>;
};

type ProjectedRunLifecycleState = {
	factory_id: string;
	run_id: string;
	status: "running" | "completed" | "failed";
	current_node: string;
	last_event_origin: CanonicalEventOrigin;
};

function trim(value: unknown): string {
	return String(value || "").trim();
}

function stableUuid(input: string): string {
	const hex = createHash("sha256").update(input).digest("hex").slice(0, 32);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function buildPayloadBase(args: {
	runId: string;
	graph: string;
	node: string;
	issue: string;
	milestone: string;
}): Record<string, unknown> {
	return {
		run_id: args.runId,
		graph: args.graph,
		node: args.node,
		issue: args.issue,
		milestone: args.milestone,
	};
}

export function buildCanonicalLifecycleEnvelopesFromRunLifecycleEvents(args: {
	events: RunLifecycleEvent[];
	factoryId: string;
	emitter: string;
	eventOrigin?: CanonicalEventOrigin;
	provenance?: CanonicalEventEnvelope["provenance"];
}): CanonicalEventEnvelope[] {
	const output: CanonicalEventEnvelope[] = [];
	for (const event of args.events) {
		const graph = trim((event as { graph?: string }).graph);
		const issue = trim((event as { issue?: string }).issue);
		const milestone = trim((event as { milestone?: string }).milestone);
		const node = trim((event as { node?: string }).node);
		const prevNode = trim((event as { prevNode?: string }).prevNode);
		const eventOrigin = args.eventOrigin || "runtime";
		const base = {
			factory_id: args.factoryId,
			run_id: trim(event.runId),
			emitter: args.emitter,
			emitted_at: trim(event.ts),
			event_origin: eventOrigin,
			provenance: args.provenance,
		} as const;

		if (event.event === "run-start") {
			output.push(buildCanonicalEventEnvelope({
				event_id: eventOrigin === "backfill" ? stableUuid(`${args.factoryId}:${event.runId}:${event.ts}:started:${args.provenance?.source_ref || ""}`) : undefined,
				event_family: "hatch.run.started",
				event_version: 1,
				factory_id: base.factory_id,
				run_id: base.run_id,
				emitter: base.emitter,
				emitted_at: base.emitted_at,
				event_origin: base.event_origin,
				provenance: base.provenance,
				payload: buildPayloadBase({ runId: event.runId, graph, node, issue, milestone }),
			}));
			continue;
		}

		if (event.event === "node-change") {
			if (prevNode) {
				output.push(buildCanonicalEventEnvelope({
					event_id: eventOrigin === "backfill" ? stableUuid(`${args.factoryId}:${event.runId}:${event.ts}:node_exit:${prevNode}:${args.provenance?.source_ref || ""}`) : undefined,
					event_family: "hatch.run.node_exited",
					event_version: 1,
					factory_id: base.factory_id,
					run_id: base.run_id,
					emitter: base.emitter,
					emitted_at: base.emitted_at,
					event_origin: base.event_origin,
					provenance: base.provenance,
					payload: buildPayloadBase({ runId: event.runId, graph, node: prevNode, issue, milestone }),
				}));
			}
			if (node) {
				output.push(buildCanonicalEventEnvelope({
					event_id: eventOrigin === "backfill" ? stableUuid(`${args.factoryId}:${event.runId}:${event.ts}:node_enter:${node}:${args.provenance?.source_ref || ""}`) : undefined,
					event_family: "hatch.run.node_entered",
					event_version: 1,
					factory_id: base.factory_id,
					run_id: base.run_id,
					emitter: base.emitter,
					emitted_at: base.emitted_at,
					event_origin: base.event_origin,
					provenance: base.provenance,
					payload: buildPayloadBase({ runId: event.runId, graph, node, issue, milestone }),
				}));
			}
			continue;
		}

		if (event.event === "complete") {
			output.push(buildCanonicalEventEnvelope({
				event_id: eventOrigin === "backfill" ? stableUuid(`${args.factoryId}:${event.runId}:${event.ts}:completed:${args.provenance?.source_ref || ""}`) : undefined,
				event_family: "hatch.run.completed",
				event_version: 1,
				factory_id: base.factory_id,
				run_id: base.run_id,
				emitter: base.emitter,
				emitted_at: base.emitted_at,
				event_origin: base.event_origin,
				provenance: base.provenance,
				payload: buildPayloadBase({ runId: event.runId, graph, node, issue, milestone }),
			}));
			continue;
		}

		if (event.event === "fail") {
			output.push(buildCanonicalEventEnvelope({
				event_id: eventOrigin === "backfill" ? stableUuid(`${args.factoryId}:${event.runId}:${event.ts}:failed:${args.provenance?.source_ref || ""}`) : undefined,
				event_family: "hatch.run.failed",
				event_version: 1,
				factory_id: base.factory_id,
				run_id: base.run_id,
				emitter: base.emitter,
				emitted_at: base.emitted_at,
				event_origin: base.event_origin,
				provenance: base.provenance,
				payload: buildPayloadBase({ runId: event.runId, graph, node, issue, milestone }),
			}));
		}
	}
	return output;
}

export function projectCanonicalLifecycleRows(rows: Array<Pick<CanonicalEventEnvelope, "factory_id" | "run_id" | "event_family" | "event_origin" | "payload">>): Record<string, ProjectedRunLifecycleState> {
	const projection: Record<string, ProjectedRunLifecycleState> = {};
	for (const row of rows) {
		const runId = trim(row.run_id);
		if (!runId) continue;
		const current = projection[runId] || {
			factory_id: trim(row.factory_id),
			run_id: runId,
			status: "running" as const,
			current_node: "",
			last_event_origin: row.event_origin,
		};
		if (row.event_family === "hatch.run.node_entered") {
			current.current_node = trim(row.payload?.node);
		} else if (row.event_family === "hatch.run.completed") {
			current.status = "completed";
		} else if (row.event_family === "hatch.run.failed") {
			current.status = "failed";
		}
		current.last_event_origin = row.event_origin;
		projection[runId] = current;
	}
	return projection;
}

export function createCanonicalLifecycleEventEmitter(args: {
	connectionString: string;
	factoryId: string;
	runId: string;
	emitter: string;
	store?: CanonicalEventStore;
	required?: boolean;
}): LifecycleEmitterController {
	const store = args.store || createCanonicalPostgresEventStore({ connectionString: args.connectionString });
	let chain: Promise<void> = Promise.resolve();
	let ensured = false;
	let disabled = false;

	return {
		emit(events) {
			if (disabled) {
				return;
			}
			const envelopes = buildCanonicalLifecycleEnvelopesFromRunLifecycleEvents({
				events,
				factoryId: args.factoryId,
				emitter: args.emitter,
			});
			if (envelopes.length === 0) {
				return;
			}
			chain = chain
				.then(async () => {
					if (!ensured) {
						await store.ensureSchema();
						ensured = true;
					}
					await store.append(envelopes);
				})
				.catch((error) => {
					// @context:regression !critical Optional canonical lifecycle writes
					// must never abort a factory tick. The runtime guard already owns the
					// explicit fail-closed path via HATCH_CANONICAL_EVENT_STORE_REQUIRED.
					if (args.required) {
						throw error;
					}
					disabled = true;
				});
		},
		async flush() {
			await chain;
		},
		async close() {
			await chain;
			if (!args.store) {
				await store.close();
			}
		},
	};
}
