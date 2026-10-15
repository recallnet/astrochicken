import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
	ModelPolicyError,
	resolveEffectiveModelPolicyForPipeline,
	resolveModelPolicyForNode,
	type AppliedModelPolicyOverride,
	type EffectiveModelPolicy,
	type ModelPolicySelectedVia,
	type ResolvedModelRouting,
} from "../factory/model-policy.js";
import {
	graphWorkDir,
	nodeHandlerType,
	nodeReasoningEffort,
	type Graph,
	type Node,
} from "./graph.js";
import { buildModelAttemptChain, type ModelAttempt } from "./handler/model-routing.js";
import { enforceModelMatrixContractsAtLoad } from "./model-matrix-resolution.js";
import { parseWithAst } from "./parse.js";
import { loadGraphSource } from "./graph-source.js";
import { applyGraphStylesheetImports } from "./stylesheet-imports.js";

export interface ResolveRoutingPolicyForNodeArgs {
	graphFile: string;
	nodeId: string;
	env?: Record<string, string | undefined>;
}

export interface NodeRoutingAttemptSummary extends ModelAttempt {
	isWinner: boolean;
	reason: string;
	skipReason: string;
}

export interface NodeRoutingPolicySummary {
	graphFile: string;
	nodeId: string;
	policy: {
		source: EffectiveModelPolicy["policySource"];
		defaults: {
			provider: string;
			providerSourceLayer: Exclude<ModelPolicySelectedVia, "node_override">;
			model: string;
			modelSourceLayer: Exclude<ModelPolicySelectedVia, "node_override">;
		};
		policyDefaults: {
			provider: string;
			model: string;
		};
		selectedVia: Exclude<ModelPolicySelectedVia, "node_override">;
		preferredModel: string;
		allowedModels: string[];
		providerOrder: string[];
		safeFallbackModel?: string;
	};
	node: {
		id: string;
		class: string;
		trustRole: string;
		handlerType: string;
		llmPathId: string;
		reasoningEffort: string;
		overrides: {
			provider: string;
			model: string;
			reasoning: string;
		};
		selectedVia: ModelPolicySelectedVia;
	};
	resolved: ResolvedModelRouting;
	attempts: NodeRoutingAttemptSummary[];
}

export interface FormattedNodeRoutingPolicySummary {
	graph_file: string;
	node_id: string;
	policy: {
		source: {
			config_path: string;
			policy_pack_dir: string;
			policy_version: string;
		};
		defaults: {
			provider: {
				value: string;
				source_layer: Exclude<ModelPolicySelectedVia, "node_override">;
			};
			model: {
				value: string;
				source_layer: Exclude<ModelPolicySelectedVia, "node_override">;
			};
		};
		policy_defaults: {
			provider: string;
			model: string;
		};
		selected_via: Exclude<ModelPolicySelectedVia, "node_override">;
		preferred_model: string;
		allowed_models: string[];
		provider_order: string[];
		safe_fallback_model: string;
	};
	node: {
		id: string;
		class: string;
		trust_role: string;
		handler_type: string;
		llm_path_id: string;
		reasoning_effort: string;
		overrides: {
			provider: string;
			model: string;
			reasoning: string;
		};
		selected_via: ModelPolicySelectedVia;
	};
	resolved: {
		effective_provider: string;
		effective_model: string;
		selected_via: ModelPolicySelectedVia;
		winning_layer: ModelPolicySelectedVia;
		applied_overrides: Array<{
			layer: ModelPolicySelectedVia;
			key: "provider" | "model";
			value: string;
			source_key: string;
		}>;
	};
	attempts: Array<{
		provider: string;
		model_id: string;
		selected_via: ModelPolicySelectedVia;
		fallback_phase: "primary" | "safe_fallback";
		chain_index: number;
		is_winner: boolean;
		reason: string;
		skip_reason: string;
	}>;
}

