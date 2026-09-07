import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ModelPolicyError } from "../factory/model-policy.js";
import {
	formatRoutingPolicySummary,
	resolveRoutingPolicyForNode,
} from "./llm-routing-policy.js";

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value, null, 2));
}

function validFactoryConfig(): Record<string, unknown> {
	return {
		schema: "hatch.factory.config.v1",
		factory_id: "policy-factory",
		target_repo: "recallnet/astrochicken",
		control_plane_repo: "recallnet/astrochicken",
		dispatch: {
			graph: "factories/policy-factory/graphs/tick.dot",
		},
		skills: {
			supervisor: "factories/policy-factory/skills/supervisor/current.md",
		},
		scenarios: {
			root: "factories/policy-factory/scenarios/policy-factory",
		},
		pipeline: {
			supervisor_tick: "factories/policy-factory/graphs/tick.dot",
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
	};
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
				"factory.safe_fallback_model",
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
			allowed_models: [
				"openai/gpt-5.3-codex",
				"anthropic/claude-sonnet-4-6",
				"openai/gpt-5.1-codex-mini",
			],
			preferred_model: "openai/gpt-5.3-codex",
			provider_order: ["openrouter", "anthropic"],
			safe_fallback_model: "openai/gpt-5.1-codex-mini",
		},
	});
}

function writeGraph(factoryRoot: string): string {
	const graphPath = join(factoryRoot, "graphs", "tick.dot");
	const stylesheetPath = join(factoryRoot, "graphs", "routing.stylesheet");
	mkdirSync(dirname(graphPath), { recursive: true });
	writeFileSync(
		graphPath,
		[
			'@import "./routing.stylesheet"',
			"digraph tick {",
			'  default_node [shape=box, type="codergen", class="supervisor"]',
			'  env_node [shape=box, type="codergen"]',
			'  node_override_node [shape=box, type="codergen", llm_provider="openrouter", llm_model="anthropic/claude-sonnet-4-6", reasoning_effort="low"]',
			"}",
			"",
		].join("\n"),
	);
	writeFileSync(stylesheetPath, '.supervisor { reasoning_effort = "medium" }\n');
	return graphPath;
}

function writeValidMatrix(path: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		JSON.stringify(
			{
				schema_version: "matrix/v1",
				candidates: {
					fast: { model: "openai/gpt-4o-mini" },
					balanced: { model: "openai/gpt-5.3-codex" },
				},
				primary: "balanced",
			},
			null,
			2,
		),
		"utf-8",
	);
}

