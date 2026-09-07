import { parseCondition } from "./condition.js";
import {
	ACTION_IDENTIFIERS_V1,
	GOVERNANCE_DECISIONS_V1,
	GOVERNANCE_KINDS_V1,
	TOOL_IDENTIFIERS_V1,
	isActionIdentifierV1,
	isGovernanceDecisionV1,
	isGovernanceKindV1,
	isToolIdentifierV1,
	isTrustParticipatingHandlerType,
} from "./governance.js";
import { validateGraphRecoveryInvariants } from "./graph-recovery-invariants.js";
import {
	ModelMatrixResolutionError,
	resolveEffectiveModelRoutingForGraph,
	resolveEffectiveModelRoutingForNode,
} from "./model-matrix-resolution.js";
import { validateNodeSchemaContract } from "./node-schema.js";
import {
	nodeHandlerType,
	nodeGoalGate,
	nodeRetryTarget,
	nodeFallbackRetryTarget,
	nodeToolId,
	nodeActionId,
	nodeGovernance,
	nodeGovernanceDecision,
	nodeOutputKey,
	nodeOutputs,
	graphGoal,
	graphRetryTarget,
	graphFallbackRetryTarget,
	graphIdentityModeRaw,
	outgoingEdges,
	incomingEdges,
	edgeLabel,
	edgeCondition,
	edgeLoopRestart,
} from "./graph.js";
import {
	DEFAULT_IDENTITY_MODE,
	IDENTITY_MODES,
	IDENTITY_RULE_CODES,
	isIdentityMode,
	isIrreversibleHandlerTypeV1,
	type IdentityMode,
} from "./identity.js";
import { validateIntentBindings } from "./intent.js";
import { extractGraphRecoveryMetadata } from "./recovery-contract.js";

import type { Graph, Node } from "./graph.js";
import type { IntentRegistry } from "./intent.js";

/** ValidationError represents a single validation issue. */
export interface ValidationError {
	rule: string;
	code?: string;
	message: string;
	nodeId?: string;
	severity?: "error" | "warning";
}

export const VALIDATION_MODES = ["legacy", "strict"] as const;
export type ValidationMode = (typeof VALIDATION_MODES)[number];

const VALIDATION_MODES_SET = new Set<string>(VALIDATION_MODES);

const AGENT_ID_ATTRIBUTE = "agent_id";
const AGENT_VERSION_ATTRIBUTE = "agent_version";
const AGENT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._/-]{0,126}[a-z0-9])?$/;
const AGENT_VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const COMPLEXITY_CLASS_CONDITION_KEY = "complexity_class";
const COMPLEXITY_LEGACY_CONDITION_KEY = "complexity";
const COMPLEXITY_CONDITION_KEYS = new Set([COMPLEXITY_CLASS_CONDITION_KEY, COMPLEXITY_LEGACY_CONDITION_KEY]);

export interface ValidationOptions {
	intentRegistry?: IntentRegistry;
	validationMode?: ValidationMode;
	identityMode?: IdentityMode;
}

export function isValidationMode(value: string): value is ValidationMode {
	return VALIDATION_MODES_SET.has(value);
}

export function hasValidationErrors(errors: ValidationError[]): boolean {
	return errors.some((error) => error.severity !== "warning");
}

export function formatValidationError(e: ValidationError): string {
	const label = e.code ? `${e.rule}:${e.code}` : e.rule;
	const severityPrefix = e.severity === "warning" ? "warning " : "";
	if (e.nodeId) return `${severityPrefix}[${label}] node "${e.nodeId}": ${e.message}`;
	return `${severityPrefix}[${label}] ${e.message}`;
}

