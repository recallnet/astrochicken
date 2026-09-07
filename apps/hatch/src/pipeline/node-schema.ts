/**
 * Node schema validation — typed attribute contracts per handler type.
 *
 * Catches:
 * - Boolean attributes with non-boolean values (e.g., fail_open="tru")
 * - Enum attributes with invalid values (e.g., governance="reversble")
 * - Integer attributes with non-integer values (e.g., max_retries="three")
 * - Missing required attributes per handler type (e.g., pipeline without prompt)
 * - Cross-attribute constraint violations (e.g., irreversible without recovery_owner)
 */
import { nodeHandlerType } from "./graph.js";
import type { Graph, Node } from "./graph.js";
import type { ValidationError } from "./validate.js";

// ── Rule codes ──

export const NODE_SCHEMA_RULE_CODES = {
	BOOLEAN_INVALID: "schema.boolean.invalid",
	ENUM_INVALID: "schema.enum.invalid",
	INTEGER_INVALID: "schema.integer.invalid",
	REQUIRED_ATTRIBUTE_MISSING: "schema.required.missing",
	IN_PROCESS_TOOL_REQUIRES_ACTION_ID: "schema.tool.in_process_requires_action_id",
	IRREVERSIBLE_WITHOUT_RECOVERY_OWNER: "schema.governance.irreversible_without_recovery_owner",
	FAIL_OPEN_ON_EXIT: "schema.fail_open.exit_node",
	FAIL_OPEN_ON_STRUCTURAL: "schema.fail_open.structural_node",
} as const;

// ── Attribute type definitions ──

const BOOLEAN_ATTRIBUTES = new Set([
	"fail_open",
	"goal_gate",
	"auto_status",
	"allow_partial",
	"judge",
	"cleanup_on_success",
	"skip_prompt_if_commits_exist",
	"reuse_existing_commits",
	"inherit_context",
]);

const VALID_BOOLEAN_VALUES = new Set(["true", "false"]);

const ENUM_ATTRIBUTES: Record<string, readonly string[]> = {
	governance: ["reversible", "irreversible"],
	governance_decision: ["allow", "review", "deny"],
	recovery_sink_type: ["wait", "terminal"],
	reasoning_effort: ["low", "medium", "high"],
	complexity_class: ["low", "medium", "high"],
	action_runtime: ["shell", "in_process"],
};

const INTEGER_ATTRIBUTES = new Set([
	"max_retries",
	"max_concurrency",
]);

/**
 * Required attributes per handler type.
 *
 * Each entry is an array of attribute sets — the node must have at least one
 * attribute from each set. A single-element array means that exact attribute
 * is required. A multi-element array means any one of those attributes
 * satisfies the requirement (e.g., prompt OR prompt_source).
 */
const REQUIRED_ATTRIBUTES_BY_TYPE: Record<string, string[][]> = {
	pipeline: [["prompt", "pipeline"]],
	"fan_out.dynamic": [["template"], ["source_key"]],
	"agent.worktree": [["repo"], ["branch"]],
};

/** Handler types where fail_open is nonsensical. */
const FAIL_OPEN_FORBIDDEN_TYPES = new Set(["exit"]);
const FAIL_OPEN_STRUCTURAL_TYPES = new Set(["start", "conditional", "parallel.fan_in"]);

// ── Validation ──

export function validateNodeSchemaContract(g: Graph): ValidationError[] {
	const errors: ValidationError[] = [];
	for (const n of Object.values(g.nodes)) {
		validateBooleanAttributes(n, errors);
		validateEnumAttributes(n, errors);
		validateIntegerAttributes(n, errors);
		validateRequiredAttributes(n, errors);
		validateCrossAttributeConstraints(n, errors);
	}
	return errors;
}

function validateBooleanAttributes(n: Node, errors: ValidationError[]): void {
	for (const attr of BOOLEAN_ATTRIBUTES) {
		const value = n.attrs[attr];
		if (value === undefined) continue;
		const normalized = value.trim().toLowerCase();
		if (!VALID_BOOLEAN_VALUES.has(normalized)) {
			errors.push({
				rule: "node_schema",
				code: NODE_SCHEMA_RULE_CODES.BOOLEAN_INVALID,
				nodeId: n.id,
				message: `attribute "${attr}" must be "true" or "false", got "${value}"`,
			});
		}
	}
}

function validateEnumAttributes(n: Node, errors: ValidationError[]): void {
	for (const [attr, validValues] of Object.entries(ENUM_ATTRIBUTES)) {
		const value = n.attrs[attr];
		if (value === undefined) continue;
		const normalized = value.trim().toLowerCase();
		if (!normalized) continue;
		if (!validValues.includes(normalized)) {
			errors.push({
				rule: "node_schema",
				code: NODE_SCHEMA_RULE_CODES.ENUM_INVALID,
				nodeId: n.id,
				message: `attribute "${attr}" has invalid value "${value}" (expected: ${validValues.join(", ")})`,
			});
		}
	}
}

