export const COMPOSITE_CHILD_FAILED_REASON = "child_failed" as const;
export const COMPOSITE_CHILD_TIMEOUT_REASON = "child_timeout" as const;
export const COMPOSITE_CHILD_ABORTED_REASON = "child_aborted" as const;

export type CompositeChildFailureReason =
	| typeof COMPOSITE_CHILD_FAILED_REASON
	| typeof COMPOSITE_CHILD_TIMEOUT_REASON
	| typeof COMPOSITE_CHILD_ABORTED_REASON;

export interface CompositeChildIdentity {
	childId: string;
	nodeId: string;
	runId: string;
}

export interface CompositeFailureDetails {
	reason: CompositeChildFailureReason;
	child: CompositeChildIdentity;
	message: string;
}

export interface CompositeExportWriteback {
	status: "pending" | "applied" | "skipped";
	reason: string;
}

export interface CompositeFailureClassificationInput {
	error: unknown;
	signal?: AbortSignal;
	childId?: string;
	childNodeId?: string;
	childRunId?: string;
	timeoutTriggered?: boolean;
	abortTriggered?: boolean;
}

export interface CompositeFailureSignals {
	timeoutTriggered: boolean;
	abortTriggered: boolean;
}

export interface CompositeIndexedExportValidationResult {
	ok: boolean;
	error?: string;
	offendingKey?: string;
}

const COMPOSITE_INDEXED_EXPORT_KEY_PATTERN = /^(?<base>.+)__(?<index>\d+)$/;

export const COMPOSITE_FAILURE_CONTEXT_KEYS = {
	reason: "__composite_reason",
	childId: "__composite_child_id",
	childNodeId: "__composite_child_node_id",
	childRunId: "__composite_child_run_id",
	exportWritebackStatus: "__composite_export_writeback_status",
	exportWritebackReason: "__composite_export_writeback_reason",
} as const;

/**
 * Canonical composite-handler contract shared by pipeline/fan_out.dynamic/future
 * concurrency handlers:
 *
 * 1. Child failure handling:
 *    Any child failure makes the composite parent fail with reason=child_failed,
 *    unless timeout/abort classification overrides it.
 * 2. Timeout handling:
 *    A child timeout is always normalized to reason=child_timeout.
 * 3. External abort propagation:
 *    A parent abort signal propagates to children and is normalized to
 *    reason=child_aborted unless timeout classification already applies.
 * 4. Immutable parent-snapshot inheritance:
 *    A concurrent composite captures parent context once before launching
 *    children, and every child reads from that same immutable snapshot.
 * 5. Child-local export isolation:
 *    Child exports stay local while siblings are running; parent visibility
 *    happens only via composite Outcome.contextUpdates.
 * 6. Deterministic export aggregation:
 *    Aggregated export keys must use `${key}__${index}` and preserve canonical
 *    order by input index (then export key lexical order).
 */
export function classifyCompositeFailure(input: CompositeFailureClassificationInput): CompositeFailureDetails {
	const message = errorMessage(input.error);
	const explicitTimeout = typeof input.timeoutTriggered === "boolean" ? input.timeoutTriggered : null;
	const explicitAbort = typeof input.abortTriggered === "boolean" ? input.abortTriggered : null;
	const timeout = explicitTimeout ?? looksLikeTimeout(message);
	const aborted = explicitAbort ?? (Boolean(input.signal?.aborted) || looksLikeAbort(message));

	let reason: CompositeChildFailureReason = COMPOSITE_CHILD_FAILED_REASON;
	if (timeout) reason = COMPOSITE_CHILD_TIMEOUT_REASON;
	else if (aborted) reason = COMPOSITE_CHILD_ABORTED_REASON;

	return {
		reason,
		child: {
			childId: String(input.childId || ""),
			nodeId: String(input.childNodeId || ""),
			runId: String(input.childRunId || ""),
		},
		message,
	};
}

export function normalizeCompositeFailureReason(value: unknown): CompositeChildFailureReason | "" {
	const raw = String(value || "").trim();
	if (raw === COMPOSITE_CHILD_FAILED_REASON) return COMPOSITE_CHILD_FAILED_REASON;
	if (raw === COMPOSITE_CHILD_TIMEOUT_REASON) return COMPOSITE_CHILD_TIMEOUT_REASON;
	if (raw === COMPOSITE_CHILD_ABORTED_REASON) return COMPOSITE_CHILD_ABORTED_REASON;
	return "";
}

export function buildCompositeFailureContextUpdates(details: CompositeFailureDetails): Record<string, string> {
	return {
		[COMPOSITE_FAILURE_CONTEXT_KEYS.reason]: details.reason,
		[COMPOSITE_FAILURE_CONTEXT_KEYS.childId]: details.child.childId,
		[COMPOSITE_FAILURE_CONTEXT_KEYS.childNodeId]: details.child.nodeId,
		[COMPOSITE_FAILURE_CONTEXT_KEYS.childRunId]: details.child.runId,
	};
}

