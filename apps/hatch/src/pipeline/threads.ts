/**
 * ThreadStore manages persistent conversation sessions across pipeline nodes.
 *
 * When multiple nodes share the same thread_id, they contribute to a
 * continuous conversation. The ThreadStore holds the session messages
 * in memory for the duration of the pipeline run.
 */

/** A thread is a sequence of messages. */
export interface ThreadMessage {
	role: "user" | "assistant";
	content: string;
}

/** ThreadStore holds thread state in memory during a pipeline run. */
export class ThreadStore {
	private threads = new Map<string, ThreadMessage[]>();

	/** Get messages for a thread (returns empty array if new). */
	getMessages(threadId: string): ThreadMessage[] {
		return this.threads.get(threadId) ?? [];
	}

	/** Append a message to a thread. */
	addMessage(threadId: string, msg: ThreadMessage): void {
		if (!this.threads.has(threadId)) {
			this.threads.set(threadId, []);
		}
		this.threads.get(threadId)!.push(msg);
	}

	/** Check if a thread exists. */
	has(threadId: string): boolean {
		return this.threads.has(threadId);
	}

	/** Get all thread IDs. */
	threadIds(): string[] {
		return Array.from(this.threads.keys());
	}

	/** Build a context string from thread history for injection into prompts. */
	buildContext(threadId: string, fidelity: string): string {
		const messages = this.getMessages(threadId);
		if (messages.length === 0) return "";

		switch (fidelity) {
			case "full":
				return messages.map((m) => `[${m.role}]: ${m.content}`).join("\n\n");

			case "truncate": {
				// Keep last 5 exchanges
				const recent = messages.slice(-10);
				return recent.map((m) => `[${m.role}]: ${m.content}`).join("\n\n");
			}

			case "compact": {
				// Keep first message + last 3 exchanges
				const first = messages[0];
				const recent = messages.slice(-6);
				const parts = [first, ...recent].map((m) => `[${m.role}]: ${m.content}`);
				if (messages.length > 7) {
					parts.splice(1, 0, `[... ${messages.length - 7} messages omitted ...]`);
				}
				return parts.join("\n\n");
			}

			default:
				// summary:low, summary:medium, summary:high — for now treat as compact
				// (full summarization would require an LLM call)
				if (fidelity.startsWith("summary:")) {
					const first = messages[0];
					const recent = messages.slice(-6);
					const parts = [first, ...recent].map((m) => `[${m.role}]: ${m.content}`);
					if (messages.length > 7) {
						parts.splice(1, 0, `[... ${messages.length - 7} earlier messages summarized ...]`);
					}
					return parts.join("\n\n");
				}
				return messages.map((m) => `[${m.role}]: ${m.content}`).join("\n\n");
		}
	}
}