describe("pipeline llm routing policy summary", () => {
	let root = "";
	let graphPath = "";

	afterEach(() => {
		if (!root) return;
		rmSync(root, { recursive: true, force: true });
		root = "";
		graphPath = "";
	});

	function createFixture(): string {
		root = mkdtempSync(join(tmpdir(), "hatch-llm-routing-policy-"));
		const factoryRoot = join(root, "factories", "policy-factory");
		writeJson(join(factoryRoot, "factory.config.json"), validFactoryConfig());
		writePolicyPack(factoryRoot);
		graphPath = writeGraph(factoryRoot);
		return graphPath;
	}

	it("uses policy defaults when env and node overrides are absent", () => {
		const fixtureGraphPath = createFixture();
		const summary = resolveRoutingPolicyForNode({
			graphFile: fixtureGraphPath,
			nodeId: "default_node",
			env: {},
		});

		expect(summary.policy.defaults.provider).toBe("openrouter");
		expect(summary.policy.defaults.providerSourceLayer).toBe("policy_default");
		expect(summary.policy.defaults.model).toBe("openai/gpt-5.3-codex");
		expect(summary.policy.defaults.modelSourceLayer).toBe("policy_default");
		expect(summary.node.selectedVia).toBe("policy_default");
		expect(summary.policy.source.configPath).toBe(join(root, "factories", "policy-factory", "factory.config.json"));
		expect(summary.attempts).toHaveLength(4);
		expect(summary.attempts[0]).toMatchObject({
			provider: "openrouter",
			modelId: "openai/gpt-5.3-codex",
			isWinner: true,
		});
		expect(summary.attempts[1]?.reason).toContain("provider-order fallback attempt");
	});

	it("applies env override defaults and reports env provenance", () => {
		const fixtureGraphPath = createFixture();
		const summary = resolveRoutingPolicyForNode({
			graphFile: fixtureGraphPath,
			nodeId: "env_node",
			env: {
				HATCH_MODEL_PROVIDER: "anthropic",
				HATCH_MODEL: "anthropic/claude-sonnet-4-6",
			},
		});

		expect(summary.policy.defaults.provider).toBe("anthropic");
		expect(summary.policy.defaults.providerSourceLayer).toBe("env_override");
		expect(summary.policy.defaults.model).toBe("anthropic/claude-sonnet-4-6");
		expect(summary.policy.defaults.modelSourceLayer).toBe("env_override");
		expect(summary.node.selectedVia).toBe("env_override");
		expect(summary.attempts.every((attempt) => attempt.selectedVia === "env_override")).toBe(true);
		expect(summary.attempts[0]?.isWinner).toBe(true);
		expect(summary.attempts[0]?.provider).toBe("anthropic");
	});

	it("node overrides win over env overrides and keep fallback attempts visible", () => {
		const fixtureGraphPath = createFixture();
		const summary = resolveRoutingPolicyForNode({
			graphFile: fixtureGraphPath,
			nodeId: "node_override_node",
			env: {
				HATCH_MODEL_PROVIDER: "anthropic",
				HATCH_MODEL: "openai/gpt-5.3-codex",
			},
		});

		expect(summary.node.selectedVia).toBe("node_override");
		expect(summary.node.overrides.provider).toBe("openrouter");
		expect(summary.node.overrides.model).toBe("anthropic/claude-sonnet-4-6");
		expect(summary.node.overrides.reasoning).toBe("low");
		expect(summary.attempts).toHaveLength(2);
		expect(summary.attempts[0]).toMatchObject({
			provider: "openrouter",
			modelId: "anthropic/claude-sonnet-4-6",
			isWinner: true,
		});
		expect(summary.attempts[1]).toMatchObject({
			provider: "openrouter",
			modelId: "openai/gpt-5.1-codex-mini",
			fallbackPhase: "safe_fallback",
			isWinner: false,
		});
		expect(summary.attempts[1]?.skipReason).toContain("retryable provider/model error");

		const formatted = formatRoutingPolicySummary(summary);
		expect(formatted.node.selected_via).toBe("node_override");
		expect(formatted.resolved.applied_overrides.some((entry) => entry.layer === "node_override")).toBe(true);
		expect(formatted.attempts[0]?.is_winner).toBe(true);
	});

	it("fails closed when node id is missing", () => {
		const fixtureGraphPath = createFixture();
		expect(() =>
			resolveRoutingPolicyForNode({
				graphFile: fixtureGraphPath,
				nodeId: "missing_node",
				env: {},
			})
		).toThrow(/node id "missing_node" not found/);
	});

	it("fails closed when referenced model_matrix file is invalid", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-llm-routing-policy-matrix-"));
		const factoryRoot = join(root, "factories", "policy-factory");
		writeJson(join(factoryRoot, "factory.config.json"), validFactoryConfig());
		writePolicyPack(factoryRoot);
		mkdirSync(join(factoryRoot, "config"), { recursive: true });
		writeJson(join(factoryRoot, "config", "broken-model-matrix.json"), {
			schema_version: "matrix/v1",
			candidates: {
				only: { model: "openai/gpt-4o-mini" },
			},
			primary: "only",
		});
		graphPath = join(factoryRoot, "graphs", "matrix.dot");
		mkdirSync(dirname(graphPath), { recursive: true });
		writeFileSync(
			graphPath,
			[
				"digraph matrix {",
				'  node_with_matrix [shape=box, type="codergen", model_matrix="config/broken-model-matrix.json"]',
				"}",
				"",
			].join("\n"),
		);

		expect(() =>
			resolveRoutingPolicyForNode({
				graphFile: graphPath,
				nodeId: "node_with_matrix",
				env: {},
			})
		).toThrow(ModelPolicyError);
		expect(() =>
			resolveRoutingPolicyForNode({
				graphFile: graphPath,
				nodeId: "node_with_matrix",
				env: {},
			})
		).toThrow(/failed to load model_matrix/);
	});

	it("fails closed when model_matrix cannot be loaded during diagnostic graph load", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-llm-routing-policy-matrix-"));
		const factoryRoot = join(root, "factories", "policy-factory");
		writeJson(join(factoryRoot, "factory.config.json"), validFactoryConfig());
		writePolicyPack(factoryRoot);
		graphPath = join(factoryRoot, "graphs", "matrix-missing.dot");
		mkdirSync(dirname(graphPath), { recursive: true });
		writeFileSync(
			graphPath,
			[
				"digraph tick {",
				'  model_matrix = "config/missing-matrix.json"',
				'  default_node [shape=box, type="codergen"]',
				"}",
				"",
			].join("\n"),
		);

		expect(() =>
			resolveRoutingPolicyForNode({
				graphFile: graphPath,
				nodeId: "default_node",
				env: {},
			})
		).toThrow(ModelPolicyError);
		expect(() =>
			resolveRoutingPolicyForNode({
				graphFile: graphPath,
				nodeId: "default_node",
				env: {},
			})
		).toThrow(/failed to load model_matrix/);
		expect(() =>
			resolveRoutingPolicyForNode({
				graphFile: graphPath,
				nodeId: "default_node",
				env: {},
			})
		).toThrow(/model_matrix_load.file.missing/);
	});

	it("loads valid model_matrix during diagnostic graph load", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-llm-routing-policy-matrix-ok-"));
		const factoryRoot = join(root, "factories", "policy-factory");
		writeJson(join(factoryRoot, "factory.config.json"), validFactoryConfig());
		writePolicyPack(factoryRoot);
		const matrixPath = join(factoryRoot, "graphs", "config", "matrix.json");
		writeValidMatrix(matrixPath);
		graphPath = join(factoryRoot, "graphs", "matrix-valid.dot");
		mkdirSync(dirname(graphPath), { recursive: true });
		writeFileSync(
			graphPath,
			[
				"digraph tick {",
				'  model_matrix = "config/matrix.json"',
				'  default_node [shape=box, type="codergen"]',
				"}",
				"",
			].join("\n"),
		);

		const summary = resolveRoutingPolicyForNode({
			graphFile: graphPath,
			nodeId: "default_node",
			env: {},
		});
		expect(summary.node.id).toBe("default_node");
	});

	it("wraps parse failures as model policy errors", () => {
		root = mkdtempSync(join(tmpdir(), "hatch-llm-routing-policy-parse-"));
		const factoryRoot = join(root, "factories", "policy-factory");
		writeJson(join(factoryRoot, "factory.config.json"), validFactoryConfig());
		writePolicyPack(factoryRoot);
		graphPath = join(factoryRoot, "graphs", "broken.dot");
		mkdirSync(dirname(graphPath), { recursive: true });
		writeFileSync(graphPath, "digraph broken { a -> }\n");

		expect(() =>
			resolveRoutingPolicyForNode({
				graphFile: graphPath,
				nodeId: "a",
				env: {},
			})
		).toThrow(ModelPolicyError);
		expect(() =>
			resolveRoutingPolicyForNode({
				graphFile: graphPath,
				nodeId: "a",
				env: {},
			})
		).toThrow(/failed to parse graph/);
	});
});
