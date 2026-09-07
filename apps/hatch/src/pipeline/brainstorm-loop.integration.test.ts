import { describe, it, expect, beforeEach, vi } from "vitest";

import { Context, StageStatus, type Outcome } from "./context.js";
import { Engine, HandlerRegistry, type Handler } from "./engine.js";
import { KnowledgeWorkerHandler } from "./handler/worktree.js";
import { parse } from "./parse.js";
import { ActionRegistry, createDefaultActionRegistry } from "./action-registry.js";
import { ToolHandler } from "./handler/tool.js";
import { registerBrainstormActions } from "./action-registry-brainstorm.js";

import type { Node } from "./graph.js";


const {
	createAgentSessionMock,
	createCodingToolsMock,
	sessionManagerMock,
	settingsManagerMock,
	promptAndExtractTextMock,
} = vi.hoisted(() => ({
	createAgentSessionMock: vi.fn(),
	createCodingToolsMock: vi.fn(() => []),
	sessionManagerMock: {
		inMemory: vi.fn(() => ({ kind: "in-memory" })),
		create: vi.fn(() => ({ kind: "create" })),
	},
	settingsManagerMock: {
		inMemory: vi.fn(() => ({ kind: "settings" })),
	},
	promptAndExtractTextMock: vi.fn(),
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
	createAgentSession: createAgentSessionMock,
	createCodingTools: createCodingToolsMock,
	SessionManager: sessionManagerMock,
	SettingsManager: settingsManagerMock,
}));

vi.mock("./handler/session-completion.js", () => ({
	promptAndExtractText: promptAndExtractTextMock,
}));

class StartDoneHandler implements Handler {
	async execute(): Promise<Outcome> {
		return { status: StageStatus.Completed, output: "" };
	}
}

class MockToolHandler implements Handler {
	public bumpCalls = 0;

	async execute(_signal: AbortSignal, node: Node, ctx: Context): Promise<Outcome> {
		if (node.id === "init_round") {
			return { status: StageStatus.Completed, output: "0" };
		}

		if (node.id === "bump_round") {
			this.bumpCalls += 1;
			const current = Number.parseInt(ctx.get("round") || "0", 10) || 0;
			const red = JSON.parse(ctx.get("red_output") || "{}");
			const blue = JSON.parse(ctx.get("blue_output") || "{}");
			const next = current + 1;
			const terminate = next >= 2 && (red.terminate === true || blue.terminate === true);
			const hasNext = !terminate && next < 10;
			const source = terminate ? (red.terminate && blue.terminate ? "both" : red.terminate ? "red" : "blue") : "";
			return {
				status: StageStatus.Completed,
				output: JSON.stringify({
					round: String(next),
					has_next: hasNext ? "true" : "false",
					terminate_triggered: terminate ? "true" : "false",
					terminate_source: source,
				}),
			};
		}

		return { status: StageStatus.Completed, output: "" };
	}
}

const BRAINSTORM_LOOP_DOT = `
	digraph brainstorm_loop_test {
		start [shape=Mdiamond]
		done [shape=Msquare]

		init_round [type="tool" output_key="round" prompt="echo 0"]

		red [type="agent.kw"
			 session_id="red_strategist"
			 output_key="red_output"
			 prompt="role=red round=${"${round}"} latest_blue=${"${blue_output}"}"]

		blue [type="agent.kw"
			  session_id="blue_strategist"
			  output_key="blue_output"
			  prompt="role=blue round=${"${round}"} latest_red=${"${red_output}"}"]

		bump_round [type="tool"
					 output_format="json"
					 outputs="round,has_next,terminate_triggered,terminate_source"
					 prompt="bump"]

		round_gate [shape=diamond label="Continue?"]

		start -> init_round -> red -> blue -> bump_round -> round_gate
		round_gate -> red [condition="has_next=true"]
		round_gate -> done [condition="has_next!=true"]
	}
`;

function makeResourceLoader() {
	return {
		getExtensions: () => ({ extensions: [], diagnostics: [] }),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined,
		getAppendSystemPrompt: () => [],
		getPathMetadata: () => new Map(),
		extendResources: () => {},
		reload: async () => {},
	};
}

function makeSession() {
	const listeners: Array<(event: any) => void> = [];
	return {
		messages: [] as any[],
		dispose: vi.fn(),
		subscribe(listener: (event: any) => void) {
			listeners.push(listener);
			return () => {
				const index = listeners.indexOf(listener);
				if (index >= 0) listeners.splice(index, 1);
			};
		},
	};
}

function makeKnowledgeWorkerHandler() {
	return new KnowledgeWorkerHandler({
		modelRegistry: { find: vi.fn(() => ({ id: "mock-model" })) } as any,
		authStorage: {} as any,
		resourceLoader: makeResourceLoader() as any,
		defaultModel: "claude-sonnet-4-6",
		defaultProvider: "anthropic",
		workDir: ".",
	} as any);
}