/** Validate runs all lint rules on the graph and returns any errors found. */
export function validate(g: Graph, options: ValidationOptions = {}): ValidationError[] {
	const modeResolution = resolveValidationMode(options.validationMode);
	if (!modeResolution.ok) return [modeResolution.error];

	const legacyOverride = options.validationMode !== undefined ? modeResolution.mode : undefined;
	const identityMode = resolveIdentityMode(g, options.identityMode, legacyOverride);
	const recoveryMetadataByNodeId = extractGraphRecoveryMetadata(g);

	return [
		...validateStartNode(g),
		...validateTerminalNode(g),
		...validateReachability(g),
		...validateEdgeTargets(g),
		...validateConditionalEdges(g),
		...validateParallelFanIn(g),
		...validateRetryTargets(g),
		...validateGoalGate(g),
		...validateNodeTypes(g),
		...validateModelMatrixResolution(g),
		...validateIdentityMode(g),
		...validateGovernanceIdentifiers(g, identityMode),
		...validateDuplicateEdges(g),
		...validateSelfLoops(g),
		...validateGraphRecoveryInvariants(g, { recoveryMetadataByNodeId }),
		...validateComplexityEstimatorProvenance(g),
		...validateIntentBindings(g, options.intentRegistry),
		...validateWorktreeNodes(g),
		...validateNodeSchemaContract(g),
		...(identityMode === "strict" ? validateAgentIdentityContract(g) : []),
		...(identityMode === "strict" ? validateTrustTelemetryContract(g) : []),
	];
}

function resolveValidationMode(value: unknown): { ok: true; mode: ValidationMode } | { ok: false; error: ValidationError } {
	if (value === undefined) return { ok: true, mode: "legacy" };
	if (typeof value === "string" && isValidationMode(value)) return { ok: true, mode: value };
	return {
		ok: false,
		error: {
			rule: "validation_mode",
			message: `invalid validation mode "${String(value)}" (expected: ${VALIDATION_MODES.join(", ")})`,
		},
	};
}

function validateStartNode(g: Graph): ValidationError[] {
	const starts = Object.values(g.nodes).filter((n) => nodeHandlerType(n) === "start");
	if (starts.length === 0)
		return [{ rule: "start_node", message: "no start node found (need shape=Mdiamond or type=start)" }];
	if (starts.length > 1)
		return [{ rule: "start_node", message: `multiple start nodes found: ${starts.map((n) => n.id).join(", ")}` }];
	return [];
}

function validateTerminalNode(g: Graph): ValidationError[] {
	for (const n of Object.values(g.nodes)) {
		if (nodeHandlerType(n) === "exit") return [];
	}
	return [{ rule: "terminal_node", message: "no exit node found (need shape=Msquare or type=exit)" }];
}

function validateReachability(g: Graph): ValidationError[] {
	const startNode = Object.values(g.nodes).find((n) => nodeHandlerType(n) === "start");
	if (!startNode) return [];

	const reachable = new Set<string>();
	const walk = (id: string) => {
		if (reachable.has(id)) return;
		reachable.add(id);
		for (const e of outgoingEdges(g, id)) {
			walk(e.to);
		}
	};
	walk(startNode.id);

	const errs: ValidationError[] = [];
	for (const id of Object.keys(g.nodes)) {
		if (!reachable.has(id)) {
			errs.push({ rule: "reachability", nodeId: id, message: "node is not reachable from start" });
		}
	}
	return errs;
}

function validateEdgeTargets(g: Graph): ValidationError[] {
	const errs: ValidationError[] = [];
	for (const e of g.edges) {
		if (!(e.from in g.nodes))
			errs.push({ rule: "edge_targets", message: `edge references unknown source node "${e.from}"` });
		if (!(e.to in g.nodes))
			errs.push({ rule: "edge_targets", message: `edge references unknown target node "${e.to}"` });
	}
	return errs;
}

function validateConditionalEdges(g: Graph): ValidationError[] {
	const errs: ValidationError[] = [];
	for (const n of Object.values(g.nodes)) {
		if (nodeHandlerType(n) === "conditional") {
			const edges = outgoingEdges(g, n.id);
			if (edges.length < 2) {
				errs.push({
					rule: "conditional_edges",
					nodeId: n.id,
					message: `conditional node needs >=2 outgoing edges, has ${edges.length}`,
				});
			}
		}
	}
	return errs;
}

function validateParallelFanIn(g: Graph): ValidationError[] {
	let hasParallel = false;
	let hasFanIn = false;
	for (const n of Object.values(g.nodes)) {
		const ht = nodeHandlerType(n);
		if (ht === "parallel") hasParallel = true;
		if (ht === "parallel.fan_in") hasFanIn = true;
	}
	if (hasParallel && !hasFanIn) {
		return [{ rule: "parallel_fan_in", message: "parallel node exists but no fan-in node found" }];
	}
	return [];
}

