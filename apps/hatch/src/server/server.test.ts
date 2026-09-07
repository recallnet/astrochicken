import { afterEach, describe, expect, it, vi } from "vitest";

import { once } from "node:events";

import type { AddressInfo } from "node:net";

const {
	createAgentSessionMock,
	createReadOnlyToolsMock,
	createCodingToolsMock,
	sessionManagerMock,
	settingsManagerMock,
} = vi.hoisted(() => ({
	createAgentSessionMock: vi.fn(),
	createReadOnlyToolsMock: vi.fn(() => []),
	createCodingToolsMock: vi.fn(() => []),
	sessionManagerMock: {
		inMemory: vi.fn(() => ({ kind: "in-memory" })),
		continueRecent: vi.fn(() => ({ kind: "continue-recent" })),
		create: vi.fn(() => ({ kind: "create" })),
	},
	settingsManagerMock: {
		inMemory: vi.fn(() => ({ kind: "settings" })),
	},
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
	createAgentSession: createAgentSessionMock,
	createReadOnlyTools: createReadOnlyToolsMock,
	createCodingTools: createCodingToolsMock,
	SessionManager: sessionManagerMock,
	SettingsManager: settingsManagerMock,
}));

import {
	setLangfuseLifecycleEmitter,
	type LangfuseFlushRequest,
	type LangfuseRetryRequest,
} from "@recallnet/factory-telemetry";

import { createServer } from "./server.js";
import { HandlerRegistry } from "../pipeline/engine.js";
import { InMemoryRedisHarness } from "../pipeline/redis-test-harness.js";

import type { HandlerConfig } from "../pipeline/handler/register.js";

