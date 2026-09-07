import {
	DEFAULT_AGENT_IDENTITY_FALLBACK_V1,
	isAgentIdV1,
	isAgentRoleV1,
	isToolIdentifierV1,
	type AgentIdV1,
	type AgentRoleV1,
	type ToolIdentifierV1,
} from "./governance.js";
import { DEFAULT_IDENTITY_MODE, isIdentityMode, type IdentityMode } from "./identity.js";

/** Graph represents a parsed DOT pipeline. */
export interface Graph {
	name: string;
	attrs: Record<string, string>;
	nodes: Record<string, Node>;
	edges: Edge[];
}

/** Node represents a node in the pipeline graph. */
export interface Node {
	id: string;
	attrs: Record<string, string>;
}

/** Edge represents a directed edge in the pipeline graph. */
export interface Edge {
	from: string;
	to: string;
	attrs: Record<string, string>;
}

export type ComplexityClass = "low" | "medium" | "high";
export type TrustPartition = "builder" | "judge";

const COMPLEXITY_CLASSES = new Set<ComplexityClass>(["low", "medium", "high"]);
const TRUST_PARTITION_JUDGE_MARKER = "judge";
const TRUTHY_VALUES = new Set(["1", "true", "yes"]);

// ── Graph accessors ──

export function graphGoal(g: Graph): string {
	return g.attrs["goal"] ?? "";
}
export function graphLabel(g: Graph): string {
	return g.attrs["label"] ?? "";
}
export function graphDefaultMaxRetry(g: Graph): number {
	const v = g.attrs["default_max_retry"];
	if (v !== undefined) {
		const n = parseInt(v, 10);
		if (!isNaN(n)) return n;
	}
	return 50;
}
export function graphRetryTarget(g: Graph): string {
	return g.attrs["retry_target"] ?? "";
}
export function graphFallbackRetryTarget(g: Graph): string {
	return g.attrs["fallback_retry_target"] ?? "";
}
export function graphDefaultFidelity(g: Graph): string {
	return g.attrs["default_fidelity"] ?? "";
}
export function graphIdentityModeRaw(g: Graph): string {
	return g.attrs["identity_mode"] ?? "";
}
export function graphIdentityMode(g: Graph): IdentityMode {
	const mode = graphIdentityModeRaw(g);
	if (isIdentityMode(mode)) return mode;
	return DEFAULT_IDENTITY_MODE;
}
export function graphModelStylesheet(g: Graph): string {
	return g.attrs["model_stylesheet"] ?? "";
}
export function graphModelMatrix(g: Graph): string {
	return g.attrs["model_matrix"] ?? "";
}
export function graphWorkDir(g: Graph): string {
	return g.attrs["workdir"] ?? "";
}
export function graphIntentRef(g: Graph): string {
	return g.attrs["intent_ref"] ?? g.attrs["intent"] ?? "";
}
export function graphIntentProfile(g: Graph): string {
	return g.attrs["intent_profile"] ?? "";
}
export function graphIntentPatches(g: Graph): string {
	return g.attrs["intent_patches"] ?? g.attrs["intent_patch"] ?? "";
}

export function graphComplexityClass(g: Graph): ComplexityClass | "" {
	return parseComplexityClass(g.attrs["complexity_class"]);
}

export function outgoingEdges(g: Graph, nodeID: string): Edge[] {
	return g.edges.filter((e) => e.from === nodeID);
}

export function incomingEdges(g: Graph, nodeID: string): Edge[] {
	return g.edges.filter((e) => e.to === nodeID);
}

const TRUST_PARTICIPANT_HANDLER_TYPES = new Set(["tool", "stack.manager_loop", "agent.worktree", "agent.kw"]);

const TOOL_AGENT_ID_FALLBACK_BY_TOOL_ID: Record<ToolIdentifierV1, AgentIdV1> = {
	shell: "tool.shell",
	python: "tool.python",
	http: "tool.http",
};

