import type { Event } from "../events.js";
import type { TelemetrySink } from "./sink.js";

export interface RedisTelemetryIdentity {
	factoryId: string;
	hostId: string;
}

export interface RedisTelemetryConfig {
	redisUrl?: string;
	identity: RedisTelemetryIdentity;
	streamMaxLen?: number;
	warn?: (message: string) => void;
	client?: RedisStreamClient;
	clock?: () => Date;
	failurePolicy?: {
		maxDroppedEvents: number;
	};
}

export interface RedisFactoryIndexEntry {
	factoryId: string;
	hostId: string;
	streamKey: string;
	updatedAt: string;
}

export interface RedisTelemetryEnvelope {
	schema: "hatch.redis.telemetry.v1";
	publishedAt: string;
	identity: RedisTelemetryIdentity;
	kind: string;
	event: Event | Record<string, unknown>;
}

export interface RedisStreamClient {
	xadd(args: {
		key: string;
		maxLen?: number;
		fields: Record<string, string>;
	}): Promise<string>;
	xread(args: {
		streams: Array<{ key: string; id: string }>;
		blockMs?: number;
		count?: number;
	}): Promise<Array<{
		key: string;
		entries: Array<{ id: string; fields: Record<string, string> }>;
	}>>;
	xrange(args: {
		key: string;
		start?: string;
		end?: string;
		count?: number;
	}): Promise<Array<{ id: string; fields: Record<string, string> }>>;
	smembers?(key: string): Promise<string[]>;
	sadd?(key: string, member: string): Promise<number>;
}

const DEFAULT_STREAM_MAX_LEN = 10_000;
const DEFAULT_MAX_DROPPED_EVENTS = 32;

export const REDIS_FACTORY_INDEX_KEY = "hatch:telemetry:factories";

export interface RedisStreamKeyParts {
	factoryId: string;
	hostId: string;
}

export function redisEventStreamKey(parts: RedisStreamKeyParts): string {
	return `hatch:telemetry:${sanitizeKeyPart(parts.factoryId)}:${sanitizeKeyPart(parts.hostId)}:events`;
}

