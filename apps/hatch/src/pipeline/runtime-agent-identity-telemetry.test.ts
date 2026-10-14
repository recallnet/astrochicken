import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventBus, type Event } from "@recallnet/factory-telemetry";
import { describe, expect, it } from "vitest";

import { Context, StageStatus } from "./context.js";
import { Engine, HandlerRegistry } from "./engine.js";
import { parse } from "./parse.js";
import { createTraceHandler, type TraceEntry } from "./trace.js";

type TrustedIdentityCase = {
	nodeId: string;
	handlerType: "tool" | "agent.worktree" | "agent.kw";
	nodeAttrs?: string;
	agentId: string;
	agentRole: string;
};

const TRUSTED_CASES: TrustedIdentityCase[] = [
	{ nodeId: "tool_node", handlerType: "tool", nodeAttrs: 'tool_id="shell"', agentId: "tool.shell", agentRole: "tool.operator" },
	{ nodeId: "worktree_node", handlerType: "agent.worktree", agentId: "agent.worktree", agentRole: "worktree.implementer" },
	{ nodeId: "kw_node", handlerType: "agent.kw", agentId: "agent.kw", agentRole: "knowledge.researcher" },
];

function expectIdentityPayload(
	entry: Event | TraceEntry | undefined,
	expected: {
		agentId: string;
		agentRole: string;
		includeAttempt: boolean;
		tracePartition: "builder" | "judge";
		trustRole?: string;
	},
): void {
	const trustRole = expected.trustRole ?? expected.agentRole;
	expect(entry?.data?.agent_id).toBe(expected.agentId);
	expect(entry?.data?.agent_role).toBe(expected.agentRole);
	expect(entry?.data?.trust_partition).toBe(expected.tracePartition);
	expect(entry?.data?.trust_domain).toBe(expected.tracePartition);
	expect(entry?.data?.trust_role).toBe(trustRole);
	expect(entry?.data?.trust_partition_key).toBe(`${expected.tracePartition}/${trustRole}`);
	expect(entry?.traceId).toMatch(new RegExp(`^${expected.tracePartition}-\\d{6}$`));
	if (expected.includeAttempt) {
		expect(entry?.data?.attempt).toBe("1");
		return;
	}
	expect(entry?.data?.attempt).toBeUndefined();
}

function readTraceEntries(tracePath: string): TraceEntry[] {
	const traceRaw = readFileSync(tracePath, "utf-8").trim();
	return traceRaw ? traceRaw.split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
}

