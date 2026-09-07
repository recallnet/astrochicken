import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseDuration } from "../pipeline/graph.js";

const STRICT_DURATION_PATTERN = /^\d+(ms|s|m|h|d)$/;
const CAPABILITY_GOAL_DECOMP_TIMEOUT_DEFAULTS_ENTRY = "@hatch/capability-goal-decomposition/timeouts.defaults.json";
const requireFromHatch = createRequire(import.meta.url);

export const GOAL_DECOMPOSITION_TIMEOUT_STAGES = Object.freeze([
	"issue_draft",
	"issue_repair",
	"issue_judge",
	"issue_revise",
] as const);

export type GoalDecompositionTimeoutStage = (typeof GOAL_DECOMPOSITION_TIMEOUT_STAGES)[number];

export const GOAL_DECOMPOSITION_TIMEOUT_OVERRIDES_ROOT_KEY_PATH = "capabilities.goal_decomposition.timeouts" as const;

export const GOAL_DECOMPOSITION_TIMEOUT_DEFAULTS: Record<GoalDecompositionTimeoutStage, string> = Object.freeze({
	issue_draft: "30m",
	issue_repair: "30m",
	issue_judge: "30m",
	issue_revise: "30m",
});

let capabilityDefaultsCache: Record<GoalDecompositionTimeoutStage, string> | null = null;

export interface GoalDecompositionTimeoutResolution {
	stage: GoalDecompositionTimeoutStage;
	timeout: string;
	timeout_ms: number;
	source: "default" | "override";
	source_key_path: string;
	default_timeout: string;
	override_timeout: string;
}

export function resolveGoalDecompositionTimeouts(
	factoryConfig: unknown,
): Record<GoalDecompositionTimeoutStage, GoalDecompositionTimeoutResolution> {
	const capabilityDefaults = readCapabilityGoalDecompositionTimeoutDefaults();
	const timeoutOverrides = readGoalDecompositionTimeoutOverrides(factoryConfig);
	const resolved: Partial<Record<GoalDecompositionTimeoutStage, GoalDecompositionTimeoutResolution>> = {};

	for (const stage of GOAL_DECOMPOSITION_TIMEOUT_STAGES) {
		const defaultTimeout = assertStrictDuration(
			capabilityDefaults[stage],
			`@hatch/capability-goal-decomposition/timeouts.defaults.json.${stage}`,
		);
		const overrideRaw = timeoutOverrides[stage];
		if (overrideRaw !== undefined && typeof overrideRaw !== "string") {
			throw new Error(
				`[goal-decomposition-timeouts] ${GOAL_DECOMPOSITION_TIMEOUT_OVERRIDES_ROOT_KEY_PATH}.${stage} must be a string when provided`,
			);
		}

		const overrideTimeout = normalizeDuration(overrideRaw);
		if (overrideTimeout && !isStrictDuration(overrideTimeout)) {
			throw new Error(
				`[goal-decomposition-timeouts] ${GOAL_DECOMPOSITION_TIMEOUT_OVERRIDES_ROOT_KEY_PATH}.${stage} must match /^\\d+(ms|s|m|h|d)$/`,
			);
		}

		const timeout = overrideTimeout || defaultTimeout;
		const timeoutMs = parseDuration(timeout);
		if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
			throw new Error(
				`[goal-decomposition-timeouts] resolved timeout for stage "${stage}" must be a positive duration (received "${timeout}")`,
			);
		}

		resolved[stage] = {
			stage,
			timeout,
			timeout_ms: timeoutMs,
			source: overrideTimeout ? "override" : "default",
			source_key_path: overrideTimeout
				? `${GOAL_DECOMPOSITION_TIMEOUT_OVERRIDES_ROOT_KEY_PATH}.${stage}`
				: `@hatch/capability-goal-decomposition/timeouts.defaults.json.${stage}`,
			default_timeout: defaultTimeout,
			override_timeout: overrideTimeout,
		};
	}

	return resolved as Record<GoalDecompositionTimeoutStage, GoalDecompositionTimeoutResolution>;
}

