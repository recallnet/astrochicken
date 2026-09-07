import { join } from "node:path";

import { describe, it, expect, beforeEach, vi } from "vitest";

const {
	createAgentSessionMock,
	createCodingToolsMock,
	sessionManagerMock,
	settingsManagerMock,
	promptAndExtractTextMock,
	bindLangfuseSessionTelemetryMock,
} = vi.hoisted(() => ({
	createAgentSessionMock: vi.fn(),
	createCodingToolsMock: vi.fn(() => []),
	sessionManagerMock: {
		create: vi.fn((_cwd: string, dir: string) => ({ kind: "persistent", dir })),
		inMemory: vi.fn(() => ({ kind: "in-memory" })),
	},
	settingsManagerMock: {
		inMemory: vi.fn(() => ({ kind: "settings" })),
	},
	promptAndExtractTextMock: vi.fn(async () => "manager output"),
	bindLangfuseSessionTelemetryMock: vi.fn(() => vi.fn()),
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

vi.mock("@recallnet/factory-telemetry", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@recallnet/factory-telemetry")>();
	return {
		...actual,
		bindLangfuseSessionTelemetry: bindLangfuseSessionTelemetryMock,
		computeLangfusePromptHash: vi.fn(() => "prompt-hash"),
		emitLangfuseGenerationEvent: vi.fn(),
		nextLangfuseAttemptIndex: vi.fn(() => 1),
		recordLangfuseSessionContext: vi.fn(),
		usageFromAssistantMessage: vi.fn(() => undefined),
	};
});

import { Context, StageStatus } from "../context.js";
import { ManagerLoopHandler } from "./manager.js";
import { sanitizeSessionPath } from "./session-persistence.js";

function makeHandler() {
	return new ManagerLoopHandler({
		modelRegistry: { find: vi.fn(() => ({ id: "mock-model" })) } as any,
		authStorage: {} as any,
		resourceLoader: {} as any,
		defaultModel: "claude-sonnet-4-6",
		defaultProvider: "anthropic",
		workDir: ".",
	} as any);
}

function makeNode(overrides: Record<string, string> = {}) {
	return {
		id: "resolve_conflict",
		attrs: {
			type: "stack.manager_loop",
			prompt: "Investigate and resolve",
			...overrides,
		},
	} as any;
}

function makeSession() {
	return {
		messages: [
			{
				role: "assistant",
				content: [{ type: "text", text: "done" }],
				stopReason: "stop",
			},
		],
	};
}

describe("ManagerLoopHandler session persistence", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createAgentSessionMock.mockResolvedValue({ session: makeSession() });
	});

	it("uses SessionManager.create when __run_sessions_dir is present", async () => {
		const handler = makeHandler();
		const runSessionsDir = "/tmp/hatch/runs/run-1/sessions";
		const outcome = await handler.execute(
			new AbortController().signal,
			makeNode(),
			new Context({ __run_sessions_dir: runSessionsDir }),
			"",
		);

		expect(outcome.status).toBe(StageStatus.Completed);
		expect(sessionManagerMock.create).toHaveBeenCalledWith(
			".",
			join(runSessionsDir, "resolve_conflict"),
		);
		expect(sessionManagerMock.inMemory).not.toHaveBeenCalled();
	});

	it("falls back to SessionManager.inMemory when __run_sessions_dir is absent", async () => {
		const handler = makeHandler();
		const outcome = await handler.execute(
			new AbortController().signal,
			makeNode(),
			new Context({}),
			"",
		);

		expect(outcome.status).toBe(StageStatus.Completed);
		expect(sessionManagerMock.inMemory).toHaveBeenCalled();
		expect(sessionManagerMock.create).not.toHaveBeenCalled();
	});

	// @context:regression !critical The manager handler must enforce the timeout
	// attribute from the DOT node. Without this, merge conflict resolver agents run
	// indefinitely (hours) burning execution slots. refs: example-trading #1936, #1798.
	it("fails with timeout error when node.attrs.timeout is exceeded", async () => {
		const handler = makeHandler();
		const node = makeNode({ timeout: "50ms" });

		// Make promptAndExtractText hang for longer than the timeout
		promptAndExtractTextMock.mockImplementationOnce(
			() => new Promise((resolve) => setTimeout(() => resolve("late"), 5000)),
		);

		const outcome = await handler.execute(
			new AbortController().signal,
			node,
			new Context({}),
			"",
		);

		expect(outcome.status).toBe(StageStatus.Failed);
		expect(outcome.error).toMatch(/timed out/i);
	});

	it("completes normally when execution finishes before timeout", async () => {
		const handler = makeHandler();
		const node = makeNode({ timeout: "10s" });

		const outcome = await handler.execute(
			new AbortController().signal,
			node,
			new Context({}),
			"",
		);

		expect(outcome.status).toBe(StageStatus.Completed);
	});

	it("sanitizes session keys before creating persistent session directories", async () => {
		const handler = makeHandler();
		const runSessionsDir = "/tmp/hatch/runs/run-2/sessions";
		const node = makeNode({ session_id: "resolve/conflict#1" });

		await handler.execute(
			new AbortController().signal,
			node,
			new Context({ __run_sessions_dir: runSessionsDir }),
			"",
		);

		expect(sessionManagerMock.create).toHaveBeenCalledWith(
			".",
			join(runSessionsDir, sanitizeSessionPath("resolve/conflict#1")),
		);
	});
});