export function buildCompositeExportWritebackContextUpdates(writeback: CompositeExportWriteback): Record<string, string> {
	return {
		[COMPOSITE_FAILURE_CONTEXT_KEYS.exportWritebackStatus]: writeback.status,
		[COMPOSITE_FAILURE_CONTEXT_KEYS.exportWritebackReason]: writeback.reason,
	};
}

export function readCompositeFailureFromContextUpdates(
	contextUpdates: Record<string, string> | undefined,
): CompositeFailureDetails | null {
	if (!contextUpdates) return null;
	const reason = normalizeCompositeFailureReason(contextUpdates[COMPOSITE_FAILURE_CONTEXT_KEYS.reason]);
	if (!reason) return null;
	return {
		reason,
		child: {
			childId: String(contextUpdates[COMPOSITE_FAILURE_CONTEXT_KEYS.childId] || ""),
			nodeId: String(contextUpdates[COMPOSITE_FAILURE_CONTEXT_KEYS.childNodeId] || ""),
			runId: String(contextUpdates[COMPOSITE_FAILURE_CONTEXT_KEYS.childRunId] || ""),
		},
		message: "",
	};
}

export function formatCompositeFailureError(prefix: string, details: CompositeFailureDetails): string {
	const childId = details.child.childId || "?";
	const childNodeId = details.child.nodeId || "?";
	const childRunId = details.child.runId || "?";
	const base = `${prefix}: reason=${details.reason} child_id=${childId} child_node=${childNodeId} child_run=${childRunId}`;
	if (!details.message) return base;
	return `${base}; ${details.message}`;
}

/**
 * Validate deterministic indexed export ordering for aggregated composite
 * Outcome.contextUpdates payloads. All keys must follow `${key}__${index}` and
 * appear in canonical order (input index asc, then key asc).
 */
export function validateCompositeIndexedExportOrdering(
	contextUpdates: Record<string, string> | undefined,
): CompositeIndexedExportValidationResult {
	if (!contextUpdates) return { ok: true };
	const keys = Object.keys(contextUpdates);
	if (keys.length === 0) return { ok: true };

	const parsed = keys.map((key) => {
		const match = COMPOSITE_INDEXED_EXPORT_KEY_PATTERN.exec(key);
		if (!match?.groups) {
			return {
				key,
				base: "",
				index: Number.NaN,
				valid: false,
			};
		}
		const base = String(match.groups.base || "").trim();
		const index = Number.parseInt(match.groups.index || "", 10);
		if (!base || !Number.isFinite(index) || index < 0) {
			return {
				key,
				base,
				index,
				valid: false,
			};
		}
		return {
			key,
			base,
			index,
			valid: true,
		};
	});

	const invalid = parsed.find((entry) => !entry.valid);
	if (invalid) {
		return {
			ok: false,
			error: `composite export key must match <key>__<index>; got "${invalid.key}"`,
			offendingKey: invalid.key,
		};
	}

	const canonical = [...parsed]
		.sort((left, right) => {
			if (left.index !== right.index) return left.index - right.index;
			if (left.base !== right.base) return left.base.localeCompare(right.base);
			return left.key.localeCompare(right.key);
		})
		.map((entry) => entry.key);

	for (let i = 0; i < keys.length; i += 1) {
		if (keys[i] === canonical[i]) continue;
		return {
			ok: false,
			error: `composite export keys must be canonical by input index then key; expected "${canonical[i]}" at position ${i}, got "${keys[i]}"`,
			offendingKey: keys[i],
		};
	}

	return { ok: true };
}

export function resolveCompositeFailureSignals(error: unknown, signal?: AbortSignal): CompositeFailureSignals {
	const explicit = readCompositeFailureSignals(error);
	if (explicit) return explicit;
	return {
		timeoutTriggered: false,
		abortTriggered: Boolean(signal?.aborted),
	};
}

function readCompositeFailureSignals(error: unknown): CompositeFailureSignals | null {
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
	return readCompositeFailureSignals(row.cause);
}

function errorMessage(value: unknown): string {
	if (value instanceof Error) return value.message || String(value);
	if (typeof value === "string") return value;
	if (value == null) return "";
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function looksLikeTimeout(message: string): boolean {
	const lowered = String(message || "").toLowerCase();
	return lowered.includes("timed out") || lowered.includes("timeout");
}

function looksLikeAbort(message: string): boolean {
	const lowered = String(message || "").toLowerCase();
	return lowered.includes("aborted") || lowered.includes("abort");
}