function validateIntegerAttributes(n: Node, errors: ValidationError[]): void {
	for (const attr of INTEGER_ATTRIBUTES) {
		const value = n.attrs[attr];
		if (value === undefined) continue;
		const trimmed = value.trim();
		if (!trimmed) continue;
		// Template variables ({{...}}) are valid placeholders in design templates and stylesheets;
		// skip integer validation for them so design-time docs are not rejected as broken graphs.
		if (/^\{\{[^}]+\}\}$/.test(trimmed)) continue;
		if (!/^\d+$/.test(trimmed)) {
			errors.push({
				rule: "node_schema",
				code: NODE_SCHEMA_RULE_CODES.INTEGER_INVALID,
				nodeId: n.id,
				message: `attribute "${attr}" must be a non-negative integer, got "${value}"`,
			});
		}
	}
}

function validateRequiredAttributes(n: Node, errors: ValidationError[]): void {
	const handlerType = nodeHandlerType(n);
	const required = REQUIRED_ATTRIBUTES_BY_TYPE[handlerType];
	if (!required) return;

	for (const attrSet of required) {
		const hasAny = attrSet.some((attr) => {
			const value = n.attrs[attr];
			return value !== undefined && value.trim() !== "";
		});
		if (!hasAny) {
			const label = attrSet.length === 1
				? `missing required attribute "${attrSet[0]}"`
				: `missing required attribute (one of: ${attrSet.join(", ")})`;
			errors.push({
				rule: "node_schema",
				code: NODE_SCHEMA_RULE_CODES.REQUIRED_ATTRIBUTE_MISSING,
				nodeId: n.id,
				message: `${handlerType} node ${label}`,
			});
		}
	}
}

function validateCrossAttributeConstraints(n: Node, errors: ValidationError[]): void {
	const handlerType = nodeHandlerType(n);
	const governance = (n.attrs["governance"] ?? "").trim().toLowerCase();
	const recoveryOwner = (n.attrs["recovery_owner"] ?? "").trim();
	const failOpen = (n.attrs["fail_open"] ?? "").trim().toLowerCase();
	const actionRuntime = (n.attrs["action_runtime"] ?? "").trim().toLowerCase();
	const prompt = (n.attrs["prompt"] ?? "").trim();
	const promptSource = (n.attrs["prompt_source"] ?? "").trim();
	const actionId = (n.attrs["action_id"] ?? "").trim();

	// governance="irreversible" should have recovery_owner
	if (governance === "irreversible" && !recoveryOwner) {
		errors.push({
			rule: "node_schema",
			code: NODE_SCHEMA_RULE_CODES.IRREVERSIBLE_WITHOUT_RECOVERY_OWNER,
			nodeId: n.id,
			severity: "warning",
			message: `governance="irreversible" should have recovery_owner attribute`,
		});
	}

	// fail_open on exit nodes is nonsensical
	if (failOpen === "true" && FAIL_OPEN_FORBIDDEN_TYPES.has(handlerType)) {
		errors.push({
			rule: "node_schema",
			code: NODE_SCHEMA_RULE_CODES.FAIL_OPEN_ON_EXIT,
			nodeId: n.id,
			message: `fail_open="true" is not valid on ${handlerType} nodes`,
		});
	}

	// fail_open on structural nodes (start, conditional, fan_in) is nonsensical
	if (failOpen === "true" && FAIL_OPEN_STRUCTURAL_TYPES.has(handlerType)) {
		errors.push({
			rule: "node_schema",
			code: NODE_SCHEMA_RULE_CODES.FAIL_OPEN_ON_STRUCTURAL,
			nodeId: n.id,
			message: `fail_open="true" is not valid on ${handlerType} nodes`,
		});
	}

	if (handlerType === "tool") {
		if (actionRuntime === "in_process") {
			if (!actionId) {
				errors.push({
					rule: "node_schema",
					code: NODE_SCHEMA_RULE_CODES.IN_PROCESS_TOOL_REQUIRES_ACTION_ID,
					nodeId: n.id,
					message: `tool node with action_runtime="in_process" requires action_id`,
				});
			}
		} else if (!prompt && !promptSource) {
			errors.push({
				rule: "node_schema",
				code: NODE_SCHEMA_RULE_CODES.REQUIRED_ATTRIBUTE_MISSING,
				nodeId: n.id,
				message: `tool node missing required attribute (one of: prompt, prompt_source)`,
			});
		}
	}
}
