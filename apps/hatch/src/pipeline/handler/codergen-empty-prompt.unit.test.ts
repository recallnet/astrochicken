import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	createAgentSessionMock,
	createReadOnlyToolsMock,
	sessionManagerMock,
	settingsManagerMock,
	promptAndExtractTextMock,
	bindLangfuseSessionTelemetryMock,
	emitLangfuseGenerationEventMock,
} = vi.hoisted(() => ({
	createAgentSessionMock: vi.fn(),
	createReadOnlyToolsMock: vi.fn(() => []),
	sessionManagerMock: {
		inMemory: vi.fn(() => ({ kind: "in-memory" })),
	},
	settingsManagerMock: {
		inMemory: vi.fn(() => ({ kind: "settings" })),
	},
	promptAndExtractTextMock: vi.fn(),
	bindLangfuseSessionTelemetryMock: vi.fn(() => vi.fn()),
	emitLangfuseGenerationEventMock: vi.fn(),
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
	createAgentSession: createAgentSessionMock,
	createReadOnlyTools: createReadOnlyToolsMock,
	SessionManager: sessionManagerMock,
	SettingsManager: settingsManagerMock,
}));

vi.mock("./session-completion.js", () => ({
	promptAndExtractText: promptAndExtractTextMock,
	extractLastAssistantText: vi.fn(() => ""),
}));

vi.mock("@recallnet/factory-telemetry", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@recallnet/factory-telemetry")>();
	return {
		...actual,
		bindLangfuseSessionTelemetry: bindLangfuseSessionTelemetryMock,
		computeLangfusePromptHash: vi.fn(() => "prompt-hash"),
		emitLangfuseGenerationEvent: emitLangfuseGenerationEventMock,
		nextLangfuseAttemptIndex: vi.fn(() => 1),
		recordLangfuseSessionContext: vi.fn(),
		usageFromAssistantMessage: vi.fn(() => undefined),
	};
});

import { Context, StageStatus } from "../context.js";
import { CodergenHandler } from "./codergen.js";

function makeHandler() {
	return new CodergenHandler({
		modelRegistry: { find: vi.fn(() => ({ id: "mock-model" })) } as any,
		authStorage: {} as any,
		resourceLoader: {} as any,
		defaultModel: "claude-sonnet-4-6",
		defaultProvider: "anthropic",
	} as any);
}

describe("CodergenHandler empty-prompt early exit", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns Completed with empty output when prompt is empty after expansion", async () => {
		const handler = makeHandler();
		const node = {
			id: "empty-prompt",
			attrs: {
				// No prompt attribute, and input will be empty too
			},
		} as any;
		const ctx = new Context({ __run_id: "run-empty" });

		const result = await handler.execute(new AbortController().signal, node, ctx, "");
		expect(result.status).toBe(StageStatus.Completed);
		expect(result.output).toBe("");
		expect(result.contextUpdates?.__codergen_skip_reason).toBe("empty_prompt_after_expansion");
		// No LLM call should have been made
		expect(createAgentSessionMock).not.toHaveBeenCalled();
		expect(promptAndExtractTextMock).not.toHaveBeenCalled();
	});

	it("returns Completed with empty output when prompt is whitespace-only", async () => {
		const handler = makeHandler();
		const node = {
			id: "whitespace-prompt",
			attrs: {
				prompt: "   \n  \t  ",
			},
		} as any;
		const ctx = new Context({ __run_id: "run-ws" });

		const result = await handler.execute(new AbortController().signal, node, ctx, "");
		expect(result.status).toBe(StageStatus.Completed);
		expect(result.output).toBe("");
		expect(createAgentSessionMock).not.toHaveBeenCalled();
	});

	it("returns Completed when prompt variables expand to empty", async () => {
		const handler = makeHandler();
		const node = {
			id: "var-expand-empty",
			attrs: {
				prompt: "${nonexistent_var}",
			},
		} as any;
		const ctx = new Context({ __run_id: "run-var" });

		const result = await handler.execute(new AbortController().signal, node, ctx, "");
		expect(result.status).toBe(StageStatus.Completed);
		expect(result.output).toBe("");
		expect(createAgentSessionMock).not.toHaveBeenCalled();
	});

	it("proceeds to LLM when prompt has content", async () => {
		const session = {
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "result" }],
					stopReason: "stop",
				},
			],
			abort: vi.fn(),
			dispose: vi.fn(),
			subscribe: vi.fn(() => () => {}),
		};
		createAgentSessionMock.mockResolvedValueOnce({ session });
		promptAndExtractTextMock.mockResolvedValueOnce("result");

		const handler = makeHandler();
		const node = {
			id: "has-prompt",
			attrs: {
				prompt: "Do something useful",
				llm_provider: "anthropic",
				llm_model: "claude-sonnet-4-6",
			},
		} as any;
		const ctx = new Context({ __run_id: "run-real" });

		const result = await handler.execute(new AbortController().signal, node, ctx, "");
		expect(result.status).toBe(StageStatus.Completed);
		expect(result.output).toBe("result");
		// LLM call was made
		expect(createAgentSessionMock).toHaveBeenCalledTimes(1);
	});
});
