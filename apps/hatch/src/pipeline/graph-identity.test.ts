import { describe, expect, it } from "vitest";

import { Context, StageStatus } from "./context.js";
import { Engine, HandlerRegistry } from "./engine.js";
import { DEFAULT_AGENT_IDENTITY_FALLBACK_V1 } from "./governance.js";
import {
	graphModelMatrix,
	nodeAgentId,
	nodeAgentRole,
	nodeHandlerType,
	nodeModelMatrix,
	nodeTrustDomain,
	nodeTrustPartition,
	nodeTrustPartitionKey,
	nodeTrustRole,
	type Node,
} from "./graph.js";
import { parse } from "./parse.js";

describe("agent identity contract resolution", () => {
	it("reads graph/node model_matrix accessors with empty-string fallback", () => {
		const graph = parse(`
	digraph model_matrix_accessors {
		model_matrix = "config/global-matrix.json"
		with_matrix [type="codergen" model_matrix="config/node-matrix.json"]
		without_matrix [type="codergen"]
	}
		`);

		expect(graphModelMatrix(graph)).toBe("config/global-matrix.json");
		expect(nodeModelMatrix(graph.nodes.with_matrix)).toBe("config/node-matrix.json");
		expect(nodeModelMatrix(graph.nodes.without_matrix)).toBe("");
	});

	it("resolves nodeAgentId/nodeAgentRole deterministically in legacy trust-participant mode", () => {
		const graph = parse(`
	digraph identity_legacy {
		legacy_tool [type="tool" tool_id="shell"]
		legacy_tool_invalid [type="tool" tool_id="bogus"]
		legacy_manager [type="stack.manager_loop"]
		legacy_worktree [type="agent.worktree"]
		legacy_kw [type="agent.kw"]
	}
		`);

		expect(nodeAgentId(graph.nodes.legacy_tool)).toBe("tool.shell");
		expect(nodeAgentRole(graph.nodes.legacy_tool)).toBe("tool.operator");

		expect(nodeAgentId(graph.nodes.legacy_tool_invalid)).toBe("tool.generic");
		expect(nodeAgentRole(graph.nodes.legacy_tool_invalid)).toBe("tool.operator");

		expect(nodeAgentId(graph.nodes.legacy_manager)).toBe("stack.manager_loop");
		expect(nodeAgentRole(graph.nodes.legacy_manager)).toBe("manager.supervisor");

		expect(nodeAgentId(graph.nodes.legacy_worktree)).toBe("agent.worktree");
		expect(nodeAgentRole(graph.nodes.legacy_worktree)).toBe("worktree.implementer");

		expect(nodeAgentId(graph.nodes.legacy_kw)).toBe("agent.kw");
		expect(nodeAgentRole(graph.nodes.legacy_kw)).toBe("knowledge.researcher");
	});

	it("uses explicit valid attrs first, then fallback rules, then default", () => {
		const graph = parse(`
	digraph identity_precedence {
		explicit [type="tool" tool_id="python" agent_id="tool.http" agent_role="manager.supervisor"]
		invalid_explicit [type="tool" tool_id="http" agent_id="not.valid" agent_role="bad.role"]
		non_participant [type="codergen" agent_id="not.valid" agent_role="bad.role"]
	}
		`);

		expect(nodeAgentId(graph.nodes.explicit)).toBe("tool.http");
		expect(nodeAgentRole(graph.nodes.explicit)).toBe("manager.supervisor");

		expect(nodeAgentId(graph.nodes.invalid_explicit)).toBe("tool.http");
		expect(nodeAgentRole(graph.nodes.invalid_explicit)).toBe("tool.operator");

		expect(nodeAgentId(graph.nodes.non_participant)).toBe(DEFAULT_AGENT_IDENTITY_FALLBACK_V1.agentId);
		expect(nodeAgentRole(graph.nodes.non_participant)).toBe(DEFAULT_AGENT_IDENTITY_FALLBACK_V1.agentRole);
	});

	it("resolves deterministic trust partition + partition key for builder/judge walls", () => {
		const graph = parse(`
	digraph trust_partition_identity {
		builder_tool [type="tool" tool_id="shell" trust_role="mothership.local.tool"]
		judge_explicit [type="codergen" trust_partition="judge" agent_role="unknown"]
		judge_role [type="codergen" trust_role="mothership.local.judge" agent_role="unknown"]
		judge_attr [type="codergen" judge="true" agent_role="unknown"]
		node_judge_id [type="codergen" agent_role="unknown"]
	}
		`);

		expect(nodeTrustPartition(graph.nodes.builder_tool)).toBe("builder");
		expect(nodeTrustDomain(graph.nodes.builder_tool)).toBe("builder");
		expect(nodeTrustRole(graph.nodes.builder_tool)).toBe("mothership.local.tool");
		expect(nodeTrustPartitionKey(graph.nodes.builder_tool)).toBe("builder/mothership.local.tool");

		expect(nodeTrustPartition(graph.nodes.judge_explicit)).toBe("judge");
		expect(nodeTrustDomain(graph.nodes.judge_explicit)).toBe("judge");
		expect(nodeTrustRole(graph.nodes.judge_explicit)).toBe("unknown");
		expect(nodeTrustPartitionKey(graph.nodes.judge_explicit)).toBe("judge/unknown");

		expect(nodeTrustPartition(graph.nodes.judge_role)).toBe("judge");
		expect(nodeTrustDomain(graph.nodes.judge_role)).toBe("judge");
		expect(nodeTrustRole(graph.nodes.judge_role)).toBe("mothership.local.judge");
		expect(nodeTrustPartitionKey(graph.nodes.judge_role)).toBe("judge/mothership.local.judge");

		expect(nodeTrustPartition(graph.nodes.judge_attr)).toBe("judge");
		expect(nodeTrustPartitionKey(graph.nodes.judge_attr)).toBe("judge/unknown");

		expect(nodeTrustPartition(graph.nodes.node_judge_id)).toBe("judge");
	});

	it("keeps execution dispatch bound to nodeHandlerType", async () => {
		const graph = parse(`
	digraph dispatch_source_of_truth {
		start [shape=Mdiamond]
		run [type="tool" agent_id="agent.worktree" agent_role="knowledge.researcher"]
		done [shape=Msquare]

		start -> run -> done
	}
		`);

		const runNode: Node = graph.nodes.run;
		expect(nodeHandlerType(runNode)).toBe("tool");
		expect(nodeAgentId(runNode)).toBe("agent.worktree");
		expect(nodeAgentRole(runNode)).toBe("knowledge.researcher");

		let calls = 0;
		const registry = new HandlerRegistry();
		registry.register("tool", {
			async execute() {
				calls++;
				return {
					status: StageStatus.Completed,
					output: "ok",
				};
			},
		});

		const engine = new Engine(graph, registry, { context: new Context() });
		await engine.run();

		expect(calls).toBe(1);
		expect(engine.getRecords().some((record) => record.nodeId === "run")).toBe(true);
	});
});