function validateRetryTargets(g: Graph): ValidationError[] {
	const errs: ValidationError[] = [];

	const check = (source: string, target: string, attr: string) => {
		if (target && !(target in g.nodes)) {
			errs.push({
				rule: "retry_targets",
				nodeId: source,
				message: `${attr} references unknown node "${target}"`,
			});
		}
	};

	const grt = graphRetryTarget(g);
	if (grt && !(grt in g.nodes))
		errs.push({ rule: "retry_targets", message: `graph retry_target references unknown node "${grt}"` });
	const gfrt = graphFallbackRetryTarget(g);
	if (gfrt && !(gfrt in g.nodes))
		errs.push({ rule: "retry_targets", message: `graph fallback_retry_target references unknown node "${gfrt}"` });

	for (const n of Object.values(g.nodes)) {
		check(n.id, nodeRetryTarget(n), "retry_target");
		check(n.id, nodeFallbackRetryTarget(n), "fallback_retry_target");
	}
	return errs;
}

function validateGoalGate(g: Graph): ValidationError[] {
	if (!graphGoal(g)) return [];
	for (const n of Object.values(g.nodes)) {
		if (nodeGoalGate(n)) return [];
	}
	return [{ rule: "goal_gate", message: "graph has a goal but no node has goal_gate=true" }];
}

function validateNodeTypes(g: Graph): ValidationError[] {
	const known = new Set([
		"start",
		"exit",
		"codergen",
		"wait.human",
		"conditional",
		"parallel",
		"parallel.fan_in",
		"tool",
		"stack.manager_loop",
		"assert",
		"pipeline",
		"fan_out.dynamic",
		"fan_out.detached",
		"fan_in.dynamic",
		"agent.worktree",
		"agent.kw",
	]);
	const errs: ValidationError[] = [];
	for (const n of Object.values(g.nodes)) {
		const ht = nodeHandlerType(n);
		if (!known.has(ht)) {
			errs.push({ rule: "node_types", nodeId: n.id, message: `unknown handler type "${ht}"` });
		}
	}
	return errs;
}

function validateModelMatrixResolution(g: Graph): ValidationError[] {
	const errs: ValidationError[] = [];

	try {
		resolveEffectiveModelRoutingForGraph(g);
	} catch (error) {
		if (error instanceof ModelMatrixResolutionError) {
			errs.push({
				rule: "model_matrix_resolution",
				code: error.code,
				message: error.message,
			});
		} else {
			throw error;
		}
		return errs;
	}

	for (const node of Object.values(g.nodes)) {
		try {
			resolveEffectiveModelRoutingForNode(g, node, { skipGraphScopeValidation: true });
		} catch (error) {
			if (error instanceof ModelMatrixResolutionError) {
				errs.push({
					rule: "model_matrix_resolution",
					code: error.code,
					nodeId: node.id,
					message: error.message,
				});
				continue;
			}
			throw error;
		}
	}

	return errs;
}

function resolveIdentityMode(g: Graph, override?: IdentityMode, legacyOverride?: ValidationMode): IdentityMode {
	if (override) return override;
	if (legacyOverride) return legacyOverride;
	const graphMode = graphIdentityModeRaw(g);
	if (isIdentityMode(graphMode)) return graphMode;
	return DEFAULT_IDENTITY_MODE;
}

function validateIdentityMode(g: Graph): ValidationError[] {
	const graphMode = graphIdentityModeRaw(g);
	if (!graphMode || isIdentityMode(graphMode)) return [];
	return [
		{
			rule: "identity_mode",
			code: IDENTITY_RULE_CODES.MODE_INVALID,
			message: `invalid graph identity_mode "${graphMode}" (expected: ${IDENTITY_MODES.join(", ")})`,
		},
	];
}

