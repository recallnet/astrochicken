import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	createAgentSessionMock,
	createReadOnlyToolsMock,
	createCodingToolsMock,
	sessionManagerMock,
	settingsManagerMock,
	promptAndExtractTextMock,
	bindLangfuseSessionTelemetryMock,
	emitLangfuseGenerationEventMock,
} = vi.hoisted(() => ({
	createAgentSessionMock: vi.fn(),
	createReadOnlyToolsMock: vi.fn(() => []),
	createCodingToolsMock: vi.fn(() => []),
	sessionManagerMock: {
		create: vi.fn((_cwd: string, dir: string) => ({ kind: "persistent", dir })),
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
	createCodingTools: createCodingToolsMock,
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
import { ManagerLoopHandler } from "./manager.js";

import type { EffectiveModelPolicy } from "../../factory/model-policy.js";

const policy: EffectiveModelPolicy = {
	defaultProvider: "openai",
	defaultModel: "gpt-5.4",
	allowedModels: ["gpt-5.4", "gpt-4.1"],
	preferredModel: "gpt-5.4",
	providerOrder: ["openai", "openrouter"],
	safeFallbackModel: "gpt-4.1",
	selectedVia: "policy_default",
	policyDefaultProvider: "openai",
	policyDefaultModel: "gpt-5.4",
	policySource: {
		configPath: "factories/mothership/factory.config.json",
		policyPackDir: "factories/mothership/policy-pack/v1",
		policyVersion: "v1",
	},
};

function assistantSession() {
	return {
		messages: [
			{
				role: "assistant",
				content: [{ type: "text", text: "ok" }],
				stopReason: "stop",
			},
		],
		subscribe: vi.fn(() => () => {}),
		dispose: vi.fn(),
		abort: vi.fn(),
	};
}

describe("handler fallback routing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("codergen retries the next provider when the first provider auth fails", async () => {
		const modelRegistryFind = vi.fn((provider: string, modelId: string) => ({ id: `${provider}:${modelId}` }));
		createAgentSessionMock
			.mockRejectedValueOnce(new Error("401 unauthorized"))
			.mockResolvedValueOnce({ session: assistantSession() });
		promptAndExtractTextMock.mockResolvedValue("done");

		const handler = new CodergenHandler({
			modelRegistry: { find: modelRegistryFind } as any,
			authStorage: {} as any,
			resourceLoader: {} as any,
			defaultModel: "gpt-5.4",
			defaultProvider: "openai",
			modelPolicy: policy,
		});

		const outcome = await handler.execute(
			new AbortController().signal,
			{ id: "draft", attrs: { prompt: "test" } } as any,
			new Context(),
			"",
		);

		expect(outcome.status).toBe(StageStatus.Completed);
		expect(modelRegistryFind.mock.calls.map((call) => call.slice(0, 2))).toEqual([
			["openai", "gpt-5.4"],
			["openrouter", "gpt-5.4"],
		]);
		expect(outcome.contextUpdates?.model_policy_selected_provider).toBe("openrouter");
		expect(outcome.contextUpdates?.model_policy_selected_model).toBe("gpt-5.4");
	});

	it("manager retries with safe_fallback_model after provider chain exhausts", async () => {
		const modelRegistryFind = vi.fn((provider: string, modelId: string) => ({ id: `${provider}:${modelId}` }));
		createAgentSessionMock
			.mockRejectedValueOnce(new Error("provider unavailable"))
			.mockRejectedValueOnce(new Error("429 rate limit exceeded"))
			.mockResolvedValueOnce({ session: assistantSession() });
		promptAndExtractTextMock.mockResolvedValue("manager output");

		const handler = new ManagerLoopHandler({
			modelRegistry: { find: modelRegistryFind } as any,
			authStorage: {} as any,
			resourceLoader: {} as any,
			defaultModel: "gpt-5.4",
			defaultProvider: "openai",
			modelPolicy: policy,
			workDir: ".",
		});

		const outcome = await handler.execute(
			new AbortController().signal,
			{ id: "manage", attrs: { prompt: "test" } } as any,
			new Context(),
			"",
		);

		expect(outcome.status).toBe(StageStatus.Completed);
		expect(modelRegistryFind.mock.calls.map((call) => call.slice(0, 2))).toEqual([
			["openai", "gpt-5.4"],
			["openrouter", "gpt-5.4"],
			["openai", "gpt-4.1"],
		]);
		expect(outcome.contextUpdates?.model_policy_selected_provider).toBe("openai");
		expect(outcome.contextUpdates?.model_policy_selected_model).toBe("gpt-4.1");
	});
});
