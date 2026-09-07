import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { Context } from "../context.js";
import { CodergenHandler } from "./codergen.js";
import { ManagerLoopHandler } from "./manager.js";
import { KnowledgeWorkerHandler } from "./worktree.js";

import { resolveModelPolicyForNode, type EffectiveModelPolicy } from "../../factory/model-policy.js";

const policy: EffectiveModelPolicy = {
	defaultProvider: "openrouter",
	defaultModel: "openai/gpt-5.3-codex",
	allowedModels: ["openai/gpt-5.3-codex"],
	preferredModel: "openai/gpt-5.3-codex",
	providerOrder: ["openrouter"],
	selectedVia: "policy_default",
	policyDefaultProvider: "openrouter",
	policyDefaultModel: "openai/gpt-5.3-codex",
	policySource: {
		configPath: "factories/mothership/factory.config.json",
		policyPackDir: "factories/mothership/policy-pack/v1",
		policyVersion: "v1",
	},
};

const baseConfig = {
	modelRegistry: { find: () => ({ id: "stub" }) },
	authStorage: {},
	resourceLoader: {},
	defaultModel: policy.defaultModel,
	defaultProvider: policy.defaultProvider,
	modelPolicy: policy,
};

function resolveRepoRootFromCwd(): string {
	let current = resolve(process.cwd());
	while (true) {
		if (existsSync(join(current, "factories", "mothership", "factory.config.json"))) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) {
			throw new Error("unable to locate repo root with factories/mothership/factory.config.json");
		}
		current = parent;
	}
}

describe("handler model policy enforcement", () => {
	it("resolves node-aware routing provenance for handler-level overrides", () => {
		const repoRoot = resolveRepoRootFromCwd();
		const graphPath = join(repoRoot, "factories", "mothership", "graphs", "factory_supervisor_tick.dot");
		const resolved = resolveModelPolicyForNode({
			pipelineFile: graphPath,
			handlerType: "codergen",
			nodeId: "codergen-node",
			llm_path_id: "goal.execute",
			nodeAttrs: {
				llm_provider: "openrouter",
				llm_model: "openai/gpt-5.3-codex",
			},
		});

		expect(resolved).toBeTruthy();
		expect(resolved?.selectedVia).toBe("node_override");
		expect(resolved?.winningLayer).toBe("node_override");
		expect(resolved?.effectiveProvider).toBe("openrouter");
		expect(resolved?.effectiveModel).toBe("openai/gpt-5.3-codex");
		expect(resolved?.appliedOverrides.some((entry) => entry.layer === "node_override")).toBe(true);
	});

	it("codergen rejects node-level model override outside allowed_models", async () => {
		const handler = new CodergenHandler(baseConfig as any);
		await expect(
			handler.execute(
				new AbortController().signal,
				{
					id: "codergen-node",
					attrs: {
						llm_provider: "openrouter",
						llm_model: "anthropic/claude-opus-4-1",
						prompt: "test",
					},
				},
				new Context(),
				"",
			),
		).rejects.toThrow(/model-policy.*violates allowed_models.*factories\/mothership\/factory.config.json.*version=v1/);
	});

	it("manager rejects node-level provider override outside provider_order", async () => {
		const handler = new ManagerLoopHandler({
			...baseConfig,
			workDir: ".",
		} as any);
		await expect(
			handler.execute(
				new AbortController().signal,
				{
					id: "manager-node",
					attrs: {
						llm_provider: "anthropic",
						llm_model: "openai/gpt-5.3-codex",
						prompt: "test",
					},
				},
				new Context(),
				"",
			),
		).rejects.toThrow(/model-policy.*violates provider_order.*factories\/mothership\/factory.config.json.*version=v1/);
	});

	it("agent.kw rejects node-level provider override outside provider_order", async () => {
		const handler = new KnowledgeWorkerHandler({
			...baseConfig,
			workDir: ".",
		} as any);
		await expect(
			handler.execute(
				new AbortController().signal,
				{
					id: "kw-node",
					attrs: {
						llm_provider: "anthropic",
						llm_model: "openai/gpt-5.3-codex",
						prompt: "test",
					},
				},
				new Context(),
				"",
			),
		).rejects.toThrow(/model-policy.*violates provider_order.*factories\/mothership\/factory.config.json.*version=v1/);
	});
});
