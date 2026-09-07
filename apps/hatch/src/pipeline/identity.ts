export const IDENTITY_MODES = ["legacy", "strict"] as const;
export type IdentityMode = (typeof IDENTITY_MODES)[number];

export const DEFAULT_IDENTITY_MODE: IdentityMode = "legacy";

const IDENTITY_MODE_SET = new Set<string>(IDENTITY_MODES);

export function isIdentityMode(value: string): value is IdentityMode {
	return IDENTITY_MODE_SET.has(value);
}

export const IRREVERSIBLE_HANDLER_TYPES_V1 = ["tool", "stack.manager_loop", "agent.worktree", "agent.kw"] as const;
export type IrreversibleHandlerTypeV1 = (typeof IRREVERSIBLE_HANDLER_TYPES_V1)[number];

const IRREVERSIBLE_HANDLER_TYPES_V1_SET = new Set<string>(IRREVERSIBLE_HANDLER_TYPES_V1);

export function isIrreversibleHandlerTypeV1(value: string): value is IrreversibleHandlerTypeV1 {
	return IRREVERSIBLE_HANDLER_TYPES_V1_SET.has(value);
}

export const IDENTITY_RULE_CODES = {
	MODE_INVALID: "identity.mode.invalid",
	TOOL_ID_INVALID: "identity.tool_id.invalid",
	TOOL_ID_REQUIRED: "identity.tool_id.required",
	ACTION_ID_INVALID: "identity.action_id.invalid",
	ACTION_ID_REQUIRED: "identity.action_id.required",
	GOVERNANCE_REQUIRED: "identity.governance.required",
	GOVERNANCE_KIND_INVALID: "identity.governance.invalid",
	GOVERNANCE_DECISION_INVALID: "identity.governance_decision.invalid",
	TRUST_PARTITION_REQUIRED: "identity.trust_partition.required",
	TRUST_PARTITION_INVALID: "identity.trust_partition.invalid",
	TRUST_DOMAIN_REQUIRED: "identity.trust_domain.required",
	TRUST_DOMAIN_INVALID: "identity.trust_domain.invalid",
	TRUST_ROLE_REQUIRED: "identity.trust_role.required",
	TRUST_ROLE_INVALID: "identity.trust_role.invalid",
	TRUST_PARTITION_MISMATCH: "identity.trust_partition.mismatch",
	TRUST_DOMAIN_ROLE_MISMATCH: "identity.trust_domain_role.mismatch",
} as const;

export type IdentityRuleCode = (typeof IDENTITY_RULE_CODES)[keyof typeof IDENTITY_RULE_CODES];
