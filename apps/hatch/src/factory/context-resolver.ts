import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
	assertFactoryIsolationContext,
	getFactoryIsolationConfig,
	resolveFactoryRuntimePaths,
} from "./config-schema.js";
import {
	FACTORY_MODE_CONFLICT_ERROR_CODE,
	ModeConflictError,
	resolveModeSources,
	type FactoryMode,
	type ModeSource,
} from "./mode.js";

const FACTORY_CONFIG_FILE = "factory.config.json";
const INSTANCE_MANIFEST_FILE = path.join(".hatch", "instance.json");
const DEFAULT_FACTORY_ROOT = "factories/mothership";
const REQUIRED_FACTORY_CONFIG_KEYS = ["factory_id"] as const;

export const FACTORY_CONTEXT_MODE_CONFLICT_ERROR_CODE = FACTORY_MODE_CONFLICT_ERROR_CODE;

export interface FactoryContext {
	factory_root: string;
	factory_config_path: string;
	factory_id: string;
	workspace_mode: string;
	work_dir: string;
	canonical_checkout_path: string;
	target_repo: string;
	repo: string;
	control_plane_repo: string;
	kind_id: string;
	kind_path: string;
	instance_id: string;
	instance_path: string;
	destinations_json: string;
	runs_dir: string;
	scenarios_root: string;
	trust_domain: string;
	trust_role: string;
	factory_mode: FactoryMode;
	factory_mode_source: ModeSource[];
}

export interface ResolveFactoryContextOptions {
	cwd?: string;
	factoryRoot?: string;
	factoryConfigPath?: string;
	configPath?: string;
	processEnv?: Record<string, string | undefined>;
	factoryId?: string;
	targetRepo?: string;
	repo?: string;
	controlPlaneRepo?: string;
	kindId?: string;
	instanceId?: string;
	destinationsJson?: string;
	runsDir?: string;
	scenariosRoot?: string;
	factoryMode?: FactoryMode | "standalone" | "managed" | string;
	requireTargetRepo?: boolean;
}

interface LoadedFactoryConfig {
	factoryRoot: string;
	configPath: string;
	config: Record<string, unknown>;
}

interface LoadedInstanceManifest {
	manifestPath: string;
	manifest: Record<string, unknown>;
}

function trim(value = ""): string {
	return String(value ?? "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePath(value = "", { baseDir = process.cwd() }: { baseDir?: string } = {}): string {
	const raw = trim(value);
	if (!raw) return "";
	return path.isAbsolute(raw) ? raw : path.resolve(baseDir, raw);
}

function normalizeConfiguredPath(value = "", { baseDir = process.cwd(), preserveSymbolic = false }: { baseDir?: string; preserveSymbolic?: boolean } = {}): string {
	const raw = trim(value);
	if (!raw) return "";
	if (preserveSymbolic && /\$\{[^}]+\}/.test(raw)) return raw;
	return normalizePath(raw, { baseDir });
}

function pickString(...values: Array<string | undefined>): string {
	for (const value of values) {
		const normalized = trim(value ?? "");
		if (normalized) return normalized;
	}
	return "";
}

function normalizeRepoIdentity(value = ""): string {
	return trim(value).toLowerCase();
}

function stableSortValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => stableSortValue(entry));
	}
	if (!isRecord(value)) {
		return value;
	}
	const sorted = Object.keys(value)
		.sort((left, right) => left.localeCompare(right))
		.reduce<Record<string, unknown>>((acc, key) => {
			acc[key] = stableSortValue(value[key]);
			return acc;
		}, {});
	return sorted;
}

function stableStringifyObject(value: Record<string, unknown>): string {
	return JSON.stringify(stableSortValue(value));
}

function normalizeDestinationsJsonValue(value: unknown): string {
	if (typeof value === "string") {
		const raw = trim(value);
		if (!raw) return "";
		try {
			const parsed = JSON.parse(raw);
			if (isRecord(parsed)) return stableStringifyObject(parsed);
			return raw;
		} catch {
			return raw;
		}
	}
	if (isRecord(value)) return stableStringifyObject(value);
	return "";
}

function normalizeDestinationsFromSource(value: unknown, sourceLabel: string): string {
	if (value === undefined || value === null) return "";

	if (typeof value === "string") {
		const raw = trim(value);
		if (!raw) return "";
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			throw new Error(
				`[factory-context] invalid destinations JSON from ${sourceLabel}: ${String(error instanceof Error ? error.message : error)}`,
			);
		}
		if (!isRecord(parsed)) {
			throw new Error(`[factory-context] destinations from ${sourceLabel} must be a JSON object`);
		}
		return stableStringifyObject(parsed);
	}

	if (!isRecord(value)) {
		throw new Error(`[factory-context] destinations from ${sourceLabel} must be a JSON object`);
	}
	return stableStringifyObject(value);
}

