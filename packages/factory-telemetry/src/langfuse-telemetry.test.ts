import { describe, expect, it } from "vitest";

import { EventBus, type Event } from "./events.js";
import {
	emitLangfuseGenerationEvent,
	emitLangfuseSessionEvent,
	langfuseNodeContextKey,
	readLangfuseSessionContext,
	recordLangfuseSessionContext,
	usageFromAssistantMessage,
	LANGFUSE_GENERATION_EVENT_KIND,
	LANGFUSE_SESSION_EVENT_KIND,
} from "./langfuse-telemetry.js";
import { mapEventToLangfuseSpan } from "./langfuse.js";
import { buildQualitySignalEventData } from "./quality.js";

class MemoryContext {
	private readonly map = new Map<string, string>();

	constructor(initial: Record<string, string> = {}) {
		for (const [key, value] of Object.entries(initial)) {
			this.map.set(key, value);
		}
	}

	get(key: string): string {
		return this.map.get(key) ?? "";
	}

	set(key: string, value: string): void {
		this.map.set(key, value);
	}
}

function makeNode(overrides: Record<string, string> = {}): any {
	return {
		id: "node-1",
		attrs: {
			skill_id: "review",
			skill_name: "review",
			trust_domain: "builder",
			trust_role: "tool.operator",
			...overrides,
		},
	};
}

function captureEvents(bus: EventBus): Event[] {
	const events: Event[] = [];
	bus.on((event) => events.push(event));
	return events;
}

