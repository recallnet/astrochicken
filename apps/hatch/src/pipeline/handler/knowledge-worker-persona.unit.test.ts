import { describe, it, expect, beforeEach, vi } from "vitest";

const {
	createAgentSessionMock,
	createCodingToolsMock,
	sessionManagerMock,
	settingsManagerMock,
	promptAndExtractTextMock,
} = vi.hoisted(() => ({
	createAgentSessionMock: vi.fn(),
	createCodingToolsMock: vi.fn(() => []),
	sessionManagerMock: {
		inMemory: vi.fn(() => ({ kind: "in-memory" })),
		create: vi.fn(() => ({ kind: "create" })),
	},
	settingsManagerMock: {
		inMemory: vi.fn(() => ({ kind: "settings" })),
	},
	promptAndExtractTextMock: vi.fn(async () => "ok"),
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
	createAgentSession: createAgentSessionMock,
	createCodingTools: createCodingToolsMock,
	SessionManager: sessionManagerMock,
	SettingsManager: settingsManagerMock,
}));

vi.mock("./session-completion.js", () => ({
	promptAndExtractText: promptAndExtractTextMock,
}));

import { Context, StageStatus } from "../context.js";
import { KnowledgeWorkerHandler } from "./worktree.js";

function makeResourceLoader() {
	return {
		getExtensions: () => ({ extensions: [], diagnostics: [] }),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined,
		getAppendSystemPrompt: () => ["base-system-context"],
		getPathMetadata: () => new Map(),
		extendResources: () => {},
		reload: async () => {},
	};
}

function makeSession() {
	return {
		messages: [
			{
				role: "assistant",
				content: [{ type: "text", text: "ok" }],
				stopReason: "stop",
			},
		],
		dispose: vi.fn(),
	};
}

function makeHandler() {
	return new KnowledgeWorkerHandler({
		modelRegistry: { find: vi.fn(() => ({ id: "mock-model" })) } as any,
		authStorage: {} as any,
		resourceLoader: makeResourceLoader() as any,
		defaultModel: "claude-sonnet-4-6",
		defaultProvider: "anthropic",
		workDir: ".",
	} as any);
}

describe("KnowledgeWorkerHandler persona support", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createAgentSessionMock.mockResolvedValue({ session: makeSession() });
	});

	it("appends persona to system context via resource loader without mutating user prompt", async () => {
		const handler = makeHandler();
		const node = {
			id: "red",
			attrs: {
				type: "agent.kw",
				prompt: "Base prompt",
				persona: "Contrarian strategist",
			},
		} as any;

		const outcome = await handler.execute(new AbortController().signal, node, new Context(), "");

		expect(outcome.status).toBe(StageStatus.Completed);
		expect(promptAndExtractTextMock.mock.calls[0]?.[1]).toBe("Base prompt");

		const sessionOptions = createAgentSessionMock.mock.calls[0]?.[0] as any;
		const appended = sessionOptions.resourceLoader.getAppendSystemPrompt();
		expect(appended).toContain("base-system-context");
		expect(appended.join("\n")).toContain("Persona reasoning frame (persistent across this session):");
		expect(appended.join("\n")).toContain("Contrarian strategist");
	});

	it("preserves behavior when persona is absent", async () => {
		const handler = makeHandler();
		const node = {
			id: "blue",
			attrs: {
				type: "agent.kw",
				prompt: "Base prompt only",
			},
		} as any;

		const outcome = await handler.execute(new AbortController().signal, node, new Context(), "");

		expect(outcome.status).toBe(StageStatus.Completed);
		expect(promptAndExtractTextMock.mock.calls[0]?.[1]).toBe("Base prompt only");

		const sessionOptions = createAgentSessionMock.mock.calls[0]?.[0] as any;
		const appended = sessionOptions.resourceLoader.getAppendSystemPrompt();
		expect(appended).toEqual(["base-system-context"]);
	});

	it("reuses one cached session when session_id and persona stay stable", async () => {
		const handler = makeHandler();
		const node = {
			id: "strategist",
			attrs: {
				type: "agent.kw",
				session_id: "red_strategist",
				prompt: "Round prompt",
				persona: "Stable frame",
			},
		} as any;

		const ctx = new Context();
		const first = await handler.execute(new AbortController().signal, node, ctx, "");
		const second = await handler.execute(new AbortController().signal, node, ctx, "");

		expect(first.status).toBe(StageStatus.Completed);
		expect(second.status).toBe(StageStatus.Completed);
		expect(createAgentSessionMock).toHaveBeenCalledTimes(1);
		expect(promptAndExtractTextMock).toHaveBeenCalledTimes(2);
	});

	it("recreates cached session when persona changes for the same session_id", async () => {
		const firstSession = makeSession();
		const secondSession = makeSession();
		createAgentSessionMock
			.mockResolvedValueOnce({ session: firstSession })
			.mockResolvedValueOnce({ session: secondSession });

		const handler = makeHandler();
		const ctx = new Context();

		const firstNode = {
			id: "red",
			attrs: {
				type: "agent.kw",
				session_id: "red_strategist",
				prompt: "Round 1",
				persona: "Frame A",
			},
		} as any;
		const secondNode = {
			id: "red",
			attrs: {
				type: "agent.kw",
				session_id: "red_strategist",
				prompt: "Round 2",
				persona: "Frame B",
			},
		} as any;

		const first = await handler.execute(new AbortController().signal, firstNode, ctx, "");
		const second = await handler.execute(new AbortController().signal, secondNode, ctx, "");

		expect(first.status).toBe(StageStatus.Completed);
		expect(second.status).toBe(StageStatus.Completed);
		expect(createAgentSessionMock).toHaveBeenCalledTimes(2);
		expect(firstSession.dispose).toHaveBeenCalledTimes(1);
	});
});