function readJsonRecord(filePath = "", label = "json"): Record<string, unknown> {
	const normalizedPath = normalizePath(filePath);
	if (!normalizedPath) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(normalizedPath, "utf8"));
	} catch (error) {
		throw new Error(`Unable to read ${label} at ${normalizedPath}: ${String(error instanceof Error ? error.message : error)}`);
	}
	if (!isRecord(parsed)) {
		throw new Error(`${label} at ${normalizedPath} must be a JSON object`);
	}
	return parsed;
}

function resolveDefaultRunsDir(factoryId = "", { baseDir = process.cwd() }: { baseDir?: string } = {}): string {
	const scopedFactoryId = trim(factoryId);
	if (scopedFactoryId) return path.resolve(baseDir, ".hatch", scopedFactoryId, "runs");
	return path.resolve(baseDir, ".hatch", "runs");
}

function configPathToFactoryRoot(configPath = ""): string {
	const normalized = normalizePath(configPath);
	if (!normalized) return "";
	if (path.basename(normalized) === FACTORY_CONFIG_FILE) {
		return path.dirname(normalized);
	}
	return normalized;
}

function resolveFactoryRootFromConfig({
	explicitFactoryRoot = "",
	envFactoryRoot = "",
	configFactoryRoot = "",
	configPath = "",
	cwd = process.cwd(),
}: {
	explicitFactoryRoot?: string;
	envFactoryRoot?: string;
	configFactoryRoot?: string;
	configPath?: string;
	cwd?: string;
} = {}): string {
	const explicit = trim(explicitFactoryRoot);
	if (explicit) return normalizePath(explicit, { baseDir: cwd });

	const configDir = configPathToFactoryRoot(configPath);
	if (configDir) {
		const declared = trim(configFactoryRoot);
		if (!declared) return configDir;
		if (path.isAbsolute(declared)) return declared;

		const fromCwd = path.resolve(cwd, declared);
		const fromConfigDir = path.resolve(configDir, declared);
		const configPathNormalized = normalizePath(configPath);

		if (normalizePath(path.join(fromCwd, FACTORY_CONFIG_FILE)) === configPathNormalized) return fromCwd;
		if (normalizePath(path.join(fromConfigDir, FACTORY_CONFIG_FILE)) === configPathNormalized) return fromConfigDir;

		return configDir;
	}

	const fromEnv = trim(envFactoryRoot);
	if (fromEnv) return normalizePath(fromEnv, { baseDir: cwd });
	return "";
}

function resolveConfigRelativeBase({
	configFactoryRoot = "",
	configPath = "",
	resolvedFactoryRoot = "",
	cwd = process.cwd(),
}: {
	configFactoryRoot?: string;
	configPath?: string;
	resolvedFactoryRoot?: string;
	cwd?: string;
} = {}): string {
	const configDir = configPathToFactoryRoot(configPath);
	const declaredFactoryRoot = trim(configFactoryRoot);
	if (!configDir) return normalizePath(resolvedFactoryRoot || cwd, { baseDir: cwd });
	if (!declaredFactoryRoot || path.isAbsolute(declaredFactoryRoot)) return configDir;

	const candidateWorkspaceRoot = path.resolve(configDir, path.relative(declaredFactoryRoot, "."));
	const normalizedResolvedFactoryRoot = normalizePath(resolvedFactoryRoot, { baseDir: cwd });
	const rebuiltFactoryRoot = normalizePath(path.resolve(candidateWorkspaceRoot, declaredFactoryRoot));

	if (!normalizedResolvedFactoryRoot || rebuiltFactoryRoot === normalizedResolvedFactoryRoot) {
		return candidateWorkspaceRoot;
	}

	return configDir;
}

function readScenarioRootFromConfig(config: Record<string, unknown>): string {
	const scenarios = config["scenarios"];
	const scenarioRoot = scenarios && typeof scenarios === "object"
		? String((scenarios as Record<string, unknown>)["root"] || "")
		: "";
	return pickString(
		String(config["scenarios_root"] || ""),
		String(config["scenario_root"] || ""),
		scenarioRoot,
	);
}

function readWorkDirFromConfig(config: Record<string, unknown>): string {
	return trim(String(config["work_dir"] || ""));
}

function readWorkspaceModeFromConfig(config: Record<string, unknown>): string {
	return trim(String(config["workspace_mode"] || ""));
}

function readCanonicalCheckoutPathFromConfig(config: Record<string, unknown>): string {
	return trim(String(config["canonical_checkout_path"] || ""));
}

function readTrustDomainFromConfig(config: Record<string, unknown>): string {
	const trust = config["trust"];
	if (isRecord(trust)) {
		const nested = trim(String(trust["domain"] || ""));
		if (nested) return nested;
	}
	return trim(String(config["trust_domain"] || ""));
}

