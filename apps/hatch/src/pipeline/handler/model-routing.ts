import type { EffectiveModelPolicy, ModelPolicySelectedVia } from "../../factory/model-policy.js";

export interface ModelAttempt {
	provider: string;
	modelId: string;
	selectedVia: ModelPolicySelectedVia;
	fallbackPhase: "primary" | "safe_fallback";
	chainIndex: number;
}

export function buildModelAttemptChain(args: {
	defaultProvider: string;
	defaultModel: string;
	policy?: EffectiveModelPolicy;
	nodeProviderOverride?: string;
	nodeModelOverride?: string;
}): ModelAttempt[] {
	const nodeProviderOverride = trim(args.nodeProviderOverride);
	const nodeModelOverride = trim(args.nodeModelOverride);
	const selectedVia: ModelPolicySelectedVia = nodeProviderOverride || nodeModelOverride
		? "node_override"
		: (args.policy?.selectedVia ?? "policy_default");
	const providers = nodeProviderOverride
		? [nodeProviderOverride]
		: orderedProviders(args.defaultProvider, args.policy?.providerOrder ?? []);
	const primaryModel = nodeModelOverride || trim(args.defaultModel);
	const attempts: ModelAttempt[] = [];

	for (const provider of providers) {
		attempts.push({
			provider,
			modelId: primaryModel,
			selectedVia,
			fallbackPhase: "primary",
			chainIndex: attempts.length,
		});
	}

	const safeFallbackModel = trim(args.policy?.safeFallbackModel);
	if (safeFallbackModel && safeFallbackModel !== primaryModel) {
		for (const provider of providers) {
			attempts.push({
				provider,
				modelId: safeFallbackModel,
				selectedVia,
				fallbackPhase: "safe_fallback",
				chainIndex: attempts.length,
			});
		}
	}

	return attempts;
}

export function isRetryableModelFailureMessage(message: string): boolean {
	const normalized = trim(message).toLowerCase();
	if (!normalized) return false;
	return /401|403|429|auth|unauthori[sz]ed|forbidden|credential|oauth|api key|rate limit|quota|unavailable|overloaded|temporarily unavailable|not found|could not resolve model/.test(normalized);
}

function orderedProviders(defaultProvider: string, providerOrder: string[]): string[] {
	const seen = new Set<string>();
	const ordered: string[] = [];
	for (const candidate of [defaultProvider, ...providerOrder]) {
		const normalized = trim(candidate);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		ordered.push(normalized);
	}
	return ordered;
}

function trim(value: string | undefined): string {
	return String(value || "").trim();
}