function readCapabilityGoalDecompositionTimeoutDefaults(): Record<GoalDecompositionTimeoutStage, string> {
	if (capabilityDefaultsCache) {
		return capabilityDefaultsCache;
	}

	const resolvedPath = resolveGoalDecompositionTimeoutDefaultsPath();

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(resolvedPath, "utf8"));
	} catch (error) {
		throw new Error(
			`[goal-decomposition-timeouts] malformed defaults file ${resolvedPath}: ${String(error instanceof Error ? error.message : error)}`,
		);
	}

	if (!isPlainObject(parsed)) {
		throw new Error(`[goal-decomposition-timeouts] malformed defaults file ${resolvedPath}: expected JSON object`);
	}

	const defaults = parsed as Record<string, unknown>;
	const allowed = new Set<string>(GOAL_DECOMPOSITION_TIMEOUT_STAGES);
	for (const key of Object.keys(defaults)) {
		if (allowed.has(key)) {
			continue;
		}
		throw new Error(
			`[goal-decomposition-timeouts] malformed defaults file ${resolvedPath}: unknown stage "${key}"`,
		);
	}

	const normalized: Partial<Record<GoalDecompositionTimeoutStage, string>> = {};
	for (const stage of GOAL_DECOMPOSITION_TIMEOUT_STAGES) {
		const value = defaults[stage];
		if (typeof value !== "string") {
			throw new Error(
				`[goal-decomposition-timeouts] malformed defaults file ${resolvedPath}: ${stage} must be a string`,
			);
		}
		const trimmed = value.trim();
		if (!STRICT_DURATION_PATTERN.test(trimmed)) {
			throw new Error(
				`[goal-decomposition-timeouts] malformed defaults file ${resolvedPath}: ${stage} must match /^\\d+(ms|s|m|h|d)$/`,
			);
		}
		normalized[stage] = trimmed;
	}

	capabilityDefaultsCache = normalized as Record<GoalDecompositionTimeoutStage, string>;
	return capabilityDefaultsCache;
}

function readGoalDecompositionTimeoutOverrides(factoryConfig: unknown): Partial<Record<GoalDecompositionTimeoutStage, unknown>> {
	if (!isPlainObject(factoryConfig)) {
		return {};
	}

	const capabilities = factoryConfig["capabilities"];
	if (capabilities === undefined) {
		return {};
	}
	if (!isPlainObject(capabilities)) {
		throw new Error("[goal-decomposition-timeouts] capabilities must be an object when provided");
	}

	const goalDecomposition = capabilities["goal_decomposition"];
	if (goalDecomposition === undefined) {
		return {};
	}
	if (!isPlainObject(goalDecomposition)) {
		throw new Error("[goal-decomposition-timeouts] capabilities.goal_decomposition must be an object when provided");
	}

	const timeoutOverrides = goalDecomposition["timeouts"];
	if (timeoutOverrides === undefined) {
		return {};
	}
	if (!isPlainObject(timeoutOverrides)) {
		throw new Error("[goal-decomposition-timeouts] capabilities.goal_decomposition.timeouts must be an object when provided");
	}

	return timeoutOverrides as Partial<Record<GoalDecompositionTimeoutStage, unknown>>;
}

function resolveGoalDecompositionTimeoutDefaultsPath(): string {
	try {
		return requireFromHatch.resolve(CAPABILITY_GOAL_DECOMP_TIMEOUT_DEFAULTS_ENTRY);
	} catch {
		// fall through to local workspace resolution
	}

	const moduleDir = dirname(fileURLToPath(import.meta.url));
	const workspaceFallback = resolve(moduleDir, "../../../../packages/capability-goal-decomposition/timeouts.defaults.json");
	if (existsSync(workspaceFallback)) {
		return workspaceFallback;
	}

	throw new Error(
		`[goal-decomposition-timeouts] unable to resolve ${CAPABILITY_GOAL_DECOMP_TIMEOUT_DEFAULTS_ENTRY} from package exports or workspace fallback`,
	);
}

function assertStrictDuration(value: string, sourceKeyPath: string): string {
	if (!isStrictDuration(value)) {
		throw new Error(`[goal-decomposition-timeouts] ${sourceKeyPath} must match /^\\d+(ms|s|m|h|d)$/`);
	}
	return value;
}

function isStrictDuration(value: string): boolean {
	return STRICT_DURATION_PATTERN.test(value);
}

function normalizeDuration(value: unknown): string {
	if (typeof value !== "string") {
		return "";
	}
	return value.trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
