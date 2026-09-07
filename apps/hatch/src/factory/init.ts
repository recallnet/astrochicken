import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { stringifyFactoryCompositionManifestDocument } from "@hatch/factory-core/factory-composition-registry";
import {
	formatPolicyPackIssue,
	loadPolicyPackDocuments,
	parseFactoryConfigDocument,
	validatePolicyPackContract,
} from "./config-schema.js";
import {
	GRANDFATHERED_MOTHERSHIP_INSTANCE_ID,
	generateFactoryInstanceId,
	isValidFactoryInstanceId,
} from "./identity.js";
import { updateFactoryRegistry } from "./registry-update.js";
import { scaffoldFactory, type FactoryTemplateValues } from "./scaffold.js";
import { ensureFactoryTrackingIssue, type TrackingIssueResult } from "./tracking-issue.js";

const FACTORY_ID_PATTERN = /^[a-z0-9-]+$/;

function formatFactoryName(factoryId: string): string {
	return factoryId
		.split("-")
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

export interface ParsedFactoryInitArgs {
	factoryId: string;
	instanceId?: string;
	repo: string;
	controlPlane: string;
	force: boolean;
	runsDir?: string;
	rootDir: string;
}

export interface FactoryInitResult {
	factoryRoot: string;
	instanceId: string;
	trackingIssue: TrackingIssueResult;
	registryPath: string;
	writtenFiles: string[];
}

function flattenKeys(prefix: string, value: unknown): string[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];
	const keys: string[] = [];
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		const current = prefix ? `${prefix}.${key}` : key;
		if (nested && typeof nested === "object" && !Array.isArray(nested)) {
			const nestedKeys = flattenKeys(current, nested);
			if (nestedKeys.length === 0) keys.push(current);
			else keys.push(...nestedKeys);
			continue;
		}
		keys.push(current);
	}
	return keys.sort((left, right) => left.localeCompare(right));
}

function hasGraphSchedule(job: unknown): job is { graph: string } {
	if (!job || typeof job !== "object") return false;
	return "graph" in job && typeof (job as { graph?: unknown }).graph === "string";
}

function writeFactoryCompositionManifest(args: {
	rootDir: string;
	factoryRoot: string;
	config: ReturnType<typeof parseFactoryConfigDocument>;
	registryPath: string;
	registryEntryGraphs: Array<{ id: string; path: string }>;
}): string {
	const factoryRootRelative = args.factoryRoot.replace(`${args.rootDir}/`, "").replaceAll("\\", "/");
	const manifestRelativePath = `${factoryRootRelative}/inventory/factory-composition-manifest.v1.json`;
	const manifestAbsolutePath = join(args.rootDir, manifestRelativePath);
	const graphBindings = (args.registryEntryGraphs || []).map((graph) => ({
		id: graph.id,
		path: graph.path,
		owner: graph.path.startsWith(`${factoryRootRelative}/graphs/`) ? ("factory" as const) : ("shared" as const),
		role:
			graph.path === args.config.dispatch.graph ? ("dispatch" as const)
				: graph.path === args.config.pipeline.supervisor_tick ? ("supervisor" as const)
					: graph.path.startsWith("packages/") ? ("capability_binding" as const)
						: ("domain_policy" as const),
		capabilityPackage: graph.path.startsWith("packages/")
			? `@hatch/${graph.path.split("/")[1]}`
			: null,
	}));
	const privateExecutionGluePaths = graphBindings
		.filter((binding) => binding.owner === "factory" && [
			"goal_execute.dot",
			"goal_issue_execute.dot",
			"goal_queue.dot",
			"goal_run.dot",
			"goal_intake_decompose.dot",
			"wave_execute.dot",
			"wave_issue_execute.dot",
		].includes(binding.path.split("/").pop() || ""))
		.map((binding) => binding.path)
		.sort((left, right) => left.localeCompare(right));

	const manifest = {
		schemaVersion: "factory_composition_manifest/v1" as const,
		factoryId: args.config.factory_id,
		compositionModel: args.config.factory_id === "mothership" ? "control_plane" as const : "thin_composition" as const,
		manifestPath: manifestRelativePath,
		configPath: `${factoryRootRelative}/factory.config.json`,
		registryPath: args.registryPath.replace(`${args.rootDir}/`, "").replaceAll("\\", "/"),
		dispatchGraphPath: args.config.dispatch.graph,
		supervisorGraphPath: args.config.pipeline.supervisor_tick,
		graphBindings,
		bootstrap: {
			readmePath: null,
			intentPath: `${factoryRootRelative}/INTENT.md`,
			createEvolveDocPath: `${factoryRootRelative}/docs/factory-create-evolve.md`,
			conformanceReadmePath: `${factoryRootRelative}/conformance/README.md`,
			initCommand: `hatch factory init --id ${args.config.factory_id} --repo ${args.config.target_repo} --control-plane ${args.config.control_plane_repo}`,
		},
		policy: {
			configPath: `${factoryRootRelative}/factory.config.json`,
			policyPackDir: args.config.policyPack ? `${factoryRootRelative}/policy-pack/v1` : null,
			policyPackVersion: args.config.policyPack?.version || null,
			overrideKeys: flattenKeys("", args.config.policyPack?.overrides || {}),
			policyFiles: args.config.policyPack ? ["metadata.json", "reviewer-policy.json", "supervisor-policy.json"] : [],
		},
		artifactDefaults: {
			runsDir: args.config.runs_dir,
			trustDomain: args.config.trust.domain,
			trustRoles: [...args.config.trust.roles].sort((left, right) => left.localeCompare(right)),
			canonicalCheckoutPath: args.config.canonical_checkout_path || null,
			scheduledGraphs: (args.config.schedules?.jobs || [])
				.reduce<string[]>((graphs, job) => {
					if (hasGraphSchedule(job)) graphs.push(job.graph);
					return graphs;
				}, [])
				.sort((left, right) => left.localeCompare(right)),
		},
		telemetryDefaults: {
			dispatchLatencySloSeconds: args.config.dispatch.latency_slo_seconds ?? null,
			maintenanceIntervalSeconds: args.config.pipeline.maintenance_interval_seconds ?? null,
			conformanceEntrypoint: args.config.conformance?.entrypoint || null,
			conformanceRunsDir: args.config.conformance?.runs_dir || null,
			benchmarkTelemetryWarnOnly: Boolean(args.config.conformance?.benchmark_telemetry_warn_only),
			benchmarkTelemetryExemptions: [...(args.config.conformance?.benchmark_telemetry_exemptions || [])].sort((left, right) => left.localeCompare(right)),
		},
		privateExecutionGluePaths,
	};

	mkdirSync(join(args.factoryRoot, "inventory"), { recursive: true });
	writeFileSync(manifestAbsolutePath, stringifyFactoryCompositionManifestDocument(manifest), "utf8");
	return manifestRelativePath;
}

