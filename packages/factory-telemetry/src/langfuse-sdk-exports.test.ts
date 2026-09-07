import { describe, expect, it } from "vitest";

import {
	LANGFUSE_GENERATION_EVENT_KIND,
	LANGFUSE_SESSION_EVENT_KIND,
	LANGFUSE_PROMPT_TEXT_FLAG,
	bindLangfuseSessionTelemetry,
	computeLangfusePromptHash,
	emitLangfuseGenerationEvent,
	emitLangfuseSessionEvent,
	isLangfusePromptTextEnabled,
	langfuseNodeContextKey,
	nextLangfuseAttemptIndex,
	readLangfuseSessionContext,
	recordLangfuseSessionContext,
	resolveLangfuseTraceId,
	usageFromAssistantMessage,
} from "./index.js";

describe("langfuse telemetry exports", () => {
	it("re-exports handler langfuse telemetry api from package index", () => {
		expect(LANGFUSE_GENERATION_EVENT_KIND).toBe("telemetry.langfuse.generation");
		expect(LANGFUSE_SESSION_EVENT_KIND).toBe("telemetry.langfuse.session");
		expect(LANGFUSE_PROMPT_TEXT_FLAG).toBe("HATCH_LANGFUSE_INCLUDE_PROMPT_TEXT");
		expect(typeof bindLangfuseSessionTelemetry).toBe("function");
		expect(typeof computeLangfusePromptHash).toBe("function");
		expect(typeof emitLangfuseGenerationEvent).toBe("function");
		expect(typeof emitLangfuseSessionEvent).toBe("function");
		expect(typeof isLangfusePromptTextEnabled).toBe("function");
		expect(typeof langfuseNodeContextKey).toBe("function");
		expect(typeof nextLangfuseAttemptIndex).toBe("function");
		expect(typeof readLangfuseSessionContext).toBe("function");
		expect(typeof recordLangfuseSessionContext).toBe("function");
		expect(typeof resolveLangfuseTraceId).toBe("function");
		expect(typeof usageFromAssistantMessage).toBe("function");
	});
});
