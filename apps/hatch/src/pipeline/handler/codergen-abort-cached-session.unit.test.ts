import { beforeEach, describe, expect, it, vi } from "vitest";

import { Context, StageStatus } from "../context.js";
import { createAgentSessionMock, createReadOnlyToolsMock, sessionManagerMock, settingsManagerMock, promptAndExtractTextMock, bindLangfuseSessionTelemetryMock, makeHandler } from "../test/codergen-agent-mocks.js";

function makeSession() {
	return {
		messages: [],
		abort: vi.fn(),
		dispose: vi.fn(),
		subscribe: vi.fn(() => () => {}),
	};
}

describe("CodergenHandler prompt lifecycle", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		createReadOnlyToolsMock.mockReturnValue([]);
		sessionManagerMock.inMemory.mockReturnValue({ kind: "in-memory" });
		settingsManagerMock.inMemory.mockReturnValue({ kind: "settings" });
		bindLangfuseSessionTelemetryMock.mockReturnValue(vi.fn());
	});

	it("creates a fresh codergen session for each completed goal-decomposer step even with a shared session_id", async () => {
		const firstSession = makeSession();
		firstSession.messages = [
			{
				role: "assistant",
				content: [{ type: "text", text: "{\"goal_context\":true}" }],
				stopReason: "stop",
			},
		];
		const secondSession = makeSession();
		secondSession.messages = [
			{
				role: "assistant",
				content: [{ type: "text", text: "[{\"id\":\"F-1\"}]" }],
				stopReason: "stop",
			},
		];

		createAgentSessionMock
			.mockResolvedValueOnce({ session: firstSession })
			.mockResolvedValueOnce({ session: secondSession });

		promptAndExtractTextMock
			.mockResolvedValueOnce("{\"goal_context\":true}")
			.mockResolvedValueOnce("[{\"id\":\"F-1\"}]");

		const handler = makeHandler();
		const node = {
			id: "goal-decompose-step",
			attrs: {
				prompt: "Decompose goal",
				session_id: "goal-decomposer-1393",
				llm_provider: "anthropic",
				llm_model: "claude-sonnet-4-6",
			},
		} as any;
		const ctx = new Context({ __run_id: "run-goal-decompose", issue_number: "1393" });

		const first = await handler.execute(new AbortController().signal, node, ctx, "");
		const second = await handler.execute(new AbortController().signal, node, ctx, "");

		expect(first.status).toBe(StageStatus.Completed);
		expect(second.status).toBe(StageStatus.Completed);
		expect(createAgentSessionMock).toHaveBeenCalledTimes(2);
		expect(firstSession.dispose).toHaveBeenCalledTimes(1);
		expect(secondSession.dispose).toHaveBeenCalledTimes(1);
	});

	it("fails closed and starts a fresh session after an aborted prompt", async () => {
		const hangingSession = makeSession();
		const replacementSession = makeSession();
		replacementSession.messages = [
			{
				role: "assistant",
				content: [{ type: "text", text: "ok" }],
				stopReason: "stop",
			},
		];

		createAgentSessionMock
			.mockResolvedValueOnce({ session: hangingSession })
			.mockResolvedValueOnce({ session: replacementSession });

		promptAndExtractTextMock
			.mockImplementationOnce(() => new Promise<string>(() => {}))
			.mockResolvedValueOnce("ok");

		const handler = makeHandler();
		const node = {
			id: "scope",
			attrs: {
				prompt: "Draft scenarios",
				session_id: "shared-scenario-author",
				llm_provider: "anthropic",
				llm_model: "claude-sonnet-4-6",
			},
		} as any;
		const ctx = new Context({ __run_id: "run-scope" });

		const ac = new AbortController();
		const firstExecution = handler.execute(ac.signal, node, ctx, "");
		await Promise.resolve();
		ac.abort();

		await expect(firstExecution).resolves.toMatchObject({
			status: StageStatus.Failed,
			error: expect.stringMatching(/aborted/i),
		});
		expect(hangingSession.dispose).toHaveBeenCalledTimes(1);

		const secondExecution = await handler.execute(new AbortController().signal, node, ctx, "");
		expect(secondExecution.status).toBe(StageStatus.Completed);
		expect(createAgentSessionMock).toHaveBeenCalledTimes(2);
	});

	it("fails closed and starts a fresh session after the node timeout expires", async () => {
		vi.useFakeTimers();
		try {
			const hangingSession = makeSession();
			const replacementSession = makeSession();
			replacementSession.messages = [
				{
					role: "assistant",
					content: [{ type: "text", text: "ok" }],
					stopReason: "stop",
				},
			];

			createAgentSessionMock
				.mockResolvedValueOnce({ session: hangingSession })
				.mockResolvedValueOnce({ session: replacementSession });

			promptAndExtractTextMock
				.mockImplementationOnce(() => new Promise<string>(() => {}))
				.mockResolvedValueOnce("ok");

			const handler = makeHandler();
			const node = {
				id: "scope-timeout",
				attrs: {
					prompt: "Draft scenarios",
					session_id: "shared-scenario-author",
					llm_provider: "anthropic",
					llm_model: "claude-sonnet-4-6",
					timeout: "1ms",
				},
			} as any;
			const ctx = new Context({ __run_id: "run-scope-timeout" });

			const firstExecution = handler.execute(new AbortController().signal, node, ctx, "");
			await vi.advanceTimersByTimeAsync(1);

			await expect(firstExecution).resolves.toMatchObject({
				status: StageStatus.Failed,
				error: expect.stringMatching(/timed out/i),
			});
			expect(hangingSession.dispose).toHaveBeenCalledTimes(1);

			const secondExecution = await handler.execute(new AbortController().signal, node, ctx, "");
			expect(secondExecution.status).toBe(StageStatus.Completed);
			expect(createAgentSessionMock).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("emits periodic progress while a codergen prompt is still in flight", async () => {
		vi.useFakeTimers();
		try {
			const hangingSession = makeSession();
			createAgentSessionMock.mockResolvedValueOnce({ session: hangingSession });
			promptAndExtractTextMock.mockImplementationOnce(() => new Promise<string>(() => {}));

			const handler = makeHandler();
			const node = {
				id: "scope-heartbeat",
				attrs: {
					prompt: "Draft scenarios",
					session_id: "shared-scenario-author",
					llm_provider: "anthropic",
					llm_model: "claude-sonnet-4-6",
					timeout: "31s",
				},
			} as any;
			const ctx = new Context({ __run_id: "run-scope-heartbeat" });
			const reportProgress = vi.fn();

			const execution = handler.execute(new AbortController().signal, node, ctx, "", { reportProgress });
			await vi.advanceTimersByTimeAsync(15_000);
			expect(reportProgress).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(15_000);
			expect(reportProgress).toHaveBeenCalledTimes(2);
			await vi.advanceTimersByTimeAsync(1_000);

			await expect(execution).resolves.toMatchObject({
				status: StageStatus.Failed,
				error: expect.stringMatching(/timed out/i),
			});
		} finally {
			vi.useRealTimers();
		}
	});
});
