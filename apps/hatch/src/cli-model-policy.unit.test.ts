import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveHandlerModelPolicy } from "./cli/handler-model-policy.js";
import type { FactoryContext } from "./factory/context-resolver.js";

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value, null, 2));
}

function writePolicyPack(factoryRoot: string): void {
	const policyPackDir = join(factoryRoot, "policy-pack", "v1");
	mkdirSync(policyPackDir, { recursive: true });
	writeJson(join(policyPackDir, "metadata.json"), {
		version: "v1",
		owned_by: "factory-platform",
		files: {
			model: "model-policy.json",
		},
		required_keys: {
			model: [
				"shared.default_provider",
				"shared.default_model",
				"shared.override_env_vars.provider",
				"shared.override_env_vars.model",
			],
		},
		customizable_keys: {
			model: [
				"factory.allowed_models",
				"factory.preferred_model",
				"factory.provider_order",
			],
		},
	});
	writeJson(join(policyPackDir, "model-policy.json"), {
		shared: {
			default_provider: "openrouter",
			default_model: "openai/gpt-5.3-codex",
			override_env_vars: {
				provider: "HATCH_MODEL_PROVIDER",
				model: "HATCH_MODEL",
			},
		},
		factory: {
			allowed_models: ["openai/gpt-5.3-codex"],
			preferred_model: "openai/gpt-5.3-codex",
			provider_order: ["openrouter"],
		},
	});
}

describe("cli handler model policy resolution", () => {
	let root = "";

	afterEach(() => {
		if (!root) return;
		rmSync(root, { recursive: true, force: true });
		root = "";
	});

	it("uses explicit factory context policy for shared managed graphs", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-cli-model-policy-"));
		const factoryRoot = join(root, "factories", "example-trading");
		const factoryConfigPath = join(factoryRoot, "factory.config.json");
		writeJson(factoryConfigPath, {
			schema: "hatch.factory.config.v1",
			factory_id: "example-trading",
			target_repo: "example-org/example-trading",
			control_plane_repo: "recallnet/astrochicken",
			dispatch: { graph: "packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs" },
			skills: { supervisor: "packages/factory-skills/skills/runtime/supervisor_review/SKILL.md" },
			scenarios: { root: "packages/factory-runtime/scenarios/managed_software_delivery" },
			pipeline: { supervisor_tick: "packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs" },
			runs_dir: ".hatch/example-trading/runs",
			trust: {
				domain: "example-trading.local",
				roles: ["example-trading.local.tool", "example-trading.local.codergen"],
			},
			policyPack: {
				version: "v1",
				overrides: {
					model: {
						factory: {
							preferred_model: "openai/gpt-5.3-codex",
							allowed_models: ["openai/gpt-5.3-codex"],
							provider_order: ["openrouter"],
						},
					},
				},
			},
		});
		writePolicyPack(factoryRoot);

		const sharedGraphPath = resolve(import.meta.dirname, "../../../packages/factory-runtime/workflows/managed_supervisor/managed_supervisor.workflow-source.mjs");
		const factoryContext: FactoryContext = {
			factory_root: factoryRoot,
			factory_config_path: factoryConfigPath,
			factory_id: "example-trading",
			target_repo: "example-org/example-trading",
			control_plane_repo: "recallnet/astrochicken",
			runs_dir: join(root, ".hatch", "example-trading", "runs"),
			scenarios_root: join(root, "packages", "factory-runtime", "scenarios", "managed_software_delivery"),
			repo: join(root, "workspace", "example-trading"),
			trust_domain: "example-trading.local",
			trust_role: "example-trading.local.tool",
			factory_mode: "managed",
			factory_mode_source: [],
		};

		const policy = resolveHandlerModelPolicy({
			pipelineFile: sharedGraphPath,
			factoryContext,
			env: {},
		});

		expect(policy).toBeTruthy();
		expect(policy?.defaultProvider).toBe("openrouter");
		expect(policy?.defaultModel).toBe("openai/gpt-5.3-codex");
		expect(policy?.policySource.configPath).toBe(factoryConfigPath);
	});
});