describe("runtime lifecycle telemetry agent identity", () => {
	it("preserves trust identity envelope in stage.retry events", async () => {
		const graph = parse(`
	digraph lifecycle_retry_identity {
		start [shape=Mdiamond]
		retry_node [type="tool" tool_id="shell" max_retries="2"]
		done [shape=Msquare]

		start -> retry_node -> done
	}
		`);

		let attempts = 0;
		const registry = new HandlerRegistry();
		registry.register("tool", {
			async execute() {
				attempts += 1;
				if (attempts === 1) throw new Error("retry me");
				return {
					status: StageStatus.Completed,
					output: "ok",
				};
			},
		});

		const events: Event[] = [];
		const bus = new EventBus();
		bus.on((event) => events.push(event));

		const traceDir = mkdtempSync(join(tmpdir(), "hatch-trace-identity-retry-"));
		const tracePath = join(traceDir, "events.jsonl");
		bus.on(createTraceHandler(tracePath));

		const engine = new Engine(graph, registry, { eventBus: bus, context: new Context() });
		await engine.run();

		const retryEvent = events.find((event) => event.kind === "stage.retry" && event.nodeId === "retry_node");
		expect(retryEvent).toBeDefined();
		expect(retryEvent?.traceId).toMatch(/^builder-\d{6}$/);
		expect(retryEvent?.data).toEqual(
			expect.objectContaining({
				attempt: "2",
				agent_id: "tool.shell",
				agent_role: "tool.operator",
				trust_partition: "builder",
				trust_domain: "builder",
				trust_role: "tool.operator",
				trust_partition_key: "builder/tool.operator",
				handler_type: "tool",
				model: "",
			}),
		);

		const traceEntries = readTraceEntries(tracePath);
		const retryTrace = traceEntries.find((entry) => entry.kind === "stage.retry" && entry.nodeId === "retry_node");
		expect(retryTrace).toBeDefined();
		expect(retryTrace?.traceId).toMatch(/^builder-\d{6}$/);
		expect(retryTrace?.data).toEqual(
			expect.objectContaining({
				attempt: "2",
				agent_id: "tool.shell",
				agent_role: "tool.operator",
				trust_partition: "builder",
				trust_domain: "builder",
				trust_role: "tool.operator",
				trust_partition_key: "builder/tool.operator",
				handler_type: "tool",
				model: "",
			}),
		);
	});
	it("emits stable identity payload shape for trusted stage.start and stage.finish events", async () => {
		const graph = parse(`
	digraph lifecycle_identity {
		start [shape=Mdiamond]
		tool_node [type="tool" tool_id="shell"]
		worktree_node [type="agent.worktree"]
		kw_node [type="agent.kw"]
		non_trusted [type="codergen"]
		done [shape=Msquare]

		start -> tool_node -> worktree_node -> kw_node -> non_trusted -> done
	}
		`);

		const registry = new HandlerRegistry();
		for (const trusted of TRUSTED_CASES) {
			registry.register(trusted.handlerType, {
				async execute() {
					return {
						status: StageStatus.Completed,
						output: `${trusted.nodeId} ok`,
					};
				},
			});
		}
		registry.register("codergen", {
			async execute() {
				return {
					status: StageStatus.Completed,
					output: "non-trusted output",
				};
			},
		});

		const events: Event[] = [];
		const bus = new EventBus();
		bus.on((event) => events.push(event));

		const traceDir = mkdtempSync(join(tmpdir(), "hatch-trace-identity-"));
		const tracePath = join(traceDir, "events.jsonl");
		bus.on(createTraceHandler(tracePath));

		const engine = new Engine(graph, registry, { eventBus: bus, context: new Context() });
		await engine.run();

		const traceEntries = readTraceEntries(tracePath);

		for (const trusted of TRUSTED_CASES) {
			const eventStart = events.find((event) => event.kind === "stage.start" && event.nodeId === trusted.nodeId);
			expectIdentityPayload(eventStart, {
				agentId: trusted.agentId,
				agentRole: trusted.agentRole,
				includeAttempt: true,
				tracePartition: "builder",
			});

			const eventFinish = events.find((event) => event.kind === "stage.finish" && event.nodeId === trusted.nodeId);
			expectIdentityPayload(eventFinish, {
				agentId: trusted.agentId,
				agentRole: trusted.agentRole,
				includeAttempt: true,
				tracePartition: "builder",
			});

			const traceStart = traceEntries.find((entry) => entry.kind === "stage.start" && entry.nodeId === trusted.nodeId);
			expectIdentityPayload(traceStart, {
				agentId: trusted.agentId,
				agentRole: trusted.agentRole,
				includeAttempt: true,
				tracePartition: "builder",
			});

			const traceFinish = traceEntries.find((entry) => entry.kind === "stage.finish" && entry.nodeId === trusted.nodeId);
			expectIdentityPayload(traceFinish, {
				agentId: trusted.agentId,
				agentRole: trusted.agentRole,
				includeAttempt: true,
				tracePartition: "builder",
			});
		}

		const nonTrustedStart = events.find((event) => event.kind === "stage.start" && event.nodeId === "non_trusted");
		expect(nonTrustedStart?.data).toEqual(
			expect.objectContaining(unknownBuilderAttempt()),
		);
		expect(nonTrustedStart?.traceId).toMatch(/^builder-\d{6}$/);

		const nonTrustedFinish = events.find((event) => event.kind === "stage.finish" && event.nodeId === "non_trusted");
		expect(nonTrustedFinish?.data?.agent_id).toBeUndefined();
		expect(nonTrustedFinish?.data?.agent_role).toBeUndefined();
		expect(nonTrustedFinish?.data?.trust_partition).toBe("builder");
		expect(nonTrustedFinish?.data?.trust_partition_key).toBe("builder/unknown");
		expect(nonTrustedFinish?.traceId).toMatch(/^builder-\d{6}$/);

		const traceNonTrustedStart = traceEntries.find((entry) => entry.kind === "stage.start" && entry.nodeId === "non_trusted");
		expect(traceNonTrustedStart?.data).toEqual(
			expect.objectContaining(unknownBuilderAttempt()),
		);
		expect(traceNonTrustedStart?.traceId).toMatch(/^builder-\d{6}$/);

		const traceNonTrustedFinish = traceEntries.find((entry) => entry.kind === "stage.finish" && entry.nodeId === "non_trusted");
		expect(traceNonTrustedFinish?.data?.agent_id).toBeUndefined();
		expect(traceNonTrustedFinish?.data?.agent_role).toBeUndefined();
		expect(traceNonTrustedFinish?.data?.trust_partition).toBe("builder");
		expect(traceNonTrustedFinish?.data?.trust_partition_key).toBe("builder/unknown");
		expect(traceNonTrustedFinish?.traceId).toMatch(/^builder-\d{6}$/);
	});

	it("emits agent identity in stage.error payloads for trusted handler types", async () => {
		for (const trusted of TRUSTED_CASES) {
			const graph = parse(`
	digraph lifecycle_error_${trusted.nodeId} {
		start [shape=Mdiamond]
		fail_node [type="${trusted.handlerType}"${trusted.nodeAttrs ? ` ${trusted.nodeAttrs}` : ""}]
		done [shape=Msquare]

		start -> fail_node -> done
	}
			`);

			const registry = new HandlerRegistry();
			registry.register(trusted.handlerType, {
				async execute() {
					throw new Error("boom");
				},
			});

			const events: Event[] = [];
			const bus = new EventBus();
			bus.on((event) => events.push(event));

			const traceDir = mkdtempSync(join(tmpdir(), "hatch-trace-identity-error-"));
			const tracePath = join(traceDir, "events.jsonl");
			bus.on(createTraceHandler(tracePath));

			const engine = new Engine(graph, registry, { eventBus: bus, context: new Context() });
			await expect(engine.run()).rejects.toThrow("after 1 attempts: boom");

			const errorEvent = events.find((event) => event.kind === "stage.error" && event.nodeId === "fail_node");
			expectIdentityPayload(errorEvent, {
				agentId: trusted.agentId,
				agentRole: trusted.agentRole,
				includeAttempt: true,
				tracePartition: "builder",
			});

			const traceEntries = readTraceEntries(tracePath);
			const traceError = traceEntries.find((entry) => entry.kind === "stage.error" && entry.nodeId === "fail_node");
			expectIdentityPayload(traceError, {
				agentId: trusted.agentId,
				agentRole: trusted.agentRole,
				includeAttempt: true,
				tracePartition: "builder",
			});
		}
	});

	it("keeps non-trust stage.error payload shape unchanged", async () => {
		const graph = parse(`
	digraph lifecycle_error_non_trust {
		start [shape=Mdiamond]
		non_trusted_fail [type="codergen"]
		done [shape=Msquare]

		start -> non_trusted_fail -> done
	}
		`);

		const registry = new HandlerRegistry();
		registry.register("codergen", {
			async execute() {
				throw new Error("boom");
			},
		});

		const events: Event[] = [];
		const bus = new EventBus();
		bus.on((event) => events.push(event));

		const traceDir = mkdtempSync(join(tmpdir(), "hatch-trace-non-trust-error-"));
		const tracePath = join(traceDir, "events.jsonl");
		bus.on(createTraceHandler(tracePath));

		const engine = new Engine(graph, registry, { eventBus: bus, context: new Context() });
		await expect(engine.run()).rejects.toThrow("after 1 attempts: boom");

		const errorEvent = events.find((event) => event.kind === "stage.error" && event.nodeId === "non_trusted_fail");
		expect(errorEvent?.data).toEqual(
			expect.objectContaining(unknownBuilderAttempt()),
		);
		expect(errorEvent?.data?.agent_id).toBeUndefined();
		expect(errorEvent?.data?.agent_role).toBeUndefined();
		expect(errorEvent?.traceId).toMatch(/^builder-\d{6}$/);

		const traceEntries = readTraceEntries(tracePath);
		const traceError = traceEntries.find((entry) => entry.kind === "stage.error" && entry.nodeId === "non_trusted_fail");
		expect(traceError?.data).toEqual(
			expect.objectContaining(unknownBuilderAttempt()),
		);
		expect(traceError?.data?.agent_id).toBeUndefined();
		expect(traceError?.data?.agent_role).toBeUndefined();
		expect(traceError?.traceId).toMatch(/^builder-\d{6}$/);
	});
});

function unknownBuilderAttempt() {
	return {
				attempt: "1",
				trust_partition: "builder",
				trust_domain: "builder",
				trust_partition_key: "builder/unknown",
				trust_role: "unknown",
				handler_type: "codergen",
				model: "",
			};
}