const TRUST_PARTICIPANT_AGENT_ID_FALLBACK_BY_HANDLER: Record<string, AgentIdV1> = {
	tool: "tool.generic",
	"stack.manager_loop": "stack.manager_loop",
	"agent.worktree": "agent.worktree",
	"agent.kw": "agent.kw",
};

const TRUST_PARTICIPANT_AGENT_ROLE_FALLBACK_BY_HANDLER: Record<string, AgentRoleV1> = {
	tool: "tool.operator",
	"stack.manager_loop": "manager.supervisor",
	"agent.worktree": "worktree.implementer",
	"agent.kw": "knowledge.researcher",
};

// ── Node accessors ──

export function nodeLabel(n: Node): string {
	return n.attrs["label"] || n.id;
}
export function nodeShape(n: Node): string {
	return n.attrs["shape"] || "box";
}
export function nodeType(n: Node): string {
	return n.attrs["type"] ?? "";
}
export function nodePrompt(n: Node): string {
	return n.attrs["prompt"] ?? "";
}
export function nodeGoalGate(n: Node): boolean {
	return n.attrs["goal_gate"] === "true";
}
export function nodeMaxRetries(n: Node): number {
	const v = n.attrs["max_retries"];
	if (v !== undefined) {
		const n = parseInt(v, 10);
		if (!isNaN(n)) return n;
	}
	return 0;
}
export function nodeRetryTarget(n: Node): string {
	return n.attrs["retry_target"] ?? "";
}
export function nodeFallbackRetryTarget(n: Node): string {
	return n.attrs["fallback_retry_target"] ?? "";
}
export function nodeFidelity(n: Node): string {
	return n.attrs["fidelity"] ?? "";
}
export function nodeThreadID(n: Node): string {
	return n.attrs["thread_id"] ?? "";
}
export function nodeClass(n: Node): string {
	return n.attrs["class"] ?? "";
}
export function nodeTimeout(n: Node, lookup?: (key: string) => string): number {
	const rawTimeout = n.attrs["timeout"];
	if (!rawTimeout) return 0;
	const resolvedTimeout = resolveTimeoutTemplate(rawTimeout, lookup);
	if (!resolvedTimeout) return 0;
	return parseDuration(resolvedTimeout);
}
export function nodeLLMModel(n: Node): string {
	return n.attrs["llm_model"] ?? "";
}
export function nodeModelMatrix(n: Node): string {
	return n.attrs["model_matrix"] ?? "";
}
export function nodeLLMProvider(n: Node): string {
	return n.attrs["llm_provider"] ?? "";
}
export function nodeWorkDir(n: Node): string {
	return n.attrs["workdir"] ?? "";
}
export function nodeReasoningEffort(n: Node): string {
	return n.attrs["reasoning_effort"] || "high";
}
export function nodeScenarios(n: Node): string {
	return n.attrs["scenarios"] ?? "";
}
export function nodeOutputFormat(n: Node): string {
	return n.attrs["output_format"] ?? "";
}
export function nodeOutputKey(n: Node): string {
	return n.attrs["output_key"] ?? "";
}
export function nodeOutputs(n: Node): string {
	return n.attrs["outputs"] ?? "";
}
export function nodeAutoStatus(n: Node): boolean {
	return n.attrs["auto_status"] === "true";
}
export function nodeAllowPartial(n: Node): boolean {
	return n.attrs["allow_partial"] === "true";
}
export function nodeIntentRef(n: Node): string {
	return n.attrs["intent_ref"] ?? n.attrs["intent"] ?? "";
}
export function nodeIntentProfile(n: Node): string {
	return n.attrs["intent_profile"] ?? "";
}
export function nodeIntentPatches(n: Node): string {
	return n.attrs["intent_patches"] ?? n.attrs["intent_patch"] ?? "";
}

export function nodeComplexityClass(n: Node): ComplexityClass | "" {
	const nodeClass = parseComplexityClass(n.attrs["complexity_class"]);
	if (nodeClass) return nodeClass;
	return parseComplexityClass(n.attrs["complexity"]);
}

export function nodeToolId(n: Node): string {
	return n.attrs["tool_id"] ?? "";
}

export function nodeActionId(n: Node): string {
	return n.attrs["action_id"] ?? "";
}