export function resolveRoutingPolicyForNode(
	args: ResolveRoutingPolicyForNodeArgs,
): NodeRoutingPolicySummary {
	const graphFile = normalizeRequired(args.graphFile, "graph file");
	const nodeId = normalizeRequired(args.nodeId, "node id");
	const normalizedGraphFile = resolve(graphFile);
	const graph = loadGraphWithStylesheets(normalizedGraphFile);
	const node = graph.nodes[nodeId];

	if (!node) {
		throw new ModelPolicyError(
			`node id "${nodeId}" not found in graph ${normalizedGraphFile}`,
		);
	}

	const policy = resolveEffectiveModelPolicyForPipeline({
		pipelineFile: normalizedGraphFile,
		env: args.env,
	});
	if (!policy) {
		throw new ModelPolicyError(
			`unable to resolve pipeline model policy for ${normalizedGraphFile}`,
		);
	}

	const resolved = resolveModelPolicyForNode({
		pipelineFile: normalizedGraphFile,
		handlerType: nodeHandlerType(node),
		nodeId,
		llm_path_id: readAttr(node, "llm_path_id"),
		nodeAttrs: node.attrs,
		env: args.env,
	});
	if (!resolved) {
		throw new ModelPolicyError(
			`unable to resolve node model policy for ${normalizedGraphFile}#${nodeId}`,
		);
	}

	const nodeProviderOverride = readAttr(node, "llm_provider");
	const nodeModelOverride = readAttr(node, "llm_model");
	const attempts = summarizeAttempts({
		policy,
		resolved,
		nodeProviderOverride,
		nodeModelOverride,
	});

	return {
		graphFile: normalizedGraphFile,
		nodeId,
		policy: {
			source: policy.policySource,
			defaults: {
				provider: policy.defaultProvider,
				providerSourceLayer: resolvePolicyDefaultLayer(resolved.appliedOverrides, "provider"),
				model: policy.defaultModel,
				modelSourceLayer: resolvePolicyDefaultLayer(resolved.appliedOverrides, "model"),
			},
			policyDefaults: {
				provider: policy.policyDefaultProvider,
				model: policy.policyDefaultModel,
			},
			selectedVia: policy.selectedVia,
			preferredModel: policy.preferredModel,
			allowedModels: [...policy.allowedModels],
			providerOrder: [...policy.providerOrder],
			safeFallbackModel: policy.safeFallbackModel,
		},
		node: {
			id: node.id,
			class: readAttr(node, "class"),
			trustRole: readAttr(node, "trust_role"),
			handlerType: nodeHandlerType(node),
			llmPathId: readAttr(node, "llm_path_id"),
			reasoningEffort: nodeReasoningEffort(node),
			overrides: {
				provider: nodeProviderOverride,
				model: nodeModelOverride,
				reasoning: readAttr(node, "llm_reasoning") || readAttr(node, "reasoning_effort"),
			},
			selectedVia: resolved.selectedVia,
		},
		resolved,
		attempts,
	};
}

export function formatRoutingPolicySummary(
	summary: NodeRoutingPolicySummary,
): FormattedNodeRoutingPolicySummary {
	return {
		graph_file: summary.graphFile,
		node_id: summary.nodeId,
		policy: {
			source: {
				config_path: summary.policy.source.configPath,
				policy_pack_dir: summary.policy.source.policyPackDir,
				policy_version: summary.policy.source.policyVersion,
			},
			defaults: {
				provider: {
					value: summary.policy.defaults.provider,
					source_layer: summary.policy.defaults.providerSourceLayer,
				},
				model: {
					value: summary.policy.defaults.model,
					source_layer: summary.policy.defaults.modelSourceLayer,
				},
			},
			policy_defaults: {
				provider: summary.policy.policyDefaults.provider,
				model: summary.policy.policyDefaults.model,
			},
			selected_via: summary.policy.selectedVia,
			preferred_model: summary.policy.preferredModel,
			allowed_models: [...summary.policy.allowedModels],
			provider_order: [...summary.policy.providerOrder],
			safe_fallback_model: summary.policy.safeFallbackModel || "",
		},
		node: {
			id: summary.node.id,
			class: summary.node.class,
			trust_role: summary.node.trustRole,
			handler_type: summary.node.handlerType,
			llm_path_id: summary.node.llmPathId,
			reasoning_effort: summary.node.reasoningEffort,
			overrides: {
				provider: summary.node.overrides.provider,
				model: summary.node.overrides.model,
				reasoning: summary.node.overrides.reasoning,
			},
			selected_via: summary.node.selectedVia,
		},
		resolved: {
			effective_provider: summary.resolved.effectiveProvider,
			effective_model: summary.resolved.effectiveModel,
			selected_via: summary.resolved.selectedVia,
			winning_layer: summary.resolved.winningLayer,
			applied_overrides: summary.resolved.appliedOverrides.map((entry) => ({
				layer: entry.layer,
				key: entry.key,
				value: entry.value,
				source_key: entry.sourceKey,
			})),
		},
		attempts: summary.attempts.map((attempt) => ({
			provider: attempt.provider,
			model_id: attempt.modelId,
			selected_via: attempt.selectedVia,
			fallback_phase: attempt.fallbackPhase,
			chain_index: attempt.chainIndex,
			is_winner: attempt.isWinner,
			reason: attempt.reason,
			skip_reason: attempt.skipReason,
		})),
	};
}

