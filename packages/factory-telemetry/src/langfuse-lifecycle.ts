import { EventBus, type Event } from "./events.js";

export interface LifecycleContextStore {
	get(key: string): string;
	set(key: string, value: string): void;
}

export const LANGFUSE_FLUSH_EVENT_KIND = "telemetry.langfuse.flush";
export const LANGFUSE_RETRY_EVENT_KIND = "telemetry.langfuse.retry";

export const LANGFUSE_HEARTBEAT_FLUSH_EVERY_FLAG = "HATCH_LANGFUSE_HEARTBEAT_FLUSH_EVERY";
export const LANGFUSE_FLUSH_TIMEOUT_MS_FLAG = "HATCH_LANGFUSE_FLUSH_TIMEOUT_MS";
export const LANGFUSE_RETRY_TIMEOUT_MS_FLAG = "HATCH_LANGFUSE_RETRY_TIMEOUT_MS";

const DEFAULT_HEARTBEAT_FLUSH_EVERY = 12;
const DEFAULT_FLUSH_TIMEOUT_MS = 1200;
const DEFAULT_RETRY_TIMEOUT_MS = 1200;
const DEFAULT_RETRY_BACKOFF_MS = 1500;
const MAX_RETRY_BACKOFF_MS = 15000;

const RETRY_COUNT_CONTEXT_KEY = "__langfuse_retry_count";
const RETRY_NEXT_AT_CONTEXT_KEY = "__langfuse_retry_next_at";
const LAST_FLUSH_AT_CONTEXT_KEY = "__langfuse_last_flush_at";
const LAST_FLUSH_TRIGGER_CONTEXT_KEY = "__langfuse_last_flush_trigger";
const LAST_FLUSH_ERROR_CONTEXT_KEY = "__langfuse_last_flush_error";

export interface LangfuseFlushRequest {
	runId: string;
	trigger:
		| "heartbeat"
		| "suspend"
		| "finish"
		| "error"
		| "shutdown"
		| "manual"
		| "retry";
	timestamp: string;
	metadata: Record<string, string>;
	timeoutMs: number;
}

export interface LangfuseRetryRequest extends LangfuseFlushRequest {
	retryCount: number;
}

/**
 * Minimal emitter contract used by hatch runtime lifecycle telemetry.
 *
 * Implementations can be backed by a Langfuse client and should honor timeout hints,
 * but hatch always treats calls as best-effort/non-blocking.
 */
export interface LangfuseLifecycleEmitter {
	flush(request: LangfuseFlushRequest): Promise<void>;
	retry(request: LangfuseRetryRequest): Promise<void>;
}

export interface LangfuseLifecycleBinding {
	/** Trigger a flush immediately from trusted runtime hooks (for example SIGTERM shutdown path). */
	flushNow(trigger?: LangfuseFlushRequest["trigger"]): Promise<void>;
	/** Wait for in-flight lifecycle telemetry tasks to settle. */
	waitForIdle(): Promise<void>;
}

export interface BindLangfuseLifecycleTelemetryArgs {
	eventBus?: EventBus;
	ctx: LifecycleContextStore;
	emitter?: LangfuseLifecycleEmitter;
	heartbeatFlushEvery?: number;
	flushTimeoutMs?: number;
	retryTimeoutMs?: number;
	logger?: Pick<Console, "warn">;
	now?: () => Date;
}

let globalEmitter: LangfuseLifecycleEmitter | undefined;

export function setLangfuseLifecycleEmitter(emitter: LangfuseLifecycleEmitter | undefined): void {
	globalEmitter = emitter;
}

export function getLangfuseLifecycleEmitter(): LangfuseLifecycleEmitter | undefined {
	return globalEmitter;
}