export function nodeGovernance(n: Node): string {
	return n.attrs["governance"] ?? "";
}

export function nodeGovernanceDecision(n: Node): string {
	return n.attrs["governance_decision"] ?? "";
}

/** Whether the node participates in trust identity telemetry contracts. */
export function nodeTrustParticipates(n: Node): boolean {
	return TRUST_PARTICIPANT_HANDLER_TYPES.has(nodeHandlerType(n));
}

/**
 * Resolve stable v1 agent identity id for trust/policy contracts.
 *
 * Deterministic resolution order:
 * 1) explicit valid agent_id
 * 2) trust-participant legacy fallback table
 *    - tool + valid tool_id -> tool.<tool_id>
 *    - tool + missing/invalid tool_id -> tool.generic
 *    - stack.manager_loop -> stack.manager_loop
 *    - agent.worktree -> agent.worktree
 *    - agent.kw -> agent.kw
 * 3) DEFAULT_AGENT_IDENTITY_FALLBACK_V1.agentId
 */
export function nodeAgentId(n: Node): AgentIdV1 {
	const explicit = n.attrs["agent_id"];
	if (explicit && isAgentIdV1(explicit)) return explicit;

	const handlerType = nodeHandlerType(n);
	if (nodeTrustParticipates(n)) {
		if (handlerType === "tool") {
			const toolId = nodeToolId(n);
			if (isToolIdentifierV1(toolId)) {
				return TOOL_AGENT_ID_FALLBACK_BY_TOOL_ID[toolId];
			}
		}
		return TRUST_PARTICIPANT_AGENT_ID_FALLBACK_BY_HANDLER[handlerType] ?? DEFAULT_AGENT_IDENTITY_FALLBACK_V1.agentId;
	}

	return DEFAULT_AGENT_IDENTITY_FALLBACK_V1.agentId;
}

/**
 * Resolve stable v1 agent identity role for trust/policy contracts.
 *
 * Deterministic resolution order:
 * 1) explicit valid agent_role
 * 2) trust-participant legacy fallback table
 *    - tool -> tool.operator
 *    - stack.manager_loop -> manager.supervisor
 *    - agent.worktree -> worktree.implementer
 *    - agent.kw -> knowledge.researcher
 * 3) DEFAULT_AGENT_IDENTITY_FALLBACK_V1.agentRole
 */
export function nodeAgentRole(n: Node): AgentRoleV1 {
	const explicit = n.attrs["agent_role"];
	if (explicit && isAgentRoleV1(explicit)) return explicit;

	const handlerType = nodeHandlerType(n);
	if (nodeTrustParticipates(n)) {
		return TRUST_PARTICIPANT_AGENT_ROLE_FALLBACK_BY_HANDLER[handlerType] ?? DEFAULT_AGENT_IDENTITY_FALLBACK_V1.agentRole;
	}

	return DEFAULT_AGENT_IDENTITY_FALLBACK_V1.agentRole;
}

/**
 * Resolve deterministic trust partition for observability information wall routing.
 *
 * Judge partition detection is intentionally strict and deterministic:
 * 1) explicit node attrs: trust_partition="judge" (canonical)
 * 2) explicit node attrs: trust_role contains ".judge" segment
 * 3) explicit node attrs: judge=true|1|yes
 * 4) fallback: node id contains "judge"
 *
 * All other nodes route to builder partition.
 */
export function nodeTrustPartition(n: Node): TrustPartition {
	const explicitPartition = String(n.attrs["trust_partition"] || "").trim().toLowerCase();
	if (explicitPartition === "judge") return "judge";
	if (explicitPartition === "builder") return "builder";

	const trustRole = String(n.attrs["trust_role"] || "").trim().toLowerCase();
	if (trustRole && trustRole.split(".").includes(TRUST_PARTITION_JUDGE_MARKER)) return "judge";

	const judgeAttr = String(n.attrs["judge"] || "").trim().toLowerCase();
	if (TRUTHY_VALUES.has(judgeAttr)) return "judge";

	if (n.id.toLowerCase().includes(TRUST_PARTITION_JUDGE_MARKER)) return "judge";
	return "builder";
}