function sanitizeKeyPart(value: string): string {
	const raw = String(value || "").trim();
	if (!raw) return "unknown";
	return raw.replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

export function resolveRedisTelemetryConfig(args: {
	env?: Record<string, string | undefined>;
	factoryConfigRedisUrl?: string;
	identity: RedisTelemetryIdentity;
	warn?: (message: string) => void;
	client?: RedisStreamClient;
	clock?: () => Date;
	streamMaxLen?: number;
	failurePolicy?: { maxDroppedEvents: number };
}): RedisTelemetryConfig | null {
	const redisUrl = String(args.factoryConfigRedisUrl || args.env?.["HATCH_REDIS_URL"] || "").trim();
	if (!redisUrl) return null;
	return {
		redisUrl,
		identity: args.identity,
		warn: args.warn,
		client: args.client,
		clock: args.clock,
		streamMaxLen: args.streamMaxLen,
		failurePolicy: args.failurePolicy,
	};
}

export interface CreateRedisTelemetrySinkResult {
	sink: TelemetrySink;
	enabled: boolean;
	reason: "enabled" | "no_config" | "startup_failure";
	streamKey: string;
}

/**
 * Test-only hook for injecting deterministic Redis transport in tests.
 */
declare global {
	var __HATCH_REDIS_TEST_CLIENT_FACTORY: (() => RedisStreamClient) | undefined;
}

export async function createRedisTelemetrySink(
	config: RedisTelemetryConfig | null | undefined,
): Promise<CreateRedisTelemetrySinkResult> {
	const disabled = createNoopResult("no_config", {
		factoryId: config?.identity.factoryId || "",
		hostId: config?.identity.hostId || "",
	});
	if (!config) return disabled;

	const warn = config.warn ?? ((message: string) => console.warn(message));
	const streamKey = redisEventStreamKey(config.identity);
	const clock = config.clock ?? (() => new Date());
	const maxDropped = Math.max(1, config.failurePolicy?.maxDroppedEvents ?? DEFAULT_MAX_DROPPED_EVENTS);
	const streamMaxLen = Math.max(1, config.streamMaxLen ?? DEFAULT_STREAM_MAX_LEN);

	let client: RedisStreamClient;
	try {
		client = config.client ?? await resolveRedisClient(config.redisUrl || "", warn);
	} catch (error) {
		warn(
			`[telemetry.redis] disabled: startup failure (${error instanceof Error ? error.message : String(error)}). warning only; hatch continues without redis telemetry.`,
		);
		return createNoopResult("startup_failure", config.identity);
	}

	const sink = new RedisTelemetrySink({
		client,
		identity: config.identity,
		streamKey,
		streamMaxLen,
		warn,
		clock,
		maxDropped,
	});
	await sink.initialize();
	if (!sink.isEnabled()) {
		warn("[telemetry.redis] disabled: startup initialization failed; warning only.");
		return createNoopResult("startup_failure", config.identity);
	}

	return {
		sink,
		enabled: true,
		reason: "enabled",
		streamKey,
	};
}

function createNoopResult(
	reason: "no_config" | "startup_failure",
	identity: RedisTelemetryIdentity,
): CreateRedisTelemetrySinkResult {
	return {
		sink: {
			emit: () => {},
			flush: async () => {},
			close: async () => {},
		},
		enabled: false,
		reason,
		streamKey: redisEventStreamKey(identity),
	};
}

async function resolveRedisClient(redisUrl: string, warn: (message: string) => void): Promise<RedisStreamClient> {
	const testFactory = globalThis.__HATCH_REDIS_TEST_CLIENT_FACTORY;
	if (testFactory) return testFactory();
	if (!redisUrl) throw new Error("missing redis url");

	let redisModule: any;
	try {
		const { createRequire } = await import("node:module");
		const req = createRequire(import.meta.url);
		redisModule = req("redis");
	} catch (error) {
		warn(
			`[telemetry.redis] disabled: failed to import redis client (${error instanceof Error ? error.message : String(error)}). warning only; hatch continues without redis telemetry.`,
		);
		throw error;
	}

	const createClient = redisModule.createClient as undefined | ((opts: { url: string }) => any);
	if (typeof createClient !== "function") {
		throw new Error("redis module missing createClient export");
	}

	const client = createClient({ url: redisUrl });
	if (typeof client.connect === "function") {
		await client.connect();
	}

	const wrapped: RedisStreamClient = {
		xadd: async ({ key, maxLen, fields }) => {
			const args: Array<string | number> = ["MAXLEN", "~", maxLen ?? DEFAULT_STREAM_MAX_LEN, "*"];
			for (const [field, value] of Object.entries(fields)) {
				args.push(field, value);
			}
			return await client.xAdd(key, args as any);
		},
		xread: async ({ streams, blockMs, count }) => {
			const xreadArgs: any = {
				COUNT: count,
				BLOCK: blockMs,
			};
			const mapped = streams.map((entry) => ({ key: entry.key, id: entry.id }));
			const out = await client.xRead(mapped, xreadArgs);
			return (out || []).map((entry: any) => ({
				key: String(entry.name || entry.key || ""),
				entries: (entry.messages || []).map((message: any) => ({
					id: String(message.id),
					fields: normalizeStringMap(message.message),
				})),
			}));
		},
		xrange: async ({ key, start = "-", end = "+", count }) => {
			const out = await client.xRange(key, start, end, count ? { COUNT: count } : undefined);
			return (out || []).map((row: any) => ({
				id: String(row.id),
				fields: normalizeStringMap(row.message),
			}));
		},
		smembers: client.sMembers ? async (key: string) => await client.sMembers(key) : undefined,
		sadd: client.sAdd ? async (key: string, member: string) => await client.sAdd(key, member) : undefined,
	};

	return wrapped;
}

function normalizeStringMap(raw: unknown): Record<string, string> {
	if (!raw || typeof raw !== "object") return {};
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		out[String(key)] = String(value ?? "");
	}
	return out;
}

class RedisTelemetrySink implements TelemetrySink {
	private readonly queue: Array<Event | Record<string, unknown>> = [];
	private readonly client: RedisStreamClient;
	private readonly identity: RedisTelemetryIdentity;
	private readonly streamKey: string;
	private readonly streamMaxLen: number;
	private readonly warn: (message: string) => void;
	private readonly clock: () => Date;
	private readonly maxDropped: number;
	private flushing: Promise<void> | null = null;
	private droppedCount = 0;
	private closed = false;
	private enabled = true;
	private warnedFailure = false;

	constructor(args: {
		client: RedisStreamClient;
		identity: RedisTelemetryIdentity;
		streamKey: string;
		streamMaxLen: number;
		warn: (message: string) => void;
		clock: () => Date;
		maxDropped: number;
	}) {
		this.client = args.client;
		this.identity = args.identity;
		this.streamKey = args.streamKey;
		this.streamMaxLen = args.streamMaxLen;
		this.warn = args.warn;
		this.clock = args.clock;
		this.maxDropped = args.maxDropped;
	}

