import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parseFactoryConfigDocument } from "./config-schema.js";
import { loadPolicyPackDocuments } from "./policy-pack.js";
import { findNearestFactoryConfigPath } from "../pipeline/run.js";

/**
 * Deterministic model-routing precedence ladder:
 * 1) policy defaults (`shared.default_provider` / `shared.default_model`)
 * 2) environment overrides (`shared.override_env_vars.*`)
 * 3) node overrides (`llm_provider` / `llm_model`)
 *
 * Later layers always win over earlier layers.
 */
export type ModelPolicySelectedVia = "policy_default" | "env_override" | "node_override";

export interface BenchmarkJustification {
	query_ids: string[];
	evidence_date: string;
	notes: string;
}

export interface ModelPolicyDocument {
	shared: {
		default_provider: string;
		default_model: string;
		override_env_vars: {
			provider: string;
			model: string;
		};
	};
	factory: {
		allowed_models: string[];
		preferred_model: string;
		provider_order: string[];
		benchmark_justification?: BenchmarkJustification;
		safe_fallback_model?: string;
	};
}

export interface PolicySourceInfo {
	configPath: string;
	policyPackDir: string;
	policyVersion: string;
}

export interface EffectiveModelPolicy {
	defaultProvider: string;
	defaultModel: string;
	allowedModels: string[];
	preferredModel: string;
	providerOrder: string[];
	benchmarkJustification?: BenchmarkJustification;
	safeFallbackModel?: string;
	selectedVia: Exclude<ModelPolicySelectedVia, "node_override">;
	policyDefaultProvider: string;
	policyDefaultModel: string;
	policySource: PolicySourceInfo;
}

export interface ModelPolicyContext {
	pipelineFile: string;
	handlerType: string;
	nodeId?: string;
	llm_path_id?: string;
	nodeAttrs?: Record<string, string | undefined>;
	env?: Record<string, string | undefined>;
}

export interface AppliedModelPolicyOverride {
	layer: ModelPolicySelectedVia;
	key: "provider" | "model";
	value: string;
	sourceKey: string;
}

export interface ResolvedModelRouting {
	effectiveProvider: string;
	effectiveModel: string;
	selectedVia: ModelPolicySelectedVia;
	winningLayer: ModelPolicySelectedVia;
	appliedOverrides: AppliedModelPolicyOverride[];
	allowedModels: string[];
	preferredModel: string;
	providerOrder: string[];
	benchmarkJustification?: BenchmarkJustification;
	safeFallbackModel?: string;
	policyDefaultProvider: string;
	policyDefaultModel: string;
	policySource: PolicySourceInfo;
	context: {
		pipelineFile: string;
		handlerType: string;
		nodeId: string;
		llmPathId: string;
	};
}

interface ResolveModelPolicyArgs {
	pipelineFile: string;
	env?: Record<string, string | undefined>;
}

interface MergeModelPolicyOverridesArgs {
	base: ModelPolicyDocument;
	override: unknown;
}

interface LoadedModelPolicy {
	merged: ModelPolicyDocument;
	source: PolicySourceInfo;
}

export class ModelPolicyError extends Error {
	constructor(message: string) {
		super(`[model-policy] ${message}`);
		this.name = "ModelPolicyError";
	}
}

export function resolveEffectiveModelPolicyForPipeline(
	args: ResolveModelPolicyArgs,
): EffectiveModelPolicy | undefined {
	const loaded = loadMergedModelPolicyForPipeline(args.pipelineFile);
	if (!loaded) return undefined;

	return resolveEffectiveModelPolicyFromLoaded({
		loaded,
		env: args.env ?? process.env,
	});
}

export function resolveEffectiveModelPolicyForFactoryConfig(args: {
	factoryConfigPath: string;
	env?: Record<string, string | undefined>;
}): EffectiveModelPolicy | undefined {
	const loaded = loadMergedModelPolicyForFactoryConfigPath(args.factoryConfigPath);
	if (!loaded) return undefined;

	return resolveEffectiveModelPolicyFromLoaded({
		loaded,
		env: args.env ?? process.env,
	});
}

