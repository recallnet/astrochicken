export interface SessionLike {
	prompt: (prompt: string) => Promise<void>;
	compact?: () => Promise<unknown>;
	messages: any[];
}

/**
 * Extract text from the last assistant message.
 * Returns "" if the last assistant message has no text content (e.g. tool_use only).
 */
export function extractLastAssistantText(messages: any[]): string {
	const msg = getLastAssistantMessage(messages);
	if (!msg) return "";
	if (typeof msg.content === "string") return msg.content;
	if (!Array.isArray(msg.content)) return "";
	for (const part of msg.content) {
		if (part?.type === "text" && part.text) return String(part.text);
	}
	return "";
}

/**
 * Run a prompt, extract the last assistant text, and nudge once if the LLM
 * ended on a tool call without producing text output.
 *
 * This fixes the decompose bug where the LLM explores code via tool calls
 * then ends its turn on a tool_use block, leaving the JSON output undelivered.
 */
export async function promptAndExtractText(
	session: SessionLike,
	prompt: string,
	label: string,
): Promise<string> {
	await promptWithLengthCompactionRetry(session, prompt, label);
	const text = extractLastAssistantText(session.messages);
	if (text) return text;

	// LLM ended on a tool call without text — nudge it to emit output.
	console.log(`    [${label}] last assistant message has no text; nudging LLM to emit output`);
	await session.prompt("You ended your response with a tool call but did not return your final output. Return your final output now as text.");
	const nudgedText = extractLastAssistantText(session.messages);
	if (nudgedText) return nudgedText;
	throw new Error(`${label}: LLM session produced no text output after completion nudge`);
}

function getLastAssistantMessage(messages: any[]): any | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg?.role === "assistant") return msg;
	}
	return undefined;
}

function terminalMessageError(lastMsg: any): string | undefined {
	if (!lastMsg) return "LLM session produced no assistant message";
	if (lastMsg.stopReason === "error" || lastMsg.errorMessage) {
		return lastMsg.errorMessage || "LLM session ended with error";
	}
	if (lastMsg.stopReason === "aborted") {
		return "LLM session was aborted";
	}
	if (lastMsg.stopReason === "length") {
		return "LLM session ended due to length/context limit";
	}
	return undefined;
}

/**
 * Run a prompt and recover once from stopReason=length by compacting and retrying.
 * Throws when terminal assistant state is not usable.
 */
export async function promptWithLengthCompactionRetry(
	session: SessionLike,
	prompt: string,
	label: string,
): Promise<void> {
	await session.prompt(prompt);
	let lastMsg = getLastAssistantMessage(session.messages);
	if (lastMsg?.stopReason === "length") {
		if (typeof session.compact !== "function") {
			throw new Error(`${label}: LLM session ended due to length/context limit (no compaction available)`);
		}
		console.log(`    [${label}] stopReason=length; compacting session and retrying prompt once`);
		await session.compact();
		await session.prompt(prompt);
		lastMsg = getLastAssistantMessage(session.messages);
	}

	const terminalError = terminalMessageError(lastMsg);
	if (terminalError) throw new Error(`${label}: ${terminalError}`);
}
