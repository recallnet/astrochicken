import { vi, type Mock } from "vitest";

const {
	createAgentSessionMock,
	createReadOnlyToolsMock,
	sessionManagerMock,
	settingsManagerMock,
	promptAndExtractTextMock,
	bindLangfuseSessionTelemetryMock,
	emitLangfuseGenerationEventMock,
}: {
	createAgentSessionMock: Mock;
	createReadOnlyToolsMock: Mock<() => never[]>;
	sessionManagerMock: { inMemory: Mock<() => { kind: string }> };
	settingsManagerMock: { inMemory: Mock<() => { kind: string }> };
	promptAndExtractTextMock: Mock;
	bindLangfuseSessionTelemetryMock: Mock<() => Mock>;
	emitLangfuseGenerationEventMock: Mock;
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

vi.mock("../handler/session-completion.js", () => ({
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

import { CodergenHandler } from "../handler/codergen.js";

export function makeHandler() {
	return new CodergenHandler({
		modelRegistry: { find: vi.fn(() => ({ id: "mock-model" })) } as any,
		authStorage: {} as any,
		resourceLoader: {} as any,
		defaultModel: "claude-sonnet-4-6",
		defaultProvider: "anthropic",
	} as any);
}

export { createAgentSessionMock, createReadOnlyToolsMock, sessionManagerMock, settingsManagerMock, promptAndExtractTextMock, bindLangfuseSessionTelemetryMock };