function summarizeAttempts(args: {
	policy: EffectiveModelPolicy;
	resolved: ResolvedModelRouting;
	nodeProviderOverride: string;
	nodeModelOverride: string;
}): NodeRoutingAttemptSummary[] {
	const attempts = buildModelAttemptChain({
		defaultProvider: args.policy.defaultProvider,
		defaultModel: args.policy.defaultModel,
		policy: args.policy,
		nodeProviderOverride: args.nodeProviderOverride,
		nodeModelOverride: args.nodeModelOverride,
	});
	const winnerIndex = resolveWinnerIndex(attempts, args.resolved);

	return attempts.map((attempt, index) => {
		const isWinner = index === winnerIndex;
		const reason = describeAttemptReason(attempt, isWinner);
		return {
			...attempt,
			isWinner,
			reason,
			skipReason: isWinner
				? ""
				: "attempt executes only when a prior attempt fails with a retryable provider/model error",
		};
	});
}

function resolveWinnerIndex(attempts: ModelAttempt[], resolved: ResolvedModelRouting): number {
	const primaryWinner = attempts.findIndex((attempt) => {
		return attempt.fallbackPhase === "primary"
			&& attempt.provider === resolved.effectiveProvider
			&& attempt.modelId === resolved.effectiveModel;
	});
	if (primaryWinner >= 0) return primaryWinner;
	return attempts.length > 0 ? 0 : -1;
}

function describeAttemptReason(attempt: ModelAttempt, isWinner: boolean): string {
	const source = describeSelectedVia(attempt.selectedVia);
	if (isWinner) {
		return `${source}; first selected primary attempt`;
	}
	if (attempt.fallbackPhase === "safe_fallback") {
		return `${source}; safe-fallback model attempt`;
	}
	return `${source}; provider-order fallback attempt`;
}

function describeSelectedVia(selectedVia: ModelPolicySelectedVia): string {
	switch (selectedVia) {
		case "node_override":
			return "node override won over env/policy defaults";
		case "env_override":
			return "env override won over policy defaults";
		case "policy_default":
		default:
			return "policy default selected";
	}
}

function resolvePolicyDefaultLayer(
	overrides: AppliedModelPolicyOverride[],
	key: "provider" | "model",
): Exclude<ModelPolicySelectedVia, "node_override"> {
	for (let index = overrides.length - 1; index >= 0; index--) {
		const entry = overrides[index];
		if (entry.key !== key) continue;
		if (entry.layer === "env_override") return "env_override";
	}
	return "policy_default";
}

function loadGraphWithStylesheets(graphFile: string): Graph {
	let source = "";
	try {
		source = loadGraphSource(graphFile, dirname(graphFile)).sourceText;
	} catch (error) {
		throw new ModelPolicyError(
			`failed to read graph ${graphFile}: ${String(error instanceof Error ? error.message : error)}`,
		);
	}

	let parsed: ReturnType<typeof parseWithAst>;
	try {
		parsed = parseWithAst(source);
	} catch (error) {
		throw new ModelPolicyError(
			`failed to parse graph ${graphFile}: ${String(error instanceof Error ? error.message : error)}`,
		);
	}

	const repoRoot = findRepoRoot(dirname(graphFile));
	try {
		applyGraphStylesheetImports({
			graph: parsed.graph,
			graphFile,
			stylesheetImports: parsed.stylesheetImports,
			repoRootPath: repoRoot,
		});
	} catch (error) {
		throw new ModelPolicyError(
			`failed to apply stylesheet imports for ${graphFile}: ${String(error instanceof Error ? error.message : error)}`,
		);
	}

	try {
		enforceModelMatrixContractsAtLoad({
			graph: parsed.graph,
			workDir: graphWorkDir(parsed.graph) || dirname(graphFile),
		});
	} catch (error) {
		throw new ModelPolicyError(
			`failed to load model_matrix for ${graphFile}: ${String(error instanceof Error ? error.message : error)}`,
		);
	}
	return parsed.graph;
}

function findRepoRoot(startDir: string): string {
	let current = resolve(startDir);
	while (true) {
		if (existsSync(join(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) {
			return resolve(startDir);
		}
		current = parent;
	}
}

function readAttr(node: Node, key: string): string {
	return String(node.attrs[key] || "").trim();
}

function normalizeRequired(value: string, label: string): string {
	const normalized = String(value || "").trim();
	if (!normalized) {
		throw new ModelPolicyError(`${label} must be a non-empty string`);
	}
	return normalized;
}
