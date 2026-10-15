import { beforeEach, describe, expect, it, vi } from "vitest";

import { Context, StageStatus } from "../context.js";
import { createAgentSessionMock, promptAndExtractTextMock, makeHandler } from "../test/codergen-agent-mocks.js";

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
