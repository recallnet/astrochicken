import { parseCondition } from "./condition.js";
import {
	edgeCondition,
	edgeLabel,
	incomingEdges,
	nodeClass,
	nodeHandlerType,
	nodeLabel,
	outgoingEdges,
} from "./graph.js";
import {
	extractGraphRecoveryMetadata,
	extractRecoveryMetadata,
	isApprovedRecoverySink,
	isSupervisorOwnedRecovery,
	RECOVERY_OWNER_ATTRIBUTE,
	RECOVERY_OWNER_MISSING_CODE,
	RECOVERY_OWNER_SUPERVISOR,
	RECOVERY_SINK_TYPE_ATTRIBUTE,
	type RecoveryMetadataByNodeId,
	type RecoveryNodeMetadata,
} from "./recovery-contract.js";

import type { Graph, Node } from "./graph.js";
import type { ValidationError } from "./validate.js";

const TRUTHY_VALUES = new Set(["1", "true", "yes"]);
const FAILURE_TOKENS = new Set([
	"fail",
	"failed",
	"failure",
	"error",
	"retry",
	"timeout",
	"blocked",
	"reject",
	"rejected",
	"deny",
	"denied",
	"quarantine",
	"conflict",
	"overflow",
	"exhausted",
	"escalate",
]);
const NEGATIVE_SUCCESS_KEYS = ["pass", "success", "ok", "valid", "approved", "acquired", "granted"];

export interface GraphRecoveryInvariantOptions {
	recoveryMetadataByNodeId?: RecoveryMetadataByNodeId;
}

/**
 * Structural recovery invariants for factory DOT graphs.
 *
 * Ownership assumptions (explicit contract):
 * - Intentional terminal nodes: handler type exit, exit.success, exit.failure, or node attrs terminal=true|success|failure,
 *   terminal_kind=success|failure. Any explicit exit handler is treated as intentional terminal.
 * - Approved wait states: wait.* handlers or explicit wait attrs (external_wait/wait_state/human_wait=true).
 * - Supervisor-owned recovery requires explicit recovery_owner="supervisor".
 * - Explicit sink marker: recovery_sink_type="wait|terminal".
 */
export function validateGraphRecoveryInvariants(g: Graph, options: GraphRecoveryInvariantOptions = {}): ValidationError[] {
	const errs: ValidationError[] = [];
	const reachable = reachableFromStart(g);
	const recoveryMetadataByNodeId = options.recoveryMetadataByNodeId ?? extractGraphRecoveryMetadata(g);
	const ownedSinkNodeIds = collectOwnedSinkNodeIds(g, recoveryMetadataByNodeId);
	const reachesOwnedSink = computeReachabilityToTargets(g, ownedSinkNodeIds);

	for (const node of Object.values(g.nodes)) {
		if (!reachable.has(node.id)) continue;
		const outgoing = outgoingEdges(g, node.id);
		if (outgoing.length > 0) continue;

		const metadata = recoveryMetadata(node, recoveryMetadataByNodeId, g);
		if (isOperationalNode(node, metadata)) {
			errs.push({
				rule: "graph_recovery.dead_end",
				nodeId: node.id,
				message:
					`operational node "${node.id}" has no outgoing edges; route it to supervisor recovery, ` +
					`an approved wait state, or an intentional terminal`,
			});
		}

		if (isAccidentalTerminal(node, metadata)) {
			errs.push({
				rule: "graph_recovery.accidental_terminal",
				nodeId: node.id,
				message:
					`node "${node.id}" appears terminal but is not an intentional terminal; ` +
					`use exit/exit.success/exit.failure or terminal markers`,
			});
		}
	}

	for (const edge of g.edges) {
		if (!isFailureEdge(edgeLabel(edge), edgeCondition(edge))) continue;

		const targetNode = g.nodes[edge.to];
		if (targetNode) {
			const metadata = recoveryMetadata(targetNode, recoveryMetadataByNodeId, g);
			if (!isSupervisorOwnedRecovery(metadata) && !isApprovedRecoverySink(metadata)) {
				errs.push({
					rule: "graph_recovery.unowned_failure_path",
					code: RECOVERY_OWNER_MISSING_CODE,
					nodeId: targetNode.id,
					message:
						`failure edge ${edge.from} -> ${edge.to} targets node "${targetNode.id}" ` +
						`(label="${nodeLabel(targetNode)}") without explicit recovery ownership; ` +
						`set ${RECOVERY_OWNER_ATTRIBUTE}="${RECOVERY_OWNER_SUPERVISOR}" ` +
						`or ${RECOVERY_SINK_TYPE_ATTRIBUTE}="wait|terminal"`,
				});
			}
		}

		if (reachesOwnedSink.has(edge.to)) continue;
		errs.push({
			rule: "graph_recovery.unowned_failure_path",
			nodeId: edge.from,
			message:
				`failure edge ${edge.from} -> ${edge.to} does not converge to supervisor-owned recovery, ` +
				`an approved wait state, or an intentional terminal`,
		});
	}

	for (const node of Object.values(g.nodes)) {
		if (!isFailureNode(node)) continue;
		if (reachesOwnedSink.has(node.id)) continue;
		errs.push({
			rule: "graph_recovery.unowned_failure_path",
			nodeId: node.id,
			message:
				`failure-designated node "${node.id}" does not converge to supervisor-owned recovery, ` +
				`an approved wait state, or an intentional terminal`,
		});
	}

	for (const component of stronglyConnectedComponents(g)) {
		if (!componentHasCycle(g, component)) continue;
		if ([...component].some((nodeId) => reachesOwnedSink.has(nodeId))) continue;
		const loopStarter = [...component].sort()[0] || "";
		errs.push({
			rule: "graph_recovery.runaway_retry_loop",
			nodeId: loopStarter,
			message:
				`loop component [${[...component].sort().join(", ")}] has no path to supervisor-owned recovery, ` +
				`an approved wait state, or an intentional terminal`,
		});
	}

	return dedupeValidationErrors(errs);
}

