import { type Event } from "@recallnet/factory-telemetry";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkflowInstrumentationHelpers } from "./instrumentation-helpers.js";

function createFakeBus() {
	const events: Event[] = [];
	return {
		events,
		bus: {
			emit(event: Omit<Event, "timestamp"> & { timestamp?: Date }) {
				events.push({
					...event,
					timestamp: event.timestamp ?? new Date(),
				});
			},
		},
	};
}

function parseOtelEnvelope(stderrText: string) {
	const line = stderrText.split(/\r?\n/g).find((entry) => entry.startsWith("OTEL_EVENT "));
	if (!line) return null;
	return JSON.parse(line.slice("OTEL_EVENT ".length));
}

describe("workflow instrumentation helpers", () => {
	afterEach(() => {
		delete process.env.OTEL_MODE;
		vi.restoreAllMocks();
	});

	it("routes workflow events through EventBus and governed otel", () => {
		process.env.OTEL_MODE = "stdout";
		const stderrChunks: string[] = [];
		vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
			stderrChunks.push(String(chunk));
			return true;
		});

		const { bus, events } = createFakeBus();
		const helpers = createWorkflowInstrumentationHelpers({
			eventBus: bus as any,
			workflowId: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
			resolveFactoryId: () => "mothership",
			resolveRunId: () => "run-22",
		});

		helpers.emitWorkflowEvent({
			kind: "pipeline.finish",
			message: "completed",
			data: { status: "completed" },
		});

		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("pipeline.finish");
		expect(events[0].data?.workflow_id).toBe("factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs");
		expect(events[0].data?.capability_id).toBe("factory_mothership");
		expect(events[0].data?.owner).toBe("apps.hatch.workflow");

		const envelope = parseOtelEnvelope(stderrChunks.join(""));
		expect(envelope?.event_name).toBe("hatch.workflow.finish");
		expect(envelope?.attributes?.pipeline).toBe("factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs");
		expect(envelope?.attributes?.status).toBe("completed");
		expect(envelope?.attributes?.event_type).toBe("pipeline.finish");
		expect(envelope?.attributes?.summary).toBe("completed");
		expect(envelope?.attributes?.factory_id).toBe("mothership");
		expect(envelope?.attributes?.run_id).toBe("run-22");
		expect(envelope?.attributes?.workflow_id).toBe("factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs");
		expect(envelope?.attributes?.owner).toBe("apps.hatch.workflow");
	});

	it("routes action events through the helper without emitting workflow otel records", () => {
		process.env.OTEL_MODE = "stdout";
		const stderrChunks: string[] = [];
		vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
			stderrChunks.push(String(chunk));
			return true;
		});

		const { bus, events } = createFakeBus();
		const helpers = createWorkflowInstrumentationHelpers({
			eventBus: bus as any,
			workflowId: "packages/capability-goal-decomposition/workflows/goal_run/goal_run.workflow-source.mjs",
			resolveRunId: () => "run-99",
		});

		helpers.emitActionEvent({
			kind: "stage.start",
			nodeId: "dispatch_plan",
			data: {
				handler_type: "tool",
			},
		});

		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("stage.start");
		expect(events[0].data?.owner).toBe("tool");
		expect(parseOtelEnvelope(stderrChunks.join(""))).toBeNull();
	});
});
