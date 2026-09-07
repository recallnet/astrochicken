import { existsSync, readFileSync } from "node:fs";

import {
	GOAL_DECOMPOSITION_TIMEOUT_STAGES,
	resolveGoalDecompositionTimeouts,
	type FactoryConfigDemoPolicy,
} from "../factory/config-schema.js";
import {
	resolveFactoryContext,
	type FactoryContext,
	type ResolveFactoryContextOptions,
} from "../factory/context-resolver.js";
import { assertConfiguredRepoPathHealthyForStartup } from "../factory/repo-path-health.js";
import { Context } from "../pipeline/context.js";

import type { RunState } from "../pipeline/run.js";

export function resolveFactoryContextOrExit(options: ResolveFactoryContextOptions): FactoryContext {
	try {
		const context = resolveFactoryContext(options);
		assertConfiguredRepoPathHealthyForStartup();
		return context;
	} catch (error) {
		console.error(String(error instanceof Error ? error.message : error));
		process.exit(1);
		throw (error instanceof Error ? error : new Error(String(error)));
	}
}

export function logFactoryContextStartup(command: string, context: FactoryContext): void {
	console.error(
		`[hatch] startup command=${command} factory_id=${context.factory_id || "(unresolved)"} target_repo=${context.target_repo || "(unresolved)"} factory_mode=${context.factory_mode || "standalone"} runs_dir=${context.runs_dir || "(unresolved)"}`,
	);
}

export function applyFactoryContextToEngineContext(ctx: Context, factoryContext: FactoryContext): void {
	if (factoryContext.factory_id) {
		ctx.set("factory_id", factoryContext.factory_id);
		if (!ctx.get("factory")) {
			ctx.set("factory", factoryContext.factory_id);
		}
	}
	if (factoryContext.target_repo) {
		ctx.set("target_repo", factoryContext.target_repo);
	}
	if (factoryContext.repo) {
		ctx.set("repo", factoryContext.repo);
	} else if (factoryContext.target_repo && !ctx.get("repo")) {
		ctx.set("repo", factoryContext.target_repo);
	}
	if (factoryContext.kind_id) {
		ctx.set("kind_id", factoryContext.kind_id);
	}
	if (factoryContext.kind_path) {
		ctx.set("kind_path", factoryContext.kind_path);
	}
	if (factoryContext.instance_id) {
		ctx.set("instance_id", factoryContext.instance_id);
	}
	if (factoryContext.instance_path) {
		ctx.set("instance_path", factoryContext.instance_path);
	}
	if (factoryContext.destinations_json) {
		ctx.set("destinations_json", factoryContext.destinations_json);
		ctx.set("destinations", factoryContext.destinations_json);
	}
	if (factoryContext.control_plane_repo) {
		ctx.set("control_plane_repo", factoryContext.control_plane_repo);
	}
	if (factoryContext.factory_root) {
		ctx.set("factory_root", factoryContext.factory_root);
	}
	if (factoryContext.factory_config_path) {
		ctx.set("factory_config_path", factoryContext.factory_config_path);
	}
	if (factoryContext.runs_dir) {
		ctx.set("runs_dir", factoryContext.runs_dir);
	}
	if (factoryContext.scenarios_root) {
		ctx.set("scenarios_root", factoryContext.scenarios_root);
	}
	if (factoryContext.trust_domain) {
		ctx.set("trust_domain", factoryContext.trust_domain);
	}
	if (factoryContext.trust_role) {
		ctx.set("trust_role", factoryContext.trust_role);
	}
	if (factoryContext.factory_mode) {
		ctx.set("factory_mode", factoryContext.factory_mode);
	}
	const factoryModeSource = Array.isArray(factoryContext.factory_mode_source) ? factoryContext.factory_mode_source : [];
	if (factoryModeSource.length > 0) {
		ctx.set("factory_mode_source", JSON.stringify(factoryModeSource));
	}
	seedGoalDecompositionTimeoutContext(ctx, factoryContext.factory_config_path);
	seedDemoPolicyContext(ctx, factoryContext.factory_config_path);
}

