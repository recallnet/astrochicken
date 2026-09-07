import { describe, expect, it } from "vitest";

import {
	createLangfuseSpanHandler,
	mapEventToLangfuseSpan,
	getLangfuseSpanFilterMetrics,
	resetLangfuseSpanFilterMetrics,
	type LangfuseSpanRecord,
} from "./langfuse.js";

import type { Event } from "./events.js";

describe("langfuse span mapping trust partition wall", () => {
	it("maps lifecycle events into partitioned spans with trust metadata", () => {
		const event: Event = {
			kind: "stage.start",
			timestamp: new Date("2026-03-06T12:00:00.000Z"),
			nodeId: "judge",
			traceId: "judge-000010",
			data: {
				attempt: "2",
				trust_partition: "judge",
				trust_domain: "judge",
				trust_role: "mothership.local.judge",
				trust_partition_key: "judge/mothership.local.judge",
				path_taken: "full",
				"hatch.execution.path": "full",
				"hatch.merge.resolver": "llm",
				agent_id: "tool.shell",
				agent_role: "tool.operator",
				builder_secret: "do-not-leak",
			},
		};

		const span = mapEventToLangfuseSpan(event);
		expect(span).not.toBeNull();
		expect(span?.traceId).toBe("judge-000010");
		expect(span?.eventKind).toBe("stage.start");
		expect(span?.metadata.trust_partition).toBe("judge");
		expect(span?.metadata.trust_domain).toBe("judge");
		expect(span?.metadata.trust_role).toBe("mothership.local.judge");
		expect(span?.metadata.trust_partition_key).toBe("judge/mothership.local.judge");
		expect(span?.metadata.path_taken).toBe("full");
		expect(span?.metadata["hatch.execution.path"]).toBe("full");
		expect(span?.metadata["hatch.merge.resolver"]).toBe("llm");
		expect(span?.metadata.quality_skill).toBe("unknown");
		expect(span?.metadata.quality_model).toBe("unknown");
		expect(span?.metadata.builder_secret).toBeUndefined();
	});

	it("maps stage langfuse session metadata to hatch.* span metadata", () => {
		const builderStage: Event = {
			kind: "stage.finish",
			timestamp: new Date("2026-03-06T12:00:00.500Z"),
			nodeId: "builder_stage",
			traceId: "builder-000200",
			data: {
				attempt: "3",
				langfuse_session_id: "builder-session-1",
				langfuse_skill_id: "goal.supervisor",
				langfuse_prompt_hash: "sha256:builder",
				langfuse_attempt_index: "3",
				llm_path_id: "mothership.supervisor.review",
				"hatch.llm_path_id": "mothership.supervisor.review",
				job_id: "wave.execute.issue.lifecycle",
				prompt_version: "2026-03-09.r1",
				role_version: "1.4.0",
				trust_partition: "builder",
				trust_role: "mothership.local.tool",
			},
		};
		const judgeStage: Event = {
			...builderStage,
			nodeId: "judge_stage",
			traceId: "judge-000201",
			data: {
				...builderStage.data,
				langfuse_session_id: "judge-session-1",
				langfuse_skill_id: "goal.reviewer",
				langfuse_prompt_hash: "sha256:judge",
				llm_path_id: "mothership.supervisor.review_bug_fast",
				"hatch.llm_path_id": "mothership.supervisor.review_bug_fast",
				trust_partition: "judge",
				trust_role: "mothership.local.judge",
			},
		};

		const builderSpan = mapEventToLangfuseSpan(builderStage);
		const judgeSpan = mapEventToLangfuseSpan(judgeStage);
		expect(builderSpan).not.toBeNull();
		expect(judgeSpan).not.toBeNull();
		expect(builderSpan?.metadata["hatch.session_id"]).toBe("builder-session-1");
		expect(builderSpan?.metadata["hatch.skill_id"]).toBe("goal.supervisor");
		expect(builderSpan?.metadata["hatch.job_id"]).toBe("wave.execute.issue.lifecycle");
		expect(builderSpan?.metadata["hatch.prompt_version"]).toBe("2026-03-09.r1");
		expect(builderSpan?.metadata["hatch.role_version"]).toBe("1.4.0");
		expect(builderSpan?.metadata["hatch.prompt_hash"]).toBe("sha256:builder");
		expect(builderSpan?.metadata["hatch.llm_path_id"]).toBe("mothership.supervisor.review");
		expect(builderSpan?.metadata["hatch.attempt"]).toBe("3");
		expect(builderSpan?.metadata.job_id).toBe("wave.execute.issue.lifecycle");
		expect(builderSpan?.metadata.prompt_version).toBe("2026-03-09.r1");
		expect(builderSpan?.metadata.role_version).toBe("1.4.0");
		expect(judgeSpan?.metadata["hatch.session_id"]).toBe("judge-session-1");
		expect(judgeSpan?.metadata["hatch.skill_id"]).toBe("goal.reviewer");
		expect(judgeSpan?.metadata["hatch.job_id"]).toBe("wave.execute.issue.lifecycle");
		expect(judgeSpan?.metadata["hatch.prompt_version"]).toBe("2026-03-09.r1");
		expect(judgeSpan?.metadata["hatch.role_version"]).toBe("1.4.0");
		expect(judgeSpan?.metadata["hatch.prompt_hash"]).toBe("sha256:judge");
		expect(judgeSpan?.metadata["hatch.llm_path_id"]).toBe("mothership.supervisor.review_bug_fast");
		expect(judgeSpan?.metadata["hatch.attempt"]).toBe("3");
		expect(judgeSpan?.metadata.job_id).toBe("wave.execute.issue.lifecycle");
		expect(judgeSpan?.metadata.prompt_version).toBe("2026-03-09.r1");
		expect(judgeSpan?.metadata.role_version).toBe("1.4.0");
		expect(builderSpan?.traceId.startsWith("builder-")).toBe(true);
		expect(judgeSpan?.traceId.startsWith("judge-")).toBe(true);
	});

	it("preserves benchmark identity on stage/retry/quality span mapping for benchmarkable llm events", () => {
		const benchmarkData = {
			factory_id: "mothership",
			graph_id: "wave_execute.dot",
			node_id: "worker",
			handler_type: "tool",
			model: "claude-sonnet-4-6",
			provider: "anthropic",
			prompt_hash: "sha256:wave-execute-r1",
			job_id: "wave.execute.issue.lifecycle",
			prompt_version: "2026-03-09.r1",
			role_version: "1.4.0",
			skill_id: "wave.execute.issue",
			"hatch.job_id": "wave.execute.issue.lifecycle",
			"hatch.prompt_version": "2026-03-09.r1",
			"hatch.role_version": "1.4.0",
			"hatch.skill_id": "wave.execute.issue",
			"hatch.prompt_hash": "sha256:wave-execute-r1",
			trust_partition: "builder",
			trust_role: "mothership.local.tool",
		};
		const spans = [
			mapEventToLangfuseSpan({ kind: "stage.finish", timestamp: new Date("2026-03-06T12:00:00.700Z"), nodeId: "worker", traceId: "builder-000220", data: benchmarkData }),
			mapEventToLangfuseSpan({ kind: "stage.retry", timestamp: new Date("2026-03-06T12:00:00.710Z"), nodeId: "worker", traceId: "builder-000220", data: benchmarkData }),
			mapEventToLangfuseSpan({ kind: "quality.signal", timestamp: new Date("2026-03-06T12:00:00.720Z"), nodeId: "worker", traceId: "builder-000220", data: benchmarkData }),
		];
		expect(spans.every(Boolean)).toBe(true);
		for (const span of spans) {
			expect(span?.metadata.factory_id).toBe("mothership");
			expect(span?.metadata.graph_id).toBe("wave_execute.dot");
			expect(span?.metadata.node_id).toBe("worker");
			expect(span?.metadata.handler_type).toBe("tool");
			expect(span?.metadata.model).toBe("claude-sonnet-4-6");
			expect(span?.metadata.provider).toBe("anthropic");
			expect(span?.metadata.prompt_hash).toBe("sha256:wave-execute-r1");
			expect(span?.metadata.job_id).toBe("wave.execute.issue.lifecycle");
			expect(span?.metadata.prompt_version).toBe("2026-03-09.r1");
			expect(span?.metadata.role_version).toBe("1.4.0");
			expect(span?.metadata.skill_id).toBe("wave.execute.issue");
			expect(span?.metadata["hatch.job_id"]).toBe("wave.execute.issue.lifecycle");
			expect(span?.metadata["hatch.prompt_version"]).toBe("2026-03-09.r1");
			expect(span?.metadata["hatch.role_version"]).toBe("1.4.0");
			expect(span?.metadata["hatch.skill_id"]).toBe("wave.execute.issue");
			expect(span?.metadata["hatch.prompt_hash"]).toBe("sha256:wave-execute-r1");
		}
	});

	it("keeps builder/judge spans partitioned even when session ids are reused across nodes", () => {
		const sharedSessionId = "run:shared:handler:codergen:node:reuse:attempt:1";
		const builder = mapEventToLangfuseSpan({
			kind: "stage.start",
			timestamp: new Date("2026-03-06T12:00:00.550Z"),
			nodeId: "reuse_builder",
			traceId: "builder-000202",
			data: {
				langfuse_session_id: sharedSessionId,
				langfuse_skill_id: "skill.builder",
				langfuse_prompt_hash: "sha256:same",
				langfuse_attempt_index: "1",
				trust_partition: "builder",
				trust_role: "mothership.local.tool",
			},
		});
		const judge = mapEventToLangfuseSpan({
			kind: "stage.start",
			timestamp: new Date("2026-03-06T12:00:00.560Z"),
			nodeId: "reuse_judge",
			traceId: "judge-000203",
			data: {
				langfuse_session_id: sharedSessionId,
				langfuse_skill_id: "skill.judge",
				langfuse_prompt_hash: "sha256:same",
				langfuse_attempt_index: "1",
				trust_partition: "judge",
				trust_role: "mothership.local.judge",
				mock_builder_context: "must-not-leak",
			},
		});

		expect(builder).not.toBeNull();
		expect(judge).not.toBeNull();
		expect(builder?.metadata["hatch.session_id"]).toBe(sharedSessionId);
		expect(judge?.metadata["hatch.session_id"]).toBe(sharedSessionId);
		expect(builder?.metadata.trust_partition).toBe("builder");
		expect(judge?.metadata.trust_partition).toBe("judge");
		expect(builder?.traceId).not.toBe(judge?.traceId);
		expect(judge?.metadata.mock_builder_context).toBeUndefined();
	});

	it("captures execution-path metadata on context.update and edge.selected lifecycle events", () => {
		const contextEvent: Event = {
			kind: "context.update",
			timestamp: new Date("2026-03-06T12:00:00.000Z"),
			nodeId: "route",
			traceId: "builder-000011",
			data: {
				path_taken: "fast",
				"hatch.execution.path": "fast",
				"hatch.merge.resolver": "deterministic",
			},
		};
		const edgeEvent: Event = {
			kind: "edge.selected",
			timestamp: new Date("2026-03-06T12:00:01.000Z"),
			edgeFrom: "route",
			edgeTo: "fast_path",
			traceId: "builder-000011",
			data: {
				path_taken: "fast",
				"hatch.execution.path": "fast",
			},
		};

		const contextSpan = mapEventToLangfuseSpan(contextEvent);
		expect(contextSpan?.eventKind).toBe("context.update");
		expect(contextSpan?.metadata.path_taken).toBe("fast");
		expect(contextSpan?.metadata["hatch.execution.path"]).toBe("fast");
		expect(contextSpan?.metadata["hatch.merge.resolver"]).toBe("deterministic");

		const edgeSpan = mapEventToLangfuseSpan(edgeEvent);
		expect(edgeSpan?.eventKind).toBe("edge.selected");
		expect(edgeSpan?.metadata.path_taken).toBe("fast");
		expect(edgeSpan?.metadata["hatch.execution.path"]).toBe("fast");
	});

	it("maps parallel fan-out/fan-in spans with deterministic trace linkage + metadata propagation", () => {
		const fanOut: Event = {
			kind: "parallel.fan_out",
			timestamp: new Date("2026-03-06T12:00:01.500Z"),
			nodeId: "fan_dynamic",
			traceId: "builder-parallel-fan_dynamic",
			data: {
				node_id: "fan_dynamic",
				session_id: "run:1:handler:fan_out.dynamic:node:fan_dynamic:attempt:1",
				graph: "wave_execute",
				run_id: "run-1",
				attempt: "1",
				trust_partition: "builder",
				trust_role: "mothership.local.tool",
				edge: "route->fan_dynamic",
				path_taken: "full",
				fan_out_count: "3",
				max_concurrency: "2",
				child_handler_type: "pipeline",
				handler_type: "parallel.fan_out",
				mock_judge_context: "ignored",
			},
		};
		const fanIn: Event = {
			kind: "parallel.fan_in",
			timestamp: new Date("2026-03-06T12:00:01.900Z"),
			nodeId: "fan_dynamic",
			data: {
				node_id: "fan_dynamic",
				session_id: "run:1:handler:fan_out.dynamic:node:fan_dynamic:attempt:1",
				graph: "wave_execute",
				run_id: "run-1",
				attempt: "1",
				trust_partition: "builder",
				trust_role: "mothership.local.tool",
				edge: "route->fan_dynamic",
				path_taken: "full",
				item_count: "3",
				failed_items: "1",
				child_count: "3",
				handler_type: "parallel.fan_in",
			},
		};

		const fanOutSpan = mapEventToLangfuseSpan(fanOut);
		const fanInSpan = mapEventToLangfuseSpan(fanIn);
		expect(fanOutSpan).not.toBeNull();
		expect(fanInSpan).not.toBeNull();

		expect(fanOutSpan?.traceId).toBe("builder-parallel-fan_dynamic");
		expect(fanInSpan?.traceId).toBe("builder-parallel-fan_dynamic");
		expect(fanOutSpan?.spanId).toBe("builder-parallel-fan_dynamic");
		expect(fanInSpan?.spanId).toBe("builder-parallel-fan_dynamic");
		expect(fanOutSpan?.metadata.span_type).toBe("parallel");
		expect(fanInSpan?.metadata.span_type).toBe("parallel");
		expect(fanOutSpan?.metadata.parallel_phase).toBe("fan_out");
		expect(fanInSpan?.metadata.parallel_phase).toBe("fan_in");
		expect(fanOutSpan?.metadata.node_id).toBe("fan_dynamic");
		expect(fanOutSpan?.metadata.session_id).toContain("fan_out.dynamic");
		expect(fanOutSpan?.metadata.fan_out_count).toBe("3");
		expect(fanOutSpan?.metadata.max_concurrency).toBe("2");
		expect(fanInSpan?.metadata.child_count).toBe("3");
		expect(fanInSpan?.metadata.failed_items).toBe("1");
		expect(fanOutSpan?.metadata.edge).toBe("route->fan_dynamic");
		expect(fanInSpan?.metadata.path_taken).toBe("full");
		expect(fanOutSpan?.metadata.trust_partition).toBe("builder");
		expect(fanInSpan?.metadata.trust_partition).toBe("builder");
		expect(fanOutSpan?.metadata.mock_judge_context).toBeUndefined();
	});

	it("keeps parallel trust partitions isolated even when builder and judge contexts coexist", () => {
		const builderFanOut = mapEventToLangfuseSpan({
			kind: "parallel.fan_out",
			timestamp: new Date("2026-03-06T12:00:02.200Z"),
			nodeId: "fan_build",
			data: {
				attempt: "1",
				trust_partition: "builder",
				trust_role: "mothership.local.tool",
				fan_out_count: "2",
				max_concurrency: "2",
				handler_type: "parallel.fan_out",
				mock_judge_context: "present-but-sandboxed",
			},
		});
		const judgeFanIn = mapEventToLangfuseSpan({
			kind: "parallel.fan_in",
			timestamp: new Date("2026-03-06T12:00:02.300Z"),
			nodeId: "fan_judge",
			data: {
				attempt: "1",
				trust_partition: "judge",
				trust_role: "mothership.local.judge",
				item_count: "2",
				child_count: "2",
				failed_items: "0",
				handler_type: "parallel.fan_in",
			},
		});

		expect(builderFanOut).not.toBeNull();
		expect(judgeFanIn).not.toBeNull();
		expect(builderFanOut?.traceId.startsWith("builder-")).toBe(true);
		expect(judgeFanIn?.traceId.startsWith("judge-")).toBe(true);
		expect(builderFanOut?.metadata.trust_partition).toBe("builder");
		expect(judgeFanIn?.metadata.trust_partition).toBe("judge");
		expect(builderFanOut?.traceId).not.toBe(judgeFanIn?.traceId);
		expect(builderFanOut?.metadata.mock_judge_context).toBeUndefined();
	});

	it("fails closed to builder partition when trust metadata is malformed", () => {
		const event: Event = {
			kind: "stage.retry",
			timestamp: new Date("2026-03-06T12:00:01.000Z"),
			nodeId: "retry_node",
			traceId: "oops",
			data: {
				attempt: "2",
				trust_partition: "",
			},
		};

		const span = mapEventToLangfuseSpan(event);
		expect(span).not.toBeNull();
		expect(span?.traceId).toBe("oops");
		expect(span?.metadata.trust_partition).toBe("builder");
		expect(span?.metadata.trust_domain).toBe("builder");
		expect(span?.metadata.trust_role).toBe("unknown");
		expect(span?.metadata.trust_partition_key).toBe("builder/unknown");
		expect(span?.metadata.quality_skill).toBe("unknown");
		expect(span?.metadata.quality_model).toBe("unknown");
	});

	it("drops partition-violating spans and records drop metrics", () => {
		resetLangfuseSpanFilterMetrics();
		const event: Event = {
			kind: "guard.decision",
			timestamp: new Date("2026-03-06T12:00:02.000Z"),
			nodeId: "guard",
			traceId: "builder-009999",
			data: {
				trust_partition: "builder",
				trust_role: "mothership.local.judge",
				gate_name: "guard.llm_calls",
				gate_outcome: "fail",
				gate_evidence_ref: "sha256:abc",
			},
		};

		const span = mapEventToLangfuseSpan(event);
		expect(span).toBeNull();
		const metrics = getLangfuseSpanFilterMetrics();
		expect(metrics.langfuse_span_dropped_partition).toBe(1);
	});

	it("maps guard gate events as span_type=gate with sanitized metadata", () => {
		const event: Event = {
			kind: "guard.transition",
			timestamp: new Date("2026-03-06T12:00:03.000Z"),
			nodeId: "build",
			traceId: "builder-000123",
			data: {
				trust_partition: "builder",
				trust_domain: "builder",
				trust_role: "mothership.local.tool",
				gate_name: "guard.llm_calls",
				gate_outcome: "fail",
				gate_evidence_ref: "sha256:gate-evidence",
				reason_code: "run_llm_budget_exceeded",
				circuit_state: "open",
				artifact_path: "/tmp/runs/1/guard/a.json",
				judge_secret: "must-not-pass",
			},
		};

		const span = mapEventToLangfuseSpan(event);
		expect(span).not.toBeNull();
		expect(span?.metadata.span_type).toBe("gate");
		expect(span?.metadata.gate_name).toBe("guard.llm_calls");
		expect(span?.metadata.gate_outcome).toBe("fail");
		expect(span?.metadata.gate_evidence_ref).toBe("sha256:gate-evidence");
		expect(span?.metadata.artifact_path).toBe("/tmp/runs/1/guard/a.json");
		expect(span?.metadata.judge_secret).toBeUndefined();
	});

	it("keeps deterministic guard trace/span ids with evidence metadata and partition isolation", () => {
		const builderEvent: Event = {
			kind: "guard.decision",
			timestamp: new Date("2026-03-06T12:00:03.050Z"),
			nodeId: "budget_gate",
			edgeFrom: "retry_gate",
			edgeTo: "build",
			traceId: "builder-guard-abc123",
			data: {
				trust_partition: "builder",
				trust_role: "mothership.local.tool",
				artifact_path: "/tmp/runs/42/guard/decision.json",
				reason_code: "run_tool_budget_exceeded",
				scope: "run",
				policy_revision: "guard.test.v1",
				factory_scope: "mothership-factory",
				worker_period: "period-1",
				guard_circuit_state: "open",
				gate_name: "guard.tool_calls",
				gate_outcome: "fail",
				gate_evidence_ref: "sha256:deterministic-evidence",
			},
		};
		const judgeEvent: Event = {
			...builderEvent,
			traceId: "judge-guard-def456",
			data: {
				...builderEvent.data,
				trust_partition: "judge",
				trust_role: "mothership.local.judge",
			},
		};

		const builderSpan = mapEventToLangfuseSpan(builderEvent);
		const judgeSpan = mapEventToLangfuseSpan(judgeEvent);
		expect(builderSpan).not.toBeNull();
		expect(judgeSpan).not.toBeNull();

		expect(builderSpan?.traceId).toBe("builder-guard-abc123");
		expect(builderSpan?.spanId).toBe("builder-guard-abc123");
		expect(builderSpan?.metadata.artifact_path).toBe("/tmp/runs/42/guard/decision.json");
		expect(builderSpan?.metadata.reason_code).toBe("run_tool_budget_exceeded");
		expect(builderSpan?.metadata.scope).toBe("run");
		expect(builderSpan?.metadata.guard_circuit_state).toBe("open");
		expect(builderSpan?.metadata.edge_from).toBe("retry_gate");
		expect(builderSpan?.metadata.edge_to).toBe("build");
		expect(builderSpan?.metadata.trust_partition).toBe("builder");

		expect(judgeSpan?.traceId).toBe("judge-guard-def456");
		expect(judgeSpan?.spanId).toBe("judge-guard-def456");
		expect(judgeSpan?.metadata.trust_partition).toBe("judge");
		expect(judgeSpan?.traceId.startsWith("builder-")).toBe(false);
		expect(builderSpan?.traceId).not.toBe(judgeSpan?.traceId);
	});

	it("filters builder/judge gate metadata through handler and only emits sanitized spans", () => {
		resetLangfuseSpanFilterMetrics();
		const spans: LangfuseSpanRecord[] = [];
		const handler = createLangfuseSpanHandler((span) => spans.push(span));

		handler({
			kind: "guard.decision",
			timestamp: new Date("2026-03-06T12:00:03.100Z"),
			nodeId: "guard_ok",
			traceId: "builder-000125",
			data: {
				trust_partition: "builder",
				trust_role: "mothership.local.tool",
				gate_name: "guard.tool_calls",
				gate_outcome: "fail",
				gate_evidence_ref: "sha256:evidence-ok",
				judge_secret: "not-allowed",
			},
		});
		handler({
			kind: "guard.decision",
			timestamp: new Date("2026-03-06T12:00:03.200Z"),
			nodeId: "guard_drop",
			traceId: "builder-000126",
			data: {
				trust_partition: "builder",
				trust_role: "mothership.local.judge",
				gate_name: "guard.tool_calls",
				gate_outcome: "fail",
				gate_evidence_ref: "sha256:evidence-drop",
			},
		});

		expect(spans).toHaveLength(1);
		expect(spans[0].metadata.span_type).toBe("gate");
		expect(spans[0].metadata.gate_name).toBe("guard.tool_calls");
		expect(spans[0].metadata.gate_evidence_ref).toBe("sha256:evidence-ok");
		expect(spans[0].metadata.judge_secret).toBeUndefined();
		const metrics = getLangfuseSpanFilterMetrics();
		expect(metrics.langfuse_span_dropped_partition).toBe(1);
	});

	it("keeps telemetry fail-safe when span sink throws", () => {
		resetLangfuseSpanFilterMetrics();
		const handler = createLangfuseSpanHandler(() => {
			throw new Error("sink-failure");
		});
		const event: Event = {
			kind: "guard.decision",
			timestamp: new Date("2026-03-06T12:00:04.000Z"),
			nodeId: "guard",
			traceId: "builder-000124",
			data: {
				trust_partition: "builder",
				trust_role: "mothership.local.tool",
				gate_name: "guard.tool_calls",
				gate_outcome: "pass",
				gate_evidence_ref: "sha256:ok",
			},
		};
		expect(() => handler(event)).not.toThrow();
		const metrics = getLangfuseSpanFilterMetrics();
		expect(metrics.langfuse_span_filter_errors).toBeGreaterThanOrEqual(1);
	});

});