function readTrustRoleFromConfig(config: Record<string, unknown>, trustDomain = ""): string {
	const explicit = trim(String(config["trust_role"] || ""));
	if (explicit) return explicit;

	const trust = config["trust"];
	if (isRecord(trust) && Array.isArray(trust["roles"])) {
		const toolRole = trust["roles"]
			.map((entry) => trim(String(entry || "")))
			.find((entry) => entry.endsWith(".tool"));
		if (toolRole) return toolRole;
		const firstRole = trust["roles"]
			.map((entry) => trim(String(entry || "")))
			.find(Boolean);
		if (firstRole) return firstRole;
	}

	if (Array.isArray(config["trust_roles"])) {
		const toolRole = config["trust_roles"]
			.map((entry) => trim(String(entry || "")))
			.find((entry) => entry.endsWith(".tool"));
		if (toolRole) return toolRole;
		const firstRole = config["trust_roles"]
			.map((entry) => trim(String(entry || "")))
			.find(Boolean);
		if (firstRole) return firstRole;
	}

	return trustDomain ? `${trustDomain}.tool` : "";
}

function readTargetRepoFromConfig(config: Record<string, unknown>): string {
	return trim(String(config["target_repo"] || ""));
}

function readControlPlaneRepoFromConfig(config: Record<string, unknown>, targetRepo = ""): string {
	return pickString(String(config["control_plane_repo"] || ""), targetRepo);
}

function readFactoryConfigPathFromEnv(env: Record<string, string | undefined> = process.env): string {
	return pickString(env.HATCH_FACTORY_CONFIG_PATH, env.FACTORY_CONFIG_PATH);
}

function readFactoryRootFromEnv(env: Record<string, string | undefined> = process.env): string {
	return pickString(env.HATCH_FACTORY_ROOT, env.FACTORY_ROOT);
}

function readFactoryIdFromEnv(env: Record<string, string | undefined> = process.env): string {
	return pickString(env.HATCH_FACTORY_ID, env.FACTORY_ID);
}

function readTargetRepoFromEnv(env: Record<string, string | undefined> = process.env): string {
	return pickString(
		env.HATCH_TARGET_REPO,
		env.TARGET_REPO,
		env.HATCH_GH_REPO,
		env.GH_REPO,
		env.MOTHERSHIP_REPO,
	);
}

function readControlPlaneRepoFromEnv(env: Record<string, string | undefined> = process.env): string {
	return pickString(env.HATCH_CONTROL_PLANE_REPO, env.CONTROL_PLANE_REPO);
}

function readKindIdFromEnv(env: Record<string, string | undefined> = process.env): string {
	return pickString(env.HATCH_KIND_ID, env.KIND_ID);
}

function readInstanceIdFromEnv(env: Record<string, string | undefined> = process.env): string {
	return pickString(env.HATCH_INSTANCE_ID, env.INSTANCE_ID);
}

function readDestinationsJsonFromEnv(env: Record<string, string | undefined> = process.env): string {
	return pickString(env.HATCH_DESTINATIONS_JSON, env.DESTINATIONS_JSON);
}

function readRunsDirFromEnv(env: Record<string, string | undefined> = process.env): string {
	return pickString(env.HATCH_RUNS_DIR, env.RUNS_DIR);
}

function readScenariosRootFromEnv(env: Record<string, string | undefined> = process.env): string {
	return pickString(env.HATCH_SCENARIOS_ROOT, env.SCENARIOS_ROOT);
}

function resolveFactoryRootInput({
	factoryRoot = "",
	processEnv = process.env,
}: {
	factoryRoot?: string;
	processEnv?: Record<string, string | undefined>;
} = {}): string {
	const explicit = trim(factoryRoot);
	if (explicit) return explicit;
	const fromEnv = readFactoryRootFromEnv(processEnv);
	return fromEnv || DEFAULT_FACTORY_ROOT;
}

function resolveFactoryConfigPathInput({
	factoryRoot = "",
	configPath = "",
	processEnv = process.env,
}: {
	factoryRoot?: string;
	configPath?: string;
	processEnv?: Record<string, string | undefined>;
} = {}): string {
	const explicit = trim(configPath);
	if (explicit) return explicit;
	const resolvedFactoryRoot = resolveFactoryRootInput({ factoryRoot, processEnv });
	return path.join(resolvedFactoryRoot, FACTORY_CONFIG_FILE);
}

