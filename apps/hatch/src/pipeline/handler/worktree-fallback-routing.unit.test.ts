import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorktreeFixture } from "./worktree-fixtures.test-utils.js";

const {
	createAgentSessionMock,
	createCodingToolsMock,
	sessionManagerMock,
	settingsManagerMock,
	promptAndExtractTextMock,
	execFileSyncMock,
	bindLangfuseSessionTelemetryMock,
	emitLangfuseGenerationEventMock,
} = vi.hoisted(() => ({
	createAgentSessionMock: vi.fn(),
	createCodingToolsMock: vi.fn(() => []),
	sessionManagerMock: {
		create: vi.fn((_cwd: string, dir: string) => ({ kind: "persistent", dir })),
		continueRecent: vi.fn((_cwd: string, dir: string) => ({ kind: "continue-recent", dir })),
		inMemory: vi.fn(() => ({ kind: "in-memory" })),
	},
	settingsManagerMock: {
		inMemory: vi.fn(() => ({ kind: "settings" })),
	},
	promptAndExtractTextMock: vi.fn(),
	execFileSyncMock: vi.fn((command: string, args: string[]) => {
		if (command !== "git") return Buffer.from("");
		if (args.includes("--is-inside-work-tree")) return Buffer.from("true\n");
		if (args.includes("--show-toplevel")) return Buffer.from("/hermetic/worktree-fixture-repo\n");
		if (args.includes("checkout")) return Buffer.from("");
		if (args.includes("worktree")) return Buffer.from("");
		if (args.includes("status")) return Buffer.from("");
		if (args.includes("rev-list")) return Buffer.from("0\n");
		return Buffer.from("");
	}),
	bindLangfuseSessionTelemetryMock: vi.fn(() => vi.fn()),
	emitLangfuseGenerationEventMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execFileSync: execFileSyncMock,
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
	createAgentSession: createAgentSessionMock,
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

import { EventBus } from "@recallnet/factory-telemetry";

import { Context, StageStatus } from "../context.js";
import { KnowledgeWorkerHandler, WorktreeAgentHandler } from "./worktree.js";

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

const restrictivePolicy: EffectiveModelPolicy = {
	...policy,
	allowedModels: ["openai/gpt-5.4"],
	providerOrder: ["openai"],
	defaultModel: "openai/gpt-5.4",
	preferredModel: "openai/gpt-5.4",
	policyDefaultModel: "openai/gpt-5.4",
	safeFallbackModel: undefined,
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

describe("worktree handler fallback routing", () => {
	let fixture: ReturnType<typeof createWorktreeFixture>;

	beforeEach(() => {
		vi.clearAllMocks();
		fixture = createWorktreeFixture();
		execFileSyncMock.mockImplementation((command: string, args: string[], options?: { cwd?: string }) => {
			if (command !== "git") return Buffer.from("");
			if (args.includes("--is-inside-work-tree")) return Buffer.from("true\n");
			if (args.includes("--show-toplevel")) return Buffer.from(`${options?.cwd || fixture.repoDir}\n`);
			if (args.includes("checkout")) return Buffer.from("");
			if (args.includes("worktree")) return Buffer.from("");
			if (args.includes("status")) return Buffer.from("");
			if (args.includes("rev-list")) return Buffer.from("0\n");
			return Buffer.from("");
		});
	});

	afterEach(() => {
		fixture.cleanup();
	});

	it("fails closed when repo fixtures are missing, then succeeds with per-test fixture setup", async () => {
		const modelRegistryFind = vi.fn((provider: string, modelId: string) => ({ id: `${provider}:${modelId}` }));
		createAgentSessionMock.mockReset();
		createAgentSessionMock.mockResolvedValue({ session: assistantSession() });
		promptAndExtractTextMock.mockResolvedValue("done");

		const handler = new WorktreeAgentHandler({
			modelRegistry: { find: modelRegistryFind } as any,
			authStorage: {} as any,
			resourceLoader: { getAppendSystemPrompt: () => [] } as any,
			defaultModel: "gpt-5.4",
			defaultProvider: "openai",
			modelPolicy: policy,
			workDir: ".",
			eventBus: new EventBus(),
		} as any);

		const missingRepoOutcome = await handler.execute(
			new AbortController().signal,
			{
				id: "build-missing-repo",
				attrs: {
					type: "agent.worktree",
					repo: `${fixture.root}/repo-missing`,
					branch: "wave/missing",
					prompt: "test",
				},
			} as any,
			new Context({ __run_id: "run-missing" }),
			"",
		);

		expect(missingRepoOutcome.status).toBe(StageStatus.Failed);
		expect(missingRepoOutcome.error).toContain("failed to create worktree");
		expect(missingRepoOutcome.error).toContain(".git.hatch.lock");

		const outcome = await handler.execute(
			new AbortController().signal,
			{
				id: "build-with-fixture",
				attrs: {
					type: "agent.worktree",
					// Hermetic fixture ensures repo lock-path directories exist.
					repo: fixture.repoDir,
					branch: "wave/test",
					prompt: "test",
				},
			} as any,
			new Context({ __run_id: "run-1" }),
			"",
		);

		expect(outcome.status).toBe(StageStatus.Completed);
		expect(modelRegistryFind.mock.calls.map((call) => call.slice(0, 2))).toEqual([["openai", "gpt-5.4"]]);
	});

	it("agent.worktree retries the next provider when the first provider auth fails", async () => {
		const modelRegistryFind = vi.fn((provider: string, modelId: string) => ({ id: `${provider}:${modelId}` }));
		createAgentSessionMock.mockReset();
		createAgentSessionMock
			.mockRejectedValueOnce(new Error("401 unauthorized"))
			.mockResolvedValueOnce({ session: assistantSession() });
		promptAndExtractTextMock.mockResolvedValue("done");

		const handler = new WorktreeAgentHandler({
			modelRegistry: { find: modelRegistryFind } as any,
			authStorage: {} as any,
			resourceLoader: { getAppendSystemPrompt: () => [] } as any,
			defaultModel: "gpt-5.4",
			defaultProvider: "openai",
			modelPolicy: policy,
			workDir: ".",
			eventBus: new EventBus(),
		} as any);

		const outcome = await handler.execute(
			new AbortController().signal,
			{
				id: "build",
				attrs: {
					type: "agent.worktree",
					// Hermetic fixture ensures repo lock-path directories exist.
					repo: fixture.repoDir,
					branch: "wave/test",
					prompt: "test",
				},
			} as any,
			new Context({ __run_id: "run-1" }),
			"",
		);

		expect(outcome.status).toBe(StageStatus.Completed);
		expect(modelRegistryFind.mock.calls.map((call) => call.slice(0, 2))).toEqual([
			["openai", "gpt-5.4"],
			["openrouter", "gpt-5.4"],
		]);
	});

	it("agent.kw retries with safe_fallback_model after provider chain exhausts", async () => {
		const modelRegistryFind = vi.fn((provider: string, modelId: string) => ({ id: `${provider}:${modelId}` }));
		createAgentSessionMock.mockReset();
		createAgentSessionMock
			.mockRejectedValueOnce(new Error("provider unavailable"))
			.mockRejectedValueOnce(new Error("429 rate limit exceeded"))
			.mockResolvedValueOnce({ session: assistantSession() });
		promptAndExtractTextMock.mockResolvedValue("kw output");

		const handler = new KnowledgeWorkerHandler({
			modelRegistry: { find: modelRegistryFind } as any,
			authStorage: {} as any,
			resourceLoader: {
				getExtensions: () => [],
				getSkills: () => [],
				getPrompts: () => [],
				getThemes: () => [],
				getAgentsFiles: () => [],
				getSystemPrompt: () => "",
				getAppendSystemPrompt: () => [],
				getPathMetadata: () => ({}),
				extendResources: () => undefined,
				reload: () => undefined,
			} as any,
			defaultModel: "gpt-5.4",
			defaultProvider: "openai",
			modelPolicy: policy,
			workDir: ".",
			eventBus: new EventBus(),
		} as any);

		const outcome = await handler.execute(
			new AbortController().signal,
			{ id: "research", attrs: { type: "agent.kw", prompt: "test" } } as any,
			new Context({ __run_id: "run-2" }),
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
		expect(outcome.contextUpdates?.model_policy_selected_via).toBe("policy_default");
	});

	it("agent.worktree fails early when node overrides violate allowed model policy", async () => {
		const handler = new WorktreeAgentHandler({
			modelRegistry: { find: vi.fn(() => ({ id: "openai:openai/gpt-5.4" })) } as any,
			authStorage: {} as any,
			resourceLoader: { getAppendSystemPrompt: () => [] } as any,
			defaultModel: "openai/gpt-5.4",
			defaultProvider: "openai",
			modelPolicy: restrictivePolicy,
			workDir: ".",
			eventBus: new EventBus(),
		} as any);

		await expect(
			handler.execute(
				new AbortController().signal,
				{
					id: "build-disallowed-model",
					attrs: {
						type: "agent.worktree",
						repo: fixture.repoDir,
						branch: "wave/disallowed-model",
						prompt: "test",
						agent_model: "anthropic/claude-opus-4-1",
					},
				} as any,
				new Context({ __run_id: "run-disallowed-model" }),
				"",
			),
		).rejects.toThrow(/model-policy.*violates allowed_models/);
		expect(createAgentSessionMock).not.toHaveBeenCalled();
	});

	it("agent.kw fails early when node overrides violate provider order policy", async () => {
		const handler = new KnowledgeWorkerHandler({
			modelRegistry: { find: vi.fn(() => ({ id: "openai:openai/gpt-5.4" })) } as any,
			authStorage: {} as any,
			resourceLoader: {
				getExtensions: () => [],
				getSkills: () => [],
				getPrompts: () => [],
				getThemes: () => [],
				getAgentsFiles: () => [],
				getSystemPrompt: () => "",
				getAppendSystemPrompt: () => [],
				getPathMetadata: () => ({}),
				extendResources: () => undefined,
				reload: () => undefined,
			} as any,
			defaultModel: "openai/gpt-5.4",
			defaultProvider: "openai",
			modelPolicy: restrictivePolicy,
			workDir: ".",
			eventBus: new EventBus(),
		} as any);

		await expect(
			handler.execute(
				new AbortController().signal,
				{
					id: "kw-disallowed-provider",
					attrs: {
						type: "agent.kw",
						prompt: "test",
						llm_provider: "openrouter",
					},
				} as any,
				new Context({ __run_id: "run-disallowed-provider" }),
				"",
			),
		).rejects.toThrow(/model-policy.*violates provider_order/);
		expect(createAgentSessionMock).not.toHaveBeenCalled();
	});
});
