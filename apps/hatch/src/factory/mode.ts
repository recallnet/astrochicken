export const FACTORY_MODES = ["standalone", "managed"] as const;
export type FactoryMode = (typeof FACTORY_MODES)[number];

export const FACTORY_MODE_CONFLICT_ERROR_CODE = "FACTORY_MODE_CONFLICT" as const;

export const MODE_SOURCE_PRECEDENCE = ["high", "medium", "low"] as const;
export type ModeSourcePrecedence = (typeof MODE_SOURCE_PRECEDENCE)[number];

export interface ModeSource {
	source: string;
	mode: FactoryMode;
	precedence: ModeSourcePrecedence;
	detail: string;
}

export interface ManagedOverlay {
	key: string;
	value?: unknown;
	source?: string;
}

export interface ContextArtifacts {
	factoryConfig?: Record<string, unknown>;
	factoryConfigPath?: string;
	managedOverlays?: ManagedOverlay[];
	instanceManifest?: Record<string, unknown> | null;
	instanceManifestPath?: string;
	cliFactoryMode?: string;
	envFactoryMode?: string;
	destinations?: unknown;
}

export class ModeConflictError extends Error {
	readonly code = FACTORY_MODE_CONFLICT_ERROR_CODE;
	readonly conflictingSources: ModeSource[];
	readonly precedence: ModeSourcePrecedence;

	constructor({ conflictingSources, precedence }: { conflictingSources: ModeSource[]; precedence: ModeSourcePrecedence }) {
		const summary = conflictingSources
			.map((source) => `${source.source}=>${source.mode}`)
			.join(", ");
		super(`[factory-mode] conflicting mode signals at precedence=${precedence}: ${summary}`);
		this.name = "ModeConflictError";
		this.conflictingSources = conflictingSources;
		this.precedence = precedence;
	}
}

const MANAGED_OVERLAY_KEYS = [
	"managed",
	"kind_id",
	"instance_id",
	"destinations",
	"upstream_repo",
	"work_dir",
	"upstream_bug_labels",
	"slack_webhook_url",
	"canonical_checkout_path",
	"schedules",
] as const;

const MANIFEST_MANAGED_HINT_KEYS = [
	"kind_id",
	"instance_id",
	"destinations",
	"control_plane_repo",
] as const;

function trim(value: unknown = ""): string {
	return String(value ?? "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseFactoryMode(value: unknown): FactoryMode | "" {
	const normalized = trim(value).toLowerCase();
	if (!normalized) return "";
	if (normalized === "standalone" || normalized === "managed") return normalized;
	throw new Error(`[factory-mode] invalid factory mode "${trim(String(value))}"; expected standalone|managed`);
}

function hasMeaningfulValue(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (typeof value === "string") return trim(value).length > 0;
	if (Array.isArray(value)) return value.length > 0;
	if (isRecord(value)) return Object.keys(value).length > 0;
	return true;
}

function dedupeSources(sources: ModeSource[]): ModeSource[] {
	const seen = new Set<string>();
	const deduped: ModeSource[] = [];
	for (const source of sources) {
		const key = `${source.precedence}:${source.source}:${source.mode}:${source.detail}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(source);
	}
	return deduped;
}

function resolveSignals({
	signals,
	fallbackSource,
}: {
	signals: ModeSource[];
	fallbackSource: ModeSource;
}): { mode: FactoryMode; source: ModeSource[] } {
	const deduped = dedupeSources(signals);
	for (const precedence of MODE_SOURCE_PRECEDENCE) {
		const scoped = deduped.filter((source) => source.precedence === precedence);
		if (scoped.length === 0) continue;
		const modes = [...new Set(scoped.map((source) => source.mode))];
		if (modes.length > 1) {
			throw new ModeConflictError({ conflictingSources: scoped, precedence });
		}
		return {
			mode: modes[0],
			source: deduped,
		};
	}

	return {
		mode: fallbackSource.mode,
		source: [fallbackSource],
	};
}

function deriveManagedOverlaysFromConfig(factoryConfig: Record<string, unknown>): ManagedOverlay[] {
	const overlays: ManagedOverlay[] = [];
	for (const key of MANAGED_OVERLAY_KEYS) {
		if (!(key in factoryConfig)) continue;
		overlays.push({ key, value: factoryConfig[key], source: "factory.config.json" });
	}
	return overlays;
}

export function deriveModeFromConfig(
	factoryConfig: Record<string, unknown> = {},
	overlays: ManagedOverlay[] = [],
): { mode: FactoryMode; source: ModeSource[] } {
	const config = isRecord(factoryConfig) ? factoryConfig : {};
	const sources: ModeSource[] = [];

	if (typeof config["managed"] === "boolean") {
		sources.push({
			source: "factory.config.json#managed",
			mode: config["managed"] === true ? "managed" : "standalone",
			precedence: "high",
			detail: `managed=${String(config["managed"])}`,
		});
	}

	const mergedOverlays = [...deriveManagedOverlaysFromConfig(config), ...(overlays || [])];
	for (const overlay of mergedOverlays) {
		if (!overlay || !trim(overlay.key)) continue;
		if (overlay.key === "managed") continue;
		if (!hasMeaningfulValue(overlay.value)) continue;
		sources.push({
			source: `${trim(overlay.source) || "factory.config.json"}#${overlay.key}`,
			mode: "managed",
			precedence: "high",
			detail: `managed_overlay=${overlay.key}`,
		});
	}

	const targetRepo = trim(String(config["target_repo"] || "")).toLowerCase();
	const controlPlaneRepo = trim(String(config["control_plane_repo"] || "")).toLowerCase();
	if (targetRepo && controlPlaneRepo && targetRepo !== controlPlaneRepo) {
		sources.push({
			source: "factory.config.json#repo_topology",
			mode: "managed",
			precedence: "medium",
			detail: `target_repo=${targetRepo} control_plane_repo=${controlPlaneRepo}`,
		});
	}

	return resolveSignals({
		signals: sources,
		fallbackSource: {
			source: "factory.config.json#default",
			mode: "standalone",
			precedence: "low",
			detail: "no managed overlays detected",
		},
	});
}