export function bindLangfuseLifecycleTelemetry(args: BindLangfuseLifecycleTelemetryArgs): LangfuseLifecycleBinding {
	const bus = args.eventBus;
	const emitter = args.emitter ?? getLangfuseLifecycleEmitter();
	const logger = args.logger ?? console;
	const now = args.now ?? (() => new Date());
	const heartbeatFlushEvery = resolvePositiveInt(
		args.heartbeatFlushEvery,
		LANGFUSE_HEARTBEAT_FLUSH_EVERY_FLAG,
		DEFAULT_HEARTBEAT_FLUSH_EVERY,
	);
	const flushTimeoutMs = resolvePositiveInt(args.flushTimeoutMs, LANGFUSE_FLUSH_TIMEOUT_MS_FLAG, DEFAULT_FLUSH_TIMEOUT_MS);
	const retryTimeoutMs = resolvePositiveInt(args.retryTimeoutMs, LANGFUSE_RETRY_TIMEOUT_MS_FLAG, DEFAULT_RETRY_TIMEOUT_MS);

	if (!bus || !emitter) {
		return {
			flushNow: async () => {},
			waitForIdle: async () => {},
		};
	}

	let heartbeatCount = 0;
	let queue: Promise<void> = Promise.resolve();

	const runIdFromContext = (): string => args.ctx.get("__run_id") || "no_run_id";

	const emitLifecycleEvent = (
		kind: typeof LANGFUSE_FLUSH_EVENT_KIND | typeof LANGFUSE_RETRY_EVENT_KIND,
		trigger: string,
		status: "start" | "ok" | "fail" | "skip",
		errorMessage?: string,
		data?: Record<string, string>,
	): void => {
		bus.emit({
			kind,
			message: trigger,
			data: {
				run_id: runIdFromContext(),
				langfuse_lifecycle_trigger: trigger,
				langfuse_lifecycle_status: status,
				...(errorMessage ? { langfuse_lifecycle_error: errorMessage } : {}),
				...(data ?? {}),
			},
		});
	};

	const markSuccess = (trigger: string, ts: string): void => {
		args.ctx.set(RETRY_COUNT_CONTEXT_KEY, "0");
		args.ctx.set(RETRY_NEXT_AT_CONTEXT_KEY, "0");
		args.ctx.set(LAST_FLUSH_AT_CONTEXT_KEY, ts);
		args.ctx.set(LAST_FLUSH_TRIGGER_CONTEXT_KEY, trigger);
		args.ctx.set(LAST_FLUSH_ERROR_CONTEXT_KEY, "");
	};

	const markFailure = (trigger: string, error: unknown): void => {
		const errorMessage = toErrorMessage(error);
		const retryCount = (parseInt(args.ctx.get(RETRY_COUNT_CONTEXT_KEY) || "0", 10) || 0) + 1;
		const retryBackoffMs = retryBackoffForCount(retryCount);
		const nextRetryAtMs = now().getTime() + retryBackoffMs;
		args.ctx.set(RETRY_COUNT_CONTEXT_KEY, String(retryCount));
		args.ctx.set(RETRY_NEXT_AT_CONTEXT_KEY, String(nextRetryAtMs));
		args.ctx.set(LAST_FLUSH_ERROR_CONTEXT_KEY, errorMessage);
		emitLifecycleEvent(LANGFUSE_RETRY_EVENT_KIND, trigger, "fail", errorMessage, {
			langfuse_retry_count: String(retryCount),
			langfuse_retry_next_at: String(nextRetryAtMs),
			langfuse_retry_backoff_ms: String(retryBackoffMs),
		});
		logger.warn(
			`[langfuse] lifecycle flush failed trigger=${trigger} run=${runIdFromContext()} retry_count=${retryCount} next_retry_at=${new Date(nextRetryAtMs).toISOString()} error=${errorMessage}`,
		);
	};

	const runFlush = async (trigger: LangfuseFlushRequest["trigger"], event?: Event): Promise<void> => {
		const runId = event?.data?.run_id || runIdFromContext();
		const ts = now().toISOString();
		const metadata = {
			...sanitizeEventData(event?.data),
			langfuse_resume_retry_count: args.ctx.get(RETRY_COUNT_CONTEXT_KEY) || "0",
			langfuse_resume_retry_next_at: args.ctx.get(RETRY_NEXT_AT_CONTEXT_KEY) || "0",
		};
		emitLifecycleEvent(LANGFUSE_FLUSH_EVENT_KIND, trigger, "start", undefined, {
			langfuse_flush_timeout_ms: String(flushTimeoutMs),
			langfuse_flush_run_id: runId,
		});
		await withTimeout(
			emitter.flush({
				runId,
				trigger,
				timestamp: ts,
				metadata,
				timeoutMs: flushTimeoutMs,
			}),
			flushTimeoutMs,
			`flush timeout after ${flushTimeoutMs}ms`,
		);
		markSuccess(trigger, ts);
		emitLifecycleEvent(LANGFUSE_FLUSH_EVENT_KIND, trigger, "ok", undefined, {
			langfuse_flush_at: ts,
			langfuse_flush_timeout_ms: String(flushTimeoutMs),
			langfuse_flush_run_id: runId,
			langfuse_flush_retry_count: metadata.langfuse_resume_retry_count,
		});
	};

	const runRetry = async (
		causeTrigger: LangfuseFlushRequest["trigger"],
		event?: Event,
		forced = false,
	): Promise<void> => {
		const retryCount = parseInt(args.ctx.get(RETRY_COUNT_CONTEXT_KEY) || "0", 10) || 0;
		if (retryCount <= 0) return;
		const nextAt = parseInt(args.ctx.get(RETRY_NEXT_AT_CONTEXT_KEY) || "0", 10) || 0;
		const nowMs = now().getTime();
		if (!forced && nextAt > nowMs) {
			emitLifecycleEvent(LANGFUSE_RETRY_EVENT_KIND, causeTrigger, "skip", undefined, {
				langfuse_retry_skip_reason: "backoff_active",
				langfuse_retry_next_at: String(nextAt),
				langfuse_retry_count: String(retryCount),
			});
			return;
		}
		const runId = event?.data?.run_id || runIdFromContext();
		const ts = now().toISOString();
		emitLifecycleEvent(LANGFUSE_RETRY_EVENT_KIND, causeTrigger, "start", undefined, {
			langfuse_retry_count: String(retryCount),
			langfuse_retry_timeout_ms: String(retryTimeoutMs),
			langfuse_retry_run_id: runId,
		});
		try {
			await withTimeout(
				emitter.retry({
					runId,
					trigger: "retry",
					timestamp: ts,
					metadata: {
						...sanitizeEventData(event?.data),
						langfuse_retry_cause: causeTrigger,
						langfuse_retry_count: String(retryCount),
					},
					timeoutMs: retryTimeoutMs,
					retryCount,
				}),
				retryTimeoutMs,
				`retry timeout after ${retryTimeoutMs}ms`,
			);
			markSuccess("retry", ts);
			emitLifecycleEvent(LANGFUSE_RETRY_EVENT_KIND, causeTrigger, "ok", undefined, {
				langfuse_retry_count: String(retryCount),
				langfuse_retry_run_id: runId,
			});
		} catch (error) {
			const errorMessage = toErrorMessage(error);
			const nextRetryCount = retryCount + 1;
			const backoffMs = retryBackoffForCount(nextRetryCount);
			const retryAt = now().getTime() + backoffMs;
			args.ctx.set(RETRY_COUNT_CONTEXT_KEY, String(nextRetryCount));
			args.ctx.set(RETRY_NEXT_AT_CONTEXT_KEY, String(retryAt));
			args.ctx.set(LAST_FLUSH_ERROR_CONTEXT_KEY, errorMessage);
			emitLifecycleEvent(LANGFUSE_RETRY_EVENT_KIND, causeTrigger, "fail", errorMessage, {
				langfuse_retry_count: String(nextRetryCount),
				langfuse_retry_next_at: String(retryAt),
				langfuse_retry_backoff_ms: String(backoffMs),
			});
			logger.warn(
				`[langfuse] lifecycle retry failed trigger=${causeTrigger} run=${runIdFromContext()} retry_count=${nextRetryCount} next_retry_at=${new Date(retryAt).toISOString()} error=${errorMessage}`,
			);
		}
	};

	const enqueue = (op: () => Promise<void>): Promise<void> => {
		queue = queue.then(op, op);
		return queue;
	};

	const triggerFlush = (trigger: LangfuseFlushRequest["trigger"], event?: Event): Promise<void> => {
		return enqueue(async () => {
			await runRetry(trigger, event, false);
			try {
				await runFlush(trigger, event);
			} catch (error) {
				emitLifecycleEvent(LANGFUSE_FLUSH_EVENT_KIND, trigger, "fail", toErrorMessage(error));
				markFailure(trigger, error);
				if (trigger !== "heartbeat") {
					await runRetry(trigger, event, true);
				}
			}
		});
	};

	const triggerRetryTick = (trigger: LangfuseFlushRequest["trigger"], event?: Event): Promise<void> => {
		return enqueue(async () => {
			await runRetry(trigger, event, false);
		});
	};

	bus.on((event) => {
		if (event.kind === "pipeline.heartbeat") {
			heartbeatCount += 1;
			if (heartbeatCount % heartbeatFlushEvery === 0) {
				void triggerFlush("heartbeat", event);
				return;
			}
			if ((parseInt(args.ctx.get(RETRY_COUNT_CONTEXT_KEY) || "0", 10) || 0) > 0) {
				void triggerRetryTick("heartbeat", event);
			}
			return;
		}
		if (event.kind === "pipeline.suspend") {
			void triggerFlush("suspend", event);
			return;
		}
		if (event.kind === "pipeline.finish") {
			void triggerFlush("finish", event);
			return;
		}
		if (event.kind === "pipeline.error") {
			void triggerFlush("error", event);
		}
	});

	return {
		flushNow: async (trigger = "manual") => {
			await triggerFlush(trigger);
		},
		waitForIdle: async () => {
			await queue;
		},
	};
}

function retryBackoffForCount(retryCount: number): number {
	return Math.min(MAX_RETRY_BACKOFF_MS, DEFAULT_RETRY_BACKOFF_MS * Math.pow(2, Math.max(0, retryCount - 1)));
}

function resolvePositiveInt(direct: number | undefined, envKey: string, fallback: number): number {
	if (Number.isFinite(direct) && Number(direct) > 0) return Number(direct);
	const raw = Number(process.env[envKey] || "");
	if (Number.isFinite(raw) && raw > 0) return raw;
	return fallback;
}

function sanitizeEventData(data: Event["data"]): Record<string, string> {
	if (!data) return {};
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(data)) {
		if (typeof value !== "string") continue;
		out[key] = value;
	}
	return out;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