function loadFactoryConfig({
	factoryRoot = "",
	configPath = "",
	processEnv = process.env,
	requiredKeys = REQUIRED_FACTORY_CONFIG_KEYS,
}: {
	factoryRoot?: string;
	configPath?: string;
	processEnv?: Record<string, string | undefined>;
	requiredKeys?: readonly string[];
} = {}): LoadedFactoryConfig {
	const resolvedFactoryRoot = resolveFactoryRootInput({ factoryRoot, processEnv });
	const resolvedConfigPath = resolveFactoryConfigPathInput({ factoryRoot: resolvedFactoryRoot, configPath, processEnv });

	let parsed: unknown;
	try {
		const raw = readFileSync(resolvedConfigPath, "utf8");
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(`Unable to read factory config at ${resolvedConfigPath}: ${String(error instanceof Error ? error.message : error)}`);
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Factory config at ${resolvedConfigPath} must be a JSON object`);
	}

	const required = Array.from(new Set((requiredKeys || []).map((key) => trim(key)).filter(Boolean)));
	if (required.length > 0) {
		const record = parsed as Record<string, unknown>;
		const missing = required.filter((key) => {
			const value = record[key];
			if (value === undefined || value === null) return true;
			if (typeof value === "string" && !value.trim()) return true;
			return false;
		});
		if (missing.length > 0) {
			throw new Error(`Factory config at ${resolvedConfigPath} is missing required keys: ${missing.join(", ")}`);
		}
	}

	return {
		factoryRoot: resolvedFactoryRoot,
		configPath: resolvedConfigPath,
		config: parsed as Record<string, unknown>,
	};
}

function loadConfigOrThrow({
	configPath = "",
	factoryRoot = "",
	processEnv = process.env,
	source = "default",
}: {
	configPath?: string;
	factoryRoot?: string;
	processEnv?: Record<string, string | undefined>;
	source?: string;
} = {}): { loaded: LoadedFactoryConfig; source: string } {
	try {
		const loaded = loadFactoryConfig({
			factoryRoot,
			configPath,
			processEnv,
			requiredKeys: REQUIRED_FACTORY_CONFIG_KEYS,
		});
		return {
			loaded,
			source,
		};
	} catch (error) {
		const reason = String(error instanceof Error ? error.message : error || "factory_config_load_failed").replace(/\s+/g, " ").trim();
		const from = configPath
			? `${source}:${normalizePath(configPath)}`
			: `${source}:${normalizePath(factoryRoot || DEFAULT_FACTORY_ROOT)}`;
		throw new Error(
			`[factory-context] unable to load ${FACTORY_CONFIG_FILE} from ${from}: ${reason}. `
			+ "Use --factory-config-path <path> or --factory-root <path> to override.",
		);
	}
}

export function findNearestFactoryConfigPath({ startDir = process.cwd() }: { startDir?: string } = {}): string {
	let current = normalizePath(startDir) || process.cwd();
	let previous = "";
	while (current && current !== previous) {
		const candidate = path.join(current, FACTORY_CONFIG_FILE);
		if (existsSync(candidate)) return candidate;
		previous = current;
		current = path.dirname(current);
	}
	return "";
}

function findNearestInstanceManifestPath({ startDir = process.cwd() }: { startDir?: string } = {}): string {
	let current = normalizePath(startDir) || process.cwd();
	let previous = "";
	while (current && current !== previous) {
		const candidate = path.join(current, INSTANCE_MANIFEST_FILE);
		if (existsSync(candidate)) return candidate;
		previous = current;
		current = path.dirname(current);
	}
	return "";
}

function loadNearestInstanceManifest({ startDir = process.cwd() }: { startDir?: string } = {}): LoadedInstanceManifest | null {
	const manifestPath = findNearestInstanceManifestPath({ startDir });
	if (!manifestPath) return null;
	const manifest = readJsonRecord(manifestPath, "factory instance manifest");
	return {
		manifestPath,
		manifest,
	};
}

function readInstanceTargetRepo(manifest: Record<string, unknown>): string {
	const targetRepo = manifest["target_repo"];
	if (typeof targetRepo === "string") return trim(targetRepo);
	if (isRecord(targetRepo)) {
		return trim(String(targetRepo["full_name"] || ""));
	}
	return "";
}

function readInstanceDestinations(manifest: Record<string, unknown>): Record<string, unknown> | null {
	const destinations = manifest["destinations"];
	if (!isRecord(destinations)) return null;
	return destinations;
}

export function normalizeFactoryContext(context: Partial<FactoryContext> | Record<string, unknown> = {}, { runsDirFallback = "" }: { runsDirFallback?: string } = {}): FactoryContext {
	const value = context && typeof context === "object" ? context : {};
	const source = value as Record<string, unknown>;
	const targetRepo = trim(String(source["target_repo"] || ""));
	const factoryMode = (trim(String(source["factory_mode"] || "")).toLowerCase() === "managed"
		? "managed"
		: "standalone") as FactoryMode;
	const rawFactoryModeSource = source["factory_mode_source"];
	const factoryModeSource = Array.isArray(rawFactoryModeSource)
		? rawFactoryModeSource
			.map((entry) => {
				if (!isRecord(entry)) return null;
				const mode = trim(String(entry["mode"] || "")).toLowerCase() === "managed"
					? "managed"
					: "standalone";
				const precedenceRaw = trim(String(entry["precedence"] || "")).toLowerCase();
				const precedence = precedenceRaw === "high" || precedenceRaw === "medium" || precedenceRaw === "low"
					? precedenceRaw
					: "low";
				return {
					source: trim(String(entry["source"] || "mode.default")),
					mode,
					precedence,
					detail: trim(String(entry["detail"] || "")),
				} satisfies ModeSource;
			})
			.filter((entry): entry is ModeSource => Boolean(entry))
		: [];
	return {
		factory_root: trim(String(source["factory_root"] || "")),
		factory_config_path: trim(String(source["factory_config_path"] || "")),
		factory_id: trim(String(source["factory_id"] || "")),
		workspace_mode: trim(String(source["workspace_mode"] || "")),
		work_dir: trim(String(source["work_dir"] || "")),
		canonical_checkout_path: trim(String(source["canonical_checkout_path"] || "")),
		target_repo: targetRepo,
		repo: trim(String(source["repo"] || "")),
		control_plane_repo: trim(String(source["control_plane_repo"] || "")),
		kind_id: trim(String(source["kind_id"] || "")),
		kind_path: trim(String(source["kind_path"] || "")),
		instance_id: trim(String(source["instance_id"] || "")),
		instance_path: trim(String(source["instance_path"] || "")),
		destinations_json: normalizeDestinationsJsonValue(source["destinations_json"] ?? source["destinations"]),
		runs_dir: trim(String(source["runs_dir"] || "")) || trim(runsDirFallback),
		scenarios_root: trim(String(source["scenarios_root"] || "")),
		trust_domain: trim(String(source["trust_domain"] || "")),
		trust_role: trim(String(source["trust_role"] || "")),
		factory_mode: factoryMode,
		factory_mode_source: factoryModeSource,
	};
}

export function formatFactoryContextHeaderLines(context: Partial<FactoryContext> | Record<string, unknown> = {}): string[] {
	const normalized = normalizeFactoryContext(context);
	const hasAny = [
		normalized.factory_root,
		normalized.factory_config_path,
		normalized.factory_id,
		normalized.workspace_mode,
		normalized.work_dir,
		normalized.canonical_checkout_path,
		normalized.target_repo,
		normalized.repo,
		normalized.control_plane_repo,
		normalized.kind_id,
		normalized.kind_path,
		normalized.instance_id,
		normalized.instance_path,
		normalized.destinations_json,
		normalized.runs_dir,
		normalized.scenarios_root,
		normalized.trust_domain,
		normalized.trust_role,
	].some((value) => trim(value));
	if (!hasAny) return [];

	const lines = [
		`Factory: ${normalized.factory_root || "(unresolved)"}`,
		`Factory ID: ${normalized.factory_id || "(unresolved)"}`,
		`Target Repo: ${normalized.target_repo || "(unresolved)"}`,
	];

	if (normalized.kind_id) {
		lines.push(`Kind ID: ${normalized.kind_id}`);
	}
	if (normalized.instance_id) {
		lines.push(`Instance ID: ${normalized.instance_id}`);
	}
	lines.push(`Factory Mode: ${normalized.factory_mode}`);
	if (normalized.workspace_mode) lines.push(`Workspace Mode: ${normalized.workspace_mode}`);
	if (normalized.work_dir) lines.push(`Work Dir: ${normalized.work_dir}`);
	if (normalized.canonical_checkout_path) lines.push(`Canonical Checkout: ${normalized.canonical_checkout_path}`);

	lines.push(
		`Control Plane: ${normalized.control_plane_repo || "(unresolved)"}`,
		`Runs Dir: ${normalized.runs_dir || "(unresolved)"}`,
		"",
	);

	return lines;
}

export function resolveFactoryContext({
	cwd = process.cwd(),
	factoryRoot = "",
	factoryConfigPath = "",
	configPath = "",
	processEnv = process.env,
	factoryId = "",
	targetRepo = "",
	repo = "",
	controlPlaneRepo = "",
	kindId = "",
	instanceId = "",
	destinationsJson = "",
	runsDir = "",
	scenariosRoot = "",
	factoryMode = "",
	requireTargetRepo = false,
}: ResolveFactoryContextOptions = {}): FactoryContext {
	const resolvedCwd = normalizePath(cwd) || process.cwd();

	const flagFactoryRoot = trim(factoryRoot);
	const flagFactoryConfigPath = trim(factoryConfigPath || configPath);
	const flagFactoryId = trim(factoryId);
	const flagTargetRepo = trim(targetRepo || repo);
	const flagControlPlaneRepo = trim(controlPlaneRepo);
	const flagKindId = trim(kindId);
	const flagInstanceId = trim(instanceId);
	const flagDestinationsJson = trim(destinationsJson);
	const flagRunsDir = trim(runsDir);
	const flagScenariosRoot = trim(scenariosRoot);
	const flagFactoryMode = trim(String(factoryMode || ""));

	const envFactoryRoot = readFactoryRootFromEnv(processEnv);
	const envFactoryConfigPath = readFactoryConfigPathFromEnv(processEnv);
	const envFactoryId = readFactoryIdFromEnv(processEnv);
	const envTargetRepo = readTargetRepoFromEnv(processEnv);
	const envControlPlaneRepo = readControlPlaneRepoFromEnv(processEnv);
	const envKindId = readKindIdFromEnv(processEnv);
	const envInstanceId = readInstanceIdFromEnv(processEnv);
	const envDestinationsJson = readDestinationsJsonFromEnv(processEnv);
	const envRunsDir = readRunsDirFromEnv(processEnv);
	const envScenariosRoot = readScenariosRootFromEnv(processEnv);
	const envFactoryMode = pickString(processEnv.HATCH_FACTORY_MODE, processEnv.FACTORY_MODE);

	const nearestConfigPath = findNearestFactoryConfigPath({ startDir: resolvedCwd });

	let loadedConfig: LoadedFactoryConfig | null = null;
	let loadedSource = "";
	if (flagFactoryConfigPath) {
		const loaded = loadConfigOrThrow({
			configPath: normalizePath(flagFactoryConfigPath, { baseDir: resolvedCwd }),
			processEnv,
			source: "flag(--factory-config-path)",
		});
		loadedConfig = loaded.loaded;
		loadedSource = loaded.source;
	} else if (flagFactoryRoot) {
		const loaded = loadConfigOrThrow({
			factoryRoot: normalizePath(flagFactoryRoot, { baseDir: resolvedCwd }),
			processEnv,
			source: "flag(--factory-root)",
		});
		loadedConfig = loaded.loaded;
		loadedSource = loaded.source;
	} else if (envFactoryConfigPath) {
		const loaded = loadConfigOrThrow({
			configPath: normalizePath(envFactoryConfigPath, { baseDir: resolvedCwd }),
			processEnv,
			source: "env(HATCH_FACTORY_CONFIG_PATH|FACTORY_CONFIG_PATH)",
		});
		loadedConfig = loaded.loaded;
		loadedSource = loaded.source;
	} else if (envFactoryRoot) {
		const loaded = loadConfigOrThrow({
			factoryRoot: normalizePath(envFactoryRoot, { baseDir: resolvedCwd }),
			processEnv,
			source: "env(HATCH_FACTORY_ROOT|FACTORY_ROOT)",
		});
		loadedConfig = loaded.loaded;
		loadedSource = loaded.source;
	} else if (nearestConfigPath) {
		const loaded = loadConfigOrThrow({
			configPath: nearestConfigPath,
			processEnv,
			source: "nearest",
		});
		loadedConfig = loaded.loaded;
		loadedSource = loaded.source;
	} else if (flagFactoryId) {
		// When --factory-id is given without an explicit root/config, try to
		// resolve factories/{id}/factory.config.json relative to cwd.
		const candidatePath = path.resolve(resolvedCwd, "factories", flagFactoryId, FACTORY_CONFIG_FILE);
		if (existsSync(candidatePath)) {
			const loaded = loadConfigOrThrow({
				configPath: candidatePath,
				processEnv,
				source: "flag(--factory-id)",
			});
			loadedConfig = loaded.loaded;
			loadedSource = loaded.source;
		}
	}

	if (!loadedConfig) {
		try {
			const loaded = loadConfigOrThrow({ processEnv, source: "default" });
			loadedConfig = loaded.loaded;
			loadedSource = loaded.source;
		} catch {
			loadedConfig = null;
			loadedSource = "";
		}
	}

	const configPathResolved = normalizePath(
		loadedConfig?.configPath || flagFactoryConfigPath || envFactoryConfigPath,
		{ baseDir: resolvedCwd },
	);
	const configBaseDir = configPathToFactoryRoot(configPathResolved) || resolvedCwd;
	const config = (loadedConfig?.config || {}) as Record<string, unknown>;

	let isolationConfig;
	try {
		isolationConfig = getFactoryIsolationConfig(config);
	} catch (error) {
		throw new Error(
			`[factory-context] invalid isolation contract in ${configPathResolved || "factory.config.json"}: ${String(error instanceof Error ? error.message : error)}`,
		);
	}

	const resolvedFactoryRoot = resolveFactoryRootFromConfig({
		explicitFactoryRoot: flagFactoryRoot,
		envFactoryRoot,
		configFactoryRoot: String(config["factory_root"] || ""),
		configPath: configPathResolved,
		cwd: resolvedCwd,
	}) || normalizePath(loadedConfig?.factoryRoot, { baseDir: configBaseDir });

	const resolvedFactoryId = pickString(
		flagFactoryId,
		String(config["factory_id"] || ""),
		envFactoryId,
		path.basename(resolvedFactoryRoot),
	);

	const configRelativeBase = resolveConfigRelativeBase({
		configFactoryRoot: String(config["factory_root"] || ""),
		configPath: configPathResolved,
		resolvedFactoryRoot,
		cwd: resolvedCwd,
	});

	const manifestStartDir = normalizePath(configRelativeBase || resolvedFactoryRoot || resolvedCwd, { baseDir: resolvedCwd });
	const loadedInstanceManifest = loadNearestInstanceManifest({ startDir: manifestStartDir || resolvedCwd });
	const instanceManifestPath = loadedInstanceManifest?.manifestPath || "";
	const instanceManifest = loadedInstanceManifest?.manifest || {};
	const manifestTargetRepo = readInstanceTargetRepo(instanceManifest);
	const manifestControlPlaneRepo = trim(String(instanceManifest["control_plane_repo"] || ""));
	const manifestKindId = trim(String(instanceManifest["kind_id"] || ""));
	const manifestInstanceId = trim(String(instanceManifest["instance_id"] || ""));
	const manifestDestinations = readInstanceDestinations(instanceManifest);

	const configTargetRepo = readTargetRepoFromConfig(config);
	if (configTargetRepo && manifestTargetRepo && normalizeRepoIdentity(configTargetRepo) !== normalizeRepoIdentity(manifestTargetRepo)) {
		throw new Error(
			`[factory-context] identity mismatch: config target_repo=${configTargetRepo} conflicts with instance manifest target_repo=${manifestTargetRepo}`,
		);
	}

	const resolvedTargetRepo = pickString(
		flagTargetRepo,
		configTargetRepo,
		manifestTargetRepo,
		envTargetRepo,
	);

	if (requireTargetRepo && !resolvedTargetRepo) {
		const sourceHint = loadedSource || "context";
		throw new Error(
			`[factory-context] unable to resolve target_repo from ${sourceHint}. `
			+ "Use --repo <owner/repo>, set HATCH_TARGET_REPO, or declare target_repo in factory.config.json.",
		);
	}

	assertFactoryIsolationContext({
		isolationConfig,
		factoryId: resolvedFactoryId,
		targetRepo: resolvedTargetRepo,
	});

	const resolvedControlPlaneRepo = pickString(
		flagControlPlaneRepo,
		manifestControlPlaneRepo,
		readControlPlaneRepoFromConfig(config, resolvedTargetRepo),
		envControlPlaneRepo,
		resolvedTargetRepo,
	);

	const resolvedKindId = pickString(
		flagKindId,
		manifestKindId,
		String(config["kind_id"] || ""),
		envKindId,
	);

	const resolvedInstanceId = pickString(
		flagInstanceId,
		manifestInstanceId,
		String(config["instance_id"] || ""),
		envInstanceId,
	);

	const resolvedDestinationsJson = flagDestinationsJson
		? normalizeDestinationsFromSource(flagDestinationsJson, "flag(--destinations-json)")
		: manifestDestinations
				? normalizeDestinationsFromSource(
					manifestDestinations,
					instanceManifestPath || "instance manifest",
				)
				: isRecord(config["destinations"])
					? normalizeDestinationsFromSource(
						config["destinations"],
						configPathResolved || FACTORY_CONFIG_FILE,
					)
				: envDestinationsJson
						? normalizeDestinationsFromSource(envDestinationsJson, "env(HATCH_DESTINATIONS_JSON|DESTINATIONS_JSON)")
				: "";

	const resolvedWorkDir = normalizeConfiguredPath(readWorkDirFromConfig(config), { baseDir: configRelativeBase });
	const resolvedWorkspaceMode = readWorkspaceModeFromConfig(config);
	const resolvedCanonicalCheckoutPath = normalizeConfiguredPath(readCanonicalCheckoutPathFromConfig(config), {
		baseDir: configRelativeBase,
		preserveSymbolic: true,
	});
	// @context:integration !critical shared factory context must preserve managed checkout metadata,
	// because host-install and daemon bootstrap consume this resolver output directly. Dropping these
	// fields silently degrades checkout factories into api_only installs.
	const resolvedRepo = normalizePath(resolvedWorkDir || ".", { baseDir: configRelativeBase });
	const runsBaseDir = resolvedWorkDir ? resolvedRepo : configRelativeBase;
	const explicitOrEnvRunsDir = pickString(flagRunsDir, envRunsDir);
	const configRunsDir = trim(String(config["runs_dir"] || ""));
	const defaultRunsDir = configRunsDir
		? normalizePath(configRunsDir, { baseDir: runsBaseDir })
		: resolveDefaultRunsDir(resolvedFactoryId, { baseDir: runsBaseDir });
	const isolatedRuntimePaths = resolveFactoryRuntimePaths(isolationConfig, {
		runs: defaultRunsDir,
		baseDir: configRelativeBase,
	});
	const resolvedRunsDir = explicitOrEnvRunsDir
		? normalizePath(explicitOrEnvRunsDir, { baseDir: resolvedCwd })
		: isolatedRuntimePaths.runs;

	const explicitOrEnvScenariosRoot = pickString(flagScenariosRoot, envScenariosRoot);
	const configScenariosRoot = trim(readScenarioRootFromConfig(config));
	if (!explicitOrEnvScenariosRoot && !configScenariosRoot) {
		const sourceHint = loadedSource || "context";
		throw new Error(
			`[factory-context] unable to resolve scenarios.root from ${sourceHint}. `
			+ "Set scenarios.root in factory.config.json or provide --scenarios-root / HATCH_SCENARIOS_ROOT.",
		);
	}
	const resolvedScenariosRoot = explicitOrEnvScenariosRoot
		? normalizePath(explicitOrEnvScenariosRoot, { baseDir: resolvedCwd })
		: normalizePath(configScenariosRoot, { baseDir: configRelativeBase });
	const resolvedKindPath = normalizePath(path.join(resolvedFactoryRoot, "kind.json"), { baseDir: resolvedCwd });
	const resolvedInstancePath = instanceManifestPath || normalizePath(INSTANCE_MANIFEST_FILE, { baseDir: configRelativeBase });
	const resolvedTrustDomain = readTrustDomainFromConfig(config) || `${resolvedFactoryId}.local`;
	const resolvedTrustRole = readTrustRoleFromConfig(config, resolvedTrustDomain);

	const modeOverlays: Array<{ key: string; value: unknown; source: string }> = [];
	if (flagKindId) modeOverlays.push({ key: "kind_id", value: flagKindId, source: "flag(--kind-id)" });
	if (flagInstanceId) modeOverlays.push({ key: "instance_id", value: flagInstanceId, source: "flag(--instance-id)" });
	if (flagDestinationsJson) modeOverlays.push({ key: "destinations", value: flagDestinationsJson, source: "flag(--destinations-json)" });
	if (envKindId) modeOverlays.push({ key: "kind_id", value: envKindId, source: "env(HATCH_KIND_ID|KIND_ID)" });
	if (envInstanceId) modeOverlays.push({ key: "instance_id", value: envInstanceId, source: "env(HATCH_INSTANCE_ID|INSTANCE_ID)" });
	if (envDestinationsJson) modeOverlays.push({ key: "destinations", value: envDestinationsJson, source: "env(HATCH_DESTINATIONS_JSON|DESTINATIONS_JSON)" });

	let modeResolution;
	try {
		modeResolution = resolveModeSources({
			factoryConfig: config,
			factoryConfigPath: configPathResolved || undefined,
			managedOverlays: modeOverlays,
			instanceManifest: loadedInstanceManifest?.manifest || null,
			instanceManifestPath: instanceManifestPath || undefined,
			cliFactoryMode: flagFactoryMode,
			envFactoryMode,
			destinations: resolvedDestinationsJson,
		});
	} catch (error) {
		if (error instanceof ModeConflictError) {
			throw new Error(
				`[factory-context:${FACTORY_CONTEXT_MODE_CONFLICT_ERROR_CODE}] ${error.message}`,
			);
		}
		throw error;
	}

	return normalizeFactoryContext({
		factory_root: resolvedFactoryRoot,
		factory_config_path: configPathResolved,
		factory_id: resolvedFactoryId,
		workspace_mode: resolvedWorkspaceMode,
		work_dir: resolvedWorkDir,
		canonical_checkout_path: resolvedCanonicalCheckoutPath,
		target_repo: resolvedTargetRepo,
		repo: resolvedRepo,
		control_plane_repo: resolvedControlPlaneRepo,
		kind_id: resolvedKindId,
		kind_path: resolvedKindPath,
		instance_id: resolvedInstanceId,
		instance_path: resolvedInstancePath,
		destinations_json: resolvedDestinationsJson,
		runs_dir: resolvedRunsDir,
		scenarios_root: resolvedScenariosRoot,
		trust_domain: resolvedTrustDomain,
		trust_role: resolvedTrustRole,
		factory_mode: modeResolution.mode,
		factory_mode_source: modeResolution.source,
	});
}
