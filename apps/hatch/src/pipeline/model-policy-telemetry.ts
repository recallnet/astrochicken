export interface ResolveModelPolicyTelemetryArgs {
	eventData: Record<string, string>;
	context: { get(key: string): string };
	nodeAttrs?: Record<string, string>;
}

export function resolveModelPolicyTelemetryFields(
	args: ResolveModelPolicyTelemetryArgs,
): Record<string, string> | undefined {
	const { eventData, context, nodeAttrs } = args;
	const contextHasNodeOverride = Boolean(
		nodeAttrs?.["llm_model"]
		|| nodeAttrs?.["llm_provider"]
		|| nodeAttrs?.["agent_model"]
		|| nodeAttrs?.["agent_provider"],
	);
	const modelPolicyVersion = String(eventData.model_policy_version || context.get("model_policy_version") || "");
	const modelPolicySource = String(eventData.model_policy_source || context.get("model_policy_source") || "");
	const modelPolicyDefaultProvider = String(
		eventData.model_policy_default_provider || context.get("model_policy_default_provider") || "",
	);
	const modelPolicyDefaultModel = String(
		eventData.model_policy_default_model || context.get("model_policy_default_model") || "",
	);
	const modelPolicyAllowedModels = String(
		eventData.model_policy_allowed_models || context.get("model_policy_allowed_models") || "",
	);
	const modelPolicySelectedVia = String(
		eventData.model_policy_selected_via
		|| (contextHasNodeOverride ? "node_override" : context.get("model_policy_selected_via"))
		|| "",
	);
	const modelPolicyPackDir = String(
		eventData.model_policy_policy_pack_dir || context.get("model_policy_policy_pack_dir") || "",
	);
	if (
		!modelPolicyVersion
		&& !modelPolicySource
		&& !modelPolicyDefaultProvider
		&& !modelPolicyDefaultModel
		&& !modelPolicyAllowedModels
		&& !modelPolicySelectedVia
	) {
		return undefined;
	}
	return {
		model_policy_version: modelPolicyVersion,
		model_policy_source: modelPolicySource,
		model_policy_default_provider: modelPolicyDefaultProvider,
		model_policy_default_model: modelPolicyDefaultModel,
		model_policy_allowed_models: modelPolicyAllowedModels,
		model_policy_selected_via: modelPolicySelectedVia,
		model_policy_policy_pack_dir: modelPolicyPackDir,
	};
}
