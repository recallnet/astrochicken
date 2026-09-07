import { describe, expect, it } from "vitest";

import {
	buildModelAttemptChain,
	isRetryableModelFailureMessage,
} from "./model-routing.js";

import type { EffectiveModelPolicy } from "../../factory/model-policy.js";

const basePolicy: EffectiveModelPolicy = {
	defaultProvider: "openai",
	defaultModel: "gpt-5.4",
	allowedModels: ["gpt-5.4", "gpt-4.1"],
	preferredModel: "gpt-5.4",
	providerOrder: ["openai", "openrouter"],
	safeFallbackModel: "gpt-4.1",
	selectedVia: "policy_default",
	policyDefaultProvider: "openai",
	policyDefaultModel: "gpt-5.4",
	policySource: {
		configPath: "factories/mothership/factory.config.json",
		policyPackDir: "factories/mothership/policy-pack/v1",
		policyVersion: "v1",
	},
};

describe("model routing", () => {
	it("builds provider-order attempts followed by safe fallback model attempts", () => {
		const attempts = buildModelAttemptChain({
			defaultProvider: "openai",
			defaultModel: "gpt-5.4",
			policy: basePolicy,
			nodeModelOverride: "",
			nodeProviderOverride: "",
		});

		expect(attempts).toEqual([
			{ provider: "openai", modelId: "gpt-5.4", selectedVia: "policy_default", fallbackPhase: "primary", chainIndex: 0 },
			{ provider: "openrouter", modelId: "gpt-5.4", selectedVia: "policy_default", fallbackPhase: "primary", chainIndex: 1 },
			{ provider: "openai", modelId: "gpt-4.1", selectedVia: "policy_default", fallbackPhase: "safe_fallback", chainIndex: 2 },
			{ provider: "openrouter", modelId: "gpt-4.1", selectedVia: "policy_default", fallbackPhase: "safe_fallback", chainIndex: 3 },
		]);
	});

	it("honors node provider override as a single-provider chain", () => {
		const attempts = buildModelAttemptChain({
			defaultProvider: "openai",
			defaultModel: "gpt-5.4",
			policy: basePolicy,
			nodeModelOverride: "gpt-5.4",
			nodeProviderOverride: "anthropic",
		});

		expect(attempts).toEqual([
			{ provider: "anthropic", modelId: "gpt-5.4", selectedVia: "node_override", fallbackPhase: "primary", chainIndex: 0 },
			{ provider: "anthropic", modelId: "gpt-4.1", selectedVia: "node_override", fallbackPhase: "safe_fallback", chainIndex: 1 },
		]);
	});

	it("classifies auth and availability failures as retryable", () => {
		expect(isRetryableModelFailureMessage("401 unauthorized")).toBe(true);
		expect(isRetryableModelFailureMessage("provider unavailable")).toBe(true);
		expect(isRetryableModelFailureMessage("429 rate limit exceeded")).toBe(true);
		expect(isRetryableModelFailureMessage("syntax error in prompt")).toBe(false);
	});
});