	async initialize(): Promise<void> {
		try {
			await this.registerFactoryIndex();
		} catch (error) {
			this.enabled = false;
			this.warn(
				`[telemetry.redis] startup init failed: ${error instanceof Error ? error.message : String(error)} (warning only)`,
			);
		}
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	emit(event: Event | Record<string, unknown>): void {
		if (!this.enabled || this.closed) return;
		this.queue.push(event);
		void this.flush();
	}

	async flush(): Promise<void> {
		if (!this.enabled || this.closed) return;
		if (this.flushing) {
			await this.flushing;
			return;
		}
		if (this.queue.length === 0) return;

		this.flushing = (async () => {
			while (this.queue.length > 0 && this.enabled && !this.closed) {
				const next = this.queue.shift();
				if (!next) continue;
				try {
					const envelope = this.toEnvelope(next);
					await this.client.xadd({
						key: this.streamKey,
						maxLen: this.streamMaxLen,
						fields: {
							kind: envelope.kind,
							payload: JSON.stringify(envelope),
							factory_id: envelope.identity.factoryId,
							host_id: envelope.identity.hostId,
							ts: envelope.publishedAt,
						},
					});
				} catch (error) {
					this.onWriteFailure(error);
					if (!this.enabled) break;
				}
			}
		})().finally(() => {
			this.flushing = null;
		});

		await this.flushing;
	}

	async close(): Promise<void> {
		this.closed = true;
		await this.flush();
	}

	private toEnvelope(event: Event | Record<string, unknown>): RedisTelemetryEnvelope {
		const eventKind = readKind(event);
		return {
			schema: "hatch.redis.telemetry.v1",
			publishedAt: this.clock().toISOString(),
			identity: this.identity,
			kind: eventKind,
			event,
		};
	}

	private onWriteFailure(error: unknown): void {
		this.droppedCount += 1;
		if (!this.warnedFailure) {
			this.warnedFailure = true;
			this.warn(
				`[telemetry.redis] write failure: ${error instanceof Error ? error.message : String(error)}; failing open and dropping buffered events`,
			);
		}
		if (this.droppedCount >= this.maxDropped) {
			this.enabled = false;
			this.queue.length = 0;
			this.warn(
				`[telemetry.redis] disabled after dropped events exceeded limit=${this.maxDropped}; hatch execution continues`,
			);
		}
	}

	private async registerFactoryIndex(): Promise<void> {
		const entry: RedisFactoryIndexEntry = {
			factoryId: this.identity.factoryId,
			hostId: this.identity.hostId,
			streamKey: this.streamKey,
			updatedAt: this.clock().toISOString(),
		};
		if (this.client.sadd) {
			await this.client.sadd(REDIS_FACTORY_INDEX_KEY, JSON.stringify(entry));
		}
	}
}

function readKind(event: Event | Record<string, unknown>): string {
	if (event && typeof event === "object" && "kind" in event) {
		return String((event as { kind?: unknown }).kind || "unknown");
	}
	return "unknown";
}

export async function discoverRedisFactories(client: RedisStreamClient): Promise<RedisFactoryIndexEntry[]> {
	if (!client.smembers) return [];
	const rows = await client.smembers(REDIS_FACTORY_INDEX_KEY);
	const out: RedisFactoryIndexEntry[] = [];
	for (const row of rows) {
		try {
			const parsed = JSON.parse(row) as RedisFactoryIndexEntry;
			if (!parsed || typeof parsed !== "object") continue;
			out.push({
				factoryId: String(parsed.factoryId || ""),
				hostId: String(parsed.hostId || ""),
				streamKey: String(parsed.streamKey || ""),
				updatedAt: String(parsed.updatedAt || ""),
			});
		} catch {
			continue;
		}
	}
	return out;
}

export async function readRedisEvents(
	client: RedisStreamClient,
	args: { key: string; start?: string; end?: string; count?: number },
): Promise<RedisTelemetryEnvelope[]> {
	const rows = await client.xrange(args);
	const out: RedisTelemetryEnvelope[] = [];
	for (const row of rows) {
		const payload = row.fields.payload;
		if (!payload) continue;
		try {
			const parsed = JSON.parse(payload) as RedisTelemetryEnvelope;
			if (!parsed || typeof parsed !== "object") continue;
			out.push(parsed);
		} catch {
			continue;
		}
	}
	return out;
}
