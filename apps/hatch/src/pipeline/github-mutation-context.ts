import type { ActionExecutionRequest } from "./action-registry.js";

function resolveMutationIdentityValue(...values: Array<unknown>): string {
	for (const value of values) {
		const normalized = String(value || "").trim();
		if (normalized) return normalized;
	}
	return "";
}

export function buildGitHubMutationContext(request: ActionExecutionRequest, {
	factoryId = "",
	runId = "",
	capabilityVersion = "commit-04",
}: {
	factoryId?: string;
	runId?: string;
	capabilityVersion?: string;
} = {}) {
	const env = request.env || {};
	const resolvedFactoryId = resolveMutationIdentityValue(
		factoryId,
		request.ctx.get("factory_id"),
		request.ctx.get("factory"),
		env.HATCH_FACTORY_INSTANCE_ID,
		env.HATCH_FACTORY_ID,
		"factory",
	);
	const resolvedRunId = resolveMutationIdentityValue(
		runId,
		request.ctx.get("__run_id"),
		env.HATCH_RUN_ID,
		"local-run",
	);
	return {
		instance_id: resolvedFactoryId,
		// @context:regression !critical Example Trading goal decomposition failed before build execution
		// because goal.add_sub_issue reached the audited GitHub mutation boundary without a
		// populated installation_id; keep the action-layer mutation context explicit so the
		// shared adapter always receives stable attribution for create/update/link mutations.
		installation_id: resolveMutationIdentityValue(
			request.ctx.get("installation_id"),
			request.ctx.get("lease_installation_id"),
			env.HATCH_INSTALLATION_ID,
			`inst_${resolvedFactoryId || "factory"}`,
		),
		host_id: resolveMutationIdentityValue(
			request.ctx.get("host_id"),
			env.HATCH_HOST_ID,
			env.HOST_ID,
			"local-host",
		),
		run_id: resolvedRunId,
		tick_id: resolveMutationIdentityValue(
			request.ctx.get("tick_id"),
			env.HATCH_TICK_ID,
			resolvedRunId,
		),
		destination_name: resolveMutationIdentityValue(
			request.ctx.get("destination_name"),
			"github",
		),
		capability_version: resolveMutationIdentityValue(
			request.ctx.get("capability_version"),
			env.HATCH_CAPABILITY_VERSION,
			capabilityVersion,
		),
		policy_profile: resolveMutationIdentityValue(
			request.ctx.get("policy_profile"),
			env.HATCH_POLICY_PROFILE,
			"default",
		),
		runtime_version: resolveMutationIdentityValue(
			request.ctx.get("runtime_version"),
			env.HATCH_RUNTIME_VERSION,
			"dev",
		),
	};
}