export function seedRunStateFactoryContext(runState: RunState, factoryContext: FactoryContext): void {
	const runContext = runState.context || (runState.context = {});
	if (factoryContext.factory_root) runContext["factory_root"] = factoryContext.factory_root;
	if (factoryContext.factory_config_path) runContext["factory_config_path"] = factoryContext.factory_config_path;
	if (factoryContext.factory_id) runContext["factory_id"] = factoryContext.factory_id;
	if (factoryContext.target_repo) runContext["target_repo"] = factoryContext.target_repo;
	if (factoryContext.repo) runContext["repo"] = factoryContext.repo;
	else if (factoryContext.target_repo && !runContext["repo"]) runContext["repo"] = factoryContext.target_repo;
	if (factoryContext.kind_id) runContext["kind_id"] = factoryContext.kind_id;
	if (factoryContext.kind_path) runContext["kind_path"] = factoryContext.kind_path;
	if (factoryContext.instance_id) runContext["instance_id"] = factoryContext.instance_id;
	if (factoryContext.instance_path) runContext["instance_path"] = factoryContext.instance_path;
	if (factoryContext.destinations_json) {
		runContext["destinations_json"] = factoryContext.destinations_json;
		runContext["destinations"] = factoryContext.destinations_json;
	}
	if (factoryContext.control_plane_repo) runContext["control_plane_repo"] = factoryContext.control_plane_repo;
	if (factoryContext.runs_dir) runContext["runs_dir"] = factoryContext.runs_dir;
	if (factoryContext.scenarios_root) runContext["scenarios_root"] = factoryContext.scenarios_root;
	if (factoryContext.trust_domain) runContext["trust_domain"] = factoryContext.trust_domain;
	if (factoryContext.trust_role) runContext["trust_role"] = factoryContext.trust_role;
	if (factoryContext.factory_mode) runContext["factory_mode"] = factoryContext.factory_mode;
	const factoryModeSource = Array.isArray(factoryContext.factory_mode_source) ? factoryContext.factory_mode_source : [];
	if (factoryModeSource.length > 0) runContext["factory_mode_source"] = JSON.stringify(factoryModeSource);
	const goalDecompositionTimeouts = resolveGoalDecompositionTimeoutContext(factoryContext.factory_config_path);
	if (goalDecompositionTimeouts) {
		runContext["goal_decomposition_timeouts"] = goalDecompositionTimeouts;
	}
	runContext["demo_policy"] = resolveDemoPolicyContext(factoryContext.factory_config_path);
}

function seedGoalDecompositionTimeoutContext(ctx: Context, factoryConfigPath: string): void {
	const goalDecompositionTimeouts = resolveGoalDecompositionTimeoutContext(factoryConfigPath);
	if (!goalDecompositionTimeouts) {
		return;
	}
	ctx.set("goal_decomposition_timeouts", goalDecompositionTimeouts);
}

function seedDemoPolicyContext(ctx: Context, factoryConfigPath: string): void {
	ctx.set("demo_policy", resolveDemoPolicyContext(factoryConfigPath));
}

function resolveGoalDecompositionTimeoutContext(factoryConfigPath: string): string {
	const rawConfig = loadFactoryConfig(factoryConfigPath);
	if (!rawConfig) {
		return "";
	}

	try {
		const resolutions = resolveGoalDecompositionTimeouts(rawConfig);
		const stageEntries = GOAL_DECOMPOSITION_TIMEOUT_STAGES.map((stage) => [stage, resolutions[stage]?.timeout || ""]);
		return JSON.stringify(Object.fromEntries(stageEntries));
	} catch {
		return "";
	}
}

function resolveDemoPolicyContext(factoryConfigPath: string): FactoryConfigDemoPolicy {
	const rawConfig = loadFactoryConfig(factoryConfigPath);
	if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
		return "auto";
	}
	const capabilities = (rawConfig as Record<string, unknown>)["capabilities"];
	if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
		return "auto";
	}
	const demo = (capabilities as Record<string, unknown>)["demo"];
	if (!demo || typeof demo !== "object" || Array.isArray(demo)) {
		return "auto";
	}
	const policy = (demo as Record<string, unknown>)["policy"];
	if (policy === "auto" || policy === "terminal" || policy === "browser" || policy === "none") {
		return policy;
	}
	return "auto";
}

function loadFactoryConfig(factoryConfigPath: string): unknown {
	if (!factoryConfigPath || !existsSync(factoryConfigPath)) {
		return undefined;
	}
	try {
		return JSON.parse(readFileSync(factoryConfigPath, "utf-8"));
	} catch {
		return undefined;
	}
}