function deriveModeFromInstanceManifest({
	instanceManifest = null,
	instanceManifestPath = ".hatch/instance.json",
}: {
	instanceManifest?: Record<string, unknown> | null;
	instanceManifestPath?: string;
} = {}): ModeSource[] {
	if (!isRecord(instanceManifest)) return [];
	const sources: ModeSource[] = [];

	const explicitMode = parseFactoryMode(instanceManifest["factory_mode"]);
	if (explicitMode) {
		sources.push({
			source: `${instanceManifestPath}#factory_mode`,
			mode: explicitMode,
			precedence: "high",
			detail: `factory_mode=${explicitMode}`,
		});
	}

	if (typeof instanceManifest["managed"] === "boolean") {
		sources.push({
			source: `${instanceManifestPath}#managed`,
			mode: instanceManifest["managed"] === true ? "managed" : "standalone",
			precedence: "high",
			detail: `managed=${String(instanceManifest["managed"])}`,
		});
	}

	const targetRepo = instanceManifest["target_repo"];
	if (isRecord(targetRepo)) {
		sources.push({
			source: `${instanceManifestPath}#target_repo`,
			mode: "managed",
			precedence: "high",
			detail: "instance manifest target_repo present",
		});
	}

	for (const key of MANIFEST_MANAGED_HINT_KEYS) {
		if (!hasMeaningfulValue(instanceManifest[key])) continue;
		sources.push({
			source: `${instanceManifestPath}#${key}`,
			mode: "managed",
			precedence: "high",
			detail: `instance manifest key ${key} present`,
		});
	}

	return sources;
}

function deriveModeFromDestinations({
	destinations,
	source,
}: {
	destinations: unknown;
	source: string;
}): ModeSource[] {
	if (!hasMeaningfulValue(destinations)) return [];
	return [{
		source,
		mode: "managed",
		precedence: "medium",
		detail: "destinations signal present",
	}];
}

export function resolveModeSources(contextArtifacts: ContextArtifacts = {}): { mode: FactoryMode; source: ModeSource[] } {
	const sources: ModeSource[] = [];

	const cliMode = parseFactoryMode(contextArtifacts.cliFactoryMode);
	if (cliMode) {
		sources.push({
			source: "flag(--factory-mode)",
			mode: cliMode,
			precedence: "high",
			detail: `factory_mode=${cliMode}`,
		});
	}

	const envMode = parseFactoryMode(contextArtifacts.envFactoryMode);
	if (envMode) {
		sources.push({
			source: "env(HATCH_FACTORY_MODE|FACTORY_MODE)",
			mode: envMode,
			precedence: "high",
			detail: `factory_mode=${envMode}`,
		});
	}

	const configResolution = deriveModeFromConfig(
		isRecord(contextArtifacts.factoryConfig) ? contextArtifacts.factoryConfig : {},
		contextArtifacts.managedOverlays,
	);
	sources.push(...configResolution.source.map((entry) => ({
		...entry,
		source: entry.source.startsWith("factory.config.json")
			? entry.source.replace("factory.config.json", contextArtifacts.factoryConfigPath || "factory.config.json")
			: entry.source,
	})));

	sources.push(...deriveModeFromInstanceManifest({
		instanceManifest: contextArtifacts.instanceManifest,
		instanceManifestPath: contextArtifacts.instanceManifestPath || ".hatch/instance.json",
	}));

	sources.push(...deriveModeFromDestinations({
		destinations: contextArtifacts.destinations,
		source: "destinations",
	}));

	return resolveSignals({
		signals: sources,
		fallbackSource: {
			source: "mode.default",
			mode: "standalone",
			precedence: "low",
			detail: "no explicit mode sources resolved",
		},
	});
}