function configureMockedLlm(terminateAtRound: number) {
	promptAndExtractTextMock.mockImplementation(async (session: any, prompt: string, label: string) => {
		const role = label.includes("red_strategist") ? "red" : "blue";
		const roundMatch = prompt.match(/round=(\d+)/);
		const round = Number.parseInt(roundMatch?.[1] || "0", 10) || 0;
		const shouldTerminate = round + 1 >= terminateAtRound;
		const payload = role === "red"
			? { position: `red-r${round + 1}`, terminate: shouldTerminate }
			: { proposal: `blue-r${round + 1}`, terminate: shouldTerminate };
		session.messages = [{ role: "assistant", content: [{ type: "text", text: JSON.stringify(payload) }], stopReason: "stop" }];
		return JSON.stringify(payload);
	});
}

describe("brainstorm loop integration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createAgentSessionMock.mockImplementation(async () => ({ session: makeSession() }));
	});

	it("stops at max 10 rounds and reuses durable strategist sessions", async () => {
		configureMockedLlm(99);
		const graph = parse(BRAINSTORM_LOOP_DOT);
		const registry = new HandlerRegistry();
		const tools = new MockToolHandler();

		registry.register("start", new StartDoneHandler());
		registry.register("exit", new StartDoneHandler());
		registry.register("tool", tools);
		registry.register("conditional", new StartDoneHandler());
		registry.register("agent.kw", makeKnowledgeWorkerHandler());

		const engine = new Engine(graph, registry, { context: new Context({ round: "0" }) });
		await engine.run();

		expect(tools.bumpCalls).toBe(10);
		expect(engine.getContext().get("round")).toBe("10");
		expect(engine.getContext().get("has_next")).toBe("false");
		expect(createAgentSessionMock).toHaveBeenCalledTimes(2);
	});

	it("supports early termination (>=2) with round-by-round red/blue context flow", async () => {
		configureMockedLlm(3);
		const graph = parse(BRAINSTORM_LOOP_DOT);
		const registry = new HandlerRegistry();
		const tools = new MockToolHandler();

		registry.register("start", new StartDoneHandler());
		registry.register("exit", new StartDoneHandler());
		registry.register("tool", tools);
		registry.register("conditional", new StartDoneHandler());
		registry.register("agent.kw", makeKnowledgeWorkerHandler());

		const engine = new Engine(graph, registry, { context: new Context({ round: "0" }) });
		await engine.run();

		expect(tools.bumpCalls).toBe(3);
		expect(engine.getContext().get("round")).toBe("3");
		expect(engine.getContext().get("terminate_triggered")).toBe("true");
		expect(createAgentSessionMock).toHaveBeenCalledTimes(2);

		const redPrompts = promptAndExtractTextMock.mock.calls
			.filter(([, , label]) => String(label).includes("kw:red_strategist"))
			.map(([, prompt]) => String(prompt));
		const bluePrompts = promptAndExtractTextMock.mock.calls
			.filter(([, , label]) => String(label).includes("kw:blue_strategist"))
			.map(([, prompt]) => String(prompt));

		expect(redPrompts.length).toBe(3);
		expect(bluePrompts.length).toBe(3);
		expect(bluePrompts[0]).toContain('latest_red={"position":"red-r1","terminate":false}');
		expect(redPrompts[1]).toContain('latest_blue={"proposal":"blue-r1","terminate":false}');
		expect(redPrompts[2]).toContain('latest_blue={"proposal":"blue-r2","terminate":false}');
	});
});

// ---------------------------------------------------------------------------
// Termination-path integration tests using real in-process action registry
// ---------------------------------------------------------------------------

// A minimal DOT that wires check_output -> loop_guard -> blue_early_exit_gate
// -> force_wrap path, mirroring the real brainstorm early-exit routing.
const TERMINATION_PATH_DOT = `
	digraph brainstorm_termination_test {
		start [shape=Mdiamond]
		done [shape=Msquare recovery_sink_type="terminal"]

		check_blue [type="tool" governance="reversible"
			action_runtime="in_process"
			action_id="brainstorm.check_output"
			output_format="json"
			outputs="is_final,source,final_report,conversational_output,should_force_wrap,termination_reason,is_empty_output"
			action_agent_output="\${blue_output}"
			action_source="blue"
			trust_domain="test" trust_role="test"]

		loop_guard_blue [type="tool" governance="reversible"
			action_runtime="in_process"
			action_id="brainstorm.loop_guard"
			output_format="json"
			outputs="empty_blue_count,trigger_force_wrap,suppress_round_comment,guard_reason"
			action_source="blue"
			action_conversational_output="\${conversational_output}"
			action_previous_empty_blue_count="\${empty_blue_count}"
			action_should_force_wrap="\${should_force_wrap}"
			trust_domain="test" trust_role="test"]

		blue_early_exit_gate [shape=diamond label="Blue early exit?"]
		force_wrap [shape=Msquare]
		post_blue_comment [type="tool" governance="reversible"
			action_runtime="in_process"
			action_id="brainstorm.post_turn_comment"
			output_key="__comment_result"
			action_repo="test/repo"
			action_issue_number="1"
			action_agent_output="\${blue_output}"
			action_is_final="\${is_final}"
			action_suppress_round_comment="\${suppress_round_comment}"
			action_round="1"
			action_source="blue"
			trust_domain="test" trust_role="test"]

		start -> check_blue -> loop_guard_blue -> blue_early_exit_gate
		blue_early_exit_gate -> force_wrap [condition="trigger_force_wrap=true"]
		blue_early_exit_gate -> post_blue_comment [condition="trigger_force_wrap!=true"]
		force_wrap -> done
		post_blue_comment -> done
	}
`;

