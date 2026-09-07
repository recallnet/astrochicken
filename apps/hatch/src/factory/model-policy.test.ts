import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	ModelPolicyError,
	assertModelSelectionAllowed,
	resolveEffectiveModelPolicyForFactoryConfig,
	resolveEffectiveModelPolicyForPipeline,
	resolveModelPolicyForNode,
} from "./model-policy.js";
import { nodeHandlerType } from "../pipeline/graph.js";
import { parseWithAst } from "../pipeline/parse.js";
import { applyGraphStylesheetImports } from "../pipeline/stylesheet-imports.js";

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value, null, 2));
}

function validFactoryConfig(overrides?: Record<string, unknown>): Record<string, unknown> {
	return {
		schema: "hatch.factory.config.v1",
		factory_id: "policy-factory",
		target_repo: "recallnet/astrochicken",
		control_plane_repo: "recallnet/astrochicken",
		dispatch: {
			graph: "factories/policy-factory/graphs/factory_supervisor_tick.dot",
		},
		skills: {
			supervisor: "factories/policy-factory/skills/supervisor/current.md",
		},
		scenarios: {
			root: "factories/policy-factory/scenarios/policy-factory",
		},
		pipeline: {
			supervisor_tick: "factories/policy-factory/graphs/factory_supervisor_tick.dot",
		},
		runs_dir: ".hatch/policy-factory/runs",
		trust: {
			domain: "policy-factory.local",
			roles: ["policy-factory.local.tool"],
		},
		policyPack: {
			version: "v1",
			overrides: {},
		},
		...(overrides || {}),
	};
}

function writePolicyPack(factoryRoot: string, modelPolicy: Record<string, unknown>): void {
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
				"factory.benchmark_justification.query_ids",
				"factory.benchmark_justification.evidence_date",
				"factory.benchmark_justification.notes",
				"factory.safe_fallback_model",
			],
		},
	});
	writeJson(join(policyPackDir, "model-policy.json"), modelPolicy);
}

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

