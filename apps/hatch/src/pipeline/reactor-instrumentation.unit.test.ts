import { afterEach, describe, expect, it } from "vitest";

import { EventBus } from "@recallnet/factory-telemetry";

import { createReactorInstrumentationHelpers } from "./reactor-instrumentation.js";

function readLastOtelEnvelope(stderrText: string) {
	const line = stderrText.split(/\r?\n/g).find((entry) => entry.startsWith("OTEL_EVENT "));
	expect(line).toBeDefined();
	return JSON.parse(String(line).slice("OTEL_EVENT ".length));
}

describe("reactor instrumentation helpers", () => {
	const originalMode = process.env.OTEL_MODE;

	afterEach(() => {
		if (originalMode === undefined) delete process.env.OTEL_MODE;
		else process.env.OTEL_MODE = originalMode;
	});

	it("emits governed otel events for guard decisions with trace correlation", () => {
		process.env.OTEL_MODE = "stdout";
		const bus = new EventBus();
		const stderrChunks: string[] = [];
		const originalWrite = process.stderr.write.bind(process.stderr);
		process.stderr.write = ((chunk: string | Uint8Array) => {
			stderrChunks.push(String(chunk));
			return true;
		}) as typeof process.stderr.write;
		try {
			const helpers = createReactorInstrumentationHelpers({
				eventBus: bus,
				workflowId: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
				resolveRunId: () => "run-123",
				resolveFactoryId: () => "mothership",
			});
			const detach = helpers.bind();
			bus.emit({
				kind: "guard.decision",
				nodeId: "guard.check",
				traceId: "builder-guard-123",
				message: "budget blocked",
				data: {
					reason_code: "guard_backoff_active",
					allowed: "false",
				},
			});
			detach();
		} finally {
			process.stderr.write = originalWrite;
		}
		const envelope = readLastOtelEnvelope(stderrChunks.join(""));
		expect(envelope.event_name).toBe("hatch.reactor.guard_decision");
		expect(envelope.attributes.trace_id).toBe("builder-guard-123");
		expect(envelope.attributes.status).toBe("blocked");
	});

	it("emits run lifecycle events through the reactor helper", () => {
		process.env.OTEL_MODE = "stdout";
		const stderrChunks: string[] = [];
		const originalWrite = process.stderr.write.bind(process.stderr);
		process.stderr.write = ((chunk: string | Uint8Array) => {
			stderrChunks.push(String(chunk));
			return true;
		}) as typeof process.stderr.write;
		try {
			const helpers = createReactorInstrumentationHelpers({
				eventBus: new EventBus(),
				workflowId: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
				resolveRunId: () => "run-123",
				resolveFactoryId: () => "mothership",
			});
			helpers.emitRunLifecycleEvents([{
				schemaVersion: 1,
				ts: "2026-03-20T00:00:00.000Z",
				event: "run-start",
				runId: "run-123",
				graph: "factory_supervisor_tick",
				node: "start",
			}]);
		} finally {
			process.stderr.write = originalWrite;
		}
		const envelope = readLastOtelEnvelope(stderrChunks.join(""));
		expect(envelope.event_name).toBe("hatch.reactor.run_start");
		expect(envelope.attributes.event_type).toBe("reactor.run-start");
		expect(envelope.attributes.pipeline).toBe("factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs");
	});
});