class TerminalHandler implements Handler {
	async execute(): Promise<Outcome> {
		return { status: StageStatus.Completed, output: "" };
	}
}

function makeTerminationRegistry(): HandlerRegistry {
	const actionRegistry = createDefaultActionRegistry();

	const registry = new HandlerRegistry();
	registry.register("start", new TerminalHandler());
	registry.register("exit", new TerminalHandler());
	registry.register("tool", new ToolHandler(".", undefined, {}, actionRegistry));
	registry.register("conditional", new TerminalHandler());
	return registry;
}

describe("brainstorm termination-path integration (in-process actions)", () => {
	it("blue terminate-non-final routes to force_wrap via loop_guard (not post_blue_comment)", async () => {
		// Blue outputs terminate:true with non-final strategist shape
		const blueOutput = JSON.stringify({
			position: "All agreed. Proposal is finalized.",
			recommended_changes: [],
			risks: [],
			terminate: true,
		});

		const graph = parse(TERMINATION_PATH_DOT);
		const registry = makeTerminationRegistry();

		const engine = new Engine(graph, registry, {
			context: new Context({
				blue_output: blueOutput,
				empty_blue_count: "0",
			}),
		});
		await engine.run();

		// should_force_wrap=true from check_blue, propagated through loop_guard
		expect(engine.getContext().get("should_force_wrap")).toBe("true");
		expect(engine.getContext().get("trigger_force_wrap")).toBe("true");
		expect(engine.getContext().get("suppress_round_comment")).toBe("true");
		expect(engine.getContext().get("termination_reason")).toBe("terminate_signal_non_final");

		// Engine reached force_wrap (done), not post_blue_comment
		// Verify by checking that __comment_result was never set
		expect(engine.getContext().get("__comment_result")).toBe("");
	});

	it("repeated empty blue turns route to force_wrap at threshold", async () => {
		// Blue output is empty (whitespace), count already at 1 — next will hit threshold of 2
		const blueOutput = "   ";

		const graph = parse(TERMINATION_PATH_DOT);
		const registry = makeTerminationRegistry();

		const engine = new Engine(graph, registry, {
			context: new Context({
				blue_output: blueOutput,
				empty_blue_count: "1",  // one prior empty
			}),
		});
		await engine.run();

		expect(engine.getContext().get("is_empty_output")).toBe("true");
		expect(engine.getContext().get("trigger_force_wrap")).toBe("true");
		expect(engine.getContext().get("suppress_round_comment")).toBe("true");
		expect(engine.getContext().get("guard_reason")).toBe("repeated_empty_blue");
		expect(engine.getContext().get("__comment_result")).toBe("");
	});

	it("healthy conversational blue output: guard signals stay false, no forced wrap", async () => {
		// Normal blue output — no terminate, non-empty, counter below threshold
		// Use a stubbed post_turn_comment so the gh call doesn't fail in test env
		const blueOutput = "I think we should split the pipeline runner into two phases.";

		const graph = parse(TERMINATION_PATH_DOT);

		const actionRegistry = createDefaultActionRegistry();

		// Stub post_turn_comment to return success without calling gh
		let commentAttempted = false;
		actionRegistry.register("brainstorm.post_turn_comment", {
			execute: async (): Promise<Outcome> => {
				commentAttempted = true;
				return { status: StageStatus.Completed, output: JSON.stringify({ ok: true, skipped: "false" }) };
			},
		});

		const healthyRegistry = new HandlerRegistry();
		healthyRegistry.register("start", new TerminalHandler());
		healthyRegistry.register("exit", new TerminalHandler());
		healthyRegistry.register("tool", new ToolHandler(".", undefined, {}, actionRegistry));
		healthyRegistry.register("conditional", new TerminalHandler());

		const engine = new Engine(graph, healthyRegistry, {
			context: new Context({ blue_output: blueOutput, empty_blue_count: "0" }),
		});
		await engine.run();

		// Guard signals must NOT trigger for healthy conversational output
		expect(engine.getContext().get("should_force_wrap")).toBe("false");
		expect(engine.getContext().get("trigger_force_wrap")).toBe("false");
		expect(engine.getContext().get("suppress_round_comment")).toBe("false");
		expect(engine.getContext().get("guard_reason")).toBe("none");
		// Routing went to post_blue_comment (not force_wrap)
		expect(commentAttempted).toBe(true);
	});
});