function recoveryMetadata(node: Node, byNodeId: RecoveryMetadataByNodeId, g: Graph): RecoveryNodeMetadata {
	return byNodeId.get(node.id) ?? extractRecoveryMetadata(node, g);
}

function isOperationalNode(node: Node, metadata: RecoveryNodeMetadata): boolean {
	if (nodeHandlerType(node) === "start") return false;
	if (isIntentionalTerminalNode(node)) return false;
	if (isApprovedWaitNode(node)) return false;
	if (isApprovedRecoverySinkNode(node, metadata)) return false;
	if (isSupervisorOwnedRecovery(metadata)) return false;
	return true;
}

function isAccidentalTerminal(node: Node, metadata: RecoveryNodeMetadata): boolean {
	if (isIntentionalTerminalNode(node) || isApprovedWaitNode(node) || isApprovedRecoverySinkNode(node, metadata)) return false;
	if (!declaresTerminalIntent(node)) return false;
	return true;
}

function declaresTerminalIntent(node: Node): boolean {
	const handlerType = normalize(nodeHandlerType(node));
	if (handlerType.startsWith("exit")) return true;
	return hasOwnAttr(node, "terminal") || hasOwnAttr(node, "terminal_kind") || hasOwnAttr(node, "intentional_terminal");
}

function isIntentionalTerminalNode(node: Node): boolean {
	const handlerType = normalize(nodeHandlerType(node));
	if (handlerType === "exit" || handlerType === "exit.success" || handlerType === "exit.failure") return true;

	const terminal = normalize(node.attrs["terminal"] || node.attrs["intentional_terminal"]);
	if (terminal && (TRUTHY_VALUES.has(terminal) || terminal === "success" || terminal === "failure")) return true;

	const terminalKind = normalize(node.attrs["terminal_kind"]);
	if (terminalKind === "success" || terminalKind === "failure") return true;

	const explicitType = normalize(node.attrs["type"]);
	if (explicitType === "exit.success" || explicitType === "exit.failure") return true;

	return false;
}

function isApprovedWaitNode(node: Node): boolean {
	const handlerType = normalize(nodeHandlerType(node));
	if (handlerType === "wait" || handlerType.startsWith("wait.")) return true;
	return (
		isTruthy(node.attrs["external_wait"]) ||
		isTruthy(node.attrs["wait_state"]) ||
		isTruthy(node.attrs["human_wait"]) ||
		isTruthy(node.attrs["wait_for_human"])
	);
}

function isApprovedRecoverySinkNode(node: Node, metadata: RecoveryNodeMetadata): boolean {
	if (isApprovedRecoverySink(metadata)) return true;
	if (isIntentionalTerminalNode(node)) return true;
	if (isApprovedWaitNode(node)) return true;
	return false;
}

function isFailureNode(node: Node): boolean {
	if (isTruthy(node.attrs["failure"]) || isTruthy(node.attrs["failure_path"]) || isTruthy(node.attrs["on_failure"])) {
		return true;
	}

	const text = [node.id, nodeLabel(node), nodeClass(node), node.attrs["status"], node.attrs["terminal_kind"]]
		.map((value) => normalize(value))
		.join(" ");
	if (!text.trim()) return false;
	return tokenize(text).some((token) => FAILURE_TOKENS.has(token));
}

function isFailureEdge(label: string, condition: string): boolean {
	const text = `${normalize(label)} ${normalize(condition)}`.trim();
	if (text && tokenize(text).some((token) => FAILURE_TOKENS.has(token))) return true;

	const parsed = parseCondition(condition);
	if (!parsed) return false;

	for (const clause of parsed.clauses) {
		const key = normalize(clause.key);
		const value = normalize(clause.value);
		if (tokenize(key).some((token) => FAILURE_TOKENS.has(token))) return true;
		if (tokenize(value).some((token) => FAILURE_TOKENS.has(token))) return true;

		if (clause.op === "!=" && isPositiveSuccessValue(value) && NEGATIVE_SUCCESS_KEYS.some((segment) => key.includes(segment))) {
			return true;
		}
		if (clause.op === "=" && isNegativeSuccessValue(value) && NEGATIVE_SUCCESS_KEYS.some((segment) => key.includes(segment))) {
			return true;
		}
	}

	return false;
}