function resolveEffectiveModelPolicyFromLoaded(args: {
	loaded: LoadedModelPolicy;
	env: Record<string, string | undefined>;
}): EffectiveModelPolicy {
	const { loaded, env } = args;
	const { merged, source } = loaded;
	const providerOverrideVar = merged.shared.override_env_vars.provider;
	const modelOverrideVar = merged.shared.override_env_vars.model;
	const envProvider = readEnv(env, providerOverrideVar);
	const envModel = readEnv(env, modelOverrideVar);
	const selectedVia: Exclude<ModelPolicySelectedVia, "node_override"> = envProvider || envModel
		? "env_override"
		: "policy_default";

	const defaultProvider = envProvider || merged.shared.default_provider;
	const defaultModel = envModel || merged.factory.preferred_model || merged.shared.default_model;
	const allowedModels = merged.factory.allowed_models;
	const providerOrder = merged.factory.provider_order;

	validateEffectiveModelPolicySelection(
		{
			defaultProvider,
			defaultModel,
			allowedModels,
			providerOrder,
		},
		source,
	);

	return {
		defaultProvider,
		defaultModel,
		allowedModels,
		preferredModel: merged.factory.preferred_model,
		providerOrder,
		benchmarkJustification: merged.factory.benchmark_justification,
		safeFallbackModel: merged.factory.safe_fallback_model,
		selectedVia,
		policyDefaultProvider: merged.shared.default_provider,
		policyDefaultModel: merged.shared.default_model,
		policySource: source,
	};
}

export function resolveModelPolicyForNode(
	context: ModelPolicyContext,
): ResolvedModelRouting | undefined {
	const basePolicy = resolveEffectiveModelPolicyForPipeline({
		pipelineFile: context.pipelineFile,
		env: context.env,
	});
	if (!basePolicy) return undefined;

	const loaded = loadMergedModelPolicyForPipeline(context.pipelineFile);
	if (!loaded) return undefined;

	const env = context.env ?? process.env;
	const envProvider = readEnv(env, loaded.merged.shared.override_env_vars.provider);
	const envModel = readEnv(env, loaded.merged.shared.override_env_vars.model);
	const nodeProvider = readNodeAttr(context.nodeAttrs, "llm_provider");
	const nodeModel = readNodeAttr(context.nodeAttrs, "llm_model");

	const appliedOverrides: AppliedModelPolicyOverride[] = [
		{
			layer: "policy_default",
			key: "provider",
			value: basePolicy.policyDefaultProvider,
			sourceKey: "shared.default_provider",
		},
		{
			layer: "policy_default",
			key: "model",
			value: basePolicy.policyDefaultModel,
			sourceKey: "shared.default_model",
		},
	];

	if (envProvider) {
		appliedOverrides.push({
			layer: "env_override",
			key: "provider",
			value: envProvider,
			sourceKey: loaded.merged.shared.override_env_vars.provider,
		});
	}
	if (envModel) {
		appliedOverrides.push({
			layer: "env_override",
			key: "model",
			value: envModel,
			sourceKey: loaded.merged.shared.override_env_vars.model,
		});
	}
	if (nodeProvider) {
		appliedOverrides.push({
			layer: "node_override",
			key: "provider",
			value: nodeProvider,
			sourceKey: "llm_provider",
		});
	}
	if (nodeModel) {
		appliedOverrides.push({
			layer: "node_override",
			key: "model",
			value: nodeModel,
			sourceKey: "llm_model",
		});
	}

	const effectiveProvider = nodeProvider || basePolicy.defaultProvider;
	const effectiveModel = nodeModel || basePolicy.defaultModel;
	const selectedVia: ModelPolicySelectedVia = nodeProvider || nodeModel
		? "node_override"
		: basePolicy.selectedVia;

	validateEffectiveModelPolicySelection(
		{
			defaultProvider: effectiveProvider,
			defaultModel: effectiveModel,
			allowedModels: basePolicy.allowedModels,
			providerOrder: basePolicy.providerOrder,
		},
		basePolicy.policySource,
	);

	return {
		effectiveProvider,
		effectiveModel,
		selectedVia,
		winningLayer: selectedVia,
		appliedOverrides,
		allowedModels: basePolicy.allowedModels,
		preferredModel: basePolicy.preferredModel,
		providerOrder: basePolicy.providerOrder,
		benchmarkJustification: basePolicy.benchmarkJustification,
		safeFallbackModel: basePolicy.safeFallbackModel,
		policyDefaultProvider: basePolicy.policyDefaultProvider,
		policyDefaultModel: basePolicy.policyDefaultModel,
		policySource: basePolicy.policySource,
		context: {
			pipelineFile: String(context.pipelineFile || "").trim(),
			handlerType: String(context.handlerType || "").trim(),
			nodeId: String(context.nodeId || "").trim(),
			llmPathId: String(context.llm_path_id || "").trim(),
		},
	};
}