describe("langfuse telemetry metadata", () => {
	it("extracts usage + cost metadata from anthropic/openai/gemini shaped payloads", () => {
		const anthropic = usageFromAssistantMessage({
			usage: {
				input: 12,
				output: 5,
				totalTokens: 17,
				cacheRead: 2,
				cost: { input: 0.11, output: 0.03, total: 0.14 },
			},
		});
		expect(anthropic.inputTokens).toBe(12);
		expect(anthropic.outputTokens).toBe(5);
		expect(anthropic.totalTokens).toBe(17);
		expect(anthropic.costTotal).toBe(0.14);

		const openai = usageFromAssistantMessage({
			usage: {
				prompt_tokens: 90,
				completion_tokens: 30,
				total_tokens: 120,
				prompt_tokens_details: { cached_tokens: 10 },
				cost: { promptCost: 0.09, completionCost: 0.03, totalCost: 0.12 },
			},
		});
		expect(openai.inputTokens).toBe(90);
		expect(openai.outputTokens).toBe(30);
		expect(openai.cacheReadTokens).toBe(10);
		expect(openai.totalTokens).toBe(120);
		expect(openai.costTotal).toBe(0.12);

		const gemini = usageFromAssistantMessage({
			usageMetadata: {
				promptTokenCount: 40,
				candidatesTokenCount: 11,
				totalTokenCount: 51,
				cachedContentTokenCount: 8,
			},
			usage: {
				cost: { input: 0.02, output: 0.01, total: 0.03 },
			},
		});
		expect(gemini.inputTokens).toBe(40);
		expect(gemini.outputTokens).toBe(11);
		expect(gemini.totalTokens).toBe(51);
		expect(gemini.cacheReadTokens).toBe(8);
		expect(gemini.costTotal).toBe(0.03);

		const openrouterHeaderOnly = usageFromAssistantMessage({
			usage: {
				prompt_tokens: 120,
				completion_tokens: 30,
				total_tokens: 150,
			},
			responseHeaders: {
				"x-cost": "0.42",
			},
		});
		expect(openrouterHeaderOnly.totalTokens).toBe(150);
		expect(openrouterHeaderOnly.costTotal).toBe(0.42);
	});

	it("records + reads node-scoped langfuse session context without cross-node clobber", () => {
		const ctx = new MemoryContext();
		recordLangfuseSessionContext(ctx, "builder_node", "sess-builder", 2, "sha256:builder", "skill.builder");
		recordLangfuseSessionContext(ctx, "judge_node", "sess-judge", 1, "sha256:judge", "skill.judge");

		expect(readLangfuseSessionContext(ctx, "builder_node")).toEqual({
			langfuse_session_id: "sess-builder",
			langfuse_skill_id: "skill.builder",
			langfuse_prompt_hash: "sha256:builder",
			langfuse_attempt_index: "2",
		});
		expect(readLangfuseSessionContext(ctx, "judge_node")).toEqual({
			langfuse_session_id: "sess-judge",
			langfuse_skill_id: "skill.judge",
			langfuse_prompt_hash: "sha256:judge",
			langfuse_attempt_index: "1",
		});
		expect(ctx.get(langfuseNodeContextKey("builder_node", "session_id"))).toBe("sess-builder");
		expect(ctx.get(langfuseNodeContextKey("judge_node", "session_id"))).toBe("sess-judge");
	});

	it("defaults langfuse attempt index to 1 when context is missing", () => {
		const ctx = new MemoryContext();
		expect(readLangfuseSessionContext(ctx, "missing_node")).toEqual({
			langfuse_session_id: "",
			langfuse_skill_id: "",
			langfuse_prompt_hash: "",
			langfuse_attempt_index: "1",
		});
	});

	it("emits generation events with KPI tags, quality tags, retry metadata, and cost totals", () => {
		const bus = new EventBus();
		const events = captureEvents(bus);
		const ctx = new MemoryContext({
			__run_id: "run-1278",
			goal_number: "542",
			wave_id: "goal-542-wave-1",
			issue_number: "1278",
			hypothesis_id: "h-17",
		});

		emitLangfuseGenerationEvent({
			eventBus: bus,
			node: makeNode({ skill_id: "goal.supervisor", llm_path_id: "mothership.supervisor.review" }),
			ctx,
			handlerType: "stack.manager_loop",
			llmPathId: "mothership.supervisor.review",
			sessionKey: "goal-542-session",
			attemptIndex: 2,
			prompt: "run supervisor",
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			outcome: "success",
			usage: {
				inputTokens: 20,
				outputTokens: 8,
				totalTokens: 28,
				costInput: 0.2,
				costOutput: 0.1,
				costTotal: 0.3,
			},
		});

		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe(LANGFUSE_GENERATION_EVENT_KIND);
		expect(events[0].data?.langfuse_cost_input).toBe("0.2");
		expect(events[0].data?.langfuse_cost_output).toBe("0.1");
		expect(events[0].data?.langfuse_cost_total).toBe("0.3");
		expect(events[0].data?.handler).toBe("stack.manager_loop");
		expect(events[0].data?.skill).toBe("goal.supervisor");
		expect(events[0].data?.langfuse_skill).toBe("goal.supervisor");
		expect(events[0].data?.["hatch.work_unit"]).toBe("goal:542|wave:goal-542-wave-1|issue:1278|hypothesis:h-17");
		expect(events[0].data?.["hatch.work_unit.wave"]).toBe("goal-542-wave-1");
		expect(events[0].data?.["hatch.kpi.cost.skill"]).toBe("goal.supervisor");
		expect(events[0].data?.["hatch.retry_class"]).toBe("retry_pass");
		expect(events[0].data?.["hatch.first_attempt_pass"]).toBe("false");
		expect(events[0].data?.langfuse_quality_score).toBe("0.90");
		expect(events[0].data?.llm_path_id).toBe("mothership.supervisor.review");
		expect(events[0].data?.["hatch.llm_path_id"]).toBe("mothership.supervisor.review");
		expect(events[0].data?.langfuse_tag_llm_path_id).toBe("mothership.supervisor.review");
		expect(events[0].data?.langfuse_tag_model).toBe("claude-sonnet-4-6");
		expect(events[0].data?.langfuse_tag_provider).toBe("anthropic");
		expect(events[0].data?.langfuse_tag_outcome).toBe("success");
		expect(events[0].data?.langfuse_tag_retry).toBe("true");
		expect(events[0].data?.langfuse_tag_retry_class).toBe("retry_pass");
		expect(events[0].data?.langfuse_tag_failure_class).toBe("none");
		expect(events[0].data?.langfuse_tag_role).toBe("manager.supervisor");
	});

	it("emits session events with attempt/retry metadata and aggregated cost fields", () => {
		const bus = new EventBus();
		const events = captureEvents(bus);
		const ctx = new MemoryContext({ __run_id: "run-1278", issue_number: "1278" });

		emitLangfuseSessionEvent({
			eventBus: bus,
			node: makeNode({ skill_id: "wave.review", llm_path_id: "mothership.issue.review" }),
			ctx,
			handlerType: "agent.worktree",
			llmPathId: "mothership.issue.review",
			sessionKey: "wave-1",
			eventType: "tool_execution_end",
			attemptIndex: 3,
			toolName: "bash",
			isError: true,
			provider: "openai",
			model: "gpt-5",
			usage: {
				inputTokens: 10,
				outputTokens: 4,
				totalTokens: 14,
				costInput: 0.05,
				costOutput: 0.02,
				costTotal: 0.07,
			},
		});

		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe(LANGFUSE_SESSION_EVENT_KIND);
		expect(events[0].data?.langfuse_cost_total).toBe("0.07");
		expect(events[0].data?.langfuse_attempt_index).toBe("3");
		expect(events[0].data?.["hatch.retry_class"]).toBe("retry_fail");
		expect(events[0].data?.["hatch.first_attempt_pass"]).toBe("false");
		expect(events[0].data?.["hatch.kpi.cost.skill"]).toBe("wave.review");
		expect(events[0].data?.llm_path_id).toBe("mothership.issue.review");
		expect(events[0].data?.["hatch.llm_path_id"]).toBe("mothership.issue.review");
		expect(events[0].data?.langfuse_tag_llm_path_id).toBe("mothership.issue.review");
		expect(events[0].data?.langfuse_tag_model).toBe("gpt-5");
		expect(events[0].data?.langfuse_tag_provider).toBe("openai");
		expect(events[0].data?.langfuse_tag_outcome).toBe("fail");
		expect(events[0].data?.langfuse_tag_retry).toBe("true");
		expect(events[0].data?.langfuse_tag_retry_class).toBe("retry_fail");
		expect(events[0].data?.langfuse_tag_failure_class).toBe("runtime");
		expect(events[0].data?.langfuse_tag_role).toBe("worktree.implementer");
	});

	it("maps quality.signal payloads into langfuse spans with mirrored metadata tags", () => {
		const stageError: Event = {
			kind: "stage.error",
			timestamp: new Date("2026-03-07T00:00:00.000Z"),
			nodeId: "review",
			traceId: "builder-000001",
			error: new Error("guard validation failed"),
			data: {
				attempt: "2",
				handler_type: "agent.worktree",
				model: "claude-sonnet-4-6",
				guard_circuit_state: "open",
				trust_partition: "builder",
			},
		};
		const qualityData = buildQualitySignalEventData(stageError);
		expect(qualityData?.langfuse_quality_score).toBeDefined();
		expect(qualityData?.langfuse_failure_class).toBe("guard");
		expect(qualityData?.langfuse_skill).toBe("agent.worktree");

		const span = mapEventToLangfuseSpan({
			kind: "quality.signal",
			timestamp: new Date("2026-03-07T00:00:01.000Z"),
			nodeId: "review",
			traceId: "builder-000001",
			data: qualityData || undefined,
		});
		expect(span).not.toBeNull();
		expect(span?.metadata.langfuse_quality_score).toBe(qualityData?.langfuse_quality_score);
		expect(span?.metadata.langfuse_failure_class).toBe("guard");
		expect(span?.metadata.langfuse_skill).toBe("agent.worktree");
		expect(span?.metadata["hatch.retry_class"]).toBe("retry_fail");
	});
});