function isPositiveSuccessValue(value: string): boolean {
	return value === "true" || value === "1" || value === "yes" || value === "pass" || value === "success" || value === "ok";
}

function isNegativeSuccessValue(value: string): boolean {
	return value === "false" || value === "0" || value === "no" || value === "fail" || value === "failed" || value === "error";
}

function collectOwnedSinkNodeIds(g: Graph, recoveryMetadataByNodeId: RecoveryMetadataByNodeId): Set<string> {
	const nodeIds = new Set<string>();
	for (const node of Object.values(g.nodes)) {
		const metadata = recoveryMetadata(node, recoveryMetadataByNodeId, g);
		if (isIntentionalTerminalNode(node) || isApprovedWaitNode(node) || isApprovedRecoverySinkNode(node, metadata) || isSupervisorOwnedRecovery(metadata)) {
			nodeIds.add(node.id);
		}
	}
	return nodeIds;
}

function reachableFromStart(g: Graph): Set<string> {
	const start = Object.values(g.nodes).find((node) => nodeHandlerType(node) === "start");
	if (!start) return new Set(Object.keys(g.nodes));

	const reachable = new Set<string>();
	const stack = [start.id];
	while (stack.length > 0) {
		const nodeId = stack.pop();
		if (!nodeId || reachable.has(nodeId)) continue;
		reachable.add(nodeId);
		for (const edge of outgoingEdges(g, nodeId)) {
			if (!reachable.has(edge.to)) stack.push(edge.to);
		}
	}
	return reachable;
}

function computeReachabilityToTargets(g: Graph, targets: Set<string>): Set<string> {
	const reaches = new Set<string>(targets);
	const queue = [...targets];
	while (queue.length > 0) {
		const nodeId = queue.shift();
		if (!nodeId) continue;
		for (const incoming of incomingEdges(g, nodeId)) {
			if (reaches.has(incoming.from)) continue;
			reaches.add(incoming.from);
			queue.push(incoming.from);
		}
	}
	return reaches;
}

function stronglyConnectedComponents(g: Graph): Array<Set<string>> {
	let index = 0;
	const indices = new Map<string, number>();
	const lowlinks = new Map<string, number>();
	const stack: string[] = [];
	const onStack = new Set<string>();
	const components: Array<Set<string>> = [];

	const nodeIds = Object.keys(g.nodes).sort();
	for (const nodeId of nodeIds) {
		if (!indices.has(nodeId)) {
			strongConnect(nodeId);
		}
	}

	return components;

	function strongConnect(nodeId: string): void {
		indices.set(nodeId, index);
		lowlinks.set(nodeId, index);
		index += 1;
		stack.push(nodeId);
		onStack.add(nodeId);

		const neighbors = outgoingEdges(g, nodeId)
			.map((edge) => edge.to)
			.filter((neighbor) => neighbor in g.nodes)
			.sort();
		for (const neighbor of neighbors) {
			if (!indices.has(neighbor)) {
				strongConnect(neighbor);
				lowlinks.set(nodeId, Math.min(lowlinks.get(nodeId) ?? 0, lowlinks.get(neighbor) ?? 0));
			} else if (onStack.has(neighbor)) {
				lowlinks.set(nodeId, Math.min(lowlinks.get(nodeId) ?? 0, indices.get(neighbor) ?? 0));
			}
		}

		if (lowlinks.get(nodeId) !== indices.get(nodeId)) return;

		const component = new Set<string>();
		while (stack.length > 0) {
			const member = stack.pop();
			if (!member) break;
			onStack.delete(member);
			component.add(member);
			if (member === nodeId) break;
		}
		components.push(component);
	}
}

function componentHasCycle(g: Graph, component: Set<string>): boolean {
	if (component.size > 1) return true;
	const [only] = [...component];
	if (!only) return false;
	return outgoingEdges(g, only).some((edge) => edge.to === only);
}

function dedupeValidationErrors(errors: ValidationError[]): ValidationError[] {
	const seen = new Set<string>();
	const deduped: ValidationError[] = [];
	for (const error of errors) {
		const signature = `${error.rule}|${error.code || ""}|${error.nodeId || ""}|${error.message}`;
		if (seen.has(signature)) continue;
		seen.add(signature);
		deduped.push(error);
	}
	return deduped;
}

function hasOwnAttr(node: Node, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(node.attrs, key);
}

function isTruthy(value: unknown): boolean {
	return TRUTHY_VALUES.has(normalize(value));
}

function normalize(value: unknown): string {
	return String(value || "").trim().toLowerCase();
}

function tokenize(value: string): string[] {
	return normalize(value)
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
}