export interface FactoryInitDependencies {
	resolveTrackingIssue?: (options: { repo: string; factoryId: string; controlPlaneRepo: string }) => TrackingIssueResult;
}

function parseValue(args: string[], index: number, flag: string): string {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${flag} requires a value`);
	}
	return value;
}

export function parseFactoryInitArgs(args: string[], cwd: string = process.cwd()): ParsedFactoryInitArgs {
	let factoryId = "";
	let instanceId = "";
	let repo = "";
	let controlPlane = "";
	let force = false;
	let runsDir = "";
	let rootDir = cwd;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--id") {
			factoryId = parseValue(args, i, "--id");
			i += 1;
			continue;
		}
		if (arg.startsWith("--id=")) {
			factoryId = arg.slice("--id=".length);
			continue;
		}
		if (arg === "--repo") {
			repo = parseValue(args, i, "--repo");
			i += 1;
			continue;
		}
		if (arg.startsWith("--repo=")) {
			repo = arg.slice("--repo=".length);
			continue;
		}
		if (arg === "--instance-id") {
			instanceId = parseValue(args, i, "--instance-id");
			i += 1;
			continue;
		}
		if (arg.startsWith("--instance-id=")) {
			instanceId = arg.slice("--instance-id=".length);
			continue;
		}
		if (arg === "--control-plane") {
			controlPlane = parseValue(args, i, "--control-plane");
			i += 1;
			continue;
		}
		if (arg.startsWith("--control-plane=")) {
			controlPlane = arg.slice("--control-plane=".length);
			continue;
		}
		if (arg === "--runs-dir") {
			runsDir = parseValue(args, i, "--runs-dir");
			i += 1;
			continue;
		}
		if (arg.startsWith("--runs-dir=")) {
			runsDir = arg.slice("--runs-dir=".length);
			continue;
		}
		if (arg === "--root-dir") {
			rootDir = resolve(parseValue(args, i, "--root-dir"));
			i += 1;
			continue;
		}
		if (arg.startsWith("--root-dir=")) {
			rootDir = resolve(arg.slice("--root-dir=".length));
			continue;
		}
		if (arg === "--force") {
			force = true;
			continue;
		}
		throw new Error(`unknown factory init flag: ${arg}`);
	}

	if (!factoryId) throw new Error("missing required --id");
	if (!FACTORY_ID_PATTERN.test(factoryId)) {
		throw new Error("--id must match /^[a-z0-9-]+$/");
	}
	if (!repo || !repo.includes("/")) throw new Error("--repo must be owner/repo");
	if (!controlPlane || !controlPlane.includes("/")) throw new Error("--control-plane must be owner/repo");

	return {
		factoryId,
		instanceId: instanceId.trim() || undefined,
		repo,
		controlPlane,
		force,
		runsDir: runsDir.trim() || undefined,
		rootDir,
	};
}

function resolveFactoryInitInstanceId(parsed: ParsedFactoryInitArgs): string {
	if (parsed.instanceId) {
		if (!isValidFactoryInstanceId(parsed.instanceId, { allowGrandfatheredMothership: true })) {
			throw new Error(`--instance-id must be a valid fac_* id${parsed.factoryId === "mothership" ? ' or "mothership"' : ""}`);
		}
		return parsed.instanceId;
	}
	if (parsed.factoryId === GRANDFATHERED_MOTHERSHIP_INSTANCE_ID) {
		return GRANDFATHERED_MOTHERSHIP_INSTANCE_ID;
	}
	return generateFactoryInstanceId();
}

export async function initFactory(parsed: ParsedFactoryInitArgs, dependencies: FactoryInitDependencies = {}): Promise<FactoryInitResult> {
	const resolveTrackingIssue = dependencies.resolveTrackingIssue
		?? ((options) => ensureFactoryTrackingIssue(options));
	const instanceId = resolveFactoryInitInstanceId(parsed);

	const trackingIssue = resolveTrackingIssue({
		repo: parsed.repo,
		factoryId: parsed.factoryId,
		controlPlaneRepo: parsed.controlPlane,
	});

	const dispatchGraph = `factories/${parsed.factoryId}/graphs/factory_supervisor_tick.dot`;
	const values: FactoryTemplateValues = {
		factory_id: parsed.factoryId,
		factory_name: formatFactoryName(parsed.factoryId),
		instance_id: instanceId,
		target_repo: parsed.repo,
		control_plane_repo: parsed.controlPlane,
		tracking_issue_url: trackingIssue.url,
		dispatch_graph: dispatchGraph,
		trust_domain: `${parsed.factoryId}.local`,
		provider: "openrouter",
		model: "openai/gpt-5.3-codex",
		runs_dir: parsed.runsDir ?? `.hatch/${parsed.factoryId}/runs`,
	};

	const scaffold = scaffoldFactory({
		rootDir: parsed.rootDir,
		factoryId: parsed.factoryId,
		values,
		force: parsed.force,
	});

	const configPath = join(scaffold.factoryRoot, "factory.config.json");
	let parsedConfig: unknown;
	try {
		parsedConfig = JSON.parse(readFileSync(configPath, "utf8"));
	} catch (err) {
		throw new Error(`generated factory config is invalid (${configPath}): ${err instanceof Error ? err.message : String(err)}`);
	}
	let factoryConfig: ReturnType<typeof parseFactoryConfigDocument>;
	try {
		factoryConfig = parseFactoryConfigDocument(parsedConfig);
	} catch (err) {
		throw new Error(`generated factory config is invalid (${configPath}): ${err instanceof Error ? err.message : String(err)}`);
	}

	if (!factoryConfig.policyPack) {
		throw new Error(`generated factory config is invalid (${configPath}): policyPack: must be an object`);
	}

	const policyPackDir = join(scaffold.factoryRoot, "policy-pack", "v1");
	let policyPack: ReturnType<typeof loadPolicyPackDocuments>;
	try {
		policyPack = loadPolicyPackDocuments(policyPackDir);
	} catch (err) {
		throw new Error(`generated policy pack is invalid (${policyPackDir}): ${err instanceof Error ? err.message : String(err)}`);
	}

	const policyPackIssues = validatePolicyPackContract({
		policyPack: factoryConfig.policyPack,
		metadata: policyPack.metadata,
		policies: policyPack.policies,
	});
	if (policyPackIssues.length > 0) {
		throw new Error(`generated policy pack is invalid (${policyPackDir}): ${formatPolicyPackIssue(policyPackIssues[0])}`);
	}

	const registry = updateFactoryRegistry({
		rootDir: parsed.rootDir,
		factoryId: parsed.factoryId,
		instanceId,
		targetRepo: parsed.repo,
		controlPlaneRepo: parsed.controlPlane,
		dispatchGraphPath: dispatchGraph,
	});
	const manifestPath = writeFactoryCompositionManifest({
		rootDir: parsed.rootDir,
		factoryRoot: scaffold.factoryRoot,
		config: factoryConfig,
		registryPath: registry.path,
		registryEntryGraphs: registry.entry.graphs,
	});

	return {
		factoryRoot: scaffold.factoryRoot,
		instanceId,
		trackingIssue,
		registryPath: registry.path,
		writtenFiles: [...scaffold.writtenFiles, manifestPath].sort((left, right) => left.localeCompare(right)),
	};
}

export async function runFactoryInit(args: string[]): Promise<void> {
	const parsed = parseFactoryInitArgs(args);
	const result = await initFactory(parsed);
	console.log(`Initialized factory ${parsed.factoryId}`);
	console.log(`  instance_id: ${result.instanceId}`);
	console.log(`  root: ${result.factoryRoot}`);
	console.log(`  tracking_issue: ${result.trackingIssue.url}`);
	console.log(`  registry: ${result.registryPath}`);
	console.log(`  files: ${result.writtenFiles.length}`);
}