function validateGovernanceIdentifiers(g: Graph, identityMode: IdentityMode): ValidationError[] {
	const errs: ValidationError[] = [];
	const toolIdsLabel = TOOL_IDENTIFIERS_V1.join(", ");
	const actionIdsLabel = ACTION_IDENTIFIERS_V1.join(", ");
	const governanceKindsLabel = GOVERNANCE_KINDS_V1.join(", ");
	const governanceDecisionsLabel = GOVERNANCE_DECISIONS_V1.join(", ");

	for (const n of Object.values(g.nodes)) {
		const handlerType = nodeHandlerType(n);
		if (!isIrreversibleHandlerTypeV1(handlerType)) continue;

		const toolId = nodeToolId(n);
		if (!toolId && identityMode === "strict") {
			errs.push({
				rule: "tool_ids",
				code: IDENTITY_RULE_CODES.TOOL_ID_REQUIRED,
				nodeId: n.id,
				message: `missing tool_id for handler type "${handlerType}" in strict mode (expected: ${toolIdsLabel})`,
			});
		} else if (toolId && !isToolIdentifierV1(toolId)) {
			errs.push({
				rule: "tool_ids",
				code: IDENTITY_RULE_CODES.TOOL_ID_INVALID,
				nodeId: n.id,
				message: `unknown tool_id "${toolId}" (expected: ${toolIdsLabel})`,
			});
		}

		const actionId = nodeActionId(n);
		if (!actionId && identityMode === "strict") {
			errs.push({
				rule: "action_ids",
				code: IDENTITY_RULE_CODES.ACTION_ID_REQUIRED,
				nodeId: n.id,
				message: `missing action_id for handler type "${handlerType}" in strict mode (expected: ${actionIdsLabel})`,
			});
		} else if (actionId && !isActionIdentifierV1(actionId)) {
			errs.push({
				rule: "action_ids",
				code: IDENTITY_RULE_CODES.ACTION_ID_INVALID,
				nodeId: n.id,
				message: `unknown action_id "${actionId}" (expected: ${actionIdsLabel})`,
			});
		}

		const governance = nodeGovernance(n);
		if (!governance) {
			errs.push({
				rule: "governance_required",
				code: IDENTITY_RULE_CODES.GOVERNANCE_REQUIRED,
				nodeId: n.id,
				message: `missing governance for handler type "${handlerType}" (expected: ${governanceKindsLabel})`,
			});
		} else if (!isGovernanceKindV1(governance)) {
			errs.push({
				rule: "governance_kind",
				code: IDENTITY_RULE_CODES.GOVERNANCE_KIND_INVALID,
				nodeId: n.id,
				message: `invalid governance "${governance}" (expected: ${governanceKindsLabel})`,
			});
		}

		const decision = nodeGovernanceDecision(n);
		if (decision && !isGovernanceDecisionV1(decision)) {
			errs.push({
				rule: "governance_decision",
				code: IDENTITY_RULE_CODES.GOVERNANCE_DECISION_INVALID,
				nodeId: n.id,
				message: `invalid governance_decision "${decision}" (expected: ${governanceDecisionsLabel})`,
			});
		}
	}
	return errs;
}

function validateAgentIdentityContract(g: Graph): ValidationError[] {
	const errs: ValidationError[] = [];

	for (const n of Object.values(g.nodes)) {
		const handlerType = nodeHandlerType(n);
		if (isTrustParticipatingHandlerType(handlerType)) {
			if (!isValidAgentIdentityField(n, AGENT_ID_ATTRIBUTE, AGENT_ID_PATTERN)) {
				errs.push({
					rule: "agent_id",
					nodeId: n.id,
					message: `invalid ${AGENT_ID_ATTRIBUTE} for trust-participating handler type "${handlerType}"`,
				});
			}
			if (!isValidAgentIdentityField(n, AGENT_VERSION_ATTRIBUTE, AGENT_VERSION_PATTERN)) {
				errs.push({
					rule: "agent_version",
					nodeId: n.id,
					message: `invalid ${AGENT_VERSION_ATTRIBUTE} for trust-participating handler type "${handlerType}"`,
				});
			}
			continue;
		}

		if (hasAgentIdentityAttributes(n)) {
			errs.push({
				rule: "agent_identity_scope",
				nodeId: n.id,
				message: `agent identity attrs are only allowed on trust-participating handlers (found "${handlerType}")`,
			});
		}
	}

	return errs;
}