export function assertModelSelectionAllowed(args: {
	policy: EffectiveModelPolicy | undefined;
	provider: string;
	model: string;
	nodeId: string;
	handlerType: string;
	selectedVia: ModelPolicySelectedVia;
}): void {
	const { policy } = args;
	if (!policy) return;

	if (!policy.providerOrder.includes(args.provider)) {
		throw new ModelPolicyError(
			`node=${args.nodeId} handler=${args.handlerType} selected provider=${args.provider} via=${args.selectedVia} violates provider_order (${policy.providerOrder.join(",")}) source=${policy.policySource.configPath} version=${policy.policySource.policyVersion}`,
		);
	}

	if (!policy.allowedModels.includes("*") && !policy.allowedModels.includes(args.model)) {
		throw new ModelPolicyError(
			`node=${args.nodeId} handler=${args.handlerType} selected model=${args.model} via=${args.selectedVia} violates allowed_models (${policy.allowedModels.join(",")}) source=${policy.policySource.configPath} version=${policy.policySource.policyVersion}`,
		);
	}
}

function loadMergedModelPolicyForPipeline(pipelineFileArg: string): LoadedModelPolicy | undefined {
	const pipelineFile = String(pipelineFileArg || "").trim();
	if (!pipelineFile) return undefined;

	const configPath = findNearestFactoryConfigPath(pipelineFile);
	return loadMergedModelPolicyForFactoryConfigPath(configPath);
}

function loadMergedModelPolicyForFactoryConfigPath(configPathArg: string): LoadedModelPolicy | undefined {
	const configPath = String(configPathArg || "").trim();
	if (!configPath) return undefined;

	const parsed = parseJsonFile(configPath);
	const factoryConfig = parseFactoryConfigDocument(parsed);
	if (!factoryConfig.policyPack) {
		return loadInlineModelPolicyFromFactoryConfig(configPath, parsed);
	}

	const policyVersion = String(factoryConfig.policyPack.version || "").trim();
	if (!policyVersion) {
		throw new ModelPolicyError(`policyPack.version must be a non-empty string (${configPath})`);
	}

	const policyPackDir = join(dirname(configPath), "policy-pack", policyVersion);
	let policyPack: ReturnType<typeof loadPolicyPackDocuments>;
	try {
		policyPack = loadPolicyPackDocuments(policyPackDir);
	} catch (error) {
		throw new ModelPolicyError(
			`failed to load policy pack documents from ${policyPackDir}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const modelDocRaw = policyPack.policies["model"];
	if (!modelDocRaw) {
		throw new ModelPolicyError(`policy document "model" missing in ${policyPackDir}`);
	}

	const modelDoc = parseModelPolicyDocument(modelDocRaw, `${policyPackDir}/model-policy.json`);
	const overrideModelDoc = asObject(factoryConfig.policyPack.overrides)?.["model"];
	const merged = mergeModelPolicyOverrides({
		base: modelDoc,
		override: overrideModelDoc,
	});

	const source: PolicySourceInfo = {
		configPath,
		policyPackDir,
		policyVersion,
	};
	validateModelPolicyDocument(merged, source);

	return {
		merged,
		source,
	};
}

function loadInlineModelPolicyFromFactoryConfig(configPath: string, parsedConfig: unknown): LoadedModelPolicy {
	const config = asObject(parsedConfig);
	if (!config) {
		throw new ModelPolicyError(`factory config must be an object (${configPath})`);
	}

	const isolation = asObject(config["isolation"]);
	const providerSource = asObject(isolation?.["provider"]);
	const modelSource = asObject(isolation?.["model"]);
	const provider =
		readInlineIsolationValue(providerSource) || readInlineString(config["provider"]) || readInlineString(config["llm_provider"]);
	const model =
		readInlineIsolationValue(modelSource) || readInlineString(config["model"]) || readInlineString(config["llm_model"]);

	if (!provider || !model) {
		throw new ModelPolicyError(
			`factory config is missing model policy inputs; expected policyPack or provider/model defaults (${configPath})`,
		);
	}

	const merged: ModelPolicyDocument = {
		shared: {
			default_provider: provider,
			default_model: model,
			override_env_vars: {
				provider: "HATCH_MODEL_PROVIDER",
				model: "HATCH_MODEL",
			},
		},
		factory: {
			allowed_models: [model],
			preferred_model: model,
			provider_order: [provider],
		},
	};

	const source: PolicySourceInfo = {
		configPath,
		policyPackDir: `${dirname(configPath)}#inline`,
		policyVersion: "inline-config",
	};
	validateModelPolicyDocument(merged, source);

	return {
		merged,
		source,
	};
}

function parseJsonFile(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new ModelPolicyError(`failed to parse JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function readInlineIsolationValue(value: unknown): string {
	const source = asObject(value);
	return readInlineString(source?.["value"]);
}

function readInlineString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function parseModelPolicyDocument(value: unknown, sourcePath: string): ModelPolicyDocument {
	const doc = asObject(value);
	if (!doc) {
		throw new ModelPolicyError(`model policy must be an object (${sourcePath})`);
	}

	const shared = asObject(doc["shared"]);
	const factory = asObject(doc["factory"]);
	if (!shared) throw new ModelPolicyError(`model policy shared section missing (${sourcePath})`);
	if (!factory) throw new ModelPolicyError(`model policy factory section missing (${sourcePath})`);

	const overrideEnvVars = asObject(shared["override_env_vars"]);
	if (!overrideEnvVars) {
		throw new ModelPolicyError(`model policy shared.override_env_vars missing (${sourcePath})`);
	}

	return {
		shared: {
			default_provider: requireNonEmptyString(shared["default_provider"], `${sourcePath}#shared.default_provider`),
			default_model: requireNonEmptyString(shared["default_model"], `${sourcePath}#shared.default_model`),
			override_env_vars: {
				provider: requireNonEmptyString(overrideEnvVars["provider"], `${sourcePath}#shared.override_env_vars.provider`),
				model: requireNonEmptyString(overrideEnvVars["model"], `${sourcePath}#shared.override_env_vars.model`),
			},
		},
		factory: {
			allowed_models: requireNonEmptyStringArray(factory["allowed_models"], `${sourcePath}#factory.allowed_models`),
			preferred_model: requireNonEmptyString(factory["preferred_model"], `${sourcePath}#factory.preferred_model`),
			provider_order: requireNonEmptyStringArray(factory["provider_order"], `${sourcePath}#factory.provider_order`),
			benchmark_justification: parseBenchmarkJustification(
				factory["benchmark_justification"],
				`${sourcePath}#factory.benchmark_justification`,
			),
			safe_fallback_model: parseOptionalString(
				factory["safe_fallback_model"],
				`${sourcePath}#factory.safe_fallback_model`,
			),
		},
	};
}

