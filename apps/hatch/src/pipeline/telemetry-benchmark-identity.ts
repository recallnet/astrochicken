export interface TelemetryBenchmarkIdentity {
	jobId: string;
	promptVersion: string;
	roleVersion: string;
	skillId: string;
}

const BENCHMARK_ENFORCED_EVENT_KINDS = new Set(["stage.start", "stage.finish", "stage.error", "stage.retry", "quality.signal"]);

export const BENCHMARK_IDENTITY_REQUIRED_FIELDS = [
	"factory_id",
	"graph_id",
	"node_id",
	"handler_type",
	"model",
	"provider",
	"prompt_hash",
	"job_id",
	"prompt_version",
	"role_version",
	"skill_id",
	"hatch.job_id",
	"hatch.prompt_version",
	"hatch.role_version",
	"hatch.skill_id",
] as const;

interface ResolveTelemetryBenchmarkIdentityArgs {
	data: Record<string, string>;
	nodeAttrs?: Record<string, string>;
	nodeSessionContext: { langfuse_skill_id: string };
	ctx: { get(key: string): string };
	skill: string;
	handlerType: string;
}

function eventOrHatch(data: Record<string, string>, plainKey: string, hatchKey: string): string {
	const plain = String(data[plainKey] || "").trim();
	if (plain) return plain;
	return String(data[hatchKey] || "").trim();
}

function firstNonEmpty(...values: Array<string | undefined>): string {
	for (const value of values) {
		const normalized = String(value || "").trim();
		if (normalized) return normalized;
	}
	return "";
}

export function resolveTelemetryBenchmarkIdentity(args: ResolveTelemetryBenchmarkIdentityArgs): TelemetryBenchmarkIdentity {
	const { data, nodeAttrs, nodeSessionContext, ctx, skill, handlerType } = args;
	return {
		jobId: firstNonEmpty(
			eventOrHatch(data, "job_id", "hatch.job_id"),
			nodeAttrs?.["benchmark_job_id"],
			ctx.get("benchmark_job_id"),
			ctx.get("job_id"),
		),
		promptVersion: firstNonEmpty(
			eventOrHatch(data, "prompt_version", "hatch.prompt_version"),
			nodeAttrs?.["prompt_version"],
			ctx.get("prompt_version"),
		),
		roleVersion: firstNonEmpty(
			eventOrHatch(data, "role_version", "hatch.role_version"),
			nodeAttrs?.["role_version"],
			ctx.get("role_version"),
		),
		skillId: firstNonEmpty(
			eventOrHatch(data, "skill_id", "hatch.skill_id"),
			nodeAttrs?.["skill_id"],
			data.langfuse_skill_id,
			nodeSessionContext.langfuse_skill_id,
			ctx.get("skill_id"),
			skill,
			handlerType,
		),
	};
}

export function applyTelemetryBenchmarkIdentity(data: Record<string, string>, identity: TelemetryBenchmarkIdentity): void {
	data.skill_id = String(data.skill_id || data["hatch.skill_id"] || data.langfuse_skill_id || identity.skillId || "");
	data["hatch.skill_id"] = String(data["hatch.skill_id"] || data.skill_id || identity.skillId || "");
	data.job_id = String(data.job_id || data["hatch.job_id"] || identity.jobId || "");
	data["hatch.job_id"] = String(data["hatch.job_id"] || data.job_id || identity.jobId || "");
	data.prompt_version = String(data.prompt_version || data["hatch.prompt_version"] || identity.promptVersion || "");
	data["hatch.prompt_version"] = String(data["hatch.prompt_version"] || data.prompt_version || identity.promptVersion || "");
	data.role_version = String(data.role_version || data["hatch.role_version"] || identity.roleVersion || "");
	data["hatch.role_version"] = String(data["hatch.role_version"] || data.role_version || identity.roleVersion || "");
}

export interface BenchmarkIdentityViolation {
	violation: true;
	eventKind: string;
	nodeId: string;
	jobId: string;
	missing: string[];
	message: string;
}

export function assertBenchmarkIdentityContract(args: {
	eventKind: string;
	data: Record<string, string>;
	nodeAttrs?: Record<string, string>;
}): BenchmarkIdentityViolation | null {
	const { eventKind, data, nodeAttrs } = args;
	if (!BENCHMARK_ENFORCED_EVENT_KINDS.has(eventKind)) return null;
	const benchmarkJobId = firstNonEmpty(
		String(nodeAttrs?.["benchmark_job_id"] || ""),
		String(data.job_id || ""),
		String(data["hatch.job_id"] || ""),
	);
	if (!benchmarkJobId) return null;

	const missing: string[] = BENCHMARK_IDENTITY_REQUIRED_FIELDS.filter((key) => !String(data[key] || "").trim());
	const hasModelPolicy = firstNonEmpty(
		String(data.model_policy_source || ""),
		String(data.model_policy_version || ""),
	);
	if (hasModelPolicy) {
		const policyRequired = [
			"model_policy_version",
			"model_policy_source",
			"model_policy_default_provider",
			"model_policy_default_model",
			"model_policy_selected_via",
			"model_policy_allowed_models",
		] as const;
		for (const key of policyRequired) {
			if (!String(data[key] || "").trim()) {
				missing.push(key);
			}
		}
	}
	if (missing.length === 0) return null;
	return {
		violation: true,
		eventKind,
		nodeId: String(data.node_id || ""),
		jobId: benchmarkJobId,
		missing,
		message: `benchmark_identity_contract_violation event=${eventKind} node=${String(data.node_id || "")} job_id=${benchmarkJobId} missing=${missing.join(",")}`,
	};
}
