import { resolveLangfuseTraceId } from "@recallnet/factory-telemetry";
import { describe, expect, it } from "vitest";

import { Context } from "../context.js";
import { buildOpenRouterTraceOptions, mergeOpenRouterTraceOptions } from "./openrouter-trace.js";

const WAVE_EXECUTE_PIPELINE_FILE = "factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs";

describe("openrouter trace metadata helper", () => {
	it("builds langfuse-compatible trace metadata + headers with factory context", () => {
		const ctx = new Context({
			__run_id: "run-1295",
			__parent_run_id: "parent-run-88",
			"issue.number": "1295",
			milestone: "goal-552",
			wave: "goal-552-wave-1",
			__node_id: "impl",
		});
		const config: any = {
			pipelineFile: WAVE_EXECUTE_PIPELINE_FILE,
			graph: { name: "wave_execute" },
		};

		const options = buildOpenRouterTraceOptions(ctx, config, "agent.worktree", "wt-session:attempt:2", "mothership.wave.execute.issue");
		const expectedTraceId = resolveLangfuseTraceId("run-1295", "agent.worktree", "wt-session:attempt:2");
		const expectedSessionId = resolveLangfuseTraceId("run-1295", "agent.worktree", "wt-session:attempt:2:session");

		expect(options.metadata.trace).toMatchObject({
			trace_id: expectedTraceId,
			trace_name: "wave_execute.dot",
			generation_name: "agent.worktree:impl:wt-session:attempt:2",
			parent_span_id: "parent-run-88",
			session_id: expectedSessionId,
			issue_number: "1295",
			milestone: "goal-552",
			wave: "goal-552-wave-1",
			llm_path_id: "mothership.wave.execute.issue",
		});
		expect(options.headers).toEqual({
			"HTTP-Referer": WAVE_EXECUTE_PIPELINE_FILE,
			"X-Title": "wave_execute",
		});
	});

	it("falls back gracefully when pipeline file or optional context keys are missing", () => {
		const ctx = new Context({ __run_id: "run-fallback" });
		const options = buildOpenRouterTraceOptions(ctx, { graph: { name: "fallback_graph" } as any }, "codergen", "");

		expect(options.metadata.trace.trace_id).toBe(resolveLangfuseTraceId("run-fallback", "codergen", "session"));
		expect(options.metadata.trace.trace_name).toBe("fallback_graph");
		expect(options.metadata.trace.generation_name).toContain("codergen");
		expect(options.metadata.trace.parent_span_id).toBeUndefined();
		expect(options.metadata.trace.issue_number).toBeUndefined();
		expect(options.headers).toEqual({
			"HTTP-Referer": "",
			"X-Title": "fallback_graph",
		});
	});

	it("merges trace metadata/headers with existing session options without dropping keys", () => {
		const ctx = new Context({ __run_id: "run-merge", __node_id: "kw-node" });
		const traceOptions = buildOpenRouterTraceOptions(ctx, undefined, "agent.kw", "kw-session:attempt:1");
		const merged = mergeOpenRouterTraceOptions({
			metadata: {
				tenant: "mothership",
				trace: {
					custom_trace_key: "keep-me",
				},
			},
			headers: {
				Authorization: "Bearer test",
			},
		}, traceOptions);

		const metadata = merged.metadata as Record<string, unknown>;
		const trace = metadata.trace as Record<string, string>;
		const headers = merged.headers as Record<string, string>;
		expect(metadata.tenant).toBe("mothership");
		expect(trace.custom_trace_key).toBe("keep-me");
		expect(trace.trace_id).toBeTruthy();
		expect(trace.generation_name).toBe("agent.kw:kw-node:kw-session:attempt:1");
		expect(headers.Authorization).toBe("Bearer test");
		expect(headers["X-Title"]).toBe("hatch-pipeline");
	});
});
