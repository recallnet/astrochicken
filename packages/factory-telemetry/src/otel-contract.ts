export interface GovernedOtelCorrelation {
	factory_id: string;
	run_id: string;
	workflow_id: string;
	capability_id: string;
	owner: string;
}

export interface GovernedOtelContract {
	schema_version: string;
	required_correlation_attributes: string[];
	naming: {
		event_name_pattern: string;
		span_name_pattern: string;
		metric_name_pattern: string;
		attribute_key_pattern: string;
	};
	allowed_attribute_keys: string[];
}

export const OTEL_TAXONOMY_CONTRACT: GovernedOtelContract = {
	schema_version: "otel_taxonomy_contract/v1",
	required_correlation_attributes: [
		"factory_id",
		"run_id",
		"workflow_id",
		"capability_id",
		"owner",
	],
	naming: {
		event_name_pattern: "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9_]*)+$",
		span_name_pattern: "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9_]*)+$",
		metric_name_pattern: "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9_]*)+$",
		attribute_key_pattern: "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$",
	},
	allowed_attribute_keys: [
		"artifact_type",
		"bug_count",
		"bug_type",
		"capability_id",
		"classification",
		"control_gate",
		"control_plane_repo",
		"dedup_decision",
		"event_type",
		"factory_id",
		"failure_classification",
		"fallback_node",
		"fixed_count",
		"health_state",
		"target_repo",
		"host_id",
		"incident_classification",
		"incident_crash_type",
		"incident_fingerprint",
		"incident_host_id",
		"incident_instance_id",
		"incident_kind_id",
		"incident_severity",
		"installation_id",
		"instance_id",
		"issue_number",
		"issue_state",
		"judge.error",
		"judge.fail_forward",
		"judge.fallback",
		"judge.original_disposition",
		"kind_id",
		"kind_version",
		"lifecycle_state",
		"orphan_count",
		"owner",
		"pipeline",
		"policy_profile",
		"repo",
		"run_id",
		"runtime_version",
		"schema",
		"severity",
		"signature_hash",
		"source_factory",
		"source_repo",
		"status",
		"suggested_action",
		"summary",
		"trace_id",
		"target_repo",
		"tick_id",
		"trigger_reason",
		"workflow_id",
	],
};

const requiredCorrelationKeys = new Set(OTEL_TAXONOMY_CONTRACT.required_correlation_attributes);
const allowedAttributeKeys = new Set(OTEL_TAXONOMY_CONTRACT.allowed_attribute_keys);
const eventNamePattern = new RegExp(OTEL_TAXONOMY_CONTRACT.naming.event_name_pattern);
const attributeKeyPattern = new RegExp(OTEL_TAXONOMY_CONTRACT.naming.attribute_key_pattern);

function trim(value: unknown): string {
	return String(value ?? "").trim();
}

export function validateGovernedOtelCorrelation(correlation: Partial<GovernedOtelCorrelation> = {}): string[] {
	const diagnostics: string[] = [];
	for (const key of requiredCorrelationKeys) {
		if (!trim(correlation[key as keyof GovernedOtelCorrelation])) diagnostics.push(`missing_correlation:${key}`);
	}
	return diagnostics;
}

export function validateGovernedOtelAttributes(attributes: Record<string, unknown> = {}): string[] {
	const diagnostics: string[] = [];
	for (const key of Object.keys(attributes)) {
		if (!attributeKeyPattern.test(key)) diagnostics.push(`invalid_attribute_key_pattern:${key}`);
		if (!allowedAttributeKeys.has(key)) diagnostics.push(`unknown_attribute_key:${key}`);
	}
	return diagnostics;
}

export function validateGovernedOtelEventName(eventName = ""): string[] {
	return eventNamePattern.test(trim(eventName)) ? [] : [`invalid_event_name:${trim(eventName) || "missing"}`];
}

export function stringifyGovernedOtelAttributes(
	correlation: Partial<GovernedOtelCorrelation> = {},
	attributes: Record<string, unknown> = {},
): Record<string, string> {
	const merged = {
		...attributes,
		...Object.fromEntries(
			Object.entries(correlation).map(([key, value]) => [key, trim(value)]),
		),
	};
	return Object.fromEntries(Object.entries(merged).map(([key, value]) => [key, trim(value)]));
}