function mergeModelPolicyOverrides(args: MergeModelPolicyOverridesArgs): ModelPolicyDocument {
	const { base, override } = args;
	if (override === undefined) return base;
	const overrideDoc = asObject(override);
	if (!overrideDoc) {
		throw new ModelPolicyError("policyPack.overrides.model must be an object when provided");
	}

	const factoryOverride = asObject(overrideDoc["factory"]);
	if (!factoryOverride) return base;

	const allowedOverride = factoryOverride["allowed_models"] === undefined
		? base.factory.allowed_models
		: requireNonEmptyStringArray(factoryOverride["allowed_models"], "policyPack.overrides.model.factory.allowed_models");
	const preferredOverride = factoryOverride["preferred_model"] === undefined
		? base.factory.preferred_model
		: requireNonEmptyString(factoryOverride["preferred_model"], "policyPack.overrides.model.factory.preferred_model");
	const providerOrderOverride = factoryOverride["provider_order"] === undefined
		? base.factory.provider_order
		: requireNonEmptyStringArray(factoryOverride["provider_order"], "policyPack.overrides.model.factory.provider_order");
	const benchmarkJustificationOverride = factoryOverride["benchmark_justification"] === undefined
		? base.factory.benchmark_justification
		: parseBenchmarkJustification(
			factoryOverride["benchmark_justification"],
			"policyPack.overrides.model.factory.benchmark_justification",
		);
	const safeFallbackModelOverride = factoryOverride["safe_fallback_model"] === undefined
		? base.factory.safe_fallback_model
		: parseOptionalString(
			factoryOverride["safe_fallback_model"],
			"policyPack.overrides.model.factory.safe_fallback_model",
		);

	return {
		...base,
		factory: {
			...base.factory,
			allowed_models: allowedOverride,
			preferred_model: preferredOverride,
			provider_order: providerOrderOverride,
			benchmark_justification: benchmarkJustificationOverride,
			safe_fallback_model: safeFallbackModelOverride,
		},
	};
}