function validateTrustTelemetryContract(g: Graph): ValidationError[] {
	const errs: ValidationError[] = [];
	for (const n of Object.values(g.nodes)) {
		const trustPartitionRaw = String(n.attrs["trust_partition"] || "").trim().toLowerCase();
		const trustDomainRaw = String(n.attrs["trust_domain"] || "").trim().toLowerCase();
		const trustRoleRaw = String(n.attrs["trust_role"] || "").trim().toLowerCase();

		if (!trustPartitionRaw) {
			errs.push({
				rule: "trust_partition",
				code: IDENTITY_RULE_CODES.TRUST_PARTITION_REQUIRED,
				nodeId: n.id,
				message: "missing trust_partition in strict mode",
			});
		} else if (trustPartitionRaw !== "builder" && trustPartitionRaw !== "judge") {
			errs.push({
				rule: "trust_partition",
				code: IDENTITY_RULE_CODES.TRUST_PARTITION_INVALID,
				nodeId: n.id,
				message: `invalid trust_partition \"${trustPartitionRaw}\" (expected: builder|judge)`,
			});
		}

		if (!trustDomainRaw) {
			errs.push({
				rule: "trust_domain",
				code: IDENTITY_RULE_CODES.TRUST_DOMAIN_REQUIRED,
				nodeId: n.id,
				message: "missing trust_domain in strict mode",
			});
		} else if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(trustDomainRaw)) {
			errs.push({
				rule: "trust_domain",
				code: IDENTITY_RULE_CODES.TRUST_DOMAIN_INVALID,
				nodeId: n.id,
				message: `invalid trust_domain \"${trustDomainRaw}\"`,
			});
		}

		if (!trustRoleRaw) {
			errs.push({
				rule: "trust_role",
				code: IDENTITY_RULE_CODES.TRUST_ROLE_REQUIRED,
				nodeId: n.id,
				message: "missing trust_role in strict mode",
			});
		} else if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\.[a-z0-9]+(?:[._-][a-z0-9]+)*)+$/.test(trustRoleRaw)) {
			errs.push({
				rule: "trust_role",
				code: IDENTITY_RULE_CODES.TRUST_ROLE_INVALID,
				nodeId: n.id,
				message: `invalid trust_role \"${trustRoleRaw}\"`,
			});
		}

		const isJudge = toBool(n.attrs["judge"]);
		if (trustPartitionRaw === "builder" && isJudge) {
			errs.push({
				rule: "trust_partition",
				code: IDENTITY_RULE_CODES.TRUST_PARTITION_MISMATCH,
				nodeId: n.id,
				message: "trust_partition=builder conflicts with judge=true",
			});
		}
		if (trustPartitionRaw === "judge" && !isJudge && !trustRoleRaw.includes(".judge")) {
			errs.push({
				rule: "trust_partition",
				code: IDENTITY_RULE_CODES.TRUST_PARTITION_MISMATCH,
				nodeId: n.id,
				message: "trust_partition=judge requires judge=true or trust_role containing .judge",
			});
		}
		if (trustDomainRaw && trustPartitionRaw && trustDomainRaw !== trustPartitionRaw) {
			errs.push({
				rule: "trust_domain",
				code: IDENTITY_RULE_CODES.TRUST_DOMAIN_ROLE_MISMATCH,
				nodeId: n.id,
				message: `trust_domain \"${trustDomainRaw}\" must match trust_partition \"${trustPartitionRaw}\"`,
			});
		}
		if (trustRoleRaw) {
			if (trustPartitionRaw === "judge" && !trustRoleRaw.includes(".judge")) {
				errs.push({
					rule: "trust_role",
					code: IDENTITY_RULE_CODES.TRUST_DOMAIN_ROLE_MISMATCH,
					nodeId: n.id,
					message: `trust_role \"${trustRoleRaw}\" must contain .judge for trust_partition=judge`,
				});
			}
			if (trustPartitionRaw === "builder" && trustRoleRaw.includes(".judge")) {
				errs.push({
					rule: "trust_role",
					code: IDENTITY_RULE_CODES.TRUST_DOMAIN_ROLE_MISMATCH,
					nodeId: n.id,
					message: `trust_role \"${trustRoleRaw}\" must not contain .judge for trust_partition=builder`,
				});
			}
		}
	}
	return errs;
}

function hasAgentIdentityAttributes(n: Node): boolean {
	return hasOwnAttr(n, AGENT_ID_ATTRIBUTE) || hasOwnAttr(n, AGENT_VERSION_ATTRIBUTE);
}

function hasOwnAttr(n: Node, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(n.attrs, key);
}

function isValidAgentIdentityField(n: Node, key: string, pattern: RegExp): boolean {
	if (!hasOwnAttr(n, key)) return false;
	const rawValue = n.attrs[key];
	if (typeof rawValue !== "string") return false;
	const trimmedValue = rawValue.trim();
	if (!trimmedValue) return false;
	if (rawValue !== trimmedValue) return false;
	return pattern.test(trimmedValue);
}