describe("factory model policy resolver", () => {
	let root = "";

	afterEach(() => {
		if (!root) return;
		rmSync(root, { recursive: true, force: true });
		root = "";
	});

	it("resolves nearest factory policy and applies model overrides", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-model-policy-"));
		const factoryRoot = join(root, "factories", "policy-factory");
		const graphDir = join(factoryRoot, "graphs", "nested");
		mkdirSync(graphDir, { recursive: true });
		writeJson(join(factoryRoot, "factory.config.json"), validFactoryConfig({
			policyPack: {
				version: "v1",
				overrides: {
					model: {
						factory: {
							preferred_model: "anthropic/claude-sonnet-4-6",
							allowed_models: ["openai/gpt-5.3-codex", "anthropic/claude-sonnet-4-6"],
							provider_order: ["openrouter", "anthropic"],
							benchmark_justification: {
								query_ids: ["cross_factory_benchmark", "model_comparison"],
								evidence_date: "2026-03-11",
								notes: "override benchmark evidence",
							},
							safe_fallback_model: "anthropic/claude-sonnet-4-6",
						},
					},
				},
			},
		}));
		writePolicyPack(factoryRoot, {
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
				benchmark_justification: {
					query_ids: ["cross_factory_benchmark", "model_comparison"],
					evidence_date: "2026-03-10",
					notes: "base model benchmark evidence",
				},
				safe_fallback_model: "openai/gpt-5.3-codex",
			},
		});

		const policy = resolveEffectiveModelPolicyForPipeline({
			pipelineFile: join(graphDir, "wave.dot"),
			env: {
				HATCH_MODEL_PROVIDER: "anthropic",
				HATCH_MODEL: "anthropic/claude-sonnet-4-6",
			},
		});

		expect(policy).toBeTruthy();
		expect(policy?.defaultProvider).toBe("anthropic");
		expect(policy?.defaultModel).toBe("anthropic/claude-sonnet-4-6");
		expect(policy?.selectedVia).toBe("env_override");
		expect(policy?.allowedModels).toEqual(["openai/gpt-5.3-codex", "anthropic/claude-sonnet-4-6"]);
		expect(policy?.providerOrder).toEqual(["openrouter", "anthropic"]);
		expect(policy?.benchmarkJustification).toEqual({
			query_ids: ["cross_factory_benchmark", "model_comparison"],
			evidence_date: "2026-03-11",
			notes: "override benchmark evidence",
		});
		expect(policy?.safeFallbackModel).toBe("anthropic/claude-sonnet-4-6");
		expect(policy?.policySource.configPath).toBe(join(factoryRoot, "factory.config.json"));
	});

	it("resolves policy directly from explicit factory config for shared graphs", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-model-policy-explicit-config-"));
		const factoryRoot = join(root, "factories", "policy-factory");
		mkdirSync(factoryRoot, { recursive: true });
		writeJson(join(factoryRoot, "factory.config.json"), validFactoryConfig({
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
		}));
		writePolicyPack(factoryRoot, {
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

		const policy = resolveEffectiveModelPolicyForFactoryConfig({
			factoryConfigPath: join(factoryRoot, "factory.config.json"),
			env: {},
		});

		expect(policy).toBeTruthy();
		expect(policy?.defaultProvider).toBe("openrouter");
		expect(policy?.defaultModel).toBe("openai/gpt-5.3-codex");
		expect(policy?.policySource.configPath).toBe(join(factoryRoot, "factory.config.json"));
	});

	it("resolves node-aware routing provenance with policy/env/node precedence", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-model-policy-node-routing-"));
		const factoryRoot = join(root, "factories", "policy-factory");
		const graphPath = join(factoryRoot, "graphs", "tick.dot");
		mkdirSync(dirname(graphPath), { recursive: true });
		writeJson(join(factoryRoot, "factory.config.json"), validFactoryConfig());
		writePolicyPack(factoryRoot, {
			shared: {
				default_provider: "openrouter",
				default_model: "openai/gpt-5.3-codex",
				override_env_vars: {
					provider: "HATCH_MODEL_PROVIDER",
					model: "HATCH_MODEL",
				},
			},
			factory: {
				allowed_models: ["openai/gpt-5.3-codex", "anthropic/claude-sonnet-4-6", "openai/gpt-5.1-codex-mini"],
				preferred_model: "openai/gpt-5.3-codex",
				provider_order: ["openrouter", "anthropic"],
			},
		});

		const cases = [
			{
				name: "policy default",
				env: {},
				nodeAttrs: {},
				expected: {
					provider: "openrouter",
					model: "openai/gpt-5.3-codex",
					selectedVia: "policy_default",
					winningLayer: "policy_default",
					overrideCount: 2,
					nodeOverrideCount: 0,
				},
			},
			{
				name: "env override",
				env: {
					HATCH_MODEL_PROVIDER: "anthropic",
					HATCH_MODEL: "anthropic/claude-sonnet-4-6",
				},
				nodeAttrs: {},
				expected: {
					provider: "anthropic",
					model: "anthropic/claude-sonnet-4-6",
					selectedVia: "env_override",
					winningLayer: "env_override",
					overrideCount: 4,
					nodeOverrideCount: 0,
				},
			},
			{
				name: "node override wins over env",
				env: {
					HATCH_MODEL_PROVIDER: "anthropic",
					HATCH_MODEL: "anthropic/claude-sonnet-4-6",
				},
				nodeAttrs: {
					llm_provider: "openrouter",
					llm_model: "openai/gpt-5.1-codex-mini",
				},
				expected: {
					provider: "openrouter",
					model: "openai/gpt-5.1-codex-mini",
					selectedVia: "node_override",
					winningLayer: "node_override",
					overrideCount: 6,
					nodeOverrideCount: 2,
				},
			},
		] as const;

		for (const testCase of cases) {
			const resolved = resolveModelPolicyForNode({
				pipelineFile: graphPath,
				handlerType: "codergen",
				nodeId: "node-a",
				llm_path_id: "route/one",
				nodeAttrs: testCase.nodeAttrs,
				env: testCase.env,
			});

			expect(resolved, testCase.name).toBeTruthy();
			expect(resolved?.effectiveProvider, testCase.name).toBe(testCase.expected.provider);
			expect(resolved?.effectiveModel, testCase.name).toBe(testCase.expected.model);
			expect(resolved?.selectedVia, testCase.name).toBe(testCase.expected.selectedVia);
			expect(resolved?.winningLayer, testCase.name).toBe(testCase.expected.winningLayer);
			expect(resolved?.appliedOverrides.length, testCase.name).toBe(testCase.expected.overrideCount);
			expect(
				resolved?.appliedOverrides.filter((override) => override.layer === "node_override").length,
				testCase.name,
			).toBe(testCase.expected.nodeOverrideCount);
			expect(resolved?.policySource.configPath, testCase.name).toBe(join(factoryRoot, "factory.config.json"));
			expect(resolved?.policySource.policyVersion, testCase.name).toBe("v1");
		}
	});

	it("round-trips benchmark_justification and safe_fallback_model from policy docs", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-model-policy-roundtrip-"));
		const factoryRoot = join(root, "factories", "policy-factory");
		const graphDir = join(factoryRoot, "graphs");
		mkdirSync(graphDir, { recursive: true });
		writeJson(join(factoryRoot, "factory.config.json"), validFactoryConfig());
		writePolicyPack(factoryRoot, {
			shared: {
				default_provider: "openrouter",
				default_model: "openai/gpt-5.3-codex",
				override_env_vars: {
					provider: "HATCH_MODEL_PROVIDER",
					model: "HATCH_MODEL",
				},
			},
			factory: {
				allowed_models: ["*"],
				preferred_model: "openai/gpt-5.3-codex",
				provider_order: ["openrouter"],
				benchmark_justification: {
					query_ids: ["cross_factory_benchmark", "model_comparison"],
					evidence_date: "2026-03-09",
					notes: "selected from benchmark scorecard run 42",
				},
				safe_fallback_model: "openai/gpt-5.1-codex-mini",
			},
		});

		const policy = resolveEffectiveModelPolicyForPipeline({
			pipelineFile: join(graphDir, "tick.dot"),
			env: {},
		});

		expect(policy?.benchmarkJustification).toEqual({
			query_ids: ["cross_factory_benchmark", "model_comparison"],
			evidence_date: "2026-03-09",
			notes: "selected from benchmark scorecard run 42",
		});
		expect(policy?.safeFallbackModel).toBe("openai/gpt-5.1-codex-mini");
	});

	it("applies benchmark_justification and safe_fallback_model overrides", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-model-policy-override-fields-"));
		const factoryRoot = join(root, "factories", "policy-factory");
		const graphDir = join(factoryRoot, "graphs");
		mkdirSync(graphDir, { recursive: true });
		writeJson(join(factoryRoot, "factory.config.json"), validFactoryConfig({
			policyPack: {
				version: "v1",
				overrides: {
					model: {
						factory: {
							benchmark_justification: {
								query_ids: ["cross_factory_benchmark"],
								evidence_date: "2026-03-11",
								notes: "override evidence",
							},
							safe_fallback_model: "anthropic/claude-sonnet-4-6",
							allowed_models: ["openai/gpt-5.3-codex", "anthropic/claude-sonnet-4-6"],
							preferred_model: "openai/gpt-5.3-codex",
							provider_order: ["openrouter"],
						},
					},
				},
			},
		}));
		writePolicyPack(factoryRoot, {
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
				benchmark_justification: {
					query_ids: ["model_comparison"],
					evidence_date: "2026-03-01",
					notes: "base evidence",
				},
				safe_fallback_model: "openai/gpt-5.3-codex",
			},
		});

		const policy = resolveEffectiveModelPolicyForPipeline({
			pipelineFile: join(graphDir, "tick.dot"),
			env: {},
		});

		expect(policy?.benchmarkJustification).toEqual({
			query_ids: ["cross_factory_benchmark"],
			evidence_date: "2026-03-11",
			notes: "override evidence",
		});
		expect(policy?.safeFallbackModel).toBe("anthropic/claude-sonnet-4-6");
	});

	it("rejects safe_fallback_model outside allowed_models unless wildcard is used", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-model-policy-fallback-invalid-"));
		const factoryRoot = join(root, "factories", "policy-factory");
		mkdirSync(join(factoryRoot, "graphs"), { recursive: true });
		writeJson(join(factoryRoot, "factory.config.json"), validFactoryConfig());
		writePolicyPack(factoryRoot, {
			shared: {
				default_provider: "openrouter",
				default_model: "gpt-4o",
				override_env_vars: {
					provider: "HATCH_MODEL_PROVIDER",
					model: "HATCH_MODEL",
				},
			},
			factory: {
				allowed_models: ["gpt-4o"],
				preferred_model: "gpt-4o",
				provider_order: ["openrouter"],
				safe_fallback_model: "gpt-3.5-turbo",
			},
		});

		expect(() =>
			resolveEffectiveModelPolicyForPipeline({ pipelineFile: join(factoryRoot, "graphs", "tick.dot") })
		).toThrow(/safe_fallback_model must be in allowed_models unless allowed_models is \[\*\]/);
	});

	it("allows safe_fallback_model when allowed_models is wildcard", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-model-policy-fallback-wildcard-"));
		const factoryRoot = join(root, "factories", "policy-factory");
		mkdirSync(join(factoryRoot, "graphs"), { recursive: true });
		writeJson(join(factoryRoot, "factory.config.json"), validFactoryConfig());
		writePolicyPack(factoryRoot, {
			shared: {
				default_provider: "openrouter",
				default_model: "openai/gpt-5.3-codex",
				override_env_vars: {
					provider: "HATCH_MODEL_PROVIDER",
					model: "HATCH_MODEL",
				},
			},
			factory: {
				allowed_models: ["*"],
				preferred_model: "openai/gpt-5.3-codex",
				provider_order: ["openrouter"],
				safe_fallback_model: "gpt-3.5-turbo",
			},
		});

		const policy = resolveEffectiveModelPolicyForPipeline({
			pipelineFile: join(factoryRoot, "graphs", "tick.dot"),
		});
		expect(policy?.safeFallbackModel).toBe("gpt-3.5-turbo");
	});

	it("allows active mothership codergen/manager/worktree selections after stylesheet imports", () => {
		const repoRoot = resolveRepoRootFromCwd();
		const graphPaths = [
			"docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot",
			"docs/contracts/workflow-ir/mothership/goal_execute.dot",
			"docs/contracts/workflow-ir/mothership/goal_issue_execute.dot",
		];
		const LLM_HANDLER_TYPES = new Set(["codergen", "stack.manager_loop", "agent.worktree"]);
		const seenSelections = new Set<string>();
		const seenHandlerTypes = new Set<string>();
		let validatedSelections = 0;

		const mothershipPolicyGraphPath = join(repoRoot, "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot");

		for (const relativeGraphPath of graphPaths) {
			const graphPath = join(repoRoot, relativeGraphPath);
			const parsed = parseWithAst(readFileSync(graphPath, "utf8"));
			applyGraphStylesheetImports({
				graph: parsed.graph,
				graphFile: graphPath,
				stylesheetImports: parsed.stylesheetImports,
				repoRootPath: repoRoot,
			});

			const policy = resolveEffectiveModelPolicyForPipeline({ pipelineFile: graphPath })
				?? resolveEffectiveModelPolicyForPipeline({ pipelineFile: mothershipPolicyGraphPath });
			expect(policy).toBeTruthy();
			expect(policy?.providerOrder).toContain("openrouter");
			expect(policy?.allowedModels).toContain("*");

			for (const node of Object.values(parsed.graph.nodes)) {
				const handlerType = nodeHandlerType(node);
				if (!LLM_HANDLER_TYPES.has(handlerType)) continue;
				seenHandlerTypes.add(handlerType);
				const provider = node.attrs["llm_provider"] || policy!.defaultProvider;
				const model = node.attrs["llm_model"] || policy!.defaultModel;
				const selectedVia = node.attrs["llm_provider"] || node.attrs["llm_model"]
					? "node_override"
					: "policy_default";
				expect(() =>
					assertModelSelectionAllowed({
						policy,
						provider,
						model,
						nodeId: node.id,
						handlerType,
						selectedVia,
					})
				).not.toThrow();
				validatedSelections += 1;
				seenSelections.add(`${provider}/${model}`);
			}
		}

		expect(validatedSelections).toBeGreaterThan(0);
		expect(seenHandlerTypes.has("codergen")).toBe(true);
		expect(seenHandlerTypes.has("stack.manager_loop")).toBe(true);
		expect(seenHandlerTypes.has("agent.worktree")).toBe(true);
		expect(seenSelections.has("openrouter/openai/gpt-5.3-codex")).toBe(true);
		expect(seenSelections.has("openrouter/anthropic/claude-sonnet-4.6")).toBe(true);
		expect(seenSelections.has("openrouter/openai/gpt-5.1-codex-mini")).toBe(false);
		expect(seenSelections.has("openrouter/openai/gpt-5.4")).toBe(false);
	});

	it("returns undefined when pipeline is outside factory config scope", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-model-policy-none-"));
		const pipelineFile = join(root, "graphs", "test.dot");
		mkdirSync(join(root, "graphs"), { recursive: true });
		writeFileSync(pipelineFile, "digraph t { start [shape=Mdiamond] done [shape=Msquare] start -> done }\n");

		expect(resolveEffectiveModelPolicyForPipeline({ pipelineFile })).toBeUndefined();
	});

	it("falls back to inline config defaults when factory config has no policyPack", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-model-policy-missing-pack-"));
		const factoryRoot = join(root, "factories", "policy-factory");
		mkdirSync(join(factoryRoot, "graphs"), { recursive: true });
		writeJson(join(factoryRoot, "factory.config.json"), validFactoryConfig({
			policyPack: undefined,
			provider: "openrouter",
			model: "openai/gpt-5.3-codex",
		}));

		const policy = resolveEffectiveModelPolicyForPipeline({
			pipelineFile: join(factoryRoot, "graphs", "tick.dot"),
		});

		expect(policy).toBeTruthy();
		expect(policy?.defaultProvider).toBe("openrouter");
		expect(policy?.defaultModel).toBe("openai/gpt-5.3-codex");
		expect(policy?.allowedModels).toEqual(["openai/gpt-5.3-codex"]);
		expect(policy?.providerOrder).toEqual(["openrouter"]);
		expect(policy?.policySource.policyVersion).toBe("inline-config");
		expect(policy?.policySource.policyPackDir).toBe(`${factoryRoot}#inline`);
	});

	it("still fails closed when factory config has neither policyPack nor inline defaults", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-model-policy-missing-config-"));
		const factoryRoot = join(root, "factories", "policy-factory");
		mkdirSync(join(factoryRoot, "graphs"), { recursive: true });
		writeJson(join(factoryRoot, "factory.config.json"), validFactoryConfig({ policyPack: undefined }));

		expect(() =>
			resolveEffectiveModelPolicyForPipeline({ pipelineFile: join(factoryRoot, "graphs", "tick.dot") })
		).toThrow(/model-policy.*expected policyPack or provider\/model defaults/);
	});

	it("wraps malformed policy-pack document loading errors as ModelPolicyError", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-model-policy-malformed-pack-"));
		const factoryRoot = join(root, "factories", "policy-factory");
		const policyPackDir = join(factoryRoot, "policy-pack", "v1");
		mkdirSync(join(factoryRoot, "graphs"), { recursive: true });
		mkdirSync(policyPackDir, { recursive: true });
		writeJson(join(factoryRoot, "factory.config.json"), validFactoryConfig());
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
					"factory.benchmark_justification.query_ids",
					"factory.benchmark_justification.evidence_date",
					"factory.benchmark_justification.notes",
					"factory.safe_fallback_model",
				],
			},
		});
		writeFileSync(join(policyPackDir, "model-policy.json"), "{invalid-json");

		try {
			resolveEffectiveModelPolicyForPipeline({ pipelineFile: join(factoryRoot, "graphs", "tick.dot") });
			throw new Error("expected model policy resolution to fail");
		} catch (error) {
			expect(error).toBeInstanceOf(ModelPolicyError);
			expect(String(error)).toMatch(/model-policy.*failed to load policy pack documents/);
		}
	});

	it("throws when resolved defaults violate allowed model policy", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-model-policy-invalid-"));
		const factoryRoot = join(root, "factories", "policy-factory");
		mkdirSync(join(factoryRoot, "graphs"), { recursive: true });
		writeJson(join(factoryRoot, "factory.config.json"), validFactoryConfig());
		writePolicyPack(factoryRoot, {
			shared: {
				default_provider: "openrouter",
				default_model: "openai/gpt-5.3-codex",
				override_env_vars: {
					provider: "HATCH_MODEL_PROVIDER",
					model: "HATCH_MODEL",
				},
			},
			factory: {
				allowed_models: ["anthropic/claude-sonnet-4-6"],
				preferred_model: "anthropic/claude-sonnet-4-6",
				provider_order: ["openrouter"],
			},
		});

		expect(() =>
			resolveEffectiveModelPolicyForPipeline({ pipelineFile: join(factoryRoot, "graphs", "tick.dot") })
		).toThrow(/shared.default_model=.*must be included in factory.allowed_models/);
	});
});
