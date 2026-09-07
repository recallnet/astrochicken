import { describe, expect, it } from "vitest";

import { promptWithLengthCompactionRetry, extractLastAssistantText, type SessionLike } from "./session-completion.js";

function mockSession(messageSets: any[][]): SessionLike & { compactCalls: number; promptCalls: number } {
	let idx = -1;
	const session: any = {
		messages: [] as any[],
		compactCalls: 0,
		promptCalls: 0,
		async prompt() {
			this.promptCalls++;
			idx++;
			this.messages = messageSets[Math.min(idx, messageSets.length - 1)] ?? [];
		},
		async compact() {
			this.compactCalls++;
		},
	};
	return session;
}

describe("promptWithLengthCompactionRetry", () => {
	it("compacts and retries once on stopReason=length", async () => {
		const session = mockSession([
			[{ role: "assistant", content: [], stopReason: "length" }],
			[{ role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop" }],
		]);

		await promptWithLengthCompactionRetry(session, "do thing", "test");

		expect(session.compactCalls).toBe(1);
		expect(session.promptCalls).toBe(2);
	});

	it("fails when length repeats after retry", async () => {
		const session = mockSession([
			[{ role: "assistant", content: [], stopReason: "length" }],
			[{ role: "assistant", content: [], stopReason: "length" }],
		]);

		await expect(promptWithLengthCompactionRetry(session, "do thing", "test")).rejects.toThrow(
			"test: LLM session ended due to length/context limit",
		);
	});

	it("fails on stopReason=error", async () => {
		const session = mockSession([
			[{ role: "assistant", content: [], stopReason: "error", errorMessage: "boom" }],
		]);

		await expect(promptWithLengthCompactionRetry(session, "do thing", "test")).rejects.toThrow(
			"test: boom",
		);
	});
});

describe("extractLastAssistantText", () => {
	it("returns text from last assistant message when it has text content", () => {
		const messages = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: [{ type: "text", text: '[{"id":"F-1"}]' }], stopReason: "stop" },
		];
		expect(extractLastAssistantText(messages)).toBe('[{"id":"F-1"}]');
	});

	it("returns text from last assistant message when content is a plain string", () => {
		const messages = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "plain string output", stopReason: "stop" },
		];
		expect(extractLastAssistantText(messages)).toBe("plain string output");
	});

	it("returns text when last assistant has mixed text and tool_use blocks", () => {
		const messages = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: [
				{ type: "text", text: "here is the result" },
				{ type: "tool_use", id: "t1", name: "read", input: { path: "foo.ts" } },
			], stopReason: "stop" },
		];
		expect(extractLastAssistantText(messages)).toBe("here is the result");
	});

	it("nudges when last assistant message is tool_use only (the decompose bug)", async () => {
		// This is the actual bug: LLM explored code, ended on a tool call,
		// and the JSON output is lost. The handler should nudge the LLM to emit output.
		const toolOnlyMessages = [
			{ role: "user", content: "decompose this goal" },
			{ role: "assistant", content: [{ type: "text", text: '[{"id":"F-1","name":"Real feature"}]' }], stopReason: "stop" },
			{ role: "user", content: "tool result" },
			{ role: "assistant", content: [
				{ type: "tool_use", id: "t1", name: "bash", input: { command: "ls" } },
			], stopReason: "stop" },
		];
		// Without nudge, this would return "" — the bug.
		// extractLastAssistantText is sync and doesn't nudge, but the handler
		// uses promptAndExtractText which does the nudge. So extractLastAssistantText
		// should still return "" for this case (it's the caller's job to nudge).
		expect(extractLastAssistantText(toolOnlyMessages)).toBe("");
	});

	it("returns empty string when no assistant messages exist", () => {
		expect(extractLastAssistantText([])).toBe("");
		expect(extractLastAssistantText([{ role: "user", content: "hello" }])).toBe("");
	});

	it("returns empty string when last assistant has empty content array", () => {
		const messages = [
			{ role: "assistant", content: [], stopReason: "stop" },
		];
		expect(extractLastAssistantText(messages)).toBe("");
	});
});

describe("promptAndExtractText", () => {
	it("returns text directly when last assistant message has text", async () => {
		const session = mockSession([
			[
				{ role: "user", content: "do thing" },
				{ role: "assistant", content: [{ type: "text", text: '[{"id":"F-1"}]' }], stopReason: "stop" },
			],
		]);

		const { promptAndExtractText } = await import("./session-completion.js");
		const result = await promptAndExtractText(session, "do thing", "test");
		expect(result).toBe('[{"id":"F-1"}]');
		expect(session.promptCalls).toBe(1);
	});

	it("nudges LLM when last assistant message has no text (the decompose bug)", async () => {
		const session = mockSession([
			// First prompt: LLM ends on tool_use, no text
			[
				{ role: "user", content: "decompose this goal" },
				{ role: "assistant", content: [
					{ type: "tool_use", id: "t1", name: "bash", input: { command: "ls" } },
				], stopReason: "stop" },
			],
			// Nudge prompt: LLM returns the JSON
			[
				{ role: "user", content: "decompose this goal" },
				{ role: "assistant", content: [
					{ type: "tool_use", id: "t1", name: "bash", input: { command: "ls" } },
				], stopReason: "stop" },
				{ role: "user", content: "nudge" },
				{ role: "assistant", content: [{ type: "text", text: '[{"id":"F-1","name":"Real feature"}]' }], stopReason: "stop" },
			],
		]);

		const { promptAndExtractText } = await import("./session-completion.js");
		const result = await promptAndExtractText(session, "decompose this goal", "test");
		expect(result).toBe('[{"id":"F-1","name":"Real feature"}]');
		expect(session.promptCalls).toBe(2); // original + nudge
	});

	it("returns empty string when nudge also produces no text", async () => {
		const session = mockSession([
			// First prompt: no text
			[{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "bash", input: {} }], stopReason: "stop" }],
			// Nudge: still no text
			[{ role: "assistant", content: [{ type: "tool_use", id: "t2", name: "bash", input: {} }], stopReason: "stop" }],
		]);

		const { promptAndExtractText } = await import("./session-completion.js");
		await expect(promptAndExtractText(session, "do thing", "test")).rejects.toThrow(
			"test: LLM session produced no text output after completion nudge",
		);
		expect(session.promptCalls).toBe(2);
	});
});
