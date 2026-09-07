import { describe, it, expect } from "vitest";
import { ThreadStore, type ThreadMessage } from "./threads.js";

function msg(role: "user" | "assistant", content: string): ThreadMessage {
	return { role, content };
}

describe("ThreadStore", () => {
	describe("basic operations", () => {
		it("getMessages returns empty array for unknown thread", () => {
			const store = new ThreadStore();
			expect(store.getMessages("unknown")).toEqual([]);
		});

		it("addMessage creates thread and stores message", () => {
			const store = new ThreadStore();
			store.addMessage("t1", msg("user", "hello"));
			expect(store.getMessages("t1")).toEqual([msg("user", "hello")]);
		});

		it("addMessage appends to existing thread", () => {
			const store = new ThreadStore();
			store.addMessage("t1", msg("user", "hello"));
			store.addMessage("t1", msg("assistant", "hi"));
			expect(store.getMessages("t1")).toEqual([
				msg("user", "hello"),
				msg("assistant", "hi"),
			]);
		});

		it("has returns false for unknown, true for known", () => {
			const store = new ThreadStore();
			expect(store.has("t1")).toBe(false);
			store.addMessage("t1", msg("user", "hello"));
			expect(store.has("t1")).toBe(true);
		});

		it("threadIds returns all thread IDs", () => {
			const store = new ThreadStore();
			store.addMessage("a", msg("user", "1"));
			store.addMessage("b", msg("user", "2"));
			store.addMessage("c", msg("user", "3"));
			expect(store.threadIds()).toEqual(["a", "b", "c"]);
		});

		it("multiple threads are independent", () => {
			const store = new ThreadStore();
			store.addMessage("t1", msg("user", "one"));
			store.addMessage("t2", msg("user", "two"));
			expect(store.getMessages("t1")).toEqual([msg("user", "one")]);
			expect(store.getMessages("t2")).toEqual([msg("user", "two")]);
		});
	});

	describe('buildContext fidelity="full"', () => {
		it("empty thread returns empty string", () => {
			const store = new ThreadStore();
			expect(store.buildContext("none", "full")).toBe("");
		});

		it("single message formats as [role]: content", () => {
			const store = new ThreadStore();
			store.addMessage("t1", msg("user", "hello"));
			expect(store.buildContext("t1", "full")).toBe("[user]: hello");
		});

		it("multiple messages joined with double newline", () => {
			const store = new ThreadStore();
			store.addMessage("t1", msg("user", "hello"));
			store.addMessage("t1", msg("assistant", "hi"));
			expect(store.buildContext("t1", "full")).toBe(
				"[user]: hello\n\n[assistant]: hi",
			);
		});
	});

	describe('buildContext fidelity="truncate"', () => {
		it("includes all messages when <=10", () => {
			const store = new ThreadStore();
			for (let i = 0; i < 10; i++) {
				store.addMessage("t1", msg("user", `msg${i}`));
			}
			const ctx = store.buildContext("t1", "truncate");
			expect(ctx).toContain("[user]: msg0");
			expect(ctx).toContain("[user]: msg9");
		});

		it("only last 10 messages when >10", () => {
			const store = new ThreadStore();
			for (let i = 0; i < 15; i++) {
				store.addMessage("t1", msg("user", `msg${i}`));
			}
			const ctx = store.buildContext("t1", "truncate");
			expect(ctx).not.toContain("[user]: msg4");
			expect(ctx).toContain("[user]: msg5");
			expect(ctx).toContain("[user]: msg14");
		});
	});

	describe('buildContext fidelity="compact"', () => {
		it("includes all messages when <=7", () => {
			const store = new ThreadStore();
			for (let i = 0; i < 7; i++) {
				store.addMessage("t1", msg("user", `msg${i}`));
			}
			const ctx = store.buildContext("t1", "compact");
			expect(ctx).not.toContain("omitted");
			for (let i = 0; i < 7; i++) {
				expect(ctx).toContain(`[user]: msg${i}`);
			}
		});

		it("first message + omission notice + last 6 when >7", () => {
			const store = new ThreadStore();
			for (let i = 0; i < 12; i++) {
				store.addMessage("t1", msg("user", `msg${i}`));
			}
			const ctx = store.buildContext("t1", "compact");
			expect(ctx).toContain("[user]: msg0");
			expect(ctx).toContain("[... 5 messages omitted ...]");
			expect(ctx).toContain("[user]: msg6");
			expect(ctx).toContain("[user]: msg11");
			// Omitted messages should not appear
			expect(ctx).not.toContain("[user]: msg1\n");
		});

		it("omission notice shows correct count", () => {
			const store = new ThreadStore();
			for (let i = 0; i < 20; i++) {
				store.addMessage("t1", msg("user", `m${i}`));
			}
			const ctx = store.buildContext("t1", "compact");
			// 20 total - 7 (first + last 6) = 13 omitted
			expect(ctx).toContain("[... 13 messages omitted ...]");
		});
	});

	describe('buildContext fidelity="summary:medium"', () => {
		it("uses summarized wording for >7 messages", () => {
			const store = new ThreadStore();
			for (let i = 0; i < 12; i++) {
				store.addMessage("t1", msg("user", `msg${i}`));
			}
			const ctx = store.buildContext("t1", "summary:medium");
			expect(ctx).toContain("[user]: msg0");
			expect(ctx).toContain(
				"[... 5 earlier messages summarized ...]",
			);
			expect(ctx).toContain("[user]: msg11");
		});

		it("no notice when <=7 messages", () => {
			const store = new ThreadStore();
			for (let i = 0; i < 7; i++) {
				store.addMessage("t1", msg("user", `msg${i}`));
			}
			const ctx = store.buildContext("t1", "summary:medium");
			expect(ctx).not.toContain("summarized");
		});
	});

	describe("buildContext with unknown fidelity", () => {
		it("falls back to full format", () => {
			const store = new ThreadStore();
			store.addMessage("t1", msg("user", "hello"));
			store.addMessage("t1", msg("assistant", "hi"));
			expect(store.buildContext("t1", "whatever")).toBe(
				"[user]: hello\n\n[assistant]: hi",
			);
		});
	});
});
