export interface ExecutionFailureSignals {
	timeoutTriggered: boolean;
	abortTriggered: boolean;
}

export function createAbortCauseError(nodeId: string, timeoutMs: number, signals: ExecutionFailureSignals): Error {
	const message = signals.timeoutTriggered
		? `node "${nodeId}" timed out after ${timeoutMs}ms`
		: `node "${nodeId}" aborted`;
	return attachExecutionFailureSignals(new Error(message), signals);
}

export function attachExecutionFailureSignals(error: Error, signals: ExecutionFailureSignals): Error {
	const tagged = error as Error & { timeoutTriggered?: boolean; abortTriggered?: boolean };
	tagged.timeoutTriggered = signals.timeoutTriggered;
	tagged.abortTriggered = signals.abortTriggered;
	return error;
}

export function extractExecutionFailureSignals(error: unknown): ExecutionFailureSignals | null {
	if (!error || typeof error !== "object") return null;
	const row = error as Record<string, unknown>;
	const timeout = typeof row.timeoutTriggered === "boolean" ? row.timeoutTriggered : null;
	const abort = typeof row.abortTriggered === "boolean" ? row.abortTriggered : null;
	if (timeout !== null || abort !== null) {
		return {
			timeoutTriggered: timeout === true,
			abortTriggered: abort === true,
		};
	}
	return extractExecutionFailureSignals(row.cause);
}