function validateDuplicateEdges(g: Graph): ValidationError[] {
	const seen = new Set<string>();
	const errs: ValidationError[] = [];
	for (const e of g.edges) {
		const key = `${e.from}|${e.to}|${edgeLabel(e)}`;
		if (seen.has(key)) {
			errs.push({
				rule: "duplicate_edges",
				message: `duplicate edge ${e.from} -> ${e.to} (label="${edgeLabel(e)}")`,
			});
		}
		seen.add(key);
	}
	return errs;
}

function validateWorktreeNodes(g: Graph): ValidationError[] {
	const errs: ValidationError[] = [];
	for (const n of Object.values(g.nodes)) {
		if (nodeHandlerType(n) !== "agent.worktree") continue;
		if (!n.attrs["repo"]) {
			errs.push({ rule: "worktree_attrs", nodeId: n.id, message: `agent.worktree node missing required "repo" attribute` });
		}
		if (!n.attrs["branch"]) {
			errs.push({ rule: "worktree_attrs", nodeId: n.id, message: `agent.worktree node missing required "branch" attribute` });
		}
	}
	return errs;
}

function validateComplexityEstimatorProvenance(g: Graph): ValidationError[] {
	const warnings: ValidationError[] = [];
	for (const edge of g.edges) {
		const condition = edgeCondition(edge);
		if (!condition || !conditionReferencesComplexityRoutingKey(condition)) continue;
		if (hasUpstreamComplexityEstimator(g, edge.from)) continue;
		warnings.push({
			rule: "complexity_estimator_provenance",
			nodeId: edge.from,
			severity: "warning",
			message:
				`edge ${edge.from} -> ${edge.to} uses condition "${condition}" on complexity routing key ` +
				`(${COMPLEXITY_CLASS_CONDITION_KEY}|${COMPLEXITY_LEGACY_CONDITION_KEY}) ` +
				`but no upstream estimator node is reachable from "${edge.from}". ` +
				`An estimator node must precede this complexity-based condition and emit ${COMPLEXITY_CLASS_CONDITION_KEY} ` +
				`(or legacy ${COMPLEXITY_LEGACY_CONDITION_KEY}) via output_key or outputs so routing has provenance.`,
		});
	}
	return warnings;
}

function conditionReferencesComplexityRoutingKey(condition: string): boolean {
	const parsed = parseCondition(condition);
	if (!parsed) return false;
	return parsed.clauses.some((clause) => COMPLEXITY_CONDITION_KEYS.has(clause.key));
}

function hasUpstreamComplexityEstimator(g: Graph, sourceNodeId: string): boolean {
	const queue = [sourceNodeId];
	const seen = new Set<string>();

	while (queue.length > 0) {
		const nodeId = queue.shift();
		if (!nodeId || seen.has(nodeId)) continue;
		seen.add(nodeId);

		const node = g.nodes[nodeId];
		if (!node) continue;
		if (nodeProducesComplexityRoutingKey(node)) return true;

		for (const incoming of incomingEdges(g, nodeId)) {
			if (!seen.has(incoming.from)) queue.push(incoming.from);
		}
	}

	return false;
}

function nodeProducesComplexityRoutingKey(node: Node): boolean {
	if (nodeHandlerType(node) !== "tool") return false;
	const outputKey = nodeOutputKey(node).trim();
	if (COMPLEXITY_CONDITION_KEYS.has(outputKey)) return true;
	const outputs = nodeOutputs(node)
		.split(",")
		.map((key) => key.trim())
		.filter(Boolean);
	return outputs.some((key) => COMPLEXITY_CONDITION_KEYS.has(key));
}

function toBool(value: unknown): boolean {
	const normalized = String(value || "").trim().toLowerCase();
	return normalized === "true" || normalized === "1" || normalized === "yes";
}

function validateSelfLoops(g: Graph): ValidationError[] {
	const errs: ValidationError[] = [];
	for (const e of g.edges) {
		if (e.from === e.to && !edgeLoopRestart(e)) {
			errs.push({
				rule: "self_loops",
				message: `self-loop on node "${e.from}" without loop_restart=true`,
			});
		}
	}
	return errs;
}