describe("server validation mode handling", () => {
	let cleanup: (() => Promise<void>) | undefined;
	let redisHarness: InMemoryRedisHarness | undefined;

	afterEach(async () => {
		if (cleanup) await cleanup();
		cleanup = undefined;
		createAgentSessionMock.mockReset();
		setLangfuseLifecycleEmitter(undefined);
		delete process.env.HATCH_RUN_HEARTBEAT_MS;
		delete process.env.HATCH_LANGFUSE_HEARTBEAT_FLUSH_EVERY;
		delete process.env.HATCH_REDIS_URL;
		delete process.env.HATCH_FACTORY_ID;
		delete process.env.HOSTNAME;
		delete (globalThis as any).__HATCH_REDIS_TEST_CLIENT_FACTORY;
		redisHarness = undefined;
	});

	async function startServer(handlerConfig?: HandlerConfig): Promise<string> {
		const registry = new HandlerRegistry();
		const server = createServer(registry, "127.0.0.1:0", handlerConfig);
		await once(server, "listening");
		cleanup = async () => {
			await new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()));
			});
		};
		const address = server.address() as AddressInfo;
		return `http://127.0.0.1:${address.port}`;
	}

	it("defaults to legacy mode when validation_mode is omitted", async () => {
		const baseUrl = await startServer();
		const response = await fetch(`${baseUrl}/pipelines`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				dot: `digraph x {
					start [shape=Mdiamond]
					trusted [type="tool" prompt="echo ok" governance="reversible"]
					done [shape=Msquare]
					start -> trusted -> done
				}`,
			}),
		});

		expect(response.status).toBe(201);
	});

	it("enforces strict agent identity validation when validation_mode=strict", async () => {
		const baseUrl = await startServer();
		const response = await fetch(`${baseUrl}/pipelines`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				dot: `digraph x {
					start [shape=Mdiamond]
					trusted [type="tool" prompt="echo ok" governance="reversible"]
					done [shape=Msquare]
					start -> trusted -> done
				}`,
				validation_mode: "strict",
			}),
		});

		expect(response.status).toBe(400);
		const payload = (await response.json()) as { error: string };
		expect(payload.error).toContain("[agent_id]");
		expect(payload.error).toContain("[agent_version]");
	});

	it("rejects unknown validation_mode in POST /pipelines", async () => {
		const baseUrl = await startServer();
		const response = await fetch(`${baseUrl}/pipelines`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				dot: "digraph x { start [shape=Mdiamond] done [shape=Msquare] start -> done }",
				validation_mode: "future",
			}),
		});

		expect(response.status).toBe(400);
		const payload = (await response.json()) as { error: string };
		expect(payload.error).toContain("invalid validation_mode");
	});

	it("/pipelines still completes and ignores legacy redis telemetry boot when redis env is enabled", async () => {
		process.env.HATCH_REDIS_URL = "redis://local";
		process.env.HATCH_FACTORY_ID = "mothership";
		process.env.HOSTNAME = "host-a";
		redisHarness = new InMemoryRedisHarness();
		(globalThis as any).__HATCH_REDIS_TEST_CLIENT_FACTORY = () => redisHarness!;
		const baseUrl = await startServer();
		const response = await fetch(`${baseUrl}/pipelines`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				dot: "digraph x { start [shape=Mdiamond] done [shape=Msquare] start -> done }",
				context: { factory_id: "mothership" },
			}),
		});
		expect(response.status).toBe(201);
		const created = (await response.json()) as { id: string };

		for (let i = 0; i < 50; i++) {
			const run = await fetch(`${baseUrl}/pipelines/${created.id}`);
			expect(run.status).toBe(200);
			const payload = (await run.json()) as { status: string };
			if (payload.status === "completed" || payload.status === "failed") break;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}

		const streamKey = "hatch:telemetry:mothership:host-a:events";
		const rows = await redisHarness!.xrange({ key: streamKey });
		expect(rows).toHaveLength(0);
		const completed = await fetch(`${baseUrl}/pipelines/${created.id}`);
		expect(completed.status).toBe(200);
		const payload = (await completed.json()) as { events: Array<{ kind: string }> };
		expect(payload.events.some((event) => event.kind === "pipeline.start")).toBe(true);
		expect(payload.events.some((event) => event.kind === "pipeline.finish")).toBe(true);
	});

	it("server returns 201 and run execution remains unaffected when redis is unavailable", async () => {
		process.env.HATCH_REDIS_URL = "redis://broken";
		process.env.HATCH_FACTORY_ID = "mothership";
		process.env.HOSTNAME = "host-a";
		(globalThis as any).__HATCH_REDIS_TEST_CLIENT_FACTORY = () => {
			throw new Error("redis down");
		};
		const baseUrl = await startServer();
		const response = await fetch(`${baseUrl}/pipelines`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				dot: "digraph x { start [shape=Mdiamond] done [shape=Msquare] start -> done }",
			}),
		});
		expect(response.status).toBe(201);
		const created = (await response.json()) as { id: string };
		expect(created.id).toBeTruthy();
	});

	it("serve mode no longer emits direct langfuse lifecycle events even when configured", async () => {
		process.env.HATCH_RUN_HEARTBEAT_MS = "10";
		process.env.HATCH_LANGFUSE_HEARTBEAT_FLUSH_EVERY = "1";
		const lifecycleCalls: Array<{ kind: "flush" | "retry"; request: LangfuseFlushRequest | LangfuseRetryRequest }> = [];
		setLangfuseLifecycleEmitter({
			flush: async (request) => {
				lifecycleCalls.push({ kind: "flush", request });
			},
			retry: async (request) => {
				lifecycleCalls.push({ kind: "retry", request });
			},
		});
		const listeners: Array<(event: any) => void> = [];
		const session: any = {
			messages: [],
			subscribe(listener: (event: any) => void) {
				listeners.push(listener);
				return () => {
					const idx = listeners.indexOf(listener);
					if (idx >= 0) listeners.splice(idx, 1);
				};
			},
			async prompt() {
				listeners.forEach((listener) => listener({
					type: "tool_execution_start",
					toolCallId: "tool-1",
					toolName: "read",
					args: {},
				}));
				const assistant = {
					role: "assistant",
					content: [{ type: "text", text: "ok" }],
					provider: "anthropic",
					model: "claude-sonnet-4-6",
					usage: {
						input: 12,
						output: 6,
						totalTokens: 18,
						cacheRead: 0,
						cacheWrite: 0,
						cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
					},
				};
				this.messages = [assistant];
				listeners.forEach((listener) => listener({ type: "message_end", message: assistant }));
				listeners.forEach((listener) => listener({
					type: "tool_execution_end",
					toolCallId: "tool-1",
					toolName: "read",
					result: {},
					isError: false,
				}));
			},
			dispose() {
				// noop
			},
		};
		createAgentSessionMock.mockResolvedValue({ session });

		const handlerConfig: HandlerConfig = {
			modelRegistry: {
				find: vi.fn(() => ({ id: "mock-model" })),
			} as any,
			authStorage: {} as any,
			resourceLoader: {} as any,
			defaultModel: "claude-sonnet-4-6",
			defaultProvider: "anthropic",
			workDir: ".",
		};

		const baseUrl = await startServer(handlerConfig);
		const createResponse = await fetch(`${baseUrl}/pipelines`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				dot: `digraph serve_langfuse {
					start [shape=Mdiamond]
					run [type="agent.kw" governance="irreversible" recovery_owner="supervisor" session_id="kw-session" llm_provider="anthropic" llm_model="claude-sonnet-4-6"]
					done [shape=Msquare]
					start -> run -> done
				}`,
			}),
		});
		expect(createResponse.status).toBe(201);
		const created = (await createResponse.json()) as { id: string };

		for (let i = 0; i < 40; i++) {
			const statusResponse = await fetch(`${baseUrl}/pipelines/${created.id}`);
			expect(statusResponse.status).toBe(200);
			const payload = (await statusResponse.json()) as {
				status: string;
				events: Array<{ kind: string; data?: Record<string, string> }>;
			};
			if (payload.status !== "completed") {
				await new Promise((resolve) => setTimeout(resolve, 20));
				continue;
			}

			const generation = payload.events.find((event) => event.kind === "telemetry.langfuse.generation");
			const sessionEvent = payload.events.find((event) =>
				event.kind === "telemetry.langfuse.session" && event.data?.langfuse_session_event_type === "tool_execution_start",
			);
			const lifecycleFlush = payload.events.filter((event) => event.kind === "telemetry.langfuse.flush");
			expect(payload.events.some((event) => event.kind === "pipeline.start")).toBe(true);
			expect(payload.events.some((event) => event.kind === "pipeline.finish")).toBe(true);
			expect(generation).toBeDefined();
			expect(sessionEvent).toBeDefined();
			expect(lifecycleFlush).toHaveLength(0);
			expect(lifecycleCalls).toHaveLength(0);
			return;
		}

		throw new Error(`serve run ${created.id} did not complete in time`);
	});
});