function validateModelPolicyDocument(doc: ModelPolicyDocument, source: PolicySourceInfo): void {
	assertUniqueStringList(doc.factory.allowed_models, "factory.allowed_models", source);
	assertUniqueStringList(doc.factory.provider_order, "factory.provider_order", source);

	const allowsAll = doc.factory.allowed_models.includes("*");
	if (!allowsAll && !doc.factory.allowed_models.includes(doc.factory.preferred_model)) {
		throw new ModelPolicyError(
			`factory.preferred_model=${doc.factory.preferred_model} must be included in factory.allowed_models (${source.policyPackDir})`,
		);
	}

	if (!allowsAll && !doc.factory.allowed_models.includes(doc.shared.default_model)) {
		throw new ModelPolicyError(
			`shared.default_model=${doc.shared.default_model} must be included in factory.allowed_models (${source.policyPackDir})`,
		);
	}

	if (!doc.factory.provider_order.includes(doc.shared.default_provider)) {
		throw new ModelPolicyError(
			`shared.default_provider=${doc.shared.default_provider} must be included in factory.provider_order (${source.policyPackDir})`,
		);
	}

	if (
		doc.factory.safe_fallback_model
		&& !allowsAll
		&& !doc.factory.allowed_models.includes(doc.factory.safe_fallback_model)
	) {
		throw new ModelPolicyError(
			"safe_fallback_model must be in allowed_models unless allowed_models is [*]",
		);
	}
}

function validateEffectiveModelPolicySelection(
	selection: {
		defaultProvider: string;
		defaultModel: string;
		allowedModels: string[];
		providerOrder: string[];
	},
	source: PolicySourceInfo,
): void {
	if (!selection.providerOrder.includes(selection.defaultProvider)) {
		throw new ModelPolicyError(
			`resolved default provider=${selection.defaultProvider} is not in provider_order (${source.configPath} v${source.policyVersion})`,
		);
	}

	if (!selection.allowedModels.includes("*") && !selection.allowedModels.includes(selection.defaultModel)) {
		throw new ModelPolicyError(
			`resolved default model=${selection.defaultModel} is not in allowed_models (${source.configPath} v${source.policyVersion})`,
		);
	}
}

function assertUniqueStringList(values: string[], field: string, source: PolicySourceInfo): void {
	const normalized = values.map((value) => value.trim());
	const seen = new Set<string>();
	for (const value of normalized) {
		if (seen.has(value)) {
			throw new ModelPolicyError(`${field} contains duplicate value ${value} (${source.policyPackDir})`);
		}
		seen.add(value);
	}
}

function readEnv(env: Record<string, string | undefined>, name: string): string {
	const key = String(name || "").trim();
	if (!key) return "";
	return String(env[key] || "").trim();
}

function readNodeAttr(attrs: Record<string, string | undefined> | undefined, key: string): string {
	if (!attrs) return "";
	return String(attrs[key] || "").trim();
}

function requireNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new ModelPolicyError(`${field} must be a non-empty string`);
	}
	return value.trim();
}

function requireNonEmptyStringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new ModelPolicyError(`${field} must be a non-empty array`);
	}
	const normalized: string[] = [];
	for (let index = 0; index < value.length; index++) {
		const entry = value[index];
		if (typeof entry !== "string" || entry.trim() === "") {
			throw new ModelPolicyError(`${field}[${index}] must be a non-empty string`);
		}
		normalized.push(entry.trim());
	}
	return normalized;
}

function parseOptionalString(value: unknown, field: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") {
		throw new ModelPolicyError(`${field} must be a string when provided`);
	}
	return value;
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string") {
		throw new ModelPolicyError(`${field} must be a string`);
	}
	return value;
}

function parseBenchmarkJustification(value: unknown, field: string): BenchmarkJustification | undefined {
	if (value === undefined) return undefined;
	const benchmark = asObject(value);
	if (!benchmark) {
		throw new ModelPolicyError(`${field} must be an object when provided`);
	}

	return {
		query_ids: requireNonEmptyStringArray(benchmark["query_ids"], `${field}.query_ids`),
		evidence_date: requireString(benchmark["evidence_date"], `${field}.evidence_date`),
		notes: requireString(benchmark["notes"], `${field}.notes`),
	};
}

function asObject(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}