/** Resolve trust domain with deterministic fallback to partition. */
export function nodeTrustDomain(n: Node): string {
	const explicitTrustDomain = String(n.attrs["trust_domain"] || "").trim().toLowerCase();
	if (explicitTrustDomain) return explicitTrustDomain;
	return nodeTrustPartition(n);
}

/** Resolve trust role with deterministic fallback to agent_role. */
export function nodeTrustRole(n: Node): string {
	const explicitTrustRole = String(n.attrs["trust_role"] || "").trim().toLowerCase();
	if (explicitTrustRole) return explicitTrustRole;
	return nodeAgentRole(n);
}

/**
 * Stable partition key derived from trust identity metadata.
 * Query shape: trust_partition_key=<partition>/<trust_role>
 */
export function nodeTrustPartitionKey(n: Node): string {
	return `${nodeTrustPartition(n)}/${nodeTrustRole(n)}`;
}

/** Resolve the handler type for a node. Explicit type overrides shape. */
export function nodeHandlerType(n: Node): string {
	const t = nodeType(n);
	if (t) return t;
	return shapeToHandlerType(nodeShape(n));
}

// ── Edge accessors ──

export function edgeLabel(e: Edge): string {
	return e.attrs["label"] ?? "";
}
export function edgeCondition(e: Edge): string {
	return e.attrs["condition"] ?? "";
}
export function edgeWeight(e: Edge): number {
	const v = e.attrs["weight"];
	if (v !== undefined) {
		const n = parseInt(v, 10);
		if (!isNaN(n)) return n;
	}
	return 0;
}
export function edgeLoopRestart(e: Edge): boolean {
	return e.attrs["loop_restart"] === "true";
}
export function edgeInputKey(e: Edge): string {
	return e.attrs["input_key"] ?? "";
}

// ── Shape to handler type mapping ──

export function shapeToHandlerType(shape: string): string {
	switch (shape) {
		case "Mdiamond":
			return "start";
		case "Msquare":
			return "exit";
		case "box":
		case "":
			return "codergen";
		case "hexagon":
			return "wait.human";
		case "diamond":
			return "conditional";
		case "component":
			return "parallel";
		case "tripleoctagon":
			return "parallel.fan_in";
		case "parallelogram":
			return "tool";
		case "house":
			return "stack.manager_loop";
		case "octagon":
			return "assert";
		default:
			return "codergen";
	}
}

// ── Attribute parsers ──

/** Parse a complexity class string into low|medium|high; returns empty string for unknown values. */
export function parseComplexityClass(value?: string): ComplexityClass | "" {
	if (!value) return "";
	const normalized = value.trim().toLowerCase();
	if (normalized === "") return "";
	if (COMPLEXITY_CLASSES.has(normalized as ComplexityClass)) return normalized as ComplexityClass;
	return "";
}

// ── Duration parser ──

/** Parse a duration string like "900s", "15m", "2h", "250ms", "1d" into milliseconds. */
export function parseDuration(s: string): number {
	if (!s) return 0;

	let i = 0;
	while (i < s.length && s[i] >= "0" && s[i] <= "9") i++;
	if (i === 0) return 0;

	const n = parseInt(s.substring(0, i), 10);
	const unit = s.substring(i);

	switch (unit) {
		case "ms":
			return n;
		case "s":
			return n * 1000;
		case "m":
			return n * 60 * 1000;
		case "h":
			return n * 60 * 60 * 1000;
		case "d":
			return n * 24 * 60 * 60 * 1000;
		default:
			return n * 1000; // default to seconds
	}
}

function resolveTimeoutTemplate(rawTimeout: string, lookup?: (key: string) => string): string {
	const timeout = rawTimeout.trim();
	if (!timeout.startsWith("${") || !timeout.endsWith("}")) {
		return timeout;
	}
	if (!lookup) {
		return timeout;
	}
	const key = timeout.slice(2, -1).trim();
	if (!key) {
		return "";
	}
	return lookup(key).trim();
}
